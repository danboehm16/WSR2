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
fun across a 30-year career. Anything that does not earn its keep
toward that goal is a candidate for simplification -- see
[section 13](#13-game-vs-realism-notes-where-the-design-could-be-simpler)
at the end of this file.

---

## Table of contents

1. [The model in 12 lines](#1-the-model-in-12-lines)
2. [Glossary: every term defined](#2-glossary-every-term-defined)
3. [Time: what a "tick" is](#3-time-what-a-tick-is)
4. [The three layers of the world](#4-the-three-layers-of-the-world)
5. [The pricing kernel as a story](#5-the-pricing-kernel-as-a-story)
6. [The safety nets (stability caps)](#6-the-safety-nets-stability-caps)
7. [How player trades move prices](#7-how-player-trades-move-prices)
8. [The news engine (breakthroughs)](#8-the-news-engine-breakthroughs)
9. [Complete variable and constant reference](#9-complete-variable-and-constant-reference)
10. [One full tick, narrated end-to-end](#10-one-full-tick-narrated-end-to-end)
11. [Determinism and snapshots, in 10 lines](#11-determinism-and-snapshots-in-10-lines)
12. [Open questions and TBDs in one place](#12-open-questions-and-tbds-in-one-place)
13. [Game-vs-realism notes (where the design could be simpler)](#13-game-vs-realism-notes-where-the-design-could-be-simpler)

---

## 1. The model in 12 lines

1. Time advances in fixed-size beats called **ticks**. One tick = one
   trading day. A 30-year career = 7,560 ticks.
2. Each tick the engine runs nine steps in a fixed order. Step 4 is
   the **pricing kernel** -- the only place where a stock's price
   actually changes.
3. The world has three layers stacked on top of each other:
   **macro** (whole economy) -> **sector** (groups of similar
   companies) -> **company** (the individual stock).
4. Macro state is five slow-moving numbers (growth, inflation,
   interest rate, credit spread, consumer sentiment) and a 4-phase
   business cycle (Expansion -> Peak -> Contraction -> Trough).
5. Each macro number wanders around its long-term average, nudged
   slightly by the current cycle phase. This produces realistic-looking
   ups and downs without any single "boom" or "bust" being scripted.
6. Each company has a hidden **fair value** -- what we think the stock
   "should" cost based on its earnings and which sector it is in. The
   pricing kernel pulls the price toward this number over time.
7. Each tick the kernel adds seven small nudges together to produce
   the day's return: (a) the pull toward fair value, (b) the whole
   market reacting to macro changes, (c) the sector reacting to its
   own changes, (d) any active news event, (e) the passive impact of
   trades queued this tick, (f) extra impact when very big players
   trade, (g) random Gaussian noise.
8. The sum is then clamped by three safety nets so no single tick,
   sector, or whole market can move further than the limits in
   [`tuning.json`](./tuning.json)'s `stability` block.
9. Prices never go to zero -- there is a hard floor at $0.01.
10. **News events** ("breakthroughs") -- inventions, scandals, recalls
    -- are picked from a data table of archetypes. They give a single
    big push that then fades away over about 60 ticks.
11. **Determinism**: the same starting seed always produces the same
    sequence of prices, on any machine. This is what makes multiplayer
    fair and replays possible.
12. **Tunability**: every magnitude in the model lives in
    [`tuning.json`](./tuning.json). No number a designer might want to
    tweak is ever hard-coded.

---

## 2. Glossary: every term defined

These terms come up everywhere in finance. Read them once and you
will be able to follow the rest of this file.

### Trading basics

- **Stock (a.k.a. share, equity)** -- a tiny piece of ownership in a
  company. If a company has 1,000,000 shares and you own 1, you own
  one-millionth of it.
- **Shares outstanding** -- the total number of shares the company
  has issued. Used to compute market cap.
- **Float** -- the fraction of those shares that is actually
  available to trade (some shares are held long-term and never sold).
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
  current mid-price). Used to size the player-feedback channel and
  to rank the leaderboard.
- **Market cap** -- `sharesOutstanding * price`. The total dollar
  value of the whole company.

### Returns and percentages

- **Return** -- the percentage change in price between two moments.
  WSR2 uses **fractional returns**: `+0.01` means "+1 %".
- **Per-tick return** -- the fractional change in one tick.
  `newPrice = prevPrice * (1 + return)`.
- **Basis point (bp)** -- 1/100 of a percent. `1 bp = 0.0001`.
  `150 bp = 1.50 %`. Finance people use this because percentages of
  percentages get confusing fast.

### The "fair value" idea

- **Earnings** -- the company's profit. The more money it makes, the
  more each share should be worth.
- **TTM earnings (trailing twelve months)** -- the company's profit
  over the most recent year. In WSR2 this is recomputed each tick
  from the macro and sector state.
- **P/E ratio (price-to-earnings)** -- `price / earnings`. A rough
  shorthand for "how much investors pay per dollar of profit." If
  P/E is 20 and earnings are $5/share, the price should be about
  $100/share.
- **Fair value** -- WSR2's hidden "what should this stock cost?"
  anchor, recomputed each tick from earnings and the sector's P/E.
  The pricing kernel uses fair value to pull the price back toward
  reasonable, so the market does not drift to absurd numbers.
- **Quality score** -- a slow-moving 0..1 number for each company,
  meant to nudge the fair-value formula up for "high-quality"
  companies. (Exactly how it does that is still
  [TBD](#12-open-questions-and-tbds-in-one-place).)

### The wider world

- **Sector** -- a group of similar companies (e.g. all tech firms,
  all banks). Each company belongs to exactly one sector. Sectors
  let the model say "tech is up today but banks are down" without
  needing per-company news.
- **Sector P/E** -- the typical price-to-earnings ratio for that
  sector. Drives fair value.
- **Sector rotation** -- the real-world pattern that different
  sectors lead the market at different points in the business cycle
  (e.g. cyclical industries do well in Expansion; defensive ones do
  well in Contraction). WSR2 captures this with a single per-sector
  `rotationFactor` value per tick.
- **Macro** -- the big-picture economy. WSR2 tracks five macro
  numbers (see [section 4](#4-the-three-layers-of-the-world)) plus a
  business-cycle phase.
- **Business cycle** -- the slow rhythm of growth and recession.
  WSR2 simulates it with four named phases in a fixed loop:
  `Expansion -> Peak -> Contraction -> Trough -> Expansion -> ...`

### Liquidity and impact

- **ADV (average daily volume)** -- how many shares typically change
  hands per day. A stock with high ADV is "liquid" -- big orders
  barely move its price. A stock with low ADV is "illiquid" -- the
  same big order can swing the price a lot.
- **baseAdv** -- WSR2's per-company baseline ADV. Exact formula is
  [TBD](#12-open-questions-and-tbds-in-one-place); most likely
  `sharesOutstanding * float * turnover` where `turnover` is a new
  tunable number.
- **Price impact** -- how far your trade moves the price. In WSR2
  this is a function of `orderQuantity / ADV`: the more of the day's
  volume you take, the more the price moves against you.

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
  idea: a number that randomly wanders around but is gently pulled
  back toward a long-term average. WSR2 uses one OU process per
  macro variable so they wander realistically without drifting away
  forever. The pull-back strength is the **reversion** rate.
- **Mean** -- the long-term average the OU process wanders around.
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
- A **simulated year** is `time.ticksPerYear` = **252 ticks**
  (chosen because real stock markets have ~252 trading days/year --
  it makes the macro tuning numbers feel right, but the engine does
  not actually care about that pedigree).
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
                | Macro (5 numbers +   |
                | cycle phase)         |
                +----------+-----------+
                           v
            +--------------+--------------+
            | Sectors (earningsGrowth,    |
            | rotationFactor, P/E)        |
            +--------------+--------------+
                           v
            +--------------+--------------+
            | Companies (ttmEarnings,     |
            | qualityScore, fairValue)    |
            +-----------------------------+
                           v
                       prices
```

### 4.1 Macro layer (the whole economy)

Five numbers, all evolving slowly via OU drift:

| Field | What it means in one sentence | Default | Range |
|---|---|---|---|
| `gdpGrowth` | How fast the economy is growing each year. | `0.025` (=2.5 %/yr) | `-0.06 .. 0.07` |
| `inflation` | How fast prices in general are rising. | `0.022` (=2.2 %/yr) | `-0.02 .. 0.10` |
| `policyRate` | The central bank's interest rate -- the price of borrowing money. | `0.03` (=3 %) | `0.0 .. 0.12` |
| `creditSpread` | Extra interest companies pay above the policy rate; rises in scary times. | `0.012` (=1.2 %) | `0.001 .. 0.08` |
| `consumerSentiment` | A 0..1 mood index; how confident shoppers feel. | `0.55` | `0.05 .. 0.95` |

Plus one cycle variable `cyclePhase` which is one of four named
phases. Each phase has a min/max length and gets nudged toward the
next one on a linear-ramp probability between those bounds
(`macro.cycle.minTicksPerPhase` / `maxTicksPerPhase`).

The five OU processes each have four numbers in
`macro.drift[var]`:

- `mean` -- the long-term average to drift toward.
- `reversion` -- how strongly to pull back each tick. Larger =
  snappier.
- `vol` -- the per-tick random kick size.
- `min` / `max` -- hard clamp range.

Plus a small per-phase **bias** in `macro.phaseBias[phase][var]`
that nudges each variable up or down based on the current cycle
phase (e.g. `gdpGrowth` gets a `-0.00040` per-tick nudge during
`Contraction`, so recessions actually feel like recessions).

### 4.2 Sector layer (groups of companies)

Per tick, per sector, the engine derives three numbers from the
macro state (the exact formulas are
[TBD](#12-open-questions-and-tbds-in-one-place)):

- `earningsGrowth` -- how fast companies in this sector are growing
  their profits.
- `rotationFactor` -- positive when this sector is leading the
  market right now, negative when it is lagging. Driven by the
  cycle phase (e.g. cyclical sectors get a positive `rotationFactor`
  in `Expansion`, defensive sectors get a positive one in
  `Contraction`).
- `pe` -- the typical price-to-earnings ratio for this sector.

These three numbers feed into both `fairValue` (per company) and
`sectorShock` (per tick, in the pricing kernel).

### 4.3 Company layer (the individual stock)

Per company, recomputed each tick from macro + sector:

| Field | What it means | Visible to Standard? |
|---|---|---|
| `sectorId` | Which sector this company belongs to. | yes |
| `ttmEarnings` | Profit over the last "year" (252 ticks). | yes |
| `qualityScore` | Slow 0..1 score of "how solid this company is". | no |
| `sharesOutstanding` | Total shares issued. | yes |
| `float` | Fraction of shares actually tradable. | yes |
| `fairValue` | Hidden anchor the pricing kernel pulls toward. | no |
| `playerImpactDecay` | A short-half-life accumulator so one big player trade does not re-impact every future tick. | no |

The `fairValue` formula is **not yet decided**; section 10.4 of
AGENTS.md notes it should be something like
`sector.pe * ttmEarnings * qualityMultiplier(qualityScore)` but the
exact shape and the `qualityMultiplier` curve are
[TBD](#12-open-questions-and-tbds-in-one-place).

---

## 5. The pricing kernel as a story

Once per tick, for every company, the kernel runs and produces one
new price. Picture a single stock just sitting there with last
tick's price. Seven separate forces act on it; the kernel adds them
up to get one **return** (the percentage change for this tick),
applies safety brakes, and multiplies last tick's price by
`(1 + return)`.

### 5.1 The seven forces, in plain English

1. **The gravitational pull toward fair value (`fundamentalDrift`)**

   We have a hidden idea of what this stock "should" cost
   (`fairValue`). If the price has drifted away from that anchor,
   nudge it gently back. If `prevPrice = 100` and `fairValue = 102`,
   this force is slightly positive; if `prevPrice = 110` and
   `fairValue = 102`, it is slightly negative. The strength of the
   pull is a tuning knob called `kFund`
   ([TBD](#12-open-questions-and-tbds-in-one-place)).

   *Why we have it:* without it, the stock would random-walk and
   could drift to $0.01 or $1,000,000 forever.

2. **The whole market reacts to macro news (`macroShock`)**

   When `gdpGrowth` went up since last tick, every stock should
   lift a little. When `creditSpread` went up (companies' borrowing
   got more expensive), every stock should sag a little. This force
   is the *change* in each macro variable times a sensitivity
   (`betaMacro[var]`,
   [TBD](#12-open-questions-and-tbds-in-one-place)), summed up.
   Every stock in the market sees the same `macroShock` this tick.

   *Why we have it:* it gives "market days" where everything moves
   together, which feels real.

3. **The sector reacts to its own news (`sectorShock`)**

   Same idea as `macroShock`, but driven by the sector aggregates
   (`earningsGrowth`, `rotationFactor`, `pe`). All stocks in the
   same sector see the same `sectorShock`.

   *Why we have it:* lets tech be up on a day when banks are down,
   without scripting per-company news.

4. **Active news events (`breakthroughImpulse`)**

   If a breakthrough event fired on this company recently, the
   leftover impulse adds to today's return. Initially big, decays
   over about 60 ticks (see [section 8](#8-the-news-engine-breakthroughs)).
   This is already a fractional return; no extra coefficient.

   *Why we have it:* drama. Stocks that just had a "BlockbusterLaunch"
   should jump.

5. **Passive impact of queued orders (`orderFlowImpact`)**

   Add up the orders queued for this stock this tick: net buys
   minus net sells = `netSignedQty`. If players are net buying, the
   price goes up a little even before matching. The bigger the net
   relative to the stock's typical daily volume (`baseAdv`), the
   bigger the push -- but the relationship is **sub-linear** (a
   power law with exponent `alpha < 1`) so a single mega-order
   cannot single-handedly break the price.

   *Why we have it:* buying pressure should visibly affect prices,
   even without big-AUM players.

6. **Bonus impact when very big players trade (`playerFeedback`)**

   If the players queueing orders this tick already own a big chunk
   of the company's market cap, *their* trades land harder than
   anonymous trades of the same size. See
   [section 7](#7-how-player-trades-move-prices) for the formula. Capped
   at `priceImpactCapBps` = 150 bp = 1.50 % per tick.

   *Why we have it:* makes "whales" matter. Without it, the
   richest player feels the same as anyone else.

7. **Random Gaussian wiggle (`noise`)**

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
               + macroShock
               + sectorShock
               + breakthroughImpulse
               + orderFlowImpact
               + playerFeedback
               + noise
```

The order is fixed so debug logs can attribute today's move to a
named cause. Even when a component is currently zero, its slot stays
in the sum.

Then safety nets (next section) clamp the result, and:

```text
newPrice = max(0.01, prevPrice * (1 + clampedReturn))
```

The `max(0.01, ...)` is the hard floor that keeps prices positive.

---

## 6. The safety nets (stability caps)

`priceReturnRaw` could theoretically be huge if every force pulled
the same way at once. We do not want the game to feature random
+200 % days. Three safety nets, applied in order, prevent that.

All three come from `tuning.stability`.

### 6.1 Per-instrument cap

Limit any *single* stock's per-tick move:

- Normal day: +/- `dailyMoveCapPct` = **25 %**.
- Day when a breakthrough event is active on this stock: +/-
  `eventDayDailyMoveCapPct` = **60 %** (so news can actually move
  the price).

If `|priceReturnRaw|` is larger than the cap, clamp it.

### 6.2 Per-sector budget

Add up the absolute returns of every stock in a sector this tick.
If that total exceeds `sectorTickShockBudgetPct` = **15 %**,
proportionally shrink every stock in that sector so the total
matches the budget.

*Why:* prevents a "tech sector up 80 % across the board" tick.

### 6.3 Per-market budget

Same thing, but across the whole market: total absolute return
must not exceed `marketTickShockBudgetPct` = **8 %**.

*Why:* prevents whole-market panic/euphoria from running away.

These caps are deliberately tight. Real markets occasionally do
have +/- 10 % single-day moves; WSR2 will not. That is a
**deliberate game-design choice** -- predictable bounds make the
game playable.

---

## 7. How player trades move prices

Two separate forces, both already mentioned above, work together:

- **`orderFlowImpact`** (kernel component 5) -- passive impact based
  only on *how much* is being traded vs the stock's typical volume.
  Every player counts equally per share.
- **`playerFeedback`** (kernel component 6) -- *bonus* impact when
  the trading players already hold a large chunk of the company.

### 7.1 The `playerFeedback` formula in plain English

```text
aumShare       = (total $ value of all players' positions in this company)
                 / (this company's total market cap)

flowAdd        = min( aumShareToFlowGain * aumShare ,  flowContributionCap )
                                                       # capped at 5 %

effectiveAdv   = baseAdv * (1 + flowAdd)

impactBps      = priceImpactBpsPerAdvPct
                 * (netSignedQty / effectiveAdv) * 100

impactBps      = clamp(impactBps,  -priceImpactCapBps , +priceImpactCapBps)
                                                       # capped at 150 bp

playerFeedback = impactBps / 10000     # convert bp -> fractional return
```

Tuning knobs (already in `tuning.feedback.playerWealthEffect`):

| Knob | Default | What it does |
|---|---|---|
| `aumShareToFlowGain` | `0.5` | How strongly player AUM share inflates assumed ADV. |
| `flowContributionCap` | `0.05` | Max ADV inflation (5 %). |
| `priceImpactBpsPerAdvPct` | `8` | bp of impact per 1 % of ADV traded. |
| `priceImpactCapBps` | `150` | Hard cap on per-tick impact (1.5 %). |

### 7.2 Heads-up: there is a flagged design question here

This formula has an **unresolved sign question** flagged in
AGENTS.md section 10.6: with `effectiveAdv = baseAdv * (1 + flowAdd)`,
larger player AUM *increases* the assumed ADV, which *decreases*
the impact. That is the opposite of the stated intent ("very large
players move markets noticeably more").

This file deliberately reproduces the current formula faithfully
rather than silently fixing it. The owner needs to decide whether
the divisor should be `(1 - flowAdd)`, whether `flowAdd` should
apply to the numerator instead, or whether the intent statement
itself should be reworded. See
[section 12](#12-open-questions-and-tbds-in-one-place).

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
   see the [reference table](#96-tuning-constants-referenced-by-the-pricing-model)).
3. **Pick a severity.** Drawn from a truncated Pareto distribution
   (`alpha = 1.5`, range 0.1 .. 1.0). Translation: most events are
   small, but you occasionally get a big one -- the bell-curve has
   a fat tail.
4. **Build the impulse.** Use the archetype's `direction`,
   `minPct`, `maxPct` to compute the initial size of the shock:

   ```text
   impulse = direction * lerp(minPct, maxPct, severity) / 100
   ```

   Also build smaller ripple impulses for competitor and supplier
   companies, scaled by `rippleCompetitorsPct` and
   `rippleSuppliersPct`. (The competitor/supplier graph itself is
   [TBD](#12-open-questions-and-tbds-in-one-place).)
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
the dice roll and severity sampling but runs the same impulse
construction. Used for narrative / story-driven sessions.

### 8.4 Why this design

It is **data-driven** -- the engine never hard-codes "what a fraud
scandal does". Designers can add archetypes by editing
`tuning.json`. New archetype + new column in the visibility map and
you are done.

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
| `gdpGrowth` | double | Real GDP growth (annual decimal). | `drift.gdpGrowth.min..max` = `-0.06..0.07` | yes |
| `inflation` | double | CPI inflation (annual decimal). | `-0.02..0.10` | yes |
| `policyRate` | double | Central-bank short rate. | `0..0.12` | yes |
| `creditSpread` | double | Corporate-bond spread over policy rate. | `0.001..0.08` | no |
| `consumerSentiment` | double | 0..1 mood index. | `0.05..0.95` | yes |
| `cyclePhase` | enum | Expansion / Peak / Contraction / Trough. | -- | no |
| `ticksInPhase` | int | Ticks elapsed in the current phase. | `0..maxTicksPerPhase[phase]` | (admin) |
| `spareNormal` | double? | Buffered second Box-Muller sample, or null. | -- | (admin) |

### 9.3 Per-sector state (computed every tick from macro)

| Name | Type | Meaning | TBD? |
|---|---|---|---|
| `earningsGrowth` | double | Per-sector profit growth rate. | formula TBD |
| `rotationFactor` | double | Positive when this sector leads. | formula TBD |
| `pe` | double | Sector-level price/earnings ratio. | formula TBD |

### 9.4 Per-company state

| Name | Type | Meaning | Visible to Standard? |
|---|---|---|---|
| `sectorId` | string | Which sector. | yes |
| `sharesOutstanding` | long | Total shares issued. | yes |
| `float` | double | Fraction tradable. | yes |
| `ttmEarnings` | double | Profit over last 252 ticks. | yes |
| `qualityScore` | double (0..1) | Slow-moving competitive-position score. | no |
| `fairValue` | double | Hidden mean-reversion anchor. | no |
| `playerImpactDecay` | double | Decaying record of recent player impact. | no |
| `price` (mid) | double | Current price, $0.01 floor. | yes |
| `volume` | long | Cumulative shares traded so far. | yes |
| `hasActiveBreakthrough` | bool | Is there a non-zero impulse on us? | no |
| `breakthroughImpulse` | double | Current decaying fractional-return impulse. | no |

### 9.5 Per-tick scratch state (the kernel reads these but they do not need to be in the snapshot)

| Name | Type | Meaning |
|---|---|---|
| `netSignedQty` (per company) | long | Sum of queued order quantities, buys positive, sells negative. |
| `playerAumInCompany` (per company) | double | Sum over all players of `sharesInCompany * prevPrice`. |
| `companyMarketCap` | double | `sharesOutstanding * prevPrice`. |
| `baseAdv` | double | Baseline ADV; formula [TBD](#12-open-questions-and-tbds-in-one-place). |
| `prevMacroState` | object | Last tick's macro snapshot, so the kernel can compute deltas. |

### 9.6 Tuning constants referenced by the pricing model

Everything below is in [`tuning.json`](./tuning.json).

#### `time`
| Key | Default | Meaning |
|---|---|---|
| `ticksPerYear` | 252 | Ticks in a simulated year. |
| `defaultCareerYears` | 30 | Default career length (= 7,560 ticks). |
| `maxSimYears` | 50 | Stability target (= 12,600 ticks). |
| `tickIntervalMsAt1x` | 1000 | Wall-clock ms per tick at 1x. |

#### `macro.initial` -- seed values for a brand-new session
| Key | Default |
|---|---|
| `cyclePhase` | "Expansion" |
| `gdpGrowth` | 0.025 |
| `inflation` | 0.022 |
| `policyRate` | 0.03 |
| `creditSpread` | 0.012 |
| `consumerSentiment` | 0.55 |

#### `macro.cycle.minTicksPerPhase` / `maxTicksPerPhase`
| Phase | min ticks | max ticks | min years | max years |
|---|---|---|---|---|
| Expansion | 504 | 1764 | 2 | 7 |
| Peak | 63 | 252 | 0.25 | 1 |
| Contraction | 189 | 504 | 0.75 | 2 |
| Trough | 63 | 189 | 0.25 | 0.75 |

The phaseOrder is fixed: `Expansion -> Peak -> Contraction -> Trough -> Expansion -> ...`.

#### `macro.drift[var]` -- the OU process for each variable
Each variable has: `mean`, `reversion`, `vol`, `min`, `max`.

| Variable | mean | reversion | vol | min | max |
|---|---|---|---|---|---|
| gdpGrowth | 0.025 | 0.0040 | 0.0009 | -0.06 | 0.07 |
| inflation | 0.022 | 0.0030 | 0.0007 | -0.02 | 0.10 |
| policyRate | 0.03 | 0.0020 | 0.0005 | 0.00 | 0.12 |
| creditSpread | 0.012 | 0.0050 | 0.0006 | 0.001 | 0.08 |
| consumerSentiment | 0.55 | 0.0060 | 0.0040 | 0.05 | 0.95 |

How to read it: each tick, `x_next = x + reversion * (mean - x) + phaseBias + vol * Normal(0,1)`, then clamp to `[min, max]`.

#### `macro.phaseBias[phase][var]` -- per-phase nudge

The full 4-by-5 matrix is in `tuning.json`. Picture it as: each
phase gently steers each macro variable in a particular direction.
Highlights:
- `Expansion`: nudges `consumerSentiment` up.
- `Peak`: nudges `inflation` and `policyRate` up.
- `Contraction`: nudges `gdpGrowth` and `consumerSentiment` down,
  `creditSpread` up.
- `Trough`: gently negative nudges everywhere, smaller magnitudes.

#### `feedback.playerWealthEffect`
| Key | Default | Used for |
|---|---|---|
| `enabledFromDay1` | true | Whether the feedback channel is on. |
| `aumShareToFlowGain` | 0.5 | Slope from AUM share to ADV inflation. |
| `flowContributionCap` | 0.05 | Max ADV inflation (5 %). |
| `priceImpactBpsPerAdvPct` | 8 | Slope from order/ADV to impact bps. |
| `priceImpactCapBps` | 150 | Per-tick impact cap (1.5 %). |

#### `stability`
| Key | Default | Used for |
|---|---|---|
| `dailyMoveCapPct` | 25 | Per-instrument per-tick cap (normal day). |
| `eventDayDailyMoveCapPct` | 60 | Per-instrument cap on event days. |
| `sectorTickShockBudgetPct` | 15 | Per-sector per-tick total absolute return budget. |
| `marketTickShockBudgetPct` | 8 | Per-market per-tick total absolute return budget. |

#### `breakthroughs`
| Key | Default | Used for |
|---|---|---|
| `perCompanyAnnualProbability` | 0.02 | Per-company expected events per year. |
| `severityDistribution` | truncated Pareto, alpha=1.5, 0.1..1.0 | How dramatic events tend to be. |
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

#### `pricingKernel.*` (new section; **does not exist yet**)

Once the project owner signs off on the coefficient values, a new
`pricingKernel` block goes into `tuning.json`. AGENTS.md section
10.5 says it will contain:

| Key | Used for | Status |
|---|---|---|
| `fundamentalDriftGain` (`kFund`) | Strength of pull toward fair value. | TBD |
| `macroBeta[var]` (5 entries) | Per-variable sensitivity for `macroShock`. | TBD |
| `sectorBeta[sectorId]` | Per-sector sensitivity for `sectorShock`. | TBD |
| `orderFlowGain` (`kFlow`) | Strength of passive order-flow impact. | TBD |
| `orderFlowExponent` (`alpha`, <1) | Sub-linear power law on order size. | TBD |
| `noiseSigma` (`kNoise`) | Per-tick Gaussian noise sigma. | TBD |

#### `fundamentals.*` (new section; **does not exist yet**)

For the `fairValue` formula and the `baseAdv` formula. Also TBD.

---

## 10. One full tick, narrated end-to-end

Pretend it is tick 1,000 of a 30-year session. There are 4 sectors,
100 companies, 3 players. The macro state was the default at tick 0
and has been wandering since. Here is what the engine does this
tick, in order. Numbers in the example are illustrative -- they
assume the `[TBD]` coefficients above; do not treat them as
specification.

### Step 1: macro step

The macro engine:
1. Checks the cycle clock: we are in `Expansion`, `ticksInPhase = 1000`.
   That is past `minTicksPerPhase[Expansion]` = 504 but well below
   `maxTicksPerPhase[Expansion]` = 1764. So roll the dice: draw one
   uniform `u`. Probability of advancing this tick is
   `p = (1000 - 504) / (1764 - 504) ~ 0.39`. Say `u = 0.71 > 0.39`
   -> stay in Expansion. (`u` was still consumed; that is why the
   RNG cursor advances deterministically.)
2. For each of the five macro variables, in fixed order, draw one
   Gaussian via Box-Muller and step the OU process. Say `gdpGrowth`
   was `0.027` and the draw nudges it to `0.0273`.
3. `ticksInPhase` becomes 1001.

### Step 2: sector update

For each of the 4 sectors, recompute `earningsGrowth`,
`rotationFactor`, `pe` from the new macro state. (Exact formula
TBD; conceptually: cyclical sectors get a positive `rotationFactor`
because we are in `Expansion`; sector P/E rises slightly when
`policyRate` falls.)

### Step 3: company fundamentals update

For each of the 100 companies, recompute `ttmEarnings`,
`qualityScore`, and `fairValue` from macro + sector. Suppose ACME
ends up with `ttmEarnings = $4.50/share`, `qualityMultiplier =
1.05`, sector P/E `= 21`, so `fairValue = 21 * 4.50 * 1.05
= $99.23`.

### Step 4: pricing kernel (the heart of it)

For ACME, with `prevPrice = $100.00`, `fairValue = $99.23`, no
active breakthrough, illustrative coefficients:

```text
fundamentalDrift     = kFund * (ln(99.23) - ln(100.00))
                     ~ 0.002 * (-0.0077)        = -0.0000154   (-0.15 bp)
macroShock           = sum over 5 vars: betaMacro[v] * (macro[v] - prevMacro[v])
                                                 ~ +0.00010    (+1.0 bp)
sectorShock          = sum over sector aggregates
                                                 ~ +0.00005    (+0.5 bp)
breakthroughImpulse  = 0
orderFlowImpact      = kFlow * sign(netQ) * (|netQ|/baseAdv)^alpha
                       (today netQ = +500 shares, baseAdv = 50,000)
                                                 ~ +0.00015    (+1.5 bp)
playerFeedback       = (see formula in section 7) for whales who own >2 % of ACME
                                                 ~  0          (no whales today)
noise                = kNoise * Gaussian draw
                       (z = -0.42, kNoise = 0.005)
                                                 = -0.00210    (-21.0 bp)

priceReturnRaw       sum                          ~ -0.00190    (-19.0 bp)
```

Stability caps:
- Per-instrument cap on a normal day = 25 % = 0.25.
  `|-0.00190| << 0.25` -> no clamp.
- Sector budget = 15 % across all sector members -> no clamp.
- Market budget = 8 % across whole market -> no clamp.

So `priceReturn = -0.00190`, and
`newPrice = max(0.01, 100.00 * (1 - 0.00190)) = $99.81`.

### Step 5: order matching

(Phase 2+) Pair buy and sell orders in their server-assigned
`(seq, id)` order, fill them at the new price, update player cash
and positions, append fill events to the event log.

### Step 6: feedback decay

Tick down `playerImpactDecay` on every company by its short
half-life so yesterday's whale trade does not influence forever.

### Step 7: breakthrough roll & decay

For each company, draw one uniform from the RNG. With per-tick
probability `0.02 / 252 ~ 0.0000794`, almost every roll fails.
Suppose one of the 100 companies rolls a success: pick an archetype
(uniform over the 10), pick a severity (truncated Pareto), build
the impulse, write impulses on the company and on its competitors
and suppliers (graph TBD). All existing impulses decay by
`0.5^(1/60)` ~ 0.9885 (lose about 1.15 % of their strength each
tick).

### Step 8: event log and tick advance

Append everything that just happened (phase rolls, breakthroughs,
fills) to the event log. `tickIndex` becomes 1001.

### Step 9: optional snapshot

Every 252 ticks (= once per simulated year), write a snapshot. At
tick 1000 there is no snapshot; at tick 1008 (if ticks 0, 252, 504,
756, 1008 are the snapshot ticks) there would be.

That is the whole tick. 100 companies x 1 Gaussian draw each + 5
macro Gaussian draws + 1 cycle-clock draw + 100 breakthrough rolls
+ N order-matching consequences. The next tick consumes the same
RNG budget in the same order, which is what makes the simulation
bit-exact reproducible.

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
   the macro block, and the event log.
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

These items are intentionally left **undecided** in AGENTS.md
section 10. Per the standing rule (AGENTS.md section 13), an agent
must **not invent** any of these values. The project owner needs to
sign off, and the agreed values then go into `tuning.json`.

### Pricing-kernel coefficients (will land in a new `tuning.pricingKernel.*` block)

- `fundamentalDriftGain` (`kFund`).
- `macroBeta[var]` for the 5 macro variables.
- `sectorBeta[sectorId]` for each sector.
- `orderFlowGain` (`kFlow`).
- `orderFlowExponent` (`alpha`, must be `< 1`).
- `noiseSigma` (`kNoise`).
- Confirmation of the proposed functional shapes themselves:
  log-space drift, linear macro/sector betas, power-law order-flow
  impact, scalar Gaussian noise.

### Fundamentals (will land in a new `tuning.fundamentals.*` block)

- The exact `fairValue` formula (probably
  `sector.pe * ttmEarnings * qualityMultiplier(qualityScore)`).
- The `qualityMultiplier` curve.
- Per-tick update rules for `ttmEarnings` and `qualityScore`.
- The list of sectors itself, plus per-sector `betaSector` and `pe`
  baseline.
- The `baseAdv` formula (probably
  `sharesOutstanding * float * turnover`), and where `turnover`
  lives.

### Player feedback

- **Possible sign error in 10.6.** With
  `effectiveAdv = baseAdv * (1 + flowAdd)`, larger AUM share
  *reduces* impact. Opposite of stated intent. Should the divisor
  be `(1 - flowAdd)`, should `flowAdd` apply to the numerator
  instead, or should the intent be reworded?
- **Combination with `orderFlowImpact`.** Today the kernel adds
  them: `... + orderFlowImpact + playerFeedback + ...`. The word
  "amplifier" suggests a multiplier on `orderFlowImpact` instead.
  Pick one.

### Breakthroughs

- The competitor/supplier graph: probably a per-company
  `relations: { competitors: [...], suppliers: [...] }` block in a
  new `tuning.companies.*` section.

### Companies

- The seed list of companies for a brand-new session: count, names,
  sector assignments, initial `sharesOutstanding`, `float`, and
  starting prices.

---

## 13. Game-vs-realism notes (where the design could be simpler)

The user's standing instruction is: **this is a game, not a real
market simulator.** The model only has to feel fair, reactive, and
fun for 30 simulated years. Below are places where the current
design may be more elaborate than the game needs. Each is a
**question for the project owner**, not a unilateral change.

### Could be simpler -- ideas worth discussing

1. **Five macro variables may be too many.** The pricing kernel
   only reads them via `betaMacro[var]`. A single "macro mood"
   number (e.g. just `consumerSentiment`) might give the same
   feel with one-fifth the tuning work. Trade-off: less narrative
   colour ("inflation is up but growth is up too" disappears).

2. **The 4-phase cycle could collapse to 2 phases** (Up / Down)
   with a simple coin-flip transition. Trade-off: loses the
   distinct "Peak" feeling at the top of a boom and the
   "Trough" feeling at the bottom.

3. **OU drift on five variables is mathematically heavy** for a
   game. A simpler "each macro variable wanders within a band and
   gets a random kick each year" would feel similar. Trade-off:
   harder to write parity tests against an existing reference.

4. **Sector P/E and `qualityMultiplier` for `fairValue` may be
   overkill.** A flat `fairValue = baseFairValue * sectorScalar *
   companyScalar` could work, with all three scalars hand-set per
   company and only the per-tick price wandering around it.

5. **`orderFlowImpact` and `playerFeedback` as two separate
   components** add complexity. A single
   `impact = kImpact * netSignedQty / baseAdv * (1 + whaleBonus)`
   may capture everything the game needs.

6. **Truncated Pareto for breakthrough severity** is unusual for a
   game. A flat uniform `[0, 1]` (or a few bucketed tiers: small /
   medium / huge with fixed probabilities) is easier to reason
   about and tune.

7. **Three stability caps stacked** (per-instrument, per-sector,
   per-market) could become one: "no stock moves more than X% per
   tick" enforced *before* summing. Trade-off: loses the realistic
   "the whole market is having a quiet day" coupling.

8. **`creditSpread` is hidden from Standard players today**. If
   players never see it, why simulate it? Either expose it or drop
   it.

If you (the project owner) say "keep all of these, they earn their
keep", that is fine -- this file just documents the alternatives so
the choice is explicit. If you say "yes, simplify N of these", we
can collapse the design before the C# kernel code is written and
save a lot of tuning effort.

### Game-design principles that are non-negotiable

These have already been decided (AGENTS.md section 12) and should
**not** be revisited as a simplification:

- Determinism and bit-exact snapshots stay.
- Tunability via `tuning.json` stays.
- Server-authoritative order ids/seqs stay.
- The deny-by-default visibility map stays.
- Multiplayer locked to 1x stays.
- 30-year career length with 50-year stability headroom stays.

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
