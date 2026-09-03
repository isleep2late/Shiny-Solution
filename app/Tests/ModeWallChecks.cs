using System.Text.Json;
using ShinySolution.App;
using ShinySolution.Core;

// The RUN / PRACTICE-HUNT wall in the desktop app's Gen 1 TID panel: Core's Modes over Gen1Tid's
// calibration maths, and the composition the panel performs through Gen1TidText (app/App/
// Gen1TidSupport.cs, compiled into this project), on tests/mode-wall-fixture.json: the correction in
// force in RUN mode is the mean of the RUN samples only, the practice sample is left out and named,
// and the other way round in PRACTICE / HUNT mode; the two modes' store keys differ; a record without
// a mode is a RUN record; an unknown mode is refused where a mode is chosen, and a stored record whose
// mode this head does not know is in force in neither mode and breaks nothing (named as unknown in the
// note); the remembered reset adjustment and the Secret ID pins follow the mode the same way.
// app/run-core-tests.sh runs it on the committed fixture, then on a corrupted copy that must fail.
static class ModeWallChecks
{
    sealed class Rec
    {
        public Sample Sample = new();
        public string? Mode;
    }

    public static int Run(string fixturePath)
    {
        int failures = 0, checks = 0;
        void Check(string label, bool ok, string detail = "")
        {
            checks++;
            if (ok) return;
            failures++;
            Console.Error.WriteLine("FAIL " + label + (detail == "" ? "" : "\n  " + detail));
        }
        static bool Throws(Action a) { try { a(); return false; } catch (ArgumentException) { return true; } }
        static string? Fails(Action a) { try { a(); return null; } catch (Exception e) { return e.GetType().Name + ": " + e.Message; } }

        var fx = JsonDocument.Parse(File.ReadAllText(fixturePath)).RootElement;
        string mid = fx.GetProperty("methodology").GetString()!;
        string platformKey = fx.GetProperty("platform").GetString()!, anchor = fx.GetProperty("anchor").GetString()!;
        string key = platformKey + "/" + anchor;
        var recs = fx.GetProperty("store").GetProperty(key).GetProperty("samples").EnumerateArray().Select(e => new Rec
        {
            Sample = JsonSerializer.Deserialize<Sample>(e.GetRawText())!,
            Mode = e.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null
        }).ToList();
        Check("fixture has samples", recs.Count > 0);

        foreach (var mode in new[] { Modes.Run, Modes.Practice })
        {
            var exp = fx.GetProperty("expected").GetProperty(mode);
            string label = Modes.Label(mode);
            var underMethodology = recs.Where(r => r.Sample.Methodology == mid).ToList();
            var (kept, others) = Modes.SplitByMode(underMethodology, r => r.Mode, mode);
            Check($"{label}: {exp.GetProperty("n").GetInt32()} sample(s) in force", kept.Count == exp.GetProperty("n").GetInt32(),
                string.Join(",", kept.Select(r => r.Mode ?? "null")));
            Check($"{label}: every sample in force was made in this mode", kept.All(r => Modes.Effective(r.Mode) == mode));
            double corr = Gen1Tid.MeanCorrection(kept.Select(r => r.Sample), -1);
            double expCorr = exp.GetProperty("correction_ms").GetDouble();
            Check($"{label}: correction in force {expCorr} ms", Math.Abs(corr - expCorr) <= 1e-6, corr.ToString("R"));
            Check($"{label}: {exp.GetProperty("ignored_by_mode").GetInt32()} sample(s) ignored for their mode",
                others.Count == exp.GetProperty("ignored_by_mode").GetInt32(), string.Join(",", others.Select(r => r.Mode ?? "null")));
            Check($"{label}: none of the ignored was made in this mode", others.All(r => Modes.Effective(r.Mode) != mode));
        }

        Check("the RUN store key is the one that always existed", Modes.StoreKey("gen1tid.calibration", Modes.Run) == "gen1tid.calibration");
        Check("the PRACTICE / HUNT store key is its own", Modes.StoreKey("gen1tid.calibration", Modes.Practice) == "gen1tid.calibration.practice");
        Check("a record without a mode is a RUN record", Modes.Effective(null) == Modes.Run);
        Check("a practice record is not", Modes.Effective("practice") == Modes.Practice);
        Check("an unknown mode is refused", Throws(() => Modes.Check("hunt")) && Throws(() => Modes.StoreKey("x", "")) && Throws(() => Modes.Label(null)));
        Check("the banner text", Modes.Banner == "PRACTICE / HUNT mode - tools that read the capture are enabled; not for submitted runs");

        // The composition the panel performs (Gen1TidText over the same store): the same numbers and the notes.
        var data = Gen1TidData.LoadEmbedded();
        var plat = Gen1Platform.Resolve(data, "red", platformKey, mid, null);
        Dictionary<string, CalEntry> Store() => JsonSerializer.Deserialize<Dictionary<string, CalEntry>>(fx.GetProperty("store").GetRawText())!;
        foreach (var mode in new[] { Modes.Run, Modes.Practice })
        {
            var exp = fx.GetProperty("expected").GetProperty(mode);
            var cal = Store();
            Check($"{Modes.Label(mode)}: Gen1TidText.SamplesFor agrees with the fixture", Gen1TidText.SamplesFor(cal, plat, anchor, mode).Count == exp.GetProperty("n").GetInt32());
            Check($"{Modes.Label(mode)}: Gen1TidText.CorrectionInForce agrees", Math.Abs(Gen1TidText.CorrectionInForce(cal, plat, anchor, mode) - exp.GetProperty("correction_ms").GetDouble()) <= 1e-6);
            string note = string.Join("\n", Gen1TidText.IgnoredSampleLines(cal, plat, anchor, mode));
            Check($"{Modes.Label(mode)}: the ignore note says so", note.Contains(exp.GetProperty("note_contains").GetString()!) && note.Contains("never mixed across modes"), note);
        }

        // A stored record whose mode this head does not know (a typo, an empty string, a value a later hunt head
        // writes): in force in neither mode, and the panel still renders (the note names it instead of throwing).
        foreach (var bad in new[] { "hunt", "" })
        {
            string shown = "\"" + bad + "\" (unknown mode)";
            Check($"mode {shown}: Describe names it without throwing", Fails(() => Modes.Describe(bad)) is null && Modes.Describe(bad) == shown);
            var cal = Store();
            var extra = JsonSerializer.Deserialize<CalSample>(fx.GetProperty("store").GetProperty(key).GetProperty("samples")[2].GetRawText())!;
            extra.Mode = bad; extra.Attempt = "x1";
            cal[key].Samples.Add(extra);
            foreach (var mode in new[] { Modes.Run, Modes.Practice })
            {
                var exp = fx.GetProperty("expected").GetProperty(mode);
                Check($"mode {shown}: in force in neither mode ({Modes.Label(mode)} keeps {exp.GetProperty("n").GetInt32()})", Gen1TidText.SamplesFor(cal, plat, anchor, mode).Count == exp.GetProperty("n").GetInt32());
                List<string>? lines = null;
                string? err = Fails(() => lines = Gen1TidText.IgnoredSampleLines(cal, plat, anchor, mode));
                Check($"mode {shown}: IgnoredSampleLines returns in {Modes.Label(mode)}", err is null, err ?? "");
                Check($"mode {shown}: the {Modes.Label(mode)} note names the record as unknown", lines is not null && string.Join("\n", lines).Contains(shown), lines is null ? "" : string.Join("\n", lines));
                err = Fails(() => Gen1TidText.StatsLines(Gen1TidText.SamplesFor(cal, plat, anchor, mode), Gen1TidText.AllSamples(cal, plat.Key, anchor), plat, anchor, mode));
                Check($"mode {shown}: StatsLines still renders in {Modes.Label(mode)}", err is null, err ?? "");
            }
            OutcomeReport? r = null;
            string? recErr = Fails(() => r = Gen1TidText.RecordOutcome(cal, plat, anchor, 358, 200, plat.Table[362], false, "n", Modes.Run));
            Check($"mode {shown}: RecordOutcome in RUN still returns", recErr is null, recErr ?? "");
            Check($"mode {shown}: ... and adds the sample", r is { Added: true, Hit: 362 });
        }

        // The remembered reset adjustment follows the mode: its own setting key, every record stamped, a record of the
        // other mode in a store never applied and named; a bare number from before modes is a RUN record.
        {
            Check("the reset adjustment setting key follows the mode", Modes.StoreKey("gen1tid.resetAdjust", Modes.Run) == "gen1tid.resetAdjust" && Modes.StoreKey("gen1tid.resetAdjust", Modes.Practice) == "gen1tid.resetAdjust.practice");
            Check("the pin setting key follows the mode", Modes.StoreKey("gen1tid.sidPins", Modes.Run) == "gen1tid.sidPins" && Modes.StoreKey("gen1tid.sidPins", Modes.Practice) == "gen1tid.sidPins.practice");
            var raw = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>("{\"gse\": 1.5, \"dmg\": {\"frames\": 2, \"mode\": \"practice\", \"when\": \"x\"}, \"gbp\": {\"frames\": -1, \"mode\": \"hunt\"}}")!;
            var adj = Gen1TidText.ParseResetAdjust(raw);
            Check("all three records parsed", adj.Count == 3, adj.Count.ToString());
            var gseRun = Gen1TidText.ResetAdjustFor(adj, "gse", Modes.Run);
            Check("a bare-number adjustment (before modes) is a RUN record", gseRun.Frames == 1.5 && gseRun.Ignored is null);
            var gsePractice = Gen1TidText.ResetAdjustFor(adj, "gse", Modes.Practice);
            Check("... and not a PRACTICE / HUNT one", gsePractice.Frames == 0 && gsePractice.Ignored is not null);
            var dmgRun = Gen1TidText.ResetAdjustFor(adj, "dmg", Modes.Run);
            Check("a practice adjustment in the RUN store is not applied", dmgRun.Frames == 0 && dmgRun.Ignored is { Frames: 2 });
            Check("... and the note says so", dmgRun.Ignored is not null && Gen1TidText.ResetAdjustIgnoredLine(dmgRun.Ignored, "dmg", Modes.Run).Contains("recorded in PRACTICE / HUNT mode, not RUN"));
            var dmgPractice = Gen1TidText.ResetAdjustFor(adj, "dmg", Modes.Practice);
            Check("a practice adjustment is applied in PRACTICE / HUNT", dmgPractice.Frames == 2 && dmgPractice.Ignored is null);
            Check("an adjustment of an unknown mode is applied in neither mode and named",
                Gen1TidText.ResetAdjustFor(adj, "gbp", Modes.Run).Frames == 0 && Gen1TidText.ResetAdjustFor(adj, "gbp", Modes.Practice).Frames == 0 &&
                Gen1TidText.ResetAdjustIgnoredLine(adj["gbp"], "gbp", Modes.Run).Contains("\"hunt\" (unknown mode)"));
            var none = Gen1TidText.ResetAdjustFor(adj, "sp", Modes.Run);
            Check("no adjustment stored: 0, nothing ignored", none.Frames == 0 && none.Ignored is null);
            var saved = Gen1TidText.SetResetAdjust(adj, "gse", 3, Modes.Practice);
            Check("a saved adjustment is stamped with the mode", saved.Mode == Modes.Practice && saved.Frames == 3 && Gen1TidText.ResetAdjustFor(adj, "gse", Modes.Run).Frames == 0);
            Check("an adjustment must say its mode", Throws(() => Gen1TidText.SetResetAdjust(adj, "gse", 1, "hunt")));
            Check("an empty settings value parses to no adjustments", Gen1TidText.ParseResetAdjust(null).Count == 0);
        }

        // The Secret ID pins follow the mode the same way.
        {
            var pins = new Dictionary<string, List<PinRecord>>();
            Gen1TidText.AddPin(pins, "m", 9572, 0x12345678, false, "practice", Modes.Practice);
            Check("a pin is stamped with the mode", Gen1TidText.AllPins(pins, "m", 9572) is [{ Mode: "practice" }]);
            Check("a practice pin in the store is not used in RUN", Gen1TidText.PinsFor(pins, "m", 9572, Modes.Run).Count == 0 && Gen1TidText.IgnoredPins(pins, "m", 9572, Modes.Run).Count == 1);
            Check("... and is used in PRACTICE / HUNT", Gen1TidText.PinsFor(pins, "m", 9572, Modes.Practice).Count == 1 && Gen1TidText.IgnoredPins(pins, "m", 9572, Modes.Practice).Count == 0);
            Check("... and the RUN listing names it", string.Join("\n", Gen1TidText.PinLines(new List<PinRecord>(), "m", 9572, Modes.Run, Gen1TidText.IgnoredPins(pins, "m", 9572, Modes.Run)))
                .Contains("1 stored pin for m / Trainer ID 9572 ignored: recorded in PRACTICE / HUNT mode, not RUN"));
            string? other = Fails(() => Gen1TidText.AddPin(pins, "m", 9572, 0x12345678, true, "run", Modes.Run));
            Check("the same PID pinned the other way in RUN does not collide with the practice pin", other is null && Gen1TidText.AllPins(pins, "m", 9572).Count == 2 && Gen1TidText.PinsFor(pins, "m", 9572, Modes.Run)[0].Shiny, other ?? "");
            Check("clearing in RUN keeps the practice pin", Gen1TidText.ClearPins(pins, "m", 9572, Modes.Run) == (1, 1) && Gen1TidText.AllPins(pins, "m", 9572) is [{ Mode: "practice" }]);
            Check("a pin must say its mode", Throws(() => Gen1TidText.AddPin(pins, "m", 1, 1, true, "", "hunt")));
        }

        Console.WriteLine($"mode wall (C#): {checks} checks, {failures} failure{(failures == 1 ? "" : "s")}");
        return failures > 0 ? 1 : 0;
    }
}
