import { describe, it, expect } from "vitest";
import { Rng } from "../src/rng.js";

describe("Rng", () => {
  it("is deterministic for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const aSeq = Array.from({ length: 100 }, () => a.nextFloat());
    const bSeq = Array.from({ length: 100 }, () => b.nextFloat());
    expect(aSeq).toEqual(bSeq);
  });

  it("produces values in [0, 1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 10_000; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("snapshots and restores cursor exactly", () => {
    const r = new Rng(123);
    for (let i = 0; i < 50; i++) r.nextFloat();
    const snap = r.snapshot();
    const next = r.nextFloat();

    const r2 = new Rng(snap);
    expect(r2.nextFloat()).toBe(next);
  });

  it("nextInt rejects bad inputs", () => {
    const r = new Rng(1);
    expect(() => r.nextInt(0)).toThrow();
    expect(() => r.nextInt(-1)).toThrow();
    expect(() => r.nextInt(1.5)).toThrow();
  });
});
