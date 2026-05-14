# WSR2 engine (C#)

This is the **C# port** of the WSR2 simulation engine. Per
[`AGENTS.md`](../AGENTS.md) §1, the core engine MUST be written in C#; the
TypeScript code under `../src` is an earlier prototype kept as a parity
reference until the port is feature-complete.

## Layout

```
engine/
  Wsr2.slnx
  src/
    Wsr2.Engine/             # class library: deterministic engine
      Rng.cs                 # xoroshiro128** PRNG
      Tuning.cs              # tuning loader + types (reads ../tuning.json)
  tests/
    Wsr2.Engine.Tests/       # xUnit
      RngParityTests.cs      # bit-exact parity vs the TS prototype
      TuningLoaderTests.cs   # mirrors tests/tuning.test.ts assertions
```

`tuning.json` lives at the repo root and is shared by both engines.

## Build & test

```bash
cd engine
dotnet build       # restores + compiles the solution
dotnet test        # runs the xUnit suite
```

`TreatWarningsAsErrors=true` is enabled in `Wsr2.Engine.csproj` — keep it
that way.

## Porting status

| Component        | TS (prototype)        | C# (engine)            |
|------------------|-----------------------|------------------------|
| PRNG             | `src/rng.ts`          | ✅ `Rng.cs`            |
| Tuning loader    | `src/tuning.ts`       | ✅ `Tuning.cs`         |
| Visibility       | `src/visibility.ts`   | 🔜                      |
| Macro engine     | `src/macro.ts`        | 🔜                      |
| Session/tick     | `src/session.ts`      | 🔜                      |
| Snapshots        | `SessionSnapshot`     | 🔜                      |

Each future slice should:

1. Port one component.
2. Add parity tests against the TS prototype's golden values where
   determinism matters (anything that consumes the RNG).
3. Keep both test suites green.
4. Not delete the TS prototype until everything has been ported and run
   under a golden 30-year sim with bit-exact agreement.
