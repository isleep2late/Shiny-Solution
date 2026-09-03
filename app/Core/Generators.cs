// Gen 3 / Gen 4 encounter generators, derived values, filters, rarity and reachability.
// Mirrors core/generators.js call for call (see docs/FACTS.md, "Generators"). Frame N starts from
// Lcrng.Jump(seed, N): the first value consumed is the (N+1)-th output after the seed.
using System.Numerics;

namespace ShinySolution.Core;

public sealed record SpeciesInfo(int Dex, int GenderRatio, int[] AbilityIds, int[] TypeIds, int[] BaseStats /* hp atk def spe spa spd */);
public sealed record EncounterSlot(SpeciesInfo Species, int MinLevel, int MaxLevel, int Form = 0);
public sealed record Lead(string? Ability, int Nature = 0, char Gender = 'M', int Level = 0)
{
    public static readonly Lead None = new(Ability: null);
}

public sealed class GenFilter
{
    public int[]? Natures;
    public int? Gender;        // 0 male, 1 female
    public int? Ability;       // ability bit
    public bool? Shiny;
    public int[]? HpTypes;     // hidden power indices 0..15
    public int HpPowerMin;
    public int[]? IvMin;       // hp atk def spa spd spe
    public int[]? IvMax;
    public int MinIv;
    public int LevelMin, LevelMax;
    public int[]? Slots;
    public int[]? Species;
    public bool ValidOnly;
}

public sealed class GenResult
{
    public long Frame;
    public uint Pid;
    public int Nature;
    public int[] Ivs = new int[6];      // hp atk def spa spd spe (PokeFinder order)
    public int Level;
    public int Gender;
    public int AbilityBit, AbilitySlot, AbilityId;
    public bool Shiny;
    public int ShinyType;
    public int Psv, Tsv;
    public int HiddenPower, HiddenPowerTypeId, HiddenPowerPower;
    public int[] Stats = new int[6];
    public int Species;
    public bool Valid = true;
    public string? Reason;
    public int EncounterSlot = -1;
    public int Form;
    public bool Feebas, Outbreak, CuteCharm;
    public int CallsUsed;
    public long BattleAdvances = -1;
    public int Call = -1, Chatot = -1;
    public int ItemRoll = -1;
    public string? ItemClass;
    public int PerfectIvTries;
    public long Advances = -1;         // egg: held advances (u32 as in PokeFinder for Emerald)
    public long HeldFrame;
    public long PickupAdvances = -1;
    public int Redraws;
    public int[]? Inheritance;
    public bool EverstoneInherited;
}

public sealed class Gen3WildOptions
{
    public bool FeebasTile, Safari, Tanoby, Bike, NewMetatile, OddsRoll, Roamer;
    public string? Item;               // white_flute, black_flute, cleanse_tag
    public (SpeciesInfo Species, int Level, int Probability)? Outbreak;
}

public sealed class Gen4WildOptions
{
    public bool FeebasTile, Safari, GreatMarsh, RadarShiny, RadarKeepChain = true, Sinjoh, UnownRadio;
    public int Index;
    public int FishingBoost;
    public int UnownTable = 1;
    public bool[] UnownPuzzles = { true, true, true, true };
    public bool[]? UnownSeen;
}

public sealed class EggParents
{
    public int[][] Ivs = { new int[6], new int[6] }; // hp atk def spa spd spe per parent
    public int[] Genders = { 0, 1 };                // 0 M, 1 F, 2 none, 3 Ditto
    public int[] Items = { 0, 0 };                  // 1 = Everstone
    public int[] Natures = { 0, 0 };
}

public sealed record HeldEgg(long Advances, long HeldFrame, int Redraws, uint Pid, SpeciesInfo Species, bool EverstoneInherited);

public static class Generators
{
    const uint RMult = 0xEEB9EB65, RAdd = 0x0A3561A1, ArngMult = 0x6C078965;
    const int TypeSteel = 8, TypeElectric = 13;
    public static readonly string[] HiddenPowerTypes = { "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL", "FIRE", "WATER", "GRASS", "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK" };
    static readonly int[] StatIdToIvIndex = { 0, 1, 2, 5, 3, 4 }; // decomp stat id -> index in hp atk def spa spd spe

    public static uint Prev(uint s) => s * RMult + RAdd;
    public static uint ArngNext(uint s) => s * ArngMult + 1;

    public sealed class Stream
    {
        public uint S;
        public int Calls;
        public Stream(uint state) { S = state; }
        public int Next() { S = Lcrng.Next(S); Calls++; return (int)(S >> 16); }
        public int Mod(int n) => Next() % n;
        public int Div(int n) => Next() / ((0xFFFF / n) + 1);
        public void Skip(int k) { for (int i = 0; i < k; i++) Next(); }
        public Stream Clone() => new(S);
    }

    static readonly (uint Mult, uint Add)[] JumpTable = BuildJumpTable();
    static (uint, uint)[] BuildJumpTable()
    {
        var t = new (uint, uint)[32];
        t[0] = (Lcrng.Mult, Lcrng.Add);
        for (int i = 1; i < 32; i++) t[i] = (t[i - 1].Item1 * t[i - 1].Item1, t[i - 1].Item2 * (t[i - 1].Item1 + 1));
        return t;
    }

    public static long LcrngDistance(uint from, uint to)
    {
        uint start = from, end = to;
        long count = 0;
        for (int i = 0; i < 32 && start != end; i++)
        {
            uint bit = 1u << i;
            if (((start ^ end) & bit) != 0)
            {
                start = JumpTable[i].Mult * start + JumpTable[i].Add;
                count += 1L << i;
            }
        }
        return count;
    }

    // ---------------------------------------------------------------- derived values
    public static int[] IvsFromWords(int w1, int w2) => new[] { w1 & 31, (w1 >> 5) & 31, (w1 >> 10) & 31, (w2 >> 5) & 31, (w2 >> 10) & 31, w2 & 31 };
    public static int GenderOf(uint pid, int ratio) => ratio == 255 ? 2 : ratio == 254 ? 1 : ratio == 0 ? 0 : ((pid & 0xFF) < ratio ? 1 : 0);
    public static bool GenderFixed(int ratio) => ratio == 0 || ratio == 254 || ratio == 255;

    public static (int Index, int TypeId, int Power) HiddenPower(int[] ivs)
    {
        int[] order = { 0, 1, 2, 5, 3, 4 }; // hp atk def spe spa spd over the PokeFinder-ordered array
        int typeBits = 0, powerBits = 0;
        for (int i = 0; i < 6; i++)
        {
            typeBits |= (ivs[order[i]] & 1) << i;
            powerBits |= ((ivs[order[i]] >> 1) & 1) << i;
        }
        int index = typeBits * 15 / 63;
        int typeId = index + 1;
        if (typeId >= 9) typeId++;
        return (index, typeId, powerBits * 40 / 63 + 30);
    }

