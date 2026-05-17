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

This section is the authoritative description of *what* the engine
computes each tick and *how* stock prices are produced. The numeric
magnitudes for everything below live in `tuning.json`; this section
defines the algorithms, ordering, units, and invariants that those
numbers feed into. Anything marked **TBD** has not yet been decided
by the project owner; do not invent a value, stop and ask.

### 10.1. Units and time

- One **tick** is the smallest unit of simulated time. The wall-clock
  cadence at 1x speed is `time.tickIntervalMsAt1x` milliseconds.
- One **simulated year** is `time.ticksPerYear` ticks (currently 252,
  matching real-world trading days). The default career length is
  `time.defaultCareerYears` (30 years = 7,560 ticks); the engine must
  remain stable for at least `time.maxSimYears` (50 years = 12,600
  ticks).
- Prices and cash are `double`. Percentages stored as decimals
  (`0.025` = 2.5 %). Basis points (`bps`) are 1/100 of a percent
  (`150 bps` = 1.50 %).
- All randomness comes from the session RNG (see section 2). Box-Muller
  is the chosen Gaussian sampler because it uses exactly two uniforms
  per pair of normals, which keeps the snapshot small (one buffered
  spare) and bit-exact across platforms.

### 10.2. Tick pipeline (fixed ordering)

`Session.Tick()` MUST execute exactly the following steps in this order
on every tick. The order is part of the deterministic contract; do not
reorder, parallelize, or skip steps without bumping the snapshot
`SchemaVersion`.

1. **Macro step.** `Macro.Step(rng)` advances the cycle clock and the
   five OU variables (see 10.3).
2. **Sector update.** Sector-level aggregates (earnings growth, rotation
   factor, sector P/E) are recomputed from the new macro state.
3. **Company fundamentals update.** Each company's TTM earnings,
   quality score, and fair-value prior are updated from macro + sector
   (see 10.4).
4. **Pricing kernel.** Each instrument's new price is produced from
   fundamentals + macro + queued order flow + active breakthrough
   impulses (see 10.5). The kernel applies the stability caps from
   `tuning.stability` as the final clamp.
5. **Order matching.** Pending orders are matched against the new
   price in their server-assigned `(seq, id)` order. (Phase 2
   onwards; in Phase 1 orders are queued but not yet matched.)
6. **Player-wealth feedback decay.** `company.playerImpactDecay`
   advances one tick (see 10.6).
7. **Breakthrough roll & decay.** Active breakthrough impulses decay;
   new breakthroughs may be rolled (10.7).
8. **Event log append.** Public and admin events generated during the
   tick are appended; the tick index advances by one.
9. **Optional snapshot.** Every `multiplayer.snapshotEveryTicks` ticks
   the session records a snapshot for replay and crash recovery.

### 10.3. Macro environment

The macro engine drives five slow-moving variables together with a
four-phase business cycle.

**Variables** (all stored in the macro state, all clamped to their
`tuning.macro.drift.<var>.min`..`max` range):

- `gdpGrowth` -- real GDP growth rate (annualised decimal)
- `inflation` -- CPI inflation rate (annualised decimal)
- `policyRate` -- central-bank short rate (annualised decimal)
- `creditSpread` -- corporate-bond credit spread over the policy rate
- `consumerSentiment` -- 0..1 index

**Cycle phases**, in order: `Expansion -> Peak -> Contraction ->
Trough -> Expansion -> ...` (`tuning.macro.cycle.phaseOrder`).

**Per-tick algorithm:**

1. Advance the cycle clock:
   - `ticksInPhase < minTicksPerPhase[phase]`: stay, draw no RNG.
   - `ticksInPhase >= maxTicksPerPhase[phase]`: force-roll to next
     phase, reset `ticksInPhase = 0`, emit `phaseRolled` event.
   - In between: draw one uniform `u` from the RNG and roll with
     probability `p = (ticksInPhase - min) / (max - min)`. This is a
     linear ramp -- cheap, deterministic, and avoids the long-tail
     problem of a flat Bernoulli trial. **The RNG draw happens on
     every tick inside the [min, max) window**, even when no roll
     occurs, so the RNG stream offset stays stable across phases.
