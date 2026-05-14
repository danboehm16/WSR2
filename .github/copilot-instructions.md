# Copilot instructions

The authoritative instructions for any agent working in this repo are in
[`AGENTS.md`](../AGENTS.md) at the repo root. **Read that file first.**

## Current state

The repository has been deliberately reset. There is **no application
code** — the previous TypeScript prototype and the partial C# port were
removed so the next coding session can start from a clean slate in
idiomatic C#. Only `tuning.json`, `AGENTS.md`, `README.md`, this file,
and `.gitignore` remain.

## Highlights you must not forget

- **The engine is C# / .NET 8 LTS.** No TypeScript, no JavaScript, no
  Node tooling. Do not reintroduce any of those.
- **Determinism is non-negotiable.** All randomness goes through one
  seeded xoroshiro128\*\* PRNG owned by the session. Snapshots must be
  bit-exact. No `Random.Shared`, no `DateTime.Now`/`UtcNow`, no
  `Guid.NewGuid()`, no hash-set iteration order leaking into state.
- **Tunability.** All design constants live in `tuning.json`; the
  loader fails fast on missing / invalid fields. Never hard-code a
  magnitude.
- **Visibility.** Server-side, **deny-by-default** for unknown
  fields/roles, driven by the `visibility.roles` map in `tuning.json`.
- **Server-authoritative.** Order ids and sequence numbers are
  server-assigned; never trust client-supplied ones.
- **Speed policy.** Multiplayer is locked to 1×; solo can pick from
  `multiplayer.speedPolicy.allowedSpeedsSolo`.
- **Snapshots.** Versioned `SchemaVersion`; bumping it requires a
  migration path; unknown versions throw.

## C# style bar (binding — see AGENTS.md §8 for the complete list)

- `<Nullable>enable</Nullable>`,
  `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`,
  `<AnalysisLevel>latest-recommended</AnalysisLevel>` — set in
  `engine/Directory.Build.props`, not per-project.
- File-scoped namespaces; one top-level type per file; type name matches
  file name.
- Immutable by default: `record` / `readonly record struct`,
  `ImmutableArray<T>`, `ImmutableDictionary<TK,TV>` on API boundaries.
- `sealed` by default for classes that don't need subclassing.
- Async lives at the edges (I/O, orchestration); the deterministic
  engine core is synchronous. Library code uses
  `ConfigureAwait(false)` on every `await`. Long-running async APIs
  take a `CancellationToken cancellationToken`.
- Throw specific exceptions (`ArgumentNullException.ThrowIfNull`,
  `ArgumentOutOfRangeException.ThrowIfNegativeOrZero`, project-defined
  exceptions like `TuningException`); never throw bare `Exception`.
- `Microsoft.Extensions.Logging` with compile-time templates; never
  `Console.WriteLine` from the engine.
- xUnit; one test class per production type; tests named as sentences
  (`Method_WhenCondition_ExpectedOutcome`); deterministic-stream and
  snapshot round-trip tests are mandatory for any RNG-consuming
  subsystem.
- Engine library dependencies limited to BCL, `System.Text.Json`, and
  `Microsoft.Extensions.Logging.Abstractions` without explicit
  approval.

## Build & test (once code exists)

```bash
cd engine
dotnet build       # warnings-as-errors
dotnet test        # xUnit
dotnet format --verify-no-changes
```

See `AGENTS.md` for the full standing rules and the phased build plan.