    public static int ShinyType(uint pid, uint tid, uint sid)
    {
        uint psv = ((pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF;
        uint tsv = (tid ^ sid) & 0xFFFF;
        if (psv == tsv) return 2;
        return ((psv ^ tsv) & 0xFFFF) < 8 ? 1 : 0;
    }

    public static int UnownLetter(uint pid) => (int)((((pid & 0x03000000) >> 18) | ((pid & 0x00030000) >> 12) | ((pid & 0x00000300) >> 6) | (pid & 0x3)) % 28);

    public static int[] StatsAtLevel(int[] baseStats, int[] ivs, int level, int nature)
    {
        // baseStats and ivs both hp atk def spa spd spe here (ivs already in PokeFinder order; base is hp atk def spe spa spd)
        int[] b = { baseStats[0], baseStats[1], baseStats[2], baseStats[4], baseStats[5], baseStats[3] };
        int[] natureStatOrder = { 1, 2, 5, 3, 4 }; // atk def spe spa spd as indices into hp atk def spa spd spe
        var outStats = new int[6];
        outStats[0] = (2 * b[0] + ivs[0]) * level / 100 + level + 10;
        int plus = nature / 5, minus = nature % 5;
        for (int k = 0; k < 5; k++)
        {
            int idx = natureStatOrder[k];
            int raw = (2 * b[idx] + ivs[idx]) * level / 100 + 5;
            int mod = 100;
            if (plus != minus) { if (k == plus) mod = 110; else if (k == minus) mod = 90; }
            outStats[idx] = raw * mod / 100;
        }
        return outStats;
    }

    static GenResult Build(long frame, uint pid, int[] ivs, int level, SpeciesInfo sp, uint tid, uint sid)
    {
        var hp = HiddenPower(ivs);
        int bit = (int)(pid & 1);
        int slot = sp.AbilityIds.Length > 1 && sp.AbilityIds[1] != 0 ? bit : 0;
        int abilityId = slot < sp.AbilityIds.Length && sp.AbilityIds[slot] != 0 ? sp.AbilityIds[slot] : sp.AbilityIds[0];
        return new GenResult
        {
            Frame = frame, Pid = pid, Nature = (int)(pid % 25), Ivs = ivs, Level = level, Gender = GenderOf(pid, sp.GenderRatio),
            AbilityBit = bit, AbilitySlot = slot, AbilityId = abilityId, Shiny = Gen3.IsShiny(pid, tid, sid), ShinyType = ShinyType(pid, tid, sid),
            Psv = (int)(((pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF), Tsv = (int)((tid ^ sid) & 0xFFFF),
            HiddenPower = hp.Index, HiddenPowerTypeId = hp.TypeId, HiddenPowerPower = hp.Power,
            Stats = StatsAtLevel(sp.BaseStats, ivs, level, (int)(pid % 25)), Species = sp.Dex,
        };
    }

    static GenResult Invalid(long frame, string reason, int calls) => new() { Frame = frame, Valid = false, Reason = reason, CallsUsed = calls };

    // ---------------------------------------------------------------- filters
    public static bool Matches(GenResult r, GenFilter? f)
    {
        if (f is null) return true;
        if (f.ValidOnly && !r.Valid) return false;
        if (f.Natures is { Length: > 0 } && Array.IndexOf(f.Natures, r.Nature) < 0) return false;
        if (f.Gender is int g && r.Gender != g) return false;
        if (f.Ability is int a && r.AbilityBit != a) return false;
        if (f.Shiny is bool s && r.Shiny != s) return false;
        if (f.HpTypes is { Length: > 0 } && Array.IndexOf(f.HpTypes, r.HiddenPower) < 0) return false;
        if (f.HpPowerMin > 0 && r.HiddenPowerPower < f.HpPowerMin) return false;
        for (int i = 0; i < 6; i++)
        {
            if (f.MinIv > 0 && r.Ivs[i] < f.MinIv) return false;
            if (f.IvMin != null && r.Ivs[i] < f.IvMin[i]) return false;
            if (f.IvMax != null && r.Ivs[i] > f.IvMax[i]) return false;
        }
        if (f.LevelMin > 0 && r.Level < f.LevelMin) return false;
        if (f.LevelMax > 0 && r.Level > f.LevelMax) return false;
        if (f.Slots is { Length: > 0 } && r.EncounterSlot >= 0 && Array.IndexOf(f.Slots, r.EncounterSlot) < 0) return false;
        if (f.Species is { Length: > 0 } && Array.IndexOf(f.Species, r.Species) < 0) return false;
        return true;
    }
    static List<GenResult> Apply(List<GenResult> list, GenFilter? f) => f is null ? list : list.Where(r => Matches(r, f)).ToList();

    // ---------------------------------------------------------------- leads
    static bool IsPressure(Lead l) => l.Ability is "PRESSURE" or "HUSTLE" or "VITAL_SPIRIT";
    static bool IsKeenEye(Lead l) => l.Ability is "KEEN_EYE" or "INTIMIDATE";
    static bool IsSuction(Lead l) => l.Ability is "SUCTION_CUPS" or "STICKY_HOLD";
    static bool IsArena(Lead l) => l.Ability is "ARENA_TRAP" or "NO_GUARD" or "ILLUMINATE";
    static bool IsCompound(Lead l) => l.Ability is "COMPOUND_EYES" or "SUPER_LUCK";
    static bool IsFieldAbility(Lead l) => l.Ability is "SYNCHRONIZE" or "CUTE_CHARM" or "MAGNET_PULL" or "STATIC" or "PRESSURE" or "HUSTLE" or "VITAL_SPIRIT" or "KEEN_EYE" or "INTIMIDATE";
    static int CuteCharmWants(Lead l) => l.Gender == 'F' ? 0 : 1;
    static int? LeadType(Lead l) => l.Ability == "MAGNET_PULL" ? TypeSteel : l.Ability == "STATIC" ? TypeElectric : null;

    static List<int> TypedSlots(IReadOnlyList<EncounterSlot> slots, int type)
    {
        var idx = new List<int>();
        for (int i = 0; i < slots.Count; i++)
        {
            var t = slots[i].Species.TypeIds;
            if (t[0] == type || t[1] == type) idx.Add(i);
        }
        if (idx.Count == 0 || idx.Count == slots.Count) idx.Clear();
        return idx;
    }

    // ---------------------------------------------------------------- slot tables
    static int Cum(int rand, int[] cum) { for (int i = 0; i < cum.Length; i++) if (rand < cum[i]) return i; return cum.Length - 1; }
    static readonly int[] CumLand = { 20, 40, 50, 60, 70, 80, 85, 90, 94, 98, 99, 100 };
    static readonly int[] CumWater = { 60, 90, 95, 99, 100 };
    static readonly int[] CumOld3 = { 70, 100 }, CumGood3 = { 60, 80, 100 }, CumSuper3 = { 40, 80, 95, 99, 100 };
    static readonly int[] CumRodJ = { 40, 80, 95, 99, 100 }, CumRodK = { 40, 70, 85, 95, 100 }, CumRockK = { 80, 100 }, CumHeadbutt = { 50, 65, 80, 90, 95, 100 };
    static readonly int[] BugRates = { 80, 60, 50, 40, 30, 20, 15, 10, 5, 0 };

    public static int HSlot(int rand, string enc) => enc switch
    {
        "old_rod" => Cum(rand, CumOld3), "good_rod" => Cum(rand, CumGood3), "super_rod" => Cum(rand, CumSuper3),
        "surf" or "rock_smash" => Cum(rand, CumWater), _ => Cum(rand, CumLand)
    };
    public static int JSlot(int rand, string enc) => enc switch
    {
        "good_rod" or "super_rod" => Cum(rand, CumRodJ), "old_rod" or "surf" => Cum(rand, CumWater), _ => Cum(rand, CumLand)
    };
    public static int KSlot(int rand, string enc)
    {
        switch (enc)
        {
            case "old_rod": case "good_rod": case "super_rod": return Cum(rand, CumRodK);
            case "surf": return Cum(rand, CumWater);
            case "rock_smash": return Cum(rand, CumRockK);
            case "headbutt": return Cum(rand, CumHeadbutt);
            case "bug_contest": for (int i = 0; i < BugRates.Length; i++) if (rand >= BugRates[i]) return i; return BugRates.Length - 1;
            default: return Cum(rand, CumLand);
        }
    }
    static bool IsFishing(string enc) => enc is "old_rod" or "good_rod" or "super_rod";
    static readonly Dictionary<string, int> FeebasSlot3 = new() { ["old_rod"] = 2, ["good_rod"] = 3, ["super_rod"] = 5 };

    public static readonly int[][] DpptUnownGroups =
    {
        new[] { 0, 1, 2, 6, 7, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25 },
        new[] { 5 }, new[] { 17 }, new[] { 8 }, new[] { 13 }, new[] { 4 }, new[] { 3 }, new[] { 26, 27 }
    };
    public static readonly int[][] HgssUnownPuzzles =
    {
        new[] { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 }, new[] { 17, 18, 19, 20, 21 }, new[] { 10, 11, 12, 13, 14, 15, 16 }, new[] { 22, 23, 24, 25 }
    };

    // ================================================================ Gen 3
    public static List<GenResult> Gen3Static(uint seed, SpeciesInfo species, int level, string method = "M1", bool buggedRoamer = false,
        long frameStart = 0, int frameCount = 10, uint tid = 0, uint sid = 0, GenFilter? filter = null)
    {
        var outList = new List<GenResult>();
        var rng = new Stream(Lcrng.Jump(seed, (ulong)frameStart));
        for (int i = 0; i < frameCount; i++)
        {
            var go = rng.Clone();
            int lo = go.Next();
            int hi = go.Next();
            uint pid = ((uint)hi << 16) | (uint)lo;
            if (method == "M2") go.Next();
            int w1 = go.Next();
            if (method == "M4") go.Next();
            int w2 = go.Next();
            if (buggedRoamer) { w1 &= 0xFF; w2 = 0; }
            var r = Build(frameStart + i, pid, IvsFromWords(w1, w2), level, species, tid, sid);
            r.CallsUsed = go.Calls;
            outList.Add(r);
            rng.Next();
        }
        return Apply(outList, filter);
    }

    static string Gen3Family(string game) => game switch
    {
        "ruby" or "sapphire" => "rs", "emerald" => "e", "firered" or "leafgreen" => "frlg", _ => throw new ArgumentException("gen3 game " + game)
    };

    public static List<GenResult> Gen3Wild(uint seed, string game, string encounter, IReadOnlyList<EncounterSlot> slots, int rate, Lead? lead,
        Gen3WildOptions? options, string method = "M1", long frameStart = 0, int frameCount = 10, uint tid = 0, uint sid = 0, GenFilter? filter = null)
    {
        string fam = Gen3Family(game);
        lead ??= Lead.None;
        options ??= new Gen3WildOptions();
        if (fam != "e" && IsFieldAbility(lead)) throw new ArgumentException(game + " has no lead ability effects (" + lead.Ability + ")");
        int? ltype = fam == "e" ? LeadType(lead) : null;
        var typed = ltype is int lt ? TypedSlots(slots, lt) : new List<int>();
        bool typedApplies = ltype != null && (encounter == "grass" || (encounter == "surf" && lead.Ability == "STATIC"));
        bool rockOdds = fam != "frlg" && encounter == "rock_smash";
        int rate16 = 0;
        if (rockOdds)
        {
            rate16 = rate * 16;
            if (options.Bike) rate16 = rate16 * 80 / 100;
            if (options.Item == "white_flute") rate16 += rate16 / 2;
            else if (options.Item == "black_flute") rate16 /= 2;
            if (options.Item == "cleanse_tag") rate16 = rate16 * 2 / 3;
            if (rate16 > 2880) rate16 = 2880;
        }
        var outList = new List<GenResult>();
        var rng = new Stream(Lcrng.Jump(seed, (ulong)frameStart));
        for (int i = 0; i < frameCount; i++)
        {
            long frame = frameStart + i;
            var go = rng.Clone();
            rng.Next();
            int slot = -1, level = 0, form = 0;
            bool feebas = false;
            if (options.NewMetatile && encounter != "rock_smash" && !IsFishing(encounter) && go.Mod(100) >= 60) { outList.Add(Invalid(frame, "new_metatile", go.Calls)); continue; }
            if (rockOdds)
            {
                if (go.Mod(2880) >= rate16) { outList.Add(Invalid(frame, "rock_smash_odds", go.Calls)); continue; }
            }
            else if (options.OddsRoll && !IsFishing(encounter) && fam != "frlg")
            {
                int lr = Math.Min(2880, rate * 16);
                if (go.Mod(2880) >= lr) { outList.Add(Invalid(frame, "odds", go.Calls)); continue; }
            }
            if (options.Roamer && (encounter == "grass" || encounter == "surf") && go.Mod(4) == 0) { outList.Add(Invalid(frame, "roamer", go.Calls)); continue; }
            bool outbreakHit = false;
            if (options.Outbreak is { } ob && encounter == "grass" && fam != "frlg" && go.Mod(100) < ob.Probability) outbreakHit = true;

            SpeciesInfo sp;
            if (outbreakHit)
            {
                sp = options.Outbreak!.Value.Species; level = options.Outbreak.Value.Level;
            }
            else
            {
                if (IsFishing(encounter) && options.FeebasTile && fam != "frlg" && go.Mod(100) <= 49) { feebas = true; slot = FeebasSlot3[encounter]; }
                if (!feebas)
                {
                    bool forced = false;
                    if (typedApplies && go.Mod(2) == 0 && typed.Count > 0) { slot = typed[go.Mod(typed.Count)]; forced = true; }
                    if (!forced) slot = HSlot(go.Mod(100), encounter);
                }
                var sl = slots[slot];
                sp = sl.Species; form = sl.Form;
                int range = sl.MaxLevel - sl.MinLevel + 1;
                int rand = go.Mod(range);
                if (fam == "e" && IsPressure(lead))
                {
                    if (go.Mod(2) == 0) rand = range - 1;
                    else if (rand != 0) rand--;
                }
                level = sl.MinLevel + rand;
                if (fam == "e" && IsKeenEye(lead) && lead.Level > 5 && !IsFishing(encounter) && level <= lead.Level - 5 && go.Mod(2) == 0)
                {
                    outList.Add(Invalid(frame, "keen_eye", go.Calls)); continue;
                }
            }

            uint pid;
            if (fam == "frlg" && options.Tanoby)
            {
                do { int uh = go.Next(); int ul = go.Next(); pid = ((uint)uh << 16) | (uint)ul; } while (UnownLetter(pid) != form);
            }
            else
            {
                int wantGender = -1;
                if (fam == "e" && lead.Ability == "CUTE_CHARM" && !GenderFixed(sp.GenderRatio) && go.Mod(3) != 0) wantGender = CuteCharmWants(lead);
                if (fam != "frlg" && options.Safari) go.Mod(100);
                int nature = fam == "e" && lead.Ability == "SYNCHRONIZE" ? (go.Mod(2) == 0 ? lead.Nature : go.Mod(25)) : go.Mod(25);
                do
                {
                    int plo = go.Next(); int phi = go.Next();
                    pid = ((uint)phi << 16) | (uint)plo;
                } while (pid % 25 != nature || (wantGender >= 0 && GenderOf(pid, sp.GenderRatio) != wantGender));
            }
            if (method == "M2") go.Next();
            int w1 = go.Next();
            if (method == "M4") go.Next();
            int w2 = go.Next();
            var r = Build(frame, pid, IvsFromWords(w1, w2), level, sp, tid, sid);
            r.EncounterSlot = slot; r.Form = form; r.Feebas = feebas; r.Outbreak = outbreakHit; r.CallsUsed = go.Calls;
            outList.Add(r);
        }
        return Apply(outList, filter);
    }

    // ---------------------------------------------------------------- Gen 3 eggs
    public static readonly Dictionary<string, (int Iv1, int Iv2, int Inh)> Egg3Presets = new()
    {
        ["EBred"] = (0, 0, 1), ["EBredSplit"] = (0, 1, 1), ["EBredAlternate"] = (0, 0, 2),
        ["RSFRLGBred"] = (1, 0, 1), ["RSFRLGBredSplit"] = (0, 1, 1), ["RSFRLGBredAlternate"] = (1, 0, 2), ["RSFRLGBredMixed"] = (0, 0, 2)
    };

    static SpeciesInfo EggSpecies(uint pid, SpeciesInfo species, SpeciesInfo? male) => male != null && (pid & 0x8000) != 0 ? male : species;

    // mode: "fixed" (Emerald/DPPt: position i removed), "value" (RS/FRLG: value used as index), "index" (HGSS: rolled index removed)
    static int[] Inherit(int[] ivs, EggParents parents, int[] inh, int[] par, string mode)
    {
        var inheritance = new int[6];
        var available = new List<int> { 0, 1, 2, 3, 4, 5 };
        for (int i = 0; i < 3; i++)
        {
            int pos = inh[i];
            int stat = available[pos];
            int idx = StatIdToIvIndex[stat];
            ivs[idx] = parents.Ivs[par[i]][idx];
            inheritance[idx] = par[i] + 1;
            int removeAt = mode == "fixed" ? i : mode == "value" ? stat : pos;
            if (removeAt < available.Count) available.RemoveAt(removeAt);
            else if (available.Count > 0) available.RemoveAt(available.Count - 1);
        }
        return inheritance;
    }

    public static List<GenResult> Gen3EggEmerald(uint seed, string method, int calibration, int minRedraw, int maxRedraw, int compatibility,
        SpeciesInfo species, SpeciesInfo? speciesMale, EggParents parents, long frameStart = 0, int frameCount = 10, long pickupStart = 0,
        int pickupCount = 10, uint tid = 0, uint sid = 0, int maxNatureTries = 17, GenFilter? filter = null)
    {
        var preset = Egg3Presets.TryGetValue(method, out var pr) ? pr : Egg3Presets["EBred"];
        int parent = 0;
        for (int p = 0; p < 2; p++) if (parents.Genders[p] == 1) parent = p;
        for (int p = 0; p < 2; p++) if (parents.Genders[p] == 3) parent = p;
        bool everstone = parents.Items[parent] == 1;
        int wantedNature = parents.Natures[parent];
        var held = new List<HeldEgg>();
        var rng = new Stream(Lcrng.Jump(seed, (ulong)frameStart));
        long val = frameStart + 1;
        for (int cnt = 0; cnt < frameCount; cnt++, val++)
        {
            if (rng.Next() * 100 / 0xFFFF >= compatibility) continue;
            for (int redraw = minRedraw; redraw <= maxRedraw; redraw++)
            {
                var go = rng.Clone();
                int offset = calibration + 3 * redraw;
                bool flag = everstone && go.Next() < 0x7FFF;
                var trng = new Stream((uint)((val - offset) & 0xFFFF));
                uint pid;
                if (!flag) pid = ((uint)trng.Next() << 16) | (uint)(go.Mod(0xFFFE) + 1);
                else
                {
                    int tries = 0; bool ok = false; pid = 0;
                    while (tries < maxNatureTries)
                    {
                        tries++;
                        pid = ((uint)trng.Next() << 16) | (uint)go.Next();
                        if (pid % 25 == wantedNature && pid != 0) { ok = true; break; }
                    }
                    if (!ok) continue;
                }
                held.Add(new HeldEgg((uint)(frameStart + cnt - offset), frameStart + cnt - offset, redraw, pid, EggSpecies(pid, species, speciesMale), flag));
            }
        }
        return EggPickup3(seed, held, pickupStart, pickupCount, preset, parents, "fixed", tid, sid, filter, false);
    }

    public static List<GenResult> Gen3EggRSFRLG(uint seed, uint seedPickup, string method, int compatibility, SpeciesInfo species, SpeciesInfo? speciesMale,
        EggParents parents, long frameStart = 0, int frameCount = 10, long pickupStart = 0, int pickupCount = 10, uint tid = 0, uint sid = 0, GenFilter? filter = null)
    {
        var preset = Egg3Presets.TryGetValue(method, out var pr) ? pr : Egg3Presets["RSFRLGBred"];
        var held = new List<HeldEgg>();
        var rng = new Stream(Lcrng.Jump(seed, (ulong)frameStart));
        for (int cnt = 0; cnt < frameCount; cnt++)
        {
            var go = rng.Clone();
            rng.Next();
            if (go.Next() * 100 / 0xFFFF < compatibility)
            {
                uint low = (uint)(go.Mod(0xFFFE) + 1);
                held.Add(new HeldEgg(frameStart + cnt, frameStart + cnt, 0, low, EggSpecies(low, species, speciesMale), false));
            }
        }
        return EggPickup3(seedPickup, held, pickupStart, pickupCount, preset, parents, "value", tid, sid, filter, true);
    }

    static List<GenResult> EggPickup3(uint seed, List<HeldEgg> held, long start, int count, (int Iv1, int Iv2, int Inh) preset, EggParents parents,
        string mode, uint tid, uint sid, GenFilter? filter, bool high)
    {
        var outList = new List<GenResult>();
        if (held.Count == 0) return outList;
        var rng = new Stream(Lcrng.Jump(seed, (ulong)start));
        for (int cnt = 0; cnt < count; cnt++)
        {
            var go = rng.Clone();
            rng.Next();
            int hi = high ? go.Next() : 0;
            go.Skip(preset.Iv1);
            int w1 = go.Next();
            go.Skip(preset.Iv2);
            int w2 = go.Next();
            go.Skip(preset.Inh);
            int[] inh = { go.Mod(6), go.Mod(5), go.Mod(4) };
            int[] par = { go.Mod(2), go.Mod(2), go.Mod(2) };
            foreach (var st in held)
            {
                uint pid = high ? (((uint)hi << 16) | st.Pid) : st.Pid;
                var ivs = IvsFromWords(w1, w2);
                var inheritance = Inherit(ivs, parents, inh, par, mode);
                var r = Build(start + cnt, pid, ivs, 5, st.Species, tid, sid);
                r.Advances = st.Advances; r.HeldFrame = st.HeldFrame; r.PickupAdvances = start + cnt; r.Redraws = st.Redraws;
                r.EverstoneInherited = st.EverstoneInherited; r.Inheritance = inheritance; r.CallsUsed = go.Calls;
                outList.Add(r);
            }
        }
        outList.Sort((a, b) => a.Advances != b.Advances ? a.Advances.CompareTo(b.Advances) : a.PickupAdvances.CompareTo(b.PickupAdvances));
        return Apply(outList, filter);
    }

    // ================================================================ Gen 4
    public static uint ShinyPid(Stream go, uint tid, uint sid)
    {
        uint tsv = ((tid ^ sid) & 0xFFFF) >> 3;
        uint low = (uint)(go.Next() & 7);
        uint high = (uint)(go.Next() & 7);
        for (int i = 0; i < 13; i++)
        {
            uint bit = 1u << (i + 3);
            if ((tsv & (1u << i)) != 0)
            {
                if ((go.Next() & 1) != 0) low |= bit; else high |= bit;
            }
            else if ((go.Next() & 1) != 0) { low |= bit; high |= bit; }
        }
        return (high << 16) | low;
    }

    sealed class WildPid { public uint Pid; public int Nature; public bool CuteCharm; public int W1 = -1, W2 = -1, Tries; }

    static WildPid Gen4WildPid(Stream go, string method, Lead lead, SpeciesInfo species, bool forceOnePerfect)
    {
        bool div = method == "J";
        int Roll(int n) => div ? go.Div(n) : go.Mod(n);
        int NatureRoll() => lead.Ability == "SYNCHRONIZE" ? (Roll(2) == 0 ? lead.Nature : Roll(25)) : Roll(25);
        bool cc = lead.Ability == "CUTE_CHARM" && !GenderFixed(species.GenderRatio) && Roll(3) != 0;
        if (cc)
        {
            int n = NatureRoll();
            uint pid = CuteCharmWants(lead) == 0 ? (uint)(25 * (species.GenderRatio / 25 + 1) + n) : (uint)n;
            return new WildPid { Pid = pid, Nature = n, CuteCharm = true };
        }
        if (forceOnePerfect)
        {
            int nature = 0; uint pid = 0; int w1 = 0, w2 = 0, t;
            for (t = 0; t < 4; t++)
            {
                nature = NatureRoll();
                do { int lo = go.Next(); int hi = go.Next(); pid = ((uint)hi << 16) | (uint)lo; } while (pid % 25 != nature);
                w1 = go.Next(); w2 = go.Next();
                var ivs = IvsFromWords(w1, w2);
                if (ivs.Any(v => v == 31)) break;
            }
            return new WildPid { Pid = pid, Nature = nature, W1 = w1, W2 = w2, Tries = Math.Min(t + 1, 4) };
        }
        int nat = NatureRoll();
        uint p;
        do { int lo = go.Next(); int hi = go.Next(); p = ((uint)hi << 16) | (uint)lo; } while (p % 25 != nat);
        return new WildPid { Pid = p, Nature = nat };
    }

    public static List<GenResult> Gen4Static(uint seed, SpeciesInfo species, int level, string method = "M1", string shiny = "random", Lead? lead = null,
        long frameStart = 0, int frameCount = 10, uint tid = 0, uint sid = 0, GenFilter? filter = null)
    {
        lead ??= Lead.None;
        var outList = new List<GenResult>();
        var rng = new Stream(Lcrng.Jump(seed, (ulong)frameStart));
        for (int i = 0; i < frameCount; i++)
        {
            long frame = frameStart + i;
            var go = rng.Clone();
            int prng = rng.Next();
            uint pid;
            if (method == "M1")
            {
                if (shiny == "always") pid = ShinyPid(go, tid, sid);
                else
                {
                    int lo = go.Next(); int hi = go.Next();
                    pid = ((uint)hi << 16) | (uint)lo;
                    if (shiny == "never") while (Gen3.IsShiny(pid, tid, sid)) pid = ArngNext(pid);
                }
            }
            else pid = Gen4WildPid(go, method, lead, species, false).Pid;
            int w1 = go.Next(); int w2 = go.Next();
            var r = Build(frame, pid, IvsFromWords(w1, w2), level, species, tid, sid);
            r.CallsUsed = go.Calls; r.Call = prng % 3; r.Chatot = ((prng % 8192) * 100) >> 13;
            outList.Add(r);
        }
        return Apply(outList, filter);
    }

    public static List<GenResult> Gen4StarterTriple(uint seed, long frame, SpeciesInfo[] starters, uint tid, uint sid)
    {
        var list = new List<GenResult>();
        for (int i = 0; i < 3; i++) list.Add(Gen4Static(seed, starters[i], 5, "M1", "random", null, frame + 4 * i, 1, tid, sid)[0]);
        return list;
    }

    static string ItemClass(int rand, bool compound)
    {
        int[] t = compound ? new[] { 20, 80 } : new[] { 45, 95 };
        return rand < t[0] ? "none" : rand < t[1] ? "common" : "rare";
    }

    public static List<GenResult> Gen4Wild(uint seed, string game, string method, string encounter, IReadOnlyList<EncounterSlot> slots, int rate, Lead? lead,
        Gen4WildOptions? options, long frameStart = 0, int frameCount = 10, uint tid = 0, uint sid = 0, GenFilter? filter = null)
    {
        if (method != "J" && method != "K") throw new ArgumentException("method must be J or K");
        bool div = method == "J";
        lead ??= Lead.None;
        options ??= new Gen4WildOptions();
        int? ltype = LeadType(lead);
        var typed = ltype is int lt ? TypedSlots(slots, lt) : new List<int>();
        bool safari = options.Safari, bug = encounter == "bug_contest", honey = encounter == "honey_tree", radar = encounter == "radar";
        bool compound = IsCompound(lead);
        int bconst = (IsFishing(encounter) ? 1 : 0) + (game is "diamond" or "pearl" ? 4 : 0) + (!options.GreatMarsh && !options.Safari ? 1 : 0);
        if (method == "K")
        {
            if (IsFishing(encounter)) { rate += options.FishingBoost; if (IsSuction(lead)) rate *= 2; }
            else if (IsArena(lead)) rate *= 2;
            if (rate > 100 && lead.Ability != null) rate = 100;
        }
        bool nibble = IsFishing(encounter) || (method == "K" && encounter == "rock_smash");
        var outList = new List<GenResult>();
        var rng = new Stream(Lcrng.Jump(seed, (ulong)frameStart));
        for (int i = 0; i < frameCount; i++)
        {
            long frame = frameStart + i;
            var go = rng.Clone();
            int prng = rng.Next();
            bool valid = true, feebas = false;
            int slot = 0, level = 0, form = 0;
            EncounterSlot sl;
            SpeciesInfo species;
            if (nibble && (div ? go.Div(100) : go.Mod(100)) >= rate) valid = false;

            if (honey)
            {
                sl = slots[options.Index]; species = sl.Species; slot = options.Index;
                level = 5 + go.Div(11);
                if (IsPressure(lead) && go.Div(2) != 0) level = 15;
            }
            else if (radar)
            {
                if (!options.RadarKeepChain)
                {
                    bool f2 = false;
                    if (ltype != null && go.Div(2) == 0 && typed.Count > 0) { slot = typed[go.Mod(typed.Count)]; f2 = true; }
                    if (!f2) slot = JSlot(go.Div(100), "grass");
                }
                else slot = options.Index;
                sl = slots[slot]; species = sl.Species; level = sl.MaxLevel;
            }
            else
            {
                bool forced = false;
                if (IsFishing(encounter) && options.FeebasTile && method == "J" && go.Div(2) != 0)
                {
                    feebas = true; slot = 5;
                    if (ltype != null) go.Div(2);
                    go.Div(100);
                    forced = true;
                }
                if (!forced && ltype != null && (div ? go.Div(2) : go.Mod(2)) == 0 && typed.Count > 0)
                {
                    int pick = typed[go.Mod(typed.Count)];
                    if (!(method == "J" && encounter != "grass" && lead.Ability == "MAGNET_PULL")) { slot = pick; forced = true; }
                }
                if (!forced)
                {
                    if (method == "K" && safari) slot = go.Next() % 10;
                    else if (bug) slot = KSlot(go.Mod(100), "bug_contest");
                    else slot = div ? JSlot(go.Div(100), encounter) : KSlot(go.Mod(100), encounter);
                }
                sl = slots[slot]; species = sl.Species; form = sl.Form;
                bool fixedLevel = encounter == "grass" || (method == "K" && safari);
                if (fixedLevel)
                {
                    if (IsPressure(lead) && (!safari || encounter == "grass") && (div ? go.Div(2) : go.Mod(2)) != 0)
                    {
                        int ns = slot;
                        for (int k = 0; k < slots.Count; k++)
                            if (slots[k].Species.Dex == slots[ns].Species.Dex && slots[k].MaxLevel > slots[ns].MaxLevel) ns = k;
                        slot = ns; sl = slots[slot];
                    }
                    level = sl.MaxLevel;
                }
                else if (bug) level = sl.MinLevel + go.Next() % (sl.MaxLevel - sl.MinLevel + 1);
                else
                {
                    int range = sl.MaxLevel - sl.MinLevel + 1;
                    level = sl.MinLevel + go.Next() % range;
                    if (IsPressure(lead) && (div ? go.Div(2) : go.Mod(2)) != 0) level = sl.MaxLevel;
                }
                if (IsKeenEye(lead) && lead.Level > 5 && level <= lead.Level - 5 && (div ? go.Div(2) : go.Mod(2)) == 0)
                {
                    outList.Add(Invalid(frame, "keen_eye", go.Calls)); continue;
                }
            }

            uint pid; int w1, w2;
            bool ccFlag = false; int tries = 0;
            if (radar && options.RadarShiny)
            {
                int pick = -1, wantN = -1;
                if (lead.Ability == "CUTE_CHARM" && !GenderFixed(species.GenderRatio)) { if (go.Div(3) != 0) pick = CuteCharmWants(lead); }
                else if (lead.Ability == "SYNCHRONIZE") { if (go.Div(2) == 0) wantN = lead.Nature; }
                pid = ShinyPid(go, tid, sid);
                while ((pick >= 0 && GenderOf(pid, species.GenderRatio) != pick) || (wantN >= 0 && pid % 25 != wantN)) pid = ShinyPid(go, tid, sid);
                w1 = go.Next(); w2 = go.Next();
            }
            else
            {
                bool force = method == "K" && (safari || bug);
                var res = Gen4WildPid(go, method, lead, species, force);
                pid = res.Pid; ccFlag = res.CuteCharm; tries = res.Tries;
                if (res.W1 >= 0) { w1 = res.W1; w2 = res.W2; } else { w1 = go.Next(); w2 = go.Next(); }
            }
            int itemRoll = go.Mod(100);
            if (species.Dex == 201)
            {
                if (method == "J")
                {
                    var group = DpptUnownGroups[Math.Clamp(options.UnownTable - 1, 0, 7)];
                    form = group[go.Next() % group.Length];
                }
                else if (options.Sinjoh) form = new[] { 26, 27 }[go.Next() % 2];
                else
                {
                    var avail = new List<int>(); var uncaught = new List<int>();
                    for (int pz = 0; pz < 4; pz++)
                    {
                        if (!options.UnownPuzzles[pz]) continue;
                        foreach (int letter in HgssUnownPuzzles[pz]) { if (options.UnownSeen != null && !options.UnownSeen[letter]) uncaught.Add(letter); avail.Add(letter); }
                    }
                    if (options.UnownRadio && uncaught.Count > 0 && go.Next() % 100 < 50) form = uncaught[go.Next() % uncaught.Count];
                    else form = avail[go.Next() % avail.Count];
                }
            }
            var r = Build(frame, pid, IvsFromWords(w1, w2), level, species, tid, sid);
            r.EncounterSlot = slot; r.Form = form; r.Feebas = feebas; r.CuteCharm = ccFlag; r.PerfectIvTries = tries;
            r.ItemRoll = itemRoll; r.ItemClass = ItemClass(itemRoll, compound);
            r.CallsUsed = go.Calls; r.BattleAdvances = frame + go.Calls + bconst; r.Call = prng % 3; r.Chatot = ((prng % 8192) * 100) >> 13;
            r.Valid = valid;
            outList.Add(r);
        }
        return Apply(outList, filter);
    }

    public static double RadarShinyOdds(int chain)
    {
        if (chain <= 0) return 0;
        int rate = 8200 - chain * 200;
        if (rate < 200) rate = 200;
        return 1.0 / rate;
    }

    // ---------------------------------------------------------------- Gen 4 eggs
    public static List<HeldEgg> Gen4EggHeld(uint seed, SpeciesInfo species, SpeciesInfo? speciesMale, long frameStart = 0, int frameCount = 10,
        int? everstoneNature = null, bool masuda = false, uint tid = 0, uint sid = 0)
    {
        var mt = new Mt19937(seed);
        for (long s = 0; s < frameStart; s++) mt.Next();
        int need = frameCount + (everstoneNature is null ? 0 : 2401);
        var buf = new uint[need];
        for (int b = 0; b < need; b++) buf[b] = mt.Next();
        var held = new List<HeldEgg>();
        for (int i = 0; i < frameCount; i++)
        {
            uint pid = buf[i];
            if (everstoneNature is int want)
            {
                int tries = 0, j = i;
                while (!(pid % 25 == want && pid != 0)) { if (++tries > 2400) break; pid = buf[++j]; }
            }
            if (masuda && !Gen3.IsShiny(pid, tid, sid))
                for (int m = 0; m < 4; m++) { pid = ArngNext(pid); if (Gen3.IsShiny(pid, tid, sid)) break; }
            held.Add(new HeldEgg(frameStart + i, frameStart + i, 0, pid, EggSpecies(pid, species, speciesMale), everstoneNature != null));
        }
        return held;
    }

    public static List<GenResult> Gen4EggPickup(uint seed, List<HeldEgg> held, string game, EggParents parents, long pickupStart = 0, int pickupCount = 10,
        uint tid = 0, uint sid = 0, (int Stat, int Parent, bool Both)? powerItem = null, GenFilter? filter = null)
    {
        var outList = new List<GenResult>();
        if (held.Count == 0) return outList;
        bool hgss = game is "heartgold" or "soulsilver" or "hgss";
        var rng = new Stream(Lcrng.Jump(seed, (ulong)pickupStart));
        for (int cnt = 0; cnt < pickupCount; cnt++)
        {
            var go = rng.Clone();
            int prng = rng.Next();
            int w1 = go.Next(); int w2 = go.Next();
            var baseIvs = IvsFromWords(w1, w2);
            var inh = new List<int>(); var par = new List<int>();
            int startNum = 0;
            (int Stat, int Parent)? forced = null;
            if (hgss && powerItem is { } pw)
            {
                int parent = pw.Both ? (go.Next() % 2 != 0 ? 0 : 1) : pw.Parent;
                forced = (pw.Stat, parent); startNum = 1;
            }
            for (int k = startNum; k < 3; k++) inh.Add(go.Next() % (6 - k));
            for (int k = startNum; k < 3; k++) par.Add(go.Next() % 2);
            foreach (var st in held)
            {
                var ivs = (int[])baseIvs.Clone();
                int[] inheritance;
                if (forced is { } fc)
                {
                    inheritance = new int[6];
                    var available = new List<int> { 0, 1, 2, 3, 4, 5 };
                    int fidx = StatIdToIvIndex[fc.Stat];
                    ivs[fidx] = parents.Ivs[fc.Parent][fidx]; inheritance[fidx] = fc.Parent + 1;
                    available.RemoveAt(fc.Stat);
                    for (int q = 0; q < 2; q++)
                    {
                        int stat = available[inh[q]]; int idx = StatIdToIvIndex[stat];
                        ivs[idx] = parents.Ivs[par[q]][idx]; inheritance[idx] = par[q] + 1;
                        available.RemoveAt(inh[q]);
                    }
                }
                else inheritance = Inherit(ivs, parents, inh.ToArray(), par.ToArray(), hgss ? "index" : "fixed");
                var r = Build(pickupStart + cnt, st.Pid, ivs, 1, st.Species, tid, sid);
                r.Advances = st.Advances; r.PickupAdvances = pickupStart + cnt; r.Inheritance = inheritance;
                r.Call = prng % 3; r.Chatot = ((prng % 8192) * 100) >> 13; r.CallsUsed = go.Calls;
                outList.Add(r);
            }
        }
        outList.Sort((a, b) => a.Advances != b.Advances ? a.Advances.CompareTo(b.Advances) : a.PickupAdvances.CompareTo(b.PickupAdvances));
        return Apply(outList, filter);
    }

    // ================================================================ rarity and reachability
    static (uint Mult, uint Add) JumpParams(int k)
    {
        uint mult = 1, add = 0;
        for (int i = 0; i < k; i++) { add = mult * Lcrng.Add + add; mult *= Lcrng.Mult; }
        return (mult, add);
    }
    static readonly Dictionary<int, uint[]> HistCache = new();
    static uint[] Hist(int k)
    {
        if (HistCache.TryGetValue(k, out var h)) return h;
        var p = JumpParams(k);
        h = new uint[65536];
        for (uint t = 0; t < 65536; t++) h[(p.Mult * t + p.Add) >> 16]++;
        HistCache[k] = h;
        return h;
    }
    static bool WordMatches(int w, int[] idx, int[]? mn, int[]? mx)
    {
        int[] v = { w & 31, (w >> 5) & 31, (w >> 10) & 31 };
        for (int i = 0; i < 3; i++)
        {
            if (mn != null && v[i] < mn[idx[i]]) return false;
            if (mx != null && v[i] > mx[idx[i]]) return false;
        }
        return true;
    }
    static readonly int[] FirstIdx = { 0, 1, 2 }, SecondIdx = { 5, 3, 4 }; // hp atk def / spe spa spd in the PokeFinder-ordered arrays
    static (int[]? mn, int[]? mx) Bounds(GenFilter? f)
    {
        if (f is null) return (null, null);
        int[]? mn = f.IvMin?.ToArray();
        if (f.MinIv > 0) { mn ??= new int[6]; for (int i = 0; i < 6; i++) if (mn[i] < f.MinIv) mn[i] = f.MinIv; }
        return (mn, f.IvMax);
    }

    public static (long Count, double Per100k, long Pairs) CountIvStates(GenFilter? filter, string method = "M1")
    {
        int k = method == "M4" ? 2 : 1;
        var p = JumpParams(k);
        var h = Hist(k);
        var (mn, mx) = Bounds(filter);
        var A = new List<int>(); var B = new List<int>();
        for (int w = 0; w < 65536; w++)
        {
            if (WordMatches(w, FirstIdx, mn, mx)) A.Add(w);
            if (WordMatches(w, SecondIdx, mn, mx)) B.Add(w);
        }
        int[]? hpTypes = filter?.HpTypes is { Length: > 0 } ? filter.HpTypes : null;
        int hpMin = filter?.HpPowerMin ?? 0;
        long total = 0;
        foreach (int a in A)
        {
            uint X = (p.Mult * (uint)a) & 0xFFFF;
            foreach (int b in B)
            {
                if (hpTypes != null || hpMin > 0)
                {
                    var hp = HiddenPower(IvsFromWords(a, b));
                    if (hpTypes != null && Array.IndexOf(hpTypes, hp.Index) < 0) continue;
                    if (hp.Power < hpMin) continue;
                }
                total += h[((uint)b - X) & 0xFFFF];
            }
        }
        return (total, total / 4294967296.0 * 100000, (long)A.Count * B.Count);
    }

    public static List<uint> ListIvStates(GenFilter? filter, string method, Func<int[], bool>? pred, Func<int[], bool>? wordPred)
    {
        int k = method == "M4" ? 2 : 1;
        var p = JumpParams(k);
        var (mn, mx) = Bounds(filter);
        bool Wp(int w) => wordPred == null || wordPred(new[] { w & 31, (w >> 5) & 31, (w >> 10) & 31 });
        var states = new List<uint>();
        for (int w1 = 0; w1 < 65536; w1++)
        {
            if (!WordMatches(w1, FirstIdx, mn, mx) || !Wp(w1)) continue;
            for (uint t = 0; t < 65536; t++)
            {
                uint s = ((uint)w1 << 16) | t;
                int w2 = (int)((p.Mult * s + p.Add) >> 16);
                if (!WordMatches(w2, SecondIdx, mn, mx) || !Wp(w2)) continue;
                if (pred != null && !pred(IvsFromWords(w1, w2))) continue;
                states.Add(s);
            }
        }
        return states;
    }

    public static (uint Pid, int Nature, int Psv, uint SeedState) PidForIvState(uint s, string method)
    {
        uint hiState = method == "M2" ? Prev(Prev(s)) : Prev(s);
        uint loState = Prev(hiState);
        uint pid = ((hiState >> 16) << 16) | (loState >> 16);
        return (pid, (int)(pid % 25), (int)(((pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF), Prev(loState));
    }

    public static List<(uint IvState, uint SeedState, uint Pid, int Nature, int Psv)> FlawlessTable(string method = "M1")
    {
        var list = new List<(uint, uint, uint, int, int)>();
        foreach (uint s in ListIvStates(new GenFilter { MinIv = 31 }, method, null, null))
        {
            var p = PidForIvState(s, method);
            list.Add((s, p.SeedState, p.Pid, p.Nature, p.Psv));
        }
        return list;
    }

    public static List<uint> FiveThirtyOneStates(string method = "M1") =>
        ListIvStates(null, method, ivs => ivs.Count(v => v == 31) == 5, v3 => v3.Count(v => v == 31) >= 2);

    public static long FrameForIvState(uint seed, uint ivState, string method = "M1")
    {
        int callsBefore = method == "M2" ? 3 : 2;
        return LcrngDistance(seed, ivState) - callsBefore - 1;
    }

    // PKHeX LCRNGReversal.GetSeedsIVs (LCRNGReversal.cs:65-104)
    const uint RvLag0 = 0x67D3, RvLag1 = 0xC907, RvLower = 0x3443, RvUpper = 0xC34E;
    public static List<uint> SeedsForIvWords(int w1, int w2)
    {
        uint first = (uint)(w1 & 0x7FFF) << 16;
        uint second = (uint)(w2 & 0x7FFF) << 16;
        uint tmp = ((second - Lcrng.Mult * first) >> 16) * RvLag1;
        uint lo = ((tmp + RvLower) >> 15) * RvLag0;
        uint mi = lo + RvLag0;
        uint up = ((tmp + RvUpper) >> 15) * RvLag0;
        var result = new List<uint>();
        void Add(uint low)
        {
            low %= RvLag1;
            do
            {
                uint seed = first | low;
                if ((Lcrng.Next(seed) & 0x7FFF0000) == second)
                {
                    seed = Prev(seed);
                    result.Add(seed);
                    result.Add(seed ^ 0x80000000);
                }
            } while ((low += RvLag1) < 0x10000);
        }
        Add(lo); Add(mi); if (mi != up) Add(up);
        return result;
    }
    public static List<uint> SeedsForIvs(int[] ivs) => SeedsForIvWords(ivs[0] | (ivs[1] << 5) | (ivs[2] << 10), ivs[5] | (ivs[3] << 5) | (ivs[4] << 10));

    public static List<(uint Seed, long Frame, int Hour, int Ab, int DelayPlusYear, uint IvOrigin)> Gen4SeedsForTarget(int[] ivs, long maxFrame = 100, int callsBeforeIv1 = 2)
    {
        var hits = new List<(uint, long, int, int, int, uint)>();
        foreach (uint origin in SeedsForIvs(ivs))
        {
            uint s = origin;
            for (int b = 0; b < callsBeforeIv1; b++) s = Prev(s);
            for (long frame = 0; frame <= maxFrame; frame++)
            {
                int hour = (int)((s >> 16) & 0xFF);
                if (hour <= 23) hits.Add((s, frame, hour, (int)(s >> 24), (int)(s & 0xFFFF), origin));
                s = Prev(s);
            }
        }
        hits.Sort((a, b) => a.Item2 != b.Item2 ? a.Item2.CompareTo(b.Item2) : a.Item1.CompareTo(b.Item1));
        return hits;
    }
}
