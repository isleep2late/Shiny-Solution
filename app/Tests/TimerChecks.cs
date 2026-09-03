using System.Text.Json;
using ShinySolution.Core;

// C# side of the timer-model verification:
//   --check-timer-vectors tests/timer-vectors.json   every vector (values from EonTimer's own TS)
//   --emit-timer-parity  tests/timer-parity.json N   N random parameter sets + C# results, for
//                                                    node tests/test-timers.cjs to recompute
public static class TimerChecks
{
    static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = false };

    static TimerSettings Settings(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Null || e.ValueKind == JsonValueKind.Undefined) return Timers.DefaultSettings;
        return new TimerSettings(
            Timers.ParseConsole(e.GetProperty("console").GetString()!),
            e.GetProperty("customFps").GetDouble(),
            e.GetProperty("precisionCalibration").GetBoolean(),
            e.GetProperty("minimumLengthMs").GetDouble());
    }

    static double Num(JsonElement e) => e.ValueKind == JsonValueKind.String && e.GetString() == "Infinity"
        ? double.PositiveInfinity : e.GetDouble();

    static double? OptNum(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : Num(e);

    static double[] Nums(JsonElement e) => e.EnumerateArray().Select(Num).ToArray();

    static Gen3Model Gen3(JsonElement m) => new(Timers.ParseGen3Mode(m.GetProperty("mode").GetString()!),
        Num(m.GetProperty("preTimer")), Num(m.GetProperty("targetFrame")), Num(m.GetProperty("calibration")));

    static Gen4Model Gen4(JsonElement m) => new(Num(m.GetProperty("targetDelay")), Num(m.GetProperty("targetSecond")),
        Num(m.GetProperty("calibratedDelay")), Num(m.GetProperty("calibratedSecond")));

    static Gen5Model Gen5(JsonElement m) => new(Timers.ParseGen5Mode(m.GetProperty("mode").GetString()!),
        Num(m.GetProperty("calibration")), Num(m.GetProperty("frameCalibration")), Num(m.GetProperty("entralinkCalibration")),
        Num(m.GetProperty("targetDelay")), Num(m.GetProperty("targetSecond")), Num(m.GetProperty("targetAdvances")));

    static Gen5Hits Hits(JsonElement h) => new(
        h.TryGetProperty("delayHit", out var d) ? OptNum(d) : null,
        h.TryGetProperty("secondHit", out var s) ? OptNum(s) : null,
        h.TryGetProperty("advancesHit", out var a) ? OptNum(a) : null);

    static CustomPhase Phase(JsonElement p) => new(Timers.ParseCustomUnit(p.GetProperty("unit").GetString()!),
        Num(p.GetProperty("target")), Num(p.GetProperty("calibration")));

    static CustomPhase[] Phases(JsonElement e) => e.EnumerateArray().Select(Phase).ToArray();

    // Wire encodings shared with core/timers.js (Infinity -> "Infinity", camelCase names).
    static object J(double d) => double.IsPositiveInfinity(d) ? "Infinity" : d;
    static object J(double[] a) => a.Select(J).ToArray();
    static object J(Gen5CalibrationResult r) => new { calibrationDelta = r.CalibrationDelta, entralinkCalibrationDelta = r.EntralinkCalibrationDelta, frameCalibrationDelta = r.FrameCalibrationDelta };
    static object J(Gen3Model m) => new { mode = Timers.Gen3ModeName(m.Mode), preTimer = m.PreTimer, targetFrame = m.TargetFrame, calibration = m.Calibration };
    static object J(Gen4Model m) => new { targetDelay = m.TargetDelay, targetSecond = m.TargetSecond, calibratedDelay = m.CalibratedDelay, calibratedSecond = m.CalibratedSecond };
    static object J(Gen5Model m) => new { mode = Timers.Gen5ModeName(m.Mode), calibration = m.Calibration, frameCalibration = m.FrameCalibration, entralinkCalibration = m.EntralinkCalibration, targetDelay = m.TargetDelay, targetSecond = m.TargetSecond, targetAdvances = m.TargetAdvances };
    static object J(Gen5Hits h) => new { delayHit = h.DelayHit, secondHit = h.SecondHit, advancesHit = h.AdvancesHit };
    static object J(CustomPhase p) => new { unit = Timers.CustomUnitName(p.Unit), target = p.Target, calibration = p.Calibration };
    static object J(TimerSettings s) => new { console = Timers.ConsoleName(s.Console), customFps = s.CustomFps, precisionCalibration = s.PrecisionCalibration, minimumLengthMs = s.MinimumLengthMs };

    static object Call(string fn, TimerSettings s, JsonElement a)
    {
        JsonElement A(int i) => a[i];
        switch (fn)
        {
            case "roundHalfToEven": return Timers.RoundHalfToEven(Num(A(0)));
            case "toDelays": return Timers.ToDelays(s, Num(A(0)));
            case "toMilliseconds": return Timers.ToMilliseconds(s, Num(A(0)));
            case "calibrateToDelays": return Timers.CalibrateToDelays(s, Num(A(0)));
            case "calibrateToMilliseconds": return Timers.CalibrateToMilliseconds(s, Num(A(0)));
            case "createCalibration": return Timers.CreateCalibration(s, Num(A(0)), Num(A(1)));
            case "toMinimumLength": return Timers.ToMinimumLength(Num(A(0)), Num(A(1)));
            case "minutesBeforeTarget": return Timers.MinutesBeforeTarget(Nums(A(0)));
            case "framePhases": return Timers.FramePhases(s, Num(A(0)), Num(A(1)), Num(A(2)));
            case "calibrateFrame": return Timers.CalibrateFrame(s, Num(A(0)), Num(A(1)));
            case "variableFramePhases": return Timers.VariableFramePhases(Num(A(0)));
            case "secondPhases": return Timers.SecondPhases(Num(A(0)), Num(A(1)), Num(A(2)));
            case "calibrateSecond": return Timers.CalibrateSecond(Num(A(0)), Num(A(1)));
            case "delayPhases": return Timers.DelayPhases(s, Num(A(0)), Num(A(1)), Num(A(2)));
            case "calibrateDelay": return Timers.CalibrateDelay(s, Num(A(0)), Num(A(1)));
            case "entralinkPhases": return Timers.EntralinkPhases(s, Num(A(0)), Num(A(1)), Num(A(2)), Num(A(3)));
            case "enhancedEntralinkPhases": return Timers.EnhancedEntralinkPhases(s, Num(A(0)), Num(A(1)), Num(A(2)), Num(A(3)), Num(A(4)), Num(A(5)));
            case "calibrateEntralinkAdvances": return Timers.CalibrateEntralinkAdvances(Num(A(0)), Num(A(1)));
            case "gen3Phases": return Timers.Gen3Phases(s, Gen3(A(0)));
            case "calibrateGen3": return Timers.CalibrateGen3(s, Gen3(A(0)), Num(A(1)));
            case "gen4Phases": return Timers.Gen4Phases(s, Gen4(A(0)));
            case "gen4MinutesBefore": return Timers.Gen4MinutesBefore(s, Gen4(A(0)));
            case "calibrateGen4": return Timers.CalibrateGen4(s, Gen4(A(0)), Num(A(1)));
            case "gen5Phases": return Timers.Gen5Phases(s, Gen5(A(0)));
            case "gen5MinutesBefore": return Timers.Gen5MinutesBefore(s, Gen5(A(0)));
            case "calibrateGen5": return Timers.CalibrateGen5(s, Gen5(A(0)), Hits(A(1)));
            case "customPhases": return Timers.CustomPhases(s, Phases(A(0)));
            case "calibrateCustomPhase": return Timers.CalibrateCustomPhase(s, Phase(A(0)), Num(A(1)));
            default: throw new ArgumentException($"unknown fn {fn}");
        }
    }

    static bool Same(JsonElement expected, object actual)
    {
        switch (actual)
        {
            case double d:
                return expected.ValueKind == JsonValueKind.String ? double.IsPositiveInfinity(d) && expected.GetString() == "Infinity"
                    : expected.ValueKind == JsonValueKind.Number && expected.GetDouble() == d;
            case double[] arr:
                if (expected.ValueKind != JsonValueKind.Array || expected.GetArrayLength() != arr.Length) return false;
                int i = 0;
                foreach (var e in expected.EnumerateArray()) if (!Same(e, arr[i++])) return false;
                return true;
            case Gen5CalibrationResult r:
                return expected.ValueKind == JsonValueKind.Object
                    && Same(expected.GetProperty("calibrationDelta"), r.CalibrationDelta)
                    && Same(expected.GetProperty("entralinkCalibrationDelta"), r.EntralinkCalibrationDelta)
                    && Same(expected.GetProperty("frameCalibrationDelta"), r.FrameCalibrationDelta);
            default:
                throw new ArgumentException($"unexpected result type {actual.GetType()}");
        }
    }

    static string Show(object v) => JsonSerializer.Serialize(v switch
    {
        double d => J(d), double[] a => J(a), Gen5CalibrationResult r => J(r), _ => v
    }, JsonOpts);

    static bool CheckOne(JsonElement v, bool quiet)
    {
        var settings = Settings(v.TryGetProperty("settings", out var se) ? se : default);
        var fn = v.GetProperty("fn").GetString()!;
        var actual = Call(fn, settings, v.GetProperty("args"));
        var expected = v.GetProperty("expect");
        if (Same(expected, actual)) return true;
        if (!quiet)
            Console.Error.WriteLine($"FAIL {v.GetProperty("id").GetString()} ({fn})\n  source   {v.GetProperty("source").GetString()}\n  expected {expected.GetRawText()}\n  actual   {Show(actual)}");
        return false;
    }

    public static int CheckVectors(string path)
    {
        var doc = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
        int total = 0, failed = 0, py = 0;
        JsonElement? control = null;
        foreach (var v in doc.GetProperty("vectors").EnumerateArray())
        {
            total++;
            if (v.GetProperty("id").GetString()!.StartsWith("py-")) py++;
            if (control is null && v.GetProperty("fn").GetString() == "gen4Phases") control = v;
            if (!CheckOne(v, false)) failed++;
        }
        Console.WriteLine($"C# timer vectors: {total} checked, {failed} failed ({py} transcribed from EonTimer's Python unit tests)");

        // Negative control: corrupt one vector in memory and require the checker to reject it.
        int controlFailures = 0;
        if (control is JsonElement c)
        {
            var text = c.GetRawText();
            var expect = c.GetProperty("expect");
            var corruptedExpect = "[" + (Num(expect[0]) + 1).ToString("R") + "," + expect[1].GetRawText() + "]";
            var corrupted = JsonDocument.Parse(text.Replace(expect.GetRawText(), corruptedExpect)).RootElement;
            if (CheckOne(corrupted, true))
            {
                controlFailures++;
                Console.Error.WriteLine($"FAIL negative control: corrupted vector {c.GetProperty("id").GetString()} was NOT detected");
            }
            else
            {
                Console.WriteLine($"negative control: corrupted vector \"{c.GetProperty("id").GetString()} [+1 ms on phase 1]\" correctly fails (expected {corruptedExpect}, actual {expect.GetRawText()})");
            }
        }
        return failed + controlFailures == 0 ? 0 : 1;
    }

    // mulberry32 — the same 32-bit generator core/timers tests could reproduce; all ops mod 2^32.
    sealed class Rng
    {
        uint _a;
        public Rng(uint seed) { _a = seed; }
        public double Next()
        {
            unchecked
            {
                _a += 0x6D2B79F5u;
                uint t = _a;
                t = (t ^ (t >> 15)) * (1u | t);
                t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }
        public int Int(int lo, int hi) => lo + (int)Math.Floor(Next() * (hi - lo + 1));
        public bool Chance(double p) => Next() < p;
        public T Pick<T>(T[] xs) => xs[Int(0, xs.Length - 1)];
    }

    public static void EmitParity(string outPath, int count, uint seed)
    {
        var rng = new Rng(seed);
        var consoles = new[] { TimerConsole.Gba, TimerConsole.NdsSlot1, TimerConsole.NdsSlot2, TimerConsole.Dsi, TimerConsole.ThreeDs, TimerConsole.Custom };
        var cases = new List<object>();
        for (int i = 0; i < count; i++)
        {
            var settings = new TimerSettings(
                rng.Pick(consoles),
                Math.Round(30 + rng.Next() * 90, 3),
                rng.Chance(0.5),
                rng.Pick(new[] { 10000.0, 14000.0, 20000.0 }));

            double Near(double target, int spread) => rng.Chance(0.5) ? Math.Max(0, target + rng.Int(-spread, spread)) : rng.Int(0, 20000);

            var g3 = new Gen3Model(rng.Chance(0.7) ? Gen3Mode.Standard : Gen3Mode.VariableTarget,
                rng.Int(0, 10000), rng.Int(0, 200000), rng.Int(-4000, 4000) / 2.0);
            double frameHit = rng.Chance(0.5) ? Math.Max(0, g3.TargetFrame + rng.Int(-100, 100)) : rng.Int(0, 200000);

            var g4 = new Gen4Model(rng.Int(0, 20000), rng.Int(0, 59), rng.Int(-500, 3000), rng.Int(0, 59));
            double delayHit = rng.Chance(0.1) ? 0 : rng.Chance(0.6) ? Math.Max(0, g4.TargetDelay + rng.Int(-12, 12)) : Near(g4.TargetDelay, 1000);

            var g5 = new Gen5Model((Gen5Mode)rng.Int(0, 3), rng.Int(-1000, 1000), rng.Int(-2000, 2000), rng.Int(-500, 1000),
                rng.Int(0, 20000), rng.Int(0, 59), rng.Int(0, 2000));
            var hits = new Gen5Hits(
                rng.Chance(0.2) ? null : rng.Chance(0.6) ? Math.Max(0, g5.TargetDelay + rng.Int(-12, 12)) : Near(g5.TargetDelay, 1000),
                rng.Chance(0.2) ? null : rng.Chance(0.5) ? g5.TargetSecond : rng.Int(0, 59),
                rng.Chance(0.2) ? null : rng.Chance(0.5) ? g5.TargetAdvances : rng.Int(0, 2000));

            int n = rng.Int(1, 4);
            var phases = new CustomPhase[n];
            var customHits = new double[n];
            for (int k = 0; k < n; k++)
            {
                phases[k] = new CustomPhase((CustomUnit)rng.Int(0, 2), rng.Int(0, 100000), rng.Int(-4000, 4000) / 4.0);
                customHits[k] = rng.Chance(0.5) ? Math.Max(0, phases[k].Target + rng.Int(-50, 50)) : rng.Int(0, 100000);
            }

            cases.Add(new
            {
                index = i,
                settings = J(settings),
                gen3 = new { model = J(g3), frameHit },
                gen4 = new { model = J(g4), delayHit },
                gen5 = new { model = J(g5), hits = J(hits) },
                custom = new { phases = phases.Select(J).ToArray(), hits = customHits },
                results = new
                {
                    gen3Phases = J(Timers.Gen3Phases(settings, g3)),
                    gen3Phase = J(Timers.FramePhase(settings, g3.TargetFrame, g3.Calibration)),
                    gen3Calibrate = J(Timers.CalibrateGen3(settings, g3, frameHit)),
                    gen3Calibrated = J(Timers.Gen3Calibrated(settings, g3, frameHit)),
                    gen4Phases = J(Timers.Gen4Phases(settings, g4)),
                    gen4MinutesBefore = J(Timers.Gen4MinutesBefore(settings, g4)),
                    gen4Calibrate = J(Timers.CalibrateGen4(settings, g4, delayHit)),
                    gen4Calibrated = J(Timers.Gen4Calibrated(settings, g4, delayHit)),
                    gen5Phases = J(Timers.Gen5Phases(settings, g5)),
                    gen5MinutesBefore = J(Timers.Gen5MinutesBefore(settings, g5)),
                    gen5Calibrate = J(Timers.CalibrateGen5(settings, g5, hits)),
                    gen5Calibrated = J(Timers.Gen5Calibrated(settings, g5, hits)),
                    customPhases = J(Timers.CustomPhases(settings, phases)),
                    customCalibrate = phases.Select((p, k) => J(Timers.CalibrateCustomPhase(settings, p, customHits[k]))).ToArray(),
                    customCalibrated = phases.Select((p, k) => J(Timers.CustomPhaseCalibrated(settings, p, customHits[k]))).ToArray()
                }
            });
        }
        File.WriteAllText(outPath, JsonSerializer.Serialize(new { seed, count, generator = "app/Tests/TimerChecks.cs EmitParity (mulberry32)", cases }, JsonOpts));
        Console.WriteLine($"timer parity: {count} random parameter sets (seed {seed}) written to {outPath}");
    }
}
