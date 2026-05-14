/**
 * Deterministic, seedable PRNG. We use a small splitmix64-seeded xoroshiro128**
 * implementation in pure JS (BigInt) so the same seed produces the same stream
 * across Node versions and platforms. This is required for:
 *   - reproducible 30-year golden simulations,
 *   - bit-exact snapshot/replay,
 *   - server-authoritative multiplayer determinism.
 *
 * The cursor (state) is exposed so it can be snapshotted and restored.
 */

const MASK64 = (1n << 64n) - 1n;

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK64;
}

function splitmix64(seed: bigint): { next: () => bigint } {
  let s = seed & MASK64;
  return {
    next(): bigint {
      s = (s + 0x9e3779b97f4a7c15n) & MASK64;
      let z = s;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
      return (z ^ (z >> 31n)) & MASK64;
    },
  };
}

export interface RngState {
  s0: string; // BigInt as string for JSON-safe snapshotting
  s1: string;
}

export class Rng {
  private s0: bigint;
  private s1: bigint;

  constructor(seed: number | bigint | RngState) {
    if (typeof seed === "object") {
      this.s0 = BigInt(seed.s0);
      this.s1 = BigInt(seed.s1);
      return;
    }
    const sm = splitmix64(typeof seed === "bigint" ? seed : BigInt(seed));
    this.s0 = sm.next();
    this.s1 = sm.next();
    if (this.s0 === 0n && this.s1 === 0n) this.s0 = 1n;
  }

  /** xoroshiro128** core. Returns a 64-bit BigInt. */
  private next64(): bigint {
    const s0 = this.s0;
    let s1 = this.s1;
    const result = (rotl((s0 * 5n) & MASK64, 7n) * 9n) & MASK64;
    s1 ^= s0;
    this.s0 = (rotl(s0, 24n) ^ s1 ^ ((s1 << 16n) & MASK64)) & MASK64;
    this.s1 = rotl(s1, 37n);
    return result;
  }

  /** Uniform float in [0, 1). 53-bit precision. */
  nextFloat(): number {
    const v = this.next64() >> 11n; // 53 bits
    return Number(v) / 2 ** 53;
  }

  /** Uniform integer in [0, n). n must be a positive safe integer. */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Rng.nextInt: n must be a positive integer, got ${n}`);
    }
    return Math.floor(this.nextFloat() * n);
  }

  /** Snapshot current cursor for later restore. */
  snapshot(): RngState {
    return { s0: this.s0.toString(), s1: this.s1.toString() };
  }
}
