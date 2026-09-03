using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShinySolution.Core;

// Gen 2 Trainer ID / Lucky ID engine (Gold / Silver / Crystal hold-START single-tap methodologies): the
// 4-frame poll bins, bin -> offsets, table lookups across the RTC states, the typed-TID / typed-(TID, LID)
// inversion with the two-state prior, the target sets and verdicts, the cue schedules (menu / power-on /
// reset anchors) and the bin-based calibration and verify. The same API as core/gen2tid.js; the oracle is
// tests/gen2_reference.py (tests/gen2tid-vectors.json). A separate class from Gen1Tid (which ports RNG
// Solution's Python line for line): Gen 2 is 4-frame bins relative to a menu visible 4 frames after the
// game's detector, three IDs per bin and a Gold/Silver RTC state that selects the table. Timing helpers,
// tones and the count-in come from Gen1Tid so the heads render Gen 2 cues with the Gen 1 code paths.
// Pure functions; the data comes from core/data/gen2-tid.json (Gen2TidData).

public sealed class Gen2BinRule
{
    public string Name { get; init; } = "";
    public int[] DroppedOffsets { get; init; } = Array.Empty<int>();
    public int Bin0Lo { get; init; }
    public int Bin0Hi { get; init; }
    public int Subtract { get; init; }
    public int AcceptToRollFrames { get; init; }
}

public sealed class Gen2Timing
{
    public int HoldLoFrame { get; init; }
    public int HoldHiFrame { get; init; }
    public int MenuFrame { get; init; }
    public int VisibleMenuFrame { get; init; }
    public int FirstPollFrame { get; init; }
    public int PollPeriodFrames { get; init; }
    public int AcceptToRollFrames { get; init; }
}

public sealed class Gen2Table
{
    public int[] Tids { get; init; } = Array.Empty<int>();
    public int[] Lids { get; init; } = Array.Empty<int>();
    public int[]? Sids { get; init; }
    public int RollBase { get; init; }
    public Dictionary<int, int> RollSlips { get; init; } = new();
}

public sealed class Gen2Methodology
{
    public string Id { get; init; } = "";
    public string GameKey { get; init; } = "";
    public string ConsoleId { get; init; } = "";
    public string PlatformKey { get; init; } = "";
    public string[] Anchors { get; init; } = Array.Empty<string>();
    public string BinRule { get; init; } = "";
    public string TableFile { get; init; } = "";
    public string[] RtcTables { get; init; } = Array.Empty<string>();
    public Gen2Timing Timing { get; init; } = new();
    public JsonElement Raw { get; init; }
    public JsonElement TableData { get; init; }
}

// A table by key ("game/platformKey/state") with its payload resolved through same_data_as.
public sealed class Gen2TableRef
{
    public string Key { get; init; } = "";
    public string Carrier { get; init; } = "";
    public string Game { get; init; } = "";
    public string PlatformKey { get; init; } = "";
    public string State { get; init; } = "";
    public string Methodology { get; init; } = "";
    public Gen2Table Table { get; init; } = new();
    public Gen2Timing Timing { get; init; } = new();
    public Gen2BinRule Rule { get; init; } = new();
    public JsonElement Record { get; init; }
}

public sealed class Gen2Candidate
{
    public string Key { get; init; } = "";          // the table that carries the payload (identical tables are stored once)
    public string Table { get; init; } = "";        // the first in-scope table of the group: use this in head text
    public string[][] Members { get; init; } = Array.Empty<string[]>();
    public int Bin { get; init; }
    public int[] Offsets { get; init; } = Array.Empty<int>();
    public int Tid { get; init; }
    public int Lid { get; init; }
    public int? Sid { get; init; }
    public string Family { get; init; } = "";
    public bool ReachableAfterFirstBoot { get; init; }
}

public sealed class Gen2Inversion
{
    public List<Gen2Candidate> Candidates { get; init; } = new();
    public List<Gen2Candidate> Preferred { get; init; } = new();
    public bool Ambiguous { get; init; }
    public Gen2Candidate? Resolved { get; init; }
}

public sealed class Gen2Ambiguity
{
    public int Tables { get; init; }
    public int Entries { get; init; }
    public int DistinctTids { get; init; }
    public int AmbiguousTids { get; init; }
    public int AmbiguousEntries { get; init; }
    public int MaxCandidates { get; init; }
    public int PairCollisions { get; init; }
    public string[] PairCollisionList { get; init; } = Array.Empty<string>();
}

public sealed class Gen2TargetSet
{
    public string Key { get; }
    public string Name { get; }
    public string Kind { get; }
    public string[] Games { get; }
    public string Protocol { get; }
    public string Provenance { get; }
    public string Route { get; }
    public string Note { get; }
    public int[] Tids { get; }
    public int[] Lids { get; }
    public (int Tid, int Lid)[] Pairs { get; }
    public int SinglePressHits { get; }

    static string Str(JsonElement e, string name, string dflt) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? dflt : dflt;
    static int Hex(JsonElement e)
    {
        string str = e.ToString().Trim();
        if (str.Length is < 1 or > 4 || !str.All(Uri.IsHexDigit)) throw new ArgumentException($"target set member '{e}' is not a 1-4 digit hex ID");
        return Convert.ToInt32(str, 16);
    }

