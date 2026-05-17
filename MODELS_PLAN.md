# WSR2 data-model plan -- Company, Sector, Market, Global

This file is the **plan for the engine's data models**: the fields and
properties that the future C# types for **Company**, **Sector**,
**Market**, and the surrounding **Session / global** state will carry.
It is written to slot directly into the pricing model already documented
in [`AGENTS.md`](./AGENTS.md) section 10 and explained in plain English
in [`PRICING_MODEL.md`](./PRICING_MODEL.md).

**This file is a plan, not a contract.** The authoritative design
contract is `AGENTS.md` section 10; if anything here ever disagrees with
section 10, section 10 wins -- please open a PR to fix this file. No
code has been written from this plan yet; it exists so the next coding
slice can move straight to implementation without re-deriving the
schema.

**Scope of "models" here.** This document covers the *state shapes*
(records, fields, units, lifecycles, visibility, snapshot inclusion)
needed to run the 7-step tick pipeline. It does **not** redefine the
pricing kernel, the macro algorithm, the breakthrough lifecycle, or any
formulas -- those live in `AGENTS.md` §10 and `PRICING_MODEL.md`.

---

## Table of contents

1. [How this plan fits the pricing model](#1-how-this-plan-fits-the-pricing-model)
2. [Guiding principles (binding)](#2-guiding-principles-binding)
3. [Company -- the full field set](#3-company----the-full-field-set)
4. [Sector -- the full field set](#4-sector----the-full-field-set)
5. [Market -- a container, not a new entity](#5-market----a-container-not-a-new-entity)
6. [Session / global state -- what Company touches](#6-session--global-state----what-company-touches)
7. [Cross-cutting types Company depends on](#7-cross-cutting-types-company-depends-on)
8. [`tuning.json` schema additions (`fundamentals`)](#8-tuningjson-schema-additions-fundamentals)
9. [Visibility map deltas](#9-visibility-map-deltas)
10. [Snapshot impact and schema bump](#10-snapshot-impact-and-schema-bump)
11. [What this plan deliberately does NOT add](#11-what-this-plan-deliberately-does-not-add)
12. [Open TBDs for the project owner](#12-open-tbds-for-the-project-owner)
13. [Implementation order (when owner greens this plan)](#13-implementation-order-when-owner-greens-this-plan)

---

## 1. How this plan fits the pricing model

The pricing kernel (`AGENTS.md` §10.5) sums **five named return
components** -- `fundamentalDrift`, `moodShock`, `breakthroughImpulse`,
`impact`, `noise` -- into one fractional return per company per tick,
clamps that return by a **single per-instrument stability cap**
(§10.5, 25 % normal / 60 % event-day), and multiplies last tick's
price by `(1 + clampedReturn)`. Every input the kernel reads must be
sourced either from a `Company`, a `Sector`, the `MacroState`, the
session's pending orders, the session's players, or `tuning.json`.

The models below are the **minimum** shape that makes that work:

| Kernel input | Comes from |
|---|---|
| `prevPrice` | `Company.price` at the start of the tick |
| `fairValue` (anchor for `fundamentalDrift`) | derived `Company.fairValue` = `baseFairValue * sectorScalar` |
| `marketMood`, `prevMarketMood` (drives `moodShock`) | `MacroState.marketMood` + the previous tick's value held by the session |
| `breakthroughImpulse` | `Company.breakthroughImpulse` (decays in place) |
| `netSignedQty`, `baseAdv`, `aumShare` (drive `impact`) | `Session.pendingOrders[companyId]`, `Company.sharesOutstanding`, `Session.players[].positions` |
| `z` (drives `noise`) | one Box-Muller normal from the session RNG, every company every tick |
| stability cap selector | `Company.hasActiveBreakthrough` (derived from `breakthroughImpulse`) |

If any field below feels speculative, trace it back through this table
-- everything here is consumed by the kernel, the impact term, the
breakthrough lifecycle, or by snapshot/restore. There are no
"we might want this later" fields.

---

## 2. Guiding principles (binding)

These come directly from `AGENTS.md` and are repeated here as a
reminder, not redefined:

1. **Determinism.** No RNG outside the session RNG. No ambient clocks.
   Iteration over any hash-based collection MUST be sorted by a stable
   key (e.g. `Company.id` with `StringComparer.Ordinal`) before any
   RNG-consuming loop. (`AGENTS.md` §2)
2. **Tunability.** Every magnitude lives in `tuning.json`. No
   hard-coded numbers in code. (`AGENTS.md` §3)
3. **Server-authoritative.** IDs and sequence numbers come from the
   server. Clients never set them. (`AGENTS.md` §4)
4. **Visibility deny-by-default.** Every new field that ever leaves
   the server must be added to `tuning.visibility.roles` in the same
   change. Unknown fields and unknown roles are HIDDEN. (`AGENTS.md` §5)
5. **Snapshots bit-exact.** Adding a stored field requires a
   `SchemaVersion` bump plus a migration that re-derives missing
   values from `tuning.*.initial` or an equivalent default. Never
   silently drop data. (`AGENTS.md` §7, §10.9)
6. **Minimal code, novice-readable.** No speculative APIs, no
   placeholder fields, no fields that nothing currently reads.
   (`AGENTS.md` §9)

Every field below is justified against principle 6 by naming the kernel
component, lifecycle step, or snapshot need that consumes it.

---

## 3. Company -- the full field set

Grouped by **lifecycle** (when the field is written) so it is obvious
which fields live in `tuning.json`, which live in session memory, and
which appear in the snapshot.

### 3.1 Identity -- immutable, loaded once from `tuning.fundamentals.companies[*]`

| Field | Type | Units | Source | Visibility | Notes |
|---|---|---|---|---|---|
| `id` | `string` (e.g. `"ACME"`) | -- | tuning | Standard | Stable key. Used for ordering, snapshots, event log, FK references. Compared with `StringComparer.Ordinal`. |
| `displayName` | `string` | -- | tuning | Standard | Human-readable; never used as a key. |
| `sectorId` | `string` (FK to `Sector.id`) | -- | tuning | Standard | Required; loader validates referential integrity. |
| `description` | `string?` | -- | tuning | Standard | Optional flavour; engine never reads it. |

### 3.2 Static fundamentals -- immutable per session, loaded from tuning

| Field | Type | Units | Source | Visibility | Notes |
|---|---|---|---|---|---|
| `sharesOutstanding` | `long` | shares | tuning | Standard | Drives `baseAdv` (§10.6) and `companyMarketCap`. Must be > 0. |
| `baseFairValue` | `double` | $/share | tuning | **Admin only** | Per-company anchor. The kernel never lets price drift far from `fairValue` = `baseFairValue * sectorScalar`. Must be > 0. |
| `initialPrice` | `double?` | $/share | tuning | Standard | Optional opening price. If absent, the loader seeds `price = fairValue`. Visible because the opening tape is something every player sees on tick 0. **Caveat:** when `initialPrice` is absent, exposing the seeded `price` on tick 0 transitively reveals `fairValue` (and therefore `baseFairValue` once `sectorScalar` is known). Designers who want to hide `fairValue` should always set an explicit `initialPrice` that differs from it. Owner sign-off on this trade-off is item §12.3 below. |
| `relations.competitors` | `string[]` (FKs to `Company.id`) | -- | tuning | **Admin only** | Targets for `rippleCompetitorsPct` (§10.7). Empty list = no competitor ripple. **Seed data is TBD per `AGENTS.md` §10.7.** |
| `relations.suppliers` | `string[]` (FKs to `Company.id`) | -- | tuning | **Admin only** | Targets for `rippleSuppliersPct` (§10.7). Same rules as competitors. |

> *Why competitors/suppliers live on `Company`, not on a separate graph
> type:* the only consumer is the breakthrough ripple, which already
> iterates per-company. Inlining keeps the data next to its consumer.
> A richer relationship type can be added later without breaking these
> fields.

### 3.3 Per-tick derived state -- recomputed each tick, **not** snapshotted

These exist as cheap helpers so the kernel can read one named value
instead of recomputing inline. Because they are pure functions of
already-snapshotted state, the snapshot does not need to store them.

| Field | Type | Units | Derivation | Visibility | Notes |
|---|---|---|---|---|---|
| `fairValue` | `double` | $/share | `baseFairValue * sectorScalar` | **Admin only** | Recomputed each tick so designers can retune `sectorScalar` mid-session. |
| `companyMarketCap` | `double` | $ | `sharesOutstanding * price` at tick start | Standard | Needed by the impact term's `aumShare` numerator. |
| `baseAdv` | `double` | shares/tick | `sharesOutstanding * tuning.impact.baseAdvFraction` | Standard | Constant per session today; cached once at load. Denominator of the impact term. |
| `hasActiveBreakthrough` | `bool` | -- | `|breakthroughImpulse| > epsilon` | **Admin only** | Selects the 60 % event-day cap instead of 25 %. `epsilon` is a small constant (e.g. `1e-9`) defined alongside the kernel. |

### 3.4 Mutable per-tick state -- lives in memory, **must** snapshot

| Field | Type | Units | Source | Visibility | Snapshot? | Notes |
|---|---|---|---|---|---|---|
| `price` | `double` | $/share | pricing kernel step 3 | Standard | yes | Mid-price. Floor of `$0.01` applied every tick (`AGENTS.md` §10.5). |
| `volume` | `long` | shares | order-matching step 4 | Standard | yes | Cumulative shares traded over the session. Stays `0` until Phase 2 (matching) lands. |
| `volumeThisTick` | `long` | shares | order-matching step 4 | Standard | no (ephemeral) | Useful for UI / event log; reset to `0` at the start of every tick. **Ephemeral**, not derived: on snapshot restore it is simply re-initialised to `0` (it will be repopulated on the next tick's matching step). It is not a cached function of other snapshotted state. |
| `breakthroughImpulse` | `double` | fractional return | breakthrough step 5 (constructed); decays each tick | **Admin only** | yes (omit when 0) | Already in fractional-return units. Decay multiplier per tick: `0.5^(1 / decay.defaultHalfLifeTicks)`. |

`prevPrice` is **not** a stored field on `Company`. The kernel reads
the current `price` at the start of step 3 (before writing the new
one), uses it as the previous price for the `(1 + return)` formula,
and only then assigns the new price. Keeping a separate `prevPrice`
field would duplicate state and risk the two getting out of sync.

### 3.5 Per-tick *transient* working memory -- never stored

These do **not** belong on the persistent `Company` record. They are
locals inside the kernel call and are listed here only so they are not
accidentally promoted to fields:

- `netSignedQty`, `aumShare`, `playerAumInCompany`, `whaleBonus`, `impactBps`
- the five named return components (`fundamentalDrift`, `moodShock`, `breakthroughImpulse` *as used in the sum*, `impact`, `noise`)
- `priceReturnRaw`, `priceReturn`
- the Box-Muller normal draw `z`

All five are recomputed every tick. Storing them would bloat the
snapshot for zero benefit.

---

## 4. Sector -- the full field set

The 2026-05-17 simplifications (`AGENTS.md` §13.4) collapsed sectors
to one knob each, so the type is intentionally tiny.

| Field | Type | Units | Source | Visibility | Snapshot? | Notes |
|---|---|---|---|---|---|---|
| `id` | `string` (e.g. `"tech"`) | -- | tuning | Standard | no (immutable) | Stable FK target for `Company.sectorId`. Compared with `StringComparer.Ordinal`. |
| `displayName` | `string` | -- | tuning | Standard | no | UI only. |
| `sectorScalar` | `double` | unitless | tuning | Standard | see note | Multiplier into `Company.fairValue`. **Snapshot rule (binding):** because `sectorScalar` directly drives `fairValue`, and `fairValue` is what the kernel mean-reverts toward, the *effective* `sectorScalar` for every sector MUST be included in the snapshot. Otherwise a bit-exact restore would require the consumer to also have the exact same `tuning.json` (including any mid-session admin retunes), which violates the snapshot self-sufficiency rule in `AGENTS.md` §7. The recommended shape is a small `sectors: { [id]: { sectorScalar } }` map inside the snapshot, written on every snapshot (cheap -- one double per sector). Mid-session admin retunes append a `sectorScalarChanged` entry to the event log so the change is auditable. |

There is **no** per-tick sector state -- no `earningsGrowth`, no
`rotationFactor`, no `sectorPE`. All dropped in §13.4.

---

## 5. Market -- a container, not a new entity

"Market" is just the **set of all `Company` records this session**,
plus a couple of session-scoped invariants. It is **not** a new
top-level type; it is the part of the session that holds the lookup
maps. Modelling it as a separate type would add an indirection with no
behaviour to attach to it.

| Member | Type | Notes |
|---|---|---|
| `companiesById` | `ImmutableDictionary<string, Company>` (key comparer `StringComparer.Ordinal`) | Read-only after load. Iteration order MUST NOT leak into state -- always go through `companyIdsInIterationOrder` for any RNG-touching loop. |
| `sectorsById` | `ImmutableDictionary<string, Sector>` (key comparer `StringComparer.Ordinal`) | Same rules. |
| `companyIdsInIterationOrder` | `ImmutableArray<string>` | Cached `OrderBy(id, Ordinal)` view. Single source of truth for "iterate every company this tick" (kernel step 3, breakthrough step 5). Using the same array everywhere is what keeps the RNG cursor in the same place every run. |
| `priceFloor` | `double` (from `tuning.pricingKernel.priceFloor`, default `0.01`) | Per `AGENTS.md` §3 every magnitude lives in `tuning.json`; the price floor is no exception even though designers will rarely change it. The kernel reads it via the tuning object, not as a hard-coded constant. Add it to the new `tuning.pricingKernel` block proposed in `AGENTS.md` §10.5. |

There is **no aggregate "Market" return** held as state. The
2026-05-17 cap simplification removed the per-market budget. The UI
may derive a market index from `sum(price * sharesOutstanding)`, but
the engine does not.

---

## 6. Session / global state -- what Company touches

Already defined by `AGENTS.md` §10.9; listed here only to confirm the
Company / Sector schema slots in cleanly and no new global fields are
required.

| Existing global | How Company touches it |
|---|---|
| `Session.seed`, `Session.rngCursor` | One RNG per session. Company never owns its own RNG. |
| `Session.tickIndex` | Stamped into event-log entries the company emits (e.g. `breakthroughFired`, `priceFloored`). |
| `MacroState.marketMood` + previous tick's value | Read by the kernel for `moodShock`. The session keeps the previous tick's value (one `double`) so the kernel can compute the delta without companies storing it. |
| `Session.players[].positions` | The only place per-company holdings live. The impact term reads `sum over players of (player.sharesIn(company.id) * prevPrice)` -- Company itself stores no holder list. |
| `Session.pendingOrders[]` | Indexed by `companyId` at the start of the kernel step. The order book lives on the session. |
| `Session.eventLog[]` | Where Company-related events (`priceFloored`, `breakthroughFired`, ripple targets, admin injections) get appended. Company never owns its own log. |

Confirmed: with the schema above, **no new global state** is required
to bring the kernel up.

---

## 7. Cross-cutting types Company depends on

These don't belong to Company but show up in its public API surface
and must exist for it to be usable. They are listed here so the next
slice knows they need to be defined alongside Company:

- **`OrderSide`** enum: `Buy`, `Sell`. Implied by §10.6's sign
  convention.
- **`Order`** record: `{ long Id, long Seq, string PlayerId, string CompanyId, OrderSide Side, long Quantity }`. `Id`
  and `Seq` are server-assigned (§4).
- **`PlayerPosition`** record: `{ string CompanyId, long Shares, double AverageCostBasis }`.
  Company itself does not need to know about positions; the impact
  term walks `Session.players[]` once per tick and computes
  `playerAumInCompany` on the fly. No per-company holder cache needed.
- **`BreakthroughImpulseDelta`** record (transient): emitted by §10.7
  step 4 onto target + competitor + supplier companies during the
  breakthrough step. Lives only inside the breakthrough subsystem.

If any of these end up needing more fields when their owning subsystem
lands, add them then -- not speculatively now.

---

## 8. `tuning.json` schema additions (`fundamentals`)

`AGENTS.md` §10.4.1 flags a new top-level `fundamentals` block that
does not exist in `tuning.json` yet. The proposed shape:

```jsonc
"fundamentals": {
  "sectors": [
    { "id": "...", "displayName": "...", "sectorScalar": 0.0 },
    ...
  ],
  "companies": [
    {
      "id": "...",
      "displayName": "...",
      "sectorId": "...",
      "sharesOutstanding": 0,
      "baseFairValue": 0.0,
      "initialPrice": 0.0,                // optional; defaults to fairValue
      "relations": {                       // optional; defaults to empty arrays
        "competitors": [ "..." ],
        "suppliers":   [ "..." ]
      }
    },
    ...
  ]
}
```

The loader (`Wsr2.Engine.Tuning`) must:

- Reject duplicate `sectors[].id` and duplicate `companies[].id`.
- Validate every `companies[].sectorId` resolves to a known
  `sectors[].id`.
- Validate every entry in `companies[].relations.competitors` and
  `companies[].relations.suppliers` resolves to a known
  `companies[].id`; reject self-references.
- Reject `sharesOutstanding <= 0` and `baseFairValue <= 0`.
- Reject `initialPrice <= 0` when present.
- Reject `sectorScalar <= 0`. Two distinct failure modes are both
  unacceptable: a negative scalar flips the sign of `fairValue` (so
  `fundamentalDrift` pushes price away from any sensible anchor),
  and a zero scalar makes `fairValue = 0` (which makes the log-space
  drift `log(fairValue) - log(prevPrice)` evaluate to `-Infinity`
  and corrupts the whole kernel for that company).
- Sort both arrays by `id` (`StringComparer.Ordinal`) before exposing
  them, so iteration order is independent of file order.
- Fail fast with a dedicated `TuningException` (one actionable message
  per problem) -- never throw bare `Exception`, never swallow
  `JsonException`.

These validations are why the new fields are listed with units and
ranges above: the loader is the single place where invariants are
checked, and it can only check what we name.

---

## 9. Visibility map deltas

`tuning.visibility.roles` currently covers existing fields
(`macro.marketMood`, `company.price`, `company.baseFairValue`, etc.).
Add the following entries in the same PR that lands these models, so
nothing leaks by accident:

| Field | `Admin` | `Standard` |
|---|---|---|
| `company.id` | true | true |
| `company.displayName` | true | true |
| `company.sectorId` | true | true |
| `company.initialPrice` | true | true |
| `company.relations.competitors` | true | **false** |
| `company.relations.suppliers` | true | **false** |
| `company.breakthroughImpulse` | true | **false** |
| `company.hasActiveBreakthrough` | true | **false** |
| `company.companyMarketCap` | true | true (derived from two public values) |
| `company.baseAdv` | true | true (derived from one public value and a public constant) |
| `sector.id` | true | true |
| `sector.displayName` | true | true |
| `sector.sectorScalar` | true | true (unchanged from today) |

Already present (no change needed):
`company.price`, `company.volume`, `company.sharesOutstanding`,
`company.baseFairValue` (Admin only), `company.fairValue` (Admin only).

Hiding `relations.*` from Standard closes an obvious metagaming
loophole ("the supplier list tells me which company a breakthrough
will ripple to before it fires"). Hiding `breakthroughImpulse` and
`hasActiveBreakthrough` keeps the event-day cap an *inference*
players draw from price action, not a directly-readable flag.

---

## 10. Snapshot impact and schema bump

Per `AGENTS.md` §10.9, the snapshot already names per-company
`breakthroughImpulse`. Adding the Company schema above requires
storing only:

- `price` (one `double` per company)
- `volume` (one `long` per company)
- `breakthroughImpulse` (one `double` per company, **omitted when 0**)
- `sectorScalar` per sector (one `double` per sector -- see §4 note;
  required so a snapshot is self-sufficient when an Admin has
  retuned a sector mid-session)

Everything else is either **immutable** (loaded from tuning) or
**derived** (`fairValue`, `companyMarketCap`, `baseAdv`,
`hasActiveBreakthrough`). The snapshot footprint per company is
therefore roughly `8 + 8 + (0 | 8)` bytes plus the `id` -- small even
with thousands of companies.

**Schema bump rules (binding).** Adding stored per-company fields
requires:

1. Bumping `SessionSnapshot.SchemaVersion`.
2. Writing a migration from the previous version. For companies
   absent from an old snapshot, re-seed:
   - `price = fairValue` (= `baseFairValue * sectorScalar`)
   - `volume = 0`
   - `breakthroughImpulse = 0`
3. Restoring an unknown future version MUST throw (§7).

The migration tests must round-trip an old-format snapshot through
the new code and assert that advancing N ticks produces a
bit-for-bit identical snapshot to advancing the freshly-seeded
session N ticks. (Parity-test pattern -- see the Rng port.)

---

## 11. What this plan deliberately does NOT add

These are listed so a future reviewer can see they were considered and
rejected, not forgotten. All cuts come from the 2026-05-17
simplifications (`AGENTS.md` §12, §13; `PRICING_MODEL.md` §13).

- **No earnings, P/E, dividends, splits, buybacks** -- out of scope
  per §13.4.
- **No quality score, sector P/E curve, sector-rotation factor** --
  dropped in §13.4.
- **No `playerImpactDecay` accumulator on Company** -- dropped in
  §13.5 alongside the two-channel impact split. The single-term
  `impact` reads current orders only.
- **No market-wide or sector-wide stability budgets** -- dropped in
  §13.7. The per-instrument cap is the only safety net.
- **No new RNG streams** -- one session RNG remains the only source
  of randomness (§2).
- **No `prevPrice` field on Company** -- the kernel reads `price`
  before overwriting it (see §3.4).
- **No async APIs on Company** -- the engine core is synchronous
  (`AGENTS.md` §8 *Async*).
- **No per-company event log** -- events are appended to the shared
  `Session.eventLog`.
- **No holder list on Company** -- positions live on
  `Session.players[].positions` and are walked once per tick.

---

## 12. Open TBDs for the project owner

None of these block defining the schema. They block **populating**
it with seed data, and a few of them shape a small modelling choice
that is easier to lock in before code lands.

1. **Seed list** -- which sectors and which companies; their
   `sectorScalar`, `baseFairValue`, `sharesOutstanding`,
   `initialPrice`. **Content decision, owner-owned** per `AGENTS.md`
   §10.4.1. This same item also resolves the §10.7 TBD that the
   competitor/supplier graph is "likely a per-company `relations`
   block" -- §3.2 above commits to that location; this TBD is now
   only about the *contents* of that graph, not its shape.
2. **Symmetry of `relations`.** If A lists B as a competitor, must B
   list A? Default proposal: **not enforced** -- designers can
   express asymmetric narrative relationships ("the disruptor knows
   about the incumbent; the incumbent doesn't yet"). Owner sign-off
   needed.
3. **`initialPrice` exposure.** Expose this knob (some games want a
   "stock IPO'd today" feel), or always start at `fairValue`?
   Recommendation: expose it as an *optional* field as above.
   **Trade-off**: when omitted, the published opening price equals
   `fairValue`, which transitively leaks the Admin-only anchor on
   tick 0. Designers who want to hide the anchor should always set
   `initialPrice` explicitly.
4. **Ripple severity semantics.** `AGENTS.md` §10.7 step 4 says
   "competitors get `rippleCompetitorsPct`, suppliers get
   `rippleSuppliersPct`", but does the *severity* multiplier applied
   to the ripple equal the target's severity, a scaled-down version,
   or a separate roll? Confirm before the breakthrough subsystem
   lands.
5. **Volume model in Phase 1.** Should `Company.volume` stay at 0
   until Phase 2 (order matching) lands, or do we count queued
   orders as "intended volume" for UI? Recommendation: **stay at
   0**; nothing else in the kernel uses it.

These are the only items that require an owner decision before the
data-model PR is reviewable. Everything else above is derivable from
existing §10 contract text.

---

## 13. Implementation order (when owner greens this plan)

This mirrors the build-order suggestion the previous planning round
already arrived at; included here so a future implementer can pick it
up directly.

1. Add the `fundamentals` block to `tuning.json` with a small
   **synthetic fixture** (clearly labelled "test data, not the real
   seed list") so loader tests have something to chew on.
2. Define `Sector` (immutable record) in `Wsr2.Engine`.
3. Define `Company` (immutable identity + tuning-loaded statics +
   mutable `price` / `volume` / `breakthroughImpulse`) in
   `Wsr2.Engine`.
4. Extend the `TuningLoader` to parse `fundamentals`, validate every
   invariant in §8, and fail-fast with `TuningException`.
5. Add the new entries to `tuning.visibility.roles` (§9).
6. xUnit tests:
   - Loader fail-fast cases (one test per invariant: bad FK, bad
     sign, duplicate id, self-referential relation, etc.).
   - Iteration-order determinism (`StringComparer.Ordinal`, not
     `OrdinalIgnoreCase`).
   - Snapshot round-trip with companies present (advance N ticks,
     snapshot, restore, advance N ticks again -- byte-equal result).
7. Bump `SessionSnapshot.SchemaVersion` and write the migration
   (§10).
8. Documentation sync in the same PR: extend `AGENTS.md` §10.4 with
   the full Company / Sector table; refresh `PRICING_MODEL.md`
   §9 (variable reference) to match; cross-link the new
   `tuning.fundamentals` block from both files.

PR description must include the "Impact on adjacent code" note
required by `AGENTS.md` §9 and the verification line proving
`dotnet build` + `dotnet test` + `dotnet format --verify-no-changes`
all pass.
