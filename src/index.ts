/**
 * Public entry point. Re-exports the Phase 0 surface.
 */

export { loadTuning, validateTuning, defaultTuningPath } from "./tuning.js";
export type {
  Tuning,
  TimeTuning,
  MacroTuning,
  MacroDriftSpec,
  MacroInitial,
  MacroCycleSpec,
  MacroVariable,
  CyclePhase,
  MultiplayerTuning,
  SpeedPolicy,
  LeaderboardTuning,
  FeedbackTuning,
  StabilityTuning,
  BreakthroughsTuning,
  BreakthroughArchetype,
  VisibilityTuning,
  VisibilityMap,
  Role,
} from "./tuning.js";

export { Rng } from "./rng.js";
export type { RngState } from "./rng.js";

export { Macro } from "./macro.js";
export type { MacroState, MacroSnapshot } from "./macro.js";

export { isVisible, filterObject, filterPlayers } from "./visibility.js";
export type { VisibilityContext } from "./visibility.js";

export { Session } from "./session.js";
export type {
  SessionOptions,
  SessionSnapshot,
  SessionEvent,
  PlayerState,
  PlayerJoinInfo,
  Order,
  OrderSide,
  AdminAction,
} from "./session.js";
