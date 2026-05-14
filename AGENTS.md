# Agent instructions for WSR2

These are the standing rules for any agent (human or AI) making changes to
this repository. They capture decisions the project owner has made and that
must not be silently revisited. If a constraint here ever conflicts with a
short-term instruction, **stop and ask** rather than dropping the constraint.

---

## 1. Language & runtime

- **The core simulation engine MUST be written in C#** (.NET, latest LTS).
  All deterministic, server-authoritative game logic — tuning loader,
  PRNG, session/tick loop, macro engine, fundamentals, pricing kernel,
  order matching, breakthrough engine, snapshots — belongs in the C#
  engine.
- The current TypeScript code under `src/` and `tests/` is an early
  **prototype/spike** that pre-dates this decision. It is kept for
  reference only and will be replaced by the C# implementation. Do not
  add new features to the TypeScript code; port instead.
- Front-end / UI may be a separate language (TypeScript, etc.) talking to
  the C# engine over a defined boundary. That boundary is not yet
  designed.
- Acceptable layout for the C# engine when it lands (suggested, not
  binding):

  ```
  engine/
    src/
      Wsr2.Engine/             # class library: tuning, rng, session, macro, ...
      Wsr2.Engine.Cli/         # optional headless runner / golden sim
    tests/
      Wsr2.Engine.Tests/       # xUnit
    Wsr2.sln
  tuning.json                  # stays at repo root, shared across hosts
  ```

## 2. Determinism (non-negotiable)

- All randomness MUST flow through a single seeded PRNG owned by the
  session. The reference implementation is xoroshiro128**; keep that
  choice unless there is a strong reason to change.
- Snapshots MUST be **bit-exact**. A session restored from a snapshot,
  then advanced N ticks, must produce a snapshot identical to advancing
  the original session N ticks.
- No use of wall-clock time, `Random.Shared`, hash-of-pointer, or any
  other ambient nondeterminism inside engine code.
- Order IDs and sequence numbers are **server-assigned**. Never trust
  client-supplied IDs/sequences — that is a multiplayer fairness exploit
  vector.
- Iteration over hash-based collections must be replaced with
  deterministic ordering (e.g. sorted by key) before the result feeds
  into anything that affects state.

## 3. Tunability (non-negotiable)

- All game-design constants — magnitudes, probabilities, caps, phase
  bounds, role visibility map, breakthrough archetypes, speed policy,
  feedback gains, stability bounds — live in **`tuning.json`** at the
  repo root and are loaded through the engine's tuning loader.
- Engine code must never hard-code a number a designer might want to
  tweak. If you find yourself typing a magic constant, it belongs in
  `tuning.json`.
- The tuning loader must fail fast with a clear error if a required
  field is missing, out of range, or the wrong type.

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

- `SessionSnapshot` carries a `schemaVersion`. Bumping the engine schema
  REQUIRES a migration path from the previous version (re-derive missing
  fields from `tuning.*.initial` or equivalent; never silently drop
  data).
- Restoring an unknown schema version must throw, not guess.

## 8. Phased build

The agreed build order is:

1. **Phase 0 — Foundations** ✅ (in TS prototype): tuning, RNG,
   visibility, session/tick loop, snapshots, admin gate.
2. **Phase 1 — Simulation engine** 🚧: macro environment ✅ (TS proto);
   company fundamentals 🔜; pricing kernel 🔜.
3. **Phase 2** — instruments, order matching.
4. **Phase 3** — breakthrough events (data-driven from
   `tuning.breakthroughs.archetypes`).
5. **Phase 4** — networking / multiplayer transport.
6. **Phase 5** — UI.

Within Phase 1, fundamentals must land before the pricing kernel, since
the kernel reads fundamentals + macro.

## 9. Decisions baked in

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

## 10. Process rules for agents

- Make **small, surgical changes**; one PR ≈ one slice from the phased
  plan.
- Run lint/build/tests before declaring a slice done. Add tests for any
  new engine behaviour, especially determinism and snapshot round-trip.
- Do not delete or weaken determinism, visibility, or tunability tests.
- If the user says **"continue"**, continue from the next pending item
  in the most recent PR's checklist.
- Do not change these instructions without an explicit request. If the
  user gives a new standing constraint, add it here in the same PR.
