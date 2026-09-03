namespace ShinySolution.Core;

// Timer models ported from EonTimer (MIT, https://github.com/DasAmpharos/EonTimer, main @ ad10886;
// its MIT notice is reproduced in THIRD_PARTY_NOTICES.md at the repo root).
// Mirrors core/timers.js function-for-function and keeps EonTimer's operation order so the two
// ports and EonTimer agree bit-for-bit (tests/timer-vectors.json, tests/timer-parity.json).
// Constants cite EonTimer file:line; see docs/FACTS.md "Timer models".

public enum TimerConsole { Gba, NdsSlot1, NdsSlot2, Dsi, ThreeDs, Custom }
public enum Gen3Mode { Standard, VariableTarget }
public enum Gen5Mode { Standard, CGear, Entralink, EntralinkPlus }
public enum CustomUnit { Milliseconds, Advances, Hex }

public sealed record TimerSettings(
    TimerConsole Console = TimerConsole.NdsSlot1,
    double CustomFps = 60.0,
    bool PrecisionCalibration = false,
    double MinimumLengthMs = Timers.MinimumLengthMs);

public sealed record Gen3Model(Gen3Mode Mode, double PreTimer, double TargetFrame, double Calibration);
public sealed record Gen4Model(double TargetDelay, double TargetSecond, double CalibratedDelay, double CalibratedSecond);
public sealed record Gen5Model(Gen5Mode Mode, double Calibration, double FrameCalibration, double EntralinkCalibration,
    double TargetDelay, double TargetSecond, double TargetAdvances);
public sealed record Gen5Hits(double? DelayHit, double? SecondHit, double? AdvancesHit);
public sealed record Gen5CalibrationResult(double CalibrationDelta, double EntralinkCalibrationDelta, double FrameCalibrationDelta);
public sealed record CustomPhase(CustomUnit Unit, double Target, double Calibration);

public static class Timers
{
    // Console frame rates (EonTimer src/utils/constants.ts:23-29).
    public const double GbaFps = Lcrng.GbaFps;          // 16777216 / 280896, constants.ts:23
    public const double NdsSlot1Fps = Gen4.NdsFps;      // 59.8261, constants.ts:24
    public const double NdsSlot2Fps = 59.6555;          // constants.ts:25

    public const double MinimumLengthMs = 14000;        // constants.ts:4
    public const double MinuteMs = 60000;               // constants.ts:8,19
    public const double SecondOffsetMs = 200;           // secondTimer.ts:8
    public const double SecondHitHalfMs = 500;          // secondTimer.ts:13,15
    public const double CloseThresholdMs = 167;         // delayTimer.ts:5
    public const double UpdateFactor = 1.0;             // delayTimer.ts:6
    public const double CloseUpdateFactor = 0.75;       // delayTimer.ts:7
    public const double EntralinkPhase1Ms = 250;        // entralinkTimer.ts:14
    public const double EntralinkFrameRate = 0.837148929; // entralinkTimer.ts:4
    static readonly double MachineEpsilon = Math.Pow(2, -52); // JS Number.EPSILON (calibrator.ts:29); NOT double.Epsilon

    // EonTimer's opening values (src/store/index.ts:121-154).
    public static readonly TimerSettings DefaultSettings = new();
    public static readonly Gen3Model DefaultGen3 = new(Gen3Mode.Standard, 5000, 1000, 0);
    public static readonly Gen4Model DefaultGen4 = new(600, 50, 500, 14);
    public static readonly Gen5Model DefaultGen5 = new(Gen5Mode.Standard, -95, 0, 256, 1200, 50, 100);
    // Community starting calibrations for Gen 5 (EMPIRICAL). -95 is EonTimer's default
    // (store/index.ts:134); -424 for 3DS appears nowhere in EonTimer and is carried unverified.
    public const double Gen5CommunityCalibrationDs = -95;
    public const double Gen5CommunityCalibration3ds = -424;

