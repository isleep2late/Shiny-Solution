using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ShinySolution.Core;

// Gen 1 Trainer ID cue arithmetic (Red / Blue / Yellow hold-START methodologies), the
// save-corruption reset metronome, the moderator verify, the Gen 3 Emerald / FireRed /
// LeafGreen "typed Trainer ID -> Secret ID" model and the runner's press-jitter model.
// A port of RNG Solution's rngsolution/timeline.py, gen3.py and jitter.py, the same API as
// core/gen1tid.js; the Python is the oracle (tests/gen1tid-vectors.json). Pure functions;
// the data comes from core/data/gen1-tid.json and gen3-sid.json (Gen1TidData / Gen3SidData).

public sealed class OutlierSampleException : ArgumentException
{
    public OutlierSampleException(string message) : base(message) { }
}

public sealed class DuplicateSampleException : ArgumentException
{
    public DuplicateSampleException(string message) : base(message) { }
}

public sealed record Cue(double T, double Freq, double Ms, string Label, string Kind);

public sealed class Schedule
{
    public string Anchor { get; init; } = "";
    public List<Cue> Cues { get; init; } = new();
    public double? TA { get; init; }
    public double? HoldLo { get; init; }
    public double? HoldHi { get; init; }
    public double? Menu { get; init; }
    public int DroppedCountIn { get; init; }
    public double[] CountInTimes => Cues.Where(c => c.Kind == "count").Select(c => c.T).ToArray();
    public double Duration => Cues.Count == 0 ? 0.0 : Cues.Max(c => c.T + c.Ms / 1000.0);
}

// A methodology's boot timing (gen1-tid.json methodologies[id].timing).
public sealed class Gen1Timing
{
    public int HoldLoFrame { get; init; }
    public int HoldHiFrame { get; init; }
    public int MenuFrame { get; init; }
    public double VisibleLagFrames { get; init; }
    public string VisibleLagNote { get; init; } = "";
    public int[] VerifiedTargets { get; init; } = Array.Empty<int>();
    public string VerifiedTargetsNote { get; init; } = "";
}

public sealed class ResetPath
{
    public double C1MeanFrames { get; init; }
    public double C1MaxFrames { get; init; }
    public double P1MeanFrames { get; init; }
    public double P1MinFrames { get; init; }
    public double? PadReadFrames { get; init; }
    public double? PadReadMinFrames { get; init; }
    public double? PadReadMaxFrames { get; init; }
}

public sealed class ResetModel
{
    public string[] Order { get; init; } = Array.Empty<string>();
    public double? FadeLoFrames { get; init; }
    public double? FadeHiFrames { get; init; }
    public double? StallFrames { get; init; }
    public Dictionary<string, ResetPath> Paths { get; init; } = new();
    public bool HasFade => FadeLoFrames is not null;
}

public sealed class ResetInterval
{
    public string[] Order { get; init; } = Array.Empty<string>();
    public double BoundaryLoFrames { get; init; }
    public double BoundaryHiFrames { get; init; }
    public double MeanLoFrames { get; init; }
    public double MeanHiFrames { get; init; }
    public double PhysLoFrames { get; init; }
    public double PhysHiFrames { get; init; }
    public double ConsLoFrames { get; init; }
    public double ConsHiFrames { get; init; }
    public double BoundaryCentreFrames => (BoundaryLoFrames + BoundaryHiFrames) / 2.0;
    public double CentreFrames => (PhysLoFrames + PhysHiFrames) / 2.0;
    public double CentreMs => Gen1Tid.FramesToMs(CentreFrames);
    public double BoundaryCentreMs => Gen1Tid.FramesToMs(BoundaryCentreFrames);
    public double BoundaryLoMs => Gen1Tid.FramesToMs(BoundaryLoFrames);
    public double BoundaryHiMs => Gen1Tid.FramesToMs(BoundaryHiFrames);
    public double MeanLoMs => Gen1Tid.FramesToMs(MeanLoFrames);
    public double MeanHiMs => Gen1Tid.FramesToMs(MeanHiFrames);
    public double PhysLoMs => Gen1Tid.FramesToMs(PhysLoFrames);
    public double PhysHiMs => Gen1Tid.FramesToMs(PhysHiFrames);
    public double ConsLoMs => Gen1Tid.FramesToMs(ConsLoFrames);
    public double ConsHiMs => Gen1Tid.FramesToMs(ConsHiFrames);
}

// A named acceptance set of Trainer IDs (gen1-tid.json "target_sets").
public sealed class TargetSet
{
    public string Key { get; }
    public string Name { get; }
    public string Kind { get; }
    public string[] Games { get; }
    public string Provenance { get; }
    public string Route { get; }
    public int[] Tids { get; }
    public int? Hi { get; }
    public (int Lo, int Hi)[] LoRanges { get; }

    public TargetSet(string key, JsonElement spec)
    {
        Key = key;
        Name = spec.TryGetProperty("name", out var n) ? n.GetString() ?? key : key;
        Kind = spec.TryGetProperty("kind", out var k) ? k.GetString() ?? "list" : "list";
        Games = spec.TryGetProperty("games", out var g) ? g.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : Array.Empty<string>();
        Provenance = spec.TryGetProperty("provenance", out var p) ? p.GetString() ?? "" : "";
        Route = spec.TryGetProperty("route", out var r) ? r.GetString() ?? "" : "";
        Tids = Array.Empty<int>();
        LoRanges = Array.Empty<(int, int)>();
        if (Kind == "list")
        {
            Tids = spec.TryGetProperty("tids", out var t)
                ? t.EnumerateArray().Select(x => Convert.ToInt32(x.ToString(), 16)).OrderBy(x => x).ToArray()
                : Array.Empty<int>();
        }
        else if (Kind == "sled")
        {
            Hi = Convert.ToInt32(spec.GetProperty("hi").ToString(), 16);
            LoRanges = spec.TryGetProperty("lo_ranges", out var lr)
                ? lr.EnumerateArray().Select(x => (Convert.ToInt32(x[0].ToString(), 16), Convert.ToInt32(x[1].ToString(), 16))).ToArray()
                : Array.Empty<(int, int)>();
        }
        else throw new ArgumentException($"target set {key}: unknown kind '{Kind}'");
    }

    public static TargetSet Sled(string key, string name, int hi, (int, int)[] loRanges)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            kind = "sled", hi = hi.ToString("X2"), name,
            lo_ranges = loRanges.Select(r => new[] { r.Item1.ToString("X2"), r.Item2.ToString("X2") }).ToArray()
        }));
        return new TargetSet(key, doc.RootElement.Clone());
    }

    public bool Accepts(int tid)
    {
        if (Kind == "list") return Array.IndexOf(Tids, tid) >= 0;
        if ((tid >> 8) != Hi) return false;
        int lo = tid & 0xFF;
        return LoRanges.Any(r => r.Lo <= lo && lo <= r.Hi);
    }

    public bool Trap(int tid) => Kind == "sled" && (tid >> 8) == Hi && !Accepts(tid);

    public string Describe()
    {
        if (Kind == "list") return Key + ": " + string.Join(", ", Tids.Select(t => $"${t:X4} ({t})"));
        return Key + ": high byte $" + (Hi ?? 0).ToString("X2") + ", low byte " + string.Join(" or ", LoRanges.Select(r => $"${r.Lo:X2}-${r.Hi:X2}"));
    }
}

// One calibration sample: the on-disk record shared with the Python front end (snake_case keys).
public sealed class Sample
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
}

public sealed class VerifyResult
{
    public double PredictedOffset { get; init; }
    public int[] Offsets { get; init; } = Array.Empty<int>();
    public int? Nearest { get; init; }
    public double? DifferenceFrames { get; init; }
    public bool Consistent { get; init; }
    public bool InTable { get; init; }
    public string Verdict { get; init; } = "";
    public double VisibleLagFrames { get; init; }
}

public sealed record SidCandidate(int K, int Sid, int Tsv);

public sealed class SidSpeedModel
{
    public Dictionary<int, int[]> NameLengths { get; init; } = new();
    public int LastPressToSid { get; init; }
}

// One input path of a Gen 3 SID methodology's model, merged with the shared keys (gen3.variant).
public sealed class SidModel
{
    public string Variant { get; init; } = "";
    public string Name { get; init; } = "";
    public int OkToSeed { get; init; }
    public int KDefaultSpan { get; init; }
    public string Status { get; init; } = "";
    public string[] Stages { get; init; } = Array.Empty<string>();
    public Dictionary<string, string> StageText { get; init; } = new();
    public Dictionary<string, SidSpeedModel> TextSpeed { get; init; } = new();
}

public sealed class AnchorStats
{
    public int N { get; init; }
    public double MeanMs { get; init; }
    public double SdMs { get; init; }
    public double RobustSdMs { get; init; }
    public double MedianMs { get; init; }
    public double MinMs { get; init; }
    public double MaxMs { get; init; }
    public double[] ValuesMs { get; init; } = Array.Empty<double>();
}

