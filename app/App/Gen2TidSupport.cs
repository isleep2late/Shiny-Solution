using System.Text.Json;
using System.Text.Json.Serialization;
using ShinySolution.Core;

namespace ShinySolution.App;

// The Gen 2 Trainer ID / Lucky ID panel's data resolution, text and calibration records: a port of the
// webapp tab (webapp/gen2tid-ui.js) over app/Core/Gen2Tid.cs and the embedded core/data/gen2-tid.json,
// modelled on Gen1TidSupport.cs and sharing its code where the tab shares the Gen 1 tab's: the number
// formats, the count-in and the tones (through Gen2Tid.Schedule), the runner's timing text
// (Gen1TidText.HitSummary), the mode split (Modes). The Gen 2 model differs where the engine does: the
// target is a 4-frame poll bin (0-598) relative to the VISIBLE menu box, three IDs per bin (TID, Lucky
// ID and Crystal's Secret ID), a Gold/Silver RTC state that selects the table, and calibration whose hit
// and aim are bin centres (the outlier guard is the engine's IsOutlierBins, the duplicate guard is
// Gen1Tid.IsDuplicate over the Gen 2 store; Gen1Tid.AddSample is not used: its outlier guard checks
// whole-frame offsets and would refuse bin-centre samples). Every output names the methodology id and its
// validity conditions, and the panel says plainly that no hardware sample exists for any Gen 2
// configuration. Run mode is human input only: the anchor is your click, the outcome is the Trainer ID
// (and Lucky ID) you type; nothing reads the game. tests/gen2tid-panel-vectors.json, emitted from the
// web tab by tools/gen-gen2-panel-vectors.cjs, pins this file to the tab number for number and line for
// line (app/Tests/Gen2TidPanelChecks.cs).

// One console / emulator choice for one game under one methodology in one RTC state.
public sealed class Gen2Platform
{
    public const string DefaultGame = "gold";
    public const string DefaultPlatform = "gse";

    public Gen2TidData Data { get; init; } = null!;
    public string Key { get; init; } = "";
    public string Name { get; init; } = "";
    public JsonElement Spec { get; init; }
    public string GameKey { get; init; } = "";
    public string GameName { get; init; } = "";
    public JsonElement Game { get; init; }
    public string FamilyKey { get; init; } = "";
    public JsonElement Methodology { get; init; }
    public Gen2Methodology Meth { get; init; } = new();
    public string MethodologyId { get; init; } = "";
    public string[] MethodologyIds { get; init; } = Array.Empty<string>();
    public string PlatformKey { get; init; } = "";
    public Gen2Timing Timing { get; init; } = new();
    public Gen2BinRule Rule { get; init; } = new();
    public string State { get; init; } = "";
    public string[] States { get; init; } = Array.Empty<string>();
    public bool RtcDependent { get; init; }
    public bool Reachable { get; init; }
    public Gen2TableRef Table { get; init; } = new();
    public string[] Anchors { get; init; } = Array.Empty<string>();
    public Dictionary<string, string> AnchorNames { get; init; } = new();
    public string Status { get; init; } = "";
    public string Validation { get; init; } = "";
    public string ResetKey { get; init; } = "";
    public string ResetNote { get; init; } = "";
    public ResetModel? ResetModel { get; init; }
    public JsonElement Defaults { get; init; }
    public List<Gen2TargetSet> TargetSets { get; init; } = new();
    public bool HasLid { get; init; }
    public bool HasSid { get; init; }
    public double VisibleMenuS { get; init; }

    public double DefaultCorrection(string anchor)
        => Defaults.TryGetProperty("correction_ms", out var c) ? J.Dbl(c, anchor, 100.0) : 100.0;
    public int CountInBeeps => J.Int(Defaults, "count_in_beeps", 4);
    public double CountInSpacing => J.Dbl(Defaults, "count_in_spacing_s", 1.0);
    public string[] TargetSetKeys => TargetSets.Select(s => s.Key).ToArray();
    public string[] OtherTargetSetKeys => J.SA(Game, "target_sets").Where(k => !TargetSetKeys.Contains(k)).ToArray();
    public string AnchorName(string a) => AnchorNames.TryGetValue(a, out var n) ? n : a;

    public static string[] SupportedGames(Gen2TidData data)
        => data.Root.GetProperty("games").EnumerateObject().Where(g => J.S(g.Value, "status") == "supported").Select(g => g.Name).ToArray();

    // The methodologies a console offers under one game: the game's methodologies whose console family is the
    // console's; the default is the one on the console's own platform key (a DMG offers hold-start and late-start).
    public static (string? Default, List<string> Ids) PlatformMethodologies(Gen2TidData data, string platformKey, string gameKey)
    {
        if (!data.Root.GetProperty("platforms").TryGetProperty(platformKey, out var spec)) throw new ArgumentException("unknown platform " + platformKey);
        var meths = data.Root.GetProperty("methodologies");
        var ids = J.SA(data.Game(gameKey), "methodologies").Where(m => meths.TryGetProperty(m, out var me) && J.S(me, "console_id") == J.S(spec, "family")).ToList();
        string? def = ids.FirstOrDefault(m => J.S(meths.GetProperty(m), "platform_key") == J.S(spec, "platform_key"));
        return (def ?? (ids.Count > 0 ? ids[0] : null), ids);
    }

    public static List<(string Key, string Name, string Default)> PlatformsFor(Gen2TidData data, string gameKey)
    {
        var out_ = new List<(string, string, string)>();
        foreach (var p in data.Root.GetProperty("platforms").EnumerateObject())
        {
            var (def, _) = PlatformMethodologies(data, p.Name, gameKey);
            if (def is null) continue;
            out_.Add((p.Name, $"{J.S(p.Value, "name")}   [{J.S(p.Value, "status")}]", def));
        }
        return out_;
    }