    // ---- wire names shared with core/timers.js and the vector files ----
    public static string ConsoleName(TimerConsole c) => c switch
    {
        TimerConsole.Gba => "GBA", TimerConsole.NdsSlot1 => "NDS_SLOT1", TimerConsole.NdsSlot2 => "NDS_SLOT2",
        TimerConsole.Dsi => "DSI", TimerConsole.ThreeDs => "3DS", TimerConsole.Custom => "CUSTOM",
        _ => throw new ArgumentOutOfRangeException(nameof(c))
    };
    public static bool TryParseConsole(string s, out TimerConsole console)
    {
        switch (s)
        {
            case "GBA": console = TimerConsole.Gba; return true;
            case "NDS_SLOT1": console = TimerConsole.NdsSlot1; return true;
            case "NDS_SLOT2": console = TimerConsole.NdsSlot2; return true;
            case "DSI": console = TimerConsole.Dsi; return true;
            case "3DS": console = TimerConsole.ThreeDs; return true;
            case "CUSTOM": console = TimerConsole.Custom; return true;
            default: console = default; return false;
        }
    }
    public static TimerConsole ParseConsole(string s)
        => TryParseConsole(s, out var console) ? console : throw new ArgumentException($"unknown console {s}");
    public static string Gen3ModeName(Gen3Mode m) => m == Gen3Mode.Standard ? "STANDARD" : "VARIABLE_TARGET";
    public static Gen3Mode ParseGen3Mode(string s) => s switch
    {
        "STANDARD" => Gen3Mode.Standard, "VARIABLE_TARGET" => Gen3Mode.VariableTarget,
        _ => throw new ArgumentException($"unknown gen3 mode {s}")
    };
    public static string Gen5ModeName(Gen5Mode m) => m switch
    {
        Gen5Mode.Standard => "STANDARD", Gen5Mode.CGear => "C_GEAR", Gen5Mode.Entralink => "ENTRALINK",
        Gen5Mode.EntralinkPlus => "ENTRALINK_PLUS", _ => throw new ArgumentOutOfRangeException(nameof(m))
    };
    public static Gen5Mode ParseGen5Mode(string s) => s switch
    {
        "STANDARD" => Gen5Mode.Standard, "C_GEAR" => Gen5Mode.CGear, "ENTRALINK" => Gen5Mode.Entralink,
        "ENTRALINK_PLUS" => Gen5Mode.EntralinkPlus, _ => throw new ArgumentException($"unknown gen5 mode {s}")
    };
    public static string CustomUnitName(CustomUnit u) => u switch
    {
        CustomUnit.Milliseconds => "ms", CustomUnit.Advances => "advances", CustomUnit.Hex => "hex",
        _ => throw new ArgumentOutOfRangeException(nameof(u))
    };
    public static CustomUnit ParseCustomUnit(string s) => s switch
    {
        "ms" => CustomUnit.Milliseconds, "advances" => CustomUnit.Advances, "hex" => CustomUnit.Hex,
        _ => throw new ArgumentException($"unknown custom unit {s}")
    };