public sealed class DriftResult
{
    public bool Flag { get; set; }
    public int N { get; set; }
    public int TailN { get; set; }
    public int HeadN { get; set; }
    public double ThresholdMs { get; set; }
    public double? ShiftMs { get; set; }
    public double? WelchT { get; set; }
    public string? Strength { get; set; }
    public double? HeadMeanMs { get; set; }
    public double? TailMeanMs { get; set; }
    public string Reason { get; set; } = "";
}

public sealed record FuseResult(double Value, double Variance, double[] Weights);

public sealed class AnchorPart
{
    public string Anchor { get; init; } = "";
    public double TimeS { get; init; }
    public double SdMs { get; init; }
    public double AnchorSdMs { get; init; }
    public double Variance { get; init; }
    public double Weight { get; set; }
}

public sealed class FuseCuesResult
{
    public double TimeS { get; init; }
    public double SdMs { get; init; }
    public double AnchorSdMs { get; init; }
    public double PressSdMs { get; init; }
    public double[] Weights { get; init; } = Array.Empty<double>();
    public AnchorPart[] Anchors { get; init; } = Array.Empty<AnchorPart>();
    public string BestSingle { get; init; } = "";
    public double BestSingleSdMs { get; init; }
    public double PSingle { get; init; }
    public double PFused { get; init; }
    public double AttemptsSingle { get; init; }
    public double AttemptsFused { get; init; }
    public bool Floored { get; init; }
    public string Assumption { get; init; } = "";
}

public static class Gen1Tid
{
    // ---- Game Boy timing -------------------------------------------------------
    public const double Fps = 4194304.0 / 70224.0;          // 59.7275 frames per second
    public const double FrameMs = 1000.0 / Fps;             // 16.7427 ms
    public const int MenuToTableFrames = 80;                // A press frame = menu + 80 + offset (the settle)
    public const int OutlierFrames = 60;
    public const double CountInClearS = 0.5;

    public static readonly (double Hz, double Ms) CountInTone = (880.0, 60.0);
    public static readonly (double Hz, double Ms) ACueTone = (1320.0, 150.0);
    public static readonly (double Hz, double Ms) ResetBeatTone = (440.0, 50.0);
    public static readonly (double Hz, double Ms) ABeatTone = (1320.0, 50.0);
    public static readonly (double Hz, double Ms) HoldTone = (660.0, 80.0);
    public static readonly (double Hz, double Ms) MenuMarkTone = (990.0, 40.0);

    public const string AnchorMenu = "menu";
    public const string AnchorPoweron = "poweron";
    public const string AnchorReset = "reset";
    public static readonly string[] Anchors = { AnchorMenu, AnchorPoweron, AnchorReset };

    public static readonly IReadOnlyDictionary<string, string> VerdictText = new Dictionary<string, string>
    {
        ["RUN"] = "route-valid for Any% save corruption",
        ["40!"] = "$40 high byte but the low byte overshoots the sled: the route hard-locks",
        ["no"] = "not route-valid (the route needs $4000-$4038 or $403A-$405C)"
    };

    // The owner's $40xx sled: the v0.1 default when no sets are given.
    public static readonly TargetSet Sled40xx = TargetSet.Sled("sled-40xx", "$40xx bank-$1D sled (Red / Blue Any% save corruption)", 0x40,
        new[] { (0x00, 0x38), (0x3A, 0x5C) });

    public static double FramesToSeconds(double frames) => frames / Fps;
    public static double SecondsToFrames(double seconds) => seconds * Fps;
    public static double FramesToMs(double frames) => frames * FrameMs;
    public static double MsToFrames(double ms) => ms / FrameMs;

    // Python's "%.Nf": correctly rounded from the exact binary value, ties to even.
    public static string PyFixed(double x, int digits, bool plus = false)
    {
        if (double.IsNaN(x)) return "nan";
        if (double.IsPositiveInfinity(x)) return plus ? "+inf" : "inf";
        if (double.IsNegativeInfinity(x)) return "-inf";
        double scale = Math.Pow(10, digits);
        double y = x * scale;
        double fl = Math.Floor(y);
        string s;
        if (y - fl == 0.5 && ((long)(2 * fl + 1)) % (long)Math.Pow(5, digits) == 0)
        {
            double n = fl % 2 == 0 ? fl : fl + 1;
            s = (n / scale).ToString("F" + digits, CultureInfo.InvariantCulture);
            if (n == 0 && x < 0 && !s.StartsWith("-")) s = "-" + s;
        }
        else s = x.ToString("F" + digits, CultureInfo.InvariantCulture);
        if (plus && x >= 0 && !s.StartsWith("-")) s = "+" + s;
        return s;
    }

    static string Py(double x) => x.ToString("R", CultureInfo.InvariantCulture);

    // ---- Cues ------------------------------------------------------------------
    static Schedule MakeSchedule(string anchor, IEnumerable<Cue> cues, double? tA, double? holdLo, double? holdHi, double? menu, int dropped)
        => new() { Anchor = anchor, Cues = cues.OrderBy(c => c.T).ToList(), TA = tA, HoldLo = holdLo, HoldHi = holdHi, Menu = menu, DroppedCountIn = dropped };

    public static double TargetSeconds(int offset) => FramesToSeconds(MenuToTableFrames + offset);
    public static int PressFrameFromMenu(int offset) => MenuToTableFrames + offset;
    public static double CueDelaySeconds(int offset, double correctionMs) => TargetSeconds(offset) - correctionMs / 1000.0;

    public static (List<Cue> Cues, int Dropped) CountInCues(double tA, int beeps, double spacingS, double notBefore = 0.0)
    {
        if (!(spacingS > 0)) throw new ArgumentException($"count-in spacing must be positive (got {Py(spacingS)} s)");
        if (beeps < 0) throw new ArgumentException("count-in beeps must be 0 or more");
        var cues = new List<Cue>();
        int dropped = 0;
        for (int k = beeps; k > 0; k--)
        {
            double t = tA - k * spacingS;
            if (t < notBefore) { dropped++; continue; }
            cues.Add(new Cue(t, CountInTone.Hz, CountInTone.Ms, "count-" + k, "count"));
        }
        return (cues, dropped);
    }

    public static Schedule MenuSchedule(int offset, double correctionMs, int beeps = 4, double spacingS = 1.0)
    {
        double tA = CueDelaySeconds(offset, correctionMs);
        if (tA <= 0) throw new ArgumentException($"the A cue would be due before the anchor (offset {offset}, correction {Py(correctionMs)} ms)");
        var (cues, dropped) = CountInCues(tA, beeps, spacingS);
        cues.Add(new Cue(tA, ACueTone.Hz, ACueTone.Ms, "A", "A"));
        return MakeSchedule(AnchorMenu, cues, tA, null, null, null, dropped);
    }

    public static Schedule PoweronSchedule(Gen1Timing family, int offset, double correctionMs, int beeps = 4, double spacingS = 1.0,
        double extraS = 0.0, string anchor = AnchorPoweron)
    {
        double holdLo = FramesToSeconds(family.HoldLoFrame) + extraS;
        double holdHi = FramesToSeconds(family.HoldHiFrame) + extraS;
        double menu = FramesToSeconds(family.MenuFrame) + extraS;
        double tA = menu + TargetSeconds(offset) - correctionMs / 1000.0;
        if (tA <= menu) throw new ArgumentException($"the A cue would be due before the menu (offset {offset}, correction {Py(correctionMs)} ms)");
        var cues = new List<Cue>
        {
            new(holdLo, HoldTone.Hz, HoldTone.Ms, "hold-start", "hold"),
            new((holdLo + holdHi) / 2.0, HoldTone.Hz, HoldTone.Ms, "hold-centre", "hold"),
            new(menu, MenuMarkTone.Hz, MenuMarkTone.Ms, "menu", "menu"),
            new(menu + 0.08, MenuMarkTone.Hz, MenuMarkTone.Ms, "menu-2", "menu")
        };
        var (ci, dropped) = CountInCues(tA, beeps, spacingS, menu + CountInClearS);
        cues.AddRange(ci);
        cues.Add(new Cue(tA, ACueTone.Hz, ACueTone.Ms, "A", "A"));
        return MakeSchedule(anchor, cues, tA, holdLo, holdHi, menu, dropped);
    }

    public static double ResetAnchorExtraSeconds(ResetModel model)
    {
        if (!model.HasFade) throw new ArgumentException("this reset model has no fade, so there is no reset anchor");
        double fadeMean = (model.FadeLoFrames!.Value + model.FadeHiFrames!.Value) / 2.0;
        return FramesToSeconds(fadeMean + model.StallFrames!.Value);
    }

