using System.Text.Json;
using System.Text.RegularExpressions;
using ShinySolution.App;
using ShinySolution.Core;

// The desktop Gen 2 TID panel's pure part (app/App/Gen2TidSupport.cs, compiled into this project) against
// tests/gen2tid-panel-vectors.json, emitted from the web app's Gen 2 TID tab (webapp/gen2tid-ui.js) by
// tools/gen-gen2-panel-vectors.cjs: for 20 target inputs the resolved methodology, the bin, the schedule
// (every cue time), the schedule and protocol text and the typed outcome each one inverts to, line for line;
// the bin guards (the 15-bin outlier edge, the duplicate, force), the RUN / PRACTICE-HUNT store split (a
// practice-stamped sample never averaged into RUN, named in the note), drop / clear by mode, the invert panel,
// verify and the fixed texts. Floats to 1e-9 (relative above |1|), strings exact. app/run-core-tests.sh runs it
// on the committed file, then on a corrupted copy that must fail.
static class Gen2TidPanelChecks
{
    const double Tol = 1e-9;
    static int failures, checks;

    static void Fail(string label, string detail)
    {
        failures++;
        if (failures <= 40) Console.Error.WriteLine("FAIL " + label + (detail == "" ? "" : "\n  " + detail));
    }
    static void Check(string label, bool ok, string detail = "") { checks++; if (!ok) Fail(label, detail); }
    static bool Near(double a, double b) => Math.Abs(a - b) <= Tol * Math.Max(1.0, Math.Abs(b));
    static void CheckNum(string label, double actual, JsonElement expected)
    {
        checks++;
        if (expected.ValueKind != JsonValueKind.Number || !Near(actual, expected.GetDouble())) Fail(label, $"expected {expected.GetRawText()}, actual {actual:R}");
    }
    static void CheckNumN(string label, double? actual, JsonElement expected)
    {
        checks++;
        bool ok = expected.ValueKind == JsonValueKind.Null ? actual is null : actual is not null && expected.ValueKind == JsonValueKind.Number && Near(actual.Value, expected.GetDouble());
        if (!ok) Fail(label, $"expected {expected.GetRawText()}, actual {(actual is null ? "null" : actual.Value.ToString("R"))}");
    }
    static void CheckIntN(string label, int? actual, JsonElement expected)
    {
        checks++;
        bool ok = expected.ValueKind == JsonValueKind.Null ? actual is null : actual is not null && expected.ValueKind == JsonValueKind.Number && expected.GetInt32() == actual.Value;
        if (!ok) Fail(label, $"expected {expected.GetRawText()}, actual {(actual is null ? "null" : actual.Value.ToString())}");
    }
    static void CheckStr(string label, string? actual, JsonElement expected)
    {
        checks++;
        bool ok = expected.ValueKind == JsonValueKind.Null ? actual is null : expected.ValueKind == JsonValueKind.String && expected.GetString() == actual;
        if (!ok) Fail(label, $"expected {expected.GetRawText()}\n  actual   {(actual is null ? "null" : JsonSerializer.Serialize(actual))}");
    }
    static void CheckLines(string label, IReadOnlyList<string> actual, JsonElement expected)
    {
        checks++;
        var exp = expected.EnumerateArray().Select(e => e.GetString() ?? "").ToList();
        if (exp.Count != actual.Count) { Fail(label, $"{exp.Count} lines expected, {actual.Count} actual\n  expected {JsonSerializer.Serialize(exp)}\n  actual   {JsonSerializer.Serialize(actual)}"); return; }
        for (int i = 0; i < exp.Count; i++)
            if (exp[i] != actual[i]) { Fail(label + $" (line {i})", $"expected {JsonSerializer.Serialize(exp[i])}\n  actual   {JsonSerializer.Serialize(actual[i])}"); return; }
    }
    static void CheckNums(string label, IReadOnlyList<double> actual, JsonElement expected)
    {
        checks++;
        var exp = expected.EnumerateArray().Select(e => e.GetDouble()).ToList();
        bool ok = exp.Count == actual.Count && exp.Zip(actual).All(z => Near(z.Second, z.First));
        if (!ok) Fail(label, $"expected {expected.GetRawText()}, actual [{string.Join(", ", actual.Select(x => x.ToString("R")))}]");
    }
    static void CheckInts(string label, IReadOnlyList<int> actual, JsonElement expected)
    {
        checks++;
        var exp = expected.EnumerateArray().Select(e => e.GetInt32()).ToList();
        if (!exp.SequenceEqual(actual)) Fail(label, $"expected {expected.GetRawText()}, actual [{string.Join(", ", actual)}]");
    }
    static string S(JsonElement e, string k) => e.GetProperty(k).GetString() ?? "";
    static string? SN(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static int I(JsonElement e, string k) => e.GetProperty(k).GetInt32();
    static double D(JsonElement e, string k) => e.GetProperty(k).GetDouble();

    static void CheckOutcome(string label, Gen2OutcomeReport o, JsonElement exp)
    {
        Check(label + ": added", o.Added == exp.GetProperty("added").GetBoolean(), o.Added.ToString());
        CheckStr(label + ": refused", o.Refused, exp.GetProperty("refused"));
        CheckIntN(label + ": hit bin", o.HitBin, exp.GetProperty("hitBin"));
        CheckNumN(label + ": implied correction", o.Implied, exp.GetProperty("implied"));
        CheckNumN(label + ": new correction", o.NewCorrection, exp.GetProperty("newCorrection"));
        CheckInts(label + ": candidate bins", o.Candidates.Select(c => c.Bin).ToList(), exp.GetProperty("candidateBins"));
        CheckLines(label + ": elsewhere", o.Elsewhere.Select(c => c.Table + "/" + c.Bin).ToList(), exp.GetProperty("elsewhere"));
        CheckLines(label + ": lines", o.Lines, exp.GetProperty("lines"));
    }
    static void CheckStore(string label, Dictionary<string, Gen2CalEntry> cal, JsonElement exp)
    {
        var keys = exp.EnumerateObject().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToList();
        Check(label + ": store keys", keys.SequenceEqual(cal.Keys.OrderBy(x => x, StringComparer.Ordinal)), string.Join(",", cal.Keys));
        foreach (var k in keys)
        {
            if (!cal.TryGetValue(k, out var entry)) continue;
            var samples = exp.GetProperty(k).GetProperty("samples").EnumerateArray().ToList();
            Check($"{label}: {k} has {samples.Count} samples", entry.Samples.Count == samples.Count, entry.Samples.Count.ToString());
            for (int i = 0; i < Math.Min(samples.Count, entry.Samples.Count); i++)
            {
                var e = samples[i];
                var a = entry.Samples[i];
                string sl = $"{label}: {k} sample {i}";
                Check(sl + " ids and bins", a.Tid == I(e, "tid") && a.AimedBin == I(e, "aimed_bin") && a.HitBin == I(e, "hit_bin") &&
                    (e.GetProperty("lid").ValueKind == JsonValueKind.Null ? a.Lid is null : a.Lid == I(e, "lid")), $"{a.Tid} {a.Lid} {a.AimedBin} {a.HitBin}");
                Check(sl + " offsets and corrections", Near(a.Aimed, D(e, "aimed")) && Near(a.Hit, D(e, "hit")) && Near(a.CorrectionUsedMs, D(e, "correction_used_ms")) && Near(a.ImpliedMs, D(e, "implied_ms")),
                    $"{a.Aimed} {a.Hit} {a.CorrectionUsedMs} {a.ImpliedMs:R}");
                Check(sl + " state, methodology, attempt, player, when, mode", a.State == S(e, "state") && a.Methodology == S(e, "methodology") && a.Attempt == SN(e, "attempt") &&
                    a.Player == SN(e, "player") && a.When == SN(e, "when") && a.Mode == SN(e, "mode"), $"{a.State} {a.Methodology} {a.Attempt} {a.Player} {a.When} {a.Mode}");
            }
        }
    }

    public static int Run(string vectorsPath, string? citationsPath = null)
    {
        var V = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;
        var data = Gen2TidData.LoadEmbedded();
        var data1 = Gen1TidData.LoadEmbedded();
        // the decomp citation registry the footnotes are rendered over: the embedded copy, or the file given
        // (app/run-core-tests.sh passes a copy without the 4-frame poll entry as its negative control)
        Citations.LoadCitations(citationsPath);
        Check("the citation registry is loaded", Citations.Loaded, "no registry");
        string when = S(V, "when"), player = S(V, "player");
        var cases = V.GetProperty("cases").EnumerateArray().ToList();
        Check("20 target inputs", cases.Count == 20, cases.Count.ToString());

        int n = 0;
        foreach (var c in cases)
        {
            var inp = c.GetProperty("input");
            string label = $"case {n++} {S(inp, "game")}/{S(inp, "platform")}/{S(inp, "state")}/{S(inp, "anchor")} bin {I(inp, "bin")}";
            Gen2Platform plat;
            try
            {
                plat = Gen2Platform.Resolve(data, data1, S(inp, "game"), S(inp, "platform"), SN(inp, "methodology"), S(inp, "state"), null);
            }
            catch (ArgumentException e)
            {
                CheckStr(label + ": resolve error", e.Message, c.TryGetProperty("resolveError", out var re) ? re : default);
                continue;
            }
            Check(label + ": resolves in both heads", !c.TryGetProperty("resolveError", out _));
            CheckStr(label + ": methodology", plat.MethodologyId, c.GetProperty("methodologyId"));
            Check(label + ": reachability", plat.Reachable == c.GetProperty("reachable").GetBoolean());
            CheckStr(label + ": outcome scope", plat.OutcomeState(), c.GetProperty("outcomeState"));
            int bin = I(inp, "bin");
            Gen2TidText.BinInfo info;
            try { info = Gen2TidText.Info(plat, bin); }
            catch (ArgumentException e)
            {
                CheckStr(label + ": bin error", e.Message, c.TryGetProperty("binError", out var be) ? be : default);
                continue;
            }
            Check(label + ": bin resolves in both heads", !c.TryGetProperty("binError", out _));
            var bi = c.GetProperty("binInfo");
            Check(label + ": bin ids", info.Tid == I(bi, "tid") && info.Lid == I(bi, "lid") && (bi.GetProperty("sid").ValueKind == JsonValueKind.Null ? info.Sid is null : info.Sid == I(bi, "sid")), $"{info.Tid} {info.Lid} {info.Sid}");
            CheckInts(label + ": bin offsets", info.Offsets, bi.GetProperty("offsets"));
            CheckInts(label + ": bin visible window", info.Visible, bi.GetProperty("visible"));
            CheckNum(label + ": aim", info.Lookup.Aim, bi.GetProperty("aim"));
            CheckNum(label + ": aim after the visible menu", info.AimV, bi.GetProperty("aimV"));
            CheckNum(label + ": aim seconds", info.AimS, bi.GetProperty("aimS"));
            CheckNum(label + ": after power-on seconds", info.AfterPowerOnS, bi.GetProperty("afterPowerOnS"));
            CheckStr(label + ": describeBin", Gen2TidText.DescribeBin(plat, bin), c.GetProperty("describeBin"));
            string anchor = S(inp, "anchor");
            double corr = D(inp, "correctionMs"), spacing = D(inp, "spacingS");
            int beeps = I(inp, "beeps");
            Gen2Schedule sched;
            try { sched = Gen2TidText.BuildSchedule(plat, anchor, bin, corr, beeps, spacing); }
            catch (ArgumentException e)
            {
                CheckStr(label + ": schedule error", e.Message, c.TryGetProperty("scheduleError", out var se) ? se : default);
                continue;
            }
            Check(label + ": schedule builds in both heads", !c.TryGetProperty("scheduleError", out _));
            var es = c.GetProperty("schedule");
            CheckStr(label + ": schedule anchor", sched.Anchor, es.GetProperty("anchor"));
            CheckNum(label + ": A cue time", sched.TA, es.GetProperty("tA"));
            CheckNumN(label + ": hold lo", sched.HoldLo, es.GetProperty("holdLo"));
            CheckNumN(label + ": hold hi", sched.HoldHi, es.GetProperty("holdHi"));
            CheckNumN(label + ": menu", sched.Menu, es.GetProperty("menu"));
            Check(label + ": dropped count-in", sched.DroppedCountIn == I(es, "droppedCountIn"), sched.DroppedCountIn.ToString());
            CheckNums(label + ": count-in times", sched.CountInTimes, es.GetProperty("countInTimes"));
            CheckNum(label + ": duration", sched.Duration, es.GetProperty("duration"));
            var cues = es.GetProperty("cues").EnumerateArray().ToList();
            Check(label + ": cue count", cues.Count == sched.Cues.Count, sched.Cues.Count.ToString());
            for (int i = 0; i < Math.Min(cues.Count, sched.Cues.Count); i++)
            {
                var e = cues[i];
                var a = sched.Cues[i];
                Check($"{label}: cue {i} {a.Label}", Near(a.T, D(e, "t")) && Near(a.Freq, D(e, "freq")) && Near(a.Ms, D(e, "ms")) && a.Label == S(e, "label") && a.Kind == S(e, "kind"), $"{a.T:R} {a.Freq} {a.Ms} {a.Label} {a.Kind}");
            }
            Check(label + ": schedule bin", sched.Bin == I(es, "bin"));
            CheckNum(label + ": schedule aim offset", sched.AimOffset, es.GetProperty("aimOffset"));
            CheckNum(label + ": schedule aim after the visible menu", sched.AimV, es.GetProperty("aimV"));
            CheckNums(label + ": A window", sched.AWindow, es.GetProperty("aWindow"));
            CheckNums(label + ": tap ms", sched.TapMs, es.GetProperty("tapMs"));
            CheckNum(label + ": roll settle", sched.RollSettleS, es.GetProperty("rollSettleS"));
            CheckStr(label + ": schedule methodology", sched.Methodology, es.GetProperty("methodology"));
            CheckLines(label + ": schedule lines", Gen2TidText.ScheduleLines(sched, bin, corr, plat), c.GetProperty("scheduleLines"));
            var protocol = Gen2TidText.ProtocolLines(plat, anchor, bin, sched, corr, beeps, spacing);
            CheckLines(label + ": protocol lines", protocol, c.GetProperty("protocolLines"));
            // the footnotes: every protocol carries its Sources block with at least one footnote, the console's status
            // word on the tables' roll (EMULATOR-EXACT on GSE, EMPIRICAL elsewhere: no hardware sample), the 4-frame poll
            // and the wPlayerID roll under their FACTS.md sections, and no citation outside the registry
            string statusWord = Gen2TidText.StatusWord(plat);
            Check(label + ": the protocol lists its sources", protocol.Contains(Citations.Header + Citations.StatusNote) && protocol.Count(l => l.StartsWith("  [^")) >= 8, protocol.Count.ToString());
            Check(label + ": the status word is the console's", statusWord == (S(inp, "platform") == "gse" ? "EMULATOR-EXACT" : "EMPIRICAL") && protocol.Any(l => l.StartsWith("  [^3] " + statusWord + " (no decomp line; the tables' derivation on pokemon-speedrunning/gambatte-core, ")), statusWord);
            Check(label + ": the poll and the ID roll are registry lines", protocol.Any(l => l.StartsWith("  [^2] poke") && l.Contains("/engine/menus/main_menu.asm:") && l.Contains(" (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 2 Trainer ID / Lucky ID / The boot path with START held, and the 4-frame poll): MainMenuJoypadLoop"))
                && protocol.Any(l => l.StartsWith("  [^4] poke") && l.Contains("/engine/menus/intro_menu.asm:") && l.Contains("Where the IDs come from): NewGame -> _ResetWRAM writes wPlayerID")));
            Check(label + ": no footnote outside the registry", Citations.ProcedureProblems(protocol).Count == 0, string.Join("\n", Citations.ProcedureProblems(protocol)));
            Check(label + ": the target line carries the poll and roll footnotes", Regex.IsMatch(Gen2TidText.DescribeBin(plat, bin), plat.HasSid ? @" \[\^2\] \[\^4\] \[\^9\]$" : @" \[\^2\] \[\^4\]$"));
            // the typed outcome into an empty store in RUN mode
            var cal = new Dictionary<string, Gen2CalEntry>();
            var o = Gen2TidText.RecordOutcome(cal, plat, anchor, bin, corr, I(c, "typedTid"), null, false, "a1", Modes.Run, when, player);
            CheckOutcome(label + ": outcome", o, c.GetProperty("outcome"));
            CheckStore(label + ": store", cal, c.GetProperty("store"));
        }

        // the guards and the store split on the first input (Gold on GSE, bin 300)
        {
            var g = V.GetProperty("guards");
            var inp = cases[0].GetProperty("input");
            var plat = Gen2Platform.Resolve(data, data1, S(inp, "game"), S(inp, "platform"), null, S(inp, "state"), null);
            int TidAt(int b) => Gen2Tid.Lookup(data, plat.GameKey, plat.PlatformKey, plat.State, b).Tid;
            var cal = new Dictionary<string, Gen2CalEntry>();
            CheckOutcome("guards: first", Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(302), null, false, "a1", Modes.Run, when, player), g.GetProperty("first"));
            var dup = Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(302), null, false, "a1", Modes.Run, when, player);
            CheckOutcome("guards: duplicate", dup, g.GetProperty("duplicate"));
            Check("guards: the duplicate guard (Gen1Tid.IsDuplicate over the Gen 2 store) refused it", dup.Refused == "duplicate" && !dup.Added && cal["gse/menu"].Samples.Count == 1);
            CheckOutcome("guards: forced duplicate", Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(302), null, true, "a1", Modes.Run, when, player), g.GetProperty("forced"));
            var edge = Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(315), null, false, "a2", Modes.Run, when, player);
            CheckOutcome("guards: 15 bins (60 frames) is not an outlier", edge, g.GetProperty("edge"));
            Check("guards: the edge sample was added", edge.Added && edge.HitBin == 315 && !Gen2Tid.IsOutlierBins(plat.Rule, 315, 300));
            var outlier = Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(316), null, false, "a3", Modes.Run, when, player);
            CheckOutcome("guards: 16 bins (64 frames) is an outlier", outlier, g.GetProperty("outlier"));
            Check("guards: the bin guard (Gen2Tid.IsOutlierBins) refused it and the store is unchanged", outlier.Refused == "outlier" && !outlier.Added && Gen2Tid.IsOutlierBins(plat.Rule, 316, 300) && cal["gse/menu"].Samples.Count == 3);
            Check("guards: the outlier text names the bin count", outlier.Lines.Any(l => l.Contains("more than 60 frames (15 bins, 1.0 s) from the aim")));
            CheckOutcome("guards: forced outlier", Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(316), null, true, "a3", Modes.Run, when, player), g.GetProperty("outlierForced"));
            var practice = Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, TidAt(310), null, false, "p1", Modes.Practice, when, player);
            CheckOutcome("guards: a practice-stamped sample into the same store", practice, g.GetProperty("practiceIntoSameStore"));
            CheckStore("guards: store", cal, g.GetProperty("store"));
            Check("guards: RUN samples in force", Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Run).Count == I(g, "runSamples"));
            Check("guards: PRACTICE / HUNT samples in force", Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Practice).Count == I(g, "practiceSamples"));
            CheckNum("guards: RUN correction (the practice sample never averaged in)", Gen2TidText.CorrectionInForce(cal, plat, "menu", Modes.Run), g.GetProperty("runCorrection"));
            CheckNum("guards: PRACTICE / HUNT correction (the practice sample alone)", Gen2TidText.CorrectionInForce(cal, plat, "menu", Modes.Practice), g.GetProperty("practiceCorrection"));
            var runSamples = Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Run);
            Check("guards: every RUN sample in force was made in RUN", runSamples.All(s => s.Mode == Modes.Run) && runSamples.Count == 4);
            Check("guards: the practice sample is stamped practice", cal["gse/menu"].Samples.Last().Mode == Modes.Practice);
            Check("guards: the RUN mean is over the RUN samples only", Near(Gen2TidText.CorrectionInForce(cal, plat, "menu", Modes.Run), runSamples.Average(s => s.ImpliedMs)));
            CheckLines("guards: RUN ignore note", Gen2TidText.IgnoredSampleLines(cal, plat, "menu", Modes.Run), g.GetProperty("runIgnoredLines"));
            CheckLines("guards: PRACTICE / HUNT ignore note", Gen2TidText.IgnoredSampleLines(cal, plat, "menu", Modes.Practice), g.GetProperty("practiceIgnoredLines"));
            CheckLines("guards: RUN stats", Gen2TidText.StatsLines(runSamples, plat, "menu", Modes.Run), g.GetProperty("runStats"));
            CheckStr("guards: P(hit) summary", Gen2TidText.HitSummary(runSamples, "menu", plat.MethodologyId).Line, g.GetProperty("hitSummary"));
            var dropped = Gen2TidText.DropLastSample(cal, plat, "menu", Modes.Run);
            CheckIntN("guards: drop last (RUN) drops the newest RUN sample, not the practice one", dropped?.HitBin, g.GetProperty("droppedHitBin"));
            var ad = g.GetProperty("afterDrop");
            Check("guards: after the drop", Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Run).Count == I(ad, "run") && Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Practice).Count == I(ad, "practice"));
            var (removed, kept) = Gen2TidText.ClearSamples(cal, plat, "menu", Modes.Run);
            var ac = g.GetProperty("afterClear");
            Check("guards: clear (RUN) keeps the practice sample", removed == I(ac, "removed") && kept == I(ac, "kept") && Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Practice).Count == I(ac, "practice"), $"{removed} {kept}");
            var sk = g.GetProperty("storeKeys");
            Check("guards: the web store keys follow the mode", S(sk, "run") == "shinySolution.gen2tid.calibration" && S(sk, "practice") == "shinySolution.gen2tid.calibration.practice");
            Check("guards: the desktop setting keys follow the mode the same way", Modes.StoreKey(Gen2TidText.CalKeySetting, Modes.Run) == "gen2tid.calibration" && Modes.StoreKey(Gen2TidText.CalKeySetting, Modes.Practice) == "gen2tid.calibration.practice");
            CheckOutcome("guards: a first-boot-only outcome teaches nothing and says where it is produced", Gen2TidText.RecordOutcome(new(), plat, "menu", 300, 200, 0x6F53, 0x03E9, false, "e1", Modes.Run, when, player), g.GetProperty("elsewhere"));
            CheckLines("guards: invert (every state)", Gen2TidText.InvertLines(plat, 0x6F53, 0x03E9, "all", null).Lines, g.GetProperty("invertAll"));
            CheckLines("guards: invert (the two-state prior)", Gen2TidText.InvertLines(plat, TidAt(300), null, "prior", null).Lines, g.GetProperty("invertPrior"));
            CheckLines("guards: verify consistent", Gen2TidText.VerifyLines(plat, TidAt(300), null, 20.13).Lines, g.GetProperty("verifyConsistent"));
            CheckLines("guards: verify inconsistent", Gen2TidText.VerifyLines(plat, TidAt(300), null, 22.13).Lines, g.GetProperty("verifyInconsistent"));
            CheckLines("guards: target set lines", Gen2TidText.TargetSetLines(plat), g.GetProperty("targetSetLines"));
            CheckLines("guards: reachability lines", Gen2Platform.ReachabilityLines(data, "gold"), g.GetProperty("reachabilityLines"));
            CheckLines("guards: methodology lines with the validity conditions", Gen2TidText.MethodologyLines(plat, true, ""), g.GetProperty("methodologyLines"));
            CheckLines("guards: RTC state options", Gen2Platform.StateOptions(data, "gold").Select(s => s.Value + "|" + s.Text).ToList(), g.GetProperty("stateOptions"));
        }

        // A stored record whose mode this head does not know (a typo, a value a later hunt head writes): in force in neither
        // mode, named in the note, and the panel's text still renders; a record without a mode is a RUN record.
        {
            var plat = Gen2Platform.Resolve(data, data1, "gold", "gse", null, "days0", null);
            var cal = new Dictionary<string, Gen2CalEntry>();
            Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, Gen2Tid.Lookup(data, "gold", "gbp", "days0", 302).Tid, null, false, "r1", Modes.Run, when, player);
            var planted = JsonSerializer.Deserialize<Gen2CalSample>(JsonSerializer.Serialize(cal["gse/menu"].Samples[0]))!;
            planted.Mode = "hunt"; planted.Attempt = "h1"; planted.HitBin = 310; planted.ImpliedMs = 900;
            var old = JsonSerializer.Deserialize<Gen2CalSample>(JsonSerializer.Serialize(cal["gse/menu"].Samples[0]))!;
            old.Mode = null; old.Attempt = "o1";
            cal["gse/menu"].Samples.Add(planted);
            cal["gse/menu"].Samples.Add(old);
            Check("unknown mode: in force in neither mode; the mode-less record counts as RUN", Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Run).Count == 2 && Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Practice).Count == 0);
            string note = string.Join("\n", Gen2TidText.IgnoredSampleLines(cal, plat, "menu", Modes.Run));
            Check("unknown mode: the RUN note names it", note.Contains("recorded in \"hunt\" (unknown mode) mode, not RUN"), note);
            string pnote = string.Join("\n", Gen2TidText.IgnoredSampleLines(cal, plat, "menu", Modes.Practice));
            Check("unknown mode: the PRACTICE / HUNT note names both", pnote.Contains("3 stored samples") && pnote.Contains("\"hunt\" (unknown mode), RUN mode"), pnote);
            string? err = null;
            try { Gen2TidText.StatsLines(Gen2TidText.SamplesFor(cal, plat, "menu", Modes.Run), plat, "menu", Modes.Run); } catch (Exception e) { err = e.Message; }
            Check("unknown mode: the stats still render", err is null, err ?? "");
            Check("a record must say its mode", Throws(() => Gen2TidText.RecordOutcome(cal, plat, "menu", 300, 200, 1, null, false, "x", "hunt", when, player)));
            Check("the outcome is refused for a mode this head does not know before anything is read", Throws(() => Gen2TidText.SamplesFor(cal, plat, "menu", "")));
        }

        // The fixed texts every output rests on.
        Check("the no-hardware statement", Gen2TidText.NoHardwareLine.StartsWith("No hardware sample exists for any Gen 2 configuration"));
        Check("the methodology sentence is the Gen 1 one", Gen2TidText.MethodologySentence == "Predictions are valid only under this methodology.");
        Check("the rules line names the typed outcome", Gen2TidText.RulesLine.Contains("type the Trainer ID (and the Lucky ID) you saw") && Gen2TidText.RulesLine.Contains("Nothing reads the screen"));

        Console.WriteLine($"gen2tid panel (C#): {checks} checks, {failures} failure{(failures == 1 ? "" : "s")}");
        return failures > 0 ? 1 : 0;
    }

    static bool Throws(Action a) { try { a(); return false; } catch (ArgumentException) { return true; } }
}