2. For each variable `v`, perform one Ornstein-Uhlenbeck step using
   the spec at `tuning.macro.drift[v]` and the per-phase nudge at
   `tuning.macro.phaseBias[phase][v]`:

   ```text
   z = Normal(0,1) sampled via Box-Muller from the session RNG
   x_next = x + reversion * (mean - x) + phaseBias[phase][v] + vol * z
   x_next = clamp(x_next, min, max)
   ```

   Variables are iterated in the fixed order
   `[gdpGrowth, inflation, policyRate, creditSpread, consumerSentiment]`
   so each tick consumes the same number of normals in the same order.
3. Increment `ticksInPhase`.

**Snapshot fields:** `cyclePhase`, `ticksInPhase`, the five
variables, and the Box-Muller `spareNormal` (the buffered second
sample, or null). All required for bit-exact restore.

### 10.4. Company fundamentals

(Phase 1, not yet implemented. Locked-in contract:)

- Each company belongs to exactly one **sector**. Sector-level
  earnings growth and rotation factor are derived from macro state
  (e.g. cyclicals lead in Expansion, defensives lead in Contraction).
- Each company carries: `sectorId`, `ttmEarnings` (trailing twelve
  months), `qualityScore` (slow-moving 0..1), `sharesOutstanding`,
  `float`.
- A company's **fair-value prior** (`company.fairValue`) is recomputed
  every tick from TTM earnings, sector P/E, and a quality multiplier.
  This is a server-only field (visible to `Admin`, hidden from
  `Standard`); it anchors the pricing kernel's mean-reversion term.
- **TBD**: the exact fair-value formula and the quality-score update
  rule. When implementing, propose values and confirm with the
  project owner before merging; magnitudes go in `tuning.fundamentals`
  (a new section).

### 10.5. Pricing kernel (how stock prices are calculated)

The pricing kernel is the function that turns the world state into a
new price for every instrument on every tick. It MUST be deterministic
(same inputs + same RNG state always produce the same outputs) and
bit-exact across platforms.

**Inputs (read-only during the kernel step):**

- The new macro state from step 1 of the tick pipeline.
- The new sector aggregates from step 2.
- The company fundamentals from step 3, including `fairValue`.
- The pending order flow for this company this tick (count of buys
  and sells, total quantity, AUM behind each order).
- Any **active breakthrough impulse** on the company (one-time shock
  from 10.7 that decays over `tuning.breakthroughs.decay
  .defaultHalfLifeTicks` ticks).
- The previous tick's price and a short rolling history needed for
  the volatility estimate.

**Output:** the new mid-price for the instrument this tick.

**Required structure (the kernel MUST be a sum of these named
components, in this order, so the components remain attributable in
logs and tests):**

```text
returnComponents = [
    fundamentalDrift,      // pulls price toward fairValue
    macroShock,            // common factor from macro variable changes
    sectorShock,           // sector rotation / earnings update
    breakthroughImpulse,   // active breakthrough decay term
    orderFlowImpact,       // server-stamped queued orders this tick
    playerFeedback,        // see 10.6
    noise,                 // Gaussian residual from the session RNG
]
priceReturnRaw = sum(returnComponents)
priceReturn    = applyStabilityCaps(priceReturnRaw, company)
newPrice       = max(0.01, prevPrice * (1 + priceReturn))
```

**Stability caps** (final clamp, applied after summing all
components):

- Per-instrument per-day move clamped to +/- `stability
  .dailyMoveCapPct` (25 % today), or +/- `stability
  .eventDayDailyMoveCapPct` (60 %) if a breakthrough event is active
  on the company this tick.
- Sector-level total absolute return per tick clamped to `stability
  .sectorTickShockBudgetPct` (15 %); excess is proportionally trimmed
  across the sector's companies.
- Market-level total absolute return per tick clamped to `stability
  .marketTickShockBudgetPct` (8 %); excess proportionally trimmed
  market-wide.

The day-level cap is enforced as a running sum across the trading-day
window (`ticksPerYear / 252` ticks per day = 1 tick today, but the
cap is written against a day so the formula generalises if intraday
ticking is added later).

**Invariants:**

- Price never goes negative or zero; the floor is `0.01`.
- All RNG draws inside the kernel come from the session RNG, in a
  fixed order, on every tick (including ticks with no orders), so the
  stream offset stays stable.
- The kernel never reads wall-clock time, environment, or any state
  not listed above.

