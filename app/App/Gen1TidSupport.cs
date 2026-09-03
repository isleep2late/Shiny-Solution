using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using ShinySolution.Core;

namespace ShinySolution.App;

// The Gen 1 Trainer ID panel's data resolution, text and calibration records: a port of the
// webapp tab (webapp/gen1tid-ui.js) and of RNG Solution's terminal front end (rngsolution/cli.py,
// sidcli.py, config.py) over app/Core/Gen1Tid.cs and the embedded core/data JSON. The protocol's
// steps ARE the methodology; run mode is human input only (the anchor is your click, the outcome
// is the Trainer ID you type); nothing reads the game.

static class J
{
    public static string S(JsonElement e, string key, string fallback = "")
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : fallback;
    public static string[] SA(JsonElement e, string key)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : Array.Empty<string>();
    public static Dictionary<string, string> SD(JsonElement e, string key)
    {
        var d = new Dictionary<string, string>();
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Object)
            foreach (var p in v.EnumerateObject()) d[p.Name] = p.Value.GetString() ?? "";
        return d;
    }
    public static int Int(JsonElement e, string key, int fallback)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : fallback;
    public static double Dbl(JsonElement e, string key, double fallback)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : fallback;
}

// One console / emulator choice for one game under one methodology (rngsolution/tables.py Platform).
public sealed class Gen1Platform
{
    public const string DefaultGame = "red";

    public string Key { get; init; } = "";
    public string Name { get; init; } = "";
    public string GameKey { get; init; } = "";
    public string GameName { get; init; } = "";
    public string FamilyKey { get; init; } = "";
    public string MethodologyId { get; init; } = "";
    public string[] MethodologyIds { get; init; } = Array.Empty<string>();
    public JsonElement Spec { get; init; }
    public JsonElement Game { get; init; }
    public JsonElement Methodology { get; init; }
    public Gen1Methodology Meth { get; init; } = new();
    public string Status { get; init; } = "";
    public string Validation { get; init; } = "";
    public string[] Anchors { get; init; } = Array.Empty<string>();
    public Dictionary<string, string> AnchorNotes { get; init; } = new();
    public Dictionary<string, string> AnchorNames { get; init; } = new();
    public string FocusNote { get; init; } = "";
    public string ResetKey { get; init; } = "";
    public ResetModel ResetModel { get; init; } = new();
    public string ResetStatus { get; init; } = "";
    public JsonElement Defaults { get; init; }
    public List<TargetSet> TargetSets { get; init; } = new();

    public int[] Table => Meth.Table;
    public int MaxOffset => Meth.Table.Length - 1;
    public Gen1Timing Timing => Meth.Timing;
    public int Distinct => Meth.Raw.TryGetProperty("table_data", out var td) ? J.Int(td, "distinct", 0) : 0;
    public double DefaultCorrection(string anchor)
        => Defaults.TryGetProperty("correction_ms", out var c) ? J.Dbl(c, anchor, 100.0) : 100.0;
    public int CountInBeeps => J.Int(Defaults, "count_in_beeps", 4);
    public double CountInSpacing => J.Dbl(Defaults, "count_in_spacing_s", 1.0);
    public int ResetPairs => J.Int(Defaults, "reset_pairs", 15);
    public double ResetCadence => J.Dbl(Defaults, "reset_cadence_s", 2.0);
    public string[] TargetSetKeys => TargetSets.Select(s => s.Key).ToArray();
    public string[] OtherTargetSetKeys => J.SA(Game, "target_sets").Where(k => !TargetSetKeys.Contains(k)).ToArray();
    public string AnchorName(string a) => AnchorNames.TryGetValue(a, out var n) ? n : a;

    public static string[] SupportedGames(Gen1TidData data)
        => data.Root.GetProperty("games").EnumerateObject().Where(g => J.S(g.Value, "status") == "supported").Select(g => g.Name).ToArray();

    // (the default methodology id, the ids offered) for a platform under one game: Red uses the
    // platform's own; another game offers its methodologies whose console_id is the platform's family.
    public static (string? Default, List<string> Ids) PlatformMethodologies(Gen1TidData data, string platformKey, string gameKey)
    {
        var spec = data.Root.GetProperty("platforms").GetProperty(platformKey);
        string familyKey = J.S(spec, "family");
        var family = data.Root.GetProperty("families").GetProperty(familyKey);
        if (gameKey == DefaultGame)
        {
            string def = J.S(spec, "methodology");
            if (def == "") def = J.S(family, "methodology");
            var ids = J.SA(spec, "methodologies").ToList();
            if (ids.Count == 0) ids = J.SA(family, "methodologies").ToList();
            if (def != "" && !ids.Contains(def)) ids.Insert(0, def);
            return (def == "" ? null : def, ids);
        }
        var g = data.Root.GetProperty("games").GetProperty(gameKey);
        var meths = data.Root.GetProperty("methodologies");
        var mids = J.SA(g, "methodologies").Where(m => meths.TryGetProperty(m, out var me) && J.S(me, "console_id") == familyKey).ToList();
        return (mids.Count > 0 ? mids[0] : null, mids);
    }

    public static List<(string Key, string Name, string Default)> PlatformsFor(Gen1TidData data, string gameKey)
    {
        var out_ = new List<(string, string, string)>();
        foreach (var p in data.Root.GetProperty("platforms").EnumerateObject())
        {
            var (def, _) = PlatformMethodologies(data, p.Name, gameKey);
            if (def is null) continue;
            string status = gameKey == DefaultGame ? J.S(p.Value, "status")
                : J.S(data.Root.GetProperty("methodologies").GetProperty(def), "status_short", "emulator-derived, no hardware sample yet");
            out_.Add((p.Name, $"{J.S(p.Value, "name")}   [{status}]", def));
        }
        return out_;
    }

    public static Gen1Platform Resolve(Gen1TidData data, string gameKey, string platformKey, string? methodologyId, IReadOnlyList<string>? targetSetKeys)
    {
        var spec = data.Root.GetProperty("platforms").GetProperty(platformKey);
        var g = data.Root.GetProperty("games").GetProperty(gameKey);
        if (J.S(g, "status") != "supported") throw new ArgumentException($"no runnable methodology for {gameKey}");
        var (def, ids) = PlatformMethodologies(data, platformKey, gameKey);
        string mid = string.IsNullOrEmpty(methodologyId) ? def ?? "" : methodologyId;
        if (mid == "" || !ids.Contains(mid)) throw new ArgumentException($"methodology '{mid}' is not available on {platformKey} for {gameKey}");
        var m = data.Root.GetProperty("methodologies").GetProperty(mid);
        string status = J.S(spec, "status"), validation = J.S(spec, "validation");
        if (gameKey != DefaultGame)
        {
            status = J.S(m, "status_short", "emulator-derived, no hardware sample yet");
            validation = J.S(m, "validation");
        }
        var anchors = J.SA(spec, "anchors");
        if (anchors.Length == 0) anchors = new[] { Gen1Tid.AnchorMenu, Gen1Tid.AnchorPoweron };
        return new Gen1Platform
        {
            Key = platformKey, Name = J.S(spec, "name"), GameKey = gameKey, GameName = J.S(g, "name", gameKey), FamilyKey = J.S(spec, "family"),
            MethodologyId = mid, MethodologyIds = ids.ToArray(), Spec = spec, Game = g, Methodology = m, Meth = data.Methodology(mid),
            Status = status, Validation = validation, Anchors = anchors, AnchorNotes = J.SD(spec, "anchor_notes"),
            AnchorNames = data.Root.TryGetProperty("anchor_names", out var an) ? an.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.GetString() ?? "") : new(),
            FocusNote = J.S(spec, "focus_note"), ResetKey = J.S(spec, "reset"), ResetModel = data.ResetModel(J.S(spec, "reset")),
            ResetStatus = J.S(spec, "reset_status"), Defaults = data.Root.GetProperty("defaults"),
            TargetSets = data.TargetSetsFor(gameKey, targetSetKeys is { Count: > 0 } ? targetSetKeys : null)
        };
    }
}

