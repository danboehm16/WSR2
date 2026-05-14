/**
 * Server-authoritative session and tick loop.
 *
 * One `Session` represents one shared world. It may host 1..N players. The
 * simulation is deterministic given the seed and the ordered sequence of
 * inputs (orders, admin actions). All randomness goes through the session's
 * `Rng`, whose cursor is part of the snapshot.
 *
 * Speed policy (from tuning.json, decided in Phase 0):
 *   - Solo (1 player):          player can choose any allowed speed (0/1x/4x/16x/64x).
 *   - Multiplayer (2+ players): speed is locked to 1x. Any pending speed
 *                               selection is reset to 1x as soon as a second
 *                               player joins.
 *
 * Tick execution is intentionally separated from real-time scheduling. The
 * `tick()` method advances the world by exactly one tick using only the
 * inputs queued so far, which makes the engine trivially testable, headless,
 * and replayable. A separate scheduler (not in Phase 0) will call `tick()`
 * on a wall-clock cadence based on `currentSpeed()`.
 */

import { Rng, type RngState } from "./rng.js";
import type { Role, Tuning } from "./tuning.js";

export interface PlayerJoinInfo {
  playerId: string;
  displayName: string;
  role: Role;
}

export interface PlayerState extends PlayerJoinInfo {
  cash: number;
  /** Map of symbol -> shares. Empty in Phase 0 (no instruments yet). */
  positions: Record<string, number>;
}

export type OrderSide = "buy" | "sell";

export interface Order {
  /** Server-assigned monotonic id (for deterministic ordering & dedup). */
  id: number;
  /** Server-assigned wall-clock-independent sequence number. */
  seq: number;
  playerId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  /** Limit price; omit / null for market orders (Phase 0 just records). */
  limit?: number;
}

export type AdminAction =
  | { type: "injectBreakthrough"; archetypeId: string; companyId: string; severity: number }
  | { type: "setStandardSpeed"; speed: number }; // admin override allowed even in MP

export interface SessionSnapshot {
  schemaVersion: 1;
  seed: string;            // original seed as string
  rng: RngState;           // current RNG cursor
  tickIndex: number;       // ticks elapsed since session start
  speed: number;           // current effective speed (after policy)
  requestedSpeed: number;  // what the player asked for (may differ in MP)
  nextOrderId: number;
  nextOrderSeq: number;
  players: PlayerState[];
  pendingOrders: Order[];
  /** Append-only event log of public/admin events for replay & audit. */
  eventLog: SessionEvent[];
}

export type SessionEvent =
  | { tick: number; kind: "join";          playerId: string; displayName: string; role: Role }
  | { tick: number; kind: "leave";         playerId: string }
  | { tick: number; kind: "speedChanged";  from: number; to: number; reason: string }
  | { tick: number; kind: "orderQueued";   orderId: number }
  | { tick: number; kind: "orderApplied";  orderId: number }
  | { tick: number; kind: "adminInject";   archetypeId: string; companyId: string; severity: number };

export interface SessionOptions {
  tuning: Tuning;
  seed: number | bigint;
  startingCash?: number;
}

export class Session {
  private readonly tuning: Tuning;
  private readonly seed: bigint;
  private rng: Rng;

  private players: Map<string, PlayerState> = new Map();
  private pendingOrders: Order[] = [];
  private eventLog: SessionEvent[] = [];

  private tickIndex = 0;
  private requestedSpeed = 1;
  private speed = 1;
  private nextOrderId = 1;
  private nextOrderSeq = 1;
  private readonly startingCash: number;

  constructor(opts: SessionOptions) {
    this.tuning = opts.tuning;
    this.seed = typeof opts.seed === "bigint" ? opts.seed : BigInt(opts.seed);
    this.rng = new Rng(this.seed);
    this.startingCash = opts.startingCash ?? 100_000;
  }

  // --- Player management -------------------------------------------------

