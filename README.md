# WSR2

A multiplayer-ready stock-market simulation game.

> **Repo state — clean slate.** The earlier TypeScript prototype and the
> partial C# port have been removed. This repository currently contains
> only the design constants ([`tuning.json`](./tuning.json)) and the
> standing rules for contributors ([`AGENTS.md`](./AGENTS.md)). The next
> coding session will build the engine fresh, in idiomatic C#, from line
> one.

## Language & toolchain

- **C# / .NET 8 LTS** for the engine (and any subsequent server).
- xUnit for tests.
- `dotnet format` for formatting; warnings treated as errors.
- No Node, npm, or TypeScript anywhere in the engine tree.

See [`AGENTS.md`](./AGENTS.md) §8 ("C# best practices") for the full set
of binding style and quality rules.

## Planned layout

When code lands, it will look like this:

```text
engine/
  Wsr2.sln
  Directory.Build.props        # net8.0, nullable on, warnings-as-errors
  src/
    Wsr2.Engine/               # class library: tuning, rng, session, macro, …
    Wsr2.Engine.Cli/           # optional headless runner / golden sim
  tests/
    Wsr2.Engine.Tests/         # xUnit
.editorconfig
tuning.json                    # all design constants — already present
```

## Build & test (once code lands)

```bash
cd engine
dotnet restore
dotnet build                        # warnings are errors
dotnet test                         # xUnit
dotnet format --verify-no-changes   # style gate
```

## Standing constraints (one-line summary — see AGENTS.md for the rest)

| Topic | Rule |
|---|---|
| Language | C# / .NET 8 LTS only in the engine. |
| Determinism | Single seeded xoroshiro128\*\* PRNG; snapshots bit-exact; no ambient nondeterminism (`Random.Shared`, `DateTime.Now`, `Guid.NewGuid()`, hash-set iteration order, …). |
| Tunability | Every design constant lives in `tuning.json`; the loader fails fast on missing/invalid fields. |
| Server-authoritative | Engine validates and sequences all client actions; order ids/seqs are server-assigned. |
| Visibility | Per-role, per-field map in `tuning.json`; unknown fields/roles are HIDDEN. |
| Multiplayer speed | Solo can pick from `allowedSpeedsSolo`; ≥2 players locks to 1× (admin override allowed and logged). |
| Snapshots | Versioned schema with explicit migrations; unknown versions throw. |

## Phased build

1. **Phase 0 — Foundations** 🔜: tuning loader, PRNG, visibility,
   session/tick loop, snapshots, admin gate.
2. **Phase 1 — Simulation engine** 🔜: macro environment → company
   fundamentals → pricing kernel.
3. **Phase 2** — instruments, order matching.
4. **Phase 3** — breakthrough events (data-driven from
   `tuning.breakthroughs.archetypes`).
5. **Phase 4** — networking / multiplayer transport.
6. **Phase 5** — UI.

## Decisions baked in (mirrored in `tuning.json`)

1. **30-year default career.** `time.defaultCareerYears = 30`,
   `ticksPerYear = 252`, `maxSimYears = 50` headroom.
2. **Two roles.** `Admin` and `Standard`.
3. **Everything tunable.** Magnitudes, probabilities, caps, the
   visibility map itself, breakthrough archetypes — all in `tuning.json`.
4. **Player feedback enabled from day 1.**
   `feedback.playerWealthEffect.enabledFromDay1 = true`. Effect strength
   scales with AUM share of total market cap.
5. **Multiplayer-ready from day 1.** Deterministic, server-stamped order
   queueing; bit-exact snapshots.
6. **Speed policy.** Solo player can choose any speed in
   `allowedSpeedsSolo`. Two or more players locks to 1×. Admins can
   override and the override is logged.
7. **Public leaderboard by default** (`leaderboard.publicByDefault = true`).
8. **Breakthrough events.** Defined as data in `tuning.json`
   (`breakthroughs.archetypes`). Seeded-random generation and admin
   injection are both intended to be supported.

## Contributing

Read [`AGENTS.md`](./AGENTS.md) first — every PR is reviewed against the
rules in there.
