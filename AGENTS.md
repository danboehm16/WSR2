# Agent instructions for WSR2

These are the standing rules for any agent (human or AI) making changes to
this repository. They capture decisions the project owner has made and that
must not be silently revisited. If a constraint here ever conflicts with a
short-term instruction, **stop and ask** rather than dropping the constraint.

> **Repo state:** the codebase has been deliberately reset. Only this file,
> [`README.md`](./README.md), [`tuning.json`](./tuning.json),
> [`.github/copilot-instructions.md`](./.github/copilot-instructions.md),
> and `.gitignore` are kept. There is **no** application code yet -- neither
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
      Wsr2.Engine/             # class library: tuning, rng, session, macro, ...
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
  `RuntimeHelpers.GetHashCode`, no PID, no thread id -- nothing ambient
  inside engine code. If you need a clock for telemetry, inject an
  `IClock` and keep it out of the deterministic core.
- Iteration order over hash-based collections (`Dictionary<,>`,
  `HashSet<>`) must not affect state. When the order matters, sort by a
  stable key (`OrderBy(x => x.Id, StringComparer.Ordinal)`) before
  using the result.
- **Order IDs and sequence numbers are server-assigned.** Never trust
  client-supplied IDs/sequences -- that's a multiplayer fairness exploit
  vector.
- Floating-point: prefer `double`; do not change rounding modes; avoid
  `Math.Fma` / SIMD intrinsics in the deterministic core unless you've
  proven cross-platform stability with tests.

## 3. Tunability (non-negotiable)

- All game-design constants -- magnitudes, probabilities, caps, phase
  bounds, role visibility map, breakthrough archetypes, speed policy,
  feedback gains, stability bounds -- live in **`tuning.json`** at the
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
- As soon as >=2 players are present, speed is **locked to 1x**
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
  paths -- write loops there.
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
- Public APIs get XML doc comments (`/// <summary>...</summary>`) that
  describe contract, units, and any determinism / threading
  constraints -- not implementation detail.

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
  follow the conventions in section 8 *Tests*.
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

## 10. Simulation model (design contract)

This section is the single authoritative description of *what* the
engine computes each tick and *how* a stock's price moves. Read it
top-to-bottom on first encounter:

- **10.1** sets the units, time, and randomness conventions.
- **10.2** names the steps that happen every tick and in what order.
- **10.3 - 10.4** describe the macro and fundamental inputs that the
  pricing kernel will read.
- **10.5** is the pricing kernel itself -- *the* place where stock
  prices are produced.
- **10.6 - 10.7** cover the two feedback channels: player order flow,
  and breakthrough events.
- **10.8 - 10.9** wrap up role visibility and the snapshot contract.

Magnitudes live in `tuning.json`. This section defines the algorithms,
units, and invariants that those numbers feed into. Two kinds of
unresolved item appear below:

- `[TBD]` -- a value or design choice that has *not* been made.
  **Do not invent it.** Stop and ask the project owner.
- `[TBD - illustrative]` -- a proposed functional shape, included so
  the model can be sanity-checked end-to-end. The shape itself still
  needs owner sign-off before any code is written.

### 10.1. Units, time, randomness

| Topic | Convention |
|---|---|
| Tick | The smallest unit of simulated time. Wall-clock cadence at 1x speed is `time.tickIntervalMsAt1x` ms (1000 ms today). |
| Year | `time.ticksPerYear` ticks (252, matching real trading days). Default career = 30 years = 7,560 ticks; the engine must stay stable for `time.maxSimYears` = 50 years = 12,600 ticks. |
| Money & price | Stored as `double`. |
| Percentages | Stored as decimals: `0.025` means 2.5 %. |
| Basis points | 1 bp = `0.0001` (= 0.01 %). 150 bp = `0.015`. |
| Returns | Per-tick fractional return: `newPrice = prevPrice * (1 + return)`. |
| Randomness | Every random draw comes from the session RNG (see section 2). Normals are sampled by classical Box-Muller (two uniforms produce two normals); the unused second sample is buffered in `spareNormal` so the snapshot stays small and bit-exact across platforms. |

### 10.2. Tick pipeline (fixed ordering)

