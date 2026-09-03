using System.Text.Json;
using ShinySolution.Core;

// The RUN / PRACTICE-HUNT wall's pure part (Core's Modes over Gen1Tid's calibration maths, the
// composition the desktop app's Gen 1 TID panel performs through Gen1TidText.SamplesFor) on
// tests/mode-wall-fixture.json: the correction in force in RUN mode is the mean of the RUN samples
// only, the practice sample is left out, and the other way round in PRACTICE / HUNT mode; the two
// modes' store keys differ; a record without a mode is a RUN record; an unknown mode is refused.
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

        var fx = JsonDocument.Parse(File.ReadAllText(fixturePath)).RootElement;
        string mid = fx.GetProperty("methodology").GetString()!;
        string key = fx.GetProperty("platform").GetString() + "/" + fx.GetProperty("anchor").GetString();
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

        Console.WriteLine($"mode wall (C#): {checks} checks, {failures} failure{(failures == 1 ? "" : "s")}");
        return failures > 0 ? 1 : 0;
    }
}
