// Tuning loader and types.
//
// Every game-design constant lives in tuning.json at the repo root and is
// loaded through this module (per AGENTS.md §3). No engine code may
// hard-code numbers a designer might want to change — instead, add the
// field here and reference it via the loaded Tuning object.
//
// This is the C# port of src/tuning.ts. The same tuning.json file is used
// by both the TS prototype and the C# engine during the porting window.

using System.Collections.Immutable;
using System.Text.Json;

namespace Wsr2.Engine;

public enum CyclePhase
{
    Expansion,
    Peak,
    Contraction,
    Trough,
}

public sealed record SpeedPolicy(
    bool SoloPlayerControlsSpeed,
    bool MultiplayerLockedTo1x,
    ImmutableArray<double> AllowedSpeedsSolo);

public sealed record MultiplayerTuning(
    int MaxPlayersPerSession,
    SpeedPolicy SpeedPolicy,
    int SnapshotEveryTicks,
    string OrderQueueDeterministicTiebreak);

public sealed record TimeTuning(
    int TicksPerYear,
    int DefaultCareerYears,
    int MaxSimYears,
    int TickIntervalMsAt1x);

public sealed record LeaderboardTuning(
    bool PublicByDefault,
    ImmutableArray<string> Fields);

public sealed record MacroDriftSpec(
    double Mean,
    double Reversion,
    double Vol,
    double Min,
    double Max);

public sealed record MacroInitial(
    CyclePhase CyclePhase,
    double GdpGrowth,
    double Inflation,
    double PolicyRate,
    double CreditSpread,
    double ConsumerSentiment);

public sealed record MacroCycleSpec(
    ImmutableArray<CyclePhase> PhaseOrder,
    ImmutableDictionary<CyclePhase, int> MinTicksPerPhase,
    ImmutableDictionary<CyclePhase, int> MaxTicksPerPhase);

public sealed record MacroDriftBundle(
    MacroDriftSpec GdpGrowth,
    MacroDriftSpec Inflation,
    MacroDriftSpec PolicyRate,
    MacroDriftSpec CreditSpread,
    MacroDriftSpec ConsumerSentiment);

public sealed record MacroPhaseBias(
    double GdpGrowth,
    double Inflation,
    double PolicyRate,
    double CreditSpread,
    double ConsumerSentiment);

public sealed record MacroTuning(
    MacroInitial Initial,
    MacroCycleSpec Cycle,
    MacroDriftBundle Drift,
    ImmutableDictionary<CyclePhase, MacroPhaseBias> PhaseBias);

public sealed record PlayerWealthEffect(
    bool EnabledFromDay1,
    double AumShareToFlowGain,
    double FlowContributionCap,
    double PriceImpactBpsPerAdvPct,
    double PriceImpactCapBps);

public sealed record FeedbackTuning(PlayerWealthEffect PlayerWealthEffect);

public sealed record StabilityTuning(
    double DailyMoveCapPct,
    double EventDayDailyMoveCapPct,
    double SectorTickShockBudgetPct,
    double MarketTickShockBudgetPct);

public sealed record BreakthroughArchetype(
    string Id,
    int Direction,
    double MinPct,
    double MaxPct,
    double RippleCompetitorsPct,
    double RippleSuppliersPct);

public sealed record SeverityDistribution(string Type, double Alpha, double Min, double Max);

public sealed record BreakthroughDecay(int DefaultHalfLifeTicks);

public sealed record BreakthroughsTuning(
    double PerCompanyAnnualProbability,
    SeverityDistribution SeverityDistribution,
    BreakthroughDecay Decay,
    bool AdminInjectEnabled,
    bool SeededRandomEnabled,
    ImmutableArray<BreakthroughArchetype> Archetypes);

/// <summary>Map of dotted-field-path -&gt; visible (true/false).</summary>
public sealed record VisibilityMap(ImmutableDictionary<string, bool> Fields);

public sealed record VisibilityTuning(ImmutableDictionary<string, VisibilityMap> Roles);

