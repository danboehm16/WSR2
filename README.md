# WSR2

A multiplayer-ready stock-market simulation game.

This repository contains the **Phase 0 foundations**: the architectural
scaffolding the rest of the simulator will be built on. There is no pricing
kernel, no instruments, and no UI yet — Phase 0 deliberately ships the spine
(determinism, role-based visibility, multiplayer session/tick loop, tunability)
so that nothing has to be retrofitted later.

## What's in Phase 0

| Concern | Where | Notes |
|---|---|---|
| All design constants | `tuning.json` | Loaded & validated at startup. **Nothing in code hard-codes a tunable.** |
| Tuning loader | `src/tuning.ts` | Fail-fast schema validation. |
| Deterministic PRNG | `src/rng.ts` | xoroshiro128** with snapshot/restore — required for replay & MP determinism. |
| Role-based visibility | `src/visibility.ts` | Server-side filter. Deny-by-default for unknown fields/roles. |
| Session + tick loop | `src/session.ts` | Server-authoritative. Deterministic order queue. Snapshot/restore (schema v2). |
| Macro environment | `src/macro.ts` | 4-phase business cycle + OU drift on GDP / inflation / policy rate / credit spread / consumer sentiment. Driven from session RNG. |

### Decisions baked in from the design discussion

1. **30-year default career.** `time.defaultCareerYears = 30`, `ticksPerYear = 252`. Stability is a guarantee for at least 30 years of simulated time; `maxSimYears = 50` gives headroom.
2. **Role-based visibility.** Two built-in roles, `Admin` and `Standard`. Per-field map in `tuning.json` controls what each role sees. Filtering happens server-side at the serialization boundary so privileged data never leaves the server.
3. **Everything tunable.** Magnitudes, probabilities, caps, the visibility map itself, breakthrough archetypes — all in `tuning.json`.
4. **Player feedback enabled from day 1.** `feedback.playerWealthEffect.enabledFromDay1 = true`. Effect strength scales with AUM share of total market cap.
5. **Multiplayer-ready from day 1.** `Session` supports 1..N players with deterministic, server-stamped order queueing and bit-exact snapshots.
6. **Speed policy.** Solo player can choose any speed in `allowedSpeedsSolo`. As soon as a second player joins, speed is locked to 1×. Admins can override the lock for narrative use.
7. **Public leaderboard by default** (`leaderboard.publicByDefault = true`).
8. **Breakthrough events.** Defined as data in `tuning.json` (`breakthroughs.archetypes`). Both seeded-random generation and admin injection are enabled. Engine wiring lands in a later phase.

## Install & run

```bash
npm install
npm run lint    # type-check only (no emit)
npm test        # runs the vitest suite
npm run build   # emits dist/
```

## Repository layout

```
src/
  tuning.ts       # config loader + types
  rng.ts          # deterministic seeded PRNG
  visibility.ts   # role-based field filter
  session.ts      # server-authoritative session, tick loop, snapshots
  index.ts        # public re-exports
tests/
  *.test.ts       # vitest suites
tuning.json       # all design constants
```

## What's next

Phase 1 continues with **company fundamentals** (sector groupings, earnings,
quality, fair-value priors) and the **pricing kernel** (translates
fundamentals + macro + order flow into prices, subject to the stability caps
in `tuning.json`). Both will plug into the existing `Session.tick()` after the
macro step that's now in place. The breakthrough-event subsystem then layers
on top of the same event log used today for `adminInject`.