    // calibrator.ts:15-36 — midpoint-to-even with an epsilon-wide tie band.
    public static double RoundHalfToEven(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) return Math.Round(value);
        double lower = Math.Floor(value);
        double upper = Math.Ceiling(value);
        if (lower == upper) return lower;
        double lowerDistance = value - lower;
        double upperDistance = upper - value;
        double epsilon = MachineEpsilon * Math.Max(1, Math.Abs(value));
        if (Math.Abs(lowerDistance - upperDistance) <= epsilon)
        {
            return Math.Abs(lower) % 2 == 0 ? lower : upper;
        }
        return lowerDistance < upperDistance ? lower : upper;
    }

    // calibrator.ts:38-57
    public static double Fps(TimerSettings settings)
    {
        switch (settings.Console)
        {
            case TimerConsole.Gba: return GbaFps;
            case TimerConsole.NdsSlot2: return NdsSlot2Fps;
            case TimerConsole.NdsSlot1:
            case TimerConsole.Dsi:
            case TimerConsole.ThreeDs: return NdsSlot1Fps;
            case TimerConsole.Custom:
                if (settings.CustomFps == 0) throw new ArgumentException("Custom framerate must be greater than 0");
                return settings.CustomFps;
            default: return NdsSlot1Fps;              // calibrator.ts:54-55: any value outside the enum
        }
    }

    public static double MsPerFrame(TimerSettings settings) => 1000 / Fps(settings);

    public static double ToDelays(TimerSettings settings, double milliseconds)            // calibrator.ts:59-61
        => RoundHalfToEven(milliseconds / MsPerFrame(settings));

    public static double ToMilliseconds(TimerSettings settings, double delays)            // calibrator.ts:63-65
        => RoundHalfToEven(MsPerFrame(settings) * delays);

    public static double CalibrateToDelays(TimerSettings settings, double milliseconds)   // calibrator.ts:67-71
        => settings.PrecisionCalibration ? RoundHalfToEven(milliseconds) : ToDelays(settings, milliseconds);

    public static double CalibrateToMilliseconds(TimerSettings settings, double delays)   // calibrator.ts:73-75
        => settings.PrecisionCalibration ? delays : ToMilliseconds(settings, delays);

    public static double CreateCalibration(TimerSettings settings, double delays, double seconds) // calibrator.ts:77-83
        => ToMilliseconds(settings, delays - ToDelays(settings, seconds * 1000));

    public static double ToMinimumLength(double value, double minimumLength = MinimumLengthMs) // constants.ts:6-11
    {
        while (value < minimumLength) value += MinuteMs;
        return value;
    }

    public static double MinutesBeforeTarget(IEnumerable<double> phases)                   // constants.ts:13-20
    {
        double total = 0;
        foreach (var phase in phases)
        {
            if (double.IsPositiveInfinity(phase)) continue;
            total += phase;
        }
        return Math.Floor(total / MinuteMs);
    }

    // ---- Frame timer (Gen 3), frameTimer.ts ----
    public static double FramePhase(TimerSettings settings, double targetFrame, double calibration) // :13-19
        => ToMilliseconds(settings, targetFrame) + calibration;

    public static double[] FramePhases(TimerSettings settings, double preTimer, double targetFrame, double calibration) // :4-11
        => new[] { preTimer, FramePhase(settings, targetFrame, calibration) };

    public static double CalibrateFrame(TimerSettings settings, double targetFrame, double frameHit) // :21-27
        => ToMilliseconds(settings, targetFrame - frameHit);

    public static double[] VariableFramePhases(double preTimer)                            // :29-31
        => new[] { preTimer, double.PositiveInfinity };

    // ---- Second timer (Gen 5 Standard), secondTimer.ts ----
    public static double[] SecondPhases(double targetSecond, double calibration, double minimumLength = MinimumLengthMs) // :3-9
        => new[] { ToMinimumLength(targetSecond * 1000 + calibration + SecondOffsetMs, minimumLength) };

    public static double CalibrateSecond(double targetSecond, double secondHit)             // :11-18
    {
        if (secondHit < targetSecond) return (targetSecond - secondHit) * 1000 - SecondHitHalfMs;
        if (secondHit > targetSecond) return (targetSecond - secondHit) * 1000 + SecondHitHalfMs;
        return 0;
    }

    // ---- Delay timer (Gen 4, Gen 5 C-Gear), delayTimer.ts ----
    public static double[] DelayPhases(TimerSettings settings, double targetDelay, double targetSecond, double calibration) // :9-22
    {
        double min = settings.MinimumLengthMs;
        double phase1 = ToMinimumLength(SecondPhases(targetSecond, calibration, min)[0] - ToMilliseconds(settings, targetDelay), min);
        double phase2 = ToMilliseconds(settings, targetDelay) - calibration;
        return new[] { phase1, phase2 };
    }

    public static double CalibrateDelay(TimerSettings settings, double targetDelay, double delayHit) // :24-34
    {
        double delta = ToMilliseconds(settings, delayHit) - ToMilliseconds(settings, targetDelay);
        if (Math.Abs(delta) <= CloseThresholdMs) return CloseUpdateFactor * delta;
        return UpdateFactor * delta;
    }

    // ---- Entralink timers (Gen 5), entralinkTimer.ts ----
    public static double[] EntralinkPhases(TimerSettings settings, double targetDelay, double targetSecond,
        double calibration, double entralinkCalibration)                                    // :6-17
    {
        var durations = DelayPhases(settings, targetDelay, targetSecond, calibration);
        durations[0] += EntralinkPhase1Ms;
        durations[1] -= entralinkCalibration;
        return durations;
    }

    public static double CalibrateEntralinkDelay(TimerSettings settings, double targetDelay, double delayHit) // :19-25
        => CalibrateDelay(settings, targetDelay, delayHit);

    public static double[] EnhancedEntralinkPhases(TimerSettings settings, double targetDelay, double targetSecond,
        double targetAdvances, double calibration, double entralinkCalibration, double frameCalibration) // :27-45
    {
        var phases = EntralinkPhases(settings, targetDelay, targetSecond, calibration, entralinkCalibration);
        return new[] { phases[0], phases[1], (targetAdvances / EntralinkFrameRate) * 1000 + frameCalibration };
    }

    public static double CalibrateEntralinkAdvances(double targetAdvances, double advancesHit) // :47-49
        => ((targetAdvances - advancesHit) / EntralinkFrameRate) * 1000;

    // ---- Gen 3 model, gen3Timer.ts ----
    public static double[] Gen3Phases(TimerSettings settings, Gen3Model model) => model.Mode switch // :17-24
    {
        Gen3Mode.Standard => FramePhases(settings, model.PreTimer, model.TargetFrame, model.Calibration),
        Gen3Mode.VariableTarget => VariableFramePhases(model.PreTimer),
        _ => throw new ArgumentOutOfRangeException(nameof(model))
    };

    public static double CalibrateGen3(TimerSettings settings, Gen3Model model, double frameHit) // :26-32
        => CalibrateFrame(settings, model.TargetFrame, frameHit);

    public static Gen3Model Gen3Calibrated(TimerSettings settings, Gen3Model model, double frameHit) // Gen3Panel.tsx:68-73
        => model with { Calibration = model.Calibration + CalibrateGen3(settings, model, frameHit) };

    // ---- Gen 4 model, gen4Timer.ts ----
    public static double Gen4Calibration(TimerSettings settings, Gen4Model model)          // :12-14
        => CreateCalibration(settings, model.CalibratedDelay, model.CalibratedSecond);

    public static double[] Gen4Phases(TimerSettings settings, Gen4Model model)             // :16-23
        => DelayPhases(settings, model.TargetDelay, model.TargetSecond, Gen4Calibration(settings, model));

    public static double Gen4MinutesBefore(TimerSettings settings, Gen4Model model)        // :25-29
        => MinutesBeforeTarget(DelayPhases(settings, model.TargetDelay, model.TargetSecond, 0));

    public static double CalibrateGen4(TimerSettings settings, Gen4Model model, double delayHit) // :31-40
    {
        if (delayHit > 0) return ToDelays(settings, CalibrateDelay(settings, model.TargetDelay, delayHit));
        return 0;
    }

    public static Gen4Model Gen4Calibrated(TimerSettings settings, Gen4Model model, double delayHit) // Gen4Panel.tsx:45-50
        => model with { CalibratedDelay = model.CalibratedDelay + CalibrateGen4(settings, model, delayHit) };

    // ---- Gen 5 model, gen5Timer.ts ----
    public static double[] Gen5Phases(TimerSettings settings, Gen5Model model)             // :23-51
    {
        double calibration = CalibrateToMilliseconds(settings, model.Calibration);
        double entralinkCalibration = CalibrateToMilliseconds(settings, model.EntralinkCalibration);
        return model.Mode switch
        {
            Gen5Mode.Standard => SecondPhases(model.TargetSecond, calibration, settings.MinimumLengthMs),
            Gen5Mode.CGear => DelayPhases(settings, model.TargetDelay, model.TargetSecond, calibration),
            Gen5Mode.Entralink => EntralinkPhases(settings, model.TargetDelay, model.TargetSecond, calibration, entralinkCalibration),
            Gen5Mode.EntralinkPlus => EnhancedEntralinkPhases(settings, model.TargetDelay, model.TargetSecond,
                model.TargetAdvances, calibration, entralinkCalibration, model.FrameCalibration),
            _ => throw new ArgumentOutOfRangeException(nameof(model))
        };
    }

    public static double Gen5MinutesBefore(TimerSettings settings, Gen5Model model) => model.Mode switch // :53-72
    {
        Gen5Mode.Standard => MinutesBeforeTarget(SecondPhases(model.TargetSecond, 0, settings.MinimumLengthMs)),
        Gen5Mode.CGear => MinutesBeforeTarget(DelayPhases(settings, model.TargetDelay, model.TargetSecond, 0)),
        Gen5Mode.Entralink or Gen5Mode.EntralinkPlus =>
            MinutesBeforeTarget(EntralinkPhases(settings, model.TargetDelay, model.TargetSecond, 0, 0)),
        _ => 0
    };

    public static Gen5CalibrationResult CalibrateGen5(TimerSettings settings, Gen5Model model, Gen5Hits hits) // :86-138
    {
        double calibrationDelta = 0, entralinkCalibrationDelta = 0, frameCalibrationDelta = 0;
        switch (model.Mode)
        {
            case Gen5Mode.Standard:
                if (hits.SecondHit is double s0)
                    calibrationDelta = CalibrateToDelays(settings, CalibrateSecond(model.TargetSecond, s0));
                break;
            case Gen5Mode.CGear:
                if (hits.DelayHit is double d0)
                    calibrationDelta = CalibrateToDelays(settings, CalibrateDelay(settings, model.TargetDelay, d0));
                break;
            case Gen5Mode.Entralink:
            case Gen5Mode.EntralinkPlus:
                if (hits.SecondHit is double s1 && s1 != model.TargetSecond)
                    calibrationDelta = CalibrateToDelays(settings, CalibrateSecond(model.TargetSecond, s1));
                if (hits.DelayHit is double d1 && d1 != model.TargetDelay)
                    entralinkCalibrationDelta = CalibrateToDelays(settings, CalibrateEntralinkDelay(settings, model.TargetDelay, d1));
                if (model.Mode == Gen5Mode.EntralinkPlus && hits.AdvancesHit is double a1 && a1 != model.TargetAdvances)
                    frameCalibrationDelta = CalibrateEntralinkAdvances(model.TargetAdvances, a1);
                break;
        }
        return new Gen5CalibrationResult(calibrationDelta, entralinkCalibrationDelta, frameCalibrationDelta);
    }

    public static Gen5Model Gen5Calibrated(TimerSettings settings, Gen5Model model, Gen5Hits hits) // Gen5Panel.tsx:63-74
    {
        var r = CalibrateGen5(settings, model, hits);
        return model with
        {
            Calibration = model.Calibration + r.CalibrationDelta,
            EntralinkCalibration = model.EntralinkCalibration + r.EntralinkCalibrationDelta,
            FrameCalibration = model.FrameCalibration + r.FrameCalibrationDelta
        };
    }

    // ---- Custom timer, customTimer.ts ----
    public static double[] CustomPhases(TimerSettings settings, IReadOnlyList<CustomPhase> phases) // :10-18
    {
        var result = new double[phases.Count];
        for (int i = 0; i < phases.Count; i++)
        {
            var p = phases[i];
            double value = p.Target;
            if (p.Unit == CustomUnit.Advances || p.Unit == CustomUnit.Hex) value = ToMilliseconds(settings, value);
            result[i] = value + p.Calibration;
        }
        return result;
    }

    public static double CalibrateCustomPhase(TimerSettings settings, CustomPhase phase, double hit) // :20-29
    {
        if (phase.Unit != CustomUnit.Milliseconds) return ToMilliseconds(settings, phase.Target - hit);
        return phase.Target - hit;
    }

    public static CustomPhase CustomPhaseCalibrated(TimerSettings settings, CustomPhase phase, double hit) // CustomPanel.tsx:104-110
        => phase with { Calibration = phase.Calibration + CalibrateCustomPhase(settings, phase, hit) };
}