**TBD**: the exact coefficients on `fundamentalDrift`, `macroShock`,
`sectorShock`, `noise`, and the precise mapping from macro variable
changes to common-factor magnitude. These go in
`tuning.pricingKernel.*` (a new section); propose values and confirm
with the project owner before merging.

### 10.6. Player-wealth feedback channel

Enabled from day 1 (`feedback.playerWealthEffect.enabledFromDay1 =
true`). The intent is that very large players move markets, but never
enough to break the simulation.

**Per company, per tick** (after order flow is computed, before
stability caps):

```text
aumShare       = playerAumInCompany / companyMarketCap
flowAdd        = clamp(aumShareToFlowGain * aumShare,
                       0,
                       flowContributionCap)         // currently capped at 5 %
effectiveAdv   = baseAdv * (1 + flowAdd)            // ADV = average daily volume
impactBps      = priceImpactBpsPerAdvPct
               * (orderQuantity / effectiveAdv) * 100
impactBps      = clamp(impactBps, -priceImpactCapBps, +priceImpactCapBps)
playerFeedback = impactBps / 10000                  // bps -> decimal
```

`company.playerImpactDecay` is a short half-life accumulator (Admin-
visible) so a single big trade does not infinitely re-impact future
ticks. It decays one tick during step 6 of the pipeline.

**TBD**: `baseAdv` source (probably `sharesOutstanding * float *
turnover` with `turnover` in a new `tuning.fundamentals.turnover`
field). Confirm with the project owner.

### 10.7. Breakthrough events

Breakthrough events are **data, not code**. The set of archetypes
lives in `tuning.breakthroughs.archetypes`; the engine looks them up
by id and never hard-codes their behaviour.

**Lifecycle:**

1. **Generation.** On each company, on each tick, a Bernoulli trial
   with annual probability `tuning.breakthroughs
   .perCompanyAnnualProbability` (currently 2 %), converted to
   per-tick by dividing by `ticksPerYear`. Enabled when
   `seededRandomEnabled = true`. The RNG draw happens on every
   eligible (company, tick) pair so the stream offset is stable.
2. **Archetype selection.** Uniform over `archetypes` from the
   session RNG.
3. **Severity.** Drawn from `severityDistribution` (truncated Pareto,
   `alpha = 1.5`, `min = 0.1`, `max = 1.0`).
4. **Impulse construction.** The company's pricing-kernel input gets
   a `breakthroughImpulse` initialised to:

   ```text
   archetype.direction
       * lerp(archetype.minPct, archetype.maxPct, severity) / 100
   ```

   plus ripple effects on competitors (`rippleCompetitorsPct`) and
   suppliers (`rippleSuppliersPct`) defined per archetype.
5. **Decay.** Every tick, the active impulse multiplies by
   `0.5 ** (1 / decay.defaultHalfLifeTicks)` (currently
   `halfLife = 60` ticks). When the absolute value drops below an
   epsilon, the impulse is dropped.
6. **Caps.** The event-day cap (`stability
   .eventDayDailyMoveCapPct`, 60 %) replaces the normal day cap on
   companies with an active impulse so the breakthrough can actually
   move the price.
7. **Admin injection.** When
   `tuning.breakthroughs.adminInjectEnabled = true`, an Admin can
   inject `(archetypeId, companyId, severity)` directly; this skips
   generation and severity sampling but goes through the same
   impulse-construction code path. Logged in the event log.

**TBD**: the competitor/supplier graph that decides which companies
receive `rippleCompetitorsPct` / `rippleSuppliersPct`. Propose a
data structure (likely a per-company `relations: { competitors: [],
suppliers: [] }` block in a new `tuning.companies.*` section) and
confirm.

### 10.8. Role visibility (recap)

Pricing-kernel internals (e.g. `company.fairValue`,
`company.playerImpactDecay`, `company.floatHeldByPlayer`,
`session.rngCursor`) MUST be hidden from non-Admin roles per the
default `tuning.visibility.roles.Standard` map. Any new field added
to the kernel state in the future MUST be added to the visibility
map in the same PR (see section 5).

### 10.9. Snapshot contract

The snapshot must include everything required to advance the world
from that point and produce a byte-for-byte identical future. As of
schema v2 that is: `seed`, `rng cursor`, `tickIndex`, current/
requested `speed`, `nextOrderId`, `nextOrderSeq`, `players[]`,
`pendingOrders[]`, `macro` block (10.3), and the `eventLog`.

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