    public Gen2TargetSet(string key, JsonElement spec)
    {
        Key = key;
        Name = Str(spec, "name", key);
        Kind = Str(spec, "kind", "tid-list");
        Games = spec.TryGetProperty("games", out var g) ? g.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : Array.Empty<string>();
        Protocol = Str(spec, "protocol", "");
        Provenance = Str(spec, "provenance", "");
        Route = Str(spec, "route", "");
        Note = Str(spec, "note", "");
        SinglePressHits = spec.TryGetProperty("single_press_hits", out var h) ? h.GetArrayLength() : 0;
        Tids = Array.Empty<int>(); Lids = Array.Empty<int>(); Pairs = Array.Empty<(int, int)>();
        if (Kind == "tid-list") Tids = spec.TryGetProperty("tids", out var t) ? t.EnumerateArray().Select(Hex).ToArray() : Array.Empty<int>();
        else if (Kind == "lid-list") Lids = spec.TryGetProperty("lids", out var l) ? l.EnumerateArray().Select(Hex).ToArray() : Array.Empty<int>();
        else if (Kind == "pair-list") Pairs = spec.TryGetProperty("pairs", out var p) ? p.EnumerateArray().Select(x => (Hex(x[0]), Hex(x[1]))).ToArray() : Array.Empty<(int, int)>();
        else throw new ArgumentException($"target set {key}: unknown kind '{Kind}'");
    }

    public bool Accepts(int tid, int? lid, int? sid)
    {
        if (Kind == "tid-list") return Array.IndexOf(Tids, tid) >= 0;
        if (lid is null) return false;
        if (Kind == "lid-list") return Array.IndexOf(Lids, lid.Value) >= 0;
        return Pairs.Any(p => p.Tid == tid && p.Lid == lid.Value);
    }

    public string Describe()
    {
        if (Kind == "tid-list") return Key + ": TID " + string.Join(", ", Tids.Select(t => $"${t:X4} ({t})"));
        if (Kind == "lid-list") return Key + ": Lucky ID " + string.Join(", ", Lids.Select(t => $"${t:X4} ({t:D5})"));
        return Key + ": " + string.Join(", ", Pairs.Select(p => $"TID ${p.Tid:X4} + LID ${p.Lid:X4}"));
    }
}

public sealed class Gen2Target
{
    public int Bin { get; init; }
    public int[] Offsets { get; init; } = Array.Empty<int>();
    public int Tid { get; init; }
    public int Lid { get; init; }
    public int? Sid { get; init; }
    public string[] Sets { get; init; } = Array.Empty<string>();
    public bool ReachableAfterFirstBoot { get; init; }
    public string? State { get; set; }
}

public sealed class Gen2Lookup
{
    public string Game { get; init; } = "";
    public string PlatformKey { get; init; } = "";
    public string State { get; init; } = "";
    public string Key { get; init; } = "";
    public string Carrier { get; init; } = "";
    public string Methodology { get; init; } = "";
    public int Bin { get; init; }
    public int Tid { get; init; }
    public int Lid { get; init; }
    public int? Sid { get; init; }
    public int[] Offsets { get; init; } = Array.Empty<int>();
    public int[] Visible { get; init; } = Array.Empty<int>();
    public double Aim { get; init; }
    public int[] PressFrames { get; init; } = Array.Empty<int>();
    public int AcceptFrame { get; init; }
    public int RollFrame { get; init; }
}

public sealed class Gen2Schedule
{
    public string Anchor { get; init; } = "";
    public double TA { get; init; }
    public double? HoldLo { get; init; }
    public double? HoldHi { get; init; }
    public double? Menu { get; init; }
    public int DroppedCountIn { get; init; }
    public List<Cue> Cues { get; init; } = new();
    public double Duration => Cues.Count == 0 ? 0.0 : Cues.Max(c => c.T + c.Ms / 1000.0);
    public double[] CountInTimes => Cues.Where(c => c.Kind == "count").Select(c => c.T).ToArray();
    public int Bin { get; init; }
    public double AimOffset { get; init; }
    public double AimV { get; init; }
    public double[] AWindow { get; init; } = Array.Empty<double>();
    public double[] TapMs { get; init; } = Array.Empty<double>();
    public double RollSettleS { get; init; }
    public string Methodology { get; init; } = "";
}

