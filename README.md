# WSR2

A multiplayer-ready stock-market simulation game.

> **Repo state -- clean slate.** The earlier TypeScript prototype and the
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

See [`AGENTS.md`](./AGENTS.md) section 8 ("C# best practices") for the full set
of binding style and quality rules.

## Planned layout

When code lands, it will look like this:

```text
engine/
  Wsr2.sln
  Directory.Build.props        # net8.0, nullable on, warnings-as-errors
  src/
    Wsr2.Engine/               # class library: tuning, rng, session, macro, ...
    Wsr2.Engine.Cli/           # optional headless runner / golden sim
  tests/
    Wsr2.Engine.Tests/         # xUnit
.editorconfig
tuning.json                    # all design constants -- already present
```

## Build & test (once code lands)

```bash
cd engine
dotnet restore
dotnet build                        # warnings are errors
dotnet test                         # xUnit
dotnet format --verify-no-changes   # style gate
```

## Standing constraints (one-line summary -- see AGENTS.md for the rest)

| Topic | Rule |
|---|---|
| Language | C# / .NET 8 LTS only in the engine. |
| Determinism | Single seeded xoroshiro128\*\* PRNG; snapshots bit-exact; no ambient nondeterminism (`Random.Shared`, `DateTime.Now`, `Guid.NewGuid()`, hash-set iteration order, ...). |
| Tunability | Every design constant lives in `tuning.json`; the loader fails fast on missing/invalid fields. |
| Server-authoritative | Engine validates and sequences all client actions; order ids/seqs are server-assigned. |
| Visibility | Per-role, per-field map in `tuning.json`; unknown fields/roles are HIDDEN. |
| Multiplayer speed | Solo can pick from `allowedSpeedsSolo`; >=2 players locks to 1x (admin override allowed and logged). |
| Snapshots | Versioned schema with explicit migrations; unknown versions throw. |
| Simulation model | Tick pipeline, macro OU drift, pricing kernel, player feedback, breakthroughs and stability caps documented in detail in AGENTS.md section 10. Items marked TBD there must be confirmed with the project owner before implementation. |
| Code quality | Minimal code, simple syntax readable by a novice, comments explain *why*, review adjacent/dependent code on every change, every PR adds tests and runs `dotnet build` + `dotnet test` + `dotnet format --verify-no-changes` green before declaring done. |

## Phased build and baked-in decisions

The phased build order (Phase 0 foundations through Phase 5 UI), the
**simulation model** (tick pipeline, macro engine, company fundamentals,
pricing kernel and how stock prices are calculated, player-wealth
feedback, breakthrough events, stability caps, snapshot contract), and
the concrete design decisions already mirrored in `tuning.json` are
documented in [`AGENTS.md`](./AGENTS.md) sections 10, 11, and 12. Those
are the authoritative copies; do not restate them here.

## Contributing

Read [`AGENTS.md`](./AGENTS.md) first -- every PR is reviewed against the
rules in there.
