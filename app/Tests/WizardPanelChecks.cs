using System.Globalization;
using System.Text.Json;
using ShinySolution.App;
using ShinySolution.Core;

// The desktop wizard panel's pure part (app/App/WizardSupport.cs, compiled into this project) against
// tests/wizard-panel-vectors.json, emitted from the web app's wizard tab (webapp/wizard-ui.js) by
// tools/gen-wizard-panel-vectors.cjs: the number formats JavaScript prints, the games, consoles and seed models
// with their texts, the setup text per game and console, the static / gift catalogue and the wild tables of every
// game, the slots by map, kind and time of day with the slot shares, the lead options, the filter refusals; the
// three self-test scenarios (the Ruby Groudon Method 4 static at frame 3 with its typed outcome and the flawless
// Emerald limit; the Emerald Route 111 wild slot at frame 7; the gate seed 7B0448D1 at frame 0 with the coin-flip
// identification, the calibrated delay 500 -> 503 and the Route 222 Magnet Pull seed) and 20 random wanted-IV
// searches, each with its search lines, its hit or row list (PID, IVs, frame, seed, date, time, delay and the mon),
// its card, its procedure, its timer phases and its typed outcome, line for line; and the store split by mode and
// seed model. Floats to 1e-9 (relative above |1|), strings exact. app/run-core-tests.sh runs it on the committed
// file, then on a corrupted copy that must fail.
static class WizardPanelChecks
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
        if (expected.ValueKind == JsonValueKind.String && expected.GetString() == "Infinity") { if (!double.IsPositiveInfinity(actual)) Fail(label, $"expected Infinity, actual {actual:R}"); return; }
        if (expected.ValueKind != JsonValueKind.Number || !Near(actual, expected.GetDouble())) Fail(label, $"expected {expected.GetRawText()}, actual {actual:R}");
    }
    static void CheckNumN(string label, double? actual, JsonElement expected)
    {
        checks++;
        bool ok = expected.ValueKind == JsonValueKind.Null || expected.ValueKind == JsonValueKind.Undefined ? actual is null : actual is not null && expected.ValueKind == JsonValueKind.Number && Near(actual.Value, expected.GetDouble());
        if (!ok) Fail(label, $"expected {expected.GetRawText()}, actual {(actual is null ? "null" : actual.Value.ToString("R"))}");
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
        if (expected.ValueKind != JsonValueKind.Array) { Fail(label, "no expected lines: " + expected.GetRawText()); return; }
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
    static string S(JsonElement e, string k) => e.GetProperty(k).GetString() ?? "";
    static string? SN(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static int I(JsonElement e, string k) => e.GetProperty(k).GetInt32();
    static int? IN(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;
    static double D(JsonElement e, string k) => e.GetProperty(k).GetDouble();
    static bool B(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
    static bool Has(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null;
    static int[] Ints(JsonElement e) => e.EnumerateArray().Select(x => x.GetInt32()).ToArray();
    static List<string> Strs(JsonElement e) => e.EnumerateArray().Select(x => x.GetString() ?? "").ToList();

    // ---- the shapes both heads build ---------------------------------------------------------------------
    static string MonText(GenResult m) => string.Join("|", new object[]
    {
        m.Frame, Js.Hex8(m.Pid), string.Join("/", m.Ivs), m.Nature, m.Gender, m.Shiny ? 1 : 0, m.Level, string.Join("/", m.Stats), m.CallsUsed,
        m.EncounterSlot, m.AbilitySlot, Generators.HiddenPowerTypes[m.HiddenPower], m.HiddenPowerPower
    });
    static string RowText(WizardGen4Row r) => string.Join("|", new object[]
    {
        Js.Hex8(r.Seed), r.Frame, r.Year + "-" + Js.Two(r.Month) + "-" + Js.Two(r.Day) + " " + Js.Two(r.Hour) + ":" + Js.Two(r.Minute) + ":" + Js.Two(r.Second), r.Delay, r.DelayDistance, Js.Hex8(r.Origin), MonText(r.Mon)
    });
    static string SlotText(WizardSlot s) => s.Species.Dex + ":" + s.MinLevel + "-" + s.MaxLevel + ":" + s.Form;
    static string ValueText(WizardCalValue v) => JsonSerializer.Serialize(v);

    // ---- one configuration from its input block (the emitter's cfgFromInput) ------------------------------------
    static WizardWanted WantedOf(JsonElement w)
    {
        var mn = Ints(w.GetProperty("ivMin")); var mx = Ints(w.GetProperty("ivMax"));
        var out_ = new WizardWanted { Nature = IN(w, "nature"), Gender = SN(w, "gender"), Ability = IN(w, "ability"), Shiny = B(w, "shiny"), Tid = IN(w, "tid"), Sid = IN(w, "sid"), Species = IN(w, "species") };
        for (int i = 0; i < 6; i++) { out_.IvMin[i] = mn[i]; out_.IvMax[i] = mx[i]; }
        return out_;
    }
    static WizardCfg CfgFrom(JsonElement input)
    {
        var game = Wizard.Game(S(input, "game"));
        var cfg = new WizardCfg { Game = game.Key, Console = S(input, "console"), Kind = S(input, "kind") };
        if (cfg.Kind == "static")
        {
            var e = Wizard.StaticEntries(game.Key).First(x => x.Id == S(input, "staticId"));
            cfg.Species = e.Species; cfg.Level = e.Level; cfg.BuggedRoamer = e.BuggedRoamer; cfg.ShinyMode = e.ShinyMode; cfg.StaticMethod = e.Method; cfg.StaticLabel = e.Label;
            cfg.Method = game.Gen == 3 ? S(input, "method") : e.Method;
        }
        else
        {
            var t = Wizard.WildTables(game.Key).First(x => x.Index == I(input, "tableIndex"));
            var sl = Wizard.SlotsFor(game.Key, t.Index, S(input, "encounter"), SN(input, "time"));
            cfg.Slots = sl.Slots; cfg.Rate = sl.Rate; cfg.Encounter = S(input, "encounter"); cfg.TableName = t.Name; cfg.Tanoby = sl.Tanoby;
            cfg.Method = game.Gen == 3 ? S(input, "method") : game.Method!;
        }
        cfg.Lead = Wizard.MakeLead(S(input, "leadKey"), I(input, "leadNature"), S(input, "leadGender"), I(input, "leadLevel"));
        cfg.Wanted = WantedOf(input.GetProperty("wanted"));
        if (game.Gen == 3)
        {
            cfg.Seed = Has(input, "seed") ? uint.Parse(S(input, "seed"), NumberStyles.HexNumber, CultureInfo.InvariantCulture) : null;
            cfg.MaxFrame = (long)Js.Round(Math.Min(240, Math.Max(0.1, D(input, "minutes"))) * 60 * Wizard.FpsOf(cfg.Console));
            cfg.Limit = 20;
        }
        else
        {
            cfg.MaxFrame = I(input, "maxFrame"); cfg.YearMin = I(input, "yearMin"); cfg.YearMax = I(input, "yearMax");
            cfg.DelayMin = I(input, "delayMin"); cfg.DelayMax = I(input, "delayMax"); cfg.TargetDelay = I(input, "targetDelay"); cfg.Limit = 30;
        }
        return cfg;
    }
    static Gen3Model Gen3ModelOf(JsonElement input, long targetFrame) => new(Gen3Mode.Standard, D(input, "preTimer"), targetFrame, D(input, "calibration"));
    static Gen4Model Gen4ModelOf(JsonElement input, int targetDelay, int targetSecond) => new(targetDelay, targetSecond, D(input, "calibratedDelay"), D(input, "calibratedSecond"));

    // ---- one Gen 3 / Gen 4 case: the search, the first hit's card, procedure, phases and typed outcome -----------------
    static WizardGen3Result CheckGen3Case(string label, JsonElement c, out WizardCfg cfg)
    {
        cfg = CfgFrom(c.GetProperty("input"));
        var r = Wizard.SearchGen3(cfg);
        CheckLines(label + ": search lines", Wizard.Gen3SearchLines(r, cfg), c.GetProperty("lines"));
        CheckLines(label + ": hits", r.Hits.Select(MonText).ToList(), c.GetProperty("hits"));
        Check(label + ": maxFrame and limit", r.MaxFrame == c.GetProperty("maxFrame").GetInt64() && r.Limit == I(c, "limit"), $"{r.MaxFrame} {r.Limit}");
        var fs = c.GetProperty("feasibility");
        CheckNum(label + ": ivPer100k", r.Feasibility.IvPer100k, fs.GetProperty("ivPer100k"));
        Check(label + ": ivExact and words", r.Feasibility.IvExact == B(fs, "ivExact") && r.Feasibility.WordsA == fs.GetProperty("wordsA").GetInt64() && r.Feasibility.WordsB == fs.GetProperty("wordsB").GetInt64(), $"{r.Feasibility.IvExact} {r.Feasibility.WordsA} {r.Feasibility.WordsB}");
        CheckNum(label + ": odds", r.Feasibility.Odds, fs.GetProperty("odds"));
        CheckNum(label + ": per100k", r.Feasibility.Per100k, fs.GetProperty("per100k"));
        CheckNum(label + ": expected frames", r.Feasibility.ExpectedFrames, fs.GetProperty("expectedFrames"));
        CheckLines(label + ": feasibility parts", r.Feasibility.Parts, fs.GetProperty("parts"));
        var ef = c.GetProperty("exactFirst");
        if (ef.ValueKind == JsonValueKind.Null) Check(label + ": no exact-first block", r.ExactFirst is null, "an exact-first block was computed");
        else
        {
            Check(label + ": exact-first states", r.ExactFirst is not null && r.ExactFirst.States == I(ef, "states"), r.ExactFirst?.States.ToString() ?? "null");
            Check(label + ": exact-first frame", r.ExactFirst is not null && (r.ExactFirst.Found ? r.ExactFirst.Frame : -1) == ef.GetProperty("frame").GetInt64(), r.ExactFirst?.Frame.ToString() ?? "null");
            if (r.ExactFirst is not null && r.ExactFirst.Found) { CheckStr(label + ": exact-first pid", Js.Hex8(r.ExactFirst.Pid), ef.GetProperty("pid")); CheckStr(label + ": exact-first state", Js.Hex8(r.ExactFirst.State), ef.GetProperty("state")); }
        }
        if (r.Hits.Count > 0 && Has(c, "card"))
        {
            var m = r.Hits[0];
            string timeText = Js.FmtMs(Wizard.FrameToMs(m.Frame, cfg.Console)) + " after the seed";
            CheckLines(label + ": card", Wizard.CardLines(m, cfg, cfg.Seed ?? 0, timeText), c.GetProperty("card"));
            var tm = Gen3ModelOf(c.GetProperty("input"), m.Frame);
            CheckLines(label + ": procedure", Wizard.Gen3Procedure(cfg, m, tm), c.GetProperty("procedure"));
            CheckNums(label + ": phases", Timers.Gen3Phases(Wizard.Settings(cfg.Console), tm), c.GetProperty("phases"));
            var id = Wizard.Gen3IdentifyHit(cfg, m.Frame, m.Nature, m.Ivs, null, 3000);
            var eid = c.GetProperty("identify");
            Check(label + ": typed outcome inverts to the hit", (id.Hit?.Frame ?? -1) == eid.GetProperty("frame").GetInt64() && id.Candidates == I(eid, "candidates"), $"{id.Hit?.Frame} {id.Candidates}");
        }
        else Check(label + ": no card when nothing was hit", r.Hits.Count == 0 && !Has(c, "card"), $"{r.Hits.Count} hits");
        return r;
    }
    static WizardGen4Result CheckGen4Case(string label, JsonElement c, out WizardCfg cfg)
    {
        cfg = CfgFrom(c.GetProperty("input"));
        var r = Wizard.SearchGen4(cfg);
        CheckLines(label + ": search lines", Wizard.Gen4SearchLines(r, cfg), c.GetProperty("lines"));
        if (Has(c, "error"))
        {
            CheckStr(label + ": error", r.Error, c.GetProperty("error"));
            Check(label + ": combination count", r.Count == c.GetProperty("count").GetInt64(), r.Count.ToString());
            return r;
        }
        Check(label + ": no error", r.Error is null, r.Error ?? "");
        CheckLines(label + ": rows", r.Rows.Select(RowText).ToList(), c.GetProperty("rows"));
        Check(label + ": combos, origins, candidates, verified, maxFrame", r.Combos == c.GetProperty("combos").GetInt64() && r.Origins == I(c, "origins") && r.Candidates == I(c, "candidates") && r.Verified == I(c, "verified") && r.MaxFrame == c.GetProperty("maxFrame").GetInt64(),
            $"{r.Combos} {r.Origins} {r.Candidates} {r.Verified} {r.MaxFrame}");
        var fs = c.GetProperty("feasibility");
        CheckNum(label + ": ivPer100k", r.Feasibility.IvPer100k, fs.GetProperty("ivPer100k"));
        Check(label + ": ivExact", r.Feasibility.IvExact == B(fs, "ivExact"), r.Feasibility.IvExact.ToString());
        CheckNum(label + ": per100k", r.Feasibility.Per100k, fs.GetProperty("per100k"));
        CheckLines(label + ": feasibility parts", r.Feasibility.Parts, fs.GetProperty("parts"));
        if (r.Rows.Count > 0 && Has(c, "card"))
        {
            var row = r.Rows[0];
            var input = c.GetProperty("input");
            CheckLines(label + ": card", Wizard.CardLines(row.Mon, cfg, row.Seed, Wizard.TimeText(row)), c.GetProperty("card"));
            var tm = Gen4ModelOf(input, row.Delay, row.Second);
            long current = I(input, "current"); int party = I(input, "party");
            var plan = SeedTime4.PlanAdvances(current, row.Frame, party, Wizard.AdvanceToolsFor(cfg.Game));
            CheckLines(label + ": procedure", Wizard.Gen4Procedure(cfg, row, tm, plan, current, party), c.GetProperty("procedure"));
            CheckNums(label + ": phases", Timers.Gen4Phases(Wizard.Settings(cfg.Console), tm), c.GetProperty("phases"));
            CheckNum(label + ": minutes before", Timers.Gen4MinutesBefore(Wizard.Settings(cfg.Console), tm), c.GetProperty("minutesBefore"));
        }
        else Check(label + ": no card when no row", r.Rows.Count == 0 && !Has(c, "card"), $"{r.Rows.Count} rows");
        return r;
    }
    static void CheckRecord(string label, Wizard.OutcomeReport o, JsonElement exp)
    {
        CheckLines(label + ": lines", o.Lines, exp.GetProperty("lines"));
        var es = exp.GetProperty("sample");
        if (es.ValueKind == JsonValueKind.Null) Check(label + ": no sample", o.Sample is null, o.Sample is null ? "" : JsonSerializer.Serialize(o.Sample));
        else
        {
            Check(label + ": sample recorded", o.Sample is not null, "none");
            if (o.Sample is not null) CheckSample(label + ": sample", o.Sample, es);
        }
    }
    static void CheckSample(string label, WizardCalSample a, JsonElement e)
    {
        CheckStr(label + " model", a.Model, e.GetProperty("model"));
        CheckNum(label + " target", a.Target, e.GetProperty("target"));
        CheckNum(label + " hit", a.Hit, e.GetProperty("hit"));
        CheckNumN(label + " second offset", a.SecondOffset, e.TryGetProperty("secondOffset", out var so) ? so : default);
        CheckStr(label + " typed", a.Typed, e.TryGetProperty("typed", out var ty) ? ty : JsonDocument.Parse("null").RootElement);
        CheckStr(label + " before", ValueText(a.Before), JsonDocument.Parse(JsonSerializer.Serialize(JsonSerializer.Serialize(JsonSerializer.Deserialize<WizardCalValue>(e.GetProperty("before").GetRawText())))).RootElement);
        CheckStr(label + " after", ValueText(a.After), JsonDocument.Parse(JsonSerializer.Serialize(JsonSerializer.Serialize(JsonSerializer.Deserialize<WizardCalValue>(e.GetProperty("after").GetRawText())))).RootElement);
        CheckNumN(label + " candidates", a.Candidates, e.TryGetProperty("candidates", out var ca) ? ca : default);
        CheckStr(label + " attempt", a.Attempt, e.TryGetProperty("attempt", out var at) ? at : JsonDocument.Parse("null").RootElement);
        CheckStr(label + " mode", a.Mode, e.TryGetProperty("mode", out var mo) ? mo : JsonDocument.Parse("null").RootElement);
        CheckStr(label + " when", a.When, e.TryGetProperty("when", out var wh) ? wh : JsonDocument.Parse("null").RootElement);
    }
    static void CheckStore(string label, Dictionary<string, WizardCalEntry> store, JsonElement exp)
    {
        var keys = exp.EnumerateObject().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToList();
        Check(label + ": store keys", keys.SequenceEqual(store.Keys.OrderBy(x => x, StringComparer.Ordinal)), string.Join(",", store.Keys));
        foreach (var k in keys)
        {
            if (!store.TryGetValue(k, out var entry)) continue;
            var samples = exp.GetProperty(k).GetProperty("samples").EnumerateArray().ToList();
            Check($"{label}: {k} has {samples.Count} samples", entry.Samples.Count == samples.Count, entry.Samples.Count.ToString());
            for (int i = 0; i < Math.Min(samples.Count, entry.Samples.Count); i++) CheckSample($"{label}: {k} sample {i}", entry.Samples[i], samples[i]);
        }
    }
    static void CheckInForce(string label, WizardInForce f, JsonElement exp, string mode, string modelId)
    {
        CheckStr(label + ": value", ValueText(f.Value), JsonDocument.Parse(JsonSerializer.Serialize(JsonSerializer.Serialize(JsonSerializer.Deserialize<WizardCalValue>(exp.GetProperty("value").GetRawText())))).RootElement);
        Check(label + ": sample counts", f.Samples.Count == I(exp, "samples") && f.Ignored.Count == I(exp, "ignored"), $"{f.Samples.Count} {f.Ignored.Count}");
        if (Has(exp, "lines")) CheckLines(label + ": ignored lines", Wizard.IgnoredLines(f.Ignored, mode, modelId), exp.GetProperty("lines"));
    }
    static Dictionary<string, WizardCalEntry> StoreOf(JsonElement e) => JsonSerializer.Deserialize<Dictionary<string, WizardCalEntry>>(e.GetRawText()) ?? new();
    static WizardGen4Row RowOf(WizardGen4Result r, int index) => r.Rows[index];

    public static int Run(string vectorsPath, string? citationsPath = null)
    {
        var V = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;
        Wizard.SetData(WizardData.LoadEmbedded(3));
        Wizard.SetData(WizardData.LoadEmbedded(4));
        // the decomp citation registry the procedure footnotes are rendered over: the embedded copy, or the file given
        // (app/run-core-tests.sh passes a copy with one entry removed as its negative control)
        Wizard.LoadCitations(citationsPath);
        Check("the citation registry is loaded", Wizard.CitationsLoaded, "no registry");
        string when = S(V, "when");
        const string RUN = Modes.Run, PRACTICE = Modes.Practice;

        // ---- the number formats JavaScript prints ----
        foreach (var f in V.GetProperty("jsFormat").EnumerateArray())
        {
            double v = double.Parse(S(f, "v"), CultureInfo.InvariantCulture);
            string l = "js format " + S(f, "v");
            CheckStr(l + " toFixed(1)", Js.Fixed(v, 1), f.GetProperty("fixed1"));
            CheckStr(l + " toFixed(4)", Js.Fixed(v, 4), f.GetProperty("fixed4"));
            CheckStr(l + " toPrecision(3)", Js.Precision(v, 3), f.GetProperty("prec3"));
            CheckStr(l + " toPrecision(4)", Js.Precision(v, 4), f.GetProperty("prec4"));
            CheckStr(l + " Math.round", Js.Num(Js.Round(v)), f.GetProperty("round"));
            CheckStr(l + " toString", Js.Num(v), f.GetProperty("num"));
            CheckStr(l + " f1", Js.F1(v), f.GetProperty("f1"));
        }
        foreach (var f in V.GetProperty("fmtMs").EnumerateArray()) CheckStr("fmtMs " + f.GetProperty("ms").GetRawText(), Js.FmtMs(D(f, "ms")), f.GetProperty("text"));

        // ---- games, consoles, seed models, the setup text ----
        var games = V.GetProperty("games").EnumerateArray().ToList();
        Check("ten games in the design's order", games.Select(g => S(g, "key")).SequenceEqual(Wizard.GameOrder), string.Join(",", Wizard.GameOrder));
        foreach (var g in games)
        {
            var game = Wizard.Game(S(g, "key"));
            Check("game " + game.Key, game.Name == S(g, "name") && game.Gen == I(g, "gen") && game.Family == S(g, "family") && game.Method == SN(g, "method") && game.Model == S(g, "model"), $"{game.Name} {game.Gen} {game.Family} {game.Method} {game.Model}");
            CheckLines("consoles of " + game.Key, Wizard.ConsolesFor(game.Key).Select(c => c.Key).ToList(), g.GetProperty("consoles"));
        }
        foreach (var c in V.GetProperty("consoles").EnumerateArray())
        {
            var con = Wizard.Consoles[S(c, "key")];
            Check("console " + con.Key, con.Gen == I(c, "gen") && con.Name == S(c, "name"), con.Name);
            CheckNum("fps " + con.Key, Wizard.FpsOf(con.Key), c.GetProperty("fps"));
            CheckNum("frame 1000 ms " + con.Key, Wizard.FrameToMs(1000, con.Key), c.GetProperty("frame1000ms"));
        }
        foreach (var m in V.GetProperty("models").EnumerateArray())
        {
            var model = Wizard.SeedModels[S(m, "id")];
            CheckStr("model " + model.Id + " kind", model.Kind, m.GetProperty("kind"));
            CheckNumN("model " + model.Id + " seed", model.Seed, m.GetProperty("seed"));
            CheckStr("model " + model.Id + " text", model.Text, m.GetProperty("text"));
            CheckStr("model " + model.Id + " typed", model.Typed, m.GetProperty("typed"));
            CheckStr("model " + model.Id + " status", model.Status, m.GetProperty("status"));
        }
        foreach (var ml in V.GetProperty("modelLines").EnumerateArray()) CheckLines("setup text " + S(ml, "game") + " " + S(ml, "console"), Wizard.ModelLines(S(ml, "game"), S(ml, "console")), ml.GetProperty("lines"));
        var texts = V.GetProperty("texts");
        CheckStr("the no-hardware statement", Wizard.NoHardware, texts.GetProperty("noHardware"));
        CheckStr("the Cute Charm note", Wizard.Gen4CuteCharmNote, texts.GetProperty("cuteCharm"));
        CheckStr("the web store key", Wizard.StoreKey, texts.GetProperty("storeKey"));
        foreach (var k in texts.GetProperty("kindNames").EnumerateObject()) CheckStr("kind name " + k.Name, Wizard.KindNames[k.Name], k.Value);

        // ---- the catalogue and the tables ----
        foreach (var g in Wizard.GameOrder)
        {
            CheckLines("statics of " + g, Wizard.StaticEntries(g).Select(e => string.Join("|", new object[] { e.Id, e.Label, e.Method, e.ShinyMode, e.BuggedRoamer ? 1 : 0, e.Refused ?? "", e.Level, e.Species.Dex, e.Provenance ?? "", e.LevelVerified ? 1 : 0 })).ToList(), V.GetProperty("statics").GetProperty(g));
            CheckLines("tables of " + g, Wizard.WildTables(g).Select(t => string.Join("|", new object[] { t.Index, t.Name, string.Join(",", t.Kinds), t.Tanoby ? 1 : 0 })).ToList(), V.GetProperty("tables").GetProperty(g));
            CheckLines("static leads of " + g, Wizard.LeadOptions(g, "static").Select(l => l.Key + "|" + l.Name).ToList(), V.GetProperty("leads").GetProperty(g).GetProperty("static"));
            CheckLines("wild leads of " + g, Wizard.LeadOptions(g, "wild").Select(l => l.Key + "|" + l.Name).ToList(), V.GetProperty("leads").GetProperty(g).GetProperty("wild"));
        }
        foreach (var q in V.GetProperty("slots").EnumerateArray())
        {
            string l = "slots " + S(q, "game") + " " + I(q, "index") + " " + S(q, "kind") + " " + (SN(q, "time") ?? "-");
            var sl = Wizard.SlotsFor(S(q, "game"), I(q, "index"), S(q, "kind"), SN(q, "time"));
            Check(l + ": rate, note, tanoby", sl.Rate == I(q, "rate") && sl.Note == SN(q, "note") && sl.Tanoby == B(q, "tanoby"), $"{sl.Rate} {sl.Note} {sl.Tanoby}");
            CheckLines(l + ": slots", sl.Slots.Select(SlotText).ToList(), q.GetProperty("slots"));
            CheckLines(l + ": species groups and shares", Wizard.SpeciesInSlots(sl.Slots).Select(s => s.Species.Dex + ":" + string.Join(",", s.Slots) + ":" + string.Join("/", s.Levels) + ":" + Js.F1(100 * Wizard.SpeciesShare(S(q, "game"), S(q, "kind"), sl.Slots, s.Species.Dex))).ToList(), q.GetProperty("groups"));
        }
        {
            var errs = new List<string>();
            try { Wizard.SlotsFor("heartgold", 0, "grass", null); } catch (ArgumentException e) { errs.Add(e.Message); }
            try { Wizard.SlotsFor("platinum", 0, "grass", null); } catch (ArgumentException e) { errs.Add(e.Message); }
            CheckLines("a table without the kind is refused", errs, V.GetProperty("slotErrors"));
        }

        // ---- the filter refusals ----
        {
            var got = new Dictionary<string, string>();
            string Msg(Action a) { try { a(); return ""; } catch (Exception e) { return e.Message; } }
            got["shiny without IDs"] = Msg(() => Wizard.BuildFilter(new WizardWanted { Shiny = true }));
            got["IV range out of order"] = Msg(() => Wizard.BuildFilter(new WizardWanted { IvMin = new int?[] { 5, null, null, null, null, null }, IvMax = new int?[] { 4, null, null, null, null, null } }));
            got["IV above 31"] = Msg(() => Wizard.BuildFilter(new WizardWanted { IvMax = new int?[] { null, null, null, null, null, 32 } }));
            var treecko = Wizard.StaticEntries("emerald").First(e => e.Id == "rse/starter/treecko");
            got["FRLG without a seed"] = Msg(() => Wizard.SearchGen3(new WizardCfg { Game = "firered", Console = "GBA", Seed = null, Kind = "static", Species = treecko.Species, Level = 5, MaxFrame = 10 }));
            var turtwig = Wizard.StaticEntries("platinum").First(e => e.Id == "pt/starter/turtwig");
            got["Gen 4 combination cap"] = Wizard.SearchGen4(new WizardCfg { Game = "platinum", Console = "NDS_SLOT1", Kind = "static", StaticMethod = "M1", Species = turtwig.Species, Level = 5, MaxFrame = 100, YearMin = 2000, YearMax = 2000, TargetDelay = 600, Limit = 30 }).Error ?? "";
            var uxie = Wizard.StaticEntries("platinum").First(e => e.Id == "dppt/legend/uxie");
            got["Gen 4 J cap"] = Wizard.SearchGen4(new WizardCfg { Game = "platinum", Console = "NDS_SLOT1", Kind = "static", StaticMethod = uxie.Method, Species = uxie.Species, Level = uxie.Level, MaxFrame = 100, YearMin = 2000, YearMax = 2000, TargetDelay = 600, Limit = 30,
                Wanted = new WizardWanted { IvMin = new int?[] { 28, 28, 28, 28, 28, 28 }, IvMax = new int?[] { 31, 31, 31, 31, 31, 31 } } }).Error ?? "";
            got["too few flips"] = Wizard.Gen4IdentifyHit("platinum", new WizardGen4Row { Year = 2000, Month = 1, Day = 5, Hour = 4, Minute = 59, Second = 59, Delay = 18641, Seed = 0x7b0448d1 }, "HTH", 10, 0).Error ?? "";
            foreach (var r in V.GetProperty("refusals").EnumerateArray())
            {
                Check("refusal " + S(r, "label") + " is produced", got.ContainsKey(S(r, "label")), "");
                if (got.TryGetValue(S(r, "label"), out var msg)) CheckStr("refusal " + S(r, "label"), msg, r.GetProperty("message"));
            }
        }

        // ---- the scenarios ----
        var sc = V.GetProperty("scenarios");
        {
            // A: Ruby Groudon Method 4 from the typed seed 0: frame 3, its card, procedure and typed outcome
            var a = sc.GetProperty("groudon");
            var rA = CheckGen3Case("A Groudon", a, out var cfgA);
            var entry = Wizard.StaticEntries("ruby").First(e => e.Id == "ruby/legend/groudon");
            var ee = a.GetProperty("entry");
            Check("A: the Groudon entry", entry.Label == S(ee, "label") && entry.Level == I(ee, "level") && entry.Species.Dex == I(ee, "dex") && entry.Method == S(ee, "method") && entry.Refused is null, entry.Label);
            Check("A: frame 3 is the one hit", rA.Hits.Count == 1 && rA.Hits[0].Frame == 3, rA.Hits.Count.ToString());
            var target = rA.Hits[0];
            var idS = Wizard.Gen3IdentifyHit(cfgA, 3, 18, null, target.Stats.Select(x => (int?)x).ToArray(), 3000);
            Check("A: the typed stats invert to frame 3", (idS.Hit?.Frame ?? -1) == a.GetProperty("identifyStats").GetProperty("frame").GetInt64() && idS.Candidates == I(a.GetProperty("identifyStats"), "candidates"), $"{idS.Hit?.Frame} {idS.Candidates}");
            var idN = Wizard.Gen3IdentifyHit(cfgA, 3, 18, null, null, 3000);
            Check("A: the nature alone is ambiguous", (idN.Hit?.Frame ?? -1) == a.GetProperty("identifyNatureOnly").GetProperty("frame").GetInt64() && idN.Candidates == I(a.GetProperty("identifyNatureOnly"), "candidates"), $"{idN.Hit?.Frame} {idN.Candidates}");
            var store = new Dictionary<string, WizardCalEntry>();
            var tmA = new Gen3Model(Gen3Mode.Standard, 5000, 3, 0);
            CheckRecord("A: record", Wizard.RecordGen3(store, cfgA, target, tmA, 18, new[] { 12, 22, 24, 30, 25, 27 }, null, RUN, "started at 00:00:00  [RUN mode]  rs/gba/boot-seed-v0", when), a.GetProperty("record"));
            CheckRecord("A: record wrong", Wizard.RecordGen3(store, cfgA, target, tmA, 3, new[] { 0, 0, 0, 0, 0, 0 }, null, RUN, "", when), a.GetProperty("recordWrong"));
            CheckRecord("A: record empty", Wizard.RecordGen3(store, cfgA, target, tmA, null, null, null, RUN, "", when), a.GetProperty("recordEmpty"));
            var open = new WizardCfg
            {
                Game = cfgA.Game, Console = cfgA.Console, Seed = cfgA.Seed, Kind = cfgA.Kind, Method = cfgA.Method, Species = cfgA.Species, Level = cfgA.Level, BuggedRoamer = cfgA.BuggedRoamer, ShinyMode = cfgA.ShinyMode, StaticMethod = cfgA.StaticMethod, StaticLabel = cfgA.StaticLabel,
                Wanted = new WizardWanted { Tid = cfgA.Wanted.Tid, Sid = cfgA.Wanted.Sid }, MaxFrame = 40, Limit = 20
            };
            var late = Wizard.SearchGen3(open).Hits[8];
            CheckRecord("A: record late in practice", Wizard.RecordGen3(store, cfgA, target, new Gen3Model(Gen3Mode.Standard, 5000, 3, 33.4), null, null, late.Stats.Select(x => (int?)x).ToArray(), PRACTICE, "", when), a.GetProperty("recordLate"));
            CheckStore("A: store", store, a.GetProperty("store"));
            CheckInForce("A: in force in RUN", Wizard.InForce(store, "ruby", "GBA", RUN, "rs/gba/boot-seed-v0"), a.GetProperty("inForce"), RUN, "rs/gba/boot-seed-v0");
            CheckInForce("A: in force in PRACTICE / HUNT", Wizard.InForce(store, "ruby", "GBA", PRACTICE, "rs/gba/boot-seed-v0"), a.GetProperty("inForcePractice"), PRACTICE, "rs/gba/boot-seed-v0");
            // the honest limit: a flawless Treecko from Emerald's seed 0
            var fl = sc.GetProperty("flawless");
            var rF = CheckGen3Case("flawless Emerald", fl, out _);
            Check("flawless: no hit in an hour, 6 states, first frame 176562488", rF.Hits.Count == 0 && rF.ExactFirst is not null && rF.ExactFirst.States == 6 && rF.ExactFirst.Frame == 176562488, $"{rF.Hits.Count} {rF.ExactFirst?.States} {rF.ExactFirst?.Frame}");
        }
        {
            // B: Emerald Route 111 grass from the typed seed 1C71C71C: frame 7
            var b = sc.GetProperty("route111");
            var rB = CheckGen3Case("B Route 111", b, out var cfgB);
            var vec = b.GetProperty("vector");
            Check("B: frame 7 with the vector's PID, slot and level", rB.Hits.Count == 1 && rB.Hits[0].Frame == 7 && Js.Hex8(rB.Hits[0].Pid) == S(vec, "pid") && rB.Hits[0].EncounterSlot == I(vec, "slot") && rB.Hits[0].Level == I(vec, "level"), rB.Hits.Count.ToString());
            CheckNum("B: the slot share", Wizard.SpeciesShare("emerald", "grass", cfgB.Slots!, cfgB.Wanted.Species!.Value), b.GetProperty("share"));
        }
        {
            // C: the gate seed 7B0448D1 -> frame 0, the coin flips, 500 -> 503
            var c = sc.GetProperty("gate");
            var rC = CheckGen4Case("C gate", c, out var cfgC);
            int gi = I(c, "gateIndex");
            Check("C: the gate row is the nearest to the target delay", gi == 0 && rC.Rows.Count > 0 && rC.Rows[0].Seed == 0x7b0448d1 && rC.Rows[0].Frame == 0 && rC.Rows[0].Hour == 4 && rC.Rows[0].Delay == 18641, rC.Rows.Count.ToString());
            var gate = RowOf(rC, gi);
            var store = new Dictionary<string, WizardCalEntry>();
            var tmC = new Gen4Model(18641, 59, 500, 14);
            string flips = Gen4.CoinFlips(0x7b0448d1, 12);
            CheckStr("C: the target's flips", flips, c.GetProperty("flips"));
            CheckStr("C: the neighbour's flips", Gen4.CoinFlips(0x7b0448d5, 12), c.GetProperty("neighbourFlips"));
            CheckRecord("C: record", Wizard.RecordGen4(store, cfgC, gate, tmC, flips, 100, 1, false, false, false, RUN, "started at 00:00:00  [RUN mode]  dppt/nds/seed-to-time-v0", when), c.GetProperty("record"));
            CheckRecord("C: record neighbour", Wizard.RecordGen4(store, cfgC, gate, tmC, "T, T, T, H, T, H, H, H, T, H, H, T", 100, 1, false, false, false, RUN, "", when), c.GetProperty("recordNeighbour"));
            CheckRecord("C: record no match", Wizard.RecordGen4(store, cfgC, gate, tmC, "HHHHHHHHHHHHHHHHHHHH", 2, 0, false, false, false, RUN, "", when), c.GetProperty("recordNoMatch"));
            CheckRecord("C: record short", Wizard.RecordGen4(store, cfgC, gate, tmC, "HTH", 100, 1, false, false, false, RUN, "", when), c.GetProperty("recordShort"));
            CheckRecord("C: record in practice", Wizard.RecordGen4(store, cfgC, gate, new Gen4Model(18641, 59, 503, 14), Gen4.CoinFlips(0x7b0448d1 - 200, 14), 300, 1, false, false, false, PRACTICE, "", when), c.GetProperty("recordPractice"));
            CheckStore("C: store", store, c.GetProperty("store"));
            CheckInForce("C: in force in RUN", Wizard.InForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0"), c.GetProperty("inForce"), RUN, "dppt/nds/seed-to-time-v0");
            CheckLines("C: neighbouring delays", Wizard.CalRowLines("platinum", gate, 3, false, false, false), c.GetProperty("calRows"));
            var id = Wizard.Gen4IdentifyHit("platinum", gate, flips, 100, 1);
            var eid = c.GetProperty("identify");
            CheckLines("C: identify matches", id.Matches.Select(m => Js.Hex8(m.Seed) + "|" + m.Delay + "|" + m.DelayOffset + "|" + m.SecondOffset).ToList(), eid.GetProperty("matches"));
            Check("C: identify rows, typed, family", id.Rows == I(eid, "rows") && id.Typed == S(eid, "typed") && id.Family == S(eid, "family"), $"{id.Rows} {id.Typed} {id.Family}");
            var hg = new WizardGen4Row { Year = 2000, Month = 1, Day = 5, Hour = 4, Minute = 59, Second = 59, Delay = 18641, Seed = 0x7b0448d1 };
            var idH = Wizard.Gen4IdentifyHit("heartgold", hg, "EKEKE", 10, 0, true, false, false);
            var eh = c.GetProperty("hgssIdentify");
            CheckLines("C: HGSS identify matches", idH.Matches.Select(m => Js.Hex8(m.Seed) + "|" + m.Delay + "|" + m.DelayOffset + "|" + m.SecondOffset).ToList(), eh.GetProperty("matches"));
            Check("C: HGSS identify rows, typed, family", idH.Rows == I(eh, "rows") && idH.Typed == S(eh, "typed") && idH.Family == S(eh, "family"), $"{idH.Rows} {idH.Typed} {idH.Family}");
            CheckLines("C: HGSS neighbouring delays with roamers", Wizard.CalRowLines("heartgold", hg, 2, true, true, false), c.GetProperty("hgssCalRows"));
        }
        {
            // D: Route 222 Magnet Pull: seed 5D1745D0 at frame 0
            var d = sc.GetProperty("route222");
            var rD = CheckGen4Case("D Route 222", d, out _);
            int wi = I(d, "wild4Row");
            Check("D: the Magnet Pull vector's seed is reached at frame 0", wi >= 0 && wi < rD.Rows.Count && rD.Rows[wi].Seed == 0x5d1745d0 && rD.Rows[wi].Frame == 0 && rD.Rows[wi].Mon.EncounterSlot == 7, wi.ToString());
        }

        // ---- the store and the mode wall ----
        {
            var st = V.GetProperty("store");
            var store = new Dictionary<string, WizardCalEntry>();
            Wizard.AddSample(store, "platinum", "NDS_SLOT1", new WizardCalSample { Model = "dppt/nds/seed-to-time-v0", Target = 18641, Hit = 18645, Before = new WizardCalValue { CalibratedDelay = 500, CalibratedSecond = 14 }, After = new WizardCalValue { CalibratedDelay = 503, CalibratedSecond = 14 }, When = "t" }, RUN);
            CheckInForce("store: the RUN sample is in force in RUN", Wizard.InForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0"), st.GetProperty("firstRun"), RUN, "dppt/nds/seed-to-time-v0");
            var e = store["platinum/NDS_SLOT1"];
            e.Samples.Add(new WizardCalSample { Model = "dppt/nds/seed-to-time-v0", Target = 18641, Hit = 18700, Before = new WizardCalValue { CalibratedDelay = 503, CalibratedSecond = 14 }, After = new WizardCalValue { CalibratedDelay = 560, CalibratedSecond = 14 }, When = "p", Mode = PRACTICE });
            e.Samples.Add(new WizardCalSample { Model = "other/model", Target = 1, Hit = 1, Before = new WizardCalValue { CalibratedDelay = 0, CalibratedSecond = 0 }, After = new WizardCalValue { CalibratedDelay = 999, CalibratedSecond = 0 }, When = "m", Mode = RUN });
            e.Samples.Add(new WizardCalSample { Model = "dppt/nds/seed-to-time-v0", Target = 2, Hit = 2, Before = new WizardCalValue { CalibratedDelay = 0, CalibratedSecond = 0 }, After = new WizardCalValue { CalibratedDelay = 777, CalibratedSecond = 0 }, When = "u", Mode = "hunt" });
            e.Samples.Add(new WizardCalSample { Model = "dppt/nds/seed-to-time-v0", Target = 3, Hit = 3, Before = new WizardCalValue { CalibratedDelay = 0, CalibratedSecond = 0 }, After = new WizardCalValue { CalibratedDelay = 888, CalibratedSecond = 0 }, When = "n" });
            CheckStore("store: the planted store", store, st.GetProperty("store"));
            CheckInForce("store: RUN leaves the practice, unknown-mode and other-model samples out", Wizard.InForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0"), st.GetProperty("run"), RUN, "dppt/nds/seed-to-time-v0");
            CheckInForce("store: PRACTICE / HUNT has its own", Wizard.InForce(store, "platinum", "NDS_SLOT1", PRACTICE, "dppt/nds/seed-to-time-v0"), st.GetProperty("practice"), PRACTICE, "dppt/nds/seed-to-time-v0");
            CheckInForce("store: another model's sample", Wizard.InForce(store, "platinum", "NDS_SLOT1", RUN, "other/model"), st.GetProperty("other"), RUN, "other/model");
            CheckInForce("store: the Gen 3 default", Wizard.InForce(store, "ruby", "GBA", RUN, "rs/gba/boot-seed-v0"), st.GetProperty("gen3Default"), RUN, "rs/gba/boot-seed-v0");
            var keys = st.GetProperty("storeKeys");
            Check("store: separate keys per mode", Modes.StoreKey(Wizard.StoreKey, RUN) == S(keys, "run") && Modes.StoreKey(Wizard.StoreKey, PRACTICE) == S(keys, "practice") && Modes.StoreKey(Wizard.CalKeySetting, RUN) != Modes.StoreKey(Wizard.CalKeySetting, PRACTICE), "");
            // the JSON round trip of a store: what the settings file holds reads back as the same samples
            var back = StoreOf(JsonDocument.Parse(JsonSerializer.Serialize(store)).RootElement);
            Check("store: the settings round trip keeps every sample", JsonSerializer.Serialize(back) == JsonSerializer.Serialize(store), "");
            var (removed, kept) = Wizard.ClearSamples(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0");
            Check("store: clear removes this mode's and model's samples only", removed == 2 && kept == 3 && store["platinum/NDS_SLOT1"].Samples.All(s => !(Modes.Effective(s.Mode) == RUN && s.Model == "dppt/nds/seed-to-time-v0")), $"{removed} {kept}");
        }

        // ---- the 20 random wanted-IV searches ----
        var random = V.GetProperty("random").EnumerateArray().ToList();
        Check("20 random searches", random.Count == 20, random.Count.ToString());
        int withHits = 0;
        foreach (var c in random)
        {
            var input = c.GetProperty("input");
            string label = "random " + I(c, "n") + " (" + S(input, "game") + " " + S(input, "kind") + ")";
            if (Wizard.Game(S(input, "game")).Gen == 3) { var r = CheckGen3Case(label, c, out _); if (r.Hits.Count > 0) withHits++; }
            else { var r = CheckGen4Case(label, c, out _); if (r.Rows.Count > 0) withHits++; }
        }
        Check("random searches with hits or rows", withHits >= 8, withHits.ToString());

        Console.WriteLine($"wizard panel checks: {checks} checks, {failures} failure{(failures == 1 ? "" : "s")} ({random.Count} random searches, {withHits} with hits or rows)");
        return failures == 0 ? 0 : 1;
    }
}