    public static Schedule BuildSchedule(string anchor, Gen1Timing? family, int offset, double correctionMs, int beeps = 4, double spacingS = 1.0,
        double? resetExtraS = null)
    {
        if (anchor == AnchorMenu) return MenuSchedule(offset, correctionMs, beeps, spacingS);
        if (anchor == AnchorPoweron)
        {
            if (family is null) throw new ArgumentException("the power-on anchor needs the family's boot timing");
            return PoweronSchedule(family, offset, correctionMs, beeps, spacingS, 0.0, AnchorPoweron);
        }
        if (anchor == AnchorReset)
        {
            if (resetExtraS is null) throw new ArgumentException("the reset anchor needs the console's reset delay (fade + stall)");
            if (family is null) throw new ArgumentException("the reset anchor needs the family's boot timing");
            return PoweronSchedule(family, offset, correctionMs, beeps, spacingS, resetExtraS.Value, AnchorReset);
        }
        throw new ArgumentException($"unknown anchor '{anchor}'");
    }

    // ---- Trainer IDs -------------------------------------------------------------
    static long ParseDigits(string s, int radix)
    {
        bool ok = s.Length > 0 && s.All(ch => radix == 16 ? Uri.IsHexDigit(ch) : char.IsAsciiDigit(ch));
        if (!ok) throw new ArgumentException($"invalid literal '{s}'");
        if (s.Length > 12) throw new ArgumentException($"invalid literal '{s}'");
        return Convert.ToInt64(s, radix);
    }