public sealed record Tuning(
    TimeTuning Time,
    MacroTuning Macro,
    MultiplayerTuning Multiplayer,
    LeaderboardTuning Leaderboard,
    FeedbackTuning Feedback,
    StabilityTuning Stability,
    BreakthroughsTuning Breakthroughs,
    VisibilityTuning Visibility);

/// <summary>
/// Thrown when a tuning file is missing a required field, has the wrong type,
/// or violates a documented constraint. Loader is fail-fast at startup.
/// </summary>
public sealed class TuningException : Exception
{
    public TuningException(string message) : base(message) { }
    public TuningException(string message, Exception inner) : base(message, inner) { }
}

public static class TuningLoader
{
    private static readonly CyclePhase[] AllPhases =
        [CyclePhase.Expansion, CyclePhase.Peak, CyclePhase.Contraction, CyclePhase.Trough];

    private static readonly string[] MacroVars =
        ["gdpGrowth", "inflation", "policyRate", "creditSpread", "consumerSentiment"];

    private static readonly string[] RequiredRoles = ["Admin", "Standard"];

    /// <summary>
    /// Default path: walks up from the current assembly location until it
    /// finds <c>tuning.json</c> at a directory root. Used by tests and the
    /// future headless runner.
    /// </summary>
    public static string DefaultTuningPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "tuning.json");
            if (File.Exists(candidate))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        throw new TuningException(
            "tuning: could not locate tuning.json by walking up from " + AppContext.BaseDirectory);
    }

    public static Tuning Load(string? path = null)
    {
        path ??= DefaultTuningPath();
        string text;
        try
        {
            text = File.ReadAllText(path);
        }
        catch (Exception e)
        {
            throw new TuningException($"tuning: failed to read '{path}': {e.Message}", e);
        }
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch (JsonException e)
        {
            throw new TuningException($"tuning: failed to parse JSON at '{path}': {e.Message}", e);
        }
        using (doc)
        {
            return Validate(doc.RootElement);
        }
    }

    /// <summary>Validate a parsed tuning document and project it into a strongly typed <see cref="Tuning"/>.</summary>
    public static Tuning Validate(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new TuningException("tuning: root must be an object");
        }

        var time = ParseTime(RequireSection(root, "time"));
        var multiplayer = ParseMultiplayer(RequireSection(root, "multiplayer"));
        var visibility = ParseVisibility(RequireSection(root, "visibility"));
        var leaderboard = ParseLeaderboard(RequireSection(root, "leaderboard"));
        var feedback = ParseFeedback(RequireSection(root, "feedback"));
        var stability = ParseStability(RequireSection(root, "stability"));
        var breakthroughs = ParseBreakthroughs(RequireSection(root, "breakthroughs"));
        var macro = ParseMacro(RequireSection(root, "macro"));

        return new Tuning(time, macro, multiplayer, leaderboard, feedback, stability, breakthroughs, visibility);
    }

    // --- Section parsers --------------------------------------------------

    private static TimeTuning ParseTime(JsonElement e)
    {
        var t = new TimeTuning(
            TicksPerYear: RequirePositiveInt(e, "time.ticksPerYear", "ticksPerYear"),
            DefaultCareerYears: RequirePositiveInt(e, "time.defaultCareerYears", "defaultCareerYears"),
            MaxSimYears: RequirePositiveInt(e, "time.maxSimYears", "maxSimYears"),
            TickIntervalMsAt1x: RequirePositiveInt(e, "time.tickIntervalMsAt1x", "tickIntervalMsAt1x"));
        if (t.DefaultCareerYears > t.MaxSimYears)
        {
            throw new TuningException("tuning.time.defaultCareerYears cannot exceed maxSimYears");
        }
        return t;
    }

    private static MultiplayerTuning ParseMultiplayer(JsonElement e)
    {
        var sp = RequireSection(e, "speedPolicy", "tuning.multiplayer.speedPolicy");
        var allowed = RequireProperty(sp, "allowedSpeedsSolo", "tuning.multiplayer.speedPolicy.allowedSpeedsSolo");
        if (allowed.ValueKind != JsonValueKind.Array || allowed.GetArrayLength() == 0)
        {
            throw new TuningException("tuning.multiplayer.speedPolicy.allowedSpeedsSolo must be a non-empty array");
        }
        var speeds = ImmutableArray.CreateBuilder<double>(allowed.GetArrayLength());
        foreach (var s in allowed.EnumerateArray())
        {
            if (s.ValueKind != JsonValueKind.Number || !s.TryGetDouble(out var v) || v < 0)
            {
                throw new TuningException(
                    "tuning.multiplayer.speedPolicy.allowedSpeedsSolo entries must be non-negative numbers");
            }
            speeds.Add(v);
        }

        var policy = new SpeedPolicy(
            SoloPlayerControlsSpeed: RequireBool(sp, "soloPlayerControlsSpeed", "tuning.multiplayer.speedPolicy.soloPlayerControlsSpeed"),
            MultiplayerLockedTo1x: RequireBool(sp, "multiplayerLockedTo1x", "tuning.multiplayer.speedPolicy.multiplayerLockedTo1x"),
            AllowedSpeedsSolo: speeds.ToImmutable());

        return new MultiplayerTuning(
            MaxPlayersPerSession: RequirePositiveInt(e, "tuning.multiplayer.maxPlayersPerSession", "maxPlayersPerSession"),
            SpeedPolicy: policy,
            SnapshotEveryTicks: RequirePositiveInt(e, "tuning.multiplayer.snapshotEveryTicks", "snapshotEveryTicks"),
            OrderQueueDeterministicTiebreak: RequireString(e, "orderQueueDeterministicTiebreak", "tuning.multiplayer.orderQueueDeterministicTiebreak"));
    }

    private static LeaderboardTuning ParseLeaderboard(JsonElement e)
    {
        var fields = ImmutableArray.CreateBuilder<string>();
        if (e.TryGetProperty("fields", out var f) && f.ValueKind == JsonValueKind.Array)
        {
            foreach (var s in f.EnumerateArray())
            {
                if (s.ValueKind != JsonValueKind.String)
                {
                    throw new TuningException("tuning.leaderboard.fields entries must be strings");
                }
                fields.Add(s.GetString()!);
            }
        }
        return new LeaderboardTuning(
            PublicByDefault: e.TryGetProperty("publicByDefault", out var pd) && pd.ValueKind == JsonValueKind.True,
            Fields: fields.ToImmutable());
    }

    private static FeedbackTuning ParseFeedback(JsonElement e)
    {
        if (!e.TryGetProperty("playerWealthEffect", out var pwe) || pwe.ValueKind != JsonValueKind.Object)
        {
            // Permissive at this level — TS validator only requires section presence.
            return new FeedbackTuning(new PlayerWealthEffect(false, 0, 0, 0, 0));
        }
        return new FeedbackTuning(new PlayerWealthEffect(
            EnabledFromDay1: pwe.TryGetProperty("enabledFromDay1", out var ed) && ed.ValueKind == JsonValueKind.True,
            AumShareToFlowGain: OptionalDouble(pwe, "aumShareToFlowGain"),
            FlowContributionCap: OptionalDouble(pwe, "flowContributionCap"),
            PriceImpactBpsPerAdvPct: OptionalDouble(pwe, "priceImpactBpsPerAdvPct"),
            PriceImpactCapBps: OptionalDouble(pwe, "priceImpactCapBps")));
    }

    private static StabilityTuning ParseStability(JsonElement e) => new(
        DailyMoveCapPct: OptionalDouble(e, "dailyMoveCapPct"),
        EventDayDailyMoveCapPct: OptionalDouble(e, "eventDayDailyMoveCapPct"),
        SectorTickShockBudgetPct: OptionalDouble(e, "sectorTickShockBudgetPct"),
        MarketTickShockBudgetPct: OptionalDouble(e, "marketTickShockBudgetPct"));

    private static BreakthroughsTuning ParseBreakthroughs(JsonElement e)
    {
        var archetypes = ImmutableArray.CreateBuilder<BreakthroughArchetype>();
        if (e.TryGetProperty("archetypes", out var a) && a.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in a.EnumerateArray())
            {
                archetypes.Add(new BreakthroughArchetype(
                    Id: RequireString(item, "id", "tuning.breakthroughs.archetypes[].id"),
                    Direction: (int)RequireDouble(item, "direction", "tuning.breakthroughs.archetypes[].direction"),
                    MinPct: RequireDouble(item, "minPct", "tuning.breakthroughs.archetypes[].minPct"),
                    MaxPct: RequireDouble(item, "maxPct", "tuning.breakthroughs.archetypes[].maxPct"),
                    RippleCompetitorsPct: RequireDouble(item, "rippleCompetitorsPct", "tuning.breakthroughs.archetypes[].rippleCompetitorsPct"),
                    RippleSuppliersPct: RequireDouble(item, "rippleSuppliersPct", "tuning.breakthroughs.archetypes[].rippleSuppliersPct")));
            }
        }
        SeverityDistribution sev;
        if (e.TryGetProperty("severityDistribution", out var sd) && sd.ValueKind == JsonValueKind.Object)
        {
            sev = new SeverityDistribution(
                Type: RequireString(sd, "type", "tuning.breakthroughs.severityDistribution.type"),
                Alpha: RequireDouble(sd, "alpha", "tuning.breakthroughs.severityDistribution.alpha"),
                Min: RequireDouble(sd, "min", "tuning.breakthroughs.severityDistribution.min"),
                Max: RequireDouble(sd, "max", "tuning.breakthroughs.severityDistribution.max"));
        }
        else
        {
            sev = new SeverityDistribution("none", 0, 0, 0);
        }
        var decay = new BreakthroughDecay(
            DefaultHalfLifeTicks: e.TryGetProperty("decay", out var d) && d.TryGetProperty("defaultHalfLifeTicks", out var hl)
                ? hl.GetInt32() : 0);
        return new BreakthroughsTuning(
            PerCompanyAnnualProbability: OptionalDouble(e, "perCompanyAnnualProbability"),
            SeverityDistribution: sev,
            Decay: decay,
            AdminInjectEnabled: e.TryGetProperty("adminInjectEnabled", out var ai) && ai.ValueKind == JsonValueKind.True,
            SeededRandomEnabled: e.TryGetProperty("seededRandomEnabled", out var sr) && sr.ValueKind == JsonValueKind.True,
            Archetypes: archetypes.ToImmutable());
    }

    private static VisibilityTuning ParseVisibility(JsonElement e)
    {
        var roles = RequireSection(e, "roles", "tuning.visibility.roles");
        var byRole = ImmutableDictionary.CreateBuilder<string, VisibilityMap>(StringComparer.Ordinal);
        foreach (var role in RequiredRoles)
        {
            if (!roles.TryGetProperty(role, out _))
            {
                throw new TuningException($"tuning.visibility.roles.{role} is required");
            }
        }
        foreach (var prop in roles.EnumerateObject())
        {
            if (prop.Value.ValueKind != JsonValueKind.Object)
            {
                throw new TuningException($"tuning.visibility.roles.{prop.Name} must be an object");
            }
            var fields = ImmutableDictionary.CreateBuilder<string, bool>(StringComparer.Ordinal);
            foreach (var f in prop.Value.EnumerateObject())
            {
                if (f.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                {
                    throw new TuningException($"tuning.visibility.roles.{prop.Name}.{f.Name} must be boolean");
                }
                fields[f.Name] = f.Value.GetBoolean();
            }
            byRole[prop.Name] = new VisibilityMap(fields.ToImmutable());
        }
        return new VisibilityTuning(byRole.ToImmutable());
    }

    private static MacroTuning ParseMacro(JsonElement e)
    {
        var initial = ParseMacroInitial(RequireSection(e, "initial", "tuning.macro.initial"));
        var cycle = ParseMacroCycle(RequireSection(e, "cycle", "tuning.macro.cycle"));
        var drift = ParseMacroDrift(RequireSection(e, "drift", "tuning.macro.drift"));
        var bias = ParseMacroPhaseBias(RequireSection(e, "phaseBias", "tuning.macro.phaseBias"));
        return new MacroTuning(initial, cycle, drift, bias);
    }

    private static MacroInitial ParseMacroInitial(JsonElement e)
    {
        var phaseStr = RequireString(e, "cyclePhase", "tuning.macro.initial.cyclePhase");
        if (!Enum.TryParse<CyclePhase>(phaseStr, ignoreCase: false, out var phase))
        {
            throw new TuningException(
                $"tuning.macro.initial.cyclePhase must be one of [{string.Join(",", AllPhases)}]");
        }
        foreach (var v in MacroVars)
        {
            RequireFiniteNumber(e, v, $"tuning.macro.initial.{v}");
        }
        return new MacroInitial(
            CyclePhase: phase,
            GdpGrowth: e.GetProperty("gdpGrowth").GetDouble(),
            Inflation: e.GetProperty("inflation").GetDouble(),
            PolicyRate: e.GetProperty("policyRate").GetDouble(),
            CreditSpread: e.GetProperty("creditSpread").GetDouble(),
            ConsumerSentiment: e.GetProperty("consumerSentiment").GetDouble());
    }

    private static MacroCycleSpec ParseMacroCycle(JsonElement e)
    {
        var orderEl = RequireProperty(e, "phaseOrder", "tuning.macro.cycle.phaseOrder");
        if (orderEl.ValueKind != JsonValueKind.Array || orderEl.GetArrayLength() == 0)
        {
            throw new TuningException("tuning.macro.cycle.phaseOrder must be a non-empty array");
        }
        var order = ImmutableArray.CreateBuilder<CyclePhase>(orderEl.GetArrayLength());
        foreach (var p in orderEl.EnumerateArray())
        {
            if (p.ValueKind != JsonValueKind.String || !Enum.TryParse<CyclePhase>(p.GetString(), false, out var ph))
            {
                throw new TuningException(
                    $"tuning.macro.cycle.phaseOrder contains invalid phase '{p}'");
            }
            order.Add(ph);
        }

        var min = ParsePhaseIntMap(RequireSection(e, "minTicksPerPhase", "tuning.macro.cycle.minTicksPerPhase"), "minTicksPerPhase");
        var max = ParsePhaseIntMap(RequireSection(e, "maxTicksPerPhase", "tuning.macro.cycle.maxTicksPerPhase"), "maxTicksPerPhase");
        foreach (var phase in AllPhases)
        {
            if (min[phase] > max[phase])
            {
                throw new TuningException(
                    $"tuning.macro.cycle: minTicksPerPhase.{phase} > maxTicksPerPhase.{phase}");
            }
        }
        return new MacroCycleSpec(order.ToImmutable(), min, max);
    }

    private static ImmutableDictionary<CyclePhase, int> ParsePhaseIntMap(JsonElement e, string boundName)
    {
        var b = ImmutableDictionary.CreateBuilder<CyclePhase, int>();
        foreach (var phase in AllPhases)
        {
            if (!e.TryGetProperty(phase.ToString(), out var v)
                || v.ValueKind != JsonValueKind.Number
                || !v.TryGetInt32(out var iv)
                || iv <= 0)
            {
                throw new TuningException(
                    $"tuning.macro.cycle.{boundName}.{phase} must be a positive integer");
            }
            b[phase] = iv;
        }
        return b.ToImmutable();
    }

    private static MacroDriftBundle ParseMacroDrift(JsonElement e)
    {
        MacroDriftSpec One(string name)
        {
            var d = RequireSection(e, name, $"tuning.macro.drift.{name}");
            foreach (var k in new[] { "mean", "reversion", "vol", "min", "max" })
            {
                RequireFiniteNumber(d, k, $"tuning.macro.drift.{name}.{k}");
            }
            var spec = new MacroDriftSpec(
                Mean: d.GetProperty("mean").GetDouble(),
                Reversion: d.GetProperty("reversion").GetDouble(),
                Vol: d.GetProperty("vol").GetDouble(),
                Min: d.GetProperty("min").GetDouble(),
                Max: d.GetProperty("max").GetDouble());
            if (spec.Min >= spec.Max)
            {
                throw new TuningException($"tuning.macro.drift.{name}: min must be < max");
            }
            if (spec.Reversion < 0 || spec.Reversion > 1)
            {
                throw new TuningException($"tuning.macro.drift.{name}.reversion must be in [0,1]");
            }
            if (spec.Vol < 0)
            {
                throw new TuningException($"tuning.macro.drift.{name}.vol must be >= 0");
            }
            return spec;
        }
        return new MacroDriftBundle(
            GdpGrowth: One("gdpGrowth"),
            Inflation: One("inflation"),
            PolicyRate: One("policyRate"),
            CreditSpread: One("creditSpread"),
            ConsumerSentiment: One("consumerSentiment"));
    }

    private static ImmutableDictionary<CyclePhase, MacroPhaseBias> ParseMacroPhaseBias(JsonElement e)
    {
        var b = ImmutableDictionary.CreateBuilder<CyclePhase, MacroPhaseBias>();
        foreach (var phase in AllPhases)
        {
            var ph = RequireSection(e, phase.ToString(), $"tuning.macro.phaseBias.{phase}");
            foreach (var v in MacroVars)
            {
                RequireFiniteNumber(ph, v, $"tuning.macro.phaseBias.{phase}.{v}");
            }
            b[phase] = new MacroPhaseBias(
                GdpGrowth: ph.GetProperty("gdpGrowth").GetDouble(),
                Inflation: ph.GetProperty("inflation").GetDouble(),
                PolicyRate: ph.GetProperty("policyRate").GetDouble(),
                CreditSpread: ph.GetProperty("creditSpread").GetDouble(),
                ConsumerSentiment: ph.GetProperty("consumerSentiment").GetDouble());
        }
        return b.ToImmutable();
    }

    // --- Helpers ----------------------------------------------------------

    private static JsonElement RequireSection(JsonElement parent, string name, string? fullPath = null)
    {
        if (!parent.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Object)
        {
            var label = fullPath ?? name;
            throw new TuningException($"tuning: missing or invalid section '{label}'");
        }
        return v;
    }

    private static JsonElement RequireProperty(JsonElement parent, string name, string fullPath)
    {
        if (!parent.TryGetProperty(name, out var v))
        {
            throw new TuningException($"tuning: missing required field '{fullPath}'");
        }
        return v;
    }

    private static int RequirePositiveInt(JsonElement parent, string fullPath, string name)
    {
        if (!parent.TryGetProperty(name, out var v)
            || v.ValueKind != JsonValueKind.Number
            || !v.TryGetInt32(out var iv)
            || iv <= 0)
        {
            throw new TuningException($"tuning.{fullPath} must be a positive number");
        }
        return iv;
    }

    private static double RequireDouble(JsonElement parent, string name, string fullPath)
    {
        if (!parent.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out var d))
        {
            throw new TuningException($"tuning.{fullPath} must be a number");
        }
        return d;
    }

    private static void RequireFiniteNumber(JsonElement parent, string name, string fullPath)
    {
        if (!parent.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out var d) || !double.IsFinite(d))
        {
            throw new TuningException($"tuning.{fullPath} must be a finite number");
        }
    }

    private static string RequireString(JsonElement parent, string name, string fullPath)
    {
        if (!parent.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            throw new TuningException($"tuning.{fullPath} must be a string");
        }
        return v.GetString()!;
    }

    private static bool RequireBool(JsonElement parent, string name, string fullPath)
    {
        if (!parent.TryGetProperty(name, out var v) || v.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new TuningException($"tuning.{fullPath} must be a boolean");
        }
        return v.GetBoolean();
    }

    private static double OptionalDouble(JsonElement parent, string name)
    {
        if (parent.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d))
        {
            return d;
        }
        return 0;
    }
}
