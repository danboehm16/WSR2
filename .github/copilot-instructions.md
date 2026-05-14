# Copilot instructions

The authoritative instructions for any agent working in this repo are in
[`AGENTS.md`](../AGENTS.md) at the repo root. Read that file first.

Highlights you must not forget:

- **The core engine is C#** (.NET). The current `src/*.ts` code is a prototype
  that pre-dates this decision and is being ported. Do not add new features
  to the TypeScript code; port instead.
- All randomness goes through one seeded PRNG (xoroshiro128**); snapshots
  must be **bit-exact**.
- All design constants live in `tuning.json`; never hard-code magnitudes.
- Visibility is enforced server-side, **deny-by-default** for unknown
  fields/roles.
- Server is authoritative; order ids/seqs are server-assigned.
- Multiplayer is locked to 1× speed; solo can pick from
  `allowedSpeedsSolo`.

See `AGENTS.md` for the full list and the phased build plan.