// One stored calibration sample: RNG Solution's config.json record (snake_case) plus 'when' and
// 'mode' (the RUN / PRACTICE-HUNT mode it was made in; absent on records from before modes existed,
// which Modes.Effective reads as RUN: no head could read a capture then).
public sealed class CalSample
{
    [JsonPropertyName("tid")] public int Tid { get; set; }
    [JsonPropertyName("aimed")] public int Aimed { get; set; }
    [JsonPropertyName("hit")] public int Hit { get; set; }
    [JsonPropertyName("correction_used_ms")] public double CorrectionUsedMs { get; set; }
    [JsonPropertyName("implied_ms")] public double ImpliedMs { get; set; }
    [JsonPropertyName("attempt")] public string? Attempt { get; set; }
    [JsonPropertyName("note")] public string Note { get; set; } = "";
    [JsonPropertyName("player")] public string? Player { get; set; }
    [JsonPropertyName("methodology")] public string? Methodology { get; set; }
    [JsonPropertyName("when")] public string? When { get; set; }
    [JsonPropertyName("mode")] public string? Mode { get; set; }

    public Sample ToSample() => new()
    {
        Tid = Tid, Aimed = Aimed, Hit = Hit, CorrectionUsedMs = CorrectionUsedMs, ImpliedMs = ImpliedMs,
        Attempt = Attempt, Note = Note, Player = Player, Methodology = Methodology
    };

    public static CalSample From(Sample s, string? when, string mode) => new()
    {
        Tid = s.Tid, Aimed = s.Aimed, Hit = s.Hit, CorrectionUsedMs = s.CorrectionUsedMs, ImpliedMs = s.ImpliedMs,
        Attempt = s.Attempt, Note = s.Note, Player = s.Player, Methodology = s.Methodology, When = when, Mode = Modes.Check(mode)
    };
}

public sealed class CalEntry
{
    [JsonPropertyName("samples")] public List<CalSample> Samples { get; set; } = new();
}

// One Secret ID pin, with the RUN / PRACTICE-HUNT mode it was made in (absent on pins from before
// modes existed, which Modes.Effective reads as RUN).
public sealed class PinRecord
{
    [JsonPropertyName("pid")] public uint Pid { get; set; }
    [JsonPropertyName("shiny")] public bool Shiny { get; set; }
    [JsonPropertyName("note")] public string Note { get; set; } = "";
    [JsonPropertyName("when")] public string When { get; set; } = "";
    [JsonPropertyName("mode")] public string? Mode { get; set; }
}

// One remembered reset-metronome adjustment (frames) for one console, with the mode it was made in;
// a bare number in an older settings file is a RUN record from before modes existed (ParseResetAdjust).
public sealed class ResetAdjustRecord
{
    [JsonPropertyName("frames")] public double Frames { get; set; }
    [JsonPropertyName("mode")] public string? Mode { get; set; }
    [JsonPropertyName("when")] public string? When { get; set; }
}

public sealed class OutcomeReport
{
    public int Tid;
    public int[] Offsets = Array.Empty<int>();
    public int? Hit;
    public double? Implied;
    public bool Added;
    public string? Refused;
    public double? NewCorrection;
    public List<string> Lines = new();
}

public static class Gen1TidText
{
    public const string MethodologySentence = "Predictions are valid only under this methodology.";
    public const string RulesLine = "Run mode uses only your own input: you click the anchor button and type the Trainer ID you saw. Nothing reads the screen, the emulator or the console.";
    public const string AnyPercent = "Any% save corruption";
    public static readonly string[] SidGames = { "emerald", "firered", "leafgreen" };

    public static string F(double x, int d, bool plus = false) => Gen1Tid.PyFixed(x, d, plus);
    public static string FmtSf(double seconds)
    {
        double frames = seconds * Gen1Tid.Fps;
        if (Math.Abs(frames - Math.Round(frames)) < 1e-6) return $"{F(seconds, 3)} s ({(int)Math.Round(frames)} frames)";
        return $"{F(seconds, 3)} s ({F(frames, 1)} frames)";
    }
    public static string FmtMs(double ms) => $"{F(ms, 1)} ms ({F(Gen1Tid.MsToFrames(ms), 2)} frames)";
    public static string FmtPct(double p) => F(100.0 * p, 0) + " %";
    public static string FmtAttempts(double p) { double a = Gen1Tid.ExpectedAttempts(p); return double.IsInfinity(a) ? "inf" : F(a, 1); }
    public static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";
    public static string Now() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");

    // ---- the sources the protocol, the target line, the schedule and verify rest on: footnotes [^n] over the citation
    // registry (Citations.cs), numbered in this fixed order so every line of the panel carries the Sources block's
    // numbers; the web tab's sources (webapp/gen1tid-ui.js sourcesFor) word for word. The decomp lines are pokered's
    // (Blue is pret's pokered built for Blue) or pokeyellow's; the table is a measured source under the console's
    // validation status word from gen1-tid.json (EMULATOR-EXACT on GSE, HARDWARE-VALIDATED n where the console was
    // sampled, EMPIRICAL otherwise) ----
    public static readonly string[] SourceOrder = { "holdStart", "table", "menuInput", "tidRoll", "stir" };
    static readonly Regex ValidatedN = new(@"(\d+ of \d+)", RegexOptions.Compiled);
    public static string StatusWord(Gen1Platform p)
    {
        if (p.Status == "emulator-exact") return "EMULATOR-EXACT";
        var m = ValidatedN.Match(p.Validation ?? "");
        if (p.Status == "hardware-validated" && m.Success) return "HARDWARE-VALIDATED " + m.Groups[1].Value;
        return "EMPIRICAL";
    }
    public static Dictionary<string, Citations.CiteSource> SourcesFor(Gen1Platform p)
    {
        bool y = p.GameKey == "yellow";
        string repo = y ? "pokeyellow" : "pokered";
        var t = p.Timing;
        return new Dictionary<string, Citations.CiteSource>
        {
            ["holdStart"] = y
                ? new("pokeyellow/engine/movie/title.asm:166-175", null, "Yellow's title loop tests hJoyHeld for A or START by level on every frame, so START held anywhere in the window is read on the title's first frame and the NEW GAME menu opens on one fixed frame")
                : new("pokered/engine/movie/title.asm:227-239,266", null, "the title screen waits on CheckForUserInterruption (one JoypadLowSensitivity poll per frame; START or A ends it), then the cry and the fade play before MainMenu, so START held anywhere in the window is read on the first poll and the NEW GAME menu opens on one fixed frame"),
            ["table"] = new(null, null,
                "hold START on any frame " + t.HoldLoFrame + "-" + t.HoldHiFrame + " and the NEW GAME menu opens on frame " + t.MenuFrame + "; the A press frame is the menu frame + 80 + the offset (the table's definition), one Trainer ID per offset under " + p.MethodologyId + "; " + p.Name + ": " + p.Status,
                "the table's derivation on pokemon-speedrunning/gambatte-core with START held inside the window, docs/FACTS.md Gen 1 Trainer ID (hold-START methodologies, RNG Solution)", StatusWord(p)),
            ["menuInput"] = new(repo + "/engine/menus/main_menu.asm:" + (y ? "63-66,84" : "64-68,85-86"), null, "the NEW GAME menu waits in HandleMenuInput with A, B and START watched; A on NEW GAME goes to StartNewGame, so the frame of that press is the one the offset counts"),
            ["tidRoll"] = new(repo + "/engine/movie/oak_speech/init_player_data.asm:1-10", null, "InitPlayerData2, first thing in the Oak speech, rolls the Trainer ID with two Random calls: hRandomSub is the high byte, hRandomAdd the low byte"),
            ["stir"] = new(repo + "/engine/math/random.asm:1-13", null, "Random_ is the only RNG: hRandomAdd += rDIV and hRandomSub -= rDIV, called once per VBlank, so the Trainer ID is a function of the frame of the A press and of the DIV phase the hold-START boot fixes"),
        };
    }
    public static Citations.Footnotes FootnotesFor(Gen1Platform p) => new(SourcesFor(p), SourceOrder);

