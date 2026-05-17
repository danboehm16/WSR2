# WSR2 game specifications

This file is the **authoritative description of how the WSR2 game is
played** -- the rules, the operations a player can perform, the
entities those operations act on, and the invariants the engine must
enforce. It is the **rules contract** for the game.

It is intentionally separate from the two existing technical contracts:

| File | Scope | Wins on conflict... |
|---|---|---|
| `GAME_SPECS.md` (this file) | **Rules of play** -- entities, ownership, control, transactions, win/loss | ...for any rules-of-play question. |
| [`AGENTS.md`](./AGENTS.md) §10 | **Simulation model** -- tick pipeline, pricing kernel, macro/cycle, breakthrough lifecycle, snapshot contract | ...for any pricing or determinism question. |
| [`PRICING_MODEL.md`](./PRICING_MODEL.md) | Plain-English explainer for §10 (no new rules) | Never; if it disagrees with §10, fix it. |

If a constraint here ever conflicts with one of those files, **stop
and ask the project owner** rather than silently overriding either
side. Every other file in the repo (`README.md`, `MODELS_PLAN.md`,
`tuning.json`, future code) **must conform** to the rules in this
document. When a rule here changes, sweep the other files for the
relevant sections in the same PR.

The design is deliberately inspired by **Wall Street Raider** by
Roninsoft: the human is not a free-floating "investor" -- they pilot
a **holding/operating company** and play the game by manipulating a
web of corporate ownership, where direct *and* indirect (through other
controlled companies) shareholdings count toward control.

---

## Table of contents

