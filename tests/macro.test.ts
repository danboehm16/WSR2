import { describe, it, expect } from "vitest";
import { loadTuning } from "../src/tuning.js";
import { Macro } from "../src/macro.js";
import { Rng } from "../src/rng.js";

const tuning = loadTuning();

describe("Macro", () => {
  it("starts in the configured initial state", () => {
    const m = new Macro(tuning.macro);
    const s = m.getState();
    expect(s.cyclePhase).toBe(tuning.macro.initial.cyclePhase);
    expect(s.gdpGrowth).toBe(tuning.macro.initial.gdpGrowth);
    expect(s.inflation).toBe(tuning.macro.initial.inflation);
    expect(s.policyRate).toBe(tuning.macro.initial.policyRate);
    expect(s.creditSpread).toBe(tuning.macro.initial.creditSpread);
    expect(s.consumerSentiment).toBe(tuning.macro.initial.consumerSentiment);
    expect(s.ticksInPhase).toBe(0);
  });

  it("is deterministic for the same seed", () => {
    const a = new Macro(tuning.macro);
    const b = new Macro(tuning.macro);
    const ra = new Rng(42);
    const rb = new Rng(42);
    for (let i = 0; i < 5_000; i++) {
      a.step(ra);
      b.step(rb);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("respects per-variable bounds across a long run", () => {
    const m = new Macro(tuning.macro);
    const r = new Rng(123);
    for (let i = 0; i < 30 * tuning.time.ticksPerYear; i++) {
      m.step(r);
      const s = m.getState();
      for (const v of ["gdpGrowth", "inflation", "policyRate", "creditSpread", "consumerSentiment"] as const) {
        const spec = tuning.macro.drift[v];
        expect(s[v]).toBeGreaterThanOrEqual(spec.min);
        expect(s[v]).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it("never rolls phase before minTicksPerPhase", () => {
    const m = new Macro(tuning.macro);
    const r = new Rng(9);
    const startPhase = m.getState().cyclePhase;
    const minT = tuning.macro.cycle.minTicksPerPhase[startPhase];
    for (let i = 0; i < minT; i++) {
      m.step(r);
      expect(m.getState().cyclePhase).toBe(startPhase);
    }
  });

  it("forces a phase roll at maxTicksPerPhase", () => {
    const m = new Macro(tuning.macro);
    const r = new Rng(2026);
    const startPhase = m.getState().cyclePhase;
    const maxT = tuning.macro.cycle.maxTicksPerPhase[startPhase];
    let rolled = false;
    for (let i = 0; i <= maxT && !rolled; i++) {
      if (m.step(r)) rolled = true;
    }
    expect(rolled).toBe(true);
    // The new phase must be the next one in phaseOrder.
    const order = tuning.macro.cycle.phaseOrder;
    const expected = order[(order.indexOf(startPhase) + 1) % order.length];
    expect(m.getState().cyclePhase).toBe(expected);
  });

  it("snapshots and restores bit-exactly (incl. spare normal)", () => {
    const m = new Macro(tuning.macro);
    const r = new Rng(7);
    // odd number of steps so the spare normal is non-null half the time
    for (let i = 0; i < 101; i++) m.step(r);
    const snap = m.snapshot();
    const rState = r.snapshot();

    const m2 = new Macro(tuning.macro, snap);
    const r2 = new Rng(rState);

    for (let i = 0; i < 200; i++) {
      m.step(r);
      m2.step(r2);
    }
    expect(m2.snapshot()).toEqual(m.snapshot());
  });

  it("produces variable movement across many ticks (not stuck)", () => {
    const m = new Macro(tuning.macro);
    const r = new Rng(31337);
    const start = { ...m.getState() };
    for (let i = 0; i < 1_000; i++) m.step(r);
    const end = m.getState();
    // At least one of the variables should have moved meaningfully.
    const moved =
      Math.abs(end.gdpGrowth - start.gdpGrowth) > 1e-4 ||
      Math.abs(end.inflation - start.inflation) > 1e-4 ||
      Math.abs(end.policyRate - start.policyRate) > 1e-4 ||
      Math.abs(end.creditSpread - start.creditSpread) > 1e-4 ||
      Math.abs(end.consumerSentiment - start.consumerSentiment) > 1e-4;
    expect(moved).toBe(true);
  });
});
