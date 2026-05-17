# Copilot instructions

The authoritative instructions for any agent working in this repo are in
[`AGENTS.md`](../AGENTS.md) at the repo root. **Read that file first.**

## Current state

The repository has been deliberately reset. There is **no application
code** -- the previous TypeScript prototype and the partial C# port were
removed so the next coding session can start from a clean slate in
idiomatic C#. Only `tuning.json`, `AGENTS.md`, `README.md`,
`PRICING_MODEL.md`, this file, and `.gitignore` remain.

## Highlights you must not forget

- **The engine is C# / .NET 8 LTS.** No TypeScript, no JavaScript, no
  Node tooling. Do not reintroduce any of those.
- **Determinism is non-negotiable.** All randomness goes through one
  seeded xoroshiro128\*\* PRNG owned by the session. Snapshots must be
  bit-exact. No `Random.Shared`, no `DateTime.Now`/`UtcNow`, no
  `Guid.NewGuid()`, no hash-set iteration order leaking into state.
- **Tunability.** All design constants live in `tuning.json`; the
  loader fails fast on missing / invalid fields. Never hard-code a
  magnitude.
- **Visibility.** Server-side, **deny-by-default** for unknown
  fields/roles, driven by the `visibility.roles` map in `tuning.json`.
- **Server-authoritative.** Order ids and sequence numbers are
  server-assigned; never trust client-supplied ones.
- **Speed policy.** Multiplayer is locked to 1x; solo can pick from
  `multiplayer.speedPolicy.allowedSpeedsSolo`.
- **Snapshots.** Versioned `SchemaVersion`; bumping it requires a
  migration path; unknown versions throw.

## Where the detailed rules live

These topics each have a dedicated, authoritative section in
[`AGENTS.md`](../AGENTS.md). Read that file -- do not rely on summaries:

- C# best practices (project/build, language style, naming, errors, LINQ,
  async, logging, tests, tooling): **AGENTS.md section 8**.
- Code-quality rules (minimal code, novice-readable syntax, comments
  explain *why*, impact review on adjacent code, tests written and run
  before declaring done): **AGENTS.md section 9**.
- **Simulation model (how stock prices are calculated, tick pipeline,
  macro engine, fundamentals, pricing kernel, player-wealth feedback,
  breakthrough events, stability caps, snapshot contract):
  AGENTS.md section 10.** This is the design contract; nothing in
  it may be invented unilaterally -- items marked TBD must be
  confirmed with the project owner.
- Phased build order: **AGENTS.md section 11**.
- Baked-in design decisions: **AGENTS.md section 12**.
- Process rules for every PR: **AGENTS.md section 13**.