  addPlayer(info: PlayerJoinInfo): PlayerState {
    if (this.players.has(info.playerId)) {
      throw new Error(`Session.addPlayer: duplicate playerId '${info.playerId}'`);
    }
    if (this.players.size >= this.tuning.multiplayer.maxPlayersPerSession) {
      throw new Error(
        `Session.addPlayer: session full (max ${this.tuning.multiplayer.maxPlayersPerSession})`,
      );
    }
    const state: PlayerState = {
      ...info,
      cash: this.startingCash,
      positions: {},
    };
    this.players.set(info.playerId, state);
    this.eventLog.push({
      tick: this.tickIndex,
      kind: "join",
      playerId: info.playerId,
      displayName: info.displayName,
      role: info.role,
    });
    this.applySpeedPolicy("playerJoined");
    return state;
  }

  removePlayer(playerId: string): void {
    if (!this.players.delete(playerId)) return;
    this.eventLog.push({ tick: this.tickIndex, kind: "leave", playerId });
    this.applySpeedPolicy("playerLeft");
  }

  getPlayers(): PlayerState[] {
    // Deterministic order by playerId for downstream determinism.
    return [...this.players.values()].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  }

  // --- Speed control -----------------------------------------------------

  /**
   * Player-requested speed change. Honoured if and only if the speed policy
   * allows it. In multiplayer the request is recorded but the effective speed
   * stays at 1x.
   */
  requestSpeed(speed: number): { effective: number; requested: number; reason: string } {
    const policy = this.tuning.multiplayer.speedPolicy;
    if (!policy.allowedSpeedsSolo.includes(speed)) {
      throw new Error(
        `Session.requestSpeed: speed ${speed} not in allowedSpeedsSolo ` +
          `[${policy.allowedSpeedsSolo.join(",")}]`,
      );
    }
    this.requestedSpeed = speed;
    this.applySpeedPolicy("requestSpeed");
    return { effective: this.speed, requested: this.requestedSpeed, reason: this.speedReason() };
  }

  /** Compute and apply the effective speed given the current player count. */
  private applySpeedPolicy(reason: string): void {
    const policy = this.tuning.multiplayer.speedPolicy;
    const playerCount = this.players.size;
    let next = this.requestedSpeed;
    if (playerCount >= 2 && policy.multiplayerLockedTo1x) {
      next = 1;
    } else if (playerCount === 1 && !policy.soloPlayerControlsSpeed) {
      next = 1;
    } else if (playerCount === 0) {
      next = this.requestedSpeed;
    }
    if (next !== this.speed) {
      const from = this.speed;
      this.speed = next;
      this.eventLog.push({
        tick: this.tickIndex,
        kind: "speedChanged",
        from,
        to: next,
        reason,
      });
    }
  }

  private speedReason(): string {
    const playerCount = this.players.size;
    if (playerCount >= 2 && this.tuning.multiplayer.speedPolicy.multiplayerLockedTo1x) {
      return "multiplayer-locked-to-1x";
    }
    return "solo-player-controlled";
  }

  currentSpeed(): number {
    return this.speed;
  }

  // --- Orders ------------------------------------------------------------

  /**
   * Queue an order. Server assigns id and sequence number — clients never
   * provide them, which closes off "first to click" exploits in multiplayer.
   */
  submitOrder(input: Omit<Order, "id" | "seq">): Order {
    if (!this.players.has(input.playerId)) {
      throw new Error(`Session.submitOrder: unknown playerId '${input.playerId}'`);
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error("Session.submitOrder: quantity must be positive");
    }
    const order: Order = {
      ...input,
      id: this.nextOrderId++,
      seq: this.nextOrderSeq++,
    };
    this.pendingOrders.push(order);
    this.eventLog.push({ tick: this.tickIndex, kind: "orderQueued", orderId: order.id });
    return order;
  }

  // --- Admin -------------------------------------------------------------