    // The RTC states a game's tables come in: Gold / Silver the ten running and ten halted states, Crystal one.
    public static List<(string Value, string Text, bool Reachable, string Family)> StateOptions(Gen2TidData data, string gameKey)
    {
        if (!data.RtcDependent(gameKey)) return new() { ("days0", "days0: any clock (Crystal is immune to the RTC: one table)", true, "running") };
        return data.StateIds(gameKey).Select(st =>
        {
            var info = data.StateInfo(st);
            bool reach = info.GetProperty("reachable_after_first_boot").GetBoolean();
            return (st, st + ": " + J.S(info, "label") + (reach ? "" : "   [first boot only]"), reach, J.S(info, "family"));
        }).ToList();
    }
    public static string StateLabel(Gen2TidData data, string gameKey, string state)
    {
        if (!data.RtcDependent(gameKey)) return "days0 (any clock: Crystal is immune to the RTC)";
        var info = data.StateInfo(state);
        return state + " (" + J.S(info, "label") + (info.GetProperty("reachable_after_first_boot").GetBoolean() ? "; recurs boot after boot" : "; first boot only") + ")";
    }
    // The reachability rule, from the data: bracket and halted-clock states are first-boot only, after the first boot
    // only days0 and days512 remain; Crystal has one table.
    public static List<string> ReachabilityLines(Gen2TidData data, string gameKey)
    {
        var g = data.Game(gameKey);
        var rtc = data.Root.GetProperty("rtc");
        if (!data.RtcDependent(gameKey))
            return new() { "RTC state: " + J.S(g, "name") + " is immune to the cartridge clock (" + J.S(rtc, "crystal").Split(';')[0] + "): one table per methodology, shown as state days0." };
        var running = rtc.GetProperty("families").GetProperty("running");
        var halted = rtc.GetProperty("families").GetProperty("halted");
        var prior = J.SA(running, "two_state_prior");
        var states = rtc.GetProperty("states");
        var lines = new List<string>
        {
            "RTC state (" + J.S(g, "name") + "): the MBC3 clock's day counter and halt bit select the table. Only " + string.Join(" and ", prior) + " recur boot after boot: after the first boot no other state remains.",
            "  A 140-511-day bracket (" + string.Join(", ", J.SA(running, "states").Where(s => !prior.Contains(s))) + ") lasts ONE boot: " + J.S(states.GetProperty("days200"), "why") + ".",
            "  A halted clock (" + string.Join(", ", J.SA(halted, "states")) + ") is a cartridge whose clock was halted and has not been booted since: " + J.S(states.GetProperty("halt-days0"), "why").Split(", so")[0] + ".",
            "  So a prediction in a bracket or halted state is first-boot only, and a typed outcome from a later boot is inverted under the two-state prior (" + string.Join(", ", prior) + ").",
            "  " + J.S(rtc, "on_cart"),
            "  Dead battery: " + J.S(rtc, "dead_battery")
        };
        return lines;
    }
    // The published route IDs of a game: community-script target sets, not produced by the single-tap methodologies in days0.
    public static string ScriptsLine(Gen2TidData data, string gameKey)
    {
        var g = data.Game(gameKey);
        var all = data.Root.GetProperty("target_sets");
        var scripted = new List<string>();
        foreach (var k in J.SA(g, "target_sets"))
            if (all.TryGetProperty(k, out var s) && J.S(s, "protocol") == "community-script") scripted.Add(new Gen2TargetSet(k, s).Describe());
        if (scripted.Count == 0) return "No published route ID is defined for " + J.S(g, "name") + ".";
        return "The published route IDs for " + J.S(g, "name") + " (" + string.Join("; ", scripted) + ") are NOT produced by this single-tap methodology in RTC state days0: they need their community multi-step scripts (target sets of protocol community-script), which are not tabulated here. " +
            "Where a single tap gives one of them in some other RTC state, the row below says so and names the state, which is first-boot only.";
    }

    public static Gen2Platform Resolve(Gen2TidData data, Gen1TidData? data1, string gameKey, string platformKey, string? methodologyId, string? state, IReadOnlyList<string>? targetSetKeys)
    {
        if (!data.Root.GetProperty("platforms").TryGetProperty(platformKey, out var spec)) throw new ArgumentException("unknown platform " + platformKey);
        var g = data.Game(gameKey);
        if (J.S(g, "status") != "supported") throw new ArgumentException("no runnable methodology for " + gameKey);
        var (def, ids) = PlatformMethodologies(data, platformKey, gameKey);
        string mid = string.IsNullOrEmpty(methodologyId) ? def ?? "" : methodologyId;
        if (mid == "") throw new ArgumentException($"no methodology is available on {platformKey} for {gameKey}");
        if (!ids.Contains(mid)) throw new ArgumentException($"methodology {mid} is not available on {platformKey} for {gameKey}");
        var m = data.Methodology(mid);
        var states = data.StateIds(gameKey);
        string st = string.IsNullOrEmpty(state) ? J.S(data.Root.GetProperty("defaults"), "state", "days0") : state;
        if (!states.Contains(st))
        {
            if (data.RtcDependent(gameKey)) throw new ArgumentException($"no RTC state {st} for {gameKey}");
            st = "days0";
        }
        var table = data.TableFor(gameKey, m.PlatformKey, st);
        var specAnchors = J.SA(spec, "anchors");
        if (specAnchors.Length == 0) specAnchors = new[] { Gen2Tid.AnchorMenu };
        var anchors = specAnchors.Where(a => m.Anchors.Contains(a)).ToArray();
        if (anchors.Length == 0) anchors = new[] { Gen2Tid.AnchorMenu };
        string resetKey = J.S(spec, "reset");
        ResetModel? resetModel = null;
        if (resetKey != "" && data1 is not null && data1.Root.TryGetProperty("reset_models", out var rm) && rm.TryGetProperty(resetKey, out _))
            resetModel = data1.ResetModel(resetKey);
        var ids_ = J.SA(g, "ids");
        return new Gen2Platform
        {
            Data = data, Key = platformKey, Name = J.S(spec, "name"), Spec = spec, GameKey = gameKey, GameName = J.S(g, "name", gameKey), Game = g,
            FamilyKey = J.S(spec, "family"), Methodology = m.Raw, Meth = m, MethodologyId = mid, MethodologyIds = ids.ToArray(),
            PlatformKey = m.PlatformKey, Timing = m.Timing, Rule = table.Rule, State = st, States = states, RtcDependent = data.RtcDependent(gameKey),
            Reachable = data.Reachable(gameKey, st), Table = table, Anchors = anchors,
            AnchorNames = data.Root.TryGetProperty("anchor_names", out var an) ? an.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.GetString() ?? "") : new(),
            Status = J.S(spec, "status"), Validation = J.S(spec, "validation"), ResetKey = resetKey, ResetNote = J.S(spec, "reset_note"), ResetModel = resetModel,
            Defaults = data.Root.GetProperty("defaults"), TargetSets = data.TargetSetsFor(gameKey, targetSetKeys is { Count: > 0 } ? targetSetKeys : null),
            HasLid = ids_.Contains("lid"), HasSid = ids_.Contains("sid"), VisibleMenuS = m.Timing.VisibleMenuFrame / Gen2Tid.Fps
        };
    }

    // The scope a typed outcome is inverted in: the chosen state when it is a first-boot-only one, else the two-state
    // prior (the engine's default), and Crystal's one table.
    public string? OutcomeState()
    {
        if (!RtcDependent) return null;
        return Gen2Tid.TwoStatePrior.Contains(State) ? null : State;
    }
    public string OutcomeScopeText()
    {
        var s = OutcomeState();
        if (!RtcDependent) return "the one Crystal table";
        return s is null ? "the two-state prior (" + string.Join(", ", Gen2Tid.TwoStatePrior) + ")" : "RTC state " + s + " (first boot only)";
    }
    // verify scopes to the chosen first-boot-only state, else (the engine's rule) to every RTC state of the platform
    public string VerifyScopeText()
    {
        var s = OutcomeState();
        if (!RtcDependent) return "the one Crystal table";
        return s is null ? "every RTC state of platform " + PlatformKey : "RTC state " + s + " (first boot only)";
    }
}