// One Gen 2 calibration sample (bin centres as offsets, so Gen1Tid's mean / drift helpers apply to implied_ms).
public sealed class Gen2Sample
{
    [JsonPropertyName("tid")] public int Tid { get; set; }
    [JsonPropertyName("lid")] public int? Lid { get; set; }
    [JsonPropertyName("aimed_bin")] public int AimedBin { get; set; }
    [JsonPropertyName("hit_bin")] public int HitBin { get; set; }
    [JsonPropertyName("aimed")] public double Aimed { get; set; }
    [JsonPropertyName("hit")] public double Hit { get; set; }
    [JsonPropertyName("correction_used_ms")] public double CorrectionUsedMs { get; set; }
    [JsonPropertyName("implied_ms")] public double ImpliedMs { get; set; }
    [JsonPropertyName("state")] public string State { get; set; } = "";
    [JsonPropertyName("methodology")] public string Methodology { get; set; } = "";
    [JsonPropertyName("attempt")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Attempt { get; set; }
    [JsonPropertyName("note")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; set; }
    [JsonPropertyName("player")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Player { get; set; }
}

public sealed class Gen2SampleResult
{
    public List<Gen2Candidate> Candidates { get; init; } = new();
    public int[] CandidateBins { get; init; } = Array.Empty<int>();
    public Gen2Candidate? Nearest { get; init; }
    public int? NearestBin { get; init; }
    public bool Ambiguous { get; init; }
    public Gen2Sample? Sample { get; init; }
}

public sealed class Gen2VerifyResult
{
    public double PredictedOffset { get; init; }
    public int? PredictedBin { get; init; }
    public int[] Bins { get; init; } = Array.Empty<int>();
    public int? Nearest { get; init; }
    public int? DifferenceBins { get; init; }
    public bool InTable { get; init; }
    public bool Consistent { get; init; }
}

// core/data/gen2-tid.json: a copy beside the executable wins, else the embedded resource.
public sealed class Gen2TidData
{
    public JsonElement Root { get; }
    readonly Dictionary<string, Gen2Methodology> _methodologies = new();
    readonly Dictionary<string, Gen2BinRule> _rules = new();
    readonly Dictionary<string, Gen2Table> _decoded = new();

    public Gen2TidData(JsonElement root)
    {
        Root = root;
        foreach (var r in root.GetProperty("bin_rules").EnumerateObject())
        {
            var b0 = r.Value.GetProperty("bin0_offsets");
            _rules[r.Name] = new Gen2BinRule
            {
                Name = r.Name,
                DroppedOffsets = r.Value.GetProperty("dropped_offsets").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
                Bin0Lo = b0[0].GetInt32(), Bin0Hi = b0[1].GetInt32(),
                Subtract = r.Value.GetProperty("subtract").GetInt32(),
                AcceptToRollFrames = r.Value.GetProperty("accept_to_roll_frames").GetInt32()
            };
        }
        foreach (var m in root.GetProperty("methodologies").EnumerateObject())
        {
            var t = m.Value.GetProperty("timing");
            _methodologies[m.Name] = new Gen2Methodology
            {
                Id = m.Name,
                GameKey = m.Value.GetProperty("game_key").GetString() ?? "",
                ConsoleId = m.Value.GetProperty("console_id").GetString() ?? "",
                PlatformKey = m.Value.GetProperty("platform_key").GetString() ?? "",
                Anchors = m.Value.GetProperty("anchors").EnumerateArray().Select(x => x.GetString() ?? "").ToArray(),
                BinRule = m.Value.GetProperty("bin_rule").GetString() ?? "",
                TableFile = m.Value.GetProperty("table").GetString() ?? "",
                RtcTables = m.Value.GetProperty("rtc_tables").EnumerateArray().Select(x => x.GetString() ?? "").ToArray(),
                Timing = new Gen2Timing
                {
                    HoldLoFrame = t.GetProperty("hold_lo_frame").GetInt32(), HoldHiFrame = t.GetProperty("hold_hi_frame").GetInt32(),
                    MenuFrame = t.GetProperty("menu_frame").GetInt32(), VisibleMenuFrame = t.GetProperty("visible_menu_frame").GetInt32(),
                    FirstPollFrame = t.GetProperty("first_poll_frame").GetInt32(), PollPeriodFrames = t.GetProperty("poll_period_frames").GetInt32(),
                    AcceptToRollFrames = t.GetProperty("accept_to_roll_frames").GetInt32()
                },
                Raw = m.Value, TableData = m.Value.GetProperty("table_data")
            };
        }
    }

    public static string DefaultFileName => "gen2-tid.json";

    public static Gen2TidData Load()
    {
        string beside = Path.Combine(AppContext.BaseDirectory, DefaultFileName);
        return File.Exists(beside) ? LoadFile(beside) : LoadEmbedded();
    }

    public static Gen2TidData LoadFile(string path) => new(JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone());
    public static Gen2TidData LoadEmbedded() => new(Gen1TidData.ParseEmbedded("data.gen2-tid"));

    public IEnumerable<string> MethodologyIds => _methodologies.Keys;
    public IEnumerable<string> GameKeys => Root.GetProperty("games").EnumerateObject().Select(g => g.Name);

    public JsonElement Game(string gameKey)
        => Root.GetProperty("games").TryGetProperty(gameKey, out var g) ? g : throw new ArgumentException($"no game '{gameKey}' in the data");

    public bool RtcDependent(string gameKey) => Game(gameKey).GetProperty("rtc_dependent").GetBoolean();
    public string[] PlatformKeys(string gameKey) => Game(gameKey).GetProperty("platform_keys").EnumerateArray().Select(x => x.GetString() ?? "").ToArray();

    public Gen2BinRule BinRule(string gameKey)
    {
        string name = Game(gameKey).GetProperty("bin_rule").GetString() ?? "";
        return _rules.TryGetValue(name, out var r) ? r : throw new ArgumentException($"no bin rule '{name}'");
    }

    public Gen2Methodology Methodology(string id)
        => _methodologies.TryGetValue(id, out var m) ? m : throw new ArgumentException($"no methodology '{id}' in the data");

    public Gen2Methodology MethodologyFor(string gameKey, string platformKey)
    {
        foreach (var id in Game(gameKey).GetProperty("methodologies").EnumerateArray())
        {
            var m = Methodology(id.GetString() ?? "");
            if (m.PlatformKey == platformKey) return m;
        }
        throw new ArgumentException($"no methodology for {gameKey} on '{platformKey}'");
    }

    public string[] StateIds(string gameKey)
    {
        if (!RtcDependent(gameKey)) return new[] { "days0" };
        var fam = Root.GetProperty("rtc").GetProperty("families");
        return fam.GetProperty("running").GetProperty("states").EnumerateArray().Concat(fam.GetProperty("halted").GetProperty("states").EnumerateArray())
            .Select(x => x.GetString() ?? "").ToArray();
    }

    public JsonElement StateInfo(string state)
        => Root.GetProperty("rtc").GetProperty("states").TryGetProperty(state, out var s) ? s : throw new ArgumentException($"no RTC state '{state}'");

    public bool Reachable(string gameKey, string state)
    {
        var info = StateInfo(state);
        return !RtcDependent(gameKey) || info.GetProperty("reachable_after_first_boot").GetBoolean();
    }

    public JsonElement TableRecord(string key)
    {
        var (game, plat, state) = Gen2Tid.SplitKey(key);
        if (state == "days0") return MethodologyFor(game, plat).TableData;
        return Root.GetProperty("rtc").GetProperty("tables").TryGetProperty(key, out var r) ? r : throw new ArgumentException($"no table '{key}'");
    }

    public (string Key, JsonElement Record) ResolveTable(string key)
    {
        string k = key;
        var r = TableRecord(key);
        int hops = 0;
        while (r.TryGetProperty("same_data_as", out var s))
        {
            k = s.GetString() ?? "";
            r = TableRecord(k);
            if (++hops > 8) throw new ArgumentException($"same_data_as loop at {key}");
        }
        return (k, r);
    }

    static int[] DecodeHex4(string s)
    {
        var out_ = new int[s.Length / 4];
        for (int i = 0; i < out_.Length; i++) out_[i] = Convert.ToInt32(s.Substring(4 * i, 4), 16);
        return out_;
    }

    public Gen2Table DecodeTable(string carrierKey)
    {
        if (_decoded.TryGetValue(carrierKey, out var cached)) return cached;
        var r = TableRecord(carrierKey);
        if (!r.TryGetProperty("tids_hex", out var th)) throw new ArgumentException("table record carries no payload (follow same_data_as first)");
        var slips = new Dictionary<int, int>();
        if (r.TryGetProperty("roll_slips", out var rs))
            foreach (var p in rs.EnumerateObject()) slips[int.Parse(p.Name)] = p.Value.GetInt32();
        var t = new Gen2Table
        {
            Tids = DecodeHex4(th.GetString() ?? ""), Lids = DecodeHex4(r.GetProperty("lids_hex").GetString() ?? ""),
            Sids = r.TryGetProperty("sids_hex", out var sh) ? DecodeHex4(sh.GetString() ?? "") : null,
            RollBase = r.GetProperty("roll_base").GetInt32(), RollSlips = slips
        };
        if (t.Tids.Length != Gen2Tid.BinCount || t.Lids.Length != Gen2Tid.BinCount) throw new ArgumentException($"table payload is not {Gen2Tid.BinCount} bins");
        _decoded[carrierKey] = t;
        return t;
    }

    public Gen2TableRef TableFor(string gameKey, string platformKey, string state)
    {
        string key = Gen2Tid.TableKey(gameKey, platformKey, state);
        var (carrier, record) = ResolveTable(key);
        var m = MethodologyFor(gameKey, platformKey);
        return new Gen2TableRef
        {
            Key = key, Carrier = carrier, Record = record, Table = DecodeTable(carrier), Game = gameKey, PlatformKey = platformKey, State = state,
            Methodology = m.Id, Timing = m.Timing, Rule = BinRule(gameKey)
        };
    }

    // Every table key of a game in data order (platform keys, then the running and halted states), filtered. The scope is
    // validated here (Invert, Ambiguity, SampleFromHit and Verify all come through): an unknown platform, family or state
    // throws instead of silently scoping to no table at all.
    public List<string> TableKeys(string gameKey, string? platformKey = null, string family = "all", IReadOnlyList<string>? states = null)
    {
        var out_ = new List<string>();
        var stateIds = StateIds(gameKey);
        var platformKeys = PlatformKeys(gameKey);
        if (!Gen2Tid.Families.Contains(family)) throw new ArgumentException($"family must be one of {string.Join(", ", Gen2Tid.Families)} (got '{family}')");
        if (platformKey is not null && !platformKeys.Contains(platformKey))
            throw new ArgumentException($"no platform '{platformKey}' for {gameKey} (choose from {string.Join(", ", platformKeys)})");
        // states: every id must be a real RTC state (rtc.states); for an RTC-immune game (Crystal) the filter is then moot,
        // whatever the cartridge's clock its one table is days0.
        IReadOnlyList<string>? stateFilter = null;
        if (states is not null)
        {
            if (states.Count == 0) throw new ArgumentException("states must be a non-empty list of RTC state ids");
            foreach (var st in states) StateInfo(st);
            if (RtcDependent(gameKey)) stateFilter = states;
        }
        foreach (var pk in platformKeys)
        {
            if (platformKey is not null && pk != platformKey) continue;
            foreach (var st in stateIds)
            {
                if (family != "all" && ((family == "halted") != Gen2Tid.IsHaltedState(st))) continue;
                if (stateFilter is not null && !stateFilter.Contains(st)) continue;
                out_.Add(Gen2Tid.TableKey(gameKey, pk, st));
            }
        }
        return out_;
    }

    public List<Gen2TargetSet> TargetSetsFor(string gameKey, IReadOnlyList<string>? keys = null)
    {
        var g = Game(gameKey);
        var all = Root.GetProperty("target_sets");
        var wanted = keys is { Count: > 0 } ? keys.ToList()
            : (g.TryGetProperty("default_target_sets", out var d) ? d : g.GetProperty("target_sets")).EnumerateArray().Select(x => x.GetString() ?? "").ToList();
        var out_ = new List<Gen2TargetSet>();
        foreach (var k in wanted)
        {
            if (!all.TryGetProperty(k, out var spec))
                throw new ArgumentException($"target set '{k}' is not defined (choose from {string.Join(", ", all.EnumerateObject().Select(p => p.Name))})");
            var ts = new Gen2TargetSet(k, spec);
            if (!ts.Games.Contains(gameKey)) throw new ArgumentException($"target set '{k}' is not defined for {gameKey}");
            out_.Add(ts);
        }
        return out_;
    }
}

public static class Gen2Tid
{
    public const double Fps = Gen1Tid.Fps;
    public const double FrameMs = Gen1Tid.FrameMs;
    public const int VisibleMenuLagFrames = 4;
    public const int BinCount = 599;
    public const int OffsetMax = 2399;
    public const int PollPeriodFrames = 4;
    public static readonly int[] TapFrames = { 4, 8 };
    public static readonly double[] TapMs = { 4 * FrameMs, 8 * FrameMs };
    public const double RollSettleS = 0.35;
    public const int OutlierFrames = Gen1Tid.OutlierFrames;
    public static readonly string[] TwoStatePrior = { "days0", "days512" };
    public const string AnchorMenu = "menu";
    public const string AnchorPoweron = "poweron";
    public const string AnchorReset = "reset";
    public static readonly string[] Anchors = { AnchorMenu, AnchorPoweron, AnchorReset };

    public static string TableKey(string game, string platformKey, string state) => $"{game}/{platformKey}/{state}";
    public static (string Game, string PlatformKey, string State) SplitKey(string key)
    {
        var p = key.Split('/');
        if (p.Length != 3) throw new ArgumentException($"bad table key '{key}'");
        return (p[0], p[1], p[2]);
    }
    public static bool IsHaltedState(string state) => state.StartsWith("halt", StringComparison.Ordinal);
    public static readonly string[] Families = { "all", "running", "halted" };
    const int IdMax = 0xFFFF;
    // Typed IDs are integers 0..65535; an out-of-range value is a caller bug, not "absent from the tables".
    static int Id16(int x, string name) => x is < 0 or > IdMax ? throw new ArgumentException($"{name} must be an integer 0..65535 (got {x})") : x;
    static int? OptId16(int? x, string name) => x is null ? null : Id16(x.Value, name);
    static double Finite(double x, string name) => double.IsFinite(x) ? x : throw new ArgumentException($"{name} must be a finite number (got {Py(x)})");

    // ---- bins ------------------------------------------------------------------------------------
    public static int? BinOf(int offset, Gen2BinRule rule)
    {
        if (offset < 0 || offset > OffsetMax || Array.IndexOf(rule.DroppedOffsets, offset) >= 0) return null;
        if (rule.Bin0Lo <= offset && offset <= rule.Bin0Hi) return 0;
        return (int)Math.Floor((offset - rule.Subtract) / 4.0);
    }
    public static int? Bin(Gen2TidData data, string gameKey, int offset) => BinOf(offset, data.BinRule(gameKey));

    public static int[] OffsetsForBin(int bin, Gen2BinRule rule)
    {
        if (bin < 0 || bin >= BinCount) throw new ArgumentException($"bin {bin} is outside 0..{BinCount - 1}");
        if (bin == 0) return new[] { rule.Bin0Lo, rule.Bin0Hi };
        int lo = 4 * bin + rule.Subtract;
        return new[] { lo, Math.Min(lo + 3, OffsetMax) };
    }
    public static double AimOffset(int bin, Gen2BinRule rule) { var r = OffsetsForBin(bin, rule); return (r[0] + r[1]) / 2.0; }
    public static int[] VisibleWindow(int bin, Gen2BinRule rule) { var r = OffsetsForBin(bin, rule); return new[] { r[0] - VisibleMenuLagFrames, r[1] - VisibleMenuLagFrames }; }
    public static int PressFrame(Gen2Timing timing, int offset) => timing.MenuFrame + 1 + offset;
    public static int AcceptFrame(Gen2Timing timing, int bin) => timing.FirstPollFrame + PollPeriodFrames * bin;
    public static int RollFrame(Gen2Table table, Gen2Timing timing, int bin)
        => timing.MenuFrame + table.RollBase + PollPeriodFrames * bin + (table.RollSlips.TryGetValue(bin, out var s) ? s : 0);

    // ---- lookups ---------------------------------------------------------------------------------
    public static Gen2Lookup Lookup(Gen2TidData data, string gameKey, string platformKey, string state, int bin)
    {
        var t = data.TableFor(gameKey, platformKey, state);
        var off = OffsetsForBin(bin, t.Rule);
        return new Gen2Lookup
        {
            Game = gameKey, PlatformKey = platformKey, State = state, Key = t.Key, Carrier = t.Carrier, Methodology = t.Methodology, Bin = bin,
            Tid = t.Table.Tids[bin], Lid = t.Table.Lids[bin], Sid = t.Table.Sids?[bin],
            Offsets = off, Visible = VisibleWindow(bin, t.Rule), Aim = AimOffset(bin, t.Rule),
            PressFrames = new[] { PressFrame(t.Timing, off[0]), PressFrame(t.Timing, off[1]) }, AcceptFrame = AcceptFrame(t.Timing, bin), RollFrame = RollFrame(t.Table, t.Timing, bin)
        };
    }

    public static List<(int Bin, int Tid, int Lid, int? Sid)> Entries(Gen2TidData data, string gameKey, string platformKey, string state)
    {
        var t = data.TableFor(gameKey, platformKey, state);
        return Enumerable.Range(0, BinCount).Select(b => (b, t.Table.Tids[b], t.Table.Lids[b], t.Table.Sids?[b])).ToList();
    }

    // ---- inversion -------------------------------------------------------------------------------
    // The tables in scope grouped by the payload they carry (identical tables are one candidate each).
    public static List<(string Carrier, List<string[]> Members)> CarrierGroups(Gen2TidData data, string gameKey, string? platformKey = null,
        string family = "all", IReadOnlyList<string>? states = null)
    {
        var groups = new List<(string, List<string[]>)>();
        var index = new Dictionary<string, int>();
        foreach (var key in data.TableKeys(gameKey, platformKey, family, states))
        {
            var (carrier, _) = data.ResolveTable(key);
            if (!index.TryGetValue(carrier, out var i)) { i = groups.Count; index[carrier] = i; groups.Add((carrier, new List<string[]>())); }
            var (_, pk, st) = SplitKey(key);
            groups[i].Item2.Add(new[] { pk, st });
        }
        return groups;
    }

    public static Gen2Inversion Invert(Gen2TidData data, string gameKey, int tid, int? lid = null, int? sid = null, string? platformKey = null,
        string family = "all", IReadOnlyList<string>? states = null)
    {
        bool crystal = !data.RtcDependent(gameKey);
        Id16(tid, "tid"); OptId16(lid, "lid"); OptId16(sid, "sid");
        if (sid is not null && !data.Game(gameKey).GetProperty("ids").EnumerateArray().Any(x => x.GetString() == "sid"))
            throw new ArgumentException($"{gameKey} rolls no Secret ID: sid must not be given");
        var rule = data.BinRule(gameKey);
        var cands = new List<Gen2Candidate>();
        foreach (var (carrier, members) in CarrierGroups(data, gameKey, platformKey, family, states))
        {
            var t = data.DecodeTable(carrier);
            string st = SplitKey(carrier).State;
            for (int b = 0; b < BinCount; b++)
            {
                if (t.Tids[b] != tid) continue;
                if (lid is not null && t.Lids[b] != lid.Value) continue;
                if (sid is not null && (t.Sids is null || t.Sids[b] != sid.Value)) continue;
                cands.Add(new Gen2Candidate
                {
                    Key = carrier, Table = TableKey(gameKey, members[0][0], members[0][1]),
                    Members = members.Select(m => (string[])m.Clone()).ToArray(), Bin = b, Offsets = OffsetsForBin(b, rule),
                    Tid = t.Tids[b], Lid = t.Lids[b], Sid = t.Sids?[b], Family = IsHaltedState(st) ? "halted" : "running",
                    ReachableAfterFirstBoot = members.Any(m => data.Reachable(gameKey, m[1]))
                });
            }
        }
        var preferred = cands.Where(c => crystal || c.Members.Any(m => TwoStatePrior.Contains(m[1]))).ToList();
        var resolved = cands.Count == 1 ? cands[0] : preferred.Count == 1 ? preferred[0] : null;
        return new Gen2Inversion { Candidates = cands, Preferred = preferred, Ambiguous = cands.Count > 1, Resolved = resolved };
    }

    public static Gen2Ambiguity Ambiguity(Gen2TidData data, string gameKey, string? platformKey = null, string family = "all", IReadOnlyList<string>? states = null)
    {
        var groups = CarrierGroups(data, gameKey, platformKey, family, states);
        var byTid = new Dictionary<int, int>();
        var byPair = new Dictionary<string, int>();
        int tot = 0;
        foreach (var (carrier, _) in groups)
        {
            var t = data.DecodeTable(carrier);
            for (int b = 0; b < BinCount; b++)
            {
                byTid[t.Tids[b]] = byTid.TryGetValue(t.Tids[b], out var n) ? n + 1 : 1;
                string pk = $"{t.Tids[b]:X4}/{t.Lids[b]:X4}";
                byPair[pk] = byPair.TryGetValue(pk, out var m) ? m + 1 : 1;
                tot++;
            }
        }
        var coll = byPair.Where(kv => kv.Value > 1).Select(kv => kv.Key).OrderBy(x => x, StringComparer.Ordinal).ToArray();
        return new Gen2Ambiguity
        {
            Tables = groups.Count, Entries = tot, DistinctTids = byTid.Count, AmbiguousTids = byTid.Count(kv => kv.Value > 1),
            AmbiguousEntries = byTid.Where(kv => kv.Value > 1).Sum(kv => kv.Value), MaxCandidates = byTid.Count == 0 ? 0 : byTid.Values.Max(),
            PairCollisions = coll.Length, PairCollisionList = coll.Take(20).ToArray()
        };
    }

    // ---- target sets -----------------------------------------------------------------------------
    public static List<Gen2TargetSet> SetsAccepting(int tid, int? lid, int? sid, IEnumerable<Gen2TargetSet> sets)
    {
        Id16(tid, "tid"); OptId16(lid, "lid"); OptId16(sid, "sid");
        return sets.Where(s => s.Accepts(tid, lid, sid)).ToList();
    }
    public static (string Verdict, string[] Sets) VerdictDetail(int tid, int? lid, int? sid, IEnumerable<Gen2TargetSet> sets)
    {
        var hits = SetsAccepting(tid, lid, sid, sets);
        return (hits.Count > 0 ? "RUN" : "no", hits.Select(s => s.Key).ToArray());
    }
    public static string Verdict(int tid, int? lid, int? sid, IEnumerable<Gen2TargetSet> sets) => VerdictDetail(tid, lid, sid, sets).Verdict;
    public static string VerdictText(int tid, int? lid, int? sid, IReadOnlyList<Gen2TargetSet> sets)
    {
        var (v, keys) = VerdictDetail(tid, lid, sid, sets);
        if (v == "RUN")
        {
            bool scripted = keys.Any(k => sets.First(s => s.Key == k).Protocol == "community-script");
            return "route target (target set " + string.Join(", ", keys) + ")" +
                   (scripted ? "; the published protocol for it is a community multi-step script, not this single-tap methodology" : "");
        }
        return "not a route target (accepted by none of: " + string.Join(", ", sets.Select(s => s.Key)) + ")";
    }

    public static List<Gen2Target> Targets(Gen2TidData data, string gameKey, string platformKey, string state, IReadOnlyList<Gen2TargetSet> sets)
    {
        var t = data.TableFor(gameKey, platformKey, state);
        var out_ = new List<Gen2Target>();
        bool reach = data.Reachable(gameKey, state);
        for (int b = 0; b < BinCount; b++)
        {
            int tid = t.Table.Tids[b], lid = t.Table.Lids[b];
            int? sid = t.Table.Sids?[b];
            var hit = SetsAccepting(tid, lid, sid, sets);
            if (hit.Count > 0)
                out_.Add(new Gen2Target { Bin = b, Offsets = OffsetsForBin(b, t.Rule), Tid = tid, Lid = lid, Sid = sid, Sets = hit.Select(s => s.Key).ToArray(), ReachableAfterFirstBoot = reach });
        }
        return out_;
    }

    public static List<Gen2Target> TargetsAllStates(Gen2TidData data, string gameKey, string platformKey, IReadOnlyList<Gen2TargetSet> sets)
    {
        var out_ = new List<Gen2Target>();
        foreach (var st in data.StateIds(gameKey))
            foreach (var h in Targets(data, gameKey, platformKey, st, sets)) { h.State = st; out_.Add(h); }
        return out_;
    }

    // ---- schedules -------------------------------------------------------------------------------
    static string Py(double x) => x.ToString("R", System.Globalization.CultureInfo.InvariantCulture);

    public static Gen2Schedule Schedule(Gen2TidData data, string methodologyId, int bin, double correctionMs, string anchor = AnchorMenu, int beeps = 4,
        double spacingS = 1.0, double? resetExtraS = null)
    {
        var m = data.Methodology(methodologyId);
        var rule = data.BinRule(m.GameKey);
        var timing = m.Timing;
        if (!m.Anchors.Contains(anchor)) throw new ArgumentException($"anchor '{anchor}' is not offered for {methodologyId}");
        Finite(correctionMs, "correction (ms)"); Finite(spacingS, "count-in spacing (s)");
        var vw = VisibleWindow(bin, rule);
        double aimV = AimOffset(bin, rule) - VisibleMenuLagFrames;
        List<Cue> cues;
        int dropped;
        double tA, basis = 0.0;
        double? holdLo = null, holdHi = null, menu = null;
        if (anchor == AnchorMenu)
        {
            tA = aimV / Fps - correctionMs / 1000.0;
            if (tA <= 0) throw new ArgumentException($"the A cue would be due before the anchor (bin {bin}, correction {Py(correctionMs)} ms)");
            (cues, dropped) = Gen1Tid.CountInCues(tA, beeps, spacingS);
            cues.Add(new Cue(tA, Gen1Tid.ACueTone.Hz, Gen1Tid.ACueTone.Ms, "A", "A"));
        }
        else
        {
            double extra = 0.0;
            if (anchor == AnchorReset)
            {
                if (resetExtraS is null) throw new ArgumentException("the reset anchor needs the console's reset delay (fade + stall)");
                extra = Finite(resetExtraS.Value, "reset delay (s)");
            }
            double lo = timing.HoldLoFrame / Fps + extra, hi = timing.HoldHiFrame / Fps + extra, mn = timing.VisibleMenuFrame / Fps + extra;
            holdLo = lo; holdHi = hi; menu = mn;
            tA = mn + aimV / Fps - correctionMs / 1000.0;
            if (tA <= mn) throw new ArgumentException($"the A cue would be due before the menu (bin {bin}, correction {Py(correctionMs)} ms)");
            cues = new List<Cue>
            {
                new(lo, Gen1Tid.HoldTone.Hz, Gen1Tid.HoldTone.Ms, "hold-start", "hold"),
                new((lo + hi) / 2.0, Gen1Tid.HoldTone.Hz, Gen1Tid.HoldTone.Ms, "hold-centre", "hold"),
                new(mn, Gen1Tid.MenuMarkTone.Hz, Gen1Tid.MenuMarkTone.Ms, "menu", "menu"),
                new(mn + 0.08, Gen1Tid.MenuMarkTone.Hz, Gen1Tid.MenuMarkTone.Ms, "menu-2", "menu")
            };
            var (ci, d) = Gen1Tid.CountInCues(tA, beeps, spacingS, mn + Gen1Tid.CountInClearS);
            cues.AddRange(ci);
            dropped = d;
            cues.Add(new Cue(tA, Gen1Tid.ACueTone.Hz, Gen1Tid.ACueTone.Ms, "A", "A"));
            basis = mn;
        }
        return new Gen2Schedule
        {
            Anchor = anchor, TA = tA, HoldLo = holdLo, HoldHi = holdHi, Menu = menu, DroppedCountIn = dropped, Cues = cues.OrderBy(c => c.T).ToList(),
            Bin = bin, AimOffset = AimOffset(bin, rule), AimV = aimV, AWindow = new[] { basis + vw[0] / Fps, basis + (vw[1] + 1) / Fps },
            TapMs = (double[])TapMs.Clone(), RollSettleS = RollSettleS, Methodology = methodologyId
        };
    }

    // ---- calibration (Gen 1's sample arithmetic over bin centres) --------------------------------
    public static double ErrorFramesBins(Gen2BinRule rule, int hitBin, int aimedBin) => AimOffset(hitBin, rule) - AimOffset(aimedBin, rule);
    public static bool IsOutlierBins(Gen2BinRule rule, int hitBin, int aimedBin) => Math.Abs(ErrorFramesBins(rule, hitBin, aimedBin)) > OutlierFrames;
    public static double ImpliedCorrectionBins(Gen2BinRule rule, double correctionUsedMs, int hitBin, int aimedBin)
        => correctionUsedMs + Gen1Tid.FramesToMs(ErrorFramesBins(rule, hitBin, aimedBin));

    // Inverts the typed IDs on the platform (the given state, else the two-state prior), picks the candidate nearest the aim
    // and builds the calibration sample (hit / aimed are bin-centre offsets, so Gen1Tid's mean and drift helpers apply).
    public static Gen2SampleResult SampleFromHit(Gen2TidData data, string gameKey, string platformKey, string? state, int typedTid, int? typedLid, int aimedBin,
        double correctionUsedMs, string? attempt = null, string? note = null, string? player = null)
    {
        var rule = data.BinRule(gameKey);
        bool crystal = !data.RtcDependent(gameKey);
        OffsetsForBin(aimedBin, rule);
        Finite(correctionUsedMs, "correction used (ms)");
        IReadOnlyList<string>? states = state is not null ? new[] { state } : crystal ? null : TwoStatePrior;
        var inv = Invert(data, gameKey, typedTid, typedLid, null, platformKey, "all", states);
        Gen2Candidate? near = null;
        foreach (var c in inv.Candidates)
        {
            if (near is null || Math.Abs(c.Bin - aimedBin) < Math.Abs(near.Bin - aimedBin) || (Math.Abs(c.Bin - aimedBin) == Math.Abs(near.Bin - aimedBin) && c.Bin < near.Bin)) near = c;
        }
        Gen2Sample? sample = null;
        if (near is not null)
        {
            sample = new Gen2Sample
            {
                Tid = typedTid, Lid = typedLid, AimedBin = aimedBin, HitBin = near.Bin, Aimed = AimOffset(aimedBin, rule), Hit = AimOffset(near.Bin, rule),
                CorrectionUsedMs = correctionUsedMs, ImpliedMs = ImpliedCorrectionBins(rule, correctionUsedMs, near.Bin, aimedBin),
                State = string.Join("=", near.Members.Select(m => m[1]).Distinct().OrderBy(x => x, StringComparer.Ordinal)),
                Methodology = data.MethodologyFor(gameKey, platformKey).Id, Attempt = attempt, Note = note, Player = player
            };
        }
        return new Gen2SampleResult
        {
            Candidates = inv.Candidates, CandidateBins = inv.Candidates.Select(c => c.Bin).ToArray(), Nearest = near, NearestBin = near?.Bin,
            Ambiguous = inv.Ambiguous, Sample = sample
        };
    }

    // ---- verify ----------------------------------------------------------------------------------
    // The moderator's menu-to-press time (from the VISIBLE menu box to the A press) against the typed IDs.
    public static Gen2VerifyResult Verify(Gen2TidData data, string gameKey, string platformKey, int tid, int? lid, double measuredS, string? state = null)
    {
        var rule = data.BinRule(gameKey);
        Finite(measuredS, "measured time (s)");
        var inv = Invert(data, gameKey, tid, lid, null, platformKey, "all", state is null ? null : new[] { state });
        double predictedOffset = measuredS * Fps + VisibleMenuLagFrames;
        int? predictedBin = BinOf((int)Math.Floor(predictedOffset + 0.5), rule);
        var bins = inv.Candidates.Select(c => c.Bin).ToArray();
        int? nearest = null;
        int reference = predictedBin ?? -1000;
        foreach (var b in bins)
        {
            if (nearest is null || Math.Abs(b - reference) < Math.Abs(nearest.Value - reference) || (Math.Abs(b - reference) == Math.Abs(nearest.Value - reference) && b < nearest.Value)) nearest = b;
        }
        int? diff = nearest is null || predictedBin is null ? null : nearest.Value - predictedBin.Value;
        return new Gen2VerifyResult
        {
            PredictedOffset = predictedOffset, PredictedBin = predictedBin, Bins = bins, Nearest = nearest, DifferenceBins = diff,
            InTable = bins.Length > 0, Consistent = diff is not null && Math.Abs(diff.Value) <= 1
        };
    }
}