  applyAdminAction(action: AdminAction, requesterRole: Role): void {
    if (requesterRole !== "Admin") {
      throw new Error("Session.applyAdminAction: requires Admin role");
    }
    switch (action.type) {
      case "injectBreakthrough": {
        if (!this.tuning.breakthroughs.adminInjectEnabled) {
          throw new Error("Admin breakthrough injection is disabled in tuning.json");
        }
        this.eventLog.push({
          tick: this.tickIndex,
          kind: "adminInject",
          archetypeId: action.archetypeId,
          companyId: action.companyId,
          severity: action.severity,
        });
        return;
      }
      case "setStandardSpeed": {
        // Admin override — bypasses the multiplayer 1x lock for narrative use.
        this.requestedSpeed = action.speed;
        const from = this.speed;
        this.speed = action.speed;
        if (from !== action.speed) {
          this.eventLog.push({
            tick: this.tickIndex,
            kind: "speedChanged",
            from,
            to: action.speed,
            reason: "admin-override",
          });
        }
        return;
      }
    }
  }

  // --- Tick loop ---------------------------------------------------------

  /**
   * Advance the world by one tick. Phase 0 has no pricing kernel yet, so the
   * tick simply:
   *   1. Drains the order queue in deterministic order (seq asc).
   *   2. Records each as `orderApplied` in the event log.
   *   3. Consumes one RNG draw (so determinism tests have something to bite on).
   *   4. Increments the tick counter.
   *
   * Future phases will plug the pricing kernel, feedback channels and event
   * engine in here without changing the queueing semantics.
   */
  tick(): void {
    const tiebreak = this.tuning.multiplayer.orderQueueDeterministicTiebreak;
    this.pendingOrders.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq;
      return tiebreak === "playerIdAscending"
        ? a.playerId < b.playerId ? -1 : 1
        : a.playerId > b.playerId ? -1 : 1;
    });
    for (const o of this.pendingOrders) {
      this.eventLog.push({ tick: this.tickIndex, kind: "orderApplied", orderId: o.id });
    }
    this.pendingOrders = [];
    // Reserved RNG draw: keeps the per-tick stream offset stable so future
    // additions to the kernel don't shift downstream randomness.
    this.rng.nextFloat();
    this.tickIndex += 1;
  }

  /** Run N ticks. Convenience for tests and the headless golden sim. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  // --- Snapshot / restore ------------------------------------------------

  snapshot(): SessionSnapshot {
    return {
      schemaVersion: 1,
      seed: this.seed.toString(),
      rng: this.rng.snapshot(),
      tickIndex: this.tickIndex,
      speed: this.speed,
      requestedSpeed: this.requestedSpeed,
      nextOrderId: this.nextOrderId,
      nextOrderSeq: this.nextOrderSeq,
      players: this.getPlayers().map((p) => ({ ...p, positions: { ...p.positions } })),
      pendingOrders: this.pendingOrders.map((o) => ({ ...o })),
      eventLog: this.eventLog.map((e) => ({ ...e })),
    };
  }

  static restore(tuning: Tuning, snap: SessionSnapshot, startingCash?: number): Session {
    if (snap.schemaVersion !== 1) {
      throw new Error(`Session.restore: unsupported schemaVersion ${snap.schemaVersion}`);
    }
    const opts: SessionOptions = { tuning, seed: BigInt(snap.seed) };
    if (startingCash !== undefined) opts.startingCash = startingCash;
    const s = new Session(opts);
    s.rng = new Rng(snap.rng);
    s.tickIndex = snap.tickIndex;
    s.speed = snap.speed;
    s.requestedSpeed = snap.requestedSpeed;
    s.nextOrderId = snap.nextOrderId;
    s.nextOrderSeq = snap.nextOrderSeq;
    s.pendingOrders = snap.pendingOrders.map((o) => ({ ...o }));
    s.eventLog = snap.eventLog.map((e) => ({ ...e }));
    s.players = new Map(snap.players.map((p) => [p.playerId, { ...p, positions: { ...p.positions } }]));
    return s;
  }

  // --- Read-only accessors (for tests / serialization) -------------------

  getTickIndex(): number { return this.tickIndex; }
  getEventLog(): readonly SessionEvent[] { return this.eventLog; }
  getPendingOrders(): readonly Order[] { return this.pendingOrders; }
}