`Session.Tick()` MUST execute exactly these nine steps in this order,
every tick. Reordering, parallelising, or skipping a step is a
breaking change: it requires bumping `SchemaVersion` and writing a
snapshot migration.

```text
                +-----------------------+
  tick start -->| 1. Macro step         |  reads:  macro state, RNG
                |                       |  writes: new macro state
                +-----------+-----------+
                            v
                +-----------------------+
                | 2. Sector update      |  reads:  macro
                |                       |  writes: sector aggregates
                +-----------+-----------+
                            v
                +-----------------------+
                | 3. Fundamentals       |  reads:  macro, sector
                |    update             |  writes: company.ttmEarnings,
                +-----------+-----------+          company.fairValue, ...
                            v
                +-----------------------+
                | 4. Pricing kernel     |  reads:  macro, sector,
                |                       |          fundamentals, pending
                |                       |          orders, active
                |                       |          breakthrough impulses,
                |                       |          RNG
                |                       |  writes: new mid-price per
                +-----------+-----------+          instrument
                            v
                +-----------------------+
                | 5. Order matching     |  (Phase 2+) match pending
                |                       |  orders against the new price
                |                       |  in (seq, id) order
                +-----------+-----------+
                            v
                +-----------------------+
                | 6. Feedback decay     |  tick down
                |                       |  company.playerImpactDecay
                +-----------+-----------+
                            v
                +-----------------------+
                | 7. Breakthrough roll  |  decay active impulses; maybe
                |    & decay            |  roll new breakthroughs (RNG)
                +-----------+-----------+
                            v
                +-----------------------+
                | 8. Append event log;  |
                |    tickIndex += 1     |
                +-----------+-----------+
                            v
                +-----------------------+
                | 9. Optional snapshot  |  every
                |                       |  multiplayer.snapshotEveryTicks
                +-----------------------+
```

The data flowing between steps is the same on every tick (no early
exits, no skipped subsystems), which is what makes the engine
deterministic and replayable.

### 10.3. Macro environment (step 1)

**Purpose.** Drive five slow-moving macro variables and a four-phase
business cycle so the rest of the engine has a coherent backdrop to
react to.

**State (all in `MacroState`):**

| Field | Meaning | Clamp range |
|---|---|---|
| `gdpGrowth` | Real GDP growth (annualised decimal) | `tuning.macro.drift.gdpGrowth.min..max` |
| `inflation` | CPI inflation (annualised decimal) | same pattern |
| `policyRate` | Central-bank short rate (annualised decimal) | same pattern |
| `creditSpread` | Corporate-bond spread over policy rate | same pattern |
| `consumerSentiment` | 0..1 index | same pattern |
| `cyclePhase` | One of `Expansion -> Peak -> Contraction -> Trough` | -- |
| `ticksInPhase` | Ticks since the current phase started | -- |
| `spareNormal` | Buffered second Box-Muller sample, or null | -- |

**Algorithm (per tick):**

1. **Advance the cycle clock.** Let `t = ticksInPhase`,
   `minT = minTicksPerPhase[phase]`, `maxT = maxTicksPerPhase[phase]`.
   - `t < minT`: stay in phase; **do not** draw the RNG.
   - `t >= maxT`: force-roll to the next phase, reset
     `ticksInPhase = 0`, emit a `phaseRolled` event.
   - Otherwise: draw one uniform `u` from the RNG and roll with
     probability `p = (t - minT) / (maxT - minT)`. The linear ramp
     is cheap, deterministic, and avoids the long-tail problem of a
     flat Bernoulli trial. The RNG draw happens on **every** tick
     inside the `[minT, maxT)` window, even when no roll occurs, so
     the RNG cursor advances the same number of steps regardless of
     phase outcome.

2. **OU step on each variable**, in fixed order
   `[gdpGrowth, inflation, policyRate, creditSpread, consumerSentiment]`:

   ```text
   z      = Normal(0, 1) via Box-Muller from the session RNG
   x_next = x
          + drift[v].reversion * (drift[v].mean - x)
          + phaseBias[phase][v]
          + drift[v].vol * z
   x_next = clamp(x_next, drift[v].min, drift[v].max)
   ```

   The fixed iteration order matters because it determines how many
   normals the macro step consumes per tick (= 5, plus possibly one
   uniform for the cycle roll). A stable budget keeps the RNG stream
   offset bit-exact across runs.

