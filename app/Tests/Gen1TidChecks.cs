using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using ShinySolution.App;
using ShinySolution.Core;

// app/Core/Gen1Tid.cs against tests/gen1tid-vectors.json, the vectors emitted by RNG Solution's
// Python (tests/emit_vectors.py): the same cases tests/test-gen1tid.cjs checks in JS. Integers
// and strings exact, floats to 1e-9 (relative above |1|), "NaN" / "Infinity" sentinels
// reproduced, {"error": ...} cases must throw the exception type the Python's maps to
// (ErrorTypes). A null "sets" in a vector means the game's own target sets (there is no default).
static class Gen1TidChecks
{
    const double Tol = 1e-9;
    static int failures, checks;

    static readonly JsonSerializerOptions Out = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
        IncludeFields = true
    };

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

    // Python exception -> the exact C# type the engine must throw (an InvalidOperationException from a bug is not a refusal).
    static readonly Dictionary<string, Type> ErrorTypes = new()
    {
        ["ValueError"] = typeof(ArgumentException), ["TargetSetError"] = typeof(ArgumentException), ["KeyError"] = typeof(ArgumentException),
        ["OutlierSample"] = typeof(OutlierSampleException), ["DuplicateSample"] = typeof(DuplicateSampleException)
    };

    // A case with "error" must throw the mapped type; one with "result" must return it.
    static void CheckCase(string label, JsonElement c, Func<object?> fn)
    {
        checks++;
        object? got = null;
        Exception? threw = null;
        try { got = fn(); } catch (Exception ex) { threw = ex; }
        bool wantsError = c.TryGetProperty("error", out var err);
        if (wantsError)
        {
            string name = err.GetString() ?? "";
            if (!ErrorTypes.TryGetValue(name, out var want)) Mismatch(label, $"error {name}", "no C# exception type is mapped for this Python exception");
            else if (threw is null) Mismatch(label, $"error {name}", ToJson(got).GetRawText());
            else if (threw.GetType() != want) Mismatch(label, $"error {name} ({want.Name})", $"threw {threw.GetType().Name}: {threw.Message}");
        }
        else if (threw is not null)
        {
            Mismatch(label, c.GetProperty("result").GetRawText(), $"threw {threw.GetType().Name}: {threw.Message}");
        }
        else
        {
            var a = ToJson(got);
            if (!Same(c.GetProperty("result"), a)) Mismatch(label, c.GetProperty("result").GetRawText(), a.GetRawText());
        }
    }

    // A C#-only refusal: the call must throw exactly ArgumentException.
    static void Refuses(string label, Func<object?> fn)
    {
        checks++;
        try { var got = fn(); Mismatch(label, "throws ArgumentException", ToJson(got).GetRawText()); }
        catch (Exception ex) { if (ex.GetType() != typeof(ArgumentException)) Mismatch(label, "throws ArgumentException", $"threw {ex.GetType().Name}: {ex.Message}"); }
    }

    static string Sha1Hex(byte[] bytes) => Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(bytes));

    static double D(JsonElement e) => e.ValueKind == JsonValueKind.String ? e.GetString() switch
    {
        "NaN" => double.NaN, "Infinity" => double.PositiveInfinity, "-Infinity" => double.NegativeInfinity, _ => throw new ArgumentException("not a number")
    } : e.GetDouble();
    static double? DN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : D(e);
    static int I(JsonElement e) => e.GetInt32();
    static int? IN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetInt32();
    static string S(JsonElement e) => e.GetString() ?? "";
    static string? SN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetString();
    static double[] DA(JsonElement e) => e.EnumerateArray().Select(D).ToArray();
    static int[] IA(JsonElement e) => e.EnumerateArray().Select(I).ToArray();
    static string[] SA(JsonElement e) => e.EnumerateArray().Select(S).ToArray();
    static string[]? SAN(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : SA(e);
    static JsonElement P(JsonElement e, string name) => e.GetProperty(name);
    static Sample Sm(JsonElement e) => JsonSerializer.Deserialize<Sample>(e.GetRawText())!;
    static List<Sample> Sms(JsonElement e) => e.EnumerateArray().Select(Sm).ToList();

    static object Sched(Schedule s) => new
    {
        anchor = s.Anchor, tA = s.TA, holdLo = s.HoldLo, holdHi = s.HoldHi, menu = s.Menu, droppedCountIn = s.DroppedCountIn,
        duration = s.Duration, countInTimes = s.CountInTimes, cues = s.Cues.Select(c => new { t = c.T, freq = c.Freq, ms = c.Ms, label = c.Label, kind = c.Kind })
    };

    static object Cand(SidCandidate c) => new { k = c.K, sid = c.Sid, tsv = c.Tsv };
    static object Model(SidModel m) => new
    {
        variant = m.Variant, name = m.Name, ok_to_seed = m.OkToSeed, k_default_span = m.KDefaultSpan, status = m.Status, stages = m.Stages,
        stage_text = m.StageText,
        text_speed = m.TextSpeed.ToDictionary(kv => kv.Key, kv => (object)new
        {
            name_lengths = kv.Value.NameLengths.ToDictionary(x => x.Key.ToString(CultureInfo.InvariantCulture), x => (object)new { press_to_press = x.Value }),
            last_press_to_sid = kv.Value.LastPressToSid
        })
    };

    public static int Run(string vectorsPath, string repoRoot, string? citationsPath = null)
    {
        var V = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;
        var DATA = Gen1TidData.LoadEmbedded();
        var SID = Gen3SidData.LoadEmbedded();

        // The embedded copies must be the repo files byte for byte (a parsed comparison would let a float drift below the
        // tolerance through). Load() prefers a copy beside the exe: say which one the app would read.
        Console.WriteLine($"Gen1TidData.Load() would read {Gen1TidData.LoadSource()}");
        Check("embedded gen1-tid.json is byte-identical to the repo file",
            Sha1Hex(File.ReadAllBytes(Path.Combine(repoRoot, "core", "data", "gen1-tid.json"))), Sha1Hex(Gen1TidData.EmbeddedBytes(Gen1TidData.EmbeddedName)));
        Check("embedded gen3-sid.json is byte-identical to the repo file",
            Sha1Hex(File.ReadAllBytes(Path.Combine(repoRoot, "core", "data", "gen3-sid.json"))), Sha1Hex(Gen1TidData.EmbeddedBytes(Gen3SidData.EmbeddedName)));

        List<TargetSet> Sets(string game, JsonElement keys) => keys.ValueKind == JsonValueKind.Null ? DATA.TargetSetsFor(game) : DATA.TargetSetsFor(game, SA(keys));

        // ---- constants -------------------------------------------------------------
        {
            var c = P(V, "constants");
            Check("FPS", D(P(c, "fps")), Gen1Tid.Fps);
            Check("FRAME_MS", D(P(c, "frameMs")), Gen1Tid.FrameMs);
            Check("MENU_TO_TABLE_FRAMES", I(P(c, "menuToTableFrames")), Gen1Tid.MenuToTableFrames);
            Check("OUTLIER_FRAMES", I(P(c, "outlierFrames")), Gen1Tid.OutlierFrames);
            Check("COUNT_IN_CLEAR_S", D(P(c, "countInClearS")), Gen1Tid.CountInClearS);
            Check("ANCHORS", P(c, "anchors"), Gen1Tid.Anchors);
            Check("tones", P(c, "tones"), new
            {
                countIn = new[] { Gen1Tid.CountInTone.Hz, Gen1Tid.CountInTone.Ms }, aCue = new[] { Gen1Tid.ACueTone.Hz, Gen1Tid.ACueTone.Ms },
                resetBeat = new[] { Gen1Tid.ResetBeatTone.Hz, Gen1Tid.ResetBeatTone.Ms }, aBeat = new[] { Gen1Tid.ABeatTone.Hz, Gen1Tid.ABeatTone.Ms },
                hold = new[] { Gen1Tid.HoldTone.Hz, Gen1Tid.HoldTone.Ms }, menuMark = new[] { Gen1Tid.MenuMarkTone.Hz, Gen1Tid.MenuMarkTone.Ms }
            });
            Check("VERDICT_TEXT", P(c, "verdictText"), Gen1Tid.VerdictText);
            Check("reset extra", D(P(c, "resetExtraS")), Gen1Tid.ResetAnchorExtraSeconds(DATA.ResetModel("gbp-fade")));
            Check("data settle", 80, DATA.MenuToTableFrames);
        }

        // ---- tables -----------------------------------------------------------------
        foreach (var t in P(V, "tables").EnumerateArray())
        {
            string id = S(P(t, "methodology"));
            var m = DATA.Methodology(id);
            var tab = m.Table;
            string game = S(P(t, "game"));
            Check($"table {id} rows", I(P(t, "rows")), tab.Length);
            Check($"table {id} range", new[] { I(P(t, "offsetMin")), I(P(t, "offsetMax")) }, new[] { 0, tab.Length - 1 });
            Check($"table {id} distinct", I(P(t, "distinct")), tab.Distinct().Count());
            long sum = 0;
            for (int o = 0; o < tab.Length; o++) sum += (long)(o + 1) * tab[o];
            Check($"table {id} checksum", P(t, "checksum").GetInt64(), sum % 4294967296L);
            Check($"table {id} timing", new[] { D(P(t, "holdLoFrame")), D(P(t, "holdHiFrame")), D(P(t, "menuFrame")), D(P(t, "visibleLagFrames")) },
                new[] { (double)m.Timing.HoldLoFrame, m.Timing.HoldHiFrame, m.Timing.MenuFrame, m.Timing.VisibleLagFrames });
            Check($"table {id} verified targets", P(t, "verifiedTargets"), m.Timing.VerifiedTargets);
            Check($"table {id} family", S(P(t, "family")), m.ConsoleId);
            Check($"table {id} anchors", P(t, "anchors"), m.Anchors);
            Check($"table {id} file", S(P(t, "tableFile")), m.TableFile);
            Check($"table {id} game", game, m.GameKey);
            Check($"table {id} default sets", P(t, "defaultTargetSets"), DATA.TargetSetsFor(game).Select(s => s.Key).ToArray());
            var byTid = new SortedDictionary<int, List<int>>();
            for (int o = 0; o < tab.Length; o++) { if (!byTid.ContainsKey(tab[o])) byTid[tab[o]] = new List<int>(); byTid[tab[o]].Add(o); }
            Check($"table {id} collisions", P(t, "collisions"), byTid.Where(kv => kv.Value.Count > 1).Select(kv => new { tid = kv.Key, offsets = kv.Value }).ToArray());
            var defaults = DATA.TargetSetsFor(game);
            Check($"table {id} route-valid", P(t, "routeValid"), Gen1Tid.RouteValidTargets(tab, defaults).Select(x => new[] { x.Offset, x.Tid }).ToArray());
            foreach (var ps in P(t, "routeValidPerSet").EnumerateObject())
                Check($"table {id} route-valid under {ps.Name}", ps.Value, Gen1Tid.RouteValidTargets(tab, DATA.TargetSetsFor(game, new[] { ps.Name })).Select(x => new[] { x.Offset, x.Tid }).ToArray());
            var traps = new List<int[]>();
            for (int o = 0; o < tab.Length; o++) if (Gen1Tid.Verdict(tab[o], defaults) == "40!") traps.Add(new[] { o, tab[o] });
            Check($"table {id} traps", P(t, "traps"), traps);
            Check($"table {id} samples", P(t, "samples"), P(t, "samples").EnumerateArray().Select(s => new[] { I(s[0]), tab[I(s[0])] }).ToArray());
        }

        // ---- cue arithmetic ---------------------------------------------------------
        foreach (var c in P(V, "targetSeconds").EnumerateArray())
        {
            int o = I(P(c, "offset"));
            Check($"targetSeconds {o}", new object[] { D(P(c, "seconds")), I(P(c, "pressFrame")), D(P(c, "cueDelayAt200")), D(P(c, "cueDelayAtMinus50")) },
                new object[] { Gen1Tid.TargetSeconds(o), Gen1Tid.PressFrameFromMenu(o), Gen1Tid.CueDelaySeconds(o, 200.0), Gen1Tid.CueDelaySeconds(o, -50.0) });
        }
        foreach (var c in P(V, "conversions").EnumerateArray())
        {
            double f = D(P(c, "frames"));
            Check($"conversions {f}", new[] { D(P(c, "seconds")), D(P(c, "ms")), D(P(c, "framesBackFromSeconds")), D(P(c, "framesBackFromMs")) },
                new[] { Gen1Tid.FramesToSeconds(f), Gen1Tid.FramesToMs(f), Gen1Tid.SecondsToFrames(Gen1Tid.FramesToSeconds(f)), Gen1Tid.MsToFrames(Gen1Tid.FramesToMs(f)) });
        }
        foreach (var c in P(V, "menuSchedule").EnumerateArray())
        {
            int o = I(P(c, "offset")); double corr = D(P(c, "correctionMs")); int beeps = I(P(c, "beeps")); double sp = D(P(c, "spacingS"));
            CheckCase($"menuSchedule {o}/{corr}/{beeps}/{sp}", c, () => Sched(Gen1Tid.MenuSchedule(o, corr, beeps, sp)));
            CheckCase($"schedule(menu) {o}/{corr}", c, () => Sched(Gen1Tid.BuildSchedule("menu", null, o, corr, beeps, sp)));
        }
        foreach (var c in P(V, "poweronSchedule").EnumerateArray())
        {
            string id = S(P(c, "methodology")); string anchor = S(P(c, "anchor"));
            int o = I(P(c, "offset")); double corr = D(P(c, "correctionMs")); int beeps = I(P(c, "beeps")); double sp = D(P(c, "spacingS"));
            double? extra = DN(P(c, "resetExtraS"));
            var timing = DATA.Methodology(id).Timing;
            CheckCase($"schedule {anchor} {id} {o}/{corr}/{beeps}/{sp}", c, () => Sched(Gen1Tid.BuildSchedule(anchor, timing, o, corr, beeps, sp, extra)));
            if (anchor == "reset" && extra is not null)
                CheckCase($"schedule reset via model {id} {o}/{corr}", c,
                    () => Sched(Gen1Tid.BuildSchedule(anchor, timing, o, corr, beeps, sp, Gen1Tid.ResetAnchorExtraSeconds(DATA.ResetModel("gbp-fade")))));
            // With the methodology record the engine itself refuses an anchor the methodology does not list (the DMG
            // methodologies have no reset anchor), so the reset delay can always come from the model.
            CheckCase($"schedule {anchor} under methodology {id} {o}/{corr}/{beeps}/{sp}", c,
                () => Sched(Gen1Tid.BuildSchedule(anchor, timing, o, corr, beeps, sp, Gen1Tid.ResetAnchorExtraSeconds(DATA.ResetModel("gbp-fade")), DATA.Methodology(id))));
        }
        foreach (var c in P(V, "resetAnchorExtra").EnumerateArray())
            CheckCase($"resetAnchorExtra {S(P(c, "model"))}", c, () => Gen1Tid.ResetAnchorExtraSeconds(DATA.ResetModel(S(P(c, "model")))));

        // ---- Trainer IDs and target sets ----------------------------------------------
        foreach (var c in P(V, "parseTid").EnumerateArray()) CheckCase($"parseTid '{S(P(c, "text"))}'", c, () => Gen1Tid.ParseTid(S(P(c, "text"))));
        foreach (var c in P(V, "formatTid").EnumerateArray()) Check($"formatTid {I(P(c, "tid"))}", S(P(c, "text")), Gen1Tid.FormatTid(I(P(c, "tid"))));
        {
            var ts = P(V, "targetSets");
            foreach (var d in P(ts, "describe").EnumerateObject())
            {
                var set = d.Name == "<default sled>" ? Gen1Tid.Sled40xx : DATA.TargetSet(d.Name);
                Check($"describe {d.Name}", S(d.Value), set.Describe());
            }
            foreach (var c in P(ts, "verdicts").EnumerateArray())
            {
                string game = S(P(c, "game")); int tid = I(P(c, "tid"));
                var s = Sets(game, P(c, "sets"));
                string label = $"verdict {game} {P(c, "sets").GetRawText()} ${tid:X4}";
                Check(label, new object[] { S(P(c, "verdict")), S(P(c, "text")), SA(P(c, "accepting")) },
                    new object[] { Gen1Tid.Verdict(tid, s), Gen1Tid.VerdictTextFor(tid, s), Gen1Tid.SetsAccepting(tid, s).Select(x => x.Key).ToArray() });
                if (c.TryGetProperty("perSet", out var per))
                    Check(label + " per set", per, s.ToDictionary(x => x.Key, x => new { accepts = x.Accepts(tid), trap = x.Trap(tid) }));
            }
            foreach (var g in P(ts, "defaultSets").EnumerateObject())
                Check($"default sets {g.Name}", g.Value, DATA.TargetSetsFor(g.Name).Select(s => s.Key).ToArray());
            foreach (var c in P(ts, "errors").EnumerateArray())
                CheckCase($"targetSetsFor {S(P(c, "game"))} {P(c, "keys").GetRawText()}", c, () => DATA.TargetSetsFor(S(P(c, "game")), SAN(P(c, "keys"))));
        }
        foreach (var c in P(V, "invert").EnumerateArray())
        {
            if (P(c, "methodology").ValueKind != JsonValueKind.Null)
            {
                string id = S(P(c, "methodology")); int tid = I(P(c, "tid"));
                var offsets = Gen1Tid.Invert(DATA.Methodology(id).Table, tid);
                Check($"invert {id} ${tid:X4}", P(c, "offsets"), offsets);
                foreach (var n in P(c, "nearest").EnumerateArray())
                    Check($"nearest {id} ${tid:X4} guess {D(P(n, "guess"))}", IN(P(n, "offset")), Gen1Tid.NearestOffset(offsets, D(P(n, "guess"))));
            }
            else
            {
                foreach (var n in P(c, "nearestOnly").EnumerateArray())
                    Check($"nearestOffset {P(n, "offsets").GetRawText()} {D(P(n, "guess"))}", IN(P(n, "offset")), Gen1Tid.NearestOffset(IA(P(n, "offsets")), D(P(n, "guess"))));
            }
        }

        // ---- calibration --------------------------------------------------------------
        foreach (var c in P(V, "impliedCorrection").EnumerateArray())
        {
            double used = D(P(c, "usedMs")); int hit = I(P(c, "hit")), aimed = I(P(c, "aimed"));
            Check($"implied {used}/{hit}/{aimed}", new object[] { I(P(c, "errorFrames")), P(c, "isOutlier").GetBoolean(), D(P(c, "impliedMs")) },
                new object[] { Gen1Tid.ErrorFrames(hit, aimed), Gen1Tid.IsOutlier(hit, aimed), Gen1Tid.ImpliedCorrection(used, hit, aimed) });
        }
        {
            var Sv = P(V, "samples");
            foreach (var c in P(Sv, "make").EnumerateArray())
            {
                var a = P(c, "args");
                Check($"makeSample {I(P(a, "tid"))}/{I(P(a, "hitOffset"))}", P(c, "sample"),
                    Gen1Tid.MakeSample(I(P(a, "tid")), I(P(a, "aimedOffset")), I(P(a, "hitOffset")), D(P(a, "correctionUsedMs")), SN(P(a, "attempt")), S(P(a, "note")),
                        SN(P(a, "player")), SN(P(a, "methodology"))));
            }
            int i = 0;
            foreach (var c in P(Sv, "add").EnumerateArray())
            {
                var samples = Sms(P(c, "samples")); var sample = Sm(P(c, "sample")); bool force = P(c, "force").GetBoolean();
                Check($"isDuplicate #{i}", P(c, "isDuplicate").GetBoolean(), Gen1Tid.IsDuplicate(samples, sample));
                Check($"isOutlier #{i}", P(c, "isOutlier").GetBoolean(), Gen1Tid.IsOutlier(sample.Hit, sample.Aimed));
                CheckCase($"addSample #{i} force={force}", c, () => Gen1Tid.AddSample(samples, sample, force));
                if (c.TryGetProperty("error", out var err))
                {
                    string? name = null;
                    try { Gen1Tid.AddSample(samples, sample, force); } catch (Exception ex) { name = ex.GetType().Name.Replace("Exception", ""); }
                    Check($"addSample #{i} error class", S(err), name);
                }
                i++;
            }
            foreach (var c in P(Sv, "meanCorrection").EnumerateArray())
                Check($"meanCorrection n={P(c, "samples").GetArrayLength()} default {D(P(c, "defaultMs"))}", D(P(c, "ms")), Gen1Tid.MeanCorrection(Sms(P(c, "samples")), D(P(c, "defaultMs"))));
            i = 0;
            foreach (var c in P(Sv, "split").EnumerateArray())
            {
                var (kept, rest) = Gen1Tid.SplitByMethodology(Sms(P(c, "samples")), SN(P(c, "methodology")));
                Check($"splitByMethodology #{i++}", new { kept = P(c, "kept"), rest = P(c, "rest") }, new { kept, rest });
            }
            i = 0;
            foreach (var c in P(Sv, "dropLast").EnumerateArray())
            {
                var (rest, dropped) = Gen1Tid.DropLast(Sms(P(c, "samples")));
                Check($"dropLast #{i++}", new { rest = P(c, "rest"), dropped = P(c, "dropped") }, new { rest, dropped });
            }
            i = 0;
            foreach (var c in P(Sv, "dropLastUnder").EnumerateArray())
            {
                var (rest, dropped) = Gen1Tid.DropLastUnder(Sms(P(c, "samples")), SN(P(c, "methodology")));
                Check($"dropLastUnder #{i++}", new { rest = P(c, "rest"), dropped = P(c, "dropped") }, new { rest, dropped });
            }
            i = 0;
            foreach (var c in P(Sv, "players").EnumerateArray())
                Check($"samplePlayers #{i++}", P(c, "players"), Gen1Tid.SamplePlayers(Sms(P(c, "samples"))));
        }

        // ---- reset metronome -----------------------------------------------------------
        foreach (var c in P(V, "resetInterval").EnumerateArray())
        {
            var model = c.TryGetProperty("modelSpec", out var spec) ? Gen1TidData.ParseResetModel(spec) : DATA.ResetModel(S(P(c, "model")));
            string path = S(P(c, "path")); double? fade = DN(P(c, "fadeFrames")); double adj = D(P(c, "adjustFrames"));
            CheckCase($"resetInterval {S(P(c, "model"))}/{path} fade={fade} adj={adj}", c, () => Gen1Tid.ResetIntervalFor(model, path, fade, adj));
        }
        foreach (var c in P(V, "resetSchedule").EnumerateArray())
        {
            double ms = D(P(c, "intervalMs")); var order = SA(P(c, "order")); int pairs = I(P(c, "pairs")); double cad = D(P(c, "cadenceS")), lead = D(P(c, "leadS"));
            CheckCase($"resetSchedule {ms}/{string.Join(",", order)}/{pairs}/{cad}/{lead}", c, () => Sched(Gen1Tid.ResetSchedule(ms, order, pairs, cad, lead)));
        }

        // ---- verify ------------------------------------------------------------------------
        foreach (var c in P(V, "verify").EnumerateArray())
        {
            string id = S(P(c, "methodology")); int tid = I(P(c, "tid")); double secs = D(P(c, "menuToPressS")); int tol = I(P(c, "toleranceFrames"));
            double lag = D(P(c, "visibleLagFrames"));
            var m = DATA.Methodology(id);
            Check($"verify {id} ${tid:X4} {secs} tol {tol} lag {lag}", P(c, "result"), Gen1Tid.Verify(m.Table, tid, secs, tol, lag, Sets(m.GameKey, P(c, "sets"))));
        }

        // ---- Gen 3 Secret ID ---------------------------------------------------------------
        {
            var s = P(V, "sid");
            var k0 = P(s, "constants");
            Check("lcrng constants", new object[] { P(k0, "mult").GetInt64(), P(k0, "add").GetInt64(), D(P(k0, "gbaFps")) }, new object[] { (long)Lcrng.Mult, (long)Lcrng.Add, Lcrng.GbaFps });
            Check("text speeds", P(k0, "textSpeeds"), Gen1Tid.TextSpeeds);
            foreach (var c in P(s, "sidAt").EnumerateArray())
            {
                int tid = I(P(c, "tid")); long k = P(c, "k").GetInt64();
                Check($"sidAt {tid}/{k}", new[] { I(P(c, "sid")), I(P(c, "tsv")) }, new[] { Gen1Tid.SidAt(tid, k), Gen1Tid.Tsv(tid, Gen1Tid.SidAt(tid, k)) });
            }
            foreach (var c in P(s, "jumps").EnumerateArray())
            {
                uint x = (uint)P(c, "x").GetInt64(); long n = P(c, "n").GetInt64();
                if (c.TryGetProperty("error", out _)) CheckCase($"lcrngJump {x}/{n}", c, () => Gen1Tid.LcrngJump(x, n));
                else Check($"lcrngJump {x}/{n}", new[] { P(c, "state").GetInt64(), P(c, "hi16").GetInt64() }, new[] { (long)Gen1Tid.LcrngJump(x, n), (long)Gen1Tid.Hi16(Gen1Tid.LcrngJump(x, n)) });
            }
            foreach (var c in P(s, "candidates").EnumerateArray())
            {
                int tid = I(P(c, "tid")); long lo = P(c, "kMin").GetInt64(), hi = P(c, "kMax").GetInt64();
                Check($"sidCandidates {tid} {lo}-{hi}", P(c, "candidates"), Gen1Tid.SidCandidates(tid, lo, hi).Select(Cand).ToArray());
            }
            foreach (var c in P(s, "candidateErrors").EnumerateArray())
                CheckCase($"sidCandidates error {P(c, "tid").GetInt64()}", c, () => Gen1Tid.SidCandidates((int)P(c, "tid").GetInt64(), P(c, "kMin").GetInt64(), P(c, "kMax").GetInt64()));
            foreach (var c in P(s, "kForSid").EnumerateArray())
                Check($"kForSid {I(P(c, "tid"))}/{I(P(c, "sid"))}/{I(P(c, "kMax"))}", P(c, "ks"), Gen1Tid.KForSid(I(P(c, "tid")), I(P(c, "sid")), I(P(c, "kMax"))));
            foreach (var c in P(s, "shiny").EnumerateArray())
            {
                int tid = I(P(c, "tid")), sid = I(P(c, "sid")); uint pid = (uint)P(c, "pid").GetInt64();
                Check($"shiny {tid}/{sid}/{pid}", new object[] { I(P(c, "shinyXor")), P(c, "isShiny").GetBoolean(), I(P(c, "tsv")), I(P(c, "psv")) },
                    new object[] { Gen1Tid.ShinyXor(tid, sid, pid), Gen1Tid.IsShiny(tid, sid, pid), Gen1Tid.Tsv(tid, sid), Gen1Tid.Psv(pid) });
            }
            foreach (var c in P(s, "shinySidsForPid").EnumerateArray())
                Check($"shinySidsForPid {I(P(c, "tid"))}/{P(c, "pid").GetInt64()}", P(c, "sids"), Gen1Tid.ShinySidsForPid(I(P(c, "tid")), (uint)P(c, "pid").GetInt64()));
            foreach (var c in P(s, "filter").EnumerateArray())
            {
                int tid = I(P(c, "tid"));
                var cands = Gen1Tid.SidCandidates(tid, P(c, "kMin").GetInt64(), P(c, "kMax").GetInt64());
                var shiny = P(c, "shinyPids").EnumerateArray().Select(x => (uint)x.GetInt64()).ToArray();
                var non = P(c, "nonshinyPids").EnumerateArray().Select(x => (uint)x.GetInt64()).ToArray();
                int? tsv = IN(P(c, "tsv"));
                var (kept, dropped) = Gen1Tid.FilterCandidates(cands, tid, shiny, non, tsv);
                Check($"filterCandidates {P(c, "shinyPids").GetRawText()}/{P(c, "nonshinyPids").GetRawText()}/{tsv}", new { kept = P(c, "kept"), dropped = P(c, "dropped") },
                    new { kept = kept.Select(x => x.K).ToArray(), dropped = dropped.ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => kv.Value) });
                if (shiny.Length == 1 && non.Length == 0 && tsv is null)
                    Check("filterByPid shiny", P(c, "kept"), Gen1Tid.FilterByPid(cands, tid, shiny[0], true).Kept.Select(x => x.K).ToArray());
                if (non.Length == 1 && shiny.Length == 0 && tsv is null)
                    Check("filterByPid not shiny", P(c, "kept"), Gen1Tid.FilterByPid(cands, tid, non[0], false).Kept.Select(x => x.K).ToArray());
            }
            foreach (var c in P(s, "parsePid").EnumerateArray()) CheckCase($"parsePid '{S(P(c, "text"))}'", c, () => (long)Gen1Tid.ParsePid(S(P(c, "text"))));
            foreach (var c in P(s, "models").EnumerateArray())
            {
                string game = S(P(c, "game")); string mid = $"{game}/gba/typed-tid-sid-v1";
                if (c.TryGetProperty("variantNames", out var vn))
                {
                    Check($"variantNames {game}", new object?[] { SA(vn), SN(P(c, "defaultVariant")) }, new object?[] { SID.VariantNames(mid), SID.DefaultVariant(mid) });
                    continue;
                }
                string? vname = SN(P(c, "variant"));
                if (c.TryGetProperty("error", out _)) { CheckCase($"variant {game}/{vname}", c, () => SID.Variant(mid, vname)); continue; }
                var m = SID.Variant(mid, vname);
                Check($"variant {game}/{vname}", new object[] { S(P(c, "resolvedVariant")), I(P(c, "okToSeed")), I(P(c, "kDefaultSpan")), SA(P(c, "stages")) },
                    new object[] { m.Variant, m.OkToSeed, m.KDefaultSpan, m.Stages });
                foreach (var r in P(c, "rows").EnumerateArray())
                {
                    string speed = S(P(r, "speed")); int L = I(P(r, "nameLength"));
                    string label = $"{game}/{vname} {speed} L{L}";
                    if (r.TryGetProperty("error", out _)) { CheckCase($"stagePressToPress {label}", r, () => Gen1Tid.StagePressToPress(m, L, speed)); continue; }
                    object[] Pairs(List<(string Stage, int Frames)> xs) => xs.Select(x => new object[] { x.Stage, x.Frames }).ToArray();
                    Check($"stagePressToPress {label}", P(r, "stagePressToPress"), Pairs(Gen1Tid.StagePressToPress(m, L, speed)));
                    Check($"kFixed {label}", I(P(r, "kFixed")), Gen1Tid.KFixed(m, L, speed));
                    Check($"lastPressToSid {label}", I(P(r, "lastPressToSid")), m.TextSpeed[speed].LastPressToSid);
                    Check($"cueBeeps30 {label}", P(r, "cueBeeps30"), Pairs(Gen1Tid.CueBeeps(m, L, speed, 30)));
                    Check($"cueBeeps0 {label}", P(r, "cueBeeps0"), Pairs(Gen1Tid.CueBeeps(m, L, speed, 0)));
                    var w = Gen1Tid.KWindowForCue(m, L, speed, 30, 6, 20);
                    Check($"kWindowForCue {label}", P(r, "window"), new { kExpected = w.KExpected, kMin = w.KMin, kMax = w.KMax, beeps = Pairs(w.Beeps) });
                    var cw = Gen1Tid.CueWindow(I(P(r, "kFixed")), m.Stages.Length, 30, 6, 20);
                    Check($"cueWindow {label}", new { kExpected = I(P(P(r, "window"), "kExpected")), kMin = I(P(P(r, "window"), "kMin")), kMax = I(P(P(r, "window"), "kMax")) },
                        new { kExpected = cw.KExpected, kMin = cw.KMin, kMax = cw.KMax });
                }
            }
            foreach (var c in P(s, "measured").EnumerateArray())
            {
                var m = SID.Variant(S(P(c, "methodology")), S(P(c, "variant")));
                string speed = S(P(c, "speed")); int L = I(P(c, "nameLength")); int kf = I(P(c, "kFixed")); int seed = I(P(c, "seed"));
                Check($"measured {S(P(c, "methodology"))}/{S(P(c, "variant"))} {speed} L{L}", new[] { kf, I(P(c, "kFixedComputed")), I(P(c, "sidAt")), I(P(c, "sid")) },
                    new[] { Gen1Tid.KFixed(m, L, speed), Gen1Tid.KFixed(m, L, speed), Gen1Tid.SidAt(seed, kf), Gen1Tid.SidAt(seed, kf) });
            }
            foreach (var c in P(s, "cueWindow").EnumerateArray())
            {
                var cw = Gen1Tid.CueWindow(I(P(c, "kFixed")), I(P(c, "presses")), I(P(c, "marginFrames")), I(P(c, "earlyFrames")), I(P(c, "lateFrames")));
                Check($"cueWindow {I(P(c, "kFixed"))}", new[] { I(P(c, "kExpected")), I(P(c, "kMin")), I(P(c, "kMax")) }, new[] { cw.KExpected, cw.KMin, cw.KMax });
            }
            foreach (var c in P(s, "framesToSeconds").EnumerateArray())
                Check($"gbaFramesToSeconds {D(P(c, "frames"))}", D(P(c, "seconds")), Gen1Tid.GbaFramesToSeconds(D(P(c, "frames"))));
        }

        // ---- jitter -------------------------------------------------------------------------
        {
            var J = P(V, "jitter");
            Check("jitter constants", P(J, "constants"), new
            {
                madToSd = Gen1Tid.MadToSd, minAnchorSdMs = Gen1Tid.MinAnchorSdMs, driftTail = Gen1Tid.DriftTail, driftThresholdMs = Gen1Tid.DriftThresholdMs,
                welchStrongT = Gen1Tid.WelchStrongT, sdIntervalConf = Gen1Tid.SdIntervalConf, smallN = Gen1Tid.SmallN
            });
            foreach (var c in P(J, "descriptive").EnumerateArray())
            {
                var v = DA(P(c, "values"));
                Check($"descriptive {P(c, "values").GetRawText()}", new[] { D(P(c, "mean")), D(P(c, "variance")), D(P(c, "sd")), D(P(c, "median")), D(P(c, "mad")), D(P(c, "robustSd")) },
                    new[] { Gen1Tid.Mean(v), Gen1Tid.Variance(v), Gen1Tid.Sd(v), Gen1Tid.Median(v), Gen1Tid.Mad(v), Gen1Tid.RobustSd(v) });
            }
            foreach (var c in P(J, "anchorStats").EnumerateArray())
            {
                var xs = P(c, "samples").EnumerateArray().Select(x => D(P(x, "implied_ms"))).ToArray();
                Check($"anchorStats n={xs.Length}", P(c, "stats"), Gen1Tid.AnchorStatsOf(xs));
            }
            foreach (var c in P(J, "hitProbability").EnumerateArray())
                Check($"hitProbability {D(P(c, "sdMs"))}/{D(P(c, "frameMs"))}/{D(P(c, "biasMs"))}", D(P(c, "p")), Gen1Tid.HitProbability(D(P(c, "sdMs")), D(P(c, "frameMs")), D(P(c, "biasMs"))));
            foreach (var c in P(J, "hitProbabilityErrors").EnumerateArray())
                CheckCase($"hitProbability error {D(P(c, "sdMs"))}/{D(P(c, "frameMs"))}", c, () => Gen1Tid.HitProbability(D(P(c, "sdMs")), D(P(c, "frameMs")), D(P(c, "biasMs"))));
            foreach (var c in P(J, "hitProbabilityQuantised").EnumerateArray())
                Check($"hitProbabilityQuantised {D(P(c, "sdMs"))}/{D(P(c, "biasMs"))}/{P(c, "phase").GetRawText()}", D(P(c, "p")),
                    Gen1Tid.HitProbabilityQuantised(D(P(c, "sdMs")), D(P(c, "frameMs")), D(P(c, "biasMs")), DN(P(c, "phase"))));
            foreach (var c in P(J, "hitProbabilityQuantisedErrors").EnumerateArray())
                CheckCase($"hitProbabilityQuantised error {D(P(c, "sdMs"))}/{P(c, "phase").GetRawText()}", c,
                    () => Gen1Tid.HitProbabilityQuantised(D(P(c, "sdMs")), D(P(c, "frameMs")), D(P(c, "biasMs")), DN(P(c, "phase"))));
            foreach (var c in P(J, "chi2Cdf").EnumerateArray()) Check($"chi2Cdf {D(P(c, "x"))}/{I(P(c, "k"))}", D(P(c, "cdf")), Gen1Tid.Chi2Cdf(D(P(c, "x")), I(P(c, "k"))));
            foreach (var c in P(J, "chi2CdfErrors").EnumerateArray()) CheckCase($"chi2Cdf error", c, () => Gen1Tid.Chi2Cdf(D(P(c, "x")), I(P(c, "k"))));
            foreach (var c in P(J, "chi2Quantile").EnumerateArray()) Check($"chi2Quantile {D(P(c, "p"))}/{I(P(c, "k"))}", D(P(c, "q")), Gen1Tid.Chi2Quantile(D(P(c, "p")), I(P(c, "k"))));
            foreach (var c in P(J, "chi2QuantileErrors").EnumerateArray()) CheckCase($"chi2Quantile error {D(P(c, "p"))}/{I(P(c, "k"))}", c, () => Gen1Tid.Chi2Quantile(D(P(c, "p")), I(P(c, "k"))));
            foreach (var c in P(J, "sdInterval").EnumerateArray())
            {
                var (lo, hi) = Gen1Tid.SdInterval(D(P(c, "sdMs")), I(P(c, "n")), D(P(c, "conf")));
                Check($"sdInterval {P(c, "sdMs").GetRawText()}/{I(P(c, "n"))}/{D(P(c, "conf"))}", new { lo = P(c, "lo"), hi = P(c, "hi") }, new { lo, hi });
            }
            foreach (var c in P(J, "hitProbabilityRange").EnumerateArray())
            {
                var (a, b) = Gen1Tid.HitProbabilityRange(D(P(c, "sdMs")), I(P(c, "n")), Gen1Tid.FrameMs, 0.90, P(c, "centred").GetBoolean());
                Check($"hitProbabilityRange {D(P(c, "sdMs"))}/{I(P(c, "n"))}/{P(c, "centred").GetBoolean()}", P(c, "range"), new[] { a, b });
            }
            foreach (var c in P(J, "headline").EnumerateArray())
            {
                var (p, centred) = Gen1Tid.HitProbabilityHeadline(D(P(c, "sdMs")), I(P(c, "n")));
                Check($"headline {D(P(c, "sdMs"))}/{I(P(c, "n"))}", new { p = P(c, "p"), centred = P(c, "centred") }, new { p, centred });
            }
            foreach (var c in P(J, "expectedAttempts").EnumerateArray()) Check($"expectedAttempts {D(P(c, "p"))}", D(P(c, "attempts")), Gen1Tid.ExpectedAttempts(D(P(c, "p"))));
            foreach (var c in P(J, "sdForProbability").EnumerateArray())
                CheckCase($"sdForProbability {D(P(c, "p"))}/{D(P(c, "biasMs"))}", c, () => Gen1Tid.SdForProbability(D(P(c, "p")), D(P(c, "frameMs")), D(P(c, "biasMs"))));
            foreach (var c in P(J, "welchT").EnumerateArray())
                Check($"welchT {P(c, "a").GetRawText()}/{P(c, "b").GetRawText()}", DN(P(c, "t")), Gen1Tid.WelchT(DA(P(c, "a")), DA(P(c, "b"))));
            foreach (var c in P(J, "drift").EnumerateArray())
                Check($"drift {P(c, "values").GetRawText()} tail {I(P(c, "tailN"))} thr {D(P(c, "thresholdMs"))} head {I(P(c, "minHead"))} t {D(P(c, "strongT"))}", P(c, "result"),
                    Gen1Tid.Drift(DA(P(c, "values")), I(P(c, "tailN")), D(P(c, "thresholdMs")), I(P(c, "minHead")), D(P(c, "strongT"))));
            foreach (var c in P(J, "fuse").EnumerateArray())
            {
                var est = P(c, "estimates").EnumerateArray().Select(e => (D(e[0]), D(e[1]))).ToArray();
                CheckCase($"fuse {P(c, "estimates").GetRawText()}", c, () => Gen1Tid.Fuse(est));
            }
            foreach (var c in P(J, "splitAnchorSd").EnumerateArray())
                Check($"splitAnchorSd {D(P(c, "totalSdMs"))}/{P(c, "pressSdMs").GetRawText()}", D(P(c, "sd")), Gen1Tid.SplitAnchorSd(D(P(c, "totalSdMs")), DN(P(c, "pressSdMs")), D(P(c, "minAnchorSdMs"))));
            foreach (var c in P(J, "fuseCues").EnumerateArray())
            {
                var cues = P(c, "cues").EnumerateArray().Select(x => (S(P(x, "anchor")), D(P(x, "timeS")), D(P(x, "sdMs")))).ToArray();
                CheckCase($"fuseCues {P(c, "cues").GetRawText()} press {P(c, "pressSdMs").GetRawText()}", c, () => Gen1Tid.FuseCues(cues, DN(P(c, "pressSdMs"))));
            }
            foreach (var c in P(J, "anchorCueTime").EnumerateArray())
            {
                double e = D(P(c, "enterT")), d = D(P(c, "delayS")), corr = D(P(c, "correctionMs"));
                double cueT = Gen1Tid.AnchorCueTime(e, d, corr);
                Check($"anchorCueTime {e}/{d}/{corr}", new[] { D(P(c, "cueT")), D(P(c, "usedFor")), D(P(c, "usedForMinus8ms")) },
                    new[] { cueT, Gen1Tid.CorrectionUsedFor(d, e, cueT), Gen1Tid.CorrectionUsedFor(d, e, cueT - 0.008) });
            }
            foreach (var c in P(J, "recommendation").EnumerateArray())
            {
                var v = DA(P(c, "values"));
                var (code, text) = Gen1Tid.Recommendation(Gen1Tid.AnchorStatsOf(v), Gen1Tid.Drift(v), Gen1Tid.FrameMs, DN(P(c, "pressSdMs")), P(c, "robust").GetBoolean());
                Check($"recommendation {P(c, "values").GetRawText()} press {P(c, "pressSdMs").GetRawText()} robust {P(c, "robust").GetBoolean()}",
                    new[] { S(P(c, "code")), S(P(c, "text")) }, new[] { code, text });
            }
        }

        // ---- C# only: what the vectors cannot say ----------------------------------------
        {
            var red = DATA.TargetSetsFor("red");
            var redTable = DATA.Methodology("red/gba/hold-start-v1").Table;
            var padded = Gen1Tid.DecodeTable("40030000", 2);
            Check("DecodeTable pads below offset_min with NoTid, not $0000", new[] { Gen1Tid.NoTid, Gen1Tid.NoTid, 0x4003, 0 }, padded);
            Check("Invert skips the padding", new[] { 3 }, Gen1Tid.Invert(padded, 0));
            Check("RouteValidTargets skips the padding", new[] { new[] { 2, 0x4003 } }, Gen1Tid.RouteValidTargets(padded, red).Select(x => new[] { x.Offset, x.Tid }).ToArray());
            Check("no sets in force means nothing is route-valid", "no", Gen1Tid.Verdict(0x4003, Array.Empty<TargetSet>()));
            Check("Yellow has no set accepting $4027", "no", Gen1Tid.Verdict(0x4027, DATA.TargetSetsFor("yellow")));
            Check("Yellow route-valid targets under its sets", Array.Empty<int[]>(), Gen1Tid.RouteValidTargets(DATA.Methodology("yellow/gba/hold-start-v1").Table, DATA.TargetSetsFor("yellow")).Select(x => new[] { x.Offset, x.Tid }).ToArray());
            Refuses("Verdict without sets", () => Gen1Tid.Verdict(0x4003, null));
            Refuses("VerdictTextFor without sets", () => Gen1Tid.VerdictTextFor(0x4003, null));
            Refuses("SetsAccepting without sets", () => Gen1Tid.SetsAccepting(0x4003, null));
            Refuses("RouteValidTargets without sets", () => Gen1Tid.RouteValidTargets(redTable, null));
            Refuses("Verify without sets", () => Gen1Tid.Verify(redTable, 0x4003, 7.35));
            Refuses("Verify tid 70000", () => Gen1Tid.Verify(redTable, 70000, 7.35, 3, 0.0, red));
            Refuses("Verify NaN seconds", () => Gen1Tid.Verify(redTable, 0x4003, double.NaN, 3, 0.0, red));
            Refuses("Verdict 65536", () => Gen1Tid.Verdict(65536, red));
            Refuses("Verdict -1", () => Gen1Tid.Verdict(-1, red));
            Refuses("Invert 65536", () => Gen1Tid.Invert(redTable, 65536));
            Refuses("SidAt 65536", () => Gen1Tid.SidAt(65536, 0));
            Refuses("SidAt -1", () => Gen1Tid.SidAt(-1, 0));
            Refuses("SidAt k -1", () => Gen1Tid.SidAt(0x4003, -1));
            Refuses("KForSid sid 65536", () => Gen1Tid.KForSid(0x4003, 65536, 10));
            Refuses("ResetSchedule empty order", () => Gen1Tid.ResetSchedule(200, Array.Empty<string>(), 1));
            Refuses("ResetSchedule one action", () => Gen1Tid.ResetSchedule(200, new[] { "RESET" }, 1));
            Refuses("ResetSchedule NaN interval", () => Gen1Tid.ResetSchedule(double.NaN, new[] { "RESET", "A" }, 1));
            Refuses("TargetSetsFor unknown game", () => DATA.TargetSetsFor("gold"));
            Refuses("DecodeTable negative offset_min", () => Gen1Tid.DecodeTable("4003", -1));
            Refuses("reset on a methodology without the anchor", () => Gen1Tid.BuildSchedule("reset", DATA.Methodology("red/dmg/hold-start-v1").Timing, 358, 100, 4, 1.0,
                Gen1Tid.ResetAnchorExtraSeconds(DATA.ResetModel("gbp-fade")), DATA.Methodology("red/dmg/hold-start-v1")));
            Check("ParseTid takes any number of leading zeros", 0x4003, Gen1Tid.ParseTid("$0000000000004003"));
            Refuses("ParseTid 20 digits over the range", () => Gen1Tid.ParseTid("99999999999999999999"));
        }

        // ---- the panel's footnotes (Gen1TidSupport.cs over Citations.cs): the protocol of Red on GSE lists its sources with
        // the pokered title-loop line under its FACTS.md section and the table under EMULATOR-EXACT, the text the web tab
        // prints (tests/test-webapp.cjs pins the same lines); the GBA HD and the DMG print HARDWARE-VALIDATED n, Yellow
        // its pokeyellow lines and EMPIRICAL; the target line, the schedule and verify carry the block's numbers; no
        // citation is outside the registry (the registry given on the command line, or the embedded copy:
        // app/run-core-tests.sh passes a copy without the hold-START line as its negative control) ----
        {
            Citations.LoadCitations(citationsPath);
            Check("the citation registry is loaded", true, Citations.Loaded);
            var gse = Gen1Platform.Resolve(DATA, "red", "gse", null, null);
            var sched = Gen1TidText.BuildSchedule(gse, "menu", 358, 200, 4, 1.0);
            var proto = Gen1TidText.ProtocolLines(gse, "menu", 358, sched, 200, 4, 1.0);
            Check("protocol footnote count", 5, proto.Count(l => l.StartsWith("  [^")));
            Check("protocol Sources header with the status note", true, proto.Contains(Citations.Header + Citations.StatusNote));
            Check("protocol hold-START footnote", true, proto.Contains("  [^1] pokered/engine/movie/title.asm:227-239,266 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): the title screen waits on CheckForUserInterruption (one JoypadLowSensitivity poll per frame; START or A ends it), then the cry and the fade play before MainMenu, so START held anywhere in the window is read on the first poll and the NEW GAME menu opens on one fixed frame"));
            Check("protocol table footnote under EMULATOR-EXACT", true, proto.Contains("  [^2] EMULATOR-EXACT (no decomp line; the table's derivation on pokemon-speedrunning/gambatte-core with START held inside the window, docs/FACTS.md Gen 1 Trainer ID (hold-START methodologies, RNG Solution)): hold START on any frame 1300-1475 and the NEW GAME menu opens on frame 1553; the A press frame is the menu frame + 80 + the offset (the table's definition), one Trainer ID per offset under red/gba/hold-start-v1; GSE or gambatte-speedrun in GBP mode with the GBC BIOS: emulator-exact"));
            Check("protocol steps marked", true, proto.Any(l => l.StartsWith(" 3. ") && l.EndsWith(" [^1] [^2]")) && proto.Any(l => l.StartsWith(" 4. ") && l.EndsWith(" [^2] [^3]")) && proto.Contains("    Press A ON the long high beep. That is the only frame-exact action. [^4] [^5] [^2]"));
            Check("no footnote outside the registry", 0, Citations.ProcedureProblems(proto).Count);
            Check("protocol roll footnote names the Trainer ID section (the registry files the pokered line first under the DV roll)", true, proto.Any(l => l.StartsWith("  [^4] pokered/engine/movie/oak_speech/init_player_data.asm:1-10 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): InitPlayerData2")) && Citations.FootnoteText(4, new Citations.CiteSource("pokered/engine/movie/oak_speech/init_player_data.asm:1-10", null, "x")).EndsWith(" (docs/FACTS.md: Gen 1/2 (Game Boy) / Where DVs are rolled): x"));
            Check("a section the registry does not file the line under is NOT IN THE REGISTRY", 1, Citations.ProcedureProblems(new[] { "  " + Citations.FootnoteText(4, new Citations.CiteSource("pokered/engine/movie/oak_speech/init_player_data.asm:1-10", null, "x", Section: "Gen 1/2 (Game Boy) / The RNG")) }).Count);
            Check("target line marked", true, Gen1TidText.DescribeTarget(gse, 358).EndsWith(" [3x cold-boot verified] [^2] [^4]"));
            Check("schedule A cue marked", true, Gen1TidText.ScheduleLines(sched, 358, 200, gse).Last().EndsWith(" [^2]"));
            var verify = Gen1TidText.VerifyLines(Gen1Platform.Resolve(DATA, "red", "gbp", null, null), 0x4003, 7.333, false, 3, null).Lines;
            Check("verify carries the table and roll footnotes and its Sources", true, verify.Contains("  the table produces it at offset 358 [^2] [^4]") && verify.Any(l => l.StartsWith("  [^2] EMPIRICAL (no decomp line; ")) && verify.Any(l => l.StartsWith("  [^4] pokered/engine/movie/oak_speech/init_player_data.asm:1-10 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): InitPlayerData2")) && verify.Count(l => l.StartsWith("  [^")) == 2);
            var hd = Gen1Platform.Resolve(DATA, "red", "gba-hd", null, null);
            Check("GBA HD status word", "HARDWARE-VALIDATED 5 of 5", Gen1TidText.StatusWord(hd));
            Check("GBA HD protocol prints it", true, Gen1TidText.ProtocolLines(hd, "menu", 358, Gen1TidText.BuildSchedule(hd, "menu", 358, 200, 4, 1.0), 200, 4, 1.0).Any(l => l.StartsWith("  [^2] HARDWARE-VALIDATED 5 of 5 (no decomp line; ")));
            var dmg = Gen1Platform.Resolve(DATA, "red", "dmg", null, null);
            var dmgProto = Gen1TidText.ProtocolLines(dmg, "poweron", 517, Gen1TidText.BuildSchedule(dmg, "poweron", 517, 100, 4, 1.0), 100, 4, 1.0);
            Check("DMG status word", "HARDWARE-VALIDATED 5 of 6", Gen1TidText.StatusWord(dmg));
            Check("DMG power-on protocol prints it with its window", true, dmgProto.Any(l => l.StartsWith("  [^2] HARDWARE-VALIDATED 5 of 6 (no decomp line; ") && l.Contains("hold START on any frame 1450-1640 and the NEW GAME menu opens on frame 1701")) && dmgProto.Any(l => l.StartsWith(" 3. Two low beeps") && l.EndsWith(" [^1] [^2]")));
            var yellow = Gen1Platform.Resolve(DATA, "yellow", "gba-hd", null, null);
            var yProto = Gen1TidText.ProtocolLines(yellow, "menu", 358, Gen1TidText.BuildSchedule(yellow, "menu", 358, 200, 4, 1.0), 200, 4, 1.0);
            Check("Yellow status word", "EMPIRICAL", Gen1TidText.StatusWord(yellow));
            Check("Yellow cites pokeyellow", true, yProto.Any(l => l.StartsWith("  [^1] pokeyellow/engine/movie/title.asm:166-175 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): Yellow's title loop")) && yProto.Any(l => l.StartsWith("  [^2] EMPIRICAL (no decomp line; ")) && yProto.Any(l => l.StartsWith("  [^4] pokeyellow/engine/movie/oak_speech/init_player_data.asm:1-10 (docs/FACTS.md: ")) && yProto.Any(l => l.StartsWith("  [^5] pokeyellow/engine/math/random.asm:1-13 (docs/FACTS.md: ")));
            Check("no Yellow footnote outside the registry", 0, Citations.ProcedureProblems(yProto).Count);
        }

        if (failures > 0)
        {
            Console.Error.WriteLine($"{failures} failure(s) in {checks} gen1tid checks");
            return 1;
        }
        Console.WriteLine($"all C# gen1tid parity checks passed ({checks} checks)");
        return 0;
    }
}
