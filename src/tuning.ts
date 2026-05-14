/**
 * Tuning loader and types.
 *
 * Every game-design constant lives in `tuning.json` and is loaded through this
 * module. No runtime code should hard-code numbers that a designer might want
 * to change — instead, add the field here and reference it via the loaded
 * `Tuning` object.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type Role = "Admin" | "Standard" | string;

export interface SpeedPolicy {
  soloPlayerControlsSpeed: boolean;
  multiplayerLockedTo1x: boolean;
  allowedSpeedsSolo: number[];
}

export interface MultiplayerTuning {
  maxPlayersPerSession: number;
  speedPolicy: SpeedPolicy;
  snapshotEveryTicks: number;
  orderQueueDeterministicTiebreak: "playerIdAscending" | "playerIdDescending";
}

export interface TimeTuning {
  ticksPerYear: number;
  defaultCareerYears: number;
  maxSimYears: number;
  tickIntervalMsAt1x: number;
}

export interface LeaderboardTuning {
  publicByDefault: boolean;
  fields: string[];
}

export type CyclePhase = "Expansion" | "Peak" | "Contraction" | "Trough";

export interface MacroDriftSpec {
  mean: number;
  reversion: number; // per-tick pull toward mean (0..1)
  vol: number;       // per-tick gaussian std-dev
  min: number;
  max: number;
}

export interface MacroInitial {
  cyclePhase: CyclePhase;
  gdpGrowth: number;
  inflation: number;
  policyRate: number;
  creditSpread: number;
  consumerSentiment: number;
}

export interface MacroCycleSpec {
  phaseOrder: CyclePhase[];
  minTicksPerPhase: Record<CyclePhase, number>;
  maxTicksPerPhase: Record<CyclePhase, number>;
}

export type MacroVariable =
  | "gdpGrowth"
  | "inflation"
  | "policyRate"
  | "creditSpread"
  | "consumerSentiment";

export interface MacroTuning {
  initial: MacroInitial;
  cycle: MacroCycleSpec;
  drift: Record<MacroVariable, MacroDriftSpec>;
  phaseBias: Record<CyclePhase, Record<MacroVariable, number>>;
}

export interface PlayerWealthEffect {
  enabledFromDay1: boolean;
  aumShareToFlowGain: number;
  flowContributionCap: number;
  priceImpactBpsPerAdvPct: number;
  priceImpactCapBps: number;
}

export interface FeedbackTuning {
  playerWealthEffect: PlayerWealthEffect;
}

export interface StabilityTuning {
  dailyMoveCapPct: number;
  eventDayDailyMoveCapPct: number;
  sectorTickShockBudgetPct: number;
  marketTickShockBudgetPct: number;
}

export interface BreakthroughArchetype {
  id: string;
  direction: 1 | -1;
  minPct: number;
  maxPct: number;
  rippleCompetitorsPct: number;
  rippleSuppliersPct: number;
}

export interface BreakthroughsTuning {
  perCompanyAnnualProbability: number;
  severityDistribution: { type: string; alpha: number; min: number; max: number };
  decay: { defaultHalfLifeTicks: number };
  adminInjectEnabled: boolean;
  seededRandomEnabled: boolean;
  archetypes: BreakthroughArchetype[];
}

/** Map of dotted-field-path -> boolean. */
export type VisibilityMap = Record<string, boolean>;

export interface VisibilityTuning {
  roles: Record<Role, VisibilityMap>;
}

export interface Tuning {
  time: TimeTuning;
  macro: MacroTuning;
  multiplayer: MultiplayerTuning;
  leaderboard: LeaderboardTuning;
  feedback: FeedbackTuning;
  stability: StabilityTuning;
  breakthroughs: BreakthroughsTuning;
  visibility: VisibilityTuning;
}

/**
 * Validate a parsed tuning object. Throws with a descriptive message on the
 * first problem found. The aim is fail-fast at startup, not partial loading.
 */
export function validateTuning(raw: unknown): Tuning {
  if (!raw || typeof raw !== "object") {
    throw new Error("tuning: root must be an object");
  }
  const t = raw as Record<string, unknown>;

  const requireSection = (name: string): Record<string, unknown> => {
    const v = t[name];
    if (!v || typeof v !== "object") {
      throw new Error(`tuning: missing or invalid section '${name}'`);
    }
    return v as Record<string, unknown>;
  };

  const time = requireSection("time");
  for (const k of ["ticksPerYear", "defaultCareerYears", "maxSimYears", "tickIntervalMsAt1x"]) {
    const v = time[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`tuning.time.${k} must be a positive number`);
    }
  }
  if ((time.defaultCareerYears as number) > (time.maxSimYears as number)) {
    throw new Error("tuning.time.defaultCareerYears cannot exceed maxSimYears");
  }

  const mp = requireSection("multiplayer");
  const sp = mp.speedPolicy as Record<string, unknown> | undefined;
  if (!sp || typeof sp !== "object") {
    throw new Error("tuning.multiplayer.speedPolicy is required");
  }
  if (typeof sp.soloPlayerControlsSpeed !== "boolean" || typeof sp.multiplayerLockedTo1x !== "boolean") {
    throw new Error("tuning.multiplayer.speedPolicy flags must be booleans");
  }
  if (!Array.isArray(sp.allowedSpeedsSolo) || (sp.allowedSpeedsSolo as unknown[]).length === 0) {
    throw new Error("tuning.multiplayer.speedPolicy.allowedSpeedsSolo must be a non-empty array");
  }
  for (const s of sp.allowedSpeedsSolo as unknown[]) {
    if (typeof s !== "number" || s < 0) {
      throw new Error("tuning.multiplayer.speedPolicy.allowedSpeedsSolo entries must be non-negative numbers");
    }
  }

  const vis = requireSection("visibility");
  const roles = vis.roles as Record<string, unknown> | undefined;
  if (!roles || typeof roles !== "object") {
    throw new Error("tuning.visibility.roles is required");
  }
  for (const role of ["Admin", "Standard"]) {
    if (!(role in roles)) {
      throw new Error(`tuning.visibility.roles.${role} is required`);
    }
    const m = roles[role] as Record<string, unknown>;
    for (const [k, v] of Object.entries(m)) {
      if (typeof v !== "boolean") {
        throw new Error(`tuning.visibility.roles.${role}.${k} must be boolean`);
      }
    }
  }

  // Sections present but only shallow-checked here; deeper checks added when
  // those subsystems land.
  requireSection("leaderboard");
  requireSection("feedback");
  requireSection("stability");
  requireSection("breakthroughs");

  validateMacro(requireSection("macro"));

  return raw as Tuning;
}