3. **Increment** `ticksInPhase += 1`.

**Outputs read by later steps.** Steps 2 and 3 read the whole new
`MacroState`. The pricing kernel (10.5) reads both the new state
*and* the previous tick's state so it can compute *changes*, not
levels.

**Snapshot contribution.** `cyclePhase`, `ticksInPhase`, the five
variables, and `spareNormal`. All required for bit-exact restore.

**Open questions.** None -- this is the only fully-specified
subsystem in section 10.

### 10.4. Company fundamentals (steps 2 - 3)

**Purpose.** Translate macro state into per-sector aggregates and
per-company fundamentals that the pricing kernel can mean-revert to.

**Per-company state after step 3:**

| Field | Meaning |
|---|---|
| `sectorId` | Which sector the company belongs to. |
| `ttmEarnings` | Trailing-twelve-month earnings, recomputed each tick from macro + sector. |
| `qualityScore` | Slow-moving `0..1` index of competitive position. |
| `sharesOutstanding`, `float` | Capital structure (also drive ADV in 10.6). |
| `fairValue` | The pricing kernel's mean-reversion anchor. Recomputed each tick from `ttmEarnings`, sector P/E, and a quality multiplier. Admin-visible only. |

**Per-sector aggregates after step 2:** `earningsGrowth`,
`rotationFactor` (e.g. cyclicals lead in `Expansion`, defensives lead
in `Contraction`), `pe`.

**Open questions** (all `[TBD]`, must be resolved with the project
owner before implementing):

- The exact `fairValue` formula. Sketch:
  `fairValue = sector.pe * ttmEarnings * qualityMultiplier(qualityScore)`,
  but `qualityMultiplier`, the sector-P/E response to macro, and the
  per-tick update rules for `ttmEarnings` and `qualityScore` are all
  undecided.
- Where the magnitudes go: a new `tuning.fundamentals.*` block.
- Whether sector aggregates carry their own internal state (e.g.
  rolling earnings momentum) or are recomputed stateless each tick.

### 10.5. Pricing kernel (step 4) -- how stock prices are calculated

**Purpose.** Turn the world state into one new mid-price per
instrument per tick. This is the heart of the simulation.

**One-sentence overview.** Each tick, for each stock, the kernel
sums seven named return components into a raw fractional return,
clamps that raw return through a three-stage stability pipeline, and
multiplies last tick's price by `(1 + clampedReturn)`.

**Inputs (read-only during the kernel step):**

- The new macro state from step 1, *and* the previous tick's macro
  state (so changes can be computed).
- The new sector aggregates from step 2.
- The company fundamentals from step 3, including `fairValue`.
- The pending orders for this company this tick (each carries
  `playerId`, `side`, `quantity`).
- Any active breakthrough impulse on the company (10.7).
- The previous tick's price.
- The session RNG.

**Output.** The new mid-price for the instrument this tick.

**Top-level formula:**

```text
priceReturnRaw =
      fundamentalDrift        # pull toward fairValue
    + macroShock              # common market-wide factor
    + sectorShock             # sector-specific factor
    + breakthroughImpulse     # active breakthrough, decaying
    + orderFlowImpact         # passive impact of queued orders
    + playerFeedback          # extra impact when big-AUM players trade
    + noise                   # Gaussian residual

priceReturn = applyStabilityCaps(priceReturnRaw, company)
newPrice    = max(0.01, prevPrice * (1 + priceReturn))
```

