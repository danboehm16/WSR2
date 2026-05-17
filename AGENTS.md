# Agent instructions for WSR2

These are the standing rules for any agent (human or AI) making changes to
this repository. They capture decisions the project owner has made and that
must not be silently revisited. If a constraint here ever conflicts with a
short-term instruction, **stop and ask** rather than dropping the constraint.

> **Repo state:** the codebase has been deliberately reset. Only this file,
> [`README.md`](./README.md), [`tuning.json`](./tuning.json),
> [`.github/copilot-instructions.md`](./.github/copilot-instructions.md),
> and `.gitignore` are kept. There is **no** application code yet — neither
> the previous TypeScript prototype nor the partial C# port survive. The
> next coding session starts from a clean slate, idiomatic C# from line one.

---

## 1. Language & runtime

- **The entire engine is C#.** Target the latest .NET LTS SDK (.NET 8 today;
  upgrade in lock-step when a new LTS ships). There is no TypeScript,
  JavaScript, or Node tooling in the engine. Do not reintroduce any.
- Front-end / UI may eventually be a separate process in another language
  talking to the C# engine over a defined boundary. That boundary is not
  yet designed; do not pre-empt it.
- Suggested layout (binding once code lands):

  ```text
  engine/
    Wsr2.sln
    src/
      Wsr2.Engine/             # class library: tuning, rng, session, macro, …
      Wsr2.Engine.Cli/         # optional headless runner / golden sim
    tests/
      Wsr2.Engine.Tests/       # xUnit
  tuning.json                   # stays at repo root, shared across hosts
  ```

## 2. Determinism (non-negotiable)

- All randomness MUST flow through a single seeded PRNG owned by the
  session. The reference algorithm is **xoroshiro128\*\***.
- Snapshots MUST be **bit-exact**. Restoring from a snapshot, then
  advancing N ticks, must produce a snapshot byte-for-byte identical to
  advancing the original session N ticks.
- No `Random`, no `Random.Shared`, no `DateTime.Now`/`UtcNow`,
  no `Stopwatch`, no `Guid.NewGuid()`, no `Environment.TickCount`, no
  `RuntimeHelpers.GetHashCode`, no PID, no thread id — nothing ambient
  inside engine code. If you need a clock for telemetry, inject an
  `IClock` and keep it out of the deterministic core.
- Iteration order over hash-based collections (`Dictionary<,>`,
  `HashSet<>`) must not affect state. When the order matters, sort by a
  stable key (`OrderBy(x => x.Id, StringComparer.Ordinal)`) before
  using the result.
- **Order IDs and sequence numbers are server-assigned.** Never trust
  client-supplied IDs/sequences — that's a multiplayer fairness exploit
  vector.
- Floating-point: prefer `double`; do not change rounding modes; avoid
  `Math.Fma` / SIMD intrinsics in the deterministic core unless you've
  proven cross-platform stability with tests.

## 3. Tunability (non-negotiable)

- All game-design constants — magnitudes, probabilities, caps, phase
  bounds, role visibility map, breakthrough archetypes, speed policy,
  feedback gains, stability bounds — live in **`tuning.json`** at the
  repo root and are loaded through the engine's tuning loader.
- Engine code must never hard-code a number a designer might want to
  tweak. If you find yourself typing a magic constant, it belongs in
  `tuning.json`.
- The tuning loader fails fast with a clear, actionable error if a
  required field is missing, out of range, or the wrong type. Throw a
  dedicated `TuningException` (or similar named exception); never throw
  bare `Exception` or swallow `JsonException`.

## 4. Server-authoritative architecture

- The engine is the source of truth. Clients propose actions (orders,
  speed changes); the engine validates, sequences, and applies them.
- Never accept derived state from a client (positions, cash, prices).
  Re-derive on the server.
- Admin actions are gated by role and additionally by a tuning flag
  where appropriate (e.g. `breakthroughs.adminInjectEnabled`).

## 5. Role-based visibility (deny-by-default)

- Field-level visibility is enforced **server-side at the serialization
  boundary**, using the per-role map in `tuning.json`
  (`visibility.roles`).
- Unknown fields and unknown roles are HIDDEN. There is no
  allow-by-default path.
- When adding a new state field that ever leaves the server, add it to
  the visibility map in the same change.

## 6. Multiplayer & speed policy

- Sessions support 1..N players up to `multiplayer.maxPlayersPerSession`.
- Solo: player may pick any speed in `multiplayer.speedPolicy.allowedSpeedsSolo`.
- As soon as ≥2 players are present, speed is **locked to 1×**
  (`multiplayerLockedTo1x`).
- Admins may override the lock for narrative use; the override must be
  logged in the event log.
- Order queue tiebreak is deterministic per
  `multiplayer.orderQueueDeterministicTiebreak`.

## 7. Snapshots & migration

- `SessionSnapshot` carries a `SchemaVersion`. Bumping the engine schema
  REQUIRES a migration path from the previous version (re-derive missing
  fields from `tuning.*.initial` or equivalent; never silently drop
  data).
