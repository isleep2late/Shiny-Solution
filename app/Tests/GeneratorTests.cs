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
        // per-method flawless natures / TID^SID blocks (the "nine natures / eight blocks" is the M1+M2+M4 union)
        string[] NatureNames = { "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax", "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash", "Calm", "Gentle", "Sassy", "Careful", "Quirky" };
        string[] Natures(string m) => Generators.FlawlessTable(m).Select(t => NatureNames[t.Nature]).Distinct().OrderBy(n => n, StringComparer.Ordinal).ToArray();
        string[] Blocks(string m) => Generators.FlawlessTable(m).Select(t => (t.Psv & 0xFFF8).ToString("X4")).Distinct().OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Check("flawless Method 1 natures", Natures("M1"), new[] { "Calm", "Docile", "Modest", "Timid" });
        Check("flawless Method 1 TID^SID blocks", Blocks("M1"), new[] { "79F8", "9630", "B378" });
        Check("flawless Method 2 natures", Natures("M2"), new[] { "Careful", "Hardy", "Lax", "Naive", "Rash" });
        Check("flawless Method 4 natures", Natures("M4"), new[] { "Careful", "Modest", "Naive", "Timid" });
        Check("flawless Method 4 TID^SID blocks", Blocks("M4"), new[] { "25C8", "9400" });
        {
            // D3 extension: the Bug Contest path (encounter_check.c:976-986) never calls DoesAbilitySuppressEncounter
            var bugCase = V.GetProperty("wild4").EnumerateArray().First(c => S(c, "encounter") == "bug_contest");
            var bslots = Slots(bugCase.GetProperty("slots"));
            var noLead = Generators.Gen4Wild(0x1234, "heartgold", "K", "bug_contest", bslots, 0, null, null, 0, 40, tid, sid);
            var keenEye = Generators.Gen4Wild(0x1234, "heartgold", "K", "bug_contest", bslots, 0, new Lead("KEEN_EYE", 0, 'M', 40), null, 0, 40, tid, sid);
            Check("pin D3: bug contest Keen Eye lead adds no suppress roll", keenEye.Select(r => (r.Valid, r.Pid, r.Level, r.CallsUsed)).ToList(), noLead.Select(r => (r.Valid, r.Pid, r.Level, r.CallsUsed)).ToList());
            // Safari/Bug Contest 4x retry: tries in 1..4, found iff the final IVs hold a 31, and some frame misses all four
            Check("bug contest perfectIvTries within 1..4", noLead.All(r => r.PerfectIvTries >= 1 && r.PerfectIvTries <= 4), true);
            Check("bug contest perfectIvFound iff an IV is 31", noLead.Select(r => r.PerfectIvFound).ToList(), noLead.Select(r => r.Ivs.Contains(31)).ToList());
            Check("bug contest some frame misses all four tries", noLead.Any(r => r.PerfectIvTries == 4 && !r.PerfectIvFound), true);
        }
        {
            // D6 extension: the Everstone check is an LCRNG roll at trigger (daycare.c:336-341, get_egg.c:241,247);
            // everstoneProc = false is the failed branch (plain MT PIDs)
            var elec = Species(V.GetProperty("wild4").EnumerateArray().First().GetProperty("slots")[0].GetProperty("species"));
            var plain = Generators.Gen4EggHeld(0, elec, null, 0, 5, null, false, tid, sid);
            var inherit = Generators.Gen4EggHeld(0, elec, null, 0, 5, 7, false, tid, sid);
            var failed = Generators.Gen4EggHeld(0, elec, null, 0, 5, 7, false, tid, sid, everstoneProc: false);
            Check("pin D6: everstone egg PIDs carry the nature", inherit.Select(h => (int)(h.Pid % 25)).ToList(), new List<int> { 7, 7, 7, 7, 7 });
            Check("pin D6: failed Everstone roll gives the plain MT PIDs", failed.Select(h => h.Pid).ToList(), plain.Select(h => h.Pid).ToList());
            Check("pin D6: everstoneInherited flags", (inherit.All(h => h.EverstoneInherited), failed.Any(h => h.EverstoneInherited)), (true, false));
            Check("pin D6: inherit chance is 32767/65536", Generators.Gen4EverstoneInheritChance, 32767.0 / 65536.0);
            var parents = new EggParents { Ivs = new[] { new[] { 31, 31, 31, 31, 31, 31 }, new int[6] } };
            var pick = Generators.Gen4EggPickup(0, inherit.Take(2).ToList(), "platinum", parents, 0, 1, tid, sid);
            Check("pin D6: pickup results carry everstoneInherited", pick.Select(r => (r.EverstoneInherited, r.Nature)).ToList(), new List<(bool, int)> { (true, 7), (true, 7) });
        }
        {
            // D7: the Feebas roll is spent on every cast on the Feebas map (pokeemerald wild_encounter.c:121-122,137;
            // pokeplatinum feebas_fishing.c:37 via wild_encounters.c:407); FeebasMap spends it, only FeebasTile can hit
            var f3 = V.GetProperty("wild3").EnumerateArray().First(c => S(c, "name") == "Emerald Route 119 Feebas");
            var s3 = Slots(f3.GetProperty("slots"));
            var off = Generators.Gen3Wild(U(f3, "seed"), "emerald", S(f3, "encounter")!, s3, I(f3, "rate"), null, new Gen3WildOptions(), "M1", 0, 40, tid, sid);
            var map = Generators.Gen3Wild(U(f3, "seed"), "emerald", S(f3, "encounter")!, s3, I(f3, "rate"), null, new Gen3WildOptions { FeebasMap = true }, "M1", 0, 40, tid, sid);
            var tile = Generators.Gen3Wild(U(f3, "seed"), "emerald", S(f3, "encounter")!, s3, I(f3, "rate"), null, new Gen3WildOptions { FeebasTile = true }, "M1", 0, 40, tid, sid);
            // nothing precedes the Feebas roll in the Gen 3 script: frame f with FeebasMap is plain frame f+1, one call longer
            static (uint, int[], int, int, int) Proj(GenResult r) => (r.Pid, r.Ivs, r.Level, r.EncounterSlot, r.CallsUsed);
            Check("pin D7: Emerald feebasMap frame f is plain frame f+1 plus one call", map.Take(39).Select(Proj).ToList(), off.Skip(1).Select(r => (r.Pid, r.Ivs, r.Level, r.EncounterSlot, r.CallsUsed + 1)).ToList());
            Check("pin D7: Emerald feebasMap never yields Feebas", map.All(r => !r.Feebas && r.EncounterSlot < 2), true);
            Check("pin D7: Emerald feebasMap differs from the no-roll run", map.Where((r, i) => r.Pid != off[i].Pid).Any(), true);
            Check("pin D7: Emerald feebasTile hits iff Random()%100 <= 49", tile.Select(r => r.Feebas).ToList(), tile.Select(r => (int)((Lcrng.Jump(U(f3, "seed"), (ulong)r.Frame + 1) >> 16) % 100) <= 49).ToList());
            Check("pin D7: Emerald feebasTile hits on some frames", tile.Any(r => r.Feebas), true);
            Check("pin D7: Emerald off-tile results equal the tile's non-Feebas frames", map.Where((r, i) => !tile[i].Feebas).Select(Proj).ToList(), tile.Where(r => !r.Feebas).Select(Proj).ToList());
            var f4 = V.GetProperty("wild4").EnumerateArray().First(c => S(c, "name") == "Mt Coronet Feebas");
            var s4 = Slots(f4.GetProperty("slots"));
            var off4 = Generators.Gen4Wild(U(f4, "seed"), "platinum", "J", S(f4, "encounter")!, s4, I(f4, "rate"), null, new Gen4WildOptions(), 0, 40, tid, sid);
            var map4 = Generators.Gen4Wild(U(f4, "seed"), "platinum", "J", S(f4, "encounter")!, s4, I(f4, "rate"), null, new Gen4WildOptions { FeebasMap = true }, 0, 40, tid, sid);
            var tile4 = Generators.Gen4Wild(U(f4, "seed"), "platinum", "J", S(f4, "encounter")!, s4, I(f4, "rate"), null, new Gen4WildOptions { FeebasTile = true }, 0, 40, tid, sid);
            // J script: call f+1 nibble, then (FeebasMap) call f+2 RandMod(2) and call f+3 slot RandMod(100); without it the slot is call f+2
            static int Div(uint s, int n) => (int)((s >> 16) / (uint)(0xFFFF / n + 1));
            uint cs = U(f4, "seed");
            Check("pin D7: DPPt plain slot is RandMod(100) at call f+2", off4.Select(r => r.EncounterSlot).ToList(), off4.Select(r => Generators.JSlot(Div(Lcrng.Jump(cs, (ulong)r.Frame + 2), 100), "super_rod")).ToList());
            Check("pin D7: DPPt feebasMap slot is RandMod(100) at call f+3", map4.Select(r => r.EncounterSlot).ToList(), map4.Select(r => Generators.JSlot(Div(Lcrng.Jump(cs, (ulong)r.Frame + 3), 100), "super_rod")).ToList());
            Check("pin D7: DPPt feebasMap never yields Feebas", map4.All(r => !r.Feebas && r.EncounterSlot < 5), true);
            Check("pin D7: DPPt feebasTile hits iff RandMod(2) at call f+2 is nonzero", tile4.Select(r => r.Feebas).ToList(), tile4.Select(r => Div(Lcrng.Jump(cs, (ulong)r.Frame + 2), 2) != 0).ToList());
            Check("pin D7: DPPt feebasTile hits on some frames", tile4.Any(r => r.Feebas), true);
            Check("pin D7: DPPt off-tile results equal the tile's non-Feebas frames", map4.Where((r, i) => !tile4[i].Feebas).Select(Proj).ToList(), tile4.Where(r => !r.Feebas).Select(Proj).ToList());
            string msg3 = "", msg4 = "";
            try { Generators.Gen3Wild(0, "emerald", "old_rod", s3.Take(2).ToList(), 30, null, new Gen3WildOptions { FeebasTile = true }); } catch (ArgumentException e) { msg3 = e.Message; }
            try { Generators.Gen4Wild(0, "platinum", "J", "super_rod", s4.Take(5).ToList(), 25, null, new Gen4WildOptions { FeebasTile = true }); } catch (ArgumentException e) { msg4 = e.Message; }
            Check("feebasTile precondition names the Feebas slot (gen3)", msg3.Contains("feebasTile requires the Feebas slot (species 349) at index 2"), true);
            Check("feebasTile precondition names the Feebas slot (gen4)", msg4.Contains("feebasTile requires the Feebas slot (species 349) at index 5"), true);
        }
        {
            // Emerald egg redraw ranges tie on (Advances, PickupAdvances); the order is (Advances, PickupAdvances, Redraws)
            var e3 = V.GetProperty("egg3").EnumerateArray().First(c => B(c, "emerald"));
            var r3 = Generators.Gen3EggEmerald(0, S(e3, "method")!, 18, 0, 2, 70, Species(e3.GetProperty("species")), null, Parents(e3), 0, 10, 0, 5, tid, sid);
            var keys = r3.Select(x => (x.Advances, x.PickupAdvances, x.Redraws)).ToList();
            Check("egg3 redraw range produces (advances, pickupAdvances) ties", keys.GroupBy(k => (k.Advances, k.PickupAdvances)).Any(g => g.Count() > 1), true);
            Check("egg3 results ordered by (advances, pickupAdvances, redraws)", keys.Zip(keys.Skip(1)).All(p => p.First.CompareTo(p.Second) < 0), true);
        }
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
        {
            // Generators delegates the reversal to SeedTime4: on 200 random IV sets (100 from Method 1 mons, 100 from
            // Method 4 mons) plus four edge sets, SeedsForIvWords / SeedsForIvs equal SeedTime4.IvsToSeeds and
            // Gen4SeedsForTarget equals SeedTime4.ReachableSeeds (maxFrame 0, 5, 100; call counts 2 and 3) field for
            // field; every origin is also checked against the IV words it must reproduce, independently of both.
            var sets = new List<(int[] Ivs, uint Seed, string? Method)>();
            uint x = 0x9E3779B9;
            for (int i = 0; i < 200; i++)
            {
                x = Lcrng.Next(x); uint seed = Lcrng.Next(x) ^ (x >> 7);
                string method = i % 2 == 1 ? "M4" : "M1";
                var m = SeedTime4.MonFromFrameSeed(seed, method).Ivs;
                sets.Add((new[] { m.Hp, m.Atk, m.Def, m.Spa, m.Spd, m.Spe }, seed, method));
            }
            foreach (var v in new[] { new[] { 0, 0, 0, 0, 0, 0 }, new[] { 31, 31, 31, 31, 31, 31 }, new[] { 31, 0, 31, 0, 31, 0 }, new[] { 16, 16, 16, 16, 16, 16 } }) sets.Add((v, 0, null));
            int agree = 0, disagree = 0, recovered = 0; long hitsCompared = 0; bool wordsOk = true;
            foreach (var (ivs, seed, method) in sets)
            {
                int w1 = ivs[0] | (ivs[1] << 5) | (ivs[2] << 10), w2 = ivs[5] | (ivs[3] << 5) | (ivs[4] << 10);
                var direct = SeedTime4.IvsToSeeds(ivs[0], ivs[1], ivs[2], ivs[3], ivs[4], ivs[5]);
                var viaWords = Generators.SeedsForIvWords(w1, w2);
                var viaIvs = Generators.SeedsForIvs(ivs);
                bool same = viaWords.SequenceEqual(direct) && viaIvs.SequenceEqual(direct);
                foreach (var r in viaIvs)
                    if ((int)(Lcrng.Next(r) >> 16 & 0x7FFF) != w1 || (int)(Lcrng.Jump(r, 2) >> 16 & 0x7FFF) != w2) wordsOk = false;
                if (method != null)
                {
                    uint origin = Lcrng.Jump(seed, 2);
                    var list = method == "M4" ? SeedTime4.IvsToSeedsSkip(ivs[0], ivs[1], ivs[2], ivs[3], ivs[4], ivs[5]) : viaIvs;
                    if (list.Contains(origin)) recovered++;
                }
                foreach (int maxFrame in new[] { 0, 5, 100 })
                    foreach (int callsBeforeIv1 in new[] { 2, 3 })
                    {
                        var wrapper = Generators.Gen4SeedsForTarget(ivs, maxFrame, callsBeforeIv1);
                        var reference = SeedTime4.ReachableSeeds(direct, callsBeforeIv1, maxFrame).Select(h => (h.Seed, (long)h.Frame, h.Hour, h.Ab, h.Efgh, h.Origin)).ToList();
                        hitsCompared += reference.Count;
                        if (!wrapper.SequenceEqual(reference)) same = false;
                        foreach (var h in wrapper)
                            if (Lcrng.Jump(h.Seed, (uint)(callsBeforeIv1 + h.Frame)) != h.IvOrigin || h.Hour != (int)((h.Seed >> 16) & 0xFF) || h.Hour > 23 || h.Ab != (int)(h.Seed >> 24) || h.DelayPlusYear != (int)(h.Seed & 0xFFFF)) wordsOk = false;
                    }
                if (same) agree++; else { disagree++; Console.Error.WriteLine($"reversal delegate disagrees on IVs {string.Join(",", ivs)}"); }
            }
            Check("Generators reversal equals SeedTime4 on 204 IV sets", (agree, disagree), (204, 0));
            Check("every delegated origin reproduces its IV words and every hit its origin", wordsOk, true);
            Check("Method 1 sets recover Jump(seed, 2) through the wrapper, Method 4 sets through IvsToSeedsSkip", recovered, 200);
            Check("reachability hits compared", hitsCompared > 10000, true);
            Console.WriteLine($"reversal delegate cross-check: 204 IV sets, {hitsCompared} reachability hits compared");
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
                    bool proc = ((Rand() >> 8) & 1) == 0; // not the low bit: this LCG's low bit alternates, which made proc always false
                    var held = Generators.Gen4EggHeld(seed, Species(c.GetProperty("species")), null, frameStart, frameCount, ever, B(c, "masuda"), tid, sid, proc);
                    r = Generators.Gen4EggPickup(seed2, held, S(c, "game")!, Parents(c), 0, frameCount, tid, sid);
                    inputs = new { seedPickup = seed2, game = S(c, "game"), species = c.GetProperty("species"), parentIvs = c.GetProperty("parentIvs"), masuda = B(c, "masuda"), everstoneNature = ever, everstoneProc = proc };
                    break;
                }
                case "egg3e":
                {
                    var c = egg3e[(int)(Rand() % egg3e.Count)];
                    int maxRedraw = (int)(Rand() % 3); // 0..2: redraw ranges create (advances, pickupAdvances) ties whose order is pinned
                    r = Generators.Gen3EggEmerald(seed, S(c, "method")!, I(c, "calibration"), 0, maxRedraw, I(c, "compatibility"), Species(c.GetProperty("species")), null, Parents(c), frameStart, frameCount, 0, frameCount, tid, sid);
                    inputs = new { method = S(c, "method"), calibration = I(c, "calibration"), maxRedraw, compatibility = I(c, "compatibility"), species = c.GetProperty("species"), parentIvs = c.GetProperty("parentIvs"), parentGenders = c.GetProperty("parentGenders"), parentItems = c.GetProperty("parentItems"), parentNatures = c.GetProperty("parentNatures") };
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
                ? (object)new { frame = x2.Frame, pid = x2.Pid, ivs = x2.Ivs, level = x2.Level, slot = x2.EncounterSlot, form = x2.Form, adv = x2.Advances, pick = x2.PickupAdvances, inh = x2.Inheritance,
                    tries = x2.PerfectIvTries, found = x2.PerfectIvFound, cc = x2.CuteCharm, item = x2.ItemRoll, redraws = x2.Redraws, ever = x2.EverstoneInherited, valid = true }
                : new { frame = x2.Frame, valid = false }).ToList();
            var caseObj = new Dictionary<string, object?> { ["kind"] = kind, ["seed"] = seed, ["frameStart"] = frameStart, ["frameCount"] = frameCount, ["tid"] = tid, ["sid"] = sid, ["results"] = results };
            foreach (var p in inputs.GetType().GetProperties()) caseObj[p.Name] = p.GetValue(inputs);
            list.Add(caseObj);
        }
        File.WriteAllText(path, JsonSerializer.Serialize(new { cases = list }));
        Console.WriteLine($"cross-check file written: {path} ({list.Count} cases)");
    }
}
