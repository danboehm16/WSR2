# WSR2 pricing model -- a plain-English walkthrough

This file is the **beginner's guide** to how WSR2 turns numbers into
stock prices. It assumes you have never traded a stock and have never
read a finance textbook. It defines every term, names every variable
and constant, walks through the logic step by step, and ends with a
complete reference table.

**This file is the explainer, not the contract.** The authoritative
design contract is [`AGENTS.md`](./AGENTS.md) section 10. If anything
here ever disagrees with section 10, section 10 wins -- please open a
PR to fix this file. The numeric defaults referenced here come from
[`tuning.json`](./tuning.json).

**Remember the bigger picture.** WSR2 is a **game**, not a real-world
stock-market simulator. The model only has to feel fair, reactive, and
fun across a 30-year career. The 2026-05-17 design pass deliberately
collapsed a much more elaborate earlier draft -- five macro variables,
a four-phase business cycle, seven kernel components, three stacked
stability caps, two separate impact channels, a fat-tailed severity
distribution -- down to **one macro variable, two cycle phases, five
kernel components, one cap, one impact term, three severity buckets**.
The justification for every cut is in
[section 13](#13-simplifications-applied-2026-05-17).

---

## Table of contents

1. [The model in 10 lines](#1-the-model-in-10-lines)
2. [Glossary: every term defined](#2-glossary-every-term-defined)
3. [Time: what a "tick" is](#3-time-what-a-tick-is)
4. [The three layers of the world](#4-the-three-layers-of-the-world)
5. [The pricing kernel as a story](#5-the-pricing-kernel-as-a-story)
6. [The safety net (the per-instrument cap)](#6-the-safety-net-the-per-instrument-cap)
7. [How player trades move prices](#7-how-player-trades-move-prices)
8. [The news engine (breakthroughs)](#8-the-news-engine-breakthroughs)
9. [Complete variable and constant reference](#9-complete-variable-and-constant-reference)
10. [One full tick, narrated end-to-end](#10-one-full-tick-narrated-end-to-end)
11. [Determinism and snapshots, in 10 lines](#11-determinism-and-snapshots-in-10-lines)
12. [Open questions and TBDs in one place](#12-open-questions-and-tbds-in-one-place)
13. [Simplifications applied 2026-05-17](#13-simplifications-applied-2026-05-17)

---

## 1. The model in 10 lines

1. Time advances in fixed-size beats called **ticks**. One tick = one
   trading day. A 30-year career = 7,560 ticks.
2. Each tick the engine runs **seven** steps in a fixed order. Step 3
   is the **pricing kernel** -- the only place where a stock's price
   actually changes.
3. The world has three layers: **macro** (whole economy) -> **sector**
   (one number per sector) -> **company** (the individual stock).
4. Macro state is just **one number** (`marketMood`, a 0..1 index)
   plus a **two-phase cycle** (`Up` / `Down`). Each tick `marketMood`
   gets a small random nudge and is gently pulled back toward 0.55,
   biased up in `Up` phases and down in `Down` phases.
5. Each company has a hidden **fair value** = `baseFairValue *
   sectorScalar`. Both numbers are designer-set in `tuning.json`. The
   pricing kernel pulls the price gently toward this anchor.
6. Each tick the kernel adds **five** small nudges together: (a) the
   pull toward fair value, (b) market-wide reaction to the *change* in
   `marketMood`, (c) any active news event, (d) the combined impact
   of player trades (which is bigger when big players are involved),
   (e) random Gaussian noise.
7. The sum is then clamped by **one safety net**: per-instrument move
   cap (25 % normally, 60 % on event days).
8. Prices never go to zero -- there is a hard floor at `$0.01`.
9. **News events** ("breakthroughs") -- inventions, scandals, recalls
   -- come from a data table of archetypes, with bucketed severity
   tiers (small 70 %, medium 25 %, huge 5 %). They give a single
   push that then fades over ~60 ticks.
10. **Determinism** + **tunability** are non-negotiable: same seed ->
    same prices, on any machine; every magnitude lives in
    [`tuning.json`](./tuning.json), no constants hard-coded in code.

---

## 2. Glossary: every term defined

These terms come up everywhere in finance. Read them once and you
will be able to follow the rest of this file.

### Trading basics

- **Stock (a.k.a. share, equity)** -- a tiny piece of ownership in a
  company. If a company has 1,000,000 shares and you own 1, you own
  one-millionth of it.
- **Shares outstanding** -- the total number of shares the company
  has issued. Used to compute market cap and `baseAdv`.
- **Price** -- the current cost of one share, in dollars. In WSR2,
  always a `double` with a hard floor of `$0.01`.
- **Mid-price** -- the agreed-on "fair price right now" between the
  highest someone will pay and the lowest someone will sell for. The
  pricing kernel produces a mid-price each tick.
- **Order** -- a request to buy or sell some quantity of a stock. In
  WSR2 each order has a `playerId`, a `side` (buy/sell), and a
  `quantity`.
- **Order book / matching** -- the engine pairs buy orders with sell
  orders to actually trade shares. Phase-1 WSR2 queues orders but
  does not match them yet; matching arrives in Phase 2.

### Money quantities

- **Cash** -- a player's spendable balance.
- **Position** -- how many shares of a given company a player owns.
- **AUM (assets under management)** -- the total dollar value of
  everything a player owns (cash + every position priced at the
  current mid-price). Used to size the whale-bonus on the impact
  term and to rank the leaderboard.
- **Market cap** -- `sharesOutstanding * price`. The total dollar
  value of the whole company.
- **AUM share (in a company)** -- `playerAumInCompany /
  companyMarketCap`. A 0..1 number that says "what fraction of this
  company is held by players right now."

### Returns and percentages

- **Return** -- the percentage change in price between two moments.
  WSR2 uses **fractional returns**: `+0.01` means "+1 %".
- **Per-tick return** -- the fractional change in one tick.
  `newPrice = prevPrice * (1 + return)`.
- **Basis point (bp)** -- 1/100 of a percent. `1 bp = 0.0001`.
  `150 bp = 1.50 %`. Finance people use this because percentages of
  percentages get confusing fast.

### The "fair value" idea (much simpler than the real-world version)

- **Fair value** -- WSR2's hidden "what should this stock cost?"
  anchor. The pricing kernel uses it to pull the price back toward
  reasonable, so the market does not drift to absurd numbers. In
  WSR2 the formula is dead simple: `fairValue = baseFairValue *
  sectorScalar`.
- **baseFairValue** -- a hand-set number per company in
  `tuning.json`. Designers pick it; it does not change during a
  session.
- **sectorScalar** -- a hand-set number per sector in `tuning.json`.
  All companies in a sector get multiplied by the same scalar.
  Designers can rebalance whole sectors by editing one number.

> Real markets compute fair value from earnings, growth rates,
> discount rates, and so on. WSR2 explicitly does **not** model any
> of that -- see [section 13](#13-simplifications-applied-2026-05-17).

### The wider world

- **Sector** -- a group of similar companies (e.g. all tech firms,
  all banks). Each company belongs to exactly one sector. In WSR2 a
  sector is just a name and a single `sectorScalar`.
- **Macro** -- the big-picture economy. In WSR2 this is one number,
  `marketMood`.
- **`marketMood`** -- a single 0..1 mood index. High = optimistic
  markets; low = pessimistic. Changes slowly tick to tick. This is
  the **only** macro state; the previous design's gdp / inflation /
  policy-rate / credit-spread / sentiment quintet collapsed into
  this one number on 2026-05-17.
- **Business cycle** -- the slow rhythm of growth and recession.
  WSR2 has **two phases**: `Up` and `Down`. The current phase
  applies a small per-tick bias to `marketMood` (positive in `Up`,
  larger-negative in `Down`).

### Liquidity and impact

- **ADV (average daily volume)** -- how many shares typically change
  hands per day. A stock with high ADV is "liquid" -- big orders
  barely move its price. A stock with low ADV is "illiquid" -- the
  same big order can swing the price a lot.
- **baseAdv** -- WSR2's per-company baseline ADV. Formula:
  `baseAdv = sharesOutstanding * tuning.impact.baseAdvFraction`. One
  tunable fraction, no real-world float/turnover decomposition.
- **Impact** -- how far an order moves the price. WSR2 combines two
  effects in one number (see [section 7](#7-how-player-trades-move-prices)):
  passive size-vs-ADV pressure, and a whale bonus when big players
  trade.
- **Whale bonus** -- the multiplier applied to the impact when the
  trading players are already big holders of the company. Capped at
  +50 % so even billionaires cannot break the simulation.

### Volatility and randomness

- **Volatility** -- a measure of how jumpy a price is. A high-vol
  stock moves a lot tick to tick; a low-vol stock barely moves.
- **Noise** -- random tick-to-tick wiggle in the price, on top of
  whatever the model says "should" happen. Without noise the world
  would feel mechanical.
- **Normal distribution (Gaussian)** -- the classic bell-curve. Most
  draws land near zero, big draws are rare, very big draws are very
  rare. WSR2 uses Gaussian noise so price jumps look natural.
- **Standard deviation (sigma)** -- how wide the bell curve is. A
  sigma of `0.005` per tick means most ticks move within +/- 0.5 %
  of zero from noise alone.
- **Box-Muller** -- a recipe that turns two uniform random numbers
  into two Gaussian random numbers. WSR2 uses it so we always
  consume RNG in the same predictable pattern (important for
  determinism).
- **OU process (Ornstein-Uhlenbeck)** -- a fancy name for a simple
  idea: a number that randomly wanders but is gently pulled back
  toward a long-term average. WSR2 uses one OU process for
  `marketMood`. The pull-back strength is the **reversion** rate.
- **Mean** -- the long-term average the OU process wanders around.
  For `marketMood` it is 0.55 (slightly above neutral).
- **Clamp** -- "if it goes above max, set it to max; if it goes
  below min, set it to min." Used everywhere in WSR2 to keep numbers
  inside sane ranges.

### Engine-internal terms

- **RNG (random number generator)** -- the source of all randomness
  in the engine. WSR2 uses one seeded xoroshiro128** RNG per
  session; everything random goes through it.
- **Seed** -- a starting number for the RNG. Same seed -> same
  random sequence -> same simulation, every time.
- **Tick** -- the engine's heartbeat (see
  [section 3](#3-time-what-a-tick-is)).
- **Snapshot** -- a saved copy of all the state required to resume
  the simulation later and produce a byte-for-byte identical future.
- **Schema version** -- a number on every snapshot. If you change
  the snapshot shape, bump this and write a migration.
- **Visibility** -- which fields each role (Admin / Standard) is
  allowed to see. Defined per-field in `tuning.visibility.roles`.

---

## 3. Time: what a "tick" is

- A **tick** is the smallest unit of simulated time. In WSR2, one
  tick = **one trading day**. The wall-clock pace at 1x speed is
  `time.tickIntervalMsAt1x` = 1000 ms (one real second per tick).
- A **simulated year** is `time.ticksPerYear` = **252 ticks**. (252
  matches real trading days/year; the engine does not care about
  the real-world pedigree -- it just makes the macro tuning numbers
  feel right.)
- The default career length is `time.defaultCareerYears` = 30 years
  = **7,560 ticks**. The engine must stay numerically stable for at
  least `time.maxSimYears` = 50 years = 12,600 ticks.
- Speed multipliers (`allowedSpeedsSolo = [0, 1, 4, 16, 64]`) just
  change how fast ticks fire in wall-clock time. The engine logic
  is the same at every speed.

That is it. There is no intraday time, no "open/close" bell, no
weekends. One tick, one price update, one decision point.

---

## 4. The three layers of the world

The model is built in **three layers** so that one source of
randomness (macro) can drive lots of stocks coherently without
having to wire every stock individually.

```text
                +----------------------+
                | Macro: 1 number      |
                | (marketMood)         |
                | + cyclePhase (Up/Dn) |
                +----------+-----------+
                           v
            +--------------+--------------+
            | Sectors: 1 number each      |
            | (sectorScalar)              |
            +--------------+--------------+
                           v
            +--------------+--------------+
            | Companies: baseFairValue +  |
            | sharesOutstanding +         |
            | fairValue (=base*scalar)    |
            +-----------------------------+
                           v
                       prices
```

### 4.1 Macro layer (the whole economy)

| Field | Meaning | Default | Range |
|---|---|---|---|
| `marketMood` | 0..1 mood index. High = optimistic. | 0.55 | 0.05 .. 0.95 |
| `cyclePhase` | `Up` or `Down`. | `Up` | -- |
| `ticksInPhase` | Ticks since the current phase started. | 0 | -- |
| `spareNormal` | Buffered second Box-Muller sample, or null. | null | -- |

`marketMood` evolves via one OU process. The four tuning knobs in
`macro.drift.marketMood` are:

- `mean = 0.55` -- the long-term average to drift toward.
- `reversion = 0.0060` -- how strongly to pull back each tick.
- `vol = 0.0040` -- the per-tick random kick size.
- `min = 0.05`, `max = 0.95` -- hard clamp range.

Plus a per-phase bias in `macro.phaseBias[phase].marketMood`:

| Phase | Per-tick bias on `marketMood` |
|---|---|
| `Up` | +0.00020 (gentle upward push) |
| `Down` | -0.00060 (stronger downward push -- bear markets fall faster than bull markets climb) |

Cycle phase lengths (`macro.cycle.minTicksPerPhase` /
`maxTicksPerPhase`):

| Phase | Min ticks | Max ticks | Min years | Max years |
|---|---|---|---|---|
| `Up` | 504 | 1764 | 2 | 7 |
| `Down` | 189 | 504 | 0.75 | 2 |

When `ticksInPhase` is between min and max, each tick has a
probability `p = (ticksInPhase - min) / (max - min)` of switching
phases. The phase-switch coin flip is deterministic from the RNG.

### 4.2 Sector layer (groups of companies)

Each sector is **one number**: `sectorScalar`. That's it. The
sector affects companies through one channel only: it multiplies
every company's `baseFairValue` to produce its `fairValue`.

Designers add sectors to `tuning.fundamentals.sectors` (which does
not exist yet -- it is part of the still-open "company seed list"
TBD). Example:

```jsonc
"sectors": [
  { "id": "tech",     "sectorScalar": 1.20 },
  { "id": "banks",    "sectorScalar": 0.90 },
  { "id": "consumer", "sectorScalar": 1.05 },
  { "id": "energy",   "sectorScalar": 0.95 }
]
```

A `sectorScalar` of 1.0 is neutral; > 1.0 makes the whole sector
trade at a premium to `baseFairValue`; < 1.0 makes it trade at a
discount.

### 4.3 Company layer (the individual stock)

| Field | Meaning | Visible to Standard? |
|---|---|---|
| `sectorId` | Which sector this company belongs to. | yes |
| `sharesOutstanding` | Total shares issued. | yes |
| `baseFairValue` | Per-company "what this stock should cost", hand-set. | no |
| `fairValue` | `baseFairValue * sectorScalar`. Recomputed each tick (cheap; lets designers retune `sectorScalar` mid-session). | no |
| `price` | Current mid-price, $0.01 floor. | yes |
| `volume` | Cumulative shares traded so far. | yes |
| `breakthroughImpulse` | Current decaying fractional-return impulse. | no |
| `hasActiveBreakthrough` | `|breakthroughImpulse| > epsilon`. Triggers the 60 % event-day cap. | no |

No `ttmEarnings`, no `qualityScore`, no `floatHeldByPlayer`, no
`playerImpactDecay`. Those were all dropped on 2026-05-17 as section 13
simplifications -- earnings and quality were over-engineering for
a game; the player-impact decay accumulator was needed only by the
old two-channel feedback design and the new single `impact` term
recomputes from current orders each tick.

---

## 5. The pricing kernel as a story

Once per tick, for every company, the kernel runs and produces one
new price. Picture a single stock just sitting there with last
tick's price. **Five** separate forces act on it; the kernel adds
them up to get one **return** (the percentage change for this
tick), applies one safety brake, and multiplies last tick's price
by `(1 + return)`.

### 5.1 The five forces, in plain English

1. **The gravitational pull toward fair value (`fundamentalDrift`)**

   We have a hidden idea of what this stock "should" cost
   (`fairValue = baseFairValue * sectorScalar`). If the price has
   drifted away from that anchor, nudge it gently back. If
   `prevPrice = 100` and `fairValue = 102`, this force is slightly
   positive; if `prevPrice = 110` and `fairValue = 102`, slightly
   negative. The strength of the pull is a tuning knob called
   `kFund` ([TBD](#12-open-questions-and-tbds-in-one-place)).

   *Why we have it:* without it, the stock would random-walk and
   could drift to $0.01 or $1,000,000 forever.

2. **The whole market reacts to mood (`moodShock`)**

   When `marketMood` ticks up since last tick, every stock should
   lift a little. When it ticks down, every stock should sag a
   little. This force is `moodBeta * (marketMood -
   prevMarketMood)`. Every stock in the market sees the same
   `moodShock` this tick.

   *Why we have it:* it gives "market days" where everything moves
   together, which feels real. The previous design had five separate
   beta terms (one per macro variable); collapsing to one beta on
   one variable is what made the macro layer simple.

3. **Active news events (`breakthroughImpulse`)**

   If a breakthrough event fired on this company recently, the
   leftover impulse adds to today's return. Initially big, decays
   over ~60 ticks (see [section 8](#8-the-news-engine-breakthroughs)).
   This is already a fractional return; no extra coefficient.

   *Why we have it:* drama. Stocks that just had a "BlockbusterLaunch"
   should jump.

4. **Combined impact of player trades (`impact`)**

   Add up the orders queued for this stock this tick: net buys
   minus net sells = `netSignedQty`. Compute how big that is
   relative to the stock's baseline daily volume (`baseAdv`).
   Multiply by `(1 + whaleBonus)` where `whaleBonus` grows with
   the fraction of the company already held by players. Cap the
   result at +/- 150 bp. See [section 7](#7-how-player-trades-move-prices)
   for the full formula.

   *Why we have it:* buying pressure should visibly affect prices,
   and big players should matter more than tiny ones. The previous
   design split this into two separate terms with a flagged sign
   bug; combining them resolved the bug.

5. **Random Gaussian wiggle (`noise`)**

   A draw from the bell curve, scaled by `kNoise`
   ([TBD](#12-open-questions-and-tbds-in-one-place); think 50 bp
   per tick = 0.5 %). Same distribution every tick, every company.

   *Why we have it:* a market that only reacts to news feels lifeless.

   *Note:* this is the **only** kernel component that consumes the
   RNG, and it consumes **exactly one** Gaussian draw per company
   per tick. This is what keeps the RNG stream offset bit-exact
   across runs.

### 5.2 The sum

```text
priceReturnRaw = fundamentalDrift
               + moodShock
               + breakthroughImpulse
               + impact
               + noise
```

The order is fixed so debug logs can attribute today's move to a
named cause. Even when a component is currently zero, its slot
stays in the sum.

Then the safety net (next section) clamps the result, and:

```text
newPrice = max(0.01, prevPrice * (1 + clampedReturn))
```

The `max(0.01, ...)` is the hard floor that keeps prices positive.

---

## 6. The safety net (the per-instrument cap)

`priceReturnRaw` could theoretically be huge if every force pulled
the same way at once. We do not want random +200 % days. WSR2
applies **one** cap, per-instrument:

- Normal day: +/- `stability.dailyMoveCapPct` = **25 %**.
- Day when a breakthrough event is active on this stock: +/-
  `stability.eventDayDailyMoveCapPct` = **60 %** (so news can
  actually move the price).

If `|priceReturnRaw|` is larger than the cap, clamp it.

That's it. There is no per-sector budget, no per-market budget.
The earlier design had three stacked caps; they were dropped as a
section 13 simplification because they constrained the design with
cross-stock coupling state (a sector budget needs the engine to
remember the running sum across all stocks in the sector that
tick) without earning their keep for a 30-year game. One
per-instrument cap is plenty: each stock cannot move more than
25 % a day (60 % on event days), and that bound alone keeps the
whole market behaved.

Real markets occasionally do have +/- 10 % single-day moves;
WSR2 will not. That is a **deliberate game-design choice** --
predictable bounds make the game playable.

---

## 7. How player trades move prices

In WSR2, trade-driven price movement is **one** combined formula
(it used to be two separate channels):

```text
netSignedQty  = sum over queued orders of (buy ? +qty : -qty)
baseAdv       = sharesOutstanding * tuning.impact.baseAdvFraction
aumShare      = playerAumInCompany / companyMarketCap

whaleBonus    = min(tuning.impact.whaleBonusGain * aumShare,
                    tuning.impact.whaleBonusCap)   # capped at +50 %

impactBps     = tuning.impact.impactGain
              * (netSignedQty / baseAdv)
              * (1 + whaleBonus)
              * 10000                              # decimal -> bps

impactBps     = clamp(impactBps,
                      -tuning.impact.impactCapBps,
                      +tuning.impact.impactCapBps)  # capped at 150 bp

impact        = impactBps / 10000                   # bps -> decimal
```

Tuning knobs (in `tuning.impact`):

| Knob | Default | What it does |
|---|---|---|
| `enabledFromDay1` | `true` | Whether the channel is on. |
| `impactGain` | `0.01` | Base impact slope. Trading 1x ADV in one tick is a +1.0 % push before the whale bonus. |
| `whaleBonusGain` | `5.0` | Slope from `aumShare` to whale bonus. 1 % AUM share -> +5 % bonus. |
| `whaleBonusCap` | `0.50` | Hard cap on whale bonus (+50 %). |
| `impactCapBps` | `150` | Final per-tick cap (1.5 %). |
| `baseAdvFraction` | `0.002` | `baseAdv = sharesOutstanding * 0.002`. A 10M-share company has ADV 20,000. |

**Sign convention is now unambiguous.** More AUM share -> bigger
`whaleBonus` -> bigger `|impact|` for the same `netSignedQty`,
exactly matching the design intent ("very large players move
markets noticeably more"). The earlier two-channel design had a
flagged sign bug; collapsing to one term resolved it.

### Worked example

ACME has `sharesOutstanding = 10,000,000`. So `baseAdv = 20,000`
shares/day. Suppose this tick:

- `netSignedQty = +500` (small net buy).
- Players collectively hold 2 % of ACME, so `aumShare = 0.02`.

Then:

```text
whaleBonus = min(5.0 * 0.02, 0.50)         = 0.10        (+10 % bonus)
impactBps  = 0.01 * (500/20000) * (1+0.10) * 10000
           = 0.01 * 0.025 * 1.10 * 10000
           = 2.75 bps
impactBps  = clamp(2.75, -150, +150)        = 2.75
impact     = 2.75 / 10000                   = +0.000275  (+2.75 bp)
```

So this tick's order flow adds about +2.75 bp to ACME's return.
A whale that single-handedly owned 10 % of ACME and placed the
same +500-share order would get `whaleBonus = min(0.5, 0.5) = 0.50`,
i.e. `impact = +3.75 bp` -- noticeably more, but bounded.

---

## 8. The news engine (breakthroughs)

Each tick, on each company, the engine maybe rolls a news event.

### 8.1 Lifecycle (in 5 steps)

1. **Roll the dice.** Each (company, tick) pair gets a Bernoulli
   trial with per-tick probability
   `perCompanyAnnualProbability / ticksPerYear`
   = `0.02 / 252` ~ 0.0079 % per company per tick. With 100
   companies and 252 ticks/year, expect about 2 events per company
   per year on average.
2. **Pick an archetype.** Uniform random pick from
   `tuning.breakthroughs.archetypes` (10 archetypes today;
   see the [reference table](#94-tuning-constants-referenced-by-the-pricing-model)).
3. **Pick a severity (two-step bucketed pick).**
   - Draw one uniform `u1` and select a tier from
     `tuning.breakthroughs.severityTiers` by cumulative probability:
     - 70 % `small` (severity 0.10..0.25)
     - 25 % `medium` (severity 0.25..0.50)
     - 5 % `huge` (severity 0.50..0.80)
   - Draw one uniform `u2` and set `severity = lerp(tier.severityMin,
     tier.severityMax, u2)`.
4. **Build the impulse.**

   ```text
   impulse = direction * lerp(minPct, maxPct, severity) / 100
   ```

   Plus smaller ripple impulses for competitor and supplier
   companies, scaled by `rippleCompetitorsPct` and
   `rippleSuppliersPct`. (The competitor/supplier graph itself is
   still [TBD](#12-open-questions-and-tbds-in-one-place).)
5. **Decay.** Each subsequent tick, every active impulse multiplies
   by `0.5 ^ (1 / decay.defaultHalfLifeTicks)` = `0.5 ^ (1/60)`.
   In words: it loses half its strength every 60 ticks. After
   ~600 ticks the impulse is effectively gone.

### 8.2 The 10 archetypes today

| id | direction | minPct | maxPct | competitor ripple | supplier ripple |
|---|---|---|---|---|---|
| BreakthroughInvention | +1 | 20 | 60 | -10 | +5 |
| EfficiencyGain | +1 | 10 | 30 | -5 | -3 |
| BlockbusterLaunch | +1 | 15 | 40 | -8 | +3 |
| RegulatoryApproval | +1 | 10 | 25 | -3 | 0 |
| DisruptiveEntrant | +1 | 30 | 80 | -15 | 0 |
| FraudScandal | -1 | 30 | 70 | -3 | -2 |
| ProductRecall | -1 | 15 | 40 | +5 | -5 |
| KeyPersonLoss | -1 | 5 | 20 | +1 | 0 |
| AntitrustRuling | -1 | 10 | 30 | -3 | 0 |
| ActivistTakeover | +1 | 10 | 25 | +2 | 0 |

All values are percentage points of the initial impulse on the
company itself; ripples are added in fractional-return terms to the
competitor/supplier companies' breakthrough impulses.

### 8.3 Admin injection

When `breakthroughs.adminInjectEnabled = true`, an Admin player can
fire any `(archetypeId, companyId, severity)` directly. This skips
the dice rolls and goes straight to step 4. Used for narrative /
story-driven sessions.

### 8.4 Why bucketed tiers (not Pareto)?

The earlier design used a truncated Pareto distribution
(`alpha = 1.5`, range 0.1..1.0). It produced realistic fat-tail
behaviour but was opaque to designers: a `severity = 0.42` draw
told you nothing about how that compared to a typical event.

Bucketed tiers give designers a recognisable "small / medium /
huge" vocabulary. Event-log readouts can say "huge
BreakthroughInvention" or "small EfficiencyGain", and the
probability of each is one number in `tuning.json` they can
directly tweak.

---

## 9. Complete variable and constant reference

This is the canonical "what is this number and where does it live"
table. Every state variable and every constant referenced by the
pricing model is here.

### 9.1 Per-session state (lives in `Session`)

| Name | Type | Meaning | Snapshot? |
|---|---|---|---|
| `seed` | uint64 | RNG seed for this session. | yes |
| RNG cursor | (internal) | How far through the RNG stream we are. | yes |
| `tickIndex` | int | Number of ticks elapsed since session start. | yes |
| `speed` (current/requested) | int | Speed multiplier; locked to 1 in MP. | yes |
| `nextOrderId` | int | Server-assigned counter for new orders. | yes |
| `nextOrderSeq` | int | Server-assigned sequence number for the order queue. | yes |
| `players[]` | array | Player records (id, displayName, cash, positions). | yes |
| `pendingOrders[]` | array | Orders queued but not yet matched. | yes |
| `macro` block | object | The whole macro state (next table). | yes |
| `eventLog` | array | Public and admin events generated each tick. | yes |

### 9.2 Macro state (lives in `MacroState`)

| Name | Type | Meaning | Clamped to | Visible to Standard? |
|---|---|---|---|---|
| `marketMood` | double | 0..1 mood index. | `drift.marketMood.min..max` = `0.05..0.95` | yes |
| `cyclePhase` | enum | `Up` / `Down`. | -- | yes |
| `ticksInPhase` | int | Ticks elapsed in the current phase. | `0..maxTicksPerPhase[phase]` | (admin) |
| `spareNormal` | double? | Buffered second Box-Muller sample. | -- | (admin) |

### 9.3 Per-company state

| Name | Type | Meaning | Visible to Standard? |
|---|---|---|---|
| `sectorId` | string | Which sector. | yes |
| `sharesOutstanding` | long | Total shares issued. | yes |
| `baseFairValue` | double | Per-company anchor, hand-set in tuning. | no |
| `fairValue` | double | `baseFairValue * sectorScalar`. | no |
| `price` (mid) | double | Current price, $0.01 floor. | yes |
| `volume` | long | Cumulative shares traded so far. | yes |
| `breakthroughImpulse` | double | Current decaying fractional-return impulse. | no |
| `hasActiveBreakthrough` | bool | True when `|impulse| > epsilon`. Triggers the 60 % cap. | no |

Per-sector state is just one number: `sectorScalar`. Public.

### 9.4 Tuning constants referenced by the pricing model

Everything below is in [`tuning.json`](./tuning.json).

#### `time`
| Key | Default | Meaning |
|---|---|---|
| `ticksPerYear` | 252 | Ticks in a simulated year. |
| `defaultCareerYears` | 30 | Default career length (= 7,560 ticks). |
| `maxSimYears` | 50 | Stability target (= 12,600 ticks). |
| `tickIntervalMsAt1x` | 1000 | Wall-clock ms per tick at 1x. |

#### `macro.initial`
| Key | Default |
|---|---|
| `cyclePhase` | "Up" |
| `marketMood` | 0.55 |

#### `macro.cycle.minTicksPerPhase` / `maxTicksPerPhase`
| Phase | min ticks | max ticks | min years | max years |
|---|---|---|---|---|
| Up | 504 | 1764 | 2 | 7 |
| Down | 189 | 504 | 0.75 | 2 |

`phaseOrder` is fixed: `Up -> Down -> Up -> Down -> ...`.

#### `macro.drift.marketMood`
| Key | Default | Meaning |
|---|---|---|
| `mean` | 0.55 | Long-term average. |
| `reversion` | 0.0060 | Strength of pull-back per tick. |
| `vol` | 0.0040 | Per-tick random kick sigma. |
| `min` | 0.05 | Hard lower clamp. |
| `max` | 0.95 | Hard upper clamp. |

#### `macro.phaseBias`
| Phase | Per-tick bias on `marketMood` |
|---|---|
| Up | +0.00020 |
| Down | -0.00060 |

Bear markets fall faster than bull markets climb -- the bias
magnitudes are deliberately asymmetric.

#### `impact`
| Key | Default | Used for |
|---|---|---|
| `enabledFromDay1` | true | Whether the channel is on. |
| `impactGain` | 0.01 | Base impact slope. |
| `whaleBonusGain` | 5.0 | Slope from `aumShare` to whale bonus. |
| `whaleBonusCap` | 0.50 | Hard cap on whale bonus (+50 %). |
| `impactCapBps` | 150 | Per-tick impact cap (1.5 %). |
| `baseAdvFraction` | 0.002 | `baseAdv = sharesOutstanding * 0.002`. |

#### `stability`
| Key | Default | Used for |
|---|---|---|
| `dailyMoveCapPct` | 25 | Per-instrument per-tick cap (normal day). |
| `eventDayDailyMoveCapPct` | 60 | Per-instrument cap on event days. |

#### `breakthroughs`
| Key | Default | Used for |
|---|---|---|
| `perCompanyAnnualProbability` | 0.02 | Expected events per company per year. |
| `severityTiers[]` | small 70 %, medium 25 %, huge 5 % | Bucketed severity. |
| `decay.defaultHalfLifeTicks` | 60 | Impulse halves every 60 ticks. |
| `adminInjectEnabled` | true | May Admins fire events directly. |
| `seededRandomEnabled` | true | May the engine roll events on its own. |
| `archetypes[]` | 10 entries | The catalogue of event types. |

#### `multiplayer`
| Key | Default | Used for |
|---|---|---|
| `maxPlayersPerSession` | 8 | Hard cap on players per session. |
| `speedPolicy.allowedSpeedsSolo` | [0, 1, 4, 16, 64] | Solo player speed picks. |
| `speedPolicy.multiplayerLockedTo1x` | true | MP forces 1x. |
| `snapshotEveryTicks` | 252 | Once per simulated year. |
| `orderQueueDeterministicTiebreak` | "playerIdAscending" | Deterministic order in ties. |

#### `pricingKernel.*` (**does not exist in `tuning.json` yet**)

Once the project owner signs off on the coefficient values, a new
`pricingKernel` block goes into `tuning.json`. It will contain:

| Key | Used for | Status |
|---|---|---|
| `fundamentalDriftGain` (`kFund`) | Strength of pull toward fair value. | TBD |
| `moodBeta` | Slope of `moodShock` per unit `marketMood` change. | TBD |
| `noiseSigma` (`kNoise`) | Per-tick Gaussian noise sigma. | TBD |

(Only three coefficients -- down from six in the pre-2026-05-17
design, because `macroBeta[v]` collapsed from 5 to 1, `sectorBeta`
went away entirely with sector-rotation, and `orderFlowGain` /
`orderFlowExponent` collapsed into the single `impact` term.)

#### `fundamentals.*` (**does not exist in `tuning.json` yet**)

For the per-sector `sectorScalar` list and the per-company
`baseFairValue` + `sharesOutstanding` list. Still TBD pending the
company seed list.

---

## 10. One full tick, narrated end-to-end

Pretend it is tick 1,000 of a 30-year session. There are 4 sectors,
100 companies, 3 players. The macro state was the default at tick 0
and has been wandering since. Here is what the engine does this
tick, in order. Numbers in the example are illustrative -- they
assume the `[TBD]` kernel coefficients above; do not treat them as
specification.

### Step 1: macro step

The macro engine:

1. Checks the cycle clock: we are in `Up`, `ticksInPhase = 1000`.
   That is past `minTicksPerPhase[Up]` = 504 but well below
   `maxTicksPerPhase[Up]` = 1764. So roll the dice: draw one
   uniform `u`. Probability of advancing this tick is
   `p = (1000 - 504) / (1764 - 504) ~ 0.39`. Say `u = 0.71 > 0.39`
   -> stay in `Up`. (`u` was still consumed; that is why the RNG
   cursor advances deterministically.)
2. OU step `marketMood`: draw one Gaussian via Box-Muller and step
   the OU process. Say `marketMood` was `0.55` and the draw nudges
   it to `0.56`.
3. `ticksInPhase` becomes 1001.

RNG budget for the macro step: 1 uniform + 1 normal (one Box-Muller
call, which consumes 2 uniforms internally). Stable every tick.

### Step 2: fundamentals update

For each of the 100 companies, recompute
`fairValue = baseFairValue * sectorScalar`. ACME has
`baseFairValue = 100` and is in the tech sector with
`sectorScalar = 1.20`, so `fairValue = $120.00`.

Yes, this is the entire fundamentals step. Two multiplications per
company. No earnings model, no quality curve.

### Step 3: pricing kernel (the heart of it)

For ACME, with `prevPrice = $100.00`, `fairValue = $120.00`,
`marketMood = 0.56`, `prevMarketMood = 0.55`, no active
breakthrough, small net buy (+500 shares), no whales involved,
`baseAdv = 20,000`:

```text
fundamentalDrift     = kFund * (ln(120.00) - ln(100.00))
                     ~ 0.002 * 0.1823                  = +0.000365   (+3.65 bp)
moodShock            = moodBeta * (0.56 - 0.55)
                     = 1.0 * 0.01                      = +0.0100     (+100 bp)
breakthroughImpulse  =  0
impact               = 0.01 * (500/20000) * (1+0) * 10000
                     = 2.5 bps                         = +0.000250   (+2.5 bp)
noise                = 0.005 * z  (z = -0.42)          = -0.00210    (-21.0 bp)
                                                         ----------
priceReturnRaw                                          ~ +0.00852   (+85.2 bp)
```

Stability cap on a normal day = +/- 25 %. `|+0.00852| << 0.25` ->
no clamp. So `priceReturn = +0.00852` and
`newPrice = max(0.01, 100.00 * (1 + 0.00852)) = $100.85`.

RNG budget for the kernel: exactly 1 normal per company. With 100
companies, 100 normals.

### Step 4: order matching

(Phase 2+) Pair buy and sell orders in their server-assigned
`(seq, id)` order, fill them at the new price, update player cash
and positions, append fill events to the event log.

### Step 5: breakthrough roll & decay

For each company, draw one uniform from the RNG. With per-tick
probability `0.02 / 252 ~ 0.0000794`, almost every roll fails.
Suppose one of the 100 companies rolls a success:

- Draw one uniform for archetype pick (uniform over 10).
- Draw one uniform `u1` for the tier pick. Say `u1 = 0.62` -> falls
  in the first 0.70 bucket -> tier is `small`.
- Draw one uniform `u2 = 0.5` for the in-tier severity ->
  `severity = lerp(0.10, 0.25, 0.5) = 0.175`.
- Build the impulse and any ripples on competitors/suppliers.

All existing impulses decay by `0.5^(1/60)` ~ 0.9885 (lose about
1.15 % of their strength each tick).

RNG budget for breakthroughs: 100 uniforms (1 per company for the
Bernoulli) + 0 or more triples (3 uniforms per fired event:
archetype, tier, in-tier severity).

### Step 6: event log and tick advance

Append everything that just happened (phase rolls, breakthroughs,
fills) to the event log. `tickIndex` becomes 1001.

### Step 7: optional snapshot

Every 252 ticks (= once per simulated year), write a snapshot.

That is the whole tick. The next tick consumes the same RNG budget
in the same order, which is what makes the simulation bit-exact
reproducible.

---

## 11. Determinism and snapshots, in 10 lines

1. One xoroshiro128** RNG per session, seeded explicitly.
2. Every random draw goes through it. No `Random.Shared`,
   `DateTime.Now`, `Guid.NewGuid()`, or hash-set iteration order
   anywhere in engine code.
3. Iteration over hash-based collections is sorted by a stable key
   (usually `Id`) before use.
4. Order ids and sequence numbers come from server-side counters,
   never from clients.
5. Snapshots include everything needed to resume: seed, RNG cursor,
   `tickIndex`, speeds, order counters, players, pending orders,
   the macro block (`marketMood`, `cyclePhase`, `ticksInPhase`,
   `spareNormal`), per-company `breakthroughImpulse`, and the
   event log.
6. Snapshots have a `SchemaVersion`. Adding fields requires bumping
   the version and writing a migration that re-seeds missing fields
   from `tuning.*.initial`.
7. Unknown schema versions throw -- never guess.
8. Restoring a snapshot, then advancing N ticks, must produce a
   byte-for-byte identical snapshot to advancing the original N
   ticks. This is the **bit-exact** guarantee.
9. xUnit tests assert known RNG sequences for known seeds
   (`Rng` already has parity tests for seeds 42, 1, 123).
10. This is what makes multiplayer fair and replays possible.

---

## 12. Open questions and TBDs in one place

Most of the items here used to be a long list. The section 13
simplifications closed many of them. What remains:

### Pricing-kernel coefficients (will land in a new `tuning.pricingKernel.*` block)

- `fundamentalDriftGain` (`kFund`).
- `moodBeta`.
- `noiseSigma` (`kNoise`).
- Confirmation of the proposed functional shapes: log-space drift,
  linear mood beta, scalar Gaussian noise.

### Fundamentals seed list (will land in a new `tuning.fundamentals.*` block)

- The list of sectors (id, `sectorScalar`).
- The list of companies (id, `sectorId`, `baseFairValue`,
  `sharesOutstanding`).

### Breakthroughs

- The competitor/supplier graph: probably a per-company
  `relations: { competitors: [...], suppliers: [...] }` block
  inside `tuning.fundamentals.companies[*]`.

### Closed by 2026-05-17 simplifications

- ~~`fairValue` formula -- now `baseFairValue * sectorScalar`.~~
- ~~`baseAdv` source -- now `sharesOutstanding * baseAdvFraction`.~~
- ~~Five `macroBeta[v]` coefficients -- collapsed to one `moodBeta`.~~
- ~~Per-sector `sectorBeta[sectorId]` -- sector-rotation removed.~~
- ~~`orderFlowGain` and `orderFlowExponent` -- folded into the
  single `impact` term.~~
- ~~Player-feedback sign error -- dissolved with the single-term
  `impact` formula.~~

---

## 13. Simplifications applied 2026-05-17

This is the **retrospective** version of what used to be a list of
"could be simpler" questions. The project owner reviewed all 8
proposals and authorised implementing all of them. The rationale
and trade-off for each is captured below so future agents (and
future you) understand why the design looks the way it does.

The standing principle the owner restated alongside this decision:
**WSR2 is a game, not a real-market simulator. The model only has
to feel fair, reactive, and fun across a 30-year career.**

### 13.1 Macro: five variables -> one (`marketMood`)

**Before.** `gdpGrowth`, `inflation`, `policyRate`, `creditSpread`,
`consumerSentiment` -- each with its own OU process, mean,
reversion, vol, min, max, and per-phase bias matrix.

**After.** Just `marketMood`. The pricing kernel only ever
consumed these variables via `betaMacro[v] * delta(macro[v])`, so
collapsing five into one cost ~one-fifth the tuning surface for
identical behaviour at the kernel level.

**Trade-off accepted.** The event log can no longer say "inflation
is rising while growth holds steady" -- that narrative colour is
gone. The owner judged this colour was not worth the complexity.

### 13.2 Cycle: four phases -> two (`Up` / `Down`)

**Before.** `Expansion -> Peak -> Contraction -> Trough -> Expansion`
with separate min/max lengths per phase and a 4-by-5 `phaseBias`
matrix.

**After.** Just `Up <-> Down`. Two min/max length entries and a
single per-phase bias on `marketMood`.

**Trade-off accepted.** No distinct "top of the boom" or
"bottom of the bust" feeling. Boom/bust still happen because the
OU + bias still produces them; we just label them with two names
instead of four.

### 13.3 OU drift: kept (already minimal at 1 variable)

**Before.** Five OU processes per tick, five normals consumed.

**After.** One OU process per tick, one normal consumed.

**Note.** section 13 originally proposed replacing OU with "a yearly
random kick within a band". Once we collapsed to one variable,
that proposal lost most of its appeal: one OU step is three lines
of arithmetic and one Gaussian draw, which is already minimal.
Keeping OU means we keep the existing parity-test infrastructure
(`RngParityTests` already covers Box-Muller for the seeds 42, 1,
123) and the macro layer reads naturally to a novice C# developer.

### 13.4 `fairValue`: drop earnings/quality/PE -> `baseFairValue * sectorScalar`

**Before.** `fairValue = sector.pe * ttmEarnings *
qualityMultiplier(qualityScore)` with `ttmEarnings`, `qualityScore`,
sector P/E response curves, all TBD.

**After.** `fairValue = company.baseFairValue * sector.scalar`.
Two designer-set numbers.

**Trade-off accepted.** No "earnings season" mechanic. No story
about a company growing its business over a 30-year career. If
designers want a company to be more valuable they edit
`baseFairValue` in `tuning.json`. The game's drama comes from
breakthroughs and the kernel's other forces; the fair-value anchor
just needs to exist, not evolve.

### 13.5 Impact: two channels -> one (combined `impact`)

**Before.** Two kernel components: `orderFlowImpact` (power-law in
order size) and `playerFeedback` (a different formula with an
inflated-ADV trick that had a flagged sign bug).

**After.** One kernel component `impact`:
`impactGain * (netSignedQty / baseAdv) * (1 + whaleBonus)` capped
at 150 bp.

**Trade-off accepted.** No sub-linear power law on order size
(would have damped truly enormous orders proportionally less than
small ones); the linear-times-whale-bonus combination is good
enough for game purposes and the 150 bp cap handles the worst case
anyway. **Side benefit:** the flagged sign bug in the old section 10.6
formula dissolved with the rewrite.

### 13.6 Severity: truncated Pareto -> three buckets

**Before.** `severityDistribution: { truncatedPareto, alpha: 1.5,
min: 0.1, max: 1.0 }`. Realistic fat-tail; opaque to designers.

**After.** Three named tiers:
- `small`: probability 0.70, severity 0.10..0.25
- `medium`: probability 0.25, severity 0.25..0.50
- `huge`: probability 0.05, severity 0.50..0.80

**Trade-off accepted.** No mathematical fat tail. (In exchange,
designers can edit one number to make huge events more or less
common, and event-log entries can say "huge
BreakthroughInvention" in plain English.)

### 13.7 Stability caps: three stacked -> one

**Before.** Per-instrument cap (25 %) + per-sector budget (15 %) +
per-market budget (8 %). Stacked, in order.

**After.** Per-instrument cap only. 25 % normal day, 60 % event
day.

**Trade-off accepted.** No cross-stock coupling: a "the whole
market is up 8 % already this tick, scale everyone down" feature
is gone. (In exchange, the kernel becomes stateless across stocks
within a tick -- you can compute every stock's new price in any
order, or in parallel, with bit-exact results. The earlier design
required summing absolutes across stocks before scaling.)

### 13.8 `creditSpread`: dropped entirely

**Before.** Standard-role players couldn't see `creditSpread`, but
the engine still simulated it.

**After.** Subsumed by the collapse of five macro variables to one
in section 13.1. Doesn't exist at all.

**Trade-off accepted.** None worth mentioning -- the field was
hidden anyway, and the kernel never read it for its own
narrative value.

### What the owner's decision did NOT change

These are still firmly in place:

- Determinism and bit-exact snapshots.
- Tunability via `tuning.json`.
- Server-authoritative order ids/seqs.
- Deny-by-default visibility map.
- Multiplayer locked to 1x.
- 30-year career length with 50-year stability headroom.
- The 7-step (was 9) fixed tick pipeline ordering.

---

## Where to look next

- [`AGENTS.md`](./AGENTS.md) section 10 -- the authoritative design
  contract. If anything in this file disagrees with that section,
  that section wins.
- [`tuning.json`](./tuning.json) -- the live values for every
  constant referenced here.
- [`AGENTS.md`](./AGENTS.md) section 11 -- the phased build order;
  Phase 1 ("simulation engine") is the slice that will turn this
  document into running C# code.
- [`AGENTS.md`](./AGENTS.md) section 13 -- process rules; the most
  important one for this model is "do not invent TBD values; ask
  the owner."