- Restoring an unknown schema version must throw, not guess.
- Snapshots serialize via `System.Text.Json` with explicit, versioned
  contracts (records + `JsonSerializerOptions` with stable property
  naming). No `BinaryFormatter`. No reflection-based shortcuts that
  change between runtimes.

## 8. C# best practices (binding for this repo)

These are the project-wide style and quality rules. They are not
suggestions; they're the bar that PRs are reviewed against.

### Project & build
- One `Directory.Build.props` at `engine/` sets common properties for
  every project: `<TargetFramework>net8.0</TargetFramework>`,
  `<LangVersion>latest</LangVersion>`, `<Nullable>enable</Nullable>`,
  `<ImplicitUsings>enable</ImplicitUsings>`,
  `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`,
  `<EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>`,
  `<AnalysisLevel>latest-recommended</AnalysisLevel>`.
- One `.editorconfig` at the repo root encodes formatting (4-space
  indent, LF line endings, file-scoped namespaces, `var` only when the
  type is apparent on the right-hand side, expression-bodied members
  where they improve clarity).
- Solution file: `engine/Wsr2.sln`. One project per concern; library
  projects do not depend on test projects.
- No `unsafe` blocks in the engine without an explicit, reviewed reason.

### Language style
- **Nullable reference types are on everywhere.** Eliminate warnings;
  do not paper over with `!`. If a value is nullable, it is `T?` and
  consumers handle it.
- **Immutable by default.** Prefer `record` / `readonly record struct`
  for data; `IReadOnlyList<T>`, `ImmutableArray<T>`,
  `ImmutableDictionary<TK, TV>` for collections that cross API
  boundaries.
- **File-scoped namespaces.** One top-level type per file, file name
  matches the type.
- Use `sealed` on classes that don't need to be subclassed (the
  default for engine internals).
- Pattern matching, `switch` expressions, target-typed `new()`,
  collection expressions (`[1, 2, 3]`) are preferred over older idioms
  when they read more clearly.
- `using` declarations over `try/finally` for `IDisposable`.
- `ConfigureAwait(false)` on every awaited task in library code.
- Cancellation: every long-running async API takes `CancellationToken`,
  named `cancellationToken`, defaulted only at the public boundary.

### Naming
- Types, methods, properties, public fields: `PascalCase`.
- Locals, parameters: `camelCase`.
- Private fields: `_camelCase`.
- Constants and enum members: `PascalCase` (no `SCREAMING_SNAKE`).
- Interfaces start with `I` (`ITuningSource`, `IClock`).
- Async methods that return a `Task`/`ValueTask` end in `Async`.

### Errors
- Throw the most specific BCL exception that fits, or a project-defined
  exception derived from `Exception`. Never throw `Exception` directly.
- Validate arguments at the top of public methods using
  `ArgumentNullException.ThrowIfNull(...)`,
  `ArgumentOutOfRangeException.ThrowIfNegativeOrZero(...)`, etc.
- Don't swallow exceptions. If a `catch` is needed, it logs at the
  right level and either rethrows or transforms into a domain
  exception.

### LINQ & collections
- LINQ is fine for clarity; do not chain it inside per-tick hot paths
  without measuring. The pricing kernel and matching engine are hot
  paths — write loops there.
- Prefer `IReadOnlyCollection<T>` / `IReadOnlyList<T>` over `IEnumerable<T>`
  on public APIs that callers will iterate more than once.

### Async
- The deterministic engine core is **synchronous**. Async lives at the
  edges: I/O (snapshot persistence, network) and orchestration. Do not
  smear `async`/`await` through `Tick()` and friends.

### Logging
- Use `Microsoft.Extensions.Logging` abstractions; do **not**
  `Console.WriteLine` from the engine. Tests may use the xUnit
  `ITestOutputHelper`.
- Log messages use compile-time templates (`logger.LogInformation("seed
  {Seed}", seed);`), not interpolation.

### Tests
- xUnit for everything. One test class per production type, mirroring
  the namespace; file name `<Type>Tests.cs`.
- `FluentAssertions` is allowed but not required; pick one style per
  test class and stick with it.
- Tests are arrange / act / assert, with one logical assertion group
  per test. Names read as sentences:
  `Tick_WhenMultiplePlayersJoined_LocksSpeedToOne`.
- Determinism tests: every RNG-consuming subsystem ships at least one
  test that asserts a known sequence of outputs for a fixed seed.
  Snapshot tests: round-trip + advance-N-ticks equality.
- Tests must not touch the network, real wall clock, or filesystem
  outside the test project's own output directory.

### Tooling
- `dotnet format` is the formatter of record. CI (when added) runs
  `dotnet format --verify-no-changes` and `dotnet build
  /warnaserror`.
- No third-party dependencies in the engine library beyond the BCL,
  `System.Text.Json`, and `Microsoft.Extensions.Logging.Abstractions`
  without explicit approval. Test-only dependencies (xUnit,
  FluentAssertions, etc.) are unrestricted.

## 9. Code-quality rules (binding)

These rules apply to every change, in every phase. They exist so the
codebase stays small, simple, and understandable by a novice C#
developer reading it for the first time.

