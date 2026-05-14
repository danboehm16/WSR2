// Deterministic, seedable PRNG. Pure C# port of src/rng.ts (xoroshiro128**
// seeded from splitmix64). The same seed MUST produce the same uint64 stream
// as the TypeScript prototype — see RngParityTests for the parity contract.
//
// Required properties (per AGENTS.md §2):
//   * reproducible 30-year golden simulations,
//   * bit-exact snapshot/replay,
//   * server-authoritative multiplayer determinism.
//
// The cursor (state) is exposed as RngState so it can be snapshotted to JSON
// and restored later without losing fidelity.

using System.Numerics;

namespace Wsr2.Engine;

/// <summary>
/// Snapshot of a <see cref="Rng"/> cursor. <see cref="S0"/> and <see cref="S1"/>
/// are stored as decimal strings so the snapshot is JSON-safe and matches the
/// TypeScript prototype's wire format exactly.
/// </summary>
public sealed record RngState(string S0, string S1);

/// <summary>
/// xoroshiro128** PRNG, seeded via splitmix64. Produces the same stream as
/// the TS prototype's <c>Rng</c> for any given seed.
/// </summary>
public sealed class Rng
{
    private ulong _s0;
    private ulong _s1;

    public Rng(long seed) : this(unchecked((ulong)seed)) { }

    public Rng(ulong seed)
    {
        ulong s = seed;
        _s0 = SplitMix64Next(ref s);
        _s1 = SplitMix64Next(ref s);
        if (_s0 == 0 && _s1 == 0)
        {
            _s0 = 1;
        }
    }

    public Rng(RngState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        _s0 = ulong.Parse(state.S0, System.Globalization.CultureInfo.InvariantCulture);
        _s1 = ulong.Parse(state.S1, System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>xoroshiro128** core. Returns a 64-bit unsigned integer.</summary>
    public ulong Next64()
    {
        ulong s0 = _s0;
        ulong s1 = _s1;
        ulong result = BitOperations.RotateLeft(s0 * 5UL, 7) * 9UL;
        s1 ^= s0;
        _s0 = BitOperations.RotateLeft(s0, 24) ^ s1 ^ (s1 << 16);
        _s1 = BitOperations.RotateLeft(s1, 37);
        return result;
    }

    /// <summary>Uniform double in [0, 1) with 53-bit precision.</summary>
    public double NextDouble()
    {
        // 2^53 fits exactly in a double; (Next64() >> 11) is at most 2^53 - 1.
        // The result is bit-identical to the TS prototype, which performs the
        // same arithmetic in IEEE 754 doubles.
        return (Next64() >> 11) / (double)(1UL << 53);
    }

    /// <summary>Uniform integer in [0, n). n must be a positive int.</summary>
    public int NextInt(int n)
    {
        if (n <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(n), n, "Rng.NextInt: n must be positive");
        }
        return (int)Math.Floor(NextDouble() * n);
    }

    /// <summary>Snapshot the current cursor for later restore.</summary>
    public RngState Snapshot() => new(
        _s0.ToString(System.Globalization.CultureInfo.InvariantCulture),
        _s1.ToString(System.Globalization.CultureInfo.InvariantCulture));

    private static ulong SplitMix64Next(ref ulong state)
    {
        state += 0x9E3779B97F4A7C15UL;
        ulong z = state;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }
}