1. [Entities](#1-entities)
2. [Starting conditions](#2-starting-conditions)
3. [Ownership and control](#3-ownership-and-control)
4. [Transactions (the only way to act)](#4-transactions-the-only-way-to-act)
5. [Company finances](#5-company-finances)
6. [Game loop and time](#6-game-loop-and-time)
7. [Win / loss / end-of-game](#7-win--loss--end-of-game)
8. [Multiplayer rules](#8-multiplayer-rules)
9. [Server-authoritative invariants](#9-server-authoritative-invariants)
10. [`tuning.json` keys this spec depends on](#10-tuningjson-keys-this-spec-depends-on)
11. [What this spec deliberately does NOT include (yet)](#11-what-this-spec-deliberately-does-not-include-yet)
12. [Open TBDs for the project owner](#12-open-tbds-for-the-project-owner)

---

## 1. Entities

The game has exactly three first-class entities. Everything else is
either a piece of state on one of them or a transient (orders, events).

### 1.1 Player

A human (or future AI) participant in the session. A player has:

- a stable `playerId` (server-assigned),
- a `displayName`,
- a **personal share ledger** -- a map `companyId -> shares held
  personally by this player`. Initially the player owns 100 % of
  exactly one **starter company** (§2). The player may continue to
  hold personal shares of any company throughout the game.
- **no personal cash balance.** All cash lives inside companies
  (§5). This is the central WSR-style design call: the player's
  buying power is whatever cash sits inside the companies they
  control.

### 1.2 Company

The unit of agency in the game. Every transaction is executed *by* a
company, never directly by a player. A company has:

- identity (`id`, `displayName`, `sectorId`) -- as already specified in
  [`MODELS_PLAN.md`](./MODELS_PLAN.md) §3,
- simulation state (`price`, `volume`, `breakthroughImpulse`,
  `fairValue` derivation, `sharesOutstanding`) -- same source,
- **a cash balance (`cash`)** in `$`, settled on every executed trade
  (§5). May go negative only if and only if margin/credit is enabled
  (out of scope today; see §11),
- **a holdings ledger** -- a map `companyId -> shares of that other
  company owned by this company`. Self-ownership is forbidden (a
  company cannot buy its own shares; treasury stock is out of scope
  -- see §11),
- a **shareholder roster** that can be reconstructed by the engine:
  for each owner (a `Player` or another `Company`), the number of
  shares they hold. The roster is the server's source of truth for
  control calculations (§3).

The sum across owners of `sharesHeldByOwner(companyId)` must equal
`Company.sharesOutstanding` at all times; the engine asserts this
invariant after every tick.

### 1.3 Session

Already specified in [`AGENTS.md`](./AGENTS.md) §10.9 and
[`MODELS_PLAN.md`](./MODELS_PLAN.md) §6. Adds nothing new here other
than: the list of `players`, the universe of `companies`, and the
pending orders queue are all server-owned.

### 1.4 Order (transient)

A proposed transaction. See §4 for the structure and the server-side
validation rules.

---

## 2. Starting conditions

When a player joins a session, the engine performs **exactly one**
starter sequence atomically (before the player's first tick of input):

1. Pick a starter company for this player from the
   `tuning.game.starterCompanies` pool (§10). Selection is
   deterministic from the session RNG + player join order (so the
   choice is reproducible across replays); a player MAY veto and
   re-roll once, capped by `tuning.game.starterReRollLimit`
   (default `1`).
2. **The player owns 100 % of the starter company's shares.** The
   shareholder roster for the starter company is exactly
   `{ playerId -> sharesOutstanding }`.
3. The starter company is seeded with `tuning.game.starterCash` in
   its `cash` balance, with an empty `holdings` ledger.
4. An event-log entry `playerJoined` is appended, recording
   `(playerId, starterCompanyId, starterCash)` so replays and audits
   can reconstruct the initial deal.

Consequences (these are invariants, not optional):

- The player **cannot** start with a personal holding of any other
  company. The only way to acquire other companies' shares is for a
  company they control to trade for them.
- The player **cannot** start with personal cash. Their entire
  buying power on tick 0 is `starterCash` sitting inside the starter
  company.
- The player's personal share ledger on tick 0 is exactly
  `{ starterCompanyId -> starterCompany.sharesOutstanding }`.

---

## 3. Ownership and control

This section defines the **single** authoritative algorithm the
engine uses to decide what a player controls. Every other rule in
the spec ultimately reduces to a question this algorithm answers.

### 3.1 Direct ownership share

For any target company `T` and any owner `O` (either a `Player` or a
`Company`):

```text
directOwnershipPct(O, T) = sharesHeldByOwner(O, T) / T.sharesOutstanding
```

`O` may be a `Player`, in which case `sharesHeldByOwner` reads the
player's personal share ledger; or `O` may be a `Company`, in which
case it reads that company's `holdings`.

### 3.2 Effective (transitive) ownership

For a `Player` `P` and a target company `T`, the player's
**effective ownership** is the sum of:

- `directOwnershipPct(P, T)` -- shares `P` personally holds in `T`,
  plus
- for each company `C` that `P` **controls** (recursively, see §3.3),
  the full value of `directOwnershipPct(C, T)`.

Note the deliberate WSR-style simplification: once `P` controls `C`,
**100 %** of `C`'s stake in `T` is counted toward `P`'s effective
ownership of `T`, not a pro-rated share. Controlling a company means
you direct its votes, period. (Real-world finance would weight by the
chain of percentages; we don't.)

### 3.3 Control threshold

`P` **controls** company `C` if and only if:

```text
effectiveOwnershipPct(P, C) >= tuning.game.controlThresholdPct  (default: 20%)
```

The threshold is intentionally low and is loaded from
`tuning.json` (§10). It is `>=`, not `>`: exactly hitting the
threshold counts.

The algorithm is computed by repeated passes until the set of
controlled companies stops growing (fixed-point iteration over a
finite universe -- terminates in at most `|companies|` passes; the
engine bounds it to `|companies| + 1` and throws on overshoot to
catch corruption). Iteration order is `OrderBy(companyId,
StringComparer.Ordinal)` (per the determinism rule in
[`AGENTS.md`](./AGENTS.md) §2).

### 3.4 Loss of control

If a sequence of trades drops `effectiveOwnershipPct(P, C)` strictly
below `controlThresholdPct`, **`P` immediately loses control of
`C`** at the end of the tick that processed the trade. The engine
appends `controlLost(playerId, companyId, newEffectivePct)` to the
event log. Cascade is possible: losing `C` may transitively cause
loss of every company `C` controlled. The engine recomputes the
control closure once per tick and emits one event per change.

### 3.5 The "must control your starter, or lose the game" rule

A player **must always control at least one company**. If a player
ever holds personal `effectiveOwnershipPct < controlThresholdPct` of
every company in the universe, that player has **been knocked out**;
see §7.

(Edge case: a player who has been knocked out remains in the session
read-only for the rest of the game, can view leaderboards, and is
excluded from `effectiveOwnership` calculations for everyone else.)

---

## 4. Transactions (the only way to act)

There is exactly **one** kind of game action a player can submit: an
**order** to buy or sell shares of one company, executed on behalf of
one company.

### 4.1 Order shape

```text
{ acting:   companyId  (the company executing the trade -- "the buyer/seller"),
  target:   companyId  (the company whose shares are being traded),
  side:     Buy | Sell,
  quantity: long       (> 0; integer number of shares),
  submittedByPlayerId: playerId }
```

The order is sequenced and matched per [`AGENTS.md`](./AGENTS.md)
§10.6 (impact term + matching step). `acting != target` is required
(no treasury stock; see §11).

### 4.2 Server-side validation (deny-by-default)

Before queuing an order, the engine checks **every** rule below. If
any fails, the order is rejected (no partial fills, no side
effects) and a `orderRejected(playerId, orderId, reason)` event is
appended. The set of reasons is part of the public API and lives in
`tuning.game.orderRejectionReasons` (TBD list -- see §12).

1. `submittedByPlayerId` must currently **control** `acting`
   (§3.3). This is the "all transactions occur in the context of a
   company the player controls" rule.
2. `acting` must currently exist and not be marked delisted /
   liquidated (delisting is out of scope -- see §11; this guard is
   reserved).
3. `target` must currently exist.
4. `quantity > 0`.
5. `acting != target`.
6. For a **Buy**: at the moment of validation,
   `acting.cash >= quantity * acting.estimatedFillPrice * (1 +
   tuning.game.priceSlackPct)`. The slack covers expected per-tick
   price drift between validation and fill; if the actual fill
   exceeds available cash, the order is **partially filled up to
   the cash limit** and the unfilled remainder is cancelled with a
   `cashShortfall` event.
7. For a **Sell**: `acting.holdings(target) >= quantity`. A player
   cannot short shares the acting company does not hold (no naked
   shorting; see §11).
8. The post-trade ownership for every shareholder of `target` must
   stay within `[0, target.sharesOutstanding]`. The engine recomputes
   and asserts this after every fill.

### 4.3 Settlement

When an order fills (fully or partially, per
[`AGENTS.md`](./AGENTS.md) §10.6 matching):

- **Buy**: `acting.cash -= filledQty * fillPrice`;
  `acting.holdings[target] += filledQty`. Some other holder
  (initially: a deterministic "free float" pool seeded at session
  start, see §11) loses `filledQty` from its position.
- **Sell**: `acting.cash += filledQty * fillPrice`;
  `acting.holdings[target] -= filledQty`. The free float gains
  `filledQty`.
- Settlement is **instant on fill** (no T+2). Multi-day settlement
  is out of scope -- see §11.
- After settlement, the engine re-runs the control closure (§3.3)
  and emits `controlGained` / `controlLost` events as needed.

### 4.4 What players CANNOT do

Listed explicitly because their absence is a design decision, not an
oversight:

- **No personal trades.** A player cannot buy or sell shares as
  themselves; they can only direct a controlled company to do so.
  The only shares a player ever holds personally are the starter
  company's shares received at session start (and any future
  starter shares they buy back from a controlled company -- see
  §11 for the inter-entity transfer mechanism, which is TBD).
- **No cash transfers between companies** outside of buying their
  shares. There is no "loan from CompanyA to CompanyB" or
  "dividend" mechanism in the current scope -- see §11.
- **No issuance.** `sharesOutstanding` is fixed per company for the
  whole session. No splits, buybacks, secondary offerings.
- **No short selling, no derivatives, no margin, no IPOs.** See §11.

---

## 5. Company finances

A company is, financially, a tuple of:

- `cash`: `double`, in `$`. Range: `[0, +inf)` in the current scope
  (no negative balances; see §11 for credit).
- `holdings: ImmutableDictionary<string, long>`: how many shares of
  each *other* company this one owns. Always `> 0` for present keys;
  zero-quantity entries are removed.

Per-tick mark-to-market:

```text
companyEquity(C) = C.cash + sum_T (C.holdings(T) * T.price)
```

`companyEquity` is recomputed on demand for UI / leaderboards; it
is **not** stored in the snapshot (recoverable from snapshotted
state).

Player wealth (used for the leaderboard) is the natural extension:

```text
playerWealth(P) =
    sum over personally-held companies T of (P.shares(T) * T.price)
  + sum over companies C that P controls of companyEquity(C)
```

This is the "effective wealth" definition: controlling a company
counts the entire company toward your score. Non-controlled
minority stakes only count via the personally-held branch.

---

## 6. Game loop and time

Unchanged from [`AGENTS.md`](./AGENTS.md) §10.1-2:

- 1 tick = 1 trading day.
- 1 trading year = `tuning.time.ticksPerYear` (= 252).
- Default career: `tuning.time.defaultCareerYears` (= 30) ticks
  per year = 7,560 ticks.
- Speed policy per [`AGENTS.md`](./AGENTS.md) §6.

Player actions (orders) submitted during a tick are queued in the
session's pending-orders list and matched in step 4 of the tick
pipeline. There is no concept of "outside the tick"; everything
the engine sees, it sees during a tick.

---

## 7. Win / loss / end-of-game

### 7.1 Loss (knock-out)

A player is **knocked out** the moment they fail the §3.5 test:
they no longer control any company. They are flagged
`isKnockedOut = true` and remain in the session for replay /
spectator purposes; they cannot submit any further orders.

### 7.2 End of career

The session ends at the end of tick
`tuning.time.defaultCareerYears * tuning.time.ticksPerYear` (default
7,560). The engine emits a `careerEnded` event and freezes state.

### 7.3 Win

The player with the highest `playerWealth` at career end (or the
last non-knocked-out player, if everyone else has been knocked out
earlier) is the winner. Ties are broken by the
`tuning.multiplayer.orderQueueDeterministicTiebreak` rule already
in use for order sequencing, so the win condition is deterministic.

---

## 8. Multiplayer rules

Most of multiplayer is already specified in
[`AGENTS.md`](./AGENTS.md) §6 (speed lock, snapshot cadence) and
this spec only adds the player/company invariants:

- Every player gets their own starter company (§2). Two players
  never share a starter.
- A player **cannot directly own shares of another player's starter
  company on tick 0**, but a company that one player controls
  **can** buy shares of another player's starter company later --
  that is the core of the takeover game.
- Once a player has lost control of every company (§3.5), they are
  knocked out (§7.1); the session continues for the remaining
  players.

---

## 9. Server-authoritative invariants

These MUST hold at the end of every tick. The engine asserts them in
debug builds and emits `invariantViolation` to the event log (and
throws in test builds) if any fails. They are listed in one place
here so reviewers can audit any new feature against the same checklist:

1. For every company `C`, the sum of `sharesHeldByOwner(owner, C)`
   across all owners (players + companies + the free-float pool)
   equals `C.sharesOutstanding`. No shares created or destroyed.
2. For every company `C`, `C.cash >= 0`.
3. For every company `C`, `C.holdings` contains no self-reference
   (`C` is not in its own keys) and no zero or negative entries.
4. For every player `P`, `P` controls at least one company **or**
   `P.isKnockedOut == true`.
5. The control closure (§3.3) is a stable fixed point: re-running
   it produces the same controlled-companies set.
6. Every executed order has a corresponding `submittedByPlayerId`
   that controlled the acting company **at the moment of
   submission** (the control may have changed by fill time -- that
   is fine, as long as the submission was valid).
7. `careerEnded` has been emitted at most once per session.

Violations are server-side bugs, never client errors.

---

## 10. `tuning.json` keys this spec depends on

A new `game` block is added to `tuning.json` to hold the
spec-driven constants. The loader follows the rules in
[`AGENTS.md`](./AGENTS.md) §3: fail-fast on missing/invalid fields,
dedicated `TuningException`, etc.

```jsonc
"game": {
  "controlThresholdPct": 20,            // §3.3; integer 1..100
  "starterCash": 10000000,              // $; > 0; seed cash inside the starter company
  "starterReRollLimit": 1,              // §2; >= 0
  "starterCompanies": [ "...", ... ],   // companyIds eligible as starters; loader validates each exists in fundamentals.companies
  "priceSlackPct": 0.02,                // §4.2 buy validation slack; 0 .. 1
  "orderRejectionReasons": [            // public, stable string ids; closed set, TBD final list (§12)
    "notInControl", "insufficientCash", "insufficientShares",
    "selfTrade", "unknownCompany", "nonPositiveQuantity"
  ],
  "freeFloatInitialPct": 100            // §11; opening share-of-shares for the synthetic counterparty
}
```

The `visibility.roles` map in `tuning.json` must include the new
fields:

| Field | `Admin` | `Standard` |
|---|---|---|
| `company.cash` | true | true (for companies the viewing player controls) / false (otherwise) -- the role map needs a per-relationship qualifier; see §12 |
| `company.holdings` | true | same |
| `player.personalShares` | true | true (self) / false (others) -- same caveat |
| `player.isKnockedOut` | true | true |
| `player.effectiveControl` | true | true (self) / false (others) |

Per-relationship visibility ("for things you control") is the first
piece of state we have that needs a finer-grained visibility model
than the current "Admin / Standard" binary. The simplest
forward-compatible move is to add a third role-equivalent
`SelfOrControlled` in the visibility map; final shape is **TBD**
(§12) and must be resolved with the project owner before
implementation.

**Interim behaviour until that role lands.** `tuning.json` currently
sets `company.cash`, `company.holdings`, `player.personalShares`,
and `player.effectiveControl` to `false` for the `Standard` role.
That means non-Admin clients see **none** of these fields, even for
companies they themselves control. This is the safe deny-by-default
choice (`AGENTS.md` §5) but it is **not** the intended end state --
players obviously need to see the cash and holdings of companies
they control. The interim treatment is documented here so reviewers
do not mistake it for the final visibility surface; the per-
relationship role is what flips Standard from "hidden" to "visible
when the viewer controls the entity".

---

## 11. What this spec deliberately does NOT include (yet)

Listed so they are not silently introduced via "while I was at it"
PRs. Each of these is a real game-design question that needs an
explicit owner sign-off before any code lands:

- **Free-float counterparty.** The current spec assumes a synthetic
  "free float" pool that starts with 100 % of every non-starter
  company's shares and trades against player-controlled orders.
  Real Wall Street Raider has named NPC funds; we don't. The shape
  of this pool (one global pool? per-company? does it have cash?)
  is **TBD**.
- **Treasury stock / buybacks** (`acting == target`).
- **Share issuance, splits, secondary offerings.**
- **IPOs** (introducing new companies mid-session).
- **Inter-company cash transfers** (loans, dividends, capital
  injections from a parent to a subsidiary).
- **Buying back personal shares from a controlled company** (i.e.
  the player making their controlled company sell some of its
  starter-company holdings back to the player personally). Useful
  flavour but not yet specified.
- **Margin / credit / negative cash balances.**
- **Short selling, options, futures, any derivatives.**
- **Multi-tick settlement (T+1 / T+2), borrow fees, ex-div dates.**
- **Tender offers, hostile takeovers as distinct atomic actions** --
  in the current spec a takeover is just "the cumulative effect of
  buying past the 20 % threshold". A future PR may add a dedicated
  tender-offer action with poison-pill / white-knight responses.
- **Delisting, bankruptcy, liquidation.** Companies cannot die in
  the current scope; `Company.cash >= 0` is a hard invariant and
  any order that would breach it is rejected.

When the project owner is ready to enable any of these, it goes
into `GAME_SPECS.md` first (because that is where game rules live)
and only then into the simulation contract / models plan / code.

---

## 12. Open TBDs for the project owner

None of these block reviewing this spec. They block **lighting the
green** on a coding slice that touches them.

1. **Starter-company seed list.** Which companies in
   `fundamentals.companies` are eligible to be a player's starter,
   and how is the selection biased (uniform? weighted by size? by
   sector?)? `tuning.game.starterCompanies` is the slot; the
   contents are owner-decided.
2. **Free-float counterparty design.** See §11 first bullet.
3. **Per-relationship visibility.** §10 footnote: the visibility
   map currently can't say "show field X only when the viewer
   controls Y". A `SelfOrControlled` role is the cleanest
   forward-compatible move; confirm before adding.
4. **Order-rejection reason set.** §10 lists a starter set; the
   owner should confirm or extend before the rejection codes are
   wired into the public client API.
5. **Knock-out leniency.** §7.1 currently knocks a player out the
   instant they drop below the threshold for every company. Some
   designs offer a one-tick grace period to allow recovery trades.
   Default: **no grace period**. Confirm.
6. **Tiebreak for `controlThresholdPct` reached simultaneously by
   two players.** If two players hit exactly 20 % of the same
   company on the same tick, both claim control under §3.3 as
   written. Real WSR resolves this in favour of the larger
   stakeholder; ours currently allows joint control (both players'
   effective ownership includes the company's downstream holdings,
   which is fine because §9 only requires consistency, not
   exclusivity). Confirm acceptable, or pick a tiebreak.

---

## 13. Conformance checklist for other files

Any change to this spec **must** be propagated in the same PR. The
files that currently embed rules from this spec are:

- [`README.md`](./README.md): one-line standing-constraints row
  pointing here.
- [`AGENTS.md`](./AGENTS.md): cross-link from the rules sections;
  do **not** restate the rules.
- [`MODELS_PLAN.md`](./MODELS_PLAN.md): `Company` schema must carry
  `cash` and `holdings`; the impact term in §10.6 must read
  player AUM via the control closure (§3) and not via a
  `Session.players[].positions` map that no longer exists in this
  ownership model.
- [`tuning.json`](./tuning.json): the `game` block defined in §10,
  plus the visibility entries.