### Minimal code
- Write the **smallest amount of code** that correctly solves the
  problem in front of you. No speculative APIs, no "we'll need it
  later" scaffolding, no parameters that nothing currently passes.
- Don't add a new class, interface, or layer unless something concrete
  needs it today. Inline it until a second caller appears.
- When you touch a file, **remove unnecessary code on sight**: dead
  branches, unused fields, commented-out blocks, duplicated helpers,
  TODOs that nobody is going to action. Note the removal in the PR
  description so the reviewer can sanity-check it.
- Prefer deleting code over adding code. A PR with a negative line
  count is a feature, not a bug.

### Simple, readable syntax
- The bar is **"a novice C# developer should be able to read this and
  understand what it does on the first pass."** If a line needs a
  paragraph of comments to explain its mechanics, rewrite the line.
- Prefer the **simple, reliable, easy-to-maintain solution** over the
  clever one. No micro-optimisations without a measured reason.
- Plain `if`/`for`/`switch` over chained LINQ when the loop reads more
  clearly. Local variables with meaningful names over nested
  expressions. One responsibility per method; short methods over long
  ones.
- Avoid surprising language features (custom operators, reflection
  tricks, source generators, `dynamic`, `unsafe`) unless there is no
  reasonable alternative and the alternative is documented in the PR.

### Comments explain *why*, not *what*
- Add a comment when the code's **reasoning** isn't obvious from the
  code itself: why this formula, why this ordering, why this guard,
  why we chose option A over option B, what invariant must hold.
- Don't restate the code (`// increment i`). Don't narrate the obvious.
- Public APIs get XML doc comments (`/// <summary>…</summary>`) that
  describe contract, units, and any determinism / threading
  constraints — not implementation detail.

### Always review impact on adjacent and dependent code
- Before you change a type, method, or file, **read what calls it and
  what it calls** (callers, overrides, tests, snapshot consumers,
  visibility map entries, `tuning.json` keys it depends on).
- If your change affects another file's behaviour, fix that file in
  the same PR (or, if intentionally out of scope, document why in the
  PR description).
- The PR description must contain a short **"Impact on adjacent code"**
  note listing every other file you reviewed and either: (a) what you
  changed there, or (b) why it didn't need to change.

### Always write tests, always run them
- Every new public behaviour ships with a test. Every bug fix ships
  with a test that fails before the fix and passes after.
- Tests live alongside the production code in `Wsr2.Engine.Tests`,
  follow the conventions in §8 *Tests*.
- Before declaring a slice done, run **all** of these locally and
  ensure they pass:

  ```bash
  cd engine
  dotnet build                        # warnings-as-errors must pass
  dotnet test                         # full xUnit suite must be green
  dotnet format --verify-no-changes   # no formatting drift
  ```

  Paste the test summary into the PR description as evidence. "I think
  it works" is not acceptable.

## 10. Phased build

The agreed build order is:

1. **Phase 0 — Foundations** 🔜: tuning loader, deterministic PRNG,
   role-based visibility, server-authoritative session/tick loop,
   snapshot/restore, admin-action gate.
2. **Phase 1 — Simulation engine** 🔜: macro environment, company
   fundamentals, pricing kernel.
3. **Phase 2** — instruments, order matching.
4. **Phase 3** — breakthrough events (data-driven from
   `tuning.breakthroughs.archetypes`).
5. **Phase 4** — networking / multiplayer transport.
6. **Phase 5** — UI.

Within Phase 1, fundamentals must land before the pricing kernel, since
the kernel reads fundamentals + macro.

## 11. Decisions baked in

(These are concrete settings, mostly mirrored in `tuning.json`. Listed
here so they aren't accidentally reverted.)

- 30-year default career (`time.defaultCareerYears = 30`,
  `ticksPerYear = 252`, `maxSimYears = 50` headroom).
- Two built-in roles: `Admin`, `Standard`.
- Player-feedback channel **enabled from day 1**
  (`feedback.playerWealthEffect.enabledFromDay1 = true`); strength
  scales with AUM share of total market cap, capped per
  `priceImpactCapBps`.
- Public leaderboard by default (`leaderboard.publicByDefault = true`).
- Breakthrough events are data, not code. Both seeded-random generation
  and admin injection are intended to be supported.

## 12. Process rules for agents

- Make **small, surgical changes**; one PR ≈ one slice from the phased
  plan. Keep the diff minimal (see §9 *Code-quality rules*).
- **Tests-run-and-pass gate.** Before declaring a slice done, run
  `dotnet build`, `dotnet test`, and `dotnet format
  --verify-no-changes` from `engine/` and confirm all three pass. Add
  tests for any new engine behaviour, especially determinism and
  snapshot round-trip. See §9 *Always write tests, always run them*.
- **Impact review in every PR.** Every PR description includes the
  "Impact on adjacent code" note required by §9; reviewers will reject
  PRs that change a type without acknowledging its callers.
- Do not delete or weaken determinism, visibility, or tunability tests.
- If the user says **"continue"**, continue from the next pending item
  in the most recent PR's checklist.
- Do not change these instructions without an explicit request. If the
  user gives a new standing constraint, add it here in the same PR.
