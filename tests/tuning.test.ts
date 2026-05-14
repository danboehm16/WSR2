import { describe, it, expect } from "vitest";
import { loadTuning, validateTuning } from "../src/tuning.js";

describe("tuning", () => {
  it("loads the repo's tuning.json without error", () => {
    const t = loadTuning();
    expect(t.time.defaultCareerYears).toBe(30);
    expect(t.time.ticksPerYear).toBe(252);
    expect(t.multiplayer.speedPolicy.multiplayerLockedTo1x).toBe(true);
    expect(t.multiplayer.speedPolicy.soloPlayerControlsSpeed).toBe(true);
    expect(t.leaderboard.publicByDefault).toBe(true);
    expect(t.feedback.playerWealthEffect.enabledFromDay1).toBe(true);
    expect(t.breakthroughs.adminInjectEnabled).toBe(true);
    expect(t.breakthroughs.seededRandomEnabled).toBe(true);
    expect(t.visibility.roles.Admin).toBeDefined();
    expect(t.visibility.roles.Standard).toBeDefined();
  });

  it("rejects missing sections", () => {
    expect(() => validateTuning({})).toThrow(/time/);
  });

  it("rejects defaultCareerYears > maxSimYears", () => {
    expect(() =>
      validateTuning({
        time: { ticksPerYear: 252, defaultCareerYears: 100, maxSimYears: 50, tickIntervalMsAt1x: 1000 },
        multiplayer: {
          maxPlayersPerSession: 8,
          speedPolicy: { soloPlayerControlsSpeed: true, multiplayerLockedTo1x: true, allowedSpeedsSolo: [1] },
          snapshotEveryTicks: 252,
          orderQueueDeterministicTiebreak: "playerIdAscending",
        },
        leaderboard: { publicByDefault: true, fields: [] },
        feedback: {},
        stability: {},
        breakthroughs: {},
        visibility: { roles: { Admin: {}, Standard: {} } },
      }),
    ).toThrow(/maxSimYears/);
  });

  it("rejects non-boolean visibility entries", () => {
    expect(() =>
      validateTuning({
        time: { ticksPerYear: 252, defaultCareerYears: 30, maxSimYears: 50, tickIntervalMsAt1x: 1000 },
        multiplayer: {
          maxPlayersPerSession: 8,
          speedPolicy: { soloPlayerControlsSpeed: true, multiplayerLockedTo1x: true, allowedSpeedsSolo: [1] },
          snapshotEveryTicks: 252,
          orderQueueDeterministicTiebreak: "playerIdAscending",
        },
        leaderboard: { publicByDefault: true, fields: [] },
        feedback: {},
        stability: {},
        breakthroughs: {},
        visibility: { roles: { Admin: { "company.price": "yes" }, Standard: {} } },
      }),
    ).toThrow(/must be boolean/);
  });
});
