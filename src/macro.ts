/**
 * Macro environment.
 *
 * Drives five slow-moving variables (GDP growth, inflation, policy rate, credit
 * spread, consumer sentiment) together with a 4-phase business cycle
 * (Expansion → Peak → Contraction → Trough → …). On every tick:
 *
 *   1. The cycle clock advances. After the phase's `minTicksPerPhase` window,
 *      the simulator may roll into the next phase. By `maxTicksPerPhase` it is
 *      forced to roll. The roll probability rises linearly between min and
 *      max so the average phase length sits near the geometric midpoint —
 *      cheap, deterministic, and avoids the long-tail problem of a pure
 *      Bernoulli trial.
 *
 *   2. Each macro variable performs an Ornstein–Uhlenbeck-style step:
 *
 *        x ← x + reversion · (mean − x) + phaseBias[phase] + vol · N(0,1)
 *        x ← clamp(x, min, max)
 *
 *      The phase bias nudges the variable in the direction characteristic of
 *      the current phase (e.g. GDP growth drifts down in Contraction). All
 *      magnitudes live in `tuning.json`; nothing is hard-coded here.
 *
 *   3. Gaussian samples come from the session RNG via Box–Muller, so the
 *      whole macro stream is part of the deterministic snapshot.
 */

import { Rng } from "./rng.js";
import type {
  CyclePhase,
  MacroDriftSpec,
  MacroTuning,
  MacroVariable,
} from "./tuning.js";

const VARS: MacroVariable[] = [
  "gdpGrowth",
  "inflation",
  "policyRate",
  "creditSpread",
  "consumerSentiment",
];

export interface MacroState {
  cyclePhase: CyclePhase;
  ticksInPhase: number;
  gdpGrowth: number;
  inflation: number;
  policyRate: number;
  creditSpread: number;
  consumerSentiment: number;
}

export interface MacroSnapshot extends MacroState {
  /** Buffered second Box–Muller sample, if any. Kept for bit-exact restore. */
  spareNormal: number | null;
}

/** Box–Muller normal sampler that buffers the spare sample for efficiency. */
class NormalSampler {
  private spare: number | null = null;

  constructor(spare: number | null = null) {
    this.spare = spare;
  }

  sample(rng: Rng): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    // Polar (Marsaglia) form is faster but uses an unbounded number of draws,
    // which complicates reproducibility. The classical Box–Muller form uses
    // exactly two uniforms per call pair → easy to snapshot.
    let u1 = rng.nextFloat();
    if (u1 < 1e-300) u1 = 1e-300; // avoid log(0)
    const u2 = rng.nextFloat();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    this.spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  }

  getSpare(): number | null {
    return this.spare;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export class Macro {
  private readonly tuning: MacroTuning;
  private state: MacroState;
  private normals: NormalSampler;

  constructor(tuning: MacroTuning, snapshot?: MacroSnapshot) {
    this.tuning = tuning;
    if (snapshot) {
      this.state = {
        cyclePhase: snapshot.cyclePhase,
        ticksInPhase: snapshot.ticksInPhase,
        gdpGrowth: snapshot.gdpGrowth,
        inflation: snapshot.inflation,
        policyRate: snapshot.policyRate,
        creditSpread: snapshot.creditSpread,
        consumerSentiment: snapshot.consumerSentiment,
      };
      this.normals = new NormalSampler(snapshot.spareNormal);
    } else {
      const init = tuning.initial;
      this.state = {
        cyclePhase: init.cyclePhase,
        ticksInPhase: 0,
        gdpGrowth: init.gdpGrowth,
        inflation: init.inflation,
        policyRate: init.policyRate,
        creditSpread: init.creditSpread,
        consumerSentiment: init.consumerSentiment,
      };
      this.normals = new NormalSampler(null);
    }
  }

  getState(): Readonly<MacroState> {
    return this.state;
  }

  /**
   * Advance the macro state by one tick, drawing all randomness from `rng`.
   * Returns true if the cycle phase changed during this step.
   */
  step(rng: Rng): boolean {
    const phaseChanged = this.advanceCycle(rng);
    const bias = this.tuning.phaseBias[this.state.cyclePhase];

    for (const v of VARS) {
      const spec: MacroDriftSpec = this.tuning.drift[v];
      const z = this.normals.sample(rng);
      const next =
        this.state[v] +
        spec.reversion * (spec.mean - this.state[v]) +
        bias[v] +
        spec.vol * z;
      this.state[v] = clamp(next, spec.min, spec.max);
    }

    this.state.ticksInPhase += 1;
    return phaseChanged;
  }

  /**
   * Decide whether to roll into the next phase. Roll probability rises
   * linearly from 0 at `minTicksPerPhase` to 1 at `maxTicksPerPhase`, with
   * a hard force at the upper bound. RNG is drawn unconditionally on ticks
   * inside the [min, max) window so the stream offset stays stable.
   */
  private advanceCycle(rng: Rng): boolean {
    const phase = this.state.cyclePhase;
    const minT = this.tuning.cycle.minTicksPerPhase[phase];
    const maxT = this.tuning.cycle.maxTicksPerPhase[phase];
    const t = this.state.ticksInPhase;

    if (t < minT) return false;
    if (t >= maxT) {
      this.rollPhase();
      return true;
    }
    const span = maxT - minT;
    const p = span === 0 ? 1 : (t - minT) / span;
    const draw = rng.nextFloat();
    if (draw < p) {
      this.rollPhase();
      return true;
    }
    return false;
  }

  private rollPhase(): void {
    const order = this.tuning.cycle.phaseOrder;
    const idx = order.indexOf(this.state.cyclePhase);
    const next = order[(idx + 1) % order.length] as CyclePhase;
    this.state.cyclePhase = next;
    this.state.ticksInPhase = 0;
  }

  snapshot(): MacroSnapshot {
    return {
      ...this.state,
      spareNormal: this.normals.getSpare(),
    };
  }
}
