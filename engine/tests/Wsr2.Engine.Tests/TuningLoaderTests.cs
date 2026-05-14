// Tests for the C# tuning loader. Mirrors the assertions in
// tests/tuning.test.ts so that the two implementations are kept in lock-step
// during the porting window.

using System.Text.Json;
using Wsr2.Engine;

namespace Wsr2.Engine.Tests;

public class TuningLoaderTests
{
    [Fact]
    public void LoadsRepoTuningJsonWithoutError()
    {
        var t = TuningLoader.Load();

        Assert.Equal(30, t.Time.DefaultCareerYears);
        Assert.Equal(252, t.Time.TicksPerYear);
        Assert.True(t.Multiplayer.SpeedPolicy.MultiplayerLockedTo1x);
        Assert.True(t.Multiplayer.SpeedPolicy.SoloPlayerControlsSpeed);
        Assert.True(t.Leaderboard.PublicByDefault);
        Assert.True(t.Feedback.PlayerWealthEffect.EnabledFromDay1);
        Assert.True(t.Breakthroughs.AdminInjectEnabled);
        Assert.True(t.Breakthroughs.SeededRandomEnabled);
        Assert.True(t.Visibility.Roles.ContainsKey("Admin"));
        Assert.True(t.Visibility.Roles.ContainsKey("Standard"));
    }

    [Fact]
    public void RejectsEmptyRoot()
    {
        var ex = Assert.Throws<TuningException>(() => Validate("{}"));
        Assert.Contains("time", ex.Message);
    }

    [Fact]
    public void RejectsMissingMacroSection()
    {
        var json = """
            {
              "time": { "ticksPerYear": 252, "defaultCareerYears": 30, "maxSimYears": 50, "tickIntervalMsAt1x": 1000 },
              "multiplayer": {
                "maxPlayersPerSession": 8,
                "speedPolicy": { "soloPlayerControlsSpeed": true, "multiplayerLockedTo1x": true, "allowedSpeedsSolo": [1] },
                "snapshotEveryTicks": 252,
                "orderQueueDeterministicTiebreak": "playerIdAscending"
              },
              "leaderboard": { "publicByDefault": true, "fields": [] },
              "feedback": {},
              "stability": {},
              "breakthroughs": {},
              "visibility": { "roles": { "Admin": {}, "Standard": {} } }
            }
            """;
        var ex = Assert.Throws<TuningException>(() => Validate(json));
        Assert.Contains("macro", ex.Message);
    }

    [Fact]
    public void RejectsDefaultCareerYearsExceedingMaxSimYears()
    {
        var json = """
            {
              "time": { "ticksPerYear": 252, "defaultCareerYears": 100, "maxSimYears": 50, "tickIntervalMsAt1x": 1000 },
              "multiplayer": {
                "maxPlayersPerSession": 8,
                "speedPolicy": { "soloPlayerControlsSpeed": true, "multiplayerLockedTo1x": true, "allowedSpeedsSolo": [1] },
                "snapshotEveryTicks": 252,
                "orderQueueDeterministicTiebreak": "playerIdAscending"
              },
              "leaderboard": { "publicByDefault": true, "fields": [] },
              "feedback": {},
              "stability": {},
              "breakthroughs": {},
              "visibility": { "roles": { "Admin": {}, "Standard": {} } }
            }
            """;
        var ex = Assert.Throws<TuningException>(() => Validate(json));
        Assert.Contains("maxSimYears", ex.Message);
    }

    [Fact]
    public void RejectsNonBooleanVisibilityEntries()
    {
        var json = """
            {
              "time": { "ticksPerYear": 252, "defaultCareerYears": 30, "maxSimYears": 50, "tickIntervalMsAt1x": 1000 },
              "multiplayer": {
                "maxPlayersPerSession": 8,
                "speedPolicy": { "soloPlayerControlsSpeed": true, "multiplayerLockedTo1x": true, "allowedSpeedsSolo": [1] },
                "snapshotEveryTicks": 252,
                "orderQueueDeterministicTiebreak": "playerIdAscending"
              },
              "leaderboard": { "publicByDefault": true, "fields": [] },
              "feedback": {},
              "stability": {},
              "breakthroughs": {},
              "visibility": { "roles": { "Admin": { "company.price": "yes" }, "Standard": {} } }
            }
            """;
        var ex = Assert.Throws<TuningException>(() => Validate(json));
        Assert.Contains("must be boolean", ex.Message);
    }

    [Fact]
    public void RejectsMissingVisibilityRole()
    {
        var json = """
            {
              "time": { "ticksPerYear": 252, "defaultCareerYears": 30, "maxSimYears": 50, "tickIntervalMsAt1x": 1000 },
              "multiplayer": {
                "maxPlayersPerSession": 8,
                "speedPolicy": { "soloPlayerControlsSpeed": true, "multiplayerLockedTo1x": true, "allowedSpeedsSolo": [1] },
                "snapshotEveryTicks": 252,
                "orderQueueDeterministicTiebreak": "playerIdAscending"
              },
              "leaderboard": { "publicByDefault": true, "fields": [] },
              "feedback": {},
              "stability": {},
              "breakthroughs": {},
              "visibility": { "roles": { "Admin": {} } }
            }
            """;
        var ex = Assert.Throws<TuningException>(() => Validate(json));
        Assert.Contains("Standard", ex.Message);
    }

    /// <summary>
    /// The repo's tuning.json is the source of truth for all design constants;
    /// the C# loader must surface the same headline numbers as the TS one
    /// (otherwise designers' edits won't propagate the same way to both
    /// engines during the porting window).
    /// </summary>
    [Fact]
    public void MacroInitial_MatchesRepoTuning()
    {
        var t = TuningLoader.Load();
        Assert.Equal(CyclePhase.Expansion, t.Macro.Initial.CyclePhase);
        Assert.Equal(0.025, t.Macro.Initial.GdpGrowth);
        Assert.Equal(0.022, t.Macro.Initial.Inflation);
        Assert.Equal(0.03, t.Macro.Initial.PolicyRate);
        Assert.Equal(0.012, t.Macro.Initial.CreditSpread);
        Assert.Equal(0.55, t.Macro.Initial.ConsumerSentiment);
    }

    [Fact]
    public void Breakthroughs_HasTenArchetypes()
    {
        var t = TuningLoader.Load();
        Assert.Equal(10, t.Breakthroughs.Archetypes.Length);
    }

    [Fact]
    public void Visibility_DenyByDefault_ForUnknownField()
    {
        var t = TuningLoader.Load();
        var standard = t.Visibility.Roles["Standard"];
        // Any field not explicitly enumerated -> not visible (deny-by-default).
        Assert.False(standard.Fields.GetValueOrDefault("totally.made.up.field", false));
    }

    private static Tuning Validate(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return TuningLoader.Validate(doc.RootElement);
    }
}