const MACRO_VARS: MacroVariable[] = [
  "gdpGrowth",
  "inflation",
  "policyRate",
  "creditSpread",
  "consumerSentiment",
];

const CYCLE_PHASES: CyclePhase[] = ["Expansion", "Peak", "Contraction", "Trough"];

function validateMacro(macro: Record<string, unknown>): void {
  const initial = macro.initial as Record<string, unknown> | undefined;
  if (!initial || typeof initial !== "object") {
    throw new Error("tuning.macro.initial is required");
  }
  if (!CYCLE_PHASES.includes(initial.cyclePhase as CyclePhase)) {
    throw new Error(
      `tuning.macro.initial.cyclePhase must be one of [${CYCLE_PHASES.join(",")}]`,
    );
  }
  for (const v of MACRO_VARS) {
    if (typeof initial[v] !== "number" || !Number.isFinite(initial[v] as number)) {
      throw new Error(`tuning.macro.initial.${v} must be a finite number`);
    }
  }

  const cycle = macro.cycle as Record<string, unknown> | undefined;
  if (!cycle || typeof cycle !== "object") {
    throw new Error("tuning.macro.cycle is required");
  }
  if (!Array.isArray(cycle.phaseOrder) || (cycle.phaseOrder as unknown[]).length === 0) {
    throw new Error("tuning.macro.cycle.phaseOrder must be a non-empty array");
  }
  for (const p of cycle.phaseOrder as unknown[]) {
    if (!CYCLE_PHASES.includes(p as CyclePhase)) {
      throw new Error(`tuning.macro.cycle.phaseOrder contains invalid phase '${String(p)}'`);
    }
  }
  for (const bound of ["minTicksPerPhase", "maxTicksPerPhase"] as const) {
    const m = cycle[bound] as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") {
      throw new Error(`tuning.macro.cycle.${bound} is required`);
    }
    for (const phase of CYCLE_PHASES) {
      const v = m[phase];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        throw new Error(`tuning.macro.cycle.${bound}.${phase} must be a positive integer`);
      }
    }
    // sanity: min <= max per phase
    if (bound === "maxTicksPerPhase") {
      const min = cycle.minTicksPerPhase as Record<string, number>;
      const max = m as unknown as Record<string, number>;
      for (const phase of CYCLE_PHASES) {
        if (min[phase] > max[phase]) {
          throw new Error(`tuning.macro.cycle: minTicksPerPhase.${phase} > maxTicksPerPhase.${phase}`);
        }
      }
    }
  }

  const drift = macro.drift as Record<string, unknown> | undefined;
  if (!drift || typeof drift !== "object") {
    throw new Error("tuning.macro.drift is required");
  }
  for (const v of MACRO_VARS) {
    const spec = drift[v] as Record<string, unknown> | undefined;
    if (!spec || typeof spec !== "object") {
      throw new Error(`tuning.macro.drift.${v} is required`);
    }
    for (const k of ["mean", "reversion", "vol", "min", "max"]) {
      if (typeof spec[k] !== "number" || !Number.isFinite(spec[k] as number)) {
        throw new Error(`tuning.macro.drift.${v}.${k} must be a finite number`);
      }
    }
    if ((spec.min as number) >= (spec.max as number)) {
      throw new Error(`tuning.macro.drift.${v}: min must be < max`);
    }
    if ((spec.reversion as number) < 0 || (spec.reversion as number) > 1) {
      throw new Error(`tuning.macro.drift.${v}.reversion must be in [0,1]`);
    }
    if ((spec.vol as number) < 0) {
      throw new Error(`tuning.macro.drift.${v}.vol must be >= 0`);
    }
  }

  const bias = macro.phaseBias as Record<string, unknown> | undefined;
  if (!bias || typeof bias !== "object") {
    throw new Error("tuning.macro.phaseBias is required");
  }
  for (const phase of CYCLE_PHASES) {
    const b = bias[phase] as Record<string, unknown> | undefined;
    if (!b || typeof b !== "object") {
      throw new Error(`tuning.macro.phaseBias.${phase} is required`);
    }
    for (const v of MACRO_VARS) {
      if (typeof b[v] !== "number" || !Number.isFinite(b[v] as number)) {
        throw new Error(`tuning.macro.phaseBias.${phase}.${v} must be a finite number`);
      }
    }
  }
}

/** Default path: <repo>/tuning.json */
export function defaultTuningPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ is one level below repo root in dev, dist/ likewise after build
  return resolve(here, "..", "tuning.json");
}

export function loadTuning(path: string = defaultTuningPath()): Tuning {
  const text = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`tuning: failed to parse JSON at ${path}: ${(e as Error).message}`);
  }
  return validateTuning(parsed);
}
