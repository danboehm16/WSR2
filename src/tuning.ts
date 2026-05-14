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

  return raw as Tuning;
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
