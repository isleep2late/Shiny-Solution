// C# side of the generator checks: the PokeFinder oracle vectors (tests/generators-vectors.json), the
// rarity/reachability invariants, and the emission of the JS<->C# cross-check file (300 random cases).
using System.Text.Json;
using ShinySolution.Core;

public static class GeneratorTests
{
    static int failures, checks;

    static void Check<T>(string label, T actual, T expected)
    {
        checks++;
        var a = JsonSerializer.Serialize(actual);
        var e = JsonSerializer.Serialize(expected);
        if (a != e) { failures++; Console.Error.WriteLine($"FAIL {label}\n  expected {e}\n  actual   {a}"); }
    }

    static int I(JsonElement e, string k, int d = 0) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : d;
    static uint U(JsonElement e, string k) => e.GetProperty(k).GetUInt32();
    static bool B(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
    static string? S(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static int[] Ints(JsonElement e) => e.EnumerateArray().Select(x => x.GetInt32()).ToArray();

    public static SpeciesInfo Species(JsonElement e)
    {
        var bs = e.GetProperty("base_stats");
        return new SpeciesInfo(I(e, "dex"), I(e, "gender_ratio"), Ints(e.GetProperty("ability_ids")), Ints(e.GetProperty("type_ids")),
            new[] { I(bs, "hp"), I(bs, "atk"), I(bs, "def"), I(bs, "spe"), I(bs, "spa"), I(bs, "spd") });
    }
    static SpeciesInfo? SpeciesOrNull(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Object ? Species(v) : null;
    static List<EncounterSlot> Slots(JsonElement e) => e.EnumerateArray().Select(s => new EncounterSlot(Species(s.GetProperty("species")), I(s, "minLevel"), I(s, "maxLevel"), I(s, "form"))).ToList();
    static Lead LeadOf(JsonElement e)
    {
        if (!e.TryGetProperty("lead", out var l) || l.ValueKind != JsonValueKind.Object) return Lead.None;
        return new Lead(S(l, "ability"), I(l, "nature"), (S(l, "gender") ?? "M")[0], I(l, "level"));
    }
    static Gen3WildOptions Opt3(JsonElement e)
    {
        var o = new Gen3WildOptions();
        if (!e.TryGetProperty("options", out var v) || v.ValueKind != JsonValueKind.Object) return o;
        o.FeebasTile = B(v, "feebasTile"); o.Safari = B(v, "safari"); o.Tanoby = B(v, "tanoby"); o.Bike = B(v, "bike"); o.Item = S(v, "item");
        return o;
    }
    static Gen4WildOptions Opt4(JsonElement e)
    {
        var o = new Gen4WildOptions();
        if (!e.TryGetProperty("options", out var v) || v.ValueKind != JsonValueKind.Object) return o;
        o.FeebasTile = B(v, "feebasTile"); o.Safari = B(v, "safari"); o.GreatMarsh = B(v, "greatMarsh"); o.RadarShiny = B(v, "radarShiny");
        o.RadarKeepChain = !v.TryGetProperty("radarKeepChain", out var kc) || kc.ValueKind != JsonValueKind.False;
        o.Sinjoh = B(v, "sinjoh"); o.UnownRadio = B(v, "unownRadio"); o.Index = I(v, "index"); o.FishingBoost = I(v, "fishingBoost");
        o.UnownTable = I(v, "unownTable", 1);
        if (v.TryGetProperty("unownPuzzles", out var up) && up.ValueKind == JsonValueKind.Array) o.UnownPuzzles = up.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.True).ToArray();
        return o;
    }
    static EggParents Parents(JsonElement e)
    {
        var p = new EggParents();
        var iv = e.GetProperty("parentIvs");
        p.Ivs = new[] { Ints(iv[0]), Ints(iv[1]) };
        if (e.TryGetProperty("parentGenders", out var g)) p.Genders = Ints(g);
        if (e.TryGetProperty("parentItems", out var it)) p.Items = Ints(it);
        if (e.TryGetProperty("parentNatures", out var n)) p.Natures = Ints(n);
        return p;
    }

    static object Pick(GenResult r, JsonElement expected)
    {
        var d = new Dictionary<string, object?>();
        foreach (var prop in expected.EnumerateObject())
        {
            d[prop.Name] = prop.Name switch
            {
                "pid" => r.Pid, "ivs" => r.Ivs, "stats" => r.Stats, "ability" => r.AbilityBit, "abilityIndex" => r.AbilityId, "gender" => r.Gender,
                "hiddenPower" => r.HiddenPower, "hiddenPowerStrength" => r.HiddenPowerPower, "level" => r.Level, "nature" => r.Nature,
                "shiny" => r.ShinyType, "advances" => r.Advances >= 0 ? r.Advances : r.Frame, "specie" => r.Species, "encounterSlot" => r.EncounterSlot,
                "form" => r.Form, "valid" => r.Valid, "battleAdvances" => r.BattleAdvances, "call" => r.Call, "chatot" => r.Chatot,
                "inheritance" => r.Inheritance, "pickupAdvances" => r.PickupAdvances, "redraws" => r.Redraws, _ => "?"
            };
        }
        return d;
    }
    static object Exp(JsonElement expected)
    {
        var d = new Dictionary<string, object?>();
        foreach (var prop in expected.EnumerateObject())
        {
            d[prop.Name] = prop.Value.ValueKind switch
            {
                JsonValueKind.Number => prop.Value.TryGetInt64(out var l) ? (l >= 0 && l <= uint.MaxValue && (prop.Name == "pid") ? (object)(uint)l : l) : prop.Value.GetDouble(),
                JsonValueKind.Array => Ints(prop.Value), JsonValueKind.True => true, JsonValueKind.False => false, _ => null
            };
        }
        return d;
    }
    static void CompareResults(string label, List<GenResult> ours, JsonElement expected)
    {
        var exp = expected.EnumerateArray().ToList();
        Check($"{label} count", ours.Count, exp.Count);
        for (int i = 0; i < Math.Min(ours.Count, exp.Count); i++)
            Check($"{label} [{i}]", JsonSerializer.Serialize(Pick(ours[i], exp[i])), JsonSerializer.Serialize(Exp(exp[i])));
    }

    public static int Run(string vectorsPath, string? crossOut)
    {
        var V = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;
        uint tid = U(V.GetProperty("meta"), "tid"), sid = U(V.GetProperty("meta"), "sid");
        int N = I(V.GetProperty("meta"), "frameCount");
        int cases = 0;

        foreach (var c in V.GetProperty("static3").EnumerateArray())
        {
            cases++;
            var r = Generators.Gen3Static(U(c, "seed"), Species(c.GetProperty("species")), I(c, "level"), S(c, "method")!, B(c, "buggedRoamer"), 0, N, tid, sid);
            CompareResults("static3 " + S(c, "name"), r, c.GetProperty("results"));
        }
        foreach (var c in V.GetProperty("wild3").EnumerateArray())
        {
            cases++;
            var r = Generators.Gen3Wild(U(c, "seed"), S(c, "game")!, S(c, "encounter")!, Slots(c.GetProperty("slots")), I(c, "rate"), LeadOf(c), Opt3(c), S(c, "method")!, 0, N, tid, sid)
                .Where(x => x.Valid).ToList();
            CompareResults("wild3 " + S(c, "name"), r, c.GetProperty("results"));
        }
        foreach (var c in V.GetProperty("egg3").EnumerateArray())
        {
            cases++;
            var sp = Species(c.GetProperty("species")); var male = SpeciesOrNull(c, "speciesMale"); var par = Parents(c);
            var r = B(c, "emerald")
                ? Generators.Gen3EggEmerald(U(c, "seed"), S(c, "method")!, I(c, "calibration"), I(c, "minRedraw"), I(c, "maxRedraw"), I(c, "compatibility"), sp, male, par, 0, N, 0, N, tid, sid)
                : Generators.Gen3EggRSFRLG(U(c, "seed"), U(c, "seedPickup"), S(c, "method")!, I(c, "compatibility"), sp, male, par, 0, N, 0, N, tid, sid);
            CompareResults("egg3 " + S(c, "name"), r, c.GetProperty("results"));
        }
        foreach (var c in V.GetProperty("static4").EnumerateArray())
        {
            cases++;
            var r = Generators.Gen4Static(U(c, "seed"), Species(c.GetProperty("species")), I(c, "level"), S(c, "method")!, S(c, "shiny") ?? "random", LeadOf(c), 0, N, tid, sid);
            CompareResults("static4 " + S(c, "method") + " " + S(c, "name"), r, c.GetProperty("results"));
        }
        foreach (var c in V.GetProperty("wild4").EnumerateArray())
        {
            cases++;
            var r = Generators.Gen4Wild(U(c, "seed"), S(c, "game")!, S(c, "method")!, S(c, "encounter")!, Slots(c.GetProperty("slots")), I(c, "rate"), LeadOf(c), Opt4(c), 0, N, tid, sid);
            CompareResults("wild4 " + S(c, "category") + " " + S(c, "name"), r, c.GetProperty("results"));
        }
        foreach (var c in V.GetProperty("egg4").EnumerateArray())
        {
            cases++;
            var sp = Species(c.GetProperty("species")); var male = SpeciesOrNull(c, "speciesMale"); var par = Parents(c);
            var held = Generators.Gen4EggHeld(U(c, "seed"), sp, male, 0, N, null, B(c, "masuda"), tid, sid);
            var r = Generators.Gen4EggPickup(U(c, "seedPickup"), held, S(c, "game")!, par, 0, N, tid, sid);
            CompareResults("egg4 " + S(c, "name"), r, c.GetProperty("results"));
        }

        // rarity and reachability invariants (the same numbers the JS suite pins)
        Check("flawless Method 1 states", Generators.FlawlessTable("M1").Count, 6);
        Check("flawless Method 4 states", Generators.FlawlessTable("M4").Count, 4);
        Check("countIvStates flawless M1", Generators.CountIvStates(new GenFilter { MinIv = 31 }, "M1").Count, 6L);
        Check("countIvStates all >= 30", Generators.CountIvStates(new GenFilter { MinIv = 30 }, "M1").Count, 260L);
        Check("exactly five 31s", Generators.FiveThirtyOneStates("M1").Count, 738);
        var fl = Generators.FlawlessTable("M1");
        Check("first flawless frame from Emerald seed 0", fl.Select(s => Generators.FrameForIvState(0, s.IvState)).Min(), 176562488L);
        Check("first flawless frame from RS seed 0x5A0", fl.Select(s => Generators.FrameForIvState(0x5A0, s.IvState)).Min(), 353872079L);
        Check("lcrngDistance inverts jump", Generators.LcrngDistance(0x5A0, Lcrng.Jump(0x5A0, 123456789)), 123456789L);
        Check("prev inverts next", Generators.Prev(Lcrng.Next(0xDEADBEEF)), 0xDEADBEEFu);
        {
            bool ok = true; uint x = 0x1234ABCD;
            var elec = new SpeciesInfo(81, 255, new[] { 42, 0 }, new[] { 13, 8 }, new[] { 50, 50, 50, 50, 50, 50 });
            for (int i = 0; i < 300; i++)
            {
                x = Lcrng.Next(x); uint seed = Lcrng.Next(x) ^ (x >> 3);
                var mon = Generators.Gen3Static(seed, elec, 5, "M1", false, 0, 1)[0];
                if (!Generators.SeedsForIvs(mon.Ivs).Contains(Lcrng.Jump(seed, 2))) ok = false;
            }
            Check("seedsForIvs recovers the PID-high state (300 seeds)", ok, true);
            uint ivState = 0x7FFF305A;
            var ivs = Generators.IvsFromWords((int)(ivState >> 16), (int)(Lcrng.Next(ivState) >> 16));
            var hits = Generators.Gen4SeedsForTarget(ivs, 0);
            Check("gen4SeedsForTarget finds 7B0448D1 at frame 0", hits.Any(h => h.Seed == 0x7B0448D1 && h.Frame == 0 && h.Hour == 4 && h.DelayPlusYear == 18641), true);
        }

        if (crossOut != null) EmitCross(V, crossOut, tid, sid);

        if (failures > 0)
        {
            Console.Error.WriteLine($"{failures} of {checks} C# generator checks failed");
            return 1;
        }
        Console.WriteLine($"C# generator checks OK ({checks} assertions, {cases} PokeFinder vector cases)");
        return 0;
    }

    // 300 random (seed, frame, method) cases over the vector inputs; JS recomputes them bit for bit.
    static void EmitCross(JsonElement V, string path, uint tid, uint sid)
    {
        uint x = 0xC0FFEE01;
        uint Rand() { x = x * 1664525u + 1013904223u; return x; }
        string[] kinds = { "static3", "wild3", "static4", "wild4", "egg4", "egg3e", "egg3rs" };
        string[] methods3 = { "M1", "M2", "M4" };
        var list = new List<object>();
        var egg3e = V.GetProperty("egg3").EnumerateArray().Where(c => B(c, "emerald")).ToList();
        var egg3rs = V.GetProperty("egg3").EnumerateArray().Where(c => !B(c, "emerald")).ToList();
        for (int i = 0; i < 300; i++)
        {
            string kind = kinds[i % kinds.Length];
            uint seed = Rand(), seed2 = Rand();
            long frameStart = Rand() % 3000;
            int frameCount = 5;
            List<GenResult> r;
            object inputs;
            switch (kind)
            {
                case "static3":
                {
                    var all = V.GetProperty("static3").EnumerateArray().ToList(); var c = all[(int)(Rand() % all.Count)];
                    string m = methods3[Rand() % 3];
                    r = Generators.Gen3Static(seed, Species(c.GetProperty("species")), I(c, "level"), m, B(c, "buggedRoamer"), frameStart, frameCount, tid, sid);
                    inputs = new { method = m, species = c.GetProperty("species"), level = I(c, "level"), buggedRoamer = B(c, "buggedRoamer") };
                    break;
                }
                case "wild3":
                {
                    var all = V.GetProperty("wild3").EnumerateArray().ToList(); var c = all[(int)(Rand() % all.Count)];
                    string m = methods3[Rand() % 3];
                    r = Generators.Gen3Wild(seed, S(c, "game")!, S(c, "encounter")!, Slots(c.GetProperty("slots")), I(c, "rate"), LeadOf(c), Opt3(c), m, frameStart, frameCount, tid, sid);
                    inputs = new { game = S(c, "game"), method = m, encounter = S(c, "encounter"), slots = c.GetProperty("slots"), rate = I(c, "rate"), lead = c.TryGetProperty("lead", out var l) ? l : default, options = c.GetProperty("options") };
                    break;
                }
                case "static4":
                {
                    var all = V.GetProperty("static4").EnumerateArray().ToList(); var c = all[(int)(Rand() % all.Count)];
                    r = Generators.Gen4Static(seed, Species(c.GetProperty("species")), I(c, "level"), S(c, "method")!, S(c, "shiny") ?? "random", LeadOf(c), frameStart, frameCount, tid, sid);
                    inputs = new { method = S(c, "method"), species = c.GetProperty("species"), level = I(c, "level"), shiny = S(c, "shiny"), lead = c.TryGetProperty("lead", out var l) ? l : default };
                    break;
                }
                case "wild4":
                {
                    var all = V.GetProperty("wild4").EnumerateArray().ToList(); var c = all[(int)(Rand() % all.Count)];
                    r = Generators.Gen4Wild(seed, S(c, "game")!, S(c, "method")!, S(c, "encounter")!, Slots(c.GetProperty("slots")), I(c, "rate"), LeadOf(c), Opt4(c), frameStart, frameCount, tid, sid);
                    inputs = new { game = S(c, "game"), method = S(c, "method"), encounter = S(c, "encounter"), slots = c.GetProperty("slots"), rate = I(c, "rate"), lead = c.TryGetProperty("lead", out var l) ? l : default, options = c.GetProperty("options") };
                    break;
                }
                case "egg4":
                {
                    var all = V.GetProperty("egg4").EnumerateArray().ToList(); var c = all[(int)(Rand() % all.Count)];
                    int? ever = (Rand() % 2) == 0 ? null : (int)(Rand() % 25);
                    var held = Generators.Gen4EggHeld(seed, Species(c.GetProperty("species")), null, frameStart, frameCount, ever, B(c, "masuda"), tid, sid);
                    r = Generators.Gen4EggPickup(seed2, held, S(c, "game")!, Parents(c), 0, frameCount, tid, sid);
                    inputs = new { seedPickup = seed2, game = S(c, "game"), species = c.GetProperty("species"), parentIvs = c.GetProperty("parentIvs"), masuda = B(c, "masuda"), everstoneNature = ever };
                    break;
                }
                case "egg3e":
                {
                    var c = egg3e[(int)(Rand() % egg3e.Count)];
                    r = Generators.Gen3EggEmerald(seed, S(c, "method")!, I(c, "calibration"), 0, 0, I(c, "compatibility"), Species(c.GetProperty("species")), null, Parents(c), frameStart, frameCount, 0, frameCount, tid, sid);
                    inputs = new { method = S(c, "method"), calibration = I(c, "calibration"), compatibility = I(c, "compatibility"), species = c.GetProperty("species"), parentIvs = c.GetProperty("parentIvs"), parentGenders = c.GetProperty("parentGenders"), parentItems = c.GetProperty("parentItems"), parentNatures = c.GetProperty("parentNatures") };
                    break;
                }
                default:
                {
                    var c = egg3rs[(int)(Rand() % egg3rs.Count)];
                    r = Generators.Gen3EggRSFRLG(seed, seed2, S(c, "method")!, I(c, "compatibility"), Species(c.GetProperty("species")), null, Parents(c), frameStart, frameCount, 0, frameCount, tid, sid);
                    inputs = new { seedPickup = seed2, method = S(c, "method"), compatibility = I(c, "compatibility"), species = c.GetProperty("species"), parentIvs = c.GetProperty("parentIvs"), parentGenders = c.GetProperty("parentGenders"), parentItems = c.GetProperty("parentItems"), parentNatures = c.GetProperty("parentNatures") };
                    break;
                }
            }
            var results = r.Select(x2 => x2.Valid
                ? (object)new { frame = x2.Frame, pid = x2.Pid, ivs = x2.Ivs, level = x2.Level, slot = x2.EncounterSlot, form = x2.Form, adv = x2.Advances, pick = x2.PickupAdvances, inh = x2.Inheritance, valid = true }
                : new { frame = x2.Frame, valid = false }).ToList();
            var caseObj = new Dictionary<string, object?> { ["kind"] = kind, ["seed"] = seed, ["frameStart"] = frameStart, ["frameCount"] = frameCount, ["tid"] = tid, ["sid"] = sid, ["results"] = results };
            foreach (var p in inputs.GetType().GetProperties()) caseObj[p.Name] = p.GetValue(inputs);
            list.Add(caseObj);
        }
        File.WriteAllText(path, JsonSerializer.Serialize(new { cases = list }));
        Console.WriteLine($"cross-check file written: {path} ({list.Count} cases)");
    }
}