    public static string DerivationTag(Gen1Platform p, int offset)
    {
        if (Gen1Tid.Verdict(p.Table[offset], p.TargetSets) != "RUN") return "";
        return p.Timing.VerifiedTargets.Contains(offset) ? "[3x cold-boot verified]" : "[extended sweep, one derivation]";
    }
    public static string SetTag(Gen1Platform p, int tid) => string.Join(", ", Gen1Tid.SetsAccepting(tid, p.TargetSets).Select(s => s.Key));
    public static string DescribeTarget(Gen1Platform p, int offset)
    {
        int tid = p.Table[offset];
        string v = Gen1Tid.Verdict(tid, p.TargetSets);
        string tag = v == "RUN" ? $"route-valid ({AnyPercent}: {SetTag(p, tid)})" : v == "40!" ? "TRAP: $40 but hard-locks" : "";
        string ver = DerivationTag(p, offset);
        return $"offset {offset} -> {Gen1Tid.FormatTid(tid)} : press A {FmtSf(Gen1Tid.TargetSeconds(offset))} after the menu" +
            (tag != "" ? "   " + tag : "") + (ver != "" ? " " + ver : "") + FootnotesFor(p).Mark("table", "tidRoll");
    }

    public static List<string> MethodologyLines(Gen1Platform p, bool conditions, string indent = "  ")
    {
        var m = p.Methodology;
        var lines = new List<string>
        {
            $"{indent}Methodology: {p.MethodologyId}   ({J.S(m, "name")}; v{J.Int(m, "version", 0)}, {J.S(m, "date")})",
            indent + MethodologySentence
        };
        if (conditions)
        {
            lines.Add(indent + "Valid only if:");
            foreach (var c in J.SA(m, "validity")) lines.Add(indent + "  - " + c);
        }
        return lines;
    }

    public static List<string> TargetSetLines(Gen1Platform p)
    {
        if (p.TargetSets.Count == 0) return new() { $"Target sets: none for {p.GameName} (no Trainer ID is route-valid; any ID can still be aimed at)" };
        var lines = new List<string> { "Target sets in force: " + string.Join(", ", p.TargetSetKeys) };
        foreach (var x in p.TargetSets)
        {
            lines.Add($"  - {x.Name} [{x.Describe()}]");
            if (x.Provenance != "") lines.Add("      provenance: " + x.Provenance);
        }
        var others = p.OtherTargetSetKeys;
        if (others.Length > 0) lines.Add($"  also defined for {p.GameName}, not in force: {string.Join(", ", others)}");
        return lines;
    }

    static string ResetActionName(Gen1Platform p) => p.Key == "gse" ? "Ctrl+R (hard reset)" : "the GameCube RESET button";
    static string PowerOnPhrase(Gen1Platform p)
    {
        bool allowsReset = J.S(p.Methodology, "protocol").ToLowerInvariant().Contains("hard reset");
        if (p.Key == "gse" && allowsReset) return "Power on (Ctrl+R hard reset on GSE)";
        if (p.Anchors.Contains(Gen1Tid.AnchorReset) && allowsReset) return "Power on (or hard reset)";
        return "Power on";
    }
    static string AppNote(string text) => text.Replace("press ENTER", "click the anchor button").Replace("your ENTER", "your anchor click")
        .Replace("ENTER", "the anchor click").Replace("THIS terminal window", "THIS app window").Replace("terminal window", "app window");

    public static Schedule BuildSchedule(Gen1Platform p, string anchor, int offset, double correctionMs, int beeps, double spacing)
    {
        double? extra = anchor == Gen1Tid.AnchorReset ? Gen1Tid.ResetAnchorExtraSeconds(p.ResetModel) : null;
        return Gen1Tid.BuildSchedule(anchor, p.Timing, offset, correctionMs, beeps, spacing, extra);
    }

    public static List<string> ProtocolLines(Gen1Platform p, string anchor, int offset, Schedule sched, double correctionMs, int beeps, double spacing)
    {
        double holdLo = Gen1Tid.FramesToSeconds(p.Timing.HoldLoFrame), holdHi = Gen1Tid.FramesToSeconds(p.Timing.HoldHiFrame);
        double menu = Gen1Tid.FramesToSeconds(p.Timing.MenuFrame);
        int tid = p.Table[offset];
        var m = p.Methodology;
        var fn = FootnotesFor(p);
        var lines = new List<string>
        {
            $"PROTOCOL  ({p.GameName} on {p.Name}, target offset {offset} -> {Gen1Tid.FormatTid(tid)})",
            $"    Methodology: {p.MethodologyId}   ({J.S(m, "name")}; v{J.Int(m, "version", 0)}, {J.S(m, "date")})",
            "    " + MethodologySentence + " The steps below ARE the methodology: any other",
            "    input pattern (START earlier or later, a tap instead of a hold, an extra press) gives a",
            "    different, deterministic Trainer ID that this table does not cover.",
            ""
        };
        if (p.Key == "gbp") { lines.Add("    NOTE: " + p.Validation); lines.Add(""); }
        lines.Add(" 1. Clear the save: on the title screen hold UP + SELECT + B, confirm YES, then power fully OFF.");
        lines.Add("    (The clear must be on video for a submitted run. A CONTINUE option on the menu means the");
        lines.Add("    attempt is invalid: the table assumes a fresh NEW GAME menu.)");
        if (p.Key == "gse") lines.Add("    On GSE: keep a ROM copy with no .sav beside it, or NEW GAME silently becomes CONTINUE.");
        if (anchor == Gen1Tid.AnchorMenu)
        {
            lines.Add($" 2. {PowerOnPhrase(p)}. Touch nothing during the boot and intro.");
            lines.Add($" 3. Between {F(holdLo, 2)} s and {F(holdHi, 2)} s after the boot starts (frames {p.Timing.HoldLoFrame}-{p.Timing.HoldHiFrame}), HOLD START and keep holding." + fn.Mark("holdStart", "table"));
            lines.Add("    Anywhere inside that window gives the same result: this press is NOT timed.");
            string landmark = J.S(m, "landmark");
            if (landmark != "") lines.Add("    Landmark: " + landmark);
            lines.Add($" 4. The NEW GAME menu opens at {F(menu, 2)} s (frame {p.Timing.MenuFrame}). The INSTANT you see it, click ANCHOR (or press Space)." + fn.Mark("table", "menuInput"));
            lines.Add("    Release START whenever you like; release timing does not matter.");
            lines.Add($" 5. You will hear {beeps} short beeps {F(spacing, 1)} s apart, then one long high beep (the display flashes with each).");
            lines.Add("    Press A ON the long high beep. That is the only frame-exact action." + fn.Mark("tidRoll", "stir", "table"));
            lines.Add($"    Target: A at {FmtSf(Gen1Tid.TargetSeconds(offset))} after the menu. The beep is {FmtMs(correctionMs)} early to cover your");
            lines.Add("    reaction to the menu plus the audio delay (the correction; calibration tunes it).");
        }
        else
        {
            lines.Add(anchor == Gen1Tid.AnchorReset
                ? $" 2. Click ANCHOR (or press Space) at the SAME instant you press {ResetActionName(p)}."
                : " 2. Click ANCHOR (or press Space) at the SAME instant you flip the power on.");
            if (p.AnchorNotes.TryGetValue(anchor, out var note) && note != "") lines.Add("    " + AppNote(note));
            lines.Add("    Touch nothing during the boot and intro.");
            double hLo = sched.HoldLo ?? 0, hHi = sched.HoldHi ?? 0, mn = sched.Menu ?? 0;
            lines.Add($" 3. Two low beeps mark the START-hold window ({F(hLo, 2)} s and {F((hLo + hHi) / 2.0, 2)} s after your anchor)." + fn.Mark("holdStart", "table"));
            lines.Add($"    HOLD START on the first low beep and keep holding. Anywhere in {F(hLo, 2)}-{F(hHi, 2)} s is fine.");
            lines.Add($" 4. A double blip at {F(mn, 2)} s marks when the NEW GAME menu should appear (frame {p.Timing.MenuFrame} of the boot)." + fn.Mark("table", "menuInput"));
            lines.Add("    If the menu appears far from the blip, START was held outside the window: the");
            lines.Add("    attempt is no good, reset and try again. Release START whenever.");
            lines.Add($" 5. Then {beeps - sched.DroppedCountIn} short beeps {F(spacing, 1)} s apart and one long high beep. Press A ON the long high beep." + fn.Mark("tidRoll", "stir", "table"));
            lines.Add($"    Target: A at {FmtSf(Gen1Tid.TargetSeconds(offset))} after the menu = {FmtSf(mn + Gen1Tid.TargetSeconds(offset))} after your anchor.");
            lines.Add($"    The beep is {FmtMs(correctionMs)} early for the audio delay (this anchor's correction).");
            if (sched.DroppedCountIn > 0) lines.Add($"    ({Plural(sched.DroppedCountIn, "count-in beep")} left out: they would have sounded before the menu.)");
        }
        if (p.FocusNote != "") { lines.Add(""); lines.Add("    " + AppNote(p.FocusNote)); }
        if (p.TargetSets.Any(x => x.Kind == "sled"))
        {
            lines.Add(" 6. Afterwards, type the Trainer ID you got below (a Pokemon's status screen shows IDNo;");
            lines.Add("    in the route, whether the corruption completes tells you the high byte was $40).");
        }
        else
        {
            lines.Add(" 6. Afterwards, type the Trainer ID you got below (read it off the Trainer Card, or a");
            lines.Add("    Pokemon's status screen shows IDNo).");
        }
        lines.Add("    Each answer sharpens the correction." + fn.Mark("table"));
        lines.Add("");
        lines.AddRange(fn.Lines());
        return lines;
    }

