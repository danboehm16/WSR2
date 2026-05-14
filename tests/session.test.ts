import { describe, it, expect } from "vitest";
import { loadTuning } from "../src/tuning.js";
import { Session } from "../src/session.js";

const tuning = loadTuning();

function newSession(seed = 1): Session {
  return new Session({ tuning, seed });
}

describe("Session — speed policy", () => {
  it("solo player can change speed within the allowed set", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    expect(s.currentSpeed()).toBe(1);
    s.requestSpeed(4);
    expect(s.currentSpeed()).toBe(4);
    s.requestSpeed(64);
    expect(s.currentSpeed()).toBe(64);
  });

  it("rejects speeds not in the allowed set", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    expect(() => s.requestSpeed(3)).toThrow(/allowedSpeedsSolo/);
  });

  it("locks to 1x when a second player joins, even if solo had picked a higher speed", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    s.requestSpeed(16);
    expect(s.currentSpeed()).toBe(16);
    s.addPlayer({ playerId: "p2", displayName: "Bob", role: "Standard" });
    expect(s.currentSpeed()).toBe(1);
  });

  it("stays locked while >=2 players, even if one tries to speed up", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    s.addPlayer({ playerId: "p2", displayName: "Bob", role: "Standard" });
    s.requestSpeed(16);
    expect(s.currentSpeed()).toBe(1);
  });

  it("returns to solo control if a player leaves", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    s.requestSpeed(16);
    s.addPlayer({ playerId: "p2", displayName: "Bob", role: "Standard" });
    expect(s.currentSpeed()).toBe(1);
    s.removePlayer("p2");
    expect(s.currentSpeed()).toBe(16); // back to what Alice had requested
  });

  it("admin override can force a non-1x speed in multiplayer", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    s.addPlayer({ playerId: "p2", displayName: "Bob", role: "Admin" });
    expect(s.currentSpeed()).toBe(1);
    s.applyAdminAction({ type: "setStandardSpeed", speed: 4 }, "Admin");
    expect(s.currentSpeed()).toBe(4);
  });
});

describe("Session — orders & determinism", () => {
  it("assigns server-side ids and seqs to orders", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    const o1 = s.submitOrder({ playerId: "p1", symbol: "ACME", side: "buy", quantity: 10 });
    const o2 = s.submitOrder({ playerId: "p1", symbol: "ACME", side: "sell", quantity: 5 });
    expect(o1.id).toBe(1);
    expect(o2.id).toBe(2);
    expect(o2.seq).toBeGreaterThan(o1.seq);
  });

  it("rejects orders from unknown players and bad quantities", () => {
    const s = newSession();
    expect(() =>
      s.submitOrder({ playerId: "ghost", symbol: "X", side: "buy", quantity: 1 }),
    ).toThrow(/unknown playerId/);
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    expect(() =>
      s.submitOrder({ playerId: "p1", symbol: "X", side: "buy", quantity: 0 }),
    ).toThrow(/quantity/);
  });

  it("running N ticks is deterministic for the same seed and inputs", () => {
    const a = newSession(7);
    const b = newSession(7);
    a.addPlayer({ playerId: "p1", displayName: "A", role: "Standard" });
    b.addPlayer({ playerId: "p1", displayName: "A", role: "Standard" });
    a.run(100);
    b.run(100);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("different seeds produce different RNG cursors after running", () => {
    const a = newSession(1);
    const b = newSession(2);
    a.run(50);
    b.run(50);
    expect(a.snapshot().rng).not.toEqual(b.snapshot().rng);
  });
});

describe("Session — snapshot / restore", () => {
  it("round-trips bit-exactly", () => {
    const s = newSession(99);
    s.addPlayer({ playerId: "p1", displayName: "Alice", role: "Standard" });
    s.addPlayer({ playerId: "p2", displayName: "Bob", role: "Admin" });
    s.submitOrder({ playerId: "p1", symbol: "ACME", side: "buy", quantity: 3 });
    s.run(10);
    s.submitOrder({ playerId: "p2", symbol: "ACME", side: "sell", quantity: 1 });

    const snap = s.snapshot();
    const restored = Session.restore(loadTuning(), snap);
    expect(restored.snapshot()).toEqual(snap);

    // Continuing the simulation should match between original and restored.
    s.run(5);
    restored.run(5);
    expect(restored.snapshot()).toEqual(s.snapshot());
  });
});

describe("Session — admin", () => {
  it("rejects admin actions from non-admins", () => {
    const s = newSession();
    expect(() =>
      s.applyAdminAction(
        { type: "injectBreakthrough", archetypeId: "BreakthroughInvention", companyId: "ACME", severity: 0.8 },
        "Standard",
      ),
    ).toThrow(/Admin/);
  });

  it("logs admin breakthrough injections to the event log", () => {
    const s = newSession();
    s.applyAdminAction(
      { type: "injectBreakthrough", archetypeId: "BreakthroughInvention", companyId: "ACME", severity: 0.8 },
      "Admin",
    );
    const log = s.getEventLog();
    expect(log.some((e) => e.kind === "adminInject")).toBe(true);
  });
});

describe("Session — capacity", () => {
  it("rejects more players than maxPlayersPerSession", () => {
    const s = newSession();
    const max = tuning.multiplayer.maxPlayersPerSession;
    for (let i = 0; i < max; i++) {
      s.addPlayer({ playerId: `p${i}`, displayName: `P${i}`, role: "Standard" });
    }
    expect(() =>
      s.addPlayer({ playerId: "overflow", displayName: "Over", role: "Standard" }),
    ).toThrow(/full/);
  });

  it("rejects duplicate playerIds", () => {
    const s = newSession();
    s.addPlayer({ playerId: "p1", displayName: "A", role: "Standard" });
    expect(() =>
      s.addPlayer({ playerId: "p1", displayName: "A2", role: "Standard" }),
    ).toThrow(/duplicate/);
  });
});