    public static int ParseTid(string text)
    {
        string s = text.Trim().Replace(" ", "");
        if (s.Length == 0) throw new ArgumentException("empty");
        long v;
        if (s.StartsWith("$")) v = ParseDigits(s[1..], 16);
        else if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) v = ParseDigits(s[2..], 16);
        else if (s.EndsWith("h", StringComparison.OrdinalIgnoreCase)) v = ParseDigits(s[..^1], 16);
        else v = ParseDigits(s, 10);
        if (v < 0 || v > 0xFFFF) throw new ArgumentException("a Trainer ID is 0..65535");
        return (int)v;
    }

    public static string FormatTid(int tid) => $"{tid} (${tid:X4})";

    static IReadOnlyList<TargetSet> SetsOrDefault(IReadOnlyList<TargetSet>? sets) => sets ?? new[] { Sled40xx };

    public static List<TargetSet> SetsAccepting(int tid, IReadOnlyList<TargetSet>? sets = null)
        => SetsOrDefault(sets).Where(s => s.Accepts(tid)).ToList();

    public static string Verdict(int tid, IReadOnlyList<TargetSet>? sets = null)
    {
        if (SetsAccepting(tid, sets).Count > 0) return "RUN";
        if (SetsOrDefault(sets).Any(s => s.Trap(tid))) return "40!";
        return "no";
    }

    public static string VerdictTextFor(int tid, IReadOnlyList<TargetSet>? sets = null)
    {
        string v = Verdict(tid, sets);
        if (v == "RUN") return "route-valid for Any% save corruption (target set " + string.Join(", ", SetsAccepting(tid, sets).Select(s => s.Key)) + ")";
        if (v == "40!" && (tid & 0xFF) == 0x39) return "$4039 is the one hole inside the sled (excluded by the route rule): not usable";
        if (v == "no" && sets is not null) return "not route-valid (accepted by none of: " + string.Join(", ", sets.Select(s => s.Key)) + ")";
        return VerdictText[v];
    }

    // Tables are dense arrays indexed by offset (gen1-tid.json table_data decoded).
    public static int[] DecodeTable(string tidsHex, int offsetMin = 0)
    {
        var out_ = new int[offsetMin + tidsHex.Length / 4];
        for (int i = 0; i + 4 <= tidsHex.Length; i += 4) out_[offsetMin + i / 4] = Convert.ToInt32(tidsHex.Substring(i, 4), 16);
        return out_;
    }

    public static List<(int Offset, int Tid)> RouteValidTargets(int[] table, IReadOnlyList<TargetSet>? sets = null)
    {
        var out_ = new List<(int, int)>();
        for (int o = 0; o < table.Length; o++) if (Verdict(table[o], sets) == "RUN") out_.Add((o, table[o]));
        return out_;
    }

    public static int[] Invert(int[] table, int tid)
    {
        var out_ = new List<int>();
        for (int o = 0; o < table.Length; o++) if (table[o] == tid) out_.Add(o);
        return out_.ToArray();
    }

    public static int? NearestOffset(IReadOnlyList<int> offsets, double guess)
    {
        if (offsets.Count == 0) return null;
        int? best = null;
        foreach (int o in offsets)
        {
            if (best is null || Math.Abs(o - guess) < Math.Abs(best.Value - guess) || (Math.Abs(o - guess) == Math.Abs(best.Value - guess) && o < best.Value))
                best = o;
        }
        return best;
    }

    // ---- Calibration -------------------------------------------------------------
    public static int ErrorFrames(int hitOffset, int aimedOffset) => hitOffset - aimedOffset;
    public static bool IsOutlier(int hitOffset, int aimedOffset) => Math.Abs(ErrorFrames(hitOffset, aimedOffset)) > OutlierFrames;
    public static double ImpliedCorrection(double correctionUsedMs, int hitOffset, int aimedOffset)
        => correctionUsedMs + FramesToMs(ErrorFrames(hitOffset, aimedOffset));

    public static Sample MakeSample(int tid, int aimedOffset, int hitOffset, double correctionUsedMs, string? attempt = null, string note = "",
        string? player = null, string? methodology = null) => new()
    {
        Tid = tid, Aimed = aimedOffset, Hit = hitOffset, CorrectionUsedMs = correctionUsedMs,
        ImpliedMs = ImpliedCorrection(correctionUsedMs, hitOffset, aimedOffset), Attempt = attempt, Note = note, Player = player, Methodology = methodology
    };

    public static (List<Sample> Kept, List<Sample> Others) SplitByMethodology(IEnumerable<Sample> samples, string? methodology)
    {
        var list = samples.ToList();
        return (list.Where(s => s.Methodology == methodology).ToList(), list.Where(s => s.Methodology != methodology).ToList());
    }

    public static bool IsDuplicate(IEnumerable<Sample> samples, Sample sample)
    {
        var same = samples.Where(s => s.Methodology == sample.Methodology).ToList();
        if (same.Count == 0) return false;
        var last = same[^1];
        if (last.Tid != sample.Tid || last.Aimed != sample.Aimed) return false;
        if (!string.IsNullOrEmpty(last.Attempt) && !string.IsNullOrEmpty(sample.Attempt) && last.Attempt != sample.Attempt) return false;
        return true;
    }

    public static List<Sample> AddSample(IEnumerable<Sample> samples, Sample sample, bool force = false)
    {
        var list = samples.ToList();
        if (!force && IsOutlier(sample.Hit, sample.Aimed))
            throw new OutlierSampleException($"{Math.Abs(ErrorFrames(sample.Hit, sample.Aimed))} frames from the aim is more than {OutlierFrames}: not an attempt to calibrate on");
        if (!force && IsDuplicate(list, sample))
            throw new DuplicateSampleException("this Trainer ID was already entered for the same aim (same attempt twice?)");
        list.Add(sample);
        return list;
    }

    public static (List<Sample> Remaining, Sample? Dropped) DropLast(IEnumerable<Sample> samples)
    {
        var list = samples.ToList();
        if (list.Count == 0) return (new List<Sample>(), null);
        return (list.Take(list.Count - 1).ToList(), list[^1]);
    }

    public static (List<Sample> Remaining, Sample? Dropped) DropLastUnder(IEnumerable<Sample> samples, string? methodology)
    {
        var list = samples.ToList();
        for (int i = list.Count - 1; i >= 0; i--)
        {
            if (list[i].Methodology == methodology)
            {
                var dropped = list[i];
                list.RemoveAt(i);
                return (list, dropped);
            }
        }
        return (list, null);
    }

    public static double Mean(IReadOnlyList<double> xs)
    {
        if (xs.Count == 0) return double.NaN;
        double s = 0.0;
        foreach (double x in xs) s += x;
        return s / xs.Count;
    }

    public static double MeanCorrection(IEnumerable<Sample> samples, double defaultMs)
    {
        var xs = samples.Select(s => s.ImpliedMs).ToList();
        return xs.Count == 0 ? defaultMs : Mean(xs);
    }

    public static List<string?> SamplePlayers(IEnumerable<Sample> samples)
        => samples.Select(s => s.Player).Distinct().OrderBy(p => p is null).ThenBy(p => p ?? "", StringComparer.Ordinal).ToList();

    // ---- Save-corruption reset ----------------------------------------------------
    public static ResetInterval ResetIntervalFor(ResetModel model, string path = "route", double? fadeFrames = null, double adjustFrames = 0.0)
    {
        if (!model.Paths.TryGetValue(path, out var p)) throw new ArgumentException($"no reset path '{path}'");
        double c1Max = p.C1MaxFrames, p1Min = p.P1MinFrames, c1Mean = p.C1MeanFrames, p1Mean = p.P1MeanFrames;
        double r = p.PadReadFrames ?? 0.177;
        double rMin = p.PadReadMinFrames ?? r;
        double rMax = p.PadReadMaxFrames ?? r;
        double lo, hi, mlo, mhi, physLo, physHi, consLo, consHi;
        if (model.HasFade)
        {
            double fLo = model.FadeLoFrames!.Value, fHi = model.FadeHiFrames!.Value;
            if (fadeFrames is not null)
            {
                double half = (fHi - fLo) / 2.0;
                fLo = fadeFrames.Value - half; fHi = fadeFrames.Value + half;
            }
            double fMean = (fLo + fHi) / 2.0;
            lo = fHi - p1Min; hi = fLo - c1Max;
            mlo = fMean - p1Mean; mhi = fMean - c1Mean;
            physLo = lo + r; physHi = hi - 1.0 + r;
            consLo = lo + rMax; consHi = hi - 1.0 + rMin;
        }
        else
        {
            lo = c1Max; hi = p1Min;
            mlo = c1Mean; mhi = p1Mean;
            physLo = c1Max + 1.0 - r; physHi = p1Min - r;
            consLo = c1Max + 1.0 - rMin; consHi = p1Min - rMax;
        }
        double a = adjustFrames;
        return new ResetInterval
        {
            Order = model.Order.ToArray(),
            BoundaryLoFrames = lo + a, BoundaryHiFrames = hi + a, MeanLoFrames = mlo + a, MeanHiFrames = mhi + a,
            PhysLoFrames = physLo + a, PhysHiFrames = physHi + a, ConsLoFrames = consLo + a, ConsHiFrames = consHi + a
        };
    }

    public static Schedule ResetSchedule(double intervalMs, IReadOnlyList<string> order, int pairs = 15, double cadenceS = 2.0, double leadS = 1.0)
    {
        if (pairs < 1) throw new ArgumentException("pairs must be 1 or more");
        if (intervalMs <= 0) throw new ArgumentException("the interval must be positive");
        if (cadenceS * 1000.0 < intervalMs + 100.0)
            throw new ArgumentException($"cadence ({PyFixed(cadenceS, 2)} s) must be at least the interval ({PyFixed(intervalMs, 1)} ms) plus 100 ms");
        var firstTone = order[0] == "RESET" ? ResetBeatTone : ABeatTone;
        var secondTone = order[1] == "A" ? ABeatTone : ResetBeatTone;
        string firstKind = order[0] == "RESET" ? "reset" : "abeat";
        string secondKind = order[1] == "A" ? "abeat" : "power";
        var cues = new List<Cue>();
        for (int j = 0; j < pairs; j++)
        {
            double t0 = leadS + j * cadenceS;
            cues.Add(new Cue(t0, firstTone.Hz, firstTone.Ms, $"{order[0]}-{j + 1}", firstKind));
            cues.Add(new Cue(t0 + intervalMs / 1000.0, secondTone.Hz, secondTone.Ms, $"{order[1]}-{j + 1}", secondKind));
        }
        return MakeSchedule("metronome", cues, null, null, null, null, 0);
    }

    // ---- Verification (moderators; human-measured input) ---------------------------
    public static VerifyResult Verify(int[] table, int tid, double menuToPressS, int toleranceFrames = 3, double visibleLagFrames = 0.0,
        IReadOnlyList<TargetSet>? sets = null)
    {
        double predicted = SecondsToFrames(menuToPressS) - visibleLagFrames - MenuToTableFrames;
        var offsets = Invert(table, tid);
        int? best = NearestOffset(offsets, predicted);
        double? diff = best is null ? null : best.Value - predicted;
        return new VerifyResult
        {
            PredictedOffset = predicted, Offsets = offsets, Nearest = best, DifferenceFrames = diff,
            Consistent = best is not null && Math.Abs(diff!.Value) <= toleranceFrames, InTable = offsets.Length > 0,
            Verdict = Verdict(tid, sets), VisibleLagFrames = visibleLagFrames
        };
    }

    // ---- Gen 3 Emerald / FireRed / LeafGreen: the Secret ID from a typed Trainer ID ----
    public static readonly string[] TextSpeeds = { "slow", "mid", "fast" };

    public static uint LcrngNext(uint x) => Lcrng.Next(x);
    public static uint LcrngJump(uint x, long n)
    {
        if (n < 0) throw new ArgumentException("advances must be 0 or more");
        return Lcrng.Jump(x, (ulong)n);
    }
    public static int Hi16(uint x) => (int)((x >> 16) & 0xFFFF);
    public static int Tsv(int tid, int sid) => ((tid ^ sid) & 0xFFFF) >> 3;
    public static int Psv(uint pid) => (int)((((pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF) >> 3);
    public static int ShinyXor(int tid, int sid, uint pid) => (int)((uint)(tid ^ sid) ^ (pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF;
    public static bool IsShiny(int tid, int sid, uint pid) => ShinyXor(tid, sid, pid) < 8;
    public static int[] ShinySidsForPid(int tid, uint pid)
    {
        int b = (int)((uint)tid ^ (pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF;
        return Enumerable.Range(0, 8).Select(x => b ^ x).OrderBy(x => x).ToArray();
    }

    public static int SidAt(int tid, long k) => Hi16(LcrngJump((uint)(tid & 0xFFFF), k + 1));

    public static List<SidCandidate> SidCandidates(int tid, long kMin, long kMax)
    {
        if (tid < 0 || tid > 0xFFFF) throw new ArgumentException("a Trainer ID is 0..65535");
        if (kMin < 0 || kMax < kMin) throw new ArgumentException($"need 0 <= k_min <= k_max (got {kMin}, {kMax})");
        var out_ = new List<SidCandidate>();
        uint x = LcrngJump((uint)tid, kMin);
        for (long k = kMin; k <= kMax; k++)
        {
            x = LcrngNext(x);
            int sid = Hi16(x);
            out_.Add(new SidCandidate((int)k, sid, Tsv(tid, sid)));
        }
        return out_;
    }

    public static List<int> KForSid(int tid, int sid, int kMax = 200000)
    {
        var out_ = new List<int>();
        uint x = (uint)(tid & 0xFFFF);
        for (int k = 0; k <= kMax; k++)
        {
            x = LcrngNext(x);
            if (Hi16(x) == sid) out_.Add(k);
        }
        return out_;
    }

    public static (List<SidCandidate> Kept, Dictionary<int, string> Dropped) FilterCandidates(IEnumerable<SidCandidate> cands, int tid,
        IReadOnlyList<uint>? shinyPids = null, IReadOnlyList<uint>? nonshinyPids = null, int? tsvValue = null)
    {
        shinyPids ??= Array.Empty<uint>();
        nonshinyPids ??= Array.Empty<uint>();
        var kept = new List<SidCandidate>();
        var why = new Dictionary<int, string>();
        foreach (var c in cands)
        {
            string? reason = null;
            foreach (uint pid in shinyPids)
            {
                if (!IsShiny(tid, c.Sid, pid)) { reason = $"PID {pid:X8} would not be shiny under SID {c.Sid}"; break; }
            }
            if (reason is null)
            {
                foreach (uint pid in nonshinyPids)
                {
                    if (IsShiny(tid, c.Sid, pid)) { reason = $"PID {pid:X8} would be shiny under SID {c.Sid}"; break; }
                }
            }
            if (reason is null && tsvValue is not null && c.Tsv != tsvValue) reason = $"TSV {c.Tsv} is not {tsvValue}";
            if (reason is null) kept.Add(c); else why[c.K] = reason;
        }
        return (kept, why);
    }

    public static (List<SidCandidate> Kept, Dictionary<int, string> Dropped) FilterByPid(IEnumerable<SidCandidate> cands, int tid, uint pid, bool shiny)
        => shiny ? FilterCandidates(cands, tid, new[] { pid }, null, null) : FilterCandidates(cands, tid, null, new[] { pid }, null);

    public static uint ParsePid(string text)
    {
        string s = text.Trim().Replace(" ", "");
        if (s.Length == 0) throw new ArgumentException("empty");
        long v;
        if (s.StartsWith("$")) v = ParseDigits(s[1..], 16);
        else if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) v = ParseDigits(s[2..], 16);
        else if (s.EndsWith("h", StringComparison.OrdinalIgnoreCase)) v = ParseDigits(s[..^1], 16);
        else v = ParseDigits(s, 10);
        if (v < 0 || v > 0xFFFFFFFFL) throw new ArgumentException("a PID is 0..4294967295 (8 hex digits)");
        return (uint)v;
    }

    public static List<(string Stage, int Frames)> StagePressToPress(SidModel model, int nameLength, string textSpeed = "mid")
    {
        if (!model.TextSpeed.TryGetValue(textSpeed, out var m)) throw new ArgumentException($"no text speed '{textSpeed}'");
        var measured = m.NameLengths;
        if (measured.TryGetValue(nameLength, out var exact))
            return model.Stages.Select((s, i) => (s, exact[i])).ToList();
        int lo = measured.Keys.Min(), hi = measured.Keys.Max();
        if (!(lo <= nameLength && nameLength <= hi)) throw new ArgumentException($"name length {nameLength} is outside the measured range {lo}-{hi}");
        var out_ = new List<(string, int)>();
        for (int i = 0; i < model.Stages.Length; i++)
        {
            double d = measured[lo][i] + (nameLength - lo) * (measured[hi][i] - measured[lo][i]) / (double)(hi - lo);
            if (Math.Abs(d - Math.Round(d)) > 1e-9) throw new ArgumentException($"name length {nameLength} gives a non-integer count for {model.Stages[i]}");
            out_.Add((model.Stages[i], (int)Math.Round(d)));
        }
        return out_;
    }

    public static int KFixed(SidModel model, int nameLength, string textSpeed = "mid")
        => StagePressToPress(model, nameLength, textSpeed).Sum(e => e.Frames) + model.TextSpeed[textSpeed].LastPressToSid;

    public static List<(string Stage, int Frames)> CueBeeps(SidModel model, int nameLength, string textSpeed, int marginFrames)
    {
        int t = model.OkToSeed;
        var out_ = new List<(string, int)>();
        foreach (var (stage, d) in StagePressToPress(model, nameLength, textSpeed))
        {
            t += d + marginFrames;
            out_.Add((stage, t));
        }
        return out_;
    }

    public static (int KExpected, int KMin, int KMax, List<(string Stage, int Frames)> Beeps) KWindowForCue(SidModel model, int nameLength,
        string textSpeed, int marginFrames, int earlyFrames, int lateFrames)
    {
        var beeps = CueBeeps(model, nameLength, textSpeed, marginFrames);
        int kExp = KFixed(model, nameLength, textSpeed) + beeps.Count * marginFrames;
        return (kExp, kExp - earlyFrames, kExp + lateFrames, beeps);
    }

    public static (int KExpected, int KMin, int KMax) CueWindow(int kFixed, int presses, int marginFrames, int earlyFrames = 6, int lateFrames = 20)
    {
        int kExp = kFixed + presses * marginFrames;
        return (kExp, kExp - earlyFrames, kExp + lateFrames);
    }

    public static double GbaFramesToSeconds(double frames) => frames / Lcrng.GbaFps;

    // ---- The runner's press jitter (rngsolution/jitter.py) --------------------------
    public const double MadToSd = 1.482602218505602;
    public const double MinAnchorSdMs = 4.0;
    public const int DriftTail = 3;
    public const double DriftThresholdMs = FrameMs;
    public const double WelchStrongT = 2.5;
    public const double SdIntervalConf = 0.90;
    public const int SmallN = 5;

    public static double Variance(IReadOnlyList<double> xs)
    {
        int n = xs.Count;
        if (n < 2) return double.NaN;
        double m = Mean(xs), s = 0.0;
        foreach (double x in xs) s += (x - m) * (x - m);
        return s / (n - 1);
    }

    public static double Sd(IReadOnlyList<double> xs)
    {
        double v = Variance(xs);
        return double.IsNaN(v) ? v : Math.Sqrt(v);
    }

    public static double Median(IReadOnlyList<double> xs)
    {
        var s = xs.OrderBy(x => x).ToArray();
        int n = s.Length;
        if (n == 0) return double.NaN;
        if (n % 2 == 1) return s[n / 2];
        return (s[n / 2 - 1] + s[n / 2]) / 2.0;
    }

    public static double Mad(IReadOnlyList<double> xs)
    {
        if (xs.Count < 2) return double.NaN;
        double m = Median(xs);
        return Median(xs.Select(x => Math.Abs(x - m)).ToArray());
    }

    public static double RobustSd(IReadOnlyList<double> xs)
    {
        double d = Mad(xs);
        return double.IsNaN(d) ? d : d * MadToSd;
    }

    public static AnchorStats AnchorStatsOf(IReadOnlyList<double> impliedMs) => new()
    {
        N = impliedMs.Count, MeanMs = Mean(impliedMs), SdMs = Sd(impliedMs), RobustSdMs = RobustSd(impliedMs), MedianMs = Median(impliedMs),
        MinMs = impliedMs.Count > 0 ? impliedMs.Min() : double.NaN, MaxMs = impliedMs.Count > 0 ? impliedMs.Max() : double.NaN, ValuesMs = impliedMs.ToArray()
    };

    // erf: fdlibm s_erf.c (the same algorithm and coefficients as the C library's), <1 ulp.
    const double Erx = 8.45062911510467529297e-01, Efx = 1.28379167095512586316e-01, Efx8 = 1.02703333676410069053e+00;
    static readonly double[] Pp = { 1.28379167095512558561e-01, -3.25042107247001499370e-01, -2.84817495755985104766e-02, -5.77027029648944159157e-03, -2.37630166566501626084e-05 };
    static readonly double[] Qq = { 3.97917223959155352819e-01, 6.50222499887672944485e-02, 5.08130628187576562776e-03, 1.32494738004321644526e-04, -3.96022827877536812320e-06 };
    static readonly double[] Pa = { -2.36211856075265944077e-03, 4.14856118683748331666e-01, -3.72207876035701323847e-01, 3.18346619901161753674e-01, -1.10894694282396677476e-01, 3.54783043256182359371e-02, -2.16637559486879084300e-03 };
    static readonly double[] Qa = { 1.06420880400844228286e-01, 5.40397917702171048937e-01, 7.18286544141962662868e-02, 1.26171219808761642112e-01, 1.36370839120290507362e-02, 1.19844998467991074170e-02 };
    static readonly double[] Ra = { -9.86494403484714822705e-03, -6.93858572707181764372e-01, -1.05586262253232909814e+01, -6.23753324503260060396e+01, -1.62396669462573470355e+02, -1.84605092906711035994e+02, -8.12874355063065934246e+01, -9.81432934416914548592e+00 };
    static readonly double[] Sa = { 1.96512716674392571292e+01, 1.37657754143519042600e+02, 4.34565877475229228821e+02, 6.45387271733267880336e+02, 4.29008140027567833386e+02, 1.08635005541779435134e+02, 6.57024977031928170135e+00, -6.04244152148580987438e-02 };
    static readonly double[] Rb = { -9.86494292470009928597e-03, -7.99283237680523006574e-01, -1.77579549177547519889e+01, -1.60636384855821916062e+02, -6.37566443368389627722e+02, -1.02509513161107724954e+03, -4.83519191608651397019e+02 };
    static readonly double[] Sb = { 3.03380607434824582924e+01, 3.25792512996573918826e+02, 1.53672958608443695994e+03, 3.19985821950859553908e+03, 2.55305040643316442583e+03, 4.74528541206955367215e+02, -2.24409524465858183362e+01 };

    static double Poly(double[] c, double z)
    {
        double r = c[^1];
        for (int i = c.Length - 2; i >= 0; i--) r = c[i] + z * r;
        return r;
    }

    static double TruncLow(double x) => BitConverter.Int64BitsToDouble(BitConverter.DoubleToInt64Bits(x) & unchecked((long)0xFFFFFFFF00000000L));

    public static double Erf(double x)
    {
        if (double.IsNaN(x)) return double.NaN;
        if (double.IsPositiveInfinity(x)) return 1.0;
        if (double.IsNegativeInfinity(x)) return -1.0;
        double ax = Math.Abs(x);
        if (ax < 0.84375)
        {
            if (ax < 3.7252902984e-09)
            {
                if (ax < 2.848094538889218e-306) return 0.125 * (8.0 * x + Efx8 * x);
                return x + Efx * x;
            }
            double z = x * x;
            double r = Poly(Pp, z);
            double s = 1.0 + z * Poly(Qq, z);
            return x + x * (r / s);
        }
        if (ax < 1.25)
        {
            double s = ax - 1.0;
            double P = Poly(Pa, s);
            double Q = 1.0 + s * Poly(Qa, s);
            return x >= 0 ? Erx + P / Q : -Erx - P / Q;
        }
        if (ax >= 6.0) return x >= 0 ? 1.0 - 1e-300 : 1e-300 - 1.0;
        double s2 = 1.0 / (ax * ax);
        double R, S;
        if (ax < 1.0 / 0.35) { R = Poly(Ra, s2); S = 1.0 + s2 * Poly(Sa, s2); }
        else { R = Poly(Rb, s2); S = 1.0 + s2 * Poly(Sb, s2); }
        double zz = TruncLow(ax);
        double rr = Math.Exp(-zz * zz - 0.5625) * Math.Exp((zz - ax) * (zz + ax) + R / S);
        return x >= 0 ? 1.0 - rr / ax : rr / ax - 1.0;
    }

    static readonly double[] Lanczos = { 0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7 };

    public static double LGamma(double z)
    {
        if (z < 0.5) return Math.Log(Math.PI / Math.Abs(Math.Sin(Math.PI * z))) - LGamma(1.0 - z);
        z -= 1.0;
        double x = Lanczos[0];
        for (int i = 1; i < 9; i++) x += Lanczos[i] / (z + i);
        double t = z + 7.5;
        return 0.5 * Math.Log(2.0 * Math.PI) + (z + 0.5) * Math.Log(t) - t + Math.Log(x);
    }

    public static double Phi(double z) => 0.5 * (1.0 + Erf(z / Math.Sqrt(2.0)));
    public static double NormalPdf(double z) => Math.Exp(-0.5 * z * z) / Math.Sqrt(2.0 * Math.PI);
    static double BigPhiIntegral(double z) => z * Phi(z) + NormalPdf(z);

    public static double HitProbability(double sdMs, double frameMs = FrameMs, double biasMs = 0.0)
    {
        if (frameMs <= 0) throw new ArgumentException("the frame length must be positive");
        if (sdMs < 0) throw new ArgumentException("the standard deviation cannot be negative");
        double half = frameMs / 2.0;
        if (sdMs == 0) return (-half <= biasMs && biasMs < half) ? 1.0 : 0.0;
        return Phi((half - biasMs) / sdMs) - Phi((-half - biasMs) / sdMs);
    }

    public static double HitProbabilityQuantised(double sdMs, double frameMs = FrameMs, double biasMs = 0.0, double? phase = null)
    {
        if (frameMs <= 0) throw new ArgumentException("the frame length must be positive");
        if (sdMs < 0) throw new ArgumentException("the standard deviation cannot be negative");
        if (phase is not null)
        {
            if (!(0.0 <= phase.Value && phase.Value <= 1.0)) throw new ArgumentException("phase is a fraction of a frame, 0..1");
            double lo = -phase.Value * frameMs - biasMs, hi = (1.0 - phase.Value) * frameMs - biasMs;
            if (sdMs == 0) return (lo <= 0 && 0 < hi) ? 1.0 : 0.0;
            return Phi(hi / sdMs) - Phi(lo / sdMs);
        }
        if (sdMs == 0) return Math.Max(0.0, 1.0 - Math.Abs(biasMs) / frameMs);
        return (sdMs / frameMs) * (BigPhiIntegral((frameMs - biasMs) / sdMs) - 2.0 * BigPhiIntegral(-biasMs / sdMs) + BigPhiIntegral((-frameMs - biasMs) / sdMs));
    }

    static double RegularisedGammaP(double a, double x)
    {
        if (x <= 0) return 0.0;
        if (x < a + 1.0)
        {
            double term = 1.0 / a, total = 1.0 / a, ap = a;
            for (int i = 0; i < 500; i++)
            {
                ap += 1.0;
                term *= x / ap;
                total += term;
                if (Math.Abs(term) < Math.Abs(total) * 1e-15) break;
            }
            return total * Math.Exp(-x + a * Math.Log(x) - LGamma(a));
        }
        const double tiny = 1e-300;
        double b = x + 1.0 - a, c = 1.0 / tiny, d = 1.0 / b, h = d;
        for (int j = 1; j < 500; j++)
        {
            double an = -j * (j - a);
            b += 2.0;
            d = an * d + b;
            if (Math.Abs(d) < tiny) d = tiny;
            c = b + an / c;
            if (Math.Abs(c) < tiny) c = tiny;
            d = 1.0 / d;
            double delta = d * c;
            h *= delta;
            if (Math.Abs(delta - 1.0) < 1e-15) break;
        }
        return 1.0 - Math.Exp(-x + a * Math.Log(x) - LGamma(a)) * h;
    }

    public static double Chi2Cdf(double x, int k)
    {
        if (k <= 0) throw new ArgumentException("degrees of freedom must be positive");
        return RegularisedGammaP(k / 2.0, x / 2.0);
    }

    public static double Chi2Quantile(double p, int k)
    {
        if (!(0 < p && p < 1)) throw new ArgumentException("p must be in (0, 1)");
        double lo = 0.0, hi = Math.Max(10.0, 4.0 * k);
        while (Chi2Cdf(hi, k) < p) hi *= 2.0;
        for (int i = 0; i < 200; i++)
        {
            double mid = (lo + hi) / 2.0;
            if (Chi2Cdf(mid, k) < p) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2.0;
    }

    public static (double Lo, double Hi) SdInterval(double sdMs, int n, double conf = SdIntervalConf)
    {
        if (n < 2 || double.IsNaN(sdMs)) return (double.NaN, double.NaN);
        int k = n - 1;
        return (sdMs * Math.Sqrt(k / Chi2Quantile((1.0 + conf) / 2.0, k)), sdMs * Math.Sqrt(k / Chi2Quantile((1.0 - conf) / 2.0, k)));
    }

    public static (double PLow, double PHigh) HitProbabilityRange(double sdMs, int n, double frameMs = FrameMs, double conf = SdIntervalConf, bool centred = true)
    {
        var (lo, hi) = SdInterval(sdMs, n, conf);
        if (double.IsNaN(lo)) return (double.NaN, double.NaN);
        return centred
            ? (HitProbability(hi, frameMs), HitProbability(lo, frameMs))
            : (HitProbabilityQuantised(hi, frameMs), HitProbabilityQuantised(lo, frameMs));
    }

    public static (double P, bool Centred) HitProbabilityHeadline(double sdMs, int n, double frameMs = FrameMs)
        => n < SmallN ? (HitProbabilityQuantised(sdMs, frameMs), false) : (HitProbability(sdMs, frameMs), true);

    public static double ExpectedAttempts(double p) => p <= 0 ? double.PositiveInfinity : 1.0 / p;

    public static double SdForProbability(double p, double frameMs = FrameMs, double biasMs = 0.0)
    {
        if (!(0 < p && p <= 1)) throw new ArgumentException("p must be in (0, 1]");
        if (HitProbability(0.0, frameMs, biasMs) <= p) return 0.0;
        double lo = 0.0, hi = frameMs;
        while (HitProbability(hi, frameMs, biasMs) > p)
        {
            hi *= 2.0;
            if (hi > 1e6) return double.PositiveInfinity;
        }
        for (int i = 0; i < 80; i++)
        {
            double mid = (lo + hi) / 2.0;
            if (HitProbability(mid, frameMs, biasMs) > p) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2.0;
    }

    public static double? WelchT(IReadOnlyList<double> a, IReadOnlyList<double> b)
    {
        if (a.Count < 2 || b.Count < 2) return null;
        double se2 = Variance(a) / a.Count + Variance(b) / b.Count;
        if (se2 <= 0) return null;
        return (Mean(a) - Mean(b)) / Math.Sqrt(se2);
    }

    public static DriftResult Drift(IReadOnlyList<double> values, int tailN = DriftTail, double thresholdMs = DriftThresholdMs, int minHead = DriftTail,
        double strongT = WelchStrongT)
    {
        int n = values.Count;
        var out_ = new DriftResult { Flag = false, N = n, TailN = tailN, HeadN = Math.Max(0, n - tailN), ThresholdMs = thresholdMs };
        if (n < tailN + minHead)
        {
            out_.Reason = $"too few samples ({n}; drift needs {tailN + minHead})";
            return out_;
        }
        var head = values.Take(n - tailN).ToArray();
        var tail = values.Skip(n - tailN).ToArray();
        double hm = Mean(head), tm = Mean(tail);
        double? t = WelchT(tail, head);
        out_.HeadN = head.Length; out_.HeadMeanMs = hm; out_.TailMeanMs = tm; out_.ShiftMs = tm - hm; out_.WelchT = t;
        bool shifted = Math.Abs(tm - hm) >= thresholdMs;
        out_.Flag = shifted && (t is null || Math.Abs(t.Value) >= strongT);
        if (out_.Flag)
        {
            out_.Strength = "strong";
            out_.Reason = $"the last {tailN} samples' mean is {PyFixed(tm - hm, 1, true)} ms from the earlier {head.Length} (threshold {PyFixed(thresholdMs, 1)} ms)";
        }
        else if (shifted)
        {
            out_.Strength = "weak";
            out_.Reason = $"the last {tailN} samples' mean is {PyFixed(tm - hm, 1, true)} ms from the earlier {head.Length}, but within their scatter" +
                          $" (Welch t {PyFixed(t!.Value, 2)}, below {PyFixed(strongT, 1)}): not flagged";
        }
        else
        {
            out_.Reason = $"the last {tailN} samples' mean is {PyFixed(tm - hm, 1, true)} ms from the earlier {head.Length}: within {PyFixed(thresholdMs, 1)} ms";
        }
        return out_;
    }

    public static FuseResult Fuse(IReadOnlyList<(double Value, double Variance)> estimates)
    {
        if (estimates.Count == 0) throw new ArgumentException("nothing to fuse");
        foreach (var e in estimates) if (!(e.Variance > 0)) throw new ArgumentException($"every variance must be positive (got {Py(e.Variance)})");
        var ws = estimates.Select(e => 1.0 / e.Variance).ToArray();
        double total = 0.0;
        foreach (double w in ws) total += w;
        double value = 0.0;
        for (int i = 0; i < ws.Length; i++) value += ws[i] * estimates[i].Value;
        value /= total;
        return new FuseResult(value, 1.0 / total, ws.Select(w => w / total).ToArray());
    }

    public static double SplitAnchorSd(double totalSdMs, double? pressSdMs = null, double minAnchorSdMs = MinAnchorSdMs)
    {
        double p = pressSdMs ?? 0.0;
        return Math.Max(minAnchorSdMs, Math.Sqrt(Math.Max(0.0, totalSdMs * totalSdMs - p * p)));
    }

    public static FuseCuesResult FuseCues(IReadOnlyList<(string Anchor, double TimeS, double SdMs)> cues, double? pressSdMs = null,
        double frameMs = FrameMs, double minAnchorSdMs = MinAnchorSdMs)
    {
        if (cues.Count < 2) throw new ArgumentException("fusion needs at least two anchors");
        double p = pressSdMs ?? 0.0;
        var parts = cues.Select(c =>
        {
            double aSd = SplitAnchorSd(c.SdMs, pressSdMs, minAnchorSdMs);
            return new AnchorPart { Anchor = c.Anchor, TimeS = c.TimeS, SdMs = c.SdMs, AnchorSdMs = aSd, Variance = aSd * aSd };
        }).ToArray();
        bool floored = parts.All(x => x.SdMs * x.SdMs - p * p <= minAnchorSdMs * minAnchorSdMs);
        var best = parts[0];
        for (int i = 1; i < parts.Length; i++) if (parts[i].SdMs < best.SdMs) best = parts[i];
        double fusedT, fusedVar;
        double[] weights;
        if (floored)
        {
            fusedT = best.TimeS;
            fusedVar = best.SdMs * best.SdMs - p * p;
            weights = parts.Select(x => ReferenceEquals(x, best) ? 1.0 : 0.0).ToArray();
            fusedVar = Math.Max(fusedVar, 0.0);
        }
        else
        {
            var f = Fuse(parts.Select(x => (x.TimeS, x.Variance)).ToArray());
            fusedT = f.Value; fusedVar = f.Variance; weights = f.Weights;
        }
        for (int i = 0; i < parts.Length; i++) parts[i].Weight = weights[i];
        double fusedAnchorSd = Math.Sqrt(fusedVar);
        double fusedTotalSd = floored ? best.SdMs : Math.Sqrt(fusedVar + p * p);
        double pSingle = HitProbability(best.SdMs, frameMs), pFused = HitProbability(fusedTotalSd, frameMs);
        string assumption;
        if (floored)
            assumption = $"the press scatter ({PyFixed(p, 1)} ms, press trainer) is at least each anchor's whole spread, so the" +
                         $" ENTER parts are both at the {PyFixed(minAnchorSdMs, 1)} ms floor and the weights are uninformative: the cue comes" +
                         $" from the tighter anchor ({best.Anchor}) alone; re-run 'train' or recalibrate before trusting a fusion";
        else if (pressSdMs is not null && pressSdMs.Value != 0.0)
            assumption = $"the press scatter is {PyFixed(p, 1)} ms (press trainer), the rest of each anchor's spread is its ENTER";
        else
            assumption = "no press measurement: all of each anchor's spread is taken as its ENTER, so the fused sd is" +
                         " an upper bound on the improvement ('train' measures the press)";
        return new FuseCuesResult
        {
            TimeS = fusedT, SdMs = fusedTotalSd, AnchorSdMs = fusedAnchorSd, PressSdMs = p, Weights = weights, Anchors = parts,
            BestSingle = best.Anchor, BestSingleSdMs = best.SdMs, PSingle = pSingle, PFused = pFused,
            AttemptsSingle = ExpectedAttempts(pSingle), AttemptsFused = ExpectedAttempts(pFused), Floored = floored, Assumption = assumption
        };
    }

    public static double AnchorCueTime(double enterT, double delayS, double correctionMs) => enterT + delayS - correctionMs / 1000.0;
    public static double CorrectionUsedFor(double delayS, double enterT, double cueT) => (delayS - (cueT - enterT)) * 1000.0;

    public static (string Code, string Text) Recommendation(AnchorStats stats, DriftResult? driftResult, double frameMs = FrameMs,
        double? pressSdMs = null, bool robust = false)
    {
        int n = stats.N;
        double s = robust ? stats.RobustSdMs : stats.SdMs;
        if (n < 2 || double.IsNaN(s))
            return ("few", $"{n} sample{(n == 1 ? "" : "s")}: no spread yet. Calibrate 2 attempts for a first sd, 3 or more to trust it;" +
                           " 'train' measures your press alone without a game.");
        double p = HitProbability(s, frameMs);
        if (driftResult is { Flag: true })
            return ("setup", $"RECALIBRATE / SETUP CHANGED ({driftResult.Strength} drift): {driftResult.Reason}. Something moved: the audio player, the" +
                             " display or capture path, the console, or how you hold. Check the player is the one the" +
                             " samples were taken with; drop the stale samples (calibrate --drop-last, or --clear) and" +
                             " re-sample before trusting the correction.");
        string weak = driftResult is { Strength: "weak" }
            ? " (The last samples sit a frame from the earlier ones but within their scatter; keep an eye on it, it is not a drift call.)" : "";
        if (pressSdMs is not null && pressSdMs.Value != 0.0 && pressSdMs.Value >= 0.8 * s)
            return ("press", $"PRACTICE THE PRESS: your A press alone scatters {PyFixed(pressSdMs.Value, 1)} ms (press trainer), most of the" +
                             $" {PyFixed(s, 1)} ms spread here, so no correction can raise P(hit) above about {PyFixed(100.0 * HitProbability(pressSdMs.Value, frameMs), 0)} %. 'train'" +
                             " sessions tighten it; the correction itself is fine.");
        if (s > frameMs)
        {
            double need = SdForProbability(0.5, frameMs);
            return ("anchor", $"the spread ({PyFixed(s, 1)} ms) is wider than a frame: P(hit) {PyFixed(100.0 * p, 0)} %. Run 'train' to measure the" +
                              " press alone: a tight press means the ENTER is the spread (use the menu anchor, or both" +
                              $" anchors with --dual-anchor); a wide press means practice. sd {PyFixed(need, 1)} ms would give 50 %.{weak}");
        }
        return ("tight", $"tight: sd {PyFixed(s, 1)} ms is within a frame (P(hit) {PyFixed(100.0 * p, 0)} %). Keep calibrating; every sample" +
                         $" sharpens the mean, and drift will be flagged if the setup moves.{weak}");
    }
}

// One Gen 1 methodology record from gen1-tid.json with its table decoded.
public sealed class Gen1Methodology
{
    public string Id { get; init; } = "";
    public string GameKey { get; init; } = "";
    public string ConsoleId { get; init; } = "";
    public string[] Anchors { get; init; } = Array.Empty<string>();
    public string TableFile { get; init; } = "";
    public Gen1Timing Timing { get; init; } = new();
    public int[] Table { get; init; } = Array.Empty<int>();
    public JsonElement Raw { get; init; }
}

// core/data/gen1-tid.json: a copy beside the executable wins, else the embedded resource.
public sealed class Gen1TidData
{
    public JsonElement Root { get; }
    readonly Dictionary<string, Gen1Methodology> _methodologies = new();

    public Gen1TidData(JsonElement root)
    {
        Root = root;
        foreach (var m in root.GetProperty("methodologies").EnumerateObject())
        {
            var t = m.Value.GetProperty("timing");
            var td = m.Value.GetProperty("table_data");
            _methodologies[m.Name] = new Gen1Methodology
            {
                Id = m.Name,
                GameKey = m.Value.GetProperty("game_key").GetString() ?? "",
                ConsoleId = m.Value.GetProperty("console_id").GetString() ?? "",
                Anchors = m.Value.GetProperty("anchors").EnumerateArray().Select(x => x.GetString() ?? "").ToArray(),
                TableFile = td.GetProperty("file").GetString() ?? "",
                Timing = new Gen1Timing
                {
                    HoldLoFrame = t.GetProperty("hold_lo_frame").GetInt32(),
                    HoldHiFrame = t.GetProperty("hold_hi_frame").GetInt32(),
                    MenuFrame = t.GetProperty("menu_frame").GetInt32(),
                    VisibleLagFrames = t.TryGetProperty("visible_lag_frames", out var vl) ? vl.GetDouble() : 0.0,
                    VisibleLagNote = t.TryGetProperty("visible_lag_note", out var vn) ? vn.GetString() ?? "" : "",
                    VerifiedTargets = t.TryGetProperty("verified_targets", out var vt) ? vt.EnumerateArray().Select(x => x.GetInt32()).ToArray() : Array.Empty<int>(),
                    VerifiedTargetsNote = t.TryGetProperty("verified_targets_note", out var vtn) ? vtn.GetString() ?? "" : ""
                },
                Table = Gen1Tid.DecodeTable(td.GetProperty("tids_hex").GetString() ?? "", td.GetProperty("offset_min").GetInt32()),
                Raw = m.Value
            };
        }
    }

    public static string DefaultFileName => "gen1-tid.json";

    public static Gen1TidData Load()
    {
        string beside = Path.Combine(AppContext.BaseDirectory, DefaultFileName);
        return File.Exists(beside) ? LoadFile(beside) : LoadEmbedded();
    }

    public static Gen1TidData LoadFile(string path) => new(JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone());

    public static Gen1TidData LoadEmbedded() => new(ParseEmbedded("data.gen1-tid"));

    internal static JsonElement ParseEmbedded(string logicalName)
    {
        using var stream = typeof(Gen1TidData).Assembly.GetManifestResourceStream(logicalName)
            ?? throw new FileNotFoundException($"embedded resource {logicalName} is missing");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return JsonDocument.Parse(reader.ReadToEnd()).RootElement.Clone();
    }

    public IEnumerable<string> MethodologyIds => _methodologies.Keys;
    public int MenuToTableFrames => Root.GetProperty("menu_to_table_frames").GetInt32();

    public Gen1Methodology Methodology(string id)
        => _methodologies.TryGetValue(id, out var m) ? m : throw new ArgumentException($"no methodology '{id}' in the data");

    public ResetModel ResetModel(string key)
    {
        var e = Root.GetProperty("reset_models").GetProperty(key);
        return ParseResetModel(e);
    }

    public static ResetModel ParseResetModel(JsonElement e)
    {
        var paths = new Dictionary<string, ResetPath>();
        foreach (var p in e.GetProperty("paths").EnumerateObject())
        {
            var v = p.Value;
            paths[p.Name] = new ResetPath
            {
                C1MeanFrames = v.GetProperty("c1_mean_frames").GetDouble(),
                C1MaxFrames = v.GetProperty("c1_max_frames").GetDouble(),
                P1MeanFrames = v.GetProperty("p1_mean_frames").GetDouble(),
                P1MinFrames = v.GetProperty("p1_min_frames").GetDouble(),
                PadReadFrames = v.TryGetProperty("pad_read_frames", out var r) ? r.GetDouble() : null,
                PadReadMinFrames = v.TryGetProperty("pad_read_min_frames", out var rmin) ? rmin.GetDouble() : null,
                PadReadMaxFrames = v.TryGetProperty("pad_read_max_frames", out var rmax) ? rmax.GetDouble() : null
            };
        }
        return new ResetModel
        {
            Order = e.GetProperty("order").EnumerateArray().Select(x => x.GetString() ?? "").ToArray(),
            FadeLoFrames = e.TryGetProperty("fade_lo_frames", out var flo) ? flo.GetDouble() : null,
            FadeHiFrames = e.TryGetProperty("fade_hi_frames", out var fhi) ? fhi.GetDouble() : null,
            StallFrames = e.TryGetProperty("stall_frames", out var st) ? st.GetDouble() : null,
            Paths = paths
        };
    }

    public TargetSet TargetSet(string key) => new(key, Root.GetProperty("target_sets").GetProperty(key));

    // The sets in force for a game: its default sets, or the ones named (each must exist and list the game).
    public List<TargetSet> TargetSetsFor(string gameKey, IReadOnlyList<string>? keys = null)
    {
        var all = Root.GetProperty("target_sets");
        var games = Root.GetProperty("games");
        JsonElement g = games.TryGetProperty(gameKey, out var ge) ? ge : default;
        List<string> wanted;
        if (keys is { Count: > 0 }) wanted = keys.ToList();
        else if (g.ValueKind == JsonValueKind.Object && g.TryGetProperty("default_target_sets", out var d) && d.GetArrayLength() > 0)
            wanted = d.EnumerateArray().Select(x => x.GetString() ?? "").ToList();
        else if (g.ValueKind == JsonValueKind.Object && g.TryGetProperty("target_sets", out var ts))
            wanted = ts.EnumerateArray().Select(x => x.GetString() ?? "").ToList();
        else wanted = new List<string>();
        var out_ = new List<TargetSet>();
        foreach (var k in wanted)
        {
            if (!all.TryGetProperty(k, out var spec))
                throw new ArgumentException($"target set '{k}' is not defined (choose from {string.Join(", ", all.EnumerateObject().Select(x => x.Name))})");
            var set = new TargetSet(k, spec);
            if (!set.Games.Contains(gameKey)) throw new ArgumentException($"target set '{k}' is not defined for {gameKey}");
            out_.Add(set);
        }
        return out_;
    }
}

// core/data/gen3-sid.json: the Emerald / FireRed / LeafGreen typed-TID -> SID models.
public sealed class Gen3SidData
{
    public JsonElement Root { get; }
    public Gen3SidData(JsonElement root) { Root = root; }

    public static string DefaultFileName => "gen3-sid.json";

    public static Gen3SidData Load()
    {
        string beside = Path.Combine(AppContext.BaseDirectory, DefaultFileName);
        return File.Exists(beside) ? LoadFile(beside) : LoadEmbedded();
    }

    public static Gen3SidData LoadFile(string path) => new(JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone());
    public static Gen3SidData LoadEmbedded() => new(Gen1TidData.ParseEmbedded("data.gen3-sid"));

    public IEnumerable<string> MethodologyIds => Root.GetProperty("methodologies").EnumerateObject().Select(x => x.Name);

    public JsonElement RawModel(string methodologyId)
    {
        if (!Root.GetProperty("methodologies").TryGetProperty(methodologyId, out var m)) throw new ArgumentException($"no methodology '{methodologyId}' in the data");
        return m.GetProperty("model");
    }

    public string[] VariantNames(string methodologyId) => VariantNames(RawModel(methodologyId));

    public static string[] VariantNames(JsonElement model)
        => model.TryGetProperty("variants", out var v) ? v.EnumerateObject().Select(x => x.Name).ToArray() : Array.Empty<string>();

    public string? DefaultVariant(string methodologyId)
        => RawModel(methodologyId).TryGetProperty("default_variant", out var d) ? d.GetString() : null;

    public SidModel Variant(string methodologyId, string? name = null) => Variant(RawModel(methodologyId), name);

    // gen3.variant: the variant's own keys over the shared ones.
    public static SidModel Variant(JsonElement model, string? name = null)
    {
        var names = VariantNames(model);
        JsonElement v = default;
        string resolved = "";
        if (names.Length > 0)
        {
            resolved = name ?? (model.TryGetProperty("default_variant", out var d) ? d.GetString() ?? names[0] : names[0]);
            if (!model.GetProperty("variants").TryGetProperty(resolved, out v))
                throw new ArgumentException($"no input path '{resolved}' (choose from {string.Join(", ", names)})");
        }
        JsonElement Pick(string key, out bool found)
        {
            if (v.ValueKind == JsonValueKind.Object && v.TryGetProperty(key, out var vv)) { found = true; return vv; }
            if (model.TryGetProperty(key, out var mv)) { found = true; return mv; }
            found = false; return default;
        }
        var speeds = new Dictionary<string, SidSpeedModel>();
        var ts = Pick("text_speed", out bool hasTs);
        if (hasTs)
        {
            foreach (var sp in ts.EnumerateObject())
            {
                var nl = new Dictionary<int, int[]>();
                foreach (var l in sp.Value.GetProperty("name_lengths").EnumerateObject())
                    nl[int.Parse(l.Name, CultureInfo.InvariantCulture)] = l.Value.GetProperty("press_to_press").EnumerateArray().Select(x => x.GetInt32()).ToArray();
                speeds[sp.Name] = new SidSpeedModel { NameLengths = nl, LastPressToSid = sp.Value.GetProperty("last_press_to_sid").GetInt32() };
            }
        }
        var stageText = new Dictionary<string, string>();
        var st = Pick("stage_text", out bool hasSt);
        if (hasSt) foreach (var p in st.EnumerateObject()) stageText[p.Name] = p.Value.GetString() ?? "";
        var stages = Pick("stages", out bool hasStages);
        var nameEl = Pick("name", out bool hasName);
        var okEl = Pick("ok_to_seed", out bool hasOk);
        var spanEl = Pick("k_default_span", out bool hasSpan);
        var statusEl = Pick("status", out bool hasStatus);
        return new SidModel
        {
            Variant = resolved,
            Name = hasName ? nameEl.GetString() ?? "" : "",
            OkToSeed = hasOk ? okEl.GetInt32() : 0,
            KDefaultSpan = hasSpan ? spanEl.GetInt32() : 0,
            Status = hasStatus ? statusEl.GetString() ?? "" : "",
            Stages = hasStages ? stages.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : Array.Empty<string>(),
            StageText = stageText,
            TextSpeed = speeds
        };
    }
}