    public static List<string> ScheduleLines(Schedule sched, int offset, double correctionMs, Gen1Platform p)
    {
        var lines = new List<string> { "SCHEDULE (seconds after your anchor):", "  Methodology: " + p.MethodologyId };
        if (sched.Anchor != Gen1Tid.AnchorMenu)
        {
            lines.Add($"  hold START window   {F(sched.HoldLo ?? 0, 3)} - {F(sched.HoldHi ?? 0, 3)} s   (low beeps at the start and the middle)");
            lines.Add($"  menu should appear  {F(sched.Menu ?? 0, 3)} s   (double blip)");
        }
        if (sched.CountInTimes.Length > 0) lines.Add("  count-in beeps      " + string.Join(", ", sched.CountInTimes.Select(t => F(t, 3))));
        lines.Add($"  A cue (long beep)   {F(sched.TA ?? 0, 3)} s   = target {FmtSf(Gen1Tid.TargetSeconds(offset))}" +
            (sched.Anchor == Gen1Tid.AnchorMenu ? " after the menu" : " after the menu, from your anchor") + $" minus correction {FmtMs(correctionMs)}" + FootnotesFor(p).Mark("table"));
        return lines;
    }

    public static string AnnounceCue(Cue c) => c.Kind switch
    {
        "count" => "beep " + c.Label.Substring(c.Label.IndexOf('-') + 1),
        "A" => ">>> A <<<",
        "hold" => c.Label == "hold-start" ? "HOLD START now (keep holding)" : "still inside the hold window",
        "menu" => c.Label == "menu" ? "menu should appear NOW" : "",
        "reset" => "RESET",
        "abeat" => "A",
        "power" => "POWER OFF",
        _ => c.Label
    };