Components are summed in this fixed order so debug logs and tests
can attribute each tick's move to a named cause. Each component is
itself a signed fractional return (e.g. `+0.003` means "+0.30 % this
tick"; negative values pull the price down).

**The seven components in detail.** Each block gives purpose, sign
convention, illustrative shape, tuning key, and explicit `[TBD]`
flags for anything not yet decided by the project owner.

1. **`fundamentalDrift`** -- pulls price toward `company.fairValue`.
   - Sign: positive when `prevPrice < fairValue`.
   - Shape `[TBD - illustrative]`:
     `kFund * (log(fairValue) - log(prevPrice))`. Log-space keeps
     the pull proportional to mispricing in percent terms and never
     explosive.
   - Tuning: `tuning.pricingKernel.fundamentalDriftGain` (`kFund`)
     `[TBD]`.

2. **`macroShock`** -- one common factor shared by every stock this
   tick, driven by the *change* in macro variables.
   - Sign: depends on per-variable betas (a positive `gdpGrowth`
     surprise lifts the market; rising `creditSpread` weighs on it).
   - Shape `[TBD - illustrative]`:
     `sum_v ( betaMacro[v] * (macro[v] - prevMacro[v]) )` over the
     five macro variables.
   - Tuning: `tuning.pricingKernel.macroBeta[v]` (five betas)
     `[TBD]`.

3. **`sectorShock`** -- analogue of `macroShock` using the sector
   aggregates from step 2 (e.g. rising sector earnings growth lifts
   stocks in that sector).
   - Shape `[TBD - illustrative]`: weighted sum of deltas in sector
     aggregates, with per-sector betas.
   - Tuning: `tuning.pricingKernel.sectorBeta[sectorId]` `[TBD]`.

4. **`breakthroughImpulse`** -- whatever active impulse the
   breakthrough subsystem (10.7) has stamped on this company this
   tick. Already in fractional-return units. Decays geometrically
   each tick (see 10.7 step 5). No tuning key here; the impulse is
   data produced by 10.7.

5. **`orderFlowImpact`** -- *passive* impact of orders queued this
   tick on this company. This is the "even with no large players,
   buying pressure pushes the price up" term.
   - Inputs:
     `netSignedQty = sum over queued orders of (side == buy ? +qty : -qty)`,
     and the company's baseline `baseAdv` (see 10.6).
   - Sign: same as `netSignedQty` (net buys raise the price, net
     sells lower it).
   - Shape `[TBD - illustrative]`:
     `kFlow * sign(netSignedQty) * (|netSignedQty| / baseAdv) ** alpha`.
     `alpha < 1` damps the impact of very large orders so a single
     mega-order cannot break price stability on its own.
   - Tuning: `tuning.pricingKernel.orderFlowGain` (`kFlow`) and
     `tuning.pricingKernel.orderFlowExponent` (`alpha`) `[TBD]`.

6. **`playerFeedback`** -- additional impact when the queued orders
   come from players already holding a large share of this company's
   market cap. Full formula in 10.6. Bounded to
   `+/- feedback.playerWealthEffect.priceImpactCapBps` (150 bp =
   1.5 %) per tick.

7. **`noise`** -- mean-zero Gaussian residual that gives the price
   its tick-to-tick wiggle in the absence of news.
   - Shape: `kNoise * z`, where `z = Normal(0, 1)` from the session
     RNG via Box-Muller.
   - Tuning: `tuning.pricingKernel.noiseSigma` (`kNoise`, per-tick
     standard deviation in decimal units, e.g. `0.005` = 50 bp/tick)
     `[TBD]`.
   - **This is the only kernel component that consumes RNG**, and
     it consumes *exactly one* normal per company per tick -- every
     tick, every company, even if every other component were zero --
     so the RNG stream offset stays stable across runs.

**Stability caps -- a three-stage pipeline.** Applied to
`priceReturnRaw` in this order:

```text
1. Per-instrument cap
       cap_i = company.hasActiveBreakthrough
                 ? stability.eventDayDailyMoveCapPct / 100   # 0.60
                 : stability.dailyMoveCapPct / 100           # 0.25
       priceReturn_i = clamp(priceReturnRaw_i, -cap_i, +cap_i)

2. Per-sector budget
       sectorAbsSum = sum over companies in sector of |priceReturn_i|
       budget       = stability.sectorTickShockBudgetPct / 100  # 0.15
       if sectorAbsSum > budget:
           scale = budget / sectorAbsSum
           priceReturn_i *= scale     for all i in that sector

3. Per-market budget
       marketAbsSum = sum over all companies of |priceReturn_i|
       budget       = stability.marketTickShockBudgetPct / 100  # 0.08
       if marketAbsSum > budget:
           scale = budget / marketAbsSum
           priceReturn_i *= scale     for all i
```

The per-instrument cap is meant as a **per-trading-day** cap: keep a
running sum of intraday moves and never let it exceed `cap_i`. With
`ticksPerYear = 252` and one tick per trading day today, the running
sum equals the single tick's return, but the machinery generalises
if intraday ticking is added later.

**Invariants:**

- Price never reaches zero or goes negative; the floor is `$0.01`.
- The kernel only reads the state listed under *Inputs*. It MUST
  NOT read wall-clock time, environment, OS, or anything not in
  the snapshot.
- The kernel consumes exactly one normal per company per tick (the
  `noise` term). No conditional draws, no extra draws when orders
  are present.
- The seven components are summed in the listed order; even when a
  component is currently zero, its slot stays in the sum so future
  numbers reproduce.

**Worked sanity-check example.** All numbers are illustrative and
assume the `[TBD]` coefficients above. The point is to show the
*shape* of the calculation end-to-end, not to commit to any value.

Suppose for company ACME on tick `t`:

| Quantity | Value |
|---|---|
| `prevPrice` | 100.00 |
| `fairValue` | 102.00 |
| Active breakthrough? | no |
| `kFund` | 0.002 |
| Macro deltas | small positive surprise |
| Sector | neutral |
| Net order flow | small net buy |
| Big-AUM player involved? | no |
| `kNoise` | 0.005 |
| Box-Muller draw `z` | -0.42 |

Then:

```text
fundamentalDrift     ~ 0.002 * (ln(102) - ln(100))        ~ +0.000040  (+0.40 bp)
macroShock           ~ +0.0002                                          (+2 bp)
sectorShock          ~  0
breakthroughImpulse  =  0
orderFlowImpact      ~ +0.0003                                          (+3 bp)
playerFeedback       ~  0
noise                = 0.005 * -0.42                      = -0.00210    (-21 bp)
                                                            ----------
priceReturnRaw                                             ~ -0.00156   (-15.6 bp)
```

`|priceReturnRaw| << 0.25` so the per-instrument cap doesn't bind;
neither does the sector budget (15 %) nor the market budget (8 %).
Therefore `priceReturn ~ -0.00156` and
`newPrice ~ 100.00 * (1 - 0.00156) = 99.84`.

The reader should be able to follow the same calculation by hand for
any future tick and reach the engine's answer to within rounding.

**Open questions (must be resolved with the project owner before the
kernel can be implemented):**

- All illustrative coefficients: `kFund`, the five `betaMacro[v]`,
  per-sector `betaSector[sectorId]`, `kFlow`, `alpha`, `kNoise`.
- Confirmation (or rejection) of the proposed functional shapes
  above: log-space drift, linear macro/sector betas, power-law
  order-flow impact, scalar Gaussian noise.
- Where the coefficients live in `tuning.json`: a new
  `tuning.pricingKernel.*` block.
- Whether `orderFlowImpact` aggregates per-tick (Phase 1 friendly)
  or is computed per-order during matching (Phase 2 territory).

### 10.6. Player-wealth feedback (kernel component 6, in detail)

**Purpose.** Make very large players move markets noticeably more
than tiny players placing identical orders, but never enough to
break the simulation.

**Inputs (per company, per tick):**

- `playerAumInCompany` = sum over players of
  `player.sharesInCompany * prevPrice`.
- `companyMarketCap` = `sharesOutstanding * prevPrice`.
- `netSignedQty` -- same value used by `orderFlowImpact` (component
  5 in 10.5).
- `baseAdv` -- baseline average daily volume for the company.
  `[TBD]` (likely `sharesOutstanding * float * turnover`, with
  `turnover` in a new `tuning.fundamentals.turnover` field).

**Formula (current draft -- see *Open questions* below before
implementing):**

```text
aumShare       = playerAumInCompany / companyMarketCap
flowAdd        = clamp(aumShareToFlowGain * aumShare,
                       0,
                       flowContributionCap)           # capped at 0.05 (5 %)
effectiveAdv   = baseAdv * (1 + flowAdd)
impactBps      = priceImpactBpsPerAdvPct
                 * (netSignedQty / effectiveAdv) * 100
impactBps      = clamp(impactBps, -priceImpactCapBps, +priceImpactCapBps)
playerFeedback = impactBps / 10000                    # bps -> decimal
```

Tuning (already in `tuning.feedback.playerWealthEffect`):

| Key | Value | Meaning |
|---|---|---|
| `aumShareToFlowGain` | `0.5` | how strongly AUM share inflates ADV |
| `flowContributionCap` | `0.05` | max ADV inflation (5 %) |
| `priceImpactBpsPerAdvPct` | `8` | bp of impact per 1 % of ADV traded |
| `priceImpactCapBps` | `150` | per-tick impact cap (1.5 %) |

`company.playerImpactDecay` is a short half-life accumulator
(Admin-visible) so one big trade does not re-impact future ticks
indefinitely. It is ticked down in pipeline step 6.

**Open questions (flag for the project owner before implementing):**

- **Possible sign error.** With `effectiveAdv = baseAdv * (1 +
  flowAdd)`, larger player AUM **increases** the assumed ADV, which
  **decreases** `impactBps`. That is the opposite of the stated
  intent ("very large players move markets noticeably more").
  Confirm whether the divisor was meant to be `(1 - flowAdd)`, or
  whether `flowAdd` was meant to be applied to the numerator (the
  traded quantity) instead.
- **`baseAdv` source.** Probably
  `sharesOutstanding * float * turnover`, with `turnover` a new
  `tuning.fundamentals.turnover` field. Confirm.
- **Combination with component 5.** Today the kernel adds
  `orderFlowImpact + playerFeedback` (additive). The word
  "amplifier" suggests a multiplier on `orderFlowImpact` instead.
  Pick one; the choice changes the ceiling on player-driven moves.

### 10.7. Breakthrough events (step 7)

**Purpose.** Inject company-specific news shocks (positive or
negative) so prices move on more than just macro and noise.

Breakthrough events are **data, not code**. The set of archetypes
lives in `tuning.breakthroughs.archetypes`; the engine looks them up
by id and never hard-codes their behaviour.

**Lifecycle (per company, per tick):**

1. **Generation.** Bernoulli trial with per-tick probability
   `tuning.breakthroughs.perCompanyAnnualProbability / ticksPerYear`
   (`0.02 / 252` today). Enabled when `seededRandomEnabled = true`.
   The RNG draw happens for *every* eligible `(company, tick)` pair
   so the stream offset stays stable, regardless of how many events
   actually fire.
2. **Archetype selection.** Uniform over `archetypes` from the
   session RNG.
3. **Severity.** Drawn from `severityDistribution` (truncated
   Pareto, `alpha = 1.5`, `min = 0.1`, `max = 1.0`).
4. **Impulse construction.** Create a `breakthroughImpulse` for the
   target company:

   ```text
   impulse = archetype.direction
             * lerp(archetype.minPct, archetype.maxPct, severity) / 100
   ```

   plus parallel ripple impulses on competitors
   (`rippleCompetitorsPct`) and on suppliers
   (`rippleSuppliersPct`), constructed by the same formula.
5. **Decay.** Each tick, every active impulse multiplies by
   `0.5 ** (1 / decay.defaultHalfLifeTicks)` (half-life = 60
   ticks). When `|impulse|` falls below an epsilon, drop it.
6. **Caps.** The event-day cap
   (`stability.eventDayDailyMoveCapPct`, 60 %) replaces the normal
   day cap on companies with an active impulse, so the breakthrough
   can actually move the price.
7. **Admin injection.** When `adminInjectEnabled = true`, an Admin
   may inject `(archetypeId, companyId, severity)` directly. This
   skips generation and severity sampling but goes through the same
   impulse-construction code path. Logged in the event log.

**Open questions:**

- The competitor/supplier graph that decides which companies receive
  `rippleCompetitorsPct` / `rippleSuppliersPct` is `[TBD]`. Likely a
  per-company `relations: { competitors: [...], suppliers: [...] }`
  block in a new `tuning.companies.*` section; confirm with the
  project owner.

### 10.8. Role visibility (recap)

Pricing-kernel internals -- `company.fairValue`,
`company.playerImpactDecay`, `company.floatHeldByPlayer`,
`session.rngCursor`, etc. -- MUST be hidden from non-Admin roles per
`tuning.visibility.roles.Standard`. Any new field added to the
kernel state in the future MUST be added to the visibility map in
the same PR (see section 5).

### 10.9. Snapshot contract

The snapshot must contain everything required to advance the world
from that point and produce a byte-for-byte identical future. As of
schema v2 that is: `seed`, `rng cursor`, `tickIndex`, current and
requested `speed`, `nextOrderId`, `nextOrderSeq`, `players[]`,
`pendingOrders[]`, the `macro` block (see 10.3), and the `eventLog`.

Adding pricing-kernel state (per-company price history, active
breakthrough impulses, player-impact decay accumulators) requires
bumping `SchemaVersion` and writing a migration from v2 that
re-seeds from `tuning.*.initial` -- never silently dropping data
(see section 7).

## 11. Phased build

The agreed build order is:

1. **Phase 0 -- Foundations**: tuning loader, deterministic PRNG,
   role-based visibility, server-authoritative session/tick loop,
   snapshot/restore, admin-action gate.
2. **Phase 1 -- Simulation engine**: macro environment, company
   fundamentals, pricing kernel.
3. **Phase 2** -- instruments, order matching.
4. **Phase 3** -- breakthrough events (data-driven from
   `tuning.breakthroughs.archetypes`).
5. **Phase 4** -- networking / multiplayer transport.
6. **Phase 5** -- UI.

Within Phase 1, fundamentals must land before the pricing kernel, since
the kernel reads fundamentals + macro (see section 10.2).

## 12. Decisions baked in

(These are concrete settings, mostly mirrored in `tuning.json`. Listed
here so they aren't accidentally reverted.)

- 30-year default career (`time.defaultCareerYears = 30`,
  `ticksPerYear = 252`, `maxSimYears = 50` headroom).
- Two built-in roles: `Admin`, `Standard`.
- Player-feedback channel **enabled from day 1**
  (`feedback.playerWealthEffect.enabledFromDay1 = true`); strength
  scales with AUM share of total market cap, capped per
  `priceImpactCapBps`. Full formula in section 10.6.
- Public leaderboard by default (`leaderboard.publicByDefault = true`).
- Breakthrough events are data, not code. Both seeded-random generation
  and admin injection are intended to be supported. Lifecycle in
  section 10.7.
- Tick pipeline ordering is locked (section 10.2); reordering requires
  a `SchemaVersion` bump.
- Stability caps (`stability.dailyMoveCapPct = 25`,
  `eventDayDailyMoveCapPct = 60`, `sectorTickShockBudgetPct = 15`,
  `marketTickShockBudgetPct = 8`) are the final clamp on every price
  return (section 10.5).

## 13. Process rules for agents

- Make **small, surgical changes**; one PR ~ one slice from the phased
  plan. Keep the diff minimal (see section 9 *Code-quality rules*).
- **Tests-run-and-pass gate.** Before declaring a slice done, run
  `dotnet build`, `dotnet test`, and `dotnet format
  --verify-no-changes` from `engine/` and confirm all three pass. Add
  tests for any new engine behaviour, especially determinism and
  snapshot round-trip. See section 9 *Always write tests, always run them*.
- **Impact review in every PR.** Every PR description includes the
  "Impact on adjacent code" note required by section 9; reviewers will reject
  PRs that change a type without acknowledging its callers.
- Do not delete or weaken determinism, visibility, or tunability tests.
- **Do not invent simulation magnitudes or pricing-kernel coefficients.**
  Anything marked **TBD** in section 10 must be confirmed with the
  project owner before implementation. Add the agreed value to
  `tuning.json` (never hard-code it) in the same PR.
- If the user says **"continue"**, continue from the next pending item
  in the most recent PR's checklist.
- Do not change these instructions without an explicit request. If the
  user gives a new standing constraint, add it here in the same PR.
