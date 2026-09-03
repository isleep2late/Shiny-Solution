using System.Text.Json;
using ShinySolution.Core;

// app/Core/Gen2Tid.cs against tests/gen2tid-vectors.json (emitted by tests/gen2_reference.py from the derivation
// CSVs): the same cases tests/test-gen2tid.cjs checks in JS. Integers and strings exact, floats to 1e-9 (relative
// above |1|), {"error": ...} cases must throw.
static class Gen2TidChecks
{
    const double Tol = 1e-9;
    static int failures, checks;

    static readonly JsonSerializerOptions Out = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, IncludeFields = true };

    static JsonElement ToJson(object? o) => JsonSerializer.SerializeToElement(o, Out);

    static bool Same(JsonElement e, JsonElement a)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.String:
                return a.ValueKind == JsonValueKind.String && e.GetString() == a.GetString();
            case JsonValueKind.Number:
                if (a.ValueKind != JsonValueKind.Number) return false;
                if (e.TryGetInt64(out long ei) && a.TryGetInt64(out long ai)) return ei == ai;
                double ed = e.GetDouble(), ad = a.GetDouble();
                return Math.Abs(ad - ed) <= Tol * Math.Max(1.0, Math.Abs(ed));
            case JsonValueKind.True:
            case JsonValueKind.False:
                return e.ValueKind == a.ValueKind;
            case JsonValueKind.Null:
                return a.ValueKind == JsonValueKind.Null || a.ValueKind == JsonValueKind.Undefined;
            case JsonValueKind.Array:
                if (a.ValueKind != JsonValueKind.Array || e.GetArrayLength() != a.GetArrayLength()) return false;
                var ea = e.EnumerateArray().ToArray();
                var aa = a.EnumerateArray().ToArray();
                for (int i = 0; i < ea.Length; i++) if (!Same(ea[i], aa[i])) return false;
                return true;
            case JsonValueKind.Object:
                if (a.ValueKind != JsonValueKind.Object) return false;
                var ek = e.EnumerateObject().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToArray();
                var ak = a.EnumerateObject().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToArray();
                if (!ek.SequenceEqual(ak)) return false;
                foreach (var p in e.EnumerateObject()) if (!Same(p.Value, a.GetProperty(p.Name))) return false;
                return true;
            default:
                return false;
        }
    }

    static void Mismatch(string label, string expected, string actual)
    {
        failures++;
        if (failures <= 40) Console.Error.WriteLine($"FAIL {label}\n  expected {expected}\n  actual   {actual}");
    }

    static void Check(string label, JsonElement expected, object? actual)
    {
        checks++;
        var a = ToJson(actual);
        if (!Same(expected, a)) Mismatch(label, expected.GetRawText(), a.GetRawText());
    }

    static void Check(string label, object? expected, object? actual) => Check(label, ToJson(expected), actual);

    static void CheckCase(string label, JsonElement c, Func<object?> fn)
    {
        checks++;
        object? got = null;
        Exception? threw = null;
        try { got = fn(); } catch (Exception ex) { threw = ex; }
        if (c.TryGetProperty("error", out var err))
        {
            if (threw is null) Mismatch(label, $"error {err.GetString()}", ToJson(got).GetRawText());
        }
        else if (threw is not null) Mismatch(label, c.GetProperty("result").GetRawText(), $"threw {threw.GetType().Name}: {threw.Message}");
        else
        {
            var a = ToJson(got);
            if (!Same(c.GetProperty("result"), a)) Mismatch(label, c.GetProperty("result").GetRawText(), a.GetRawText());
        }
    }

    static double D(JsonElement e) => e.GetDouble();
    static double? DN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetDouble();
    static int I(JsonElement e) => e.GetInt32();
    static int? IN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetInt32();
    static string S(JsonElement e) => e.GetString() ?? "";
    static string? SN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetString();
    static string[] SA(JsonElement e) => e.EnumerateArray().Select(S).ToArray();
    static string[]? SAN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : SA(e);
    static JsonElement P(JsonElement e, string name) => e.GetProperty(name);

    static object Cand(Gen2Candidate c) => new { key = c.Key, members = c.Members, bin = c.Bin, offsets = c.Offsets, tid = c.Tid, lid = c.Lid, sid = c.Sid, family = c.Family, reachableAfterFirstBoot = c.ReachableAfterFirstBoot };
    static object Inv(Gen2Inversion r) => new { candidates = r.Candidates.Select(Cand), preferred = r.Preferred.Select(Cand), ambiguous = r.Ambiguous, resolved = r.Resolved is null ? null : Cand(r.Resolved) };
    static object Sched(Gen2Schedule s) => new
    {
        anchor = s.Anchor, tA = s.TA, holdLo = s.HoldLo, holdHi = s.HoldHi, menu = s.Menu, droppedCountIn = s.DroppedCountIn, duration = s.Duration, countInTimes = s.CountInTimes,
        cues = s.Cues.Select(c => new { t = c.T, freq = c.Freq, ms = c.Ms, label = c.Label, kind = c.Kind }), bin = s.Bin, aimOffset = s.AimOffset, aimV = s.AimV,
        aWindow = s.AWindow, tapMs = s.TapMs, rollSettleS = s.RollSettleS, methodology = s.Methodology
    };
    static object Hit(Gen2Target h) => new { bin = h.Bin, offsets = h.Offsets, tid = h.Tid, lid = h.Lid, sid = h.Sid, sets = h.Sets, reachableAfterFirstBoot = h.ReachableAfterFirstBoot };

    static (string? PlatformKey, string Family, string[]? States) SubsetOpts(string name)
    {
        if (name == "gbp_days0_and_days512") return ("gbp", "all", new[] { "days0", "days512" });
        if (name == "primaries_days0_all_platforms") return (null, "all", new[] { "days0" });
        foreach (var suffix in new[] { "_all_states", "_running_10", "_halted_distinct" })
        {
            if (name.EndsWith(suffix, StringComparison.Ordinal))
                return (name[..^suffix.Length], suffix == "_all_states" ? "all" : suffix == "_running_10" ? "running" : "halted", null);
        }
        throw new ArgumentException("unknown subset " + name);
    }

    public static int Run(string vectorsPath, string repoRoot)
    {
        var V = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;
        var DATA = Gen2TidData.LoadEmbedded();
        var file = Gen2TidData.LoadFile(Path.Combine(repoRoot, "core", "data", "gen2-tid.json"));
        Check("embedded gen2-tid.json equals the repo file", file.Root, DATA.Root);
        var GEN1 = Gen1TidData.LoadEmbedded();

        // ---- constants and rules ------------------------------------------------------------------
        {
            var c = P(V, "constants");
            Check("constants", c, new
            {
                fps = Gen2Tid.Fps, frameMs = Gen2Tid.FrameMs, visibleMenuLagFrames = Gen2Tid.VisibleMenuLagFrames, binCount = Gen2Tid.BinCount, offsetMax = Gen2Tid.OffsetMax,
                tapFrames = Gen2Tid.TapFrames, tapMs = Gen2Tid.TapMs, rollSettleS = Gen2Tid.RollSettleS, outlierFrames = Gen2Tid.OutlierFrames, twoStatePrior = Gen2Tid.TwoStatePrior,
                gbpResetExtraS = Gen1Tid.ResetAnchorExtraSeconds(GEN1.ResetModel("gbp-fade"))
            });
            foreach (var g in P(V, "binRules").EnumerateObject())
            {
                var r = DATA.BinRule(g.Name);
                Check($"binRule {g.Name}", g.Value, new { droppedOffsets = r.DroppedOffsets, bin0Offsets = new[] { r.Bin0Lo, r.Bin0Hi }, subtract = r.Subtract, acceptToRollFrames = r.AcceptToRollFrames });
            }
        }

        // ---- data invariants ----------------------------------------------------------------------
        Check("10 methodologies", 10, DATA.MethodologyIds.Count());
        foreach (var id in DATA.MethodologyIds)
        {
            var m = DATA.Methodology(id);
            Check($"anchors of {id} are known", true, m.Anchors.All(a => Gen2Tid.Anchors.Contains(a)));
            Check($"timing of {id}: visible = menu + 4", m.Timing.MenuFrame + 4, m.Timing.VisibleMenuFrame);
            Check($"timing of {id}: first poll", m.Timing.MenuFrame + 1 + DATA.BinRule(m.GameKey).Bin0Hi, m.Timing.FirstPollFrame);
            foreach (var k in m.RtcTables) Check($"rtc table {k} resolves", true, DATA.ResolveTable(k).Record.TryGetProperty("tids_hex", out _));
        }

        // ---- bins ---------------------------------------------------------------------------------
        foreach (var c in P(V, "binEdges").EnumerateArray())
            Check($"bin {S(P(c, "game"))} offset {I(P(c, "offset"))}", IN(P(c, "bin")), Gen2Tid.Bin(DATA, S(P(c, "game")), I(P(c, "offset"))));
        foreach (var c in P(V, "offsetsForBin").EnumerateArray())
        {
            var rule = DATA.BinRule(S(P(c, "game")));
            int b = I(P(c, "bin"));
            CheckCase($"offsetsForBin {S(P(c, "game"))} {b}", c, () => new { offsets = Gen2Tid.OffsetsForBin(b, rule), aim = Gen2Tid.AimOffset(b, rule), visible = Gen2Tid.VisibleWindow(b, rule) });
        }

        // ---- tables -------------------------------------------------------------------------------
        foreach (var c in P(V, "tables").EnumerateArray())
        {
            string key = S(P(c, "key"));
            var rec = DATA.TableRecord(key);
            var (carrier, _) = DATA.ResolveTable(key);
            var t = DATA.DecodeTable(carrier);
            var m = DATA.MethodologyFor(S(P(c, "game")), S(P(c, "platformKey")));
            long sumT = 0, sumL = 0, sumS = 0, sumR = 0;
            var seenT = new HashSet<int>(); var seenL = new HashSet<int>();
            for (int b = 0; b < Gen2Tid.BinCount; b++)
            {
                sumT = (sumT + (long)(b + 1) * t.Tids[b]) % 4294967296L;
                sumL = (sumL + (long)(b + 1) * t.Lids[b]) % 4294967296L;
                sumS = (sumS + (long)(b + 1) * (t.Sids?[b] ?? 0)) % 4294967296L;
                sumR += Gen2Tid.RollFrame(t, m.Timing, b);
                seenT.Add(t.Tids[b]); seenL.Add(t.Lids[b]);
            }
            Check($"table {key}", new
            {
                methodology = S(P(c, "methodology")), file = S(P(c, "file")), sha1 = S(P(c, "sha1")), sameDataAs = SN(P(c, "sameDataAs")), menuFrame = I(P(c, "menuFrame")),
                visibleMenuFrame = I(P(c, "visibleMenuFrame")), firstPollFrame = I(P(c, "firstPollFrame")), holdLo = I(P(c, "holdLo")), holdHi = I(P(c, "holdHi")), rows = I(P(c, "rows")),
                distinctTids = I(P(c, "distinctTids")), distinctLids = I(P(c, "distinctLids")), checksumTid = P(c, "checksumTid").GetInt64(), checksumLid = P(c, "checksumLid").GetInt64(),
                checksumSid = P(c, "checksumSid").GetInt64(), checksumRoll = P(c, "checksumRoll").GetInt64()
            }, new
            {
                methodology = m.Id, file = S(P(rec, "file")), sha1 = S(P(rec, "sha1")), sameDataAs = carrier == key ? null : carrier, menuFrame = m.Timing.MenuFrame,
                visibleMenuFrame = m.Timing.VisibleMenuFrame, firstPollFrame = m.Timing.FirstPollFrame, holdLo = m.Timing.HoldLoFrame, holdHi = m.Timing.HoldHiFrame, rows = t.Tids.Length,
                distinctTids = seenT.Count, distinctLids = seenL.Count, checksumTid = sumT, checksumLid = sumL, checksumSid = sumS, checksumRoll = sumR
            });
            Check($"table {key} samples", P(c, "samples"),
                P(c, "samples").EnumerateArray().Select(s => { int b = I(s[0]); return new[] { b, t.Tids[b], t.Lids[b], t.Sids?[b] ?? 0, Gen2Tid.RollFrame(t, m.Timing, b) }; }));
        }

        // ---- lookups ------------------------------------------------------------------------------
        foreach (var c in P(V, "lookups").EnumerateArray())
        {
            var r = Gen2Tid.Lookup(DATA, S(P(c, "game")), S(P(c, "platformKey")), S(P(c, "state")), I(P(c, "bin")));
            Check($"lookup {S(P(c, "game"))}/{S(P(c, "platformKey"))}/{S(P(c, "state"))} bin {I(P(c, "bin"))}", c, new
            {
                game = r.Game, platformKey = r.PlatformKey, state = r.State, bin = r.Bin, tid = r.Tid, lid = r.Lid, sid = r.Sid, offsets = r.Offsets, pressFrames = r.PressFrames,
                acceptFrame = r.AcceptFrame, rollFrame = r.RollFrame, visible = r.Visible, aim = r.Aim
            });
        }

        // ---- inversion ----------------------------------------------------------------------------
        foreach (var c in P(V, "inversionStats").EnumerateArray())
        {
            var (pk, fam, st) = SubsetOpts(S(P(c, "subset")));
            var a = Gen2Tid.Ambiguity(DATA, S(P(c, "game")), pk, fam, st);
            Check($"ambiguity {S(P(c, "game"))} {S(P(c, "subset"))}", c, new
            {
                game = S(P(c, "game")), subset = S(P(c, "subset")), tables = a.Tables, entries = a.Entries, distinctTids = a.DistinctTids, ambiguousTids = a.AmbiguousTids,
                ambiguousEntries = a.AmbiguousEntries, maxCandidates = a.MaxCandidates, pairCollisions = a.PairCollisions, pairCollisionList = a.PairCollisionList
            });
        }
        foreach (var c in P(V, "inversionCases").EnumerateArray())
        {
            var r = Gen2Tid.Invert(DATA, S(P(c, "game")), I(P(c, "tid")), IN(P(c, "lid")), IN(P(c, "sid")), SN(P(c, "platformKey")), S(P(c, "family")), SAN(P(c, "states")));
            Check($"invert {S(P(c, "game"))} {I(P(c, "tid"))}/{P(c, "lid").GetRawText()}/{P(c, "sid").GetRawText()} on {P(c, "platformKey").GetRawText()} {S(P(c, "family"))} {P(c, "states").GetRawText()}",
                new { candidates = P(c, "candidates"), preferred = P(c, "preferred"), ambiguous = P(c, "ambiguous"), resolved = P(c, "resolved") }, Inv(r));
        }

        // ---- targets and verdicts -----------------------------------------------------------------
        foreach (var c in P(V, "targets").EnumerateArray())
        {
            var sets = DATA.TargetSetsFor(S(P(c, "game")), SA(P(c, "sets")));
            Check($"targets {S(P(c, "game"))}/{S(P(c, "platformKey"))}/{S(P(c, "state"))}", P(c, "hits"),
                Gen2Tid.Targets(DATA, S(P(c, "game")), S(P(c, "platformKey")), S(P(c, "state")), sets).Select(Hit));
        }
        foreach (var ts in P(V, "targetSets").EnumerateObject())
        {
            var set = new Gen2TargetSet(ts.Name, DATA.Root.GetProperty("target_sets").GetProperty(ts.Name));
            var members = set.Kind == "tid-list" ? set.Tids.Select(t => $"{t:X4}") : set.Kind == "lid-list" ? set.Lids.Select(t => $"{t:X4}") : set.Pairs.Select(p => $"{p.Tid:X4}/{p.Lid:X4}");
            Check($"target set {ts.Name}", ts.Value, new { kind = set.Kind, games = set.Games, members = members.ToArray(), singlePressHits = set.SinglePressHits });
        }
        foreach (var c in P(V, "verdicts").EnumerateArray())
        {
            CheckCase($"verdict {S(P(c, "game"))} {I(P(c, "tid"))}/{P(c, "lid").GetRawText()} {P(c, "sets").GetRawText()}", c, () =>
            {
                var sets = DATA.TargetSetsFor(S(P(c, "game")), SA(P(c, "sets")));
                var (v, keys) = Gen2Tid.VerdictDetail(I(P(c, "tid")), IN(P(c, "lid")), IN(P(c, "sid")), sets);
                return new { verdict = v, sets = keys };
            });
        }
        {
            var sets = DATA.TargetSetsFor("gold", new[] { "psr-gs-any-09705" });
            Check("verdict string RUN", "RUN", Gen2Tid.Verdict(0x25E9, null, null, sets));
            Check("verdict string no", "no", Gen2Tid.Verdict(0x25EA, null, null, sets));
            Check("verdictText names the script protocol", true, Gen2Tid.VerdictText(0x25E9, null, null, sets).Contains("community multi-step script"));
            Check("setDescribe", "psr-gs-any-09705: TID $25E9 (9705)", sets[0].Describe());
        }

        // ---- schedules ----------------------------------------------------------------------------
        foreach (var c in P(V, "schedules").EnumerateArray())
        {
            CheckCase($"schedule {S(P(c, "methodology"))} bin {I(P(c, "bin"))} {S(P(c, "anchor"))} corr {D(P(c, "correctionMs"))} beeps {I(P(c, "beeps"))} spacing {D(P(c, "spacingS"))}", c,
                () => Sched(Gen2Tid.Schedule(DATA, S(P(c, "methodology")), I(P(c, "bin")), D(P(c, "correctionMs")), S(P(c, "anchor")), I(P(c, "beeps")), D(P(c, "spacingS")), DN(P(c, "resetExtraS")))));
        }

        // ---- calibration --------------------------------------------------------------------------
        foreach (var c in P(V, "calibration").EnumerateArray())
        {
            var rule = DATA.BinRule(S(P(c, "game")));
            double used = D(P(c, "correctionUsedMs")); int hit = I(P(c, "hitBin")), aimed = I(P(c, "aimedBin"));
            Check($"calibration {S(P(c, "game"))} used {used} hit {hit} aimed {aimed}", c, new
            {
                game = S(P(c, "game")), correctionUsedMs = used, hitBin = hit, aimedBin = aimed, impliedMs = Gen2Tid.ImpliedCorrectionBins(rule, used, hit, aimed),
                errorFrames = Gen2Tid.ErrorFramesBins(rule, hit, aimed), outlier = Gen2Tid.IsOutlierBins(rule, hit, aimed)
            });
        }
        foreach (var c in P(V, "sampleFromHit").EnumerateArray())
        {
            var r = Gen2Tid.SampleFromHit(DATA, S(P(c, "game")), S(P(c, "platformKey")), null, I(P(c, "typedTid")), IN(P(c, "typedLid")), I(P(c, "aimedBin")), D(P(c, "correctionUsedMs")));
            Check($"sampleFromHit {S(P(c, "game"))}/{S(P(c, "platformKey"))} {I(P(c, "typedTid"))}/{P(c, "typedLid").GetRawText()} aimed {I(P(c, "aimedBin"))}",
                new { candidateBins = P(c, "candidateBins"), nearestBin = P(c, "nearestBin"), sample = P(c, "sample") },
                new { candidateBins = r.CandidateBins, nearestBin = r.NearestBin, sample = r.Sample is null ? (JsonElement?)null : JsonSerializer.SerializeToElement(r.Sample) });
            if (r.Sample is not null)
            {
                // the Gen 1 calibration helpers accept the record's implied correction
                Check($"sampleFromHit {S(P(c, "game"))} feeds gen1 Mean", r.Sample.ImpliedMs, Gen1Tid.Mean(new[] { r.Sample.ImpliedMs }));
                Check($"sampleFromHit {S(P(c, "game"))} within the outlier guard", false, Gen2Tid.IsOutlierBins(DATA.BinRule(S(P(c, "game"))), r.Sample.HitBin, r.Sample.AimedBin));
            }
        }

        // ---- verify -------------------------------------------------------------------------------
        foreach (var c in P(V, "verify").EnumerateArray())
        {
            var r = Gen2Tid.Verify(DATA, S(P(c, "game")), S(P(c, "platformKey")), I(P(c, "tid")), IN(P(c, "lid")), D(P(c, "measuredS")), S(P(c, "state")));
            Check($"verify {S(P(c, "game"))}/{S(P(c, "platformKey"))} {I(P(c, "tid"))}/{P(c, "lid").GetRawText()} at {D(P(c, "measuredS"))}", c, new
            {
                game = S(P(c, "game")), platformKey = S(P(c, "platformKey")), state = S(P(c, "state")), tid = I(P(c, "tid")), lid = IN(P(c, "lid")), measuredS = D(P(c, "measuredS")),
                predictedOffset = r.PredictedOffset, predictedBin = r.PredictedBin, bins = r.Bins, nearest = r.Nearest, differenceBins = r.DifferenceBins, inTable = r.InTable, consistent = r.Consistent
            });
        }

        if (failures > 0)
        {
            Console.Error.WriteLine($"{failures} failure(s) in {checks} gen2tid checks");
            return 1;
        }
        Console.WriteLine($"all C# gen2tid parity checks passed ({checks} checks over {I(P(V, "caseCount"))} reference cases)");
        return 0;
    }
}