    // ---- calibration records (rngsolution/config.py) ------------------------------------------
    // Every record carries the mode it was made in and each mode has its own setting key
    // (AppMode.Scoped); inside a store, a record under another methodology or made in the other mode
    // is left out of the correction and named in a note (RNG Solution's per-methodology rule, applied
    // to modes too), so a practice-derived correction is never in force in a run.
    public static string CalKey(string platformKey, string anchor) => platformKey + "/" + anchor;
    public static List<CalSample> AllSamples(Dictionary<string, CalEntry> cal, string platformKey, string anchor)
        => cal.TryGetValue(CalKey(platformKey, anchor), out var e) ? e.Samples.ToList() : new();
    static bool InScope(CalSample s, Gen1Platform p, string mode) => s.Methodology == p.MethodologyId && Modes.Effective(s.Mode) == mode;
    public static List<CalSample> StoredFor(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        return AllSamples(cal, p.Key, anchor).Where(s => InScope(s, p, mode)).ToList();
    }
    public static List<Sample> SamplesFor(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
        => StoredFor(cal, p, anchor, mode).Select(s => s.ToSample()).ToList();
    // (under another methodology, under this methodology but made in the other mode)
    public static (List<CalSample> Methodology, List<CalSample> Mode) IgnoredSamples(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
    {
        var all = AllSamples(cal, p.Key, anchor);
        var (_, otherMode) = Modes.SplitByMode(all.Where(s => s.Methodology == p.MethodologyId), s => s.Mode, mode);
        return (all.Where(s => s.Methodology != p.MethodologyId).ToList(), otherMode);
    }
    public static double CorrectionInForce(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
        => Gen1Tid.MeanCorrection(SamplesFor(cal, p, anchor, mode), p.DefaultCorrection(anchor));
    public static List<string> IgnoredSampleLines(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
    {
        var (byMethodology, byMode) = IgnoredSamples(cal, p, anchor, mode);
        var lines = new List<string>();
        if (byMethodology.Count > 0)
        {
            var others = byMethodology.Select(x => x.Methodology ?? "no methodology (recorded before methodology ids existed)").Distinct().OrderBy(x => x, StringComparer.Ordinal);
            lines.Add($"NOTE: {Plural(byMethodology.Count, "stored sample")} for {p.Key}/{anchor} ignored: recorded under {string.Join(", ", others)}, not {p.MethodologyId}. Samples are never mixed across methodologies.");
        }
        if (byMode.Count > 0)
        {
            var modes = byMode.Select(x => Modes.Describe(x.Mode)).Distinct().OrderBy(x => x, StringComparer.Ordinal);   // a mode this head does not know is named, never thrown on
            lines.Add($"NOTE: {Plural(byMode.Count, "stored sample")} for {p.Key}/{anchor} ignored: recorded in {string.Join(", ", modes)} mode, not {Modes.Label(mode)}. " +
                      "Samples are never mixed across modes: a practice-derived correction is never in force in a run.");
        }
        return lines;
    }

    // The outcome of one attempt (rngsolution/cli.py report_outcome): the typed Trainer ID inverted to
    // the offset nearest the aim, the implied correction, and the sample recorded unless a guard refuses it.
    public static OutcomeReport RecordOutcome(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, int aimed, double correctionUsed, int tid,
        bool force, string? attempt, string mode)
    {
        Modes.Check(mode);                                  // the record must say which mode it was made in
        var r = new OutcomeReport { Tid = tid, Offsets = Gen1Tid.Invert(p.Table, tid) };
        r.Lines.Add($"You got {Gen1Tid.FormatTid(tid)}: {Gen1Tid.VerdictTextFor(tid, p.TargetSets)}.");
        if (r.Offsets.Length == 0)
        {
            r.Lines.Add($"  That Trainer ID is not in the {p.Name} table, so nothing can be learned from it.");
            r.Lines.Add("  Usual causes: START held outside the window, the save was not cleared (CONTINUE menu),");
            r.Lines.Add($"  a different console family, or the press was later than the table's {F(Gen1Tid.TargetSeconds(p.MaxOffset), 1)} s.");
            r.Lines.Add("  Correction unchanged.");
            return r;
        }
        int hit = Gen1Tid.NearestOffset(r.Offsets, aimed) ?? aimed;
        r.Hit = hit;
        if (r.Offsets.Length > 1) r.Lines.Add($"  ({Gen1Tid.FormatTid(tid)} comes from offsets {string.Join(", ", r.Offsets)}; using {hit}, the one nearest your aim)");
        int err = Gen1Tid.ErrorFrames(hit, aimed);
        r.Lines.Add(err == 0 ? $"  You hit offset {hit} exactly (aimed {aimed})."
            : $"  You hit offset {hit}, aimed {aimed}: {Math.Abs(err)} frames {(err > 0 ? "late" : "early")} ({F(Math.Abs(Gen1Tid.FramesToMs(err)), 1)} ms).");
        r.Implied = Gen1Tid.ImpliedCorrection(correctionUsed, hit, aimed);
        r.Lines.Add($"  This attempt implies a correction of {F(r.Implied.Value, 1)} ms (used {F(correctionUsed, 1)} ms).");
        var sample = Gen1Tid.MakeSample(tid, aimed, hit, correctionUsed, attempt, "", "winforms", p.MethodologyId);
        var stored = AllSamples(cal, p.Key, anchor);
        List<Sample> kept;
        try
        {
            kept = Gen1Tid.AddSample(stored.Select(s => s.ToSample()), sample, force);
        }
        catch (OutlierSampleException)
        {
            r.Refused = "outlier";
            r.Lines.Add($"  That is more than {Gen1Tid.OutlierFrames} frames ({F(Gen1Tid.FramesToSeconds(Gen1Tid.OutlierFrames), 1)} s) from the aim: NOT added to the calibration ({anchor} anchor).");
            r.Lines.Add("  Usual causes: START held outside the window (the table does not apply to that attempt),");
            r.Lines.Add("  a mistyped Trainer ID, or the ID of a different attempt. If it really was this attempt, tick 'force' and record again.");
            return r;
        }
        catch (DuplicateSampleException)
        {
            r.Refused = "duplicate";
            r.Lines.Add($"  Looks like the same attempt entered twice (same Trainer ID and the same aim): not added ({anchor} anchor).");
            r.Lines.Add("  Tick 'force' if it really was a new attempt.");
            return r;
        }
        stored.Add(CalSample.From(sample, Now(), mode));
        cal[CalKey(p.Key, anchor)] = new CalEntry { Samples = stored };
        r.Added = true;
        int n = SamplesFor(cal, p, anchor, mode).Count;
        r.NewCorrection = CorrectionInForce(cal, p, anchor, mode);
        r.Lines.Add($"  Correction updated to {F(r.NewCorrection.Value, 1)} ms ({Plural(n, "sample")}, {anchor} anchor).");
        r.Lines.Add($"  Methodology: {p.MethodologyId} (recorded with the sample; only samples under it are averaged).");
        r.Lines.Add($"  Mode: {Modes.Label(mode)} (recorded with the sample; only samples made in this mode are averaged, from this mode's own store).");
        r.Lines.AddRange(IgnoredSampleLines(cal, p, anchor, mode).Select(l => "  " + l));
        return r;
    }

    // the newest sample under this methodology made in this mode; others stay where they are
    public static CalSample? DropLastSample(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        var stored = AllSamples(cal, p.Key, anchor);
        for (int i = stored.Count - 1; i >= 0; i--)
        {
            if (InScope(stored[i], p, mode))
            {
                var d = stored[i];
                stored.RemoveAt(i);
                cal[CalKey(p.Key, anchor)] = new CalEntry { Samples = stored };
                return d;
            }
        }
        return null;
    }

    public static (int Removed, int Kept) ClearSamples(Dictionary<string, CalEntry> cal, Gen1Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        var stored = AllSamples(cal, p.Key, anchor);
        var kept = stored.Where(s => !InScope(s, p, mode)).ToList();
        if (kept.Count > 0) cal[CalKey(p.Key, anchor)] = new CalEntry { Samples = kept }; else cal.Remove(CalKey(p.Key, anchor));
        return (stored.Count - kept.Count, kept.Count);
    }

    public static string SampleLine(CalSample x)
        => $"  {x.When}  aimed {x.Aimed}  hit {x.Hit}  used {F(x.CorrectionUsedMs, 1)} ms  implied {F(x.ImpliedMs, 1)} ms  {Gen1Tid.FormatTid(x.Tid)}";

    // ---- the runner's timing (rngsolution/cli.py hit_summary, stats_block) --------------------------
    static bool HasSpread(AnchorStats st) => st.N >= 2 && !double.IsNaN(st.SdMs);
    static string PRangeText(double sd, int n, bool centred)
    {
        var (lo, hi) = Gen1Tid.HitProbabilityRange(sd, n, Gen1Tid.FrameMs, Gen1Tid.SdIntervalConf, centred);
        string tag = $"{(int)Math.Round(100 * Gen1Tid.SdIntervalConf)} % range {FmtPct(lo).Replace(" %", "")}-{FmtPct(hi)}";
        if (n < Gen1Tid.SmallN) tag += $", n = {n}: rough, aim not yet centred";
        return tag;
    }
    public static (double? P, string Line) HitSummary(IReadOnlyList<Sample> samples, string anchor, string methodologyId)
    {
        var st = Gen1Tid.AnchorStatsOf(samples.Select(s => s.ImpliedMs).ToList());
        if (HasSpread(st))
        {
            var (p, centred) = Gen1Tid.HitProbabilityHeadline(st.SdMs, st.N);
            return (p, $"P(hit) with your current sd: about {FmtPct(p)} ({PRangeText(st.SdMs, st.N, centred)}; {anchor} anchor, sd {F(st.SdMs, 1)} ms = " +
                $"{F(Gen1Tid.MsToFrames(st.SdMs), 2)} frames over {st.N} attempts) -> about {FmtAttempts(p)} attempts per hit");
        }
        return (null, $"P(hit): no spread estimate yet. 2+ calibrated attempts on the {anchor} anchor under {methodologyId} give one.");
    }
    public static List<string> StatsLines(IReadOnlyList<Sample> samples, IReadOnlyList<CalSample> stored, Gen1Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        var st = Gen1Tid.AnchorStatsOf(samples.Select(s => s.ImpliedMs).ToList());
        var lines = new List<string> { $"{p.Name} / {anchor} anchor  (methodology {p.MethodologyId}, {Modes.Label(mode)} mode)" };
        if (st.N == 0)
        {
            lines.Add($"  n 0: no calibrated attempts; correction {FmtMs(p.DefaultCorrection(anchor))} (default)");
            lines.Add("  recommendation: cue an attempt and type the Trainer ID you got; 2 give a spread, 3+ a drift check.");
            return lines;
        }
        lines.Add($"  n {st.N}   mean {F(st.MeanMs, 1)} ms (the correction in force)   sd " +
            (HasSpread(st) ? $"{F(st.SdMs, 1)} ms ({F(Gen1Tid.MsToFrames(st.SdMs), 2)} frames)" : "n/a (1 sample)") +
            $"   robust sd (MAD x 1.4826) {(HasSpread(st) ? F(st.RobustSdMs, 1) + " ms" : "n/a")}   range {F(st.MinMs, 1)}..{F(st.MaxMs, 1)} ms");
        var dr = Gen1Tid.Drift(st.ValuesMs);
        if (HasSpread(st))
        {
            var (hp, centred) = Gen1Tid.HitProbabilityHeadline(st.SdMs, st.N);
            lines.Add($"  P(hit) about {FmtPct(hp)} ({PRangeText(st.SdMs, st.N, centred)}) -> about {FmtAttempts(hp)} attempts per hit   (aim centred in the frame: " +
                $"{FmtPct(Gen1Tid.HitProbability(st.SdMs))}; not centred: {FmtPct(Gen1Tid.HitProbabilityQuantised(st.SdMs))})");
        }
        string welch = dr.WelchT is null ? "" : $"; Welch t {F(dr.WelchT.Value, 2)}";
        if (dr.Flag) lines.Add($"  drift: RECALIBRATE / SETUP CHANGED ({dr.Strength}): {dr.Reason}{welch}");
        else if (dr.Strength == "weak") lines.Add($"  drift: none flagged, a shift inside the scatter ({dr.Reason})");
        else lines.Add($"  drift: none ({dr.Reason}{welch})");
        var (code, text) = Gen1Tid.Recommendation(st, dr);
        lines.Add($"  recommendation [{code}]: {text}");
        foreach (var x in stored.Where(x => InScope(x, p, mode))) lines.Add(SampleLine(x));
        return lines;
    }

    // ---- the save-corruption reset metronome (rngsolution/cli.py cmd_reset) ------------------------
    // The remembered adjustment per console follows the mode like the calibration samples: each mode has
    // its own setting key (AppMode.Scoped), every record says which mode it was made in, and a record of
    // the other mode that turns up in a store is not applied and said so.
    public static Dictionary<string, ResetAdjustRecord> ParseResetAdjust(Dictionary<string, JsonElement>? stored)
    {
        var d = new Dictionary<string, ResetAdjustRecord>();
        if (stored is null) return d;
        foreach (var (key, v) in stored)
        {
            if (v.ValueKind == JsonValueKind.Number) d[key] = new ResetAdjustRecord { Frames = v.GetDouble() };   // before modes existed: a RUN record
            else if (v.ValueKind == JsonValueKind.Object)
            {
                ResetAdjustRecord? r = null;
                try { r = JsonSerializer.Deserialize<ResetAdjustRecord>(v.GetRawText()); } catch (JsonException) { }
                if (r is not null) d[key] = r;
            }
        }
        return d;
    }
    // (the adjustment in force: 0 when none, the stored record of another mode or null)
    public static (double Frames, ResetAdjustRecord? Ignored) ResetAdjustFor(Dictionary<string, ResetAdjustRecord> adj, string platformKey, string mode)
    {
        Modes.Check(mode);
        if (!adj.TryGetValue(platformKey, out var r)) return (0, null);
        return Modes.Effective(r.Mode) == mode ? (r.Frames, null) : (0, r);
    }
    public static ResetAdjustRecord SetResetAdjust(Dictionary<string, ResetAdjustRecord> adj, string platformKey, double frames, string mode)
        => adj[platformKey] = new ResetAdjustRecord { Frames = frames, Mode = Modes.Check(mode), When = Now() };
    public static string ResetAdjustIgnoredLine(ResetAdjustRecord r, string platformKey, string mode)
        => $"NOTE: the remembered adjustment for {platformKey} ({F(r.Frames, 2, true)} frames) ignored: recorded in {Modes.Describe(r.Mode)} mode, not {Modes.Label(mode)}. " +
           "Adjustments are never mixed across modes: a practice-derived value is never in force in a run.";

    public static (ResetInterval Interval, double IntervalMs, Schedule Schedule, List<string> Lines) ResetPlan(Gen1Platform p, string preset,
        double adjustFrames, double? fadeFrames, double? intervalOverride, int pairs, double cadence)
    {
        var ri = Gen1Tid.ResetIntervalFor(p.ResetModel, preset, fadeFrames, adjustFrames);
        double interval = intervalOverride ?? ri.CentreMs;
        string first = ri.Order[0], second = ri.Order[1];
        var lines = new List<string>
        {
            $"SAVE-CORRUPTION RESET on {p.Name}, {preset} path",
            $"  Order: {first} first, then {second} {FmtMs(interval)} later.",
            $"  Safe press-to-press window (any pad phase): {F(ri.PhysLoMs, 1)} - {F(ri.PhysHiMs, 1)} ms ({F(ri.PhysLoFrames, 2)} - {F(ri.PhysHiFrames, 2)} frames);",
            $"    conservative (worst observed pad-read phase): {F(ri.ConsLoMs, 1)} - {F(ri.ConsHiMs, 1)} ms.",
            $"  Model terms (from the A frame boundary): safe {F(ri.BoundaryLoMs, 1)} - {F(ri.BoundaryHiMs, 1)} ms, centre {F(ri.BoundaryCentreMs, 1)} ms; mean timings {F(ri.MeanLoMs, 1)} - {F(ri.MeanHiMs, 1)} ms."
        };
        if (adjustFrames != 0) lines.Add($"  Adjustment applied: {F(adjustFrames, 2, true)} frames ({F(Gen1Tid.FramesToMs(adjustFrames), 1, true)} ms).");
        if (fadeFrames is not null) lines.Add($"  Modelled fade overridden: {F(fadeFrames.Value, 2)} frames.");
        if (intervalOverride is not null && !(ri.PhysLoMs <= interval && interval <= ri.PhysHiMs)) lines.Add($"  WARNING: {F(interval, 1)} ms is outside the safe press-to-press window.");
        lines.Add("");
        lines.Add($"About these numbers ({p.Name}): {p.ResetStatus}.");
        if (p.ResetKey == "gbp-fade")
        {
            lines.Add("  The save-timing side (checksum at 21.39 frames after A, party data at 25.39) is measured in the emulator.");
            lines.Add("  The Game Boy Player's RESET fade (35.16-36.16 frames) is gambatte-speedrun's community constant; on real");
            lines.Add("  hardware it is unverified, and every frame it differs moves this interval by one frame (16.7 ms).");
            lines.Add("  Calibrate from OUTCOMES, never from 'RESET -> screen black': in the model the picture is already black");
            lines.Add("  for the last 65 ms before the reset. Try adjust +1 / -1 (frames) and note which intervals give the");
            lines.Add("  255-Pokemon file on CONTINUE.");
        }
        else
        {
            lines.Add("  The save timing (checksum at 21.39 frames after A, party data at 25.39) is measured in the emulator;");
            lines.Add("  a power switch has no fade, so the cut must land inside that 67 ms. Unverified on hardware: try");
            lines.Add("  adjust +1 / -1 (frames) and note which intervals give the 255-Pokemon file.");
        }
        lines.Add("  The A press is only seen by the game at its next pad read (0.18 frames after a frame boundary), so the");
        lines.Add("  window between your two PRESSES is narrower than the model's own: the numbers above are the press-to-press");
        lines.Add("  ones. Aim for the centre; the edges are the limit, not a target.");
        lines.Add("  PRACTICE-SAVE TRAP: saving over a file with the SAME Trainer ID (e.g. from a practice save) runs 3 frames");
        lines.Add("  (50 ms) later than the real route's first save. Use the practice-save preset for that, route for real attempts.");
        lines.Add(p.ResetKey == "gbp-fade"
            ? $"  At the 'Would you like to SAVE the game?' YES/NO box: press {first} on the low beat, A on the high beat."
            : "  At the 'Would you like to SAVE the game?' YES/NO box: press A on the high beat, cut the power on the low beat.");
        var sched = Gen1Tid.ResetSchedule(interval, ri.Order, pairs, cadence, 1.0);
        lines.Add("");
        lines.Add($"Metronome: {pairs} pairs, one every {F(cadence, 1)} s, first {first} beat 1.0 s after the anchor.");
        return (ri, interval, sched, lines);
    }

    // ---- verify (moderators; human-measured input) ---------------------------------------------------
    public static (bool Consistent, List<string> Lines) VerifyLines(Gen1Platform p, int tid, double menuToPressS, bool fromVisible, int tolerance, double? lagOverride)
    {
        double lag = lagOverride ?? p.Timing.VisibleLagFrames;
        var rPress = Gen1Tid.Verify(p.Table, tid, menuToPressS, tolerance, 0.0, p.TargetSets);
        var rVis = Gen1Tid.Verify(p.Table, tid, menuToPressS, tolerance, lag, p.TargetSets);
        var r = fromVisible ? rVis : rPress;
        var other = fromVisible ? rPress : rVis;
        var fn = FootnotesFor(p);
        var lines = new List<string> { $"{Gen1Tid.FormatTid(tid)} on {p.Name} ({p.GameName}): {Gen1Tid.VerdictTextFor(tid, p.TargetSets)}" };
        lines.AddRange(MethodologyLines(p, true));
        if (fromVisible)
        {
            lines.Add($"  measured menu -> first VISIBLE effect of the A press: {F(menuToPressS, 3)} s; minus the {p.FamilyKey.ToUpperInvariant()} press-to-visible lag");
            lines.Add($"  of {F(lag, 2)} frames ({(p.Timing.VisibleLagNote != "" ? p.Timing.VisibleLagNote : "no lag known for this console")}) = offset {F(r.PredictedOffset, 1)}" + fn.Mark("table"));
        }
        else lines.Add($"  measured menu -> A press: {F(menuToPressS, 3)} s = offset {F(r.PredictedOffset, 1)} ({F(menuToPressS, 3)} s x {F(Gen1Tid.Fps, 4)} fps - {Gen1Tid.MenuToTableFrames})" + fn.Mark("table"));
        if (!r.InTable)
        {
            lines.Add("  this Trainer ID is produced by NO press time on this console: INCONSISTENT with the table" + fn.Mark("table", "tidRoll"));
            lines.Add("");
            lines.AddRange(fn.Lines());
            return (false, lines);
        }
        lines.Add($"  the table produces it at offset{(r.Offsets.Length > 1 ? "s " : " ")}{string.Join(", ", r.Offsets)}" + fn.Mark("table", "tidRoll"));
        lines.Add($"  nearest offset {r.Nearest} is {F(r.DifferenceFrames ?? 0, 1)} frames from the measurement (tolerance +-{tolerance} frames): {(r.Consistent ? "CONSISTENT" : "INCONSISTENT")}");
        if (lag != 0 && other.Consistent != r.Consistent)
        {
            lines.Add($"  NOTE: read the other way (measured from {(fromVisible ? "the press" : "the visible effect")}) it is {F(other.DifferenceFrames ?? 0, 1)} frames off: {(other.Consistent ? "CONSISTENT" : "INCONSISTENT")}.");
            lines.Add($"  On a Game Boy Player or DMG capture the press itself is invisible: the screen reacts {F(lag, 2)} frames later");
            lines.Add($"  ({(p.FamilyKey == "gba" ? "provisional" : "fitted on two runs")}). Say which you measured.");
        }
        lines.Add("  (this checks timing against the table only, and only under the methodology above; it says nothing else about the run)");
        lines.Add("");
        lines.AddRange(fn.Lines());
        return (r.Consistent, lines);
    }

    // ---- Gen 3: the Secret ID from a typed Trainer ID (rngsolution/sidcli.py) ------------------------
    public static JsonElement SidMethodologyFor(Gen3SidData sid, string gameKey)
    {
        var g = sid.Root.GetProperty("games").GetProperty(gameKey);
        return sid.Root.GetProperty("methodologies").GetProperty(J.S(g, "methodology"));
    }
    public static List<string> SidMethodologyLines(JsonElement m, bool conditions)
    {
        var lines = new List<string>
        {
            $"Methodology: {J.S(m, "id")}   ({J.S(m, "name")}; v{J.Int(m, "version", 0)}, {J.S(m, "date")})", MethodologySentence, "  status: " + J.S(m, "status")
        };
        if (conditions)
        {
            lines.Add("Valid only if:");
            foreach (var c in J.SA(m, "validity")) lines.Add("  - " + c);
        }
        return lines;
    }
    public static SidModel SidModelFor(Gen3SidData sid, string methodologyId, string speed, string? path)
    {
        var model = sid.Variant(methodologyId, path);
        if (!model.TextSpeed.ContainsKey(speed))
            throw new ArgumentException($"text speed {speed} is not measured for {methodologyId} on the {(model.Variant != "" ? model.Variant : "only")} path (measured: {string.Join(", ", model.TextSpeed.Keys.OrderBy(k => k, StringComparer.Ordinal))})");
        return model;
    }
    public static (int KExpected, int KMin, int KMax, List<(string Stage, int Frames)> Beeps, Schedule Schedule) SidCue(SidModel model, int nameLength, string speed, int margin, int early, int late)
    {
        var (kExp, kMin, kMax, beeps) = Gen1Tid.KWindowForCue(model, nameLength, speed, margin, early, late);
        var cues = new List<Cue>();
        for (int i = 0; i < beeps.Count; i++)
        {
            bool last = i == beeps.Count - 1;
            var tone = last ? Gen1Tid.ACueTone : Gen1Tid.CountInTone;
            cues.Add(new Cue(Gen1Tid.GbaFramesToSeconds(beeps[i].Frames), tone.Hz, tone.Ms, beeps[i].Stage, last ? "A" : "count"));
        }
        var sched = new Schedule { Anchor = "naming-ok", Cues = cues, TA = cues[^1].T };
        return (kExp, kMin, kMax, beeps, sched);
    }
    public static List<string> SidCueProtocolLines(JsonElement m, string gameName, int nameLength, string speed, int margin, SidModel model,
        List<(string Stage, int Frames)> beeps, int kExp, int kMin, int kMax)
    {
        var lines = new List<string>
        {
            $"CUE PROTOCOL ({gameName}, {nameLength}-letter name, {speed} text speed{(model.Variant != "" ? ", " + model.Name : "")})",
            "  Methodology: " + J.S(m, "id"), "  " + MethodologySentence,
            "  The Trainer ID cannot be chosen (a sub-frame Timer1 count); this cue pins k, the VBlank count from",
            "  the naming-screen exit to the Secret ID roll, by making every press after naming land at a known time.",
            $" 1. Play to the player naming screen and enter your name normally ({nameLength} letters; set the length above if not).",
            " 2. Click ANCHOR (or press Space) at the SAME instant you press A on OK. That is the anchor. Touch nothing else.",
            " 3. Beeps follow, one per press: tap A ON each beep, once. Never press while the text is still printing:",
            "    that press is swallowed AND arms the hold-to-speed-up (text.c:944-952), after which a held A changes",
            "    the counts; a plain held A on a waiting box is harmless (measured). Never press B: on the name box",
            "    B answers NO and re-rolls the Trainer ID.",
            $"    Each beep comes {margin} frames ({F(Gen1Tid.GbaFramesToSeconds(margin), 2)} s) after its box is first ready, so a press a little late is fine;",
            "    a press BEFORE the box is ready is swallowed and the attempt is void.",
            $"    Only the LAST press (the long high beep) sets k: k = fixed + {beeps.Count} x {margin} + your lateness on that press."
        };
        foreach (var (stage, frames) in beeps)
            lines.Add($"      {F(Gen1Tid.GbaFramesToSeconds(frames), 3)} s  {stage}  {(model.StageText.TryGetValue(stage, out var t) ? t : stage)}");
        lines.Add(" 4. Afterwards read the Trainer ID off the Trainer Card and type it below: the Secret ID candidates for");
        lines.Add($"    k in {kMin}-{kMax} (expected {kExp}) are listed. Pin one later with a PID you can see is shiny or not.");
        lines.Add($"  Constants: OK->seed {model.OkToSeed} frames, per-stage ready times and last press->roll {model.TextSpeed[speed].LastPressToSid} frames, {(model.Status != "" ? model.Status : "EMPIRICAL (libmgba)")}.");
        return lines;
    }
    // Pins follow the mode like the calibration samples: each mode has its own setting key (AppMode.Scoped),
    // every pin says which mode it was made in, and a pin of the other mode that turns up in a store never
    // filters the listing and is said so.
    public static string PinKey(string methodologyId, int tid) => methodologyId + "/" + tid;
    public static List<PinRecord> AllPins(Dictionary<string, List<PinRecord>> pins, string methodologyId, int tid)
        => pins.TryGetValue(PinKey(methodologyId, tid), out var l) ? l.ToList() : new();
    // the pins made in this mode (the ones the listing uses)
    public static List<PinRecord> PinsFor(Dictionary<string, List<PinRecord>> pins, string methodologyId, int tid, string mode)
        => Modes.SplitByMode(AllPins(pins, methodologyId, tid), p => p.Mode, mode).Kept;
    // the pins of another mode in the same store: never used, named in the listing
    public static List<PinRecord> IgnoredPins(Dictionary<string, List<PinRecord>> pins, string methodologyId, int tid, string mode)
        => Modes.SplitByMode(AllPins(pins, methodologyId, tid), p => p.Mode, mode).Others;
    public static void AddPin(Dictionary<string, List<PinRecord>> pins, string methodologyId, int tid, uint pid, bool shiny, string note, string mode)
    {
        Modes.Check(mode);                                  // the pin must say which mode it was made in
        var all = AllPins(pins, methodologyId, tid);
        foreach (var p in PinsFor(pins, methodologyId, tid, mode))
        {
            if (p.Pid == pid && p.Shiny != shiny) throw new ArgumentException($"PID {pid:X8} is already pinned as {(p.Shiny ? "shiny" : "not shiny")}");
            if (p.Pid == pid) return;
        }
        all.Add(new PinRecord { Pid = pid, Shiny = shiny, Note = note, When = Now(), Mode = mode });
        pins[PinKey(methodologyId, tid)] = all;
    }
    // removes this mode's pins for the ID; pins of the other mode in the store stay where they are
    public static (int Removed, int Kept) ClearPins(Dictionary<string, List<PinRecord>> pins, string methodologyId, int tid, string mode)
    {
        var (mine, others) = Modes.SplitByMode(AllPins(pins, methodologyId, tid), p => p.Mode, mode);
        if (others.Count > 0) pins[PinKey(methodologyId, tid)] = others; else pins.Remove(PinKey(methodologyId, tid));
        return (mine.Count, others.Count);
    }
    public static List<string> PinLines(IReadOnlyList<PinRecord> list, string methodologyId, int tid, string mode, IReadOnlyList<PinRecord>? ignored = null)
    {
        var lines = list.Count == 0
            ? new List<string> { $"Pins: none stored for {methodologyId} / Trainer ID {tid} in {Modes.Label(mode)} mode (add one with a PID you can see is shiny or not)" }
            : new List<string> { $"Pins stored for {methodologyId} / Trainer ID {tid} ({Modes.Label(mode)} mode's store):" };
        foreach (var p in list) lines.Add($"  PID {p.Pid:X8}  {(p.Shiny ? "SHINY" : "not shiny")}{(p.Note != "" ? "  " + p.Note : "")}{(p.When != "" ? "  [" + p.When + "]" : "")}");
        if (ignored is { Count: > 0 })
        {
            var modes = ignored.Select(p => Modes.Describe(p.Mode)).Distinct().OrderBy(x => x, StringComparer.Ordinal);
            lines.Add($"  NOTE: {Plural(ignored.Count, "stored pin")} for {methodologyId} / Trainer ID {tid} ignored: recorded in {string.Join(", ", modes)} mode, not {Modes.Label(mode)}. Pins are never mixed across modes.");
        }
        return lines;
    }
    public static (List<SidCandidate> Candidates, List<SidCandidate> Kept, List<string> Lines, SidCandidate? Single) SidListing(SidModel model, int tid, int nameLength, string speed,
        int? kMin, int? kMax, IReadOnlyList<PinRecord> pinList, IReadOnlyList<uint> extraShiny, IReadOnlyList<uint> extraNon, int? tsv, (int KExpected, int KMin, int KMax)? cued)
    {
        int fixedK = Gen1Tid.KFixed(model, nameLength, speed);
        int defLo = fixedK, defHi = fixedK + (model.KDefaultSpan > 0 ? model.KDefaultSpan : 1200);
        int lo = kMin ?? defLo, hi = kMax ?? defHi;
        if (lo < 0 || hi < lo) throw new ArgumentException($"need 0 <= k-min <= k-max (got {lo}, {hi})");
        var cands = Gen1Tid.SidCandidates(tid, lo, hi);
        var shiny = pinList.Where(p => p.Shiny).Select(p => p.Pid).Concat(extraShiny).ToList();
        var non = pinList.Where(p => !p.Shiny).Select(p => p.Pid).Concat(extraNon).ToList();
        var (kept, _) = Gen1Tid.FilterCandidates(cands, tid, shiny, non, tsv);
        var lines = new List<string>
        {
            $"Trainer ID {Gen1Tid.FormatTid(tid)}: Secret ID = high 16 bits of the LCRNG after k+1 advances from seed = Trainer ID,",
            "  k = VBlank advances from the naming-screen exit to the roll (one Random() per VBlank; nothing else on the path).",
            $"  k range {lo}-{hi}: fixed part {fixedK} for a {nameLength}-letter name at {speed} text speed{(model.Variant != "" ? " on the " + model.Variant + " path" : "")} (every press on the first frame it is accepted)" +
                (kMin is null && kMax is null && cued is null ? $", plus up to {defHi - defLo} frames ({F(Gen1Tid.GbaFramesToSeconds(defHi - defLo), 0)} s) of waiting on the {model.Stages.Length} presses" : "")
        };
        if (cued is not null) lines.Add($"  cued attempt: expected k {cued.Value.KExpected} (window {lo}-{hi})");
        var filt = new List<string>();
        if (shiny.Count > 0) filt.Add(Plural(shiny.Count, "known shiny PID"));
        if (non.Count > 0) filt.Add(Plural(non.Count, "known non-shiny PID"));
        if (tsv is not null) filt.Add($"TSV {tsv}");
        lines.Add($"  {Plural(cands.Count, "candidate")}{(filt.Count > 0 ? $", {kept.Count} after the filters ({string.Join(", ", filt)})" : "")}");
        SidCandidate? single = null;
        if (kept.Count == 0)
        {
            lines.Add("  NO candidate survives: the pins contradict this k range (widen k-min/k-max), a pin is wrong,");
            lines.Add("  or the attempt broke the protocol (a swallowed press, NO on the name box, another text speed).");
        }
        else if (kept.Count == 1)
        {
            single = kept[0];
            lines.Add($"  Secret ID {single.Sid} (${single.Sid:X4}), TSV {single.Tsv}, k = {single.K}: the only candidate under the pins.");
        }
        else if (shiny.Count > 0)
        {
            var sids = kept.Select(c => c.Sid).Distinct().OrderBy(s => s).ToList();
            lines.Add($"  A known shiny PID allows only 8 Secret IDs ({sids.Count} of them in range: {string.Join(", ", sids.Take(8).Select(s => $"${s:X4}"))}); a second shiny, or the exact k, settles it.");
        }
        else lines.Add("  Narrow it: catch anything, look at it, and pin its PID as shiny (it IS shiny) or not shiny.");
        return (cands, kept, lines, single);
    }
}