// One stored Gen 2 calibration sample: the engine's Gen2Sample record (bin centres as offsets) plus 'when' and 'mode'
// (the RUN / PRACTICE-HUNT mode it was made in; absent on records from before modes existed, read as RUN).
public sealed class Gen2CalSample
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
    [JsonPropertyName("methodology")] public string? Methodology { get; set; }
    [JsonPropertyName("attempt")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Attempt { get; set; }
    [JsonPropertyName("note")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; set; }
    [JsonPropertyName("player")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Player { get; set; }
    [JsonPropertyName("when")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? When { get; set; }
    [JsonPropertyName("mode")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Mode { get; set; }

    // The Gen 1 record the shared helpers read: the mean (implied_ms) and the duplicate guard (tid, aim, attempt,
    // methodology; the aim as the bin, a one-to-one stand-in for the bin-centre offset the tab compares).
    public Sample ToGen1Sample() => new()
    {
        Tid = Tid, Aimed = AimedBin, Hit = HitBin, CorrectionUsedMs = CorrectionUsedMs, ImpliedMs = ImpliedMs,
        Attempt = Attempt, Note = Note ?? "", Player = Player, Methodology = Methodology
    };

    public static Gen2CalSample From(Gen2Sample s, string? when, string mode) => new()
    {
        Tid = s.Tid, Lid = s.Lid, AimedBin = s.AimedBin, HitBin = s.HitBin, Aimed = s.Aimed, Hit = s.Hit, CorrectionUsedMs = s.CorrectionUsedMs, ImpliedMs = s.ImpliedMs,
        State = s.State, Methodology = s.Methodology, Attempt = s.Attempt, Note = s.Note, Player = s.Player, When = when, Mode = Modes.Check(mode)
    };
}

public sealed class Gen2CalEntry
{
    [JsonPropertyName("samples")] public List<Gen2CalSample> Samples { get; set; } = new();
}

public sealed class Gen2OutcomeReport
{
    public int Tid;
    public int? Lid;
    public int AimedBin;
    public List<Gen2Candidate> Candidates = new();
    public List<Gen2Candidate> Elsewhere = new();
    public int? HitBin;
    public double? Implied;
    public bool Added;
    public string? Refused;
    public double? NewCorrection;
    public List<string> Lines = new();
}

public static class Gen2TidText
{
    public const string MethodologySentence = Gen1TidText.MethodologySentence;
    public const string RulesLine = "Run mode uses only your own input: you click the anchor button and type the Trainer ID (and the Lucky ID) you saw. Nothing reads the screen, the emulator or the console.";
    public const string NoHardwareLine = "No hardware sample exists for any Gen 2 configuration: every table is emulator-derived (pokemon-speedrunning/gambatte-core with the real boot ROMs, community-script cross-validated on GBP). On a console the first attempts are a transfer test; on GSE / gambatte-speedrun in GBP mode the numbers are exact.";
    public const string Player = "winforms";
    // the panel's setting (SettingsStore) for the calibration store; AppMode.Scoped gives each mode its own (".practice")
    public const string CalKeySetting = "gen2tid.calibration";

    static string F(double x, int d, bool plus = false) => Gen1Tid.PyFixed(x, d, plus);
    static string FmtSf(double s) => Gen1TidText.FmtSf(s);
    static string FmtMs(double ms) => Gen1TidText.FmtMs(ms);
    static string Plural(int n, string word) => Gen1TidText.Plural(n, word);
    public static string Hex4(int n) => n.ToString("X4");
    public static string FmtId(int v) => $"{v} (${Hex4(v)})";
    public static string FmtLid(int v) => $"{v:D5} (${Hex4(v)})";
    static double FramesToS(double frames) => frames / Gen2Tid.Fps;
    public static string Now() => Gen1TidText.Now();

    // ---- the sources the protocol, the target line, the schedule, invert and verify rest on: footnotes [^n] over the
    // citation registry (Citations.cs), numbered in this fixed order (the keys a game lacks are left out) so every line
    // of the panel carries the Sources block's numbers; the web tab's sources (webapp/gen2tid-ui.js sourcesFor) word for
    // word. The decomp lines are pokegold's or pokecrystal's; the tables' roll and the held-input rule are measured
    // sources under the console's status word from gen2-tid.json (EMULATOR-EXACT on GSE, EMPIRICAL on every console:
    // no hardware sample exists) ----
    public static readonly string[] SourceOrder = { "holdStart", "poll", "roll", "tidRoll", "stir", "heldInput", "startClock", "fixDays", "haltClear", "crystalImmune", "lid", "crystalSid" };
    public static string StatusWord(Gen2Platform p) => p.Status == "emulator-exact" ? "EMULATOR-EXACT" : "EMPIRICAL";
    public static Dictionary<string, Citations.CiteSource> SourcesFor(Gen2Platform p)
    {
        bool c = p.GameKey == "crystal";
        string repo = c ? "pokecrystal" : "pokegold";
        var t = p.Timing;
        var s = new Dictionary<string, Citations.CiteSource>
        {
            ["holdStart"] = new(c ? "pokecrystal/engine/menus/intro_menu.asm:1138-1200" : "pokegold/engine/menus/intro_menu.asm:968-1000", null, "TitleScreenMain accepts START or A by level on its first frame" + (c ? " (Crystal after a 28-frame scroll-in)" : "") + ", and the splash and the intro skip on any button from their first frame, so START held from inside the window opens the NEW GAME menu on one fixed frame"),
            ["poll"] = new(c ? "pokecrystal/engine/menus/main_menu.asm:240-252" : "pokegold/engine/menus/main_menu.asm:142-152", null, "MainMenuJoypadLoop goes through SetUpMenu, which disables the joypad filter, so _ScrollingMenuJoypad returns after one poll and the loop comes back through WaitBGMap: the menu reads the pad once every 4 frames, and the target is the 4-frame bin the A tap lands in, not a frame"),
            ["roll"] = new(null, null,
                "hold START on any frame " + t.HoldLoFrame + "-" + t.HoldHiFrame + " and the menu box is visible on frame " + t.VisibleMenuFrame + "; the roll is " + (c ? "14" : "13") + " frames after the accepting poll (Crystal 14, Gold and Silver 13) and constant inside a bin, 599 bins of 4 frames per table under " + p.MethodologyId + "; " + p.Name + ": " + p.Status,
                "the tables' derivation on pokemon-speedrunning/gambatte-core, docs/FACTS.md Gen 2 Trainer ID / Lucky ID (hold-START single-tap methodologies)", StatusWord(p)),
            ["tidRoll"] = new(c ? "pokecrystal/engine/menus/intro_menu.asm:61-68,102-128" : "pokegold/engine/menus/intro_menu.asm:1-7,28-49", null, "NewGame -> _ResetWRAM writes wPlayerID right after the WRAM clear: hRandomSub on one frame is the high byte, hRandomAdd one DelayFrame later the low byte"),
            ["stir"] = new(repo + "/home/vblank.asm:68-79", null, "the only RNG is the VBlank stir, hRandomAdd += DIV and hRandomSub -= DIV over HRAM cleared at Init, so the IDs are a function of the frame of the accepting poll and of the DIV phase the boot fixes"),
            ["heldInput"] = new(null, null,
                c ? "Crystal's IDs do not change with the tap length or with START still down at the roll; the 4-8-frame tap is what selects one bin" : "a 4-8-frame tap reproduces every table; a longer tap or START still down at the roll changes the Trainer ID on hundreds of offsets, so nothing may be down from 7 frames after the accepting poll until the roll",
                "the held-input sweeps of every table, docs/FACTS.md Held input changes Gold/Silver IDs", StatusWord(p)),
        };
        if (c)
        {
            s["crystalImmune"] = new("pokecrystal/home/init.asm:131,143,155-159", null, "Crystal switches the LCD on before StartClock and clears rIF before ei, so the day count never moves its table: one RTC state");
            s["crystalSid"] = new("pokecrystal/engine/menus/intro_menu.asm:130-134", null, "Crystal then rolls wSecretID with two Random calls a frame apart; it is not shown in the game and has no shiny role in Gen 2");
        }
        else
        {
            s["startClock"] = new("pokegold/engine/rtc/rtc.asm:91-101,103-115", null, "StartClock runs before the LCD is switched on, so the cycles FixDays spends on the day count move the LCD's phase against DIV: one table per bracket (0-139, 140-255, 256-279, 280-419, 420-511 days, and the same five with the carry bit)");
            s["fixDays"] = new("pokegold/home/time.asm:61-120,205-250", null, "FixDays loops once per 140 days and SetClock writes the count back, so a 140-511-day bracket lasts one boot; the carry bit is written back unchanged");
            s["haltClear"] = new("pokegold/engine/rtc/rtc.asm:13-22", null, "StartRTC, run at the end of StartClock on every boot, clears the RTC halt bit unconditionally, so a halted cartridge is halted for its FIRST boot only: the next boot is days0 or days512");
        }
        if (p.HasLid) s["lid"] = new(c ? "pokecrystal/engine/menus/intro_menu.asm:312-336" : "pokegold/engine/menus/intro_menu.asm:225-248", null, "LoadOrRegenerateLuckyIDNumber rolls the Lucky ID with two Random calls only when SRAM's sLuckyNumberDay is not wCurDay + 1, which after a clear it never is: the FIRST New Game after the clear; a later New Game returns the earlier Lucky ID");
        return s;
    }
    public static Citations.Footnotes FootnotesFor(Gen2Platform p)
    {
        var s = SourcesFor(p);
        return new Citations.Footnotes(s, SourceOrder.Where(s.ContainsKey));
    }
    static string[] IdMarks(Gen2Platform p) => p.HasSid ? new[] { "poll", "tidRoll", "crystalSid" } : new[] { "poll", "tidRoll" };

    // ---- bins and their text --------------------------------------------------------------------
    public sealed class BinInfo
    {
        public Gen2Lookup Lookup { get; init; } = new();
        public double AimV { get; init; }
        public double AimS { get; init; }
        public double AfterPowerOnS { get; init; }
        public int Tid => Lookup.Tid;
        public int Lid => Lookup.Lid;
        public int? Sid => Lookup.Sid;
        public int[] Visible => Lookup.Visible;
        public int[] Offsets => Lookup.Offsets;
    }
    public static BinInfo Info(Gen2Platform p, int bin)
    {
        var r = Gen2Tid.Lookup(p.Data, p.GameKey, p.PlatformKey, p.State, bin);
        double aimV = r.Aim - Gen2Tid.VisibleMenuLagFrames;
        return new BinInfo { Lookup = r, AimV = aimV, AimS = FramesToS(aimV), AfterPowerOnS = p.VisibleMenuS + FramesToS(aimV) };
    }
    public static string IdsText(Gen2Platform p, int tid, int? lid, int? sid)
    {
        string s = "TID " + FmtId(tid);
        if (p.HasLid && lid is not null) s += ", Lucky ID " + FmtLid(lid.Value);
        if (p.HasSid && sid is not null) s += ", Secret ID " + FmtId(sid.Value);
        return s;
    }
    public static string IdsText(Gen2Platform p, BinInfo r) => IdsText(p, r.Tid, r.Lid, r.Sid);
    public static string SetTag(Gen2Platform p, int tid, int? lid, int? sid) => string.Join(", ", Gen2Tid.SetsAccepting(tid, lid, sid, p.TargetSets).Select(s => s.Key));
    public static string DescribeBin(Gen2Platform p, int bin)
    {
        var r = Info(p, bin);
        string tag = SetTag(p, r.Tid, r.Lid, r.Sid);
        return $"bin {bin} (A down {r.Visible[0]}..{r.Visible[1]} frames after the visible menu box, aim {F(r.AimV, 1)} = {FmtSf(r.AimS)}) -> {IdsText(p, r)}" +
            (tag != "" ? "   route target (" + tag + "; the published protocol for it is a community script, not this single tap)" : "") +
            (p.Reachable ? "" : "   [RTC state " + p.State + ": first boot only]") + "   methodology " + p.MethodologyId + FootnotesFor(p).Mark(IdMarks(p));
    }

    public static List<string> MethodologyLines(Gen2Platform p, bool conditions, string indent = "  ")
    {
        var m = p.Methodology;
        var lines = new List<string>
        {
            $"{indent}Methodology: {p.MethodologyId}   ({J.S(m, "name")}; v{J.Int(m, "version", 0)}, {J.S(m, "date")})",
            $"{indent}status: {J.S(m, "status")}; {p.Name}: {p.Status}",
            indent + MethodologySentence
        };
        if (conditions)
        {
            lines.Add(indent + "Valid only if:");
            foreach (var c in J.SA(m, "validity")) lines.Add(indent + "  - " + c);
        }
        return lines;
    }
    // Every methodology of a game, with its protocol text and validity conditions verbatim from the data.
    public static List<string> AllMethodologyLines(Gen2TidData data, string gameKey)
    {
        var g = data.Game(gameKey);
        var lines = new List<string> { "All methodologies for " + J.S(g, "name") + " (protocol and validity conditions verbatim from the data):" };
        foreach (var id in J.SA(g, "methodologies"))
        {
            var m = data.Methodology(id).Raw;
            lines.AddRange(new[]
            {
                "", $"Methodology: {id}   ({J.S(m, "name")}; v{J.Int(m, "version", 0)}, {J.S(m, "date")})",
                "  console: " + J.S(m, "console_name"), "  status: " + J.S(m, "status"), "  predicts: " + J.S(m, "predicts"), "  anchors: " + string.Join(", ", J.SA(m, "anchors")),
                "  " + MethodologySentence, "  Protocol: " + J.S(m, "protocol"), "  Landmark: " + J.S(m, "landmark"), "  Valid only if:"
            });
            foreach (var c in J.SA(m, "validity")) lines.Add("    - " + c);
        }
        return lines;
    }
    public static List<string> TargetSetLines(Gen2Platform p)
    {
        if (p.TargetSets.Count == 0) return new() { "Target sets: none in force for " + p.GameName + " (any bin can still be aimed at)" };
        var lines = new List<string> { "Target sets in force: " + string.Join(", ", p.TargetSetKeys) };
        var all = p.Data.Root.GetProperty("target_sets");
        foreach (var x in p.TargetSets)
        {
            lines.Add($"  - {x.Name} [{x.Describe()}]");
            lines.Add("      protocol: " + (x.Protocol != "" ? x.Protocol : "single-tap") + (x.Route != "" ? "; route: " + x.Route : ""));
            if (x.Provenance != "") lines.Add("      provenance: " + x.Provenance);
            if (x.Note != "") lines.Add("      note: " + x.Note);
            var hits = new List<string>();
            if (all.TryGetProperty(x.Key, out var spec) && spec.TryGetProperty("single_press_hits", out var sh) && sh.ValueKind == JsonValueKind.Array)
                foreach (var h in sh.EnumerateArray())
                    hits.Add($"{J.S(h, "table")} bin {J.Int(h, "bin", 0)} (TID ${J.S(h, "tid")}, LID ${J.S(h, "lid")}" + (h.TryGetProperty("reachable_after_first_boot", out var r) && r.ValueKind == JsonValueKind.True ? ")" : ", first boot only)"));
            lines.Add("      single-press hits over every RTC state of its games: " + (hits.Count > 0 ? string.Join("; ", hits) : "none"));
        }
        var others = p.OtherTargetSetKeys;
        if (others.Length > 0) lines.Add($"  also defined for {p.GameName}, not in force: {string.Join(", ", others)}");
        lines.Add(Gen2Platform.ScriptsLine(p.Data, p.GameKey));
        return lines;
    }
    // The bins that give a member of a set in force: in the chosen state, and in every other state of the platform.
    public static (List<Gen2Target> InState, List<Gen2Target> OtherStates) TargetRows(Gen2Platform p)
    {
        var inState = Gen2Tid.Targets(p.Data, p.GameKey, p.PlatformKey, p.State, p.TargetSets);
        var all = Gen2Tid.TargetsAllStates(p.Data, p.GameKey, p.PlatformKey, p.TargetSets).Where(h => h.State != p.State).ToList();
        return (inState, all);
    }

    // ---- protocol text -------------------------------------------------------------------------
    static string ResetActionName(Gen2Platform p) => p.Key == "gse" ? "Ctrl+R (hard reset)" : "the console's RESET";
    static string TapText() => $"tap A ONCE for {Gen2Tid.TapFrames[0]}-{Gen2Tid.TapFrames[1]} frames ({F(Gen2Tid.TapMs[0], 0)}-{F(Gen2Tid.TapMs[1], 0)} ms), then press NOTHING for {F(Gen2Tid.RollSettleS, 2)} s (until the New Game roll is over)";

    public static Gen2Schedule BuildSchedule(Gen2Platform p, string anchor, int bin, double correctionMs, int beeps, double spacing)
    {
        double? extra = null;
        if (anchor == Gen2Tid.AnchorReset)
        {
            if (p.ResetModel is null) throw new ArgumentException($"no reset model for {p.Key} (the reset anchor needs the console's fade and stall)");
            extra = Gen1Tid.ResetAnchorExtraSeconds(p.ResetModel);
        }
        return Gen2Tid.Schedule(p.Data, p.MethodologyId, bin, correctionMs, anchor, beeps, spacing, extra);
    }
    // The Gen 1 schedule shape the shared cue player takes (the same cues, times and tones).
    public static Schedule ToGen1Schedule(Gen2Schedule s) => new()
    {
        Anchor = s.Anchor, Cues = s.Cues.ToList(), TA = s.TA, HoldLo = s.HoldLo, HoldHi = s.HoldHi, Menu = s.Menu, DroppedCountIn = s.DroppedCountIn
    };

    public static List<string> ProtocolLines(Gen2Platform p, string anchor, int bin, Gen2Schedule sched, double correctionMs, int beeps, double spacing)
    {
        var r = Info(p, bin);
        var m = p.Methodology;
        var t = p.Timing;
        double holdLo = FramesToS(t.HoldLoFrame), holdHi = FramesToS(t.HoldHiFrame);
        string landmark = J.S(m, "landmark");
        var fn = FootnotesFor(p);
        bool c = p.GameKey == "crystal";
        var lines = new List<string>
        {
            $"PROTOCOL  ({p.GameName} on {p.Name}, target bin {bin} -> {IdsText(p, r)})",
            $"    Methodology: {p.MethodologyId}   ({J.S(m, "name")}; v{J.Int(m, "version", 0)}, {J.S(m, "date")})",
            "    status: " + J.S(m, "status"),
            "    " + MethodologySentence + " The steps below ARE the methodology: any other input pattern",
            "    (a longer tap, START still down at the roll, a second press, a CONTINUE menu, a community script) gives",
            "    a different, deterministic result that this table does not cover.",
            "    NOTE: " + NoHardwareLine,
            "    NOTE (" + p.Name + "): " + p.Validation,
            "    RTC state: " + Gen2Platform.StateLabel(p.Data, p.GameKey, p.State) + (p.Reachable ? "" : ". This is a FIRST-BOOT-ONLY state: the next boot of the same cartridge is days0 or days512.") + (c ? fn.Mark("crystalImmune") : fn.Mark("startClock", "fixDays", "haltClear")),
            "",
            " 1. Clear the save data: on the title screen hold UP + B + SELECT, confirm, then power fully OFF. The menu must",
            "    show NEW GAME with no CONTINUE (a CONTINUE menu makes the attempt invalid), and the Lucky ID column applies",
            "    only to the FIRST New Game after the clear." + (p.HasLid ? fn.Mark("lid") : "")
        };
        if (p.Key == "gse") lines.Add("    On GSE: keep a ROM copy with no .sav beside it, or NEW GAME silently becomes CONTINUE.");
        if (anchor == Gen2Tid.AnchorMenu)
        {
            lines.Add(" 2. " + (p.Key == "gse" ? "Power on (Ctrl+R hard reset on GSE)" : "Power on") + ". " + landmark);
            lines.Add($"    Hold window: START down between {F(holdLo, 2)} s and {F(holdHi, 2)} s after the boot starts (frames {t.HoldLoFrame}-{t.HoldHiFrame}); anywhere inside it gives the same menu frame." + fn.Mark("holdStart", "roll"));
            lines.Add($" 3. Keep START held until the NEW GAME / OPTION menu box appears (visible on frame {t.VisibleMenuFrame}, {F(p.VisibleMenuS, 2)} s after the boot starts)." + fn.Mark("roll"));
            lines.Add("    The INSTANT you see the box, press the ANCHOR button (or Space) and release START.");
            lines.Add($" 4. You will hear {beeps} short beeps {F(spacing, 1)} s apart, then one long high beep (the screen flashes with each).");
            lines.Add("    On the long high beep " + TapText() + "." + fn.Mark("poll", "heldInput"));
            lines.Add($"    Target: bin {bin} = A down {r.Visible[0]}..{r.Visible[1]} frames after the visible menu box (aim {F(r.AimV, 1)} = {FmtSf(r.AimS)})." + fn.Mark(IdMarks(p).Append("stir").ToArray()));
            lines.Add($"    The beep is {FmtMs(correctionMs)} early to cover your reaction to the menu plus the audio delay (the correction; calibration tunes it).");
        }
        else
        {
            double hLo = sched.HoldLo ?? 0, hHi = sched.HoldHi ?? 0, mn = sched.Menu ?? 0;
            if (anchor == Gen2Tid.AnchorReset) lines.Add($" 2. Press the ANCHOR button (or Space) at the SAME instant you press {ResetActionName(p)} ({F(hLo, 3)} s of fade and stall are added to every time below).");
            else lines.Add(" 2. Press the ANCHOR button (or Space) at the SAME instant you flip the power on" + (p.Key == "gba" ? " (INFERRED on a handheld GBA: the power-on-to-boot delay is not measured; prefer the menu anchor until a sample settles it)" : "") + ".");
            lines.Add($" 3. Two low beeps mark the START-hold window ({F(hLo, 2)} s and {F((hLo + hHi) / 2.0, 2)} s after your anchor): HOLD START on the first low beep and keep holding." + fn.Mark("holdStart", "roll"));
            lines.Add("    " + landmark);
            lines.Add($" 4. A double blip at {F(mn, 2)} s marks when the NEW GAME / OPTION menu box should appear (visible on frame {t.VisibleMenuFrame} of the boot): release START as it appears." + fn.Mark("roll"));
            lines.Add("    If the box appears far from the blip, START was held outside the window: the attempt is no good, reset and try again.");
            lines.Add($" 5. Then {beeps - sched.DroppedCountIn} short beeps {F(spacing, 1)} s apart and one long high beep. On the long high beep {TapText()}." + fn.Mark("poll", "heldInput"));
            lines.Add($"    Target: bin {bin} = A down {r.Visible[0]}..{r.Visible[1]} frames after the visible menu box (aim {F(r.AimV, 1)}) = {FmtSf(mn + r.AimS)} after your anchor." + fn.Mark(IdMarks(p).Append("stir").ToArray()));
            lines.Add($"    The beep is {FmtMs(correctionMs)} early for the audio delay (this anchor's correction).");
            if (sched.DroppedCountIn > 0) lines.Add($"    ({Plural(sched.DroppedCountIn, "count-in beep")} left out: they would have sounded before the menu.)");
        }
        lines.Add(" 6. Afterwards type the Trainer ID you got below (the Trainer Card, or a Pokemon's status screen IDNo)" +
            (p.HasLid ? " and, once you have seen it, the Lucky ID (the Radio Tower lottery screen; first New Game after the clear only)." : "."));
        lines.Add("    Each answer sharpens the correction; a typed Lucky ID also settles which bin and state you hit." + (p.HasLid ? fn.Mark("tidRoll", "lid") : fn.Mark("tidRoll")));
        lines.Add("");
        lines.AddRange(fn.Lines());
        return lines;
    }
    public static List<string> ScheduleLines(Gen2Schedule sched, int bin, double correctionMs, Gen2Platform p)
    {
        var r = Info(p, bin);
        var lines = new List<string> { "SCHEDULE (seconds after your anchor):", "  Methodology: " + p.MethodologyId + "   RTC state: " + p.State };
        if (sched.Anchor != Gen2Tid.AnchorMenu)
        {
            lines.Add($"  hold START window   {F(sched.HoldLo ?? 0, 3)} - {F(sched.HoldHi ?? 0, 3)} s   (low beeps at the start and the middle)");
            lines.Add($"  menu box visible    {F(sched.Menu ?? 0, 3)} s   (double blip: release START)");
        }
        if (sched.CountInTimes.Length > 0) lines.Add("  count-in beeps      " + string.Join(", ", sched.CountInTimes.Select(t => F(t, 3))));
        lines.Add($"  A cue (long beep)   {F(sched.TA, 3)} s   = aim {F(r.AimV, 1)} frames after the visible menu ({FmtSf(r.AimS)})" +
            (sched.Anchor == Gen2Tid.AnchorMenu ? "" : ", from your anchor") + " minus correction " + FmtMs(correctionMs));
        var fn = FootnotesFor(p);
        lines.Add($"  A window (bin {bin}) {F(sched.AWindow[0], 3)} - {F(sched.AWindow[1], 3)} s   (A down inside it, before the correction)" + fn.Mark("poll", "roll"));
        lines.Add($"  tap {F(sched.TapMs[0], 0)}-{F(sched.TapMs[1], 0)} ms, then nothing for {F(sched.RollSettleS, 2)} s" + fn.Mark("heldInput"));
        return lines;
    }
    public static string AnnounceCue(Cue c) => Gen1TidText.AnnounceCue(c);

    // ---- calibration records (the Gen 1 store helpers' rules over a Gen 2 store) ------------------
    // Every record carries the mode it was made in and each mode has its own setting key (AppMode.Scoped);
    // inside a store a record under another methodology or made in the other mode is left out of the
    // correction and named in a note, so a practice-derived correction is never in force in a run.
    public static string CalKey(string platformKey, string anchor) => platformKey + "/" + anchor;
    public static List<Gen2CalSample> AllSamples(Dictionary<string, Gen2CalEntry> cal, string platformKey, string anchor)
        => cal.TryGetValue(CalKey(platformKey, anchor), out var e) ? e.Samples.ToList() : new();
    static bool InScope(Gen2CalSample s, Gen2Platform p, string mode) => s.Methodology == p.MethodologyId && Modes.Effective(s.Mode) == mode;
    public static List<Gen2CalSample> SamplesFor(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        return AllSamples(cal, p.Key, anchor).Where(s => InScope(s, p, mode)).ToList();
    }
    public static List<Sample> Gen1SamplesFor(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
        => SamplesFor(cal, p, anchor, mode).Select(s => s.ToGen1Sample()).ToList();
    // (under another methodology, under this methodology but made in the other mode)
    public static (List<Gen2CalSample> Methodology, List<Gen2CalSample> Mode) IgnoredSamples(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
    {
        var all = AllSamples(cal, p.Key, anchor);
        var (_, otherMode) = Modes.SplitByMode(all.Where(s => s.Methodology == p.MethodologyId), s => s.Mode, mode);
        return (all.Where(s => s.Methodology != p.MethodologyId).ToList(), otherMode);
    }
    public static double CorrectionInForce(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
        => Gen1Tid.MeanCorrection(Gen1SamplesFor(cal, p, anchor, mode), p.DefaultCorrection(anchor));
    public static List<string> IgnoredSampleLines(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
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
            var modes = byMode.Select(x => Modes.Describe(x.Mode)).Distinct().OrderBy(x => x, StringComparer.Ordinal);
            lines.Add($"NOTE: {Plural(byMode.Count, "stored sample")} for {p.Key}/{anchor} ignored: recorded in {string.Join(", ", modes)} mode, not {Modes.Label(mode)}. " +
                      "Samples are never mixed across modes: a practice-derived correction is never in force in a run.");
        }
        return lines;
    }

    // The outcome of one attempt: the typed IDs inverted on the platform in the outcome scope, the candidate nearest
    // the aim, the implied correction, and (unless refused by the bin outlier guard or the duplicate guard) the sample
    // recorded, stamped with the mode.
    public static Gen2OutcomeReport RecordOutcome(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, int aimedBin, double correctionUsed, int tid, int? lid,
        bool force, string? attempt, string mode, string? when = null, string player = Player)
    {
        Modes.Check(mode);
        var out_ = new Gen2OutcomeReport { Tid = tid, Lid = lid, AimedBin = aimedBin };
        out_.Lines.Add("You got TID " + FmtId(tid) + (lid is null ? "" : " with Lucky ID " + FmtLid(lid.Value)) + ": " + Gen2Tid.VerdictText(tid, lid, null, p.TargetSets) + ".");
        var sh = Gen2Tid.SampleFromHit(p.Data, p.GameKey, p.PlatformKey, p.OutcomeState(), tid, lid, aimedBin, correctionUsed, attempt, null, player);
        out_.Candidates = sh.Candidates;
        if (sh.Sample is null)
        {
            out_.Lines.Add($"  Those IDs are in no {p.Name} table in scope ({p.OutcomeScopeText()}), so nothing can be learned from this attempt.");
            out_.Lines.Add("  Usual causes: START held outside the window, the save was not cleared (CONTINUE menu), a tap longer than 8 frames");
            out_.Lines.Add($"  or START still down at the roll, another console family, or the press was later than bin {Gen2Tid.BinCount - 1}.");
            var broad = Gen2Tid.Invert(p.Data, p.GameKey, tid, lid, null, p.PlatformKey);
            out_.Elsewhere = broad.Candidates;
            if (broad.Candidates.Count > 0)
                out_.Lines.Add("  They ARE produced on this platform in another RTC state: " + string.Join("; ", broad.Candidates.Select(c => c.Table + " bin " + c.Bin + (c.ReachableAfterFirstBoot ? "" : " (first boot only)"))) +
                    ". That is a different table (the clock, not your timing), so the correction is unchanged; pick that state above if it is this cartridge's.");
            else out_.Lines.Add("  Correction unchanged.");
            out_.Lines.Add($"  Methodology: {p.MethodologyId} (nothing recorded under it from this attempt).");
            return out_;
        }
        int hit = sh.NearestBin!.Value;
        out_.HitBin = hit;
        if (sh.Candidates.Count > 1)
            out_.Lines.Add("  (" + string.Join(", ", sh.Candidates.Select(c => c.Table + " bin " + c.Bin)) + " all give these IDs; using bin " + hit + ", the one nearest your aim)");
        double err = Gen2Tid.ErrorFramesBins(p.Rule, hit, aimedBin);
        var hitRange = Gen2Tid.OffsetsForBin(hit, p.Rule);
        if (err == 0) out_.Lines.Add($"  You hit bin {hit} exactly (aimed {aimedBin}; state {sh.Sample.State}).");
        else out_.Lines.Add($"  You hit bin {hit} (A down {hitRange[0] - Gen2Tid.VisibleMenuLagFrames}..{hitRange[1] - Gen2Tid.VisibleMenuLagFrames} frames after the visible menu), aimed {aimedBin}: " +
            $"{F(Math.Abs(err), 1)} frames {(err > 0 ? "late" : "early")} ({F(Math.Abs(Gen1Tid.FramesToMs(err)), 1)} ms; state {sh.Sample.State}).");
        out_.Implied = sh.Sample.ImpliedMs;
        out_.Lines.Add($"  This attempt implies a correction of {F(out_.Implied.Value, 1)} ms (used {F(correctionUsed, 1)} ms).");
        var sample = Gen2CalSample.From(sh.Sample, when ?? Now(), mode);
        var stored = AllSamples(cal, p.Key, anchor);
        if (!force && Gen2Tid.IsOutlierBins(p.Rule, hit, aimedBin))
        {
            out_.Refused = "outlier";
            out_.Lines.Add($"  That is more than {Gen2Tid.OutlierFrames} frames ({Gen2Tid.OutlierFrames / Gen2Tid.PollPeriodFrames} bins, {F(Gen1Tid.FramesToSeconds(Gen2Tid.OutlierFrames), 1)} s) from the aim: NOT added to the calibration ({anchor} anchor).");
            out_.Lines.Add("  Usual causes: START held outside the window (the table does not apply to that attempt), a mistyped ID, or the ID");
            out_.Lines.Add("  of a different attempt. If it really was this attempt, tick 'force' and record again.");
            out_.Lines.Add($"  Methodology: {p.MethodologyId} (nothing recorded under it from this attempt).");
            return out_;
        }
        if (!force && Gen1Tid.IsDuplicate(stored.Select(s => s.ToGen1Sample()), sample.ToGen1Sample()))
        {
            out_.Refused = "duplicate";
            out_.Lines.Add($"  Looks like the same attempt entered twice (same Trainer ID and the same aim): not added ({anchor} anchor).");
            out_.Lines.Add("  Tick 'force' if it really was a new attempt.");
            out_.Lines.Add($"  Methodology: {p.MethodologyId} (nothing recorded under it from this attempt).");
            return out_;
        }
        stored.Add(sample);
        cal[CalKey(p.Key, anchor)] = new Gen2CalEntry { Samples = stored };
        out_.Added = true;
        int n = SamplesFor(cal, p, anchor, mode).Count;
        out_.NewCorrection = CorrectionInForce(cal, p, anchor, mode);
        out_.Lines.Add($"  Correction updated to {F(out_.NewCorrection.Value, 1)} ms ({Plural(n, "sample")}, {anchor} anchor).");
        out_.Lines.Add($"  Methodology: {p.MethodologyId} (recorded with the sample; only samples under it are averaged).");
        out_.Lines.Add($"  Mode: {Modes.Label(mode)} (recorded with the sample; only samples made in this mode are averaged, from this mode's own store).");
        out_.Lines.AddRange(IgnoredSampleLines(cal, p, anchor, mode).Select(l => "  " + l));
        return out_;
    }

    // the newest sample under this methodology made in this mode; others stay where they are
    public static Gen2CalSample? DropLastSample(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        var stored = AllSamples(cal, p.Key, anchor);
        for (int i = stored.Count - 1; i >= 0; i--)
        {
            if (InScope(stored[i], p, mode))
            {
                var d = stored[i];
                stored.RemoveAt(i);
                cal[CalKey(p.Key, anchor)] = new Gen2CalEntry { Samples = stored };
                return d;
            }
        }
        return null;
    }
    public static (int Removed, int Kept) ClearSamples(Dictionary<string, Gen2CalEntry> cal, Gen2Platform p, string anchor, string mode)
    {
        Modes.Check(mode);
        var stored = AllSamples(cal, p.Key, anchor);
        var kept = stored.Where(s => !InScope(s, p, mode)).ToList();
        if (kept.Count > 0) cal[CalKey(p.Key, anchor)] = new Gen2CalEntry { Samples = kept }; else cal.Remove(CalKey(p.Key, anchor));
        return (stored.Count - kept.Count, kept.Count);
    }
    public static string SampleLine(Gen2CalSample x)
        => $"  {x.When ?? ""}  aimed bin {x.AimedBin}  hit bin {x.HitBin}  used {F(x.CorrectionUsedMs, 1)} ms  implied {F(x.ImpliedMs, 1)} ms  TID {FmtId(x.Tid)}" +
           (x.Lid is null ? "" : "  LID " + FmtLid(x.Lid.Value)) + (x.State != "" ? "  state " + x.State : "");

    // ---- the runner's timing (the Gen 1 text over the Gen 2 samples) --------------------------------
    static bool HasSpread(AnchorStats st) => st.N >= 2 && !double.IsNaN(st.SdMs);
    public static (double? P, string Line) HitSummary(IReadOnlyList<Gen2CalSample> samples, string anchor, string methodologyId)
        => Gen1TidText.HitSummary(samples.Select(s => s.ToGen1Sample()).ToList(), anchor, methodologyId);
    public static List<string> StatsLines(IReadOnlyList<Gen2CalSample> samples, Gen2Platform p, string anchor, string mode)
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
            var (lo, hi) = Gen1Tid.HitProbabilityRange(st.SdMs, st.N, Gen1Tid.FrameMs, Gen1Tid.SdIntervalConf, centred);
            string range = $"{(int)Math.Round(100 * Gen1Tid.SdIntervalConf)} % range {Gen1TidText.FmtPct(lo).Replace(" %", "")}-{Gen1TidText.FmtPct(hi)}";
            if (st.N < Gen1Tid.SmallN) range += $", n = {st.N}: rough, aim not yet centred";
            lines.Add($"  P(hit) about {Gen1TidText.FmtPct(hp)} ({range}) -> about {Gen1TidText.FmtAttempts(hp)} attempts per hit   (the frame-level figure: the bin is 4 frames wide, so landing inside it is easier than this)");
        }
        string welch = dr.WelchT is null ? "" : $"; Welch t {F(dr.WelchT.Value, 2)}";
        if (dr.Flag) lines.Add($"  drift: RECALIBRATE / SETUP CHANGED ({dr.Strength}): {dr.Reason}{welch}");
        else if (dr.Strength == "weak") lines.Add($"  drift: none flagged, a shift inside the scatter ({dr.Reason})");
        else lines.Add($"  drift: none ({dr.Reason}{welch})");
        var (code, text) = Gen1Tid.Recommendation(st, dr);
        lines.Add($"  recommendation [{code}]: {text}");
        foreach (var x in samples) lines.Add(SampleLine(x));
        return lines;
    }

    // ---- the invert panel: typed IDs -> candidate states and bins, with the ambiguity statistics -----
    // scope: family "all" | "running" | "halted" | "prior", or one state
    public static (string Family, IReadOnlyList<string>? States) InvertScope(Gen2Platform p, string family, string? state)
    {
        if (!string.IsNullOrEmpty(state)) return ("all", new[] { state });
        if (family == "prior") return ("all", Gen2Tid.TwoStatePrior.ToArray());
        if (family != "" && family != "all") return (family, null);
        return ("all", null);
    }
    public static string InvertScopeText(Gen2Platform p, string family, string? state)
    {
        if (!p.RtcDependent) return "the one Crystal table on platform " + p.PlatformKey;
        if (!string.IsNullOrEmpty(state)) return "RTC state " + state + " on platform " + p.PlatformKey;
        if (family == "prior") return "the two-state prior (" + string.Join(", ", Gen2Tid.TwoStatePrior) + ") on platform " + p.PlatformKey;
        if (family == "running") return "the ten running-clock states on platform " + p.PlatformKey;
        if (family == "halted") return "the ten halted-clock states on platform " + p.PlatformKey + " (a cartridge halted and not booted since: first boot only)";
        return "every RTC state on platform " + p.PlatformKey;
    }
    public static (Gen2Inversion Inversion, Gen2Ambiguity Ambiguity, List<string> Lines) InvertLines(Gen2Platform p, int tid, int? lid, string family, string? state)
    {
        var (fam, states) = InvertScope(p, family, state);
        var inv = Gen2Tid.Invert(p.Data, p.GameKey, tid, lid, null, p.PlatformKey, fam, states);
        var fn = FootnotesFor(p);
        var lines = new List<string>
        {
            "TID " + FmtId(tid) + (lid is null ? "" : " + Lucky ID " + FmtLid(lid.Value)) + " on " + p.Name + " (" + p.GameName + "), scope: " + InvertScopeText(p, family, state) + ": " + Gen2Tid.VerdictText(tid, lid, null, p.TargetSets)
        };
        lines.AddRange(MethodologyLines(p, false));
        if (inv.Candidates.Count == 0)
        {
            lines.Add("  no candidate: these IDs are absent from every table in scope. Wrong platform (SGB, 3DS Virtual Console, a header-renamed ROM),");
            lines.Add("  a dead-battery clock state, or a violated protocol (a longer tap, START down at the roll, a CONTINUE menu): ask for a second boot." + (p.RtcDependent ? fn.Mark("tidRoll", "heldInput", "startClock") : fn.Mark("tidRoll", "heldInput")));
        }
        else
        {
            foreach (var c in inv.Candidates)
            {
                int v0 = c.Offsets[0] - Gen2Tid.VisibleMenuLagFrames, v1 = c.Offsets[1] - Gen2Tid.VisibleMenuLagFrames;
                lines.Add($"  {c.Table} bin {c.Bin}: A down {v0}..{v1} frames after the visible menu box ({FmtSf(FramesToS((v0 + v1) / 2.0))}) -> TID {FmtId(c.Tid)}" +
                    (p.HasLid ? ", LID " + FmtLid(c.Lid) : "") + (p.HasSid && c.Sid is not null ? ", SID " + FmtId(c.Sid.Value) : "") + "; " + c.Family + " clock" +
                    (c.Members.Length > 1 ? "; the same table as " + string.Join(", ", c.Members.Skip(1).Select(m => m[0] + "/" + m[1])) : "") +
                    (c.ReachableAfterFirstBoot ? "" : "   [first boot only]") + fn.Mark(c.ReachableAfterFirstBoot ? IdMarks(p) : IdMarks(p).Append("haltClear").ToArray()));
            }
            if (inv.Candidates.Count == 1) lines.Add("  one candidate: the bin and the state are settled.");
            else if (inv.Resolved is not null) lines.Add($"  {inv.Candidates.Count} candidates; the two-state prior ({string.Join(", ", Gen2Tid.TwoStatePrior)}) picks {inv.Resolved.Table} bin {inv.Resolved.Bin} for a cartridge booted before.");
            else lines.Add($"  AMBIGUOUS: {inv.Candidates.Count} candidates" + (inv.Preferred.Count > 0 ? $", {inv.Preferred.Count} of them under the two-state prior" : ", none under the two-state prior") +
                (lid is null && p.HasLid ? "; the Lucky ID (Radio Tower lottery screen) settles it" : "") + ".");
        }
        var amb = Gen2Tid.Ambiguity(p.Data, p.GameKey, p.PlatformKey, fam, states);
        lines.Add($"Ambiguity over this scope ({Plural(amb.Tables, "distinct table")}, {amb.Entries} (table, bin) entries): {amb.DistinctTids} distinct TIDs, {amb.AmbiguousTids}" +
            $" with more than one candidate ({amb.AmbiguousEntries} entries" + (amb.Entries > 0 ? $" = {F(100.0 * amb.AmbiguousEntries / amb.Entries, 1)} %" : "") + $", max {amb.MaxCandidates}), " +
            $"{amb.PairCollisions} (TID, LID) pair collision" + (amb.PairCollisions == 1 ? "" : "s") +
            (amb.PairCollisions > 0 ? " (" + string.Join(", ", amb.PairCollisionList) + (amb.PairCollisions > amb.PairCollisionList.Length ? ", ..." : "") + ")" : "") + ".");
        lines.Add("");
        lines.AddRange(fn.Lines());
        return (inv, amb, lines);
    }

    // ---- verify (moderators; human-measured input) ------------------------------------------------
    public static (bool Consistent, Gen2VerifyResult Result, List<string> Lines) VerifyLines(Gen2Platform p, int tid, int? lid, double menuToPressS)
    {
        var r = Gen2Tid.Verify(p.Data, p.GameKey, p.PlatformKey, tid, lid, menuToPressS, p.OutcomeState());
        var fn = FootnotesFor(p);
        var lines = new List<string> { "TID " + FmtId(tid) + (lid is null ? "" : " + Lucky ID " + FmtLid(lid.Value)) + " on " + p.Name + " (" + p.GameName + "): " + Gen2Tid.VerdictText(tid, lid, null, p.TargetSets) };
        lines.AddRange(MethodologyLines(p, true));
        lines.Add($"  measured VISIBLE menu box -> A press: {F(menuToPressS, 3)} s = offset {F(r.PredictedOffset, 1)} ({F(menuToPressS, 3)} s x {F(Gen2Tid.Fps, 4)} fps + {Gen2Tid.VisibleMenuLagFrames}) -> bin " +
            (r.PredictedBin is null ? "none (outside the table)" : r.PredictedBin.Value.ToString()) + "; scope " + p.VerifyScopeText() + fn.Mark("poll", "roll"));
        if (!r.InTable)
        {
            lines.Add("  these IDs are produced by NO bin in scope on this platform: INCONSISTENT with the tables" + fn.Mark(IdMarks(p)));
            lines.Add("");
            lines.AddRange(fn.Lines());
            return (false, r, lines);
        }
        lines.Add("  the tables produce them at bin" + (r.Bins.Length > 1 ? "s " : " ") + string.Join(", ", r.Bins) + fn.Mark(IdMarks(p)));
        lines.Add($"  nearest bin {r.Nearest} is " + (r.DifferenceBins is null ? "n/a" : r.DifferenceBins.Value + " bin" + (Math.Abs(r.DifferenceBins.Value) == 1 ? "" : "s")) + " from the measurement (tolerance +-1 bin): " + (r.Consistent ? "CONSISTENT" : "INCONSISTENT"));
        lines.Add("  (no press-to-visible lag is known for Gen 2: no hardware sample exists; measure the press itself, from the button overlay or a hand cam)");
        lines.Add("  (this checks timing against the tables only, and only under the methodology above; it says nothing else about the run)");
        lines.Add("");
        lines.AddRange(fn.Lines());
        return (r.Consistent, r, lines);
    }
}
