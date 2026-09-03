using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using ShinySolution.Core;

namespace ShinySolution.App;

// The wanted-IVs wizard panel's pure part: a port of the web tab's module (webapp/wizard-ui.js) over
// app/Core/Generators.cs, SeedTime4.cs, Timers.cs, Gen4.cs and the six core/data/{species,encounters,
// statics}-gen{3,4}.json files (embedded in the Core assembly, a copy beside the executable preferred:
// docs/DATA.md). The games, consoles and seed models with their decomp text and validation status; the
// static / gift catalogue with the method from the creation chain and the refusals with their reason; the
// wild tables and slots by map, kind and time of day with each game's lead effects; the wanted filter and
// its feasibility; the Gen 3 forward search from the fixed or typed seed with the honest limit and the
// exact first frame of the cycle; the Gen 4 IV back-step, hour-byte reachability, generator verification
// and seed-to-time rows; the result card, the numbered procedures, the typed outcome inverted to the frame
// or delay hit, and the calibration store per game, console, seed model and mode (Modes). Every output
// names the seed model it runs under and that model's validation status, which today is EMPIRICAL / model
// output for every game (no hardware session). TARGET mode, human input only: nothing reads a capture.
// tests/wizard-panel-vectors.json, emitted from the web tab's module by tools/gen-wizard-panel-vectors.cjs,
// pins this file to the tab number for number and line for line (app/Tests/WizardPanelChecks.cs); the
// number formatting (Js) reproduces JavaScript's toFixed, toPrecision, Math.round and number-to-string so
// the texts agree to the character.

// the JSON reads this file needs (an absent key is an error only where the data promises it)
static class WJ
{
    public static string S(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    public static string? SN(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    public static int Int(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : 0;
    public static int[] IA(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Select(x => x.GetInt32()).ToArray() : Array.Empty<int>();
    public static string[] SA(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : Array.Empty<string>();
}

public sealed class WizardSeedModel
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";     // fixed | typed | chosen
    public uint? Seed { get; init; }
    public string Text { get; init; } = "";
    public string? Typed { get; init; }
    public string Status { get; init; } = "";
}

public sealed record WizardGame(string Key, string Name, int Gen, string Family, string? Method, string Model);
public sealed record WizardConsole(string Key, int Gen, string Name);

public sealed class WizardSpecies
{
    public int Dex { get; init; }
    public string Name { get; init; } = "";
    public string[] Abilities { get; init; } = Array.Empty<string>();
    public int[] AbilityIds { get; init; } = Array.Empty<int>();
    public int GenderRatio { get; init; }
    public SpeciesInfo Info { get; init; } = null!;
    public bool GenderFixed => GenderRatio == 0 || GenderRatio == 254 || GenderRatio == 255;
    public bool HasSecondAbility => AbilityIds.Length > 1 && AbilityIds[1] != 0;
}

public sealed class WizardStaticEntry
{
    public string Id { get; init; } = "";
    public JsonElement Entry { get; init; }
    public string Category { get; init; } = "";
    public WizardSpecies Species { get; init; } = null!;
    public int Level { get; init; }
    public string Method { get; init; } = "M1";
    public string ShinyMode { get; init; } = "random";
    public bool BuggedRoamer { get; init; }
    public string? Refused { get; init; }
    public string? Provenance { get; init; }
    public bool LevelVerified { get; init; }
    public string Label { get; init; } = "";
    public string Creation => WJ.S(Entry, "creation");
}

public sealed record WizardTable(int Index, string Name, List<string> Kinds, bool Tanoby);
public sealed record WizardSlot(WizardSpecies Species, int MinLevel, int MaxLevel, int Form)
{
    public EncounterSlot ToEngine() => new(Species.Info, MinLevel, MaxLevel, Form);
}
public sealed record WizardSlots(List<WizardSlot> Slots, int Rate, string? Note, bool Tanoby);
public sealed record WizardSpeciesGroup(WizardSpecies Species, List<int> Slots, List<string> Levels);
public sealed record WizardLeadOption(string Key, string Name);

// what the user wants: per-stat IV min / max (hp atk def spa spd spe), nature, gender "M" / "F", ability bit, shiny with the IDs
public sealed class WizardWanted
{
    public int?[] IvMin { get; set; } = new int?[6];
    public int?[] IvMax { get; set; } = new int?[6];
    public int? Nature { get; set; }
    public string? Gender { get; set; }
    public int? Ability { get; set; }
    public bool Shiny { get; set; }
    public int? Tid { get; set; }
    public int? Sid { get; set; }
    public int? Species { get; set; }
}

public sealed class WizardFilter
{
    public int[] IvMin = new int[6];
    public int[] IvMax = new int[6];
    public int[]? Natures;
    public string? Gender;
    public int? Ability;
    public bool Shiny;
    public int[]? Species;

    public GenFilter ToGenFilter() => new()
    {
        IvMin = IvMin, IvMax = IvMax, Natures = Natures, Gender = Gender is null ? null : (Gender == "F" ? 1 : 0), Ability = Ability,
        Shiny = Shiny ? true : null, Species = Species, ValidOnly = true
    };
}

public sealed class WizardFeasibility
{
    public double IvPer100k;
    public bool IvExact;
    public long WordsA, WordsB;
    public double Odds;
    public List<string> Parts = new();
    public double Per100k;
    public double ExpectedFrames;
}

// one search configuration (the web tab's cfg object)
public sealed class WizardCfg
{
    public string Game = "";
    public string Console = "";
    public uint? Seed;
    public string Kind = "static";            // static | wild
    public string Method = "M1";              // Gen 3: M1 | M2 | M4
    public string StaticMethod = "M1";        // Gen 4 statics: M1 | J | K
    public WizardSpecies? Species;            // statics
    public int Level;
    public bool BuggedRoamer;
    public string ShinyMode = "random";
    public string StaticLabel = "";
    public List<WizardSlot>? Slots;           // wild
    public string Encounter = "grass";
    public int Rate;
    public string TableName = "";
    public bool Tanoby;
    public Lead? Lead;
    public WizardWanted Wanted = new();
    public long MaxFrame;
    public int Limit;
    public int YearMin = 2000, YearMax = 2099, DelayMin, DelayMax = 65535, TargetDelay = 600, TimesPerCandidate = 2;
}

public sealed class WizardExactFirst
{
    public int States;
    public long Frame = -1;
    public uint Pid;
    public uint State;
    public bool Found => Frame >= 0;
}

public sealed class WizardGen3Result
{
    public List<GenResult> Hits = new();
    public long MaxFrame;
    public int Limit;
    public WizardFeasibility Feasibility = new();
    public WizardExactFirst? ExactFirst;
    public string Model = "";
}

public sealed class WizardGen4Row
{
    public uint Seed;
    public int Frame;
    public int Year, Month, Day, Hour, Minute, Second, Delay, DelayDistance;
    public uint Origin;
    public GenResult Mon = new();
}

public sealed class WizardGen4Result
{
    public string? Error;
    public long Count;
    public List<WizardGen4Row> Rows = new();
    public long Combos;
    public int Origins, Candidates, Verified;
    public long MaxFrame;
    public WizardFeasibility Feasibility = new();
    public string Model = "";
}

public sealed class WizardGen3Hit
{
    public GenResult? Hit;
    public int Candidates;
    public int Window;
}

public sealed class WizardGen4Hit
{
    public string? Error;
    public List<CalibrateRow> Matches = new();
    public int Rows;
    public string Typed = "";
    public string Family = "";
}

// ---- the store: the timer calibration per game and console, per mode ----------------------------------
public sealed class WizardCalValue
{
    [JsonPropertyName("calibration")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public double? Calibration { get; set; }
    [JsonPropertyName("preTimer")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public double? PreTimer { get; set; }
    [JsonPropertyName("calibratedDelay")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public double? CalibratedDelay { get; set; }
    [JsonPropertyName("calibratedSecond")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public double? CalibratedSecond { get; set; }
}

public sealed class WizardCalSample
{
    [JsonPropertyName("model")] public string? Model { get; set; }
    [JsonPropertyName("target")] public double Target { get; set; }
    [JsonPropertyName("hit")] public double Hit { get; set; }
    [JsonPropertyName("secondOffset")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? SecondOffset { get; set; }
    [JsonPropertyName("typed")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Typed { get; set; }
    [JsonPropertyName("before")] public WizardCalValue Before { get; set; } = new();
    [JsonPropertyName("after")] public WizardCalValue After { get; set; } = new();
    [JsonPropertyName("candidates")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Candidates { get; set; }
    [JsonPropertyName("attempt")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Attempt { get; set; }
    [JsonPropertyName("mode")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Mode { get; set; }
    [JsonPropertyName("when")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? When { get; set; }
}

public sealed class WizardCalEntry
{
    [JsonPropertyName("samples")] public List<WizardCalSample> Samples { get; set; } = new();
}

public sealed class WizardInForce
{
    public WizardCalValue Value = new();
    public List<WizardCalSample> Samples = new();
    public List<WizardCalSample> Ignored = new();
}

// ---- JavaScript number formatting, so the two heads print the same text ----------------------------
public static class Js
{
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    public static string Hex8(uint n) => n.ToString("X8");
    public static string Hex8(long n) => ((uint)n).ToString("X8");
    // Math.round: half towards +infinity (x - floor(x) is exact, so 0.49999999999999994 rounds to 0 as in JavaScript)
    public static double Round(double x) { double f = Math.Floor(x); return x - f >= 0.5 ? f + 1 : f; }
    // |x| as an exact fraction: every double is an integer times a power of two
    static (BigInteger Num, BigInteger Den) Exact(double x)
    {
        long bits = BitConverter.DoubleToInt64Bits(Math.Abs(x));
        int exp = (int)((bits >> 52) & 0x7FF);
        long man = bits & 0xFFFFFFFFFFFFFL;
        if (exp == 0) exp++; else man |= 1L << 52;
        exp -= 1075;
        BigInteger num = man, den = BigInteger.One;
        if (exp >= 0) num <<= exp; else den <<= -exp;
        return (num, den);
    }
    // the integer n nearest num / den, the larger one on a tie (ECMAScript toFixed and toPrecision)
    static BigInteger NearestUp(BigInteger num, BigInteger den) { var q = BigInteger.DivRem(num, den, out var r); return 2 * r >= den ? q + 1 : q; }
    static int Cmp10(BigInteger num, BigInteger den, int e) => e >= 0 ? num.CompareTo(den * BigInteger.Pow(10, e)) : (num * BigInteger.Pow(10, -e)).CompareTo(den);
    // Number.prototype.toFixed: exact decimal rounding of the double, ties up; the plain string from 1e21
    public static string Fixed(double x, int digits)
    {
        if (double.IsNaN(x)) return "NaN";
        if (double.IsInfinity(x)) return x > 0 ? "Infinity" : "-Infinity";
        if (Math.Abs(x) >= 1e21) return Num(x);
        var (num, den) = Exact(x);
        string s = NearestUp(num * BigInteger.Pow(10, digits), den).ToString(Inv);
        if (digits > 0)
        {
            if (s.Length <= digits) s = new string('0', digits - s.Length + 1) + s;
            s = s[..^digits] + "." + s[^digits..];
        }
        return (x < 0 ? "-" : "") + s;
    }
    public static string F1(double x) => Fixed(Round(x * 10) / 10, 1);
    // Number.prototype.toPrecision (exact rounding, ties up; the exponent forms for e < -6 and e >= p)
    public static string Precision(double x, int p)
    {
        if (double.IsNaN(x)) return "NaN";
        if (double.IsInfinity(x)) return x > 0 ? "Infinity" : "-Infinity";
        if (x == 0) return p == 1 ? "0" : "0." + new string('0', p - 1);
        string sign = x < 0 ? "-" : "";
        var (num, den) = Exact(x);
        int e = (int)Math.Floor(Math.Log10(Math.Abs(x)));
        while (Cmp10(num, den, e) < 0) e--;
        while (Cmp10(num, den, e + 1) >= 0) e++;
        int k = e - p + 1;
        BigInteger n = k >= 0 ? NearestUp(num, den * BigInteger.Pow(10, k)) : NearestUp(num * BigInteger.Pow(10, -k), den);
        if (n == BigInteger.Pow(10, p)) { n /= 10; e++; }
        string digits = n.ToString(Inv);
        if (e < -6 || e >= p) return sign + digits[0] + (p > 1 ? "." + digits[1..] : "") + "e" + (e >= 0 ? "+" : "-") + Math.Abs(e);
        if (e == p - 1) return sign + digits;
        if (e >= 0) return sign + digits[..(e + 1)] + "." + digits[(e + 1)..];
        return sign + "0." + new string('0', -(e + 1)) + digits;
    }
    // Number.prototype.toString (the shortest round-trip digits; exponent forms below 1e-6 and from 1e21)
    public static string Num(double x)
    {
        if (double.IsNaN(x)) return "NaN";
        if (double.IsInfinity(x)) return x > 0 ? "Infinity" : "-Infinity";
        if (x == 0) return "0";
        string sign = x < 0 ? "-" : "";
        string r = Math.Abs(x).ToString("R", Inv);
        int ePos = r.IndexOf('E');
        string digits; int e;
        if (ePos < 0)
        {
            int dot = r.IndexOf('.');
            string ip = dot < 0 ? r : r[..dot], fp = dot < 0 ? "" : r[(dot + 1)..];
            string all = (ip + fp).TrimStart('0');
            int lead = (ip + fp).Length - all.Length;
            e = ip.Length - 1 - lead;
            digits = all.TrimEnd('0');
            if (digits == "") digits = "0";
        }
        else
        {
            string mant = r[..ePos].Replace(".", "");
            e = int.Parse(r[(ePos + 1)..], Inv);
            digits = mant.TrimEnd('0');
            if (digits == "") digits = "0";
        }
        int k = digits.Length, n = e + 1;
        if (n >= 22 || n <= -6)
            return sign + digits[0] + (k > 1 ? "." + digits[1..] : "") + "e" + (n - 1 >= 0 ? "+" : "-") + Math.Abs(n - 1);
        if (k <= n) return sign + digits + new string('0', n - k);
        if (n > 0) return sign + digits[..n] + "." + digits[n..];
        return sign + "0." + new string('0', -n) + digits;
    }
    public static string Num(long x) => x.ToString(Inv);
    public static string Plural(long n, string w) => n + " " + w + (n == 1 ? "" : "s");
    public static string Two(int n) => (n < 10 ? "0" : "") + n;
    // core/rng.js fmtMs (Math.round, not banker's rounding: frame 16384 at the GBA rate is exactly 274312.5 ms)
    public static string FmtMs(double ms)
    {
        double total = Math.Max(0, Round(ms));
        long m = (long)Math.Floor(total / 60000);
        long s = (long)Math.Floor(total % 60000 / 1000);
        long frac = (long)(total % 1000);
        return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s) + "." + ("00" + frac)[^3..];
    }
    public static string FmtLong(double ms)
    {
        if (ms > 48 * 3600000) return Fixed(ms / 86400000, 1) + " days";
        if (ms > 2 * 3600000) return Fixed(ms / 3600000, 1) + " hours";
        return FmtMs(ms);
    }
    public static string TitleCase(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..].ToLowerInvariant();
}

// The six data files: embedded in the Core assembly (data.species-gen3 ...), a copy beside the executable preferred.
public sealed class WizardData
{
    public int Gen { get; }
    public JsonElement SpeciesRoot { get; }
    public JsonElement Encounters { get; }
    public JsonElement Statics { get; }
    readonly Dictionary<int, WizardSpecies> _byDex = new();

    WizardData(int gen, JsonElement species, JsonElement encounters, JsonElement statics)
    {
        Gen = gen; SpeciesRoot = species; Encounters = encounters; Statics = statics;
        foreach (var s in species.GetProperty("species").EnumerateArray())
        {
            var bs = s.GetProperty("base_stats");
            var info = new SpeciesInfo(WJ.Int(s, "dex"), WJ.Int(s, "gender_ratio"), WJ.IA(s, "ability_ids"), WJ.IA(s, "type_ids"),
                new[] { WJ.Int(bs, "hp"), WJ.Int(bs, "atk"), WJ.Int(bs, "def"), WJ.Int(bs, "spe"), WJ.Int(bs, "spa"), WJ.Int(bs, "spd") });
            _byDex[info.Dex] = new WizardSpecies { Dex = info.Dex, Name = WJ.S(s, "name"), Abilities = WJ.SA(s, "abilities"), AbilityIds = info.AbilityIds, GenderRatio = info.GenderRatio, Info = info };
        }
    }
    public int SpeciesCount => _byDex.Count;
    public WizardSpecies Species(int dex) => _byDex.TryGetValue(dex, out var r) ? r : throw new ArgumentException("no species record for dex " + dex + " in Gen " + Gen);

    public static string[] FileNames(int gen) => new[] { $"species-gen{gen}.json", $"encounters-gen{gen}.json", $"statics-gen{gen}.json" };

    public static WizardData Load(int gen)
    {
        var names = FileNames(gen);
        var beside = names.Select(n => Path.Combine(AppContext.BaseDirectory, n)).ToArray();
        return beside.All(File.Exists) ? LoadFiles(gen, beside[0], beside[1], beside[2]) : LoadEmbedded(gen);
    }
    public static WizardData LoadFiles(int gen, string species, string encounters, string statics)
        => new(gen, ParseFile(species), ParseFile(encounters), ParseFile(statics));
    public static WizardData LoadEmbedded(int gen)
        => new(gen, ParseEmbedded($"data.species-gen{gen}"), ParseEmbedded($"data.encounters-gen{gen}"), ParseEmbedded($"data.statics-gen{gen}"));
    static JsonElement ParseFile(string path) => JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
    static JsonElement ParseEmbedded(string logicalName)
    {
        using var stream = typeof(Generators).Assembly.GetManifestResourceStream(logicalName)
            ?? throw new FileNotFoundException($"embedded resource {logicalName} is missing");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return JsonDocument.Parse(reader.ReadToEnd()).RootElement.Clone();
    }
}

public static class Wizard
{
    public static readonly string[] IvKeys = { "hp", "atk", "def", "spa", "spd", "spe" };
    public static readonly string[] IvNames = { "HP", "Atk", "Def", "SpA", "SpD", "Spe" };
    public const string StoreKey = "shinySolution.wizard.calibration";
    // the panel's setting (SettingsStore) for the calibration store; AppMode.Scoped gives each mode its own (".practice")
    public const string CalKeySetting = "wizard.calibration";
    public const string NoHardware = "EMPIRICAL / model output: no hardware session has run this procedure. Every frame, time and delay here is the engine's prediction from the decompiled code; the typed outcome in the last step is what ties it to your console.";
    public const string StatusNoSession = "EMPIRICAL / model output: no hardware session";
    public const string Gen4CuteCharmNote = "Cute Charm is not offered for Gen 4: when it procs the PID is arithmetic (pokeplatinum/src/pokemon.c:505-545), not the two LCRNG outputs before the IVs, so the IV back-step no longer reaches the PID";
    public const int Gen4WildLookback = 800; // calls a wild or J/K creation may spend before its IV words (slot, level, nature, the PID loop)
    public const int Gen4ComboCapM1 = 4096, Gen4ComboCapJK = 512;

    // ---- games, consoles and seed models ----------------------------------------------------
    // The seed model is what stands in for a methodology id here: no Gen 3 / Gen 4 methodology registry
    // exists in core/data yet, so each model carries its id, its decomp source and its validation status.
    public static readonly Dictionary<string, WizardSeedModel> SeedModels = new()
    {
        ["rs/gba/boot-seed-v0"] = new WizardSeedModel
        {
            Id = "rs/gba/boot-seed-v0", Kind = "fixed", Seed = 0x5a0,
            Text = "Ruby / Sapphire with a dead battery: the seed is 0x5A0 at every boot (pokeruby/src/rtc.c:13,134-140), and the RNG advances once per frame from then on, so a frame is a time after power-on at the console's rate.",
            Typed = "A live battery seeds from the RTC (a minute-based value): type that seed instead, or replace the battery so the dead-battery model applies.",
            Status = "defined and emulator-verified (tests/harness on libmgba); " + StatusNoSession + " (the power-on-to-press offset of a console is the calibration below)"
        },
        ["emerald/gba/boot-seed-0-v0"] = new WizardSeedModel
        {
            Id = "emerald/gba/boot-seed-0-v0", Kind = "fixed", Seed = 0,
            Text = "Emerald seeds 0 at boot (pokeemerald/src/main.c:108-110) and advances once per VBlank (main.c:365-366; twice per frame in battle), so a frame is a time after power-on at the console's rate.",
            Typed = null,
            Status = "decomp-derived; " + StatusNoSession
        },
        ["frlg/gba/typed-seed-v0"] = new WizardSeedModel
        {
            Id = "frlg/gba/typed-seed-v0", Kind = "typed", Seed = null,
            Text = "FireRed / LeafGreen seed the RNG from a Timer1 count at the title-screen press (pokefirered/src/naming_screen.c:717-722 for the naming exit; the title press is the same kind of count): there is no fixed seed. Type the seed you already know (from a frame hit you identified, or a community seed table); without one this game is stated unavailable here.",
            Typed = "the seed is typed",
            Status = "seed model only; " + StatusNoSession
        },
        ["dppt/nds/seed-to-time-v0"] = new WizardSeedModel
        {
            Id = "dppt/nds/seed-to-time-v0", Kind = "chosen",
            Text = "Diamond / Pearl / Platinum: seed = ((month*day + minute + second) << 24) + (hour << 16) + (year - 2000) + delay (pokeplatinum/src/main.c:306-315), delay = VBlanks since boot. The wizard back-steps the wanted IVs to a seed a clock can produce (the hour byte must be 0-23) and lists the date, time and delay that reach it (core/seedtime4.js).",
            Status = "PokeFinder's seed-to-time and reversal data bit for bit; EMPIRICAL / model output: no DS session has landed a seed chosen by this tool (the hardware gate)"
        },
        ["hgss/nds/seed-to-time-v0"] = new WizardSeedModel
        {
            Id = "hgss/nds/seed-to-time-v0", Kind = "chosen",
            Text = "HeartGold / SoulSilver: the same seed formula (pokeheartgold/src/main.c:281-284 with include/gf_rtc.h:46-51), the same back-step; Elm's calls verify the seed (phone_scripts_prof_elm.c:59,84,86), and the roamers' re-roll on continue is counted when you say which roam.",
            Status = "PokeFinder's seed-to-time and reversal data bit for bit; EMPIRICAL / model output: no DS session has landed a seed chosen by this tool (the hardware gate)"
        }
    };
    public static readonly Dictionary<string, WizardGame> Games = new()
    {
        ["ruby"] = new("ruby", "Ruby", 3, "rs", null, "rs/gba/boot-seed-v0"),
        ["sapphire"] = new("sapphire", "Sapphire", 3, "rs", null, "rs/gba/boot-seed-v0"),
        ["emerald"] = new("emerald", "Emerald", 3, "e", null, "emerald/gba/boot-seed-0-v0"),
        ["firered"] = new("firered", "FireRed", 3, "frlg", null, "frlg/gba/typed-seed-v0"),
        ["leafgreen"] = new("leafgreen", "LeafGreen", 3, "frlg", null, "frlg/gba/typed-seed-v0"),
        ["diamond"] = new("diamond", "Diamond", 4, "dppt", "J", "dppt/nds/seed-to-time-v0"),
        ["pearl"] = new("pearl", "Pearl", 4, "dppt", "J", "dppt/nds/seed-to-time-v0"),
        ["platinum"] = new("platinum", "Platinum", 4, "dppt", "J", "dppt/nds/seed-to-time-v0"),
        ["heartgold"] = new("heartgold", "HeartGold", 4, "hgss", "K", "hgss/nds/seed-to-time-v0"),
        ["soulsilver"] = new("soulsilver", "SoulSilver", 4, "hgss", "K", "hgss/nds/seed-to-time-v0")
    };
    public static readonly string[] GameOrder = { "ruby", "sapphire", "emerald", "firered", "leafgreen", "diamond", "pearl", "platinum", "heartgold", "soulsilver" };
    public static readonly Dictionary<string, WizardConsole> Consoles = new()
    {
        ["GBA"] = new("GBA", 3, "GBA / GBA SP / Game Boy Player (59.7275 fps)"),
        ["NDS_SLOT2"] = new("NDS_SLOT2", 3, "DS slot-2, a GBA cartridge in a DS (59.6555 fps)"),
        ["NDS_SLOT1"] = new("NDS_SLOT1", 4, "DS / DS Lite (59.8261 fps)"),
        ["DSI"] = new("DSI", 4, "DSi / 3DS (59.8261 fps)")
    };
    public static readonly string[] ConsoleOrder = { "GBA", "NDS_SLOT2", "NDS_SLOT1", "DSI" };
    public static readonly Dictionary<string, string> KindNames = new()
    {
        ["grass"] = "grass / cave (land)", ["surf"] = "surfing", ["rock_smash"] = "Rock Smash", ["old_rod"] = "Old Rod", ["good_rod"] = "Good Rod", ["super_rod"] = "Super Rod"
    };
    public static WizardGame Game(string key) => Games.TryGetValue(key, out var g) ? g : throw new ArgumentException("unknown game " + key);
    public static List<WizardConsole> ConsolesFor(string gameKey)
    {
        int gen = Game(gameKey).Gen;
        return ConsoleOrder.Select(k => Consoles[k]).Where(c => c.Gen == gen).ToList();
    }
    public static TimerSettings Settings(string consoleKey) => new(Console: Timers.ParseConsole(consoleKey));
    public static double FpsOf(string consoleKey) => Timers.Fps(Settings(consoleKey));
    public static double FrameToMs(double frame, string consoleKey) => frame * 1000 / FpsOf(consoleKey);
    public static WizardSeedModel ModelOf(string gameKey) => SeedModels[Game(gameKey).Model];

    // ---- data (core/data/{species,encounters,statics}-gen{3,4}.json) ---------------------------
    static readonly Dictionary<int, WizardData> Data = new();
    public static void SetData(WizardData d) => Data[d.Gen] = d;
    public static bool HasData(int gen) => Data.ContainsKey(gen);
    public static WizardData DataFor(int gen) => Data.TryGetValue(gen, out var d) ? d : throw new InvalidOperationException("the Gen " + gen + " species, encounter and static tables are not loaded");
    public static WizardSpecies SpeciesRec(int gen, int dex) => DataFor(gen).Species(dex);
    public static string SpeciesName(WizardSpecies rec) => rec.Name.Length == 0 ? "" : rec.Name[..1] + rec.Name[1..].ToLowerInvariant();
    public static string IvText(int[] ivs) => string.Join("/", ivs);

    // ---- statics ---------------------------------------------------------------------------
    static readonly HashSet<string> M1Categories = new() { "starter", "fossil", "gift", "game_corner", "roamer", "event" };
    static string StaticMethod(WizardGame game, JsonElement e)
    {
        var m = Regex.Match(WJ.S(e, "creation"), "Method (1|J|K)");
        if (m.Success) return m.Groups[1].Value == "1" ? "M1" : m.Groups[1].Value;
        if (game.Gen == 3) return "M1";
        // D/P rows carry PokeFinder provenance and no call chain: the category decides, as for their Platinum twins
        if (M1Categories.Contains(WJ.S(e, "category"))) return "M1";
        return game.Method!;
    }
    public static List<WizardStaticEntry> StaticEntries(string gameKey)
    {
        var game = Game(gameKey);
        var d = DataFor(game.Gen);
        var out_ = new List<WizardStaticEntry>();
        foreach (var e in d.Statics.GetProperty("entries").EnumerateArray())
        {
            if (!WJ.SA(e, "games").Contains(gameKey)) continue;
            string category = WJ.S(e, "category");
            string? shiny = WJ.SN(e, "shiny");
            string? refused = null;
            if (category == "egg") refused = "an egg: its PID is split between the trigger and the pickup (design 5.3); the egg generators are engine-only here";
            else if (shiny == "never") refused = "not RNG-manipulable: " + (WJ.SN(e, "notes") is { Length: > 0 } notes ? notes : "its personality is fixed");
            else if (e.TryGetProperty("catchable", out var c) && c.ValueKind == JsonValueKind.False) refused = "not catchable";
            string shinyMode = shiny == "always" ? "always" : shiny == "never" ? "never" : "random";
            string id = WJ.S(e, "id");
            string method = id == "hgss/static/gyarados" || id == "gen4/event/manaphy-egg" ? "M1" : StaticMethod(game, e);
            bool bugged = game.Gen == 3 && category == "roamer" && game.Family != "e";
            var species = d.Species(WJ.Int(e, "species"));
            int level = WJ.Int(e, "level");
            out_.Add(new WizardStaticEntry
            {
                Id = id, Entry = e, Category = category, Species = species, Level = level, Method = method, ShinyMode = shinyMode, BuggedRoamer = bugged, Refused = refused,
                Provenance = WJ.SN(e, "provenance"), LevelVerified = e.TryGetProperty("level_verified_against_decomp", out var lv) && lv.ValueKind == JsonValueKind.True,
                Label = SpeciesName(species) + " L" + level + " - " + WJ.S(e, "location") + " [" + category + ", " + (method == "M1" ? "Method 1" : "Method " + method) + (bugged ? ", roamer IV bug" : "") + (shinyMode != "random" ? ", shiny " + shinyMode : "") + "]"
            });
        }
        return out_;
    }

    // ---- wild tables ------------------------------------------------------------------------
    static bool Has(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null;
    public static List<WizardTable> WildTables(string gameKey)
    {
        var game = Game(gameKey);
        var d = DataFor(game.Gen);
        var out_ = new List<WizardTable>();
        if (game.Gen == 3)
        {
            foreach (var m in d.Encounters.GetProperty("games").GetProperty(gameKey).GetProperty("maps").EnumerateArray())
            {
                var kinds = new List<string>();
                if (Has(m, "land")) kinds.Add("grass");
                if (Has(m, "water")) kinds.Add("surf");
                if (Has(m, "rock_smash")) kinds.Add("rock_smash");
                if (Has(m, "fishing")) { kinds.Add("old_rod"); kinds.Add("good_rod"); kinds.Add("super_rod"); }
                if (kinds.Count > 0) out_.Add(new WizardTable(WJ.Int(m, "index"), WJ.S(m, "name") + " (" + WJ.S(m, "map") + ")", kinds, Has(m, "land") && Has(m.GetProperty("land"), "unown_letter_ids")));
            }
        }
        else
        {
            foreach (var t in d.Encounters.GetProperty("games").GetProperty(gameKey).GetProperty("tables").EnumerateArray())
            {
                var kinds = new List<string>();
                if (game.Family == "dppt") { if (Has(t, "grass")) kinds.Add("grass"); }
                else if (Has(t, "land")) kinds.Add("grass");
                if (Has(t, "surf")) kinds.Add("surf");
                if (game.Family == "hgss" && Has(t, "rock_smash")) kinds.Add("rock_smash");
                if (Has(t, "old_rod")) kinds.Add("old_rod");
                if (Has(t, "good_rod")) kinds.Add("good_rod");
                if (Has(t, "super_rod")) kinds.Add("super_rod");
                var names = Has(t, "names") ? WJ.SA(t, "names") : new[] { WJ.S(t, "table") };
                if (kinds.Count > 0) out_.Add(new WizardTable(WJ.Int(t, "index"), string.Join(" / ", names) + " (" + WJ.S(t, "table") + ")", kinds, false));
            }
        }
        return out_;
    }
    static JsonElement TableRecord(string gameKey, int index)
    {
        var game = Game(gameKey);
        var d = DataFor(game.Gen);
        var list = d.Encounters.GetProperty("games").GetProperty(gameKey).GetProperty(game.Gen == 3 ? "maps" : "tables");
        foreach (var t in list.EnumerateArray()) if (WJ.Int(t, "index") == index) return t;
        throw new ArgumentException("no encounter table " + index + " in " + gameKey);
    }
    static WizardSlot Slot3(int gen, JsonElement s, int form = 0) => new(SpeciesRec(gen, WJ.Int(s, "species")), WJ.Int(s, "min_level"), WJ.Int(s, "max_level"), form);
    // time: "morning" | "day" | "night" (Gen 4 land; DPPt's day / night lists replace slots 2 and 3, morning is the base table)
    public static WizardSlots SlotsFor(string gameKey, int index, string kind, string? time = null)
    {
        var game = Game(gameKey);
        var t = TableRecord(gameKey, index);
        var slots = new List<WizardSlot>();
        int rate = 0;
        string? note = null;
        if (game.Gen == 3)
        {
            if (kind == "grass")
            {
                if (!Has(t, "land")) throw new ArgumentException("no land table");
                var land = t.GetProperty("land");
                rate = WJ.Int(land, "rate");
                var letters = Has(land, "unown_letter_ids") ? WJ.IA(land, "unown_letter_ids") : null;
                int i = 0;
                foreach (var s in land.GetProperty("slots").EnumerateArray()) { slots.Add(Slot3(3, s, letters is null ? 0 : letters[i])); i++; }
                if (letters is not null) note = "Tanoby chamber: the Unown letter is fixed per slot and the PID loop rolls until it matches";
            }
            else if (kind == "surf") { var w = t.GetProperty("water"); rate = WJ.Int(w, "rate"); foreach (var s in w.GetProperty("slots").EnumerateArray()) slots.Add(Slot3(3, s)); }
            else if (kind == "rock_smash") { var r = t.GetProperty("rock_smash"); rate = WJ.Int(r, "rate"); foreach (var s in r.GetProperty("slots").EnumerateArray()) slots.Add(Slot3(3, s)); }
            else { var f = t.GetProperty("fishing"); rate = WJ.Int(f, "rate"); foreach (var s in f.GetProperty(kind).EnumerateArray()) slots.Add(Slot3(3, s)); }
        }
        else if (game.Family == "dppt")
        {
            if (kind == "grass")
            {
                if (!Has(t, "grass")) throw new ArgumentException("no land table");
                var g = t.GetProperty("grass");
                rate = WJ.Int(g, "rate");
                foreach (var s in g.GetProperty("slots").EnumerateArray()) { int lv = WJ.Int(s, "level"); slots.Add(new WizardSlot(SpeciesRec(4, WJ.Int(s, "species")), lv, lv, 0)); }
                string? replKey = time == "day" ? "day" : time == "night" ? "night" : null;
                if (replKey is not null && Has(t, replKey))
                {
                    var repl = t.GetProperty(replKey).EnumerateArray().ToList();
                    int[] si = { 2, 3 };
                    for (int j = 0; j < 2; j++)
                        if (j < repl.Count && Has(repl[j], "species")) slots[si[j]] = slots[si[j]] with { Species = SpeciesRec(4, WJ.Int(repl[j], "species")) };
                }
            }
            else { var k = t.GetProperty(kind); rate = WJ.Int(k, "rate"); foreach (var s in k.GetProperty("slots").EnumerateArray()) slots.Add(Slot3(4, s)); }
        }
        else
        {
            if (kind == "grass")
            {
                if (!Has(t, "land")) throw new ArgumentException("no land table");
                var land = t.GetProperty("land");
                rate = WJ.Int(land, "rate");
                string tm = time == "morning" || time == "night" ? time : "day";
                foreach (var s in land.GetProperty("slots").EnumerateArray()) { int lv = WJ.Int(s, "level"); slots.Add(new WizardSlot(SpeciesRec(4, WJ.Int(s.GetProperty(tm), "species")), lv, lv, 0)); }
            }
            else { var k = t.GetProperty(kind); rate = WJ.Int(k, "rate"); foreach (var s in k.GetProperty("slots").EnumerateArray()) slots.Add(Slot3(4, s)); }
        }
        bool tanoby = game.Gen == 3 && kind == "grass" && Has(t, "land") && Has(t.GetProperty("land"), "unown_letter_ids");
        return new WizardSlots(slots, rate, note, tanoby);
    }
    public static List<WizardSpeciesGroup> SpeciesInSlots(List<WizardSlot> slots)
    {
        var seen = new Dictionary<int, WizardSpeciesGroup>();
        var out_ = new List<WizardSpeciesGroup>();
        for (int i = 0; i < slots.Count; i++)
        {
            var s = slots[i];
            if (!seen.TryGetValue(s.Species.Dex, out var g)) { g = new WizardSpeciesGroup(s.Species, new(), new()); seen[s.Species.Dex] = g; out_.Add(g); }
            g.Slots.Add(i);
            g.Levels.Add(s.MinLevel == s.MaxLevel ? "" + s.MinLevel : s.MinLevel + "-" + s.MaxLevel);
        }
        return out_;
    }
    // The share of the slot roll that lands on the species (docs/DATA.md slot rates), for the feasibility estimate.
    static readonly int[] RatesGrass = { 20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1 }, RatesSurf = { 60, 30, 5, 4, 1 }, RatesRock3 = { 60, 30, 5, 4, 1 }, RatesRock4 = { 80, 20 };
    static readonly int[] RatesOld3 = { 70, 30 }, RatesGood3 = { 60, 20, 20 }, RatesSuper3 = { 40, 40, 15, 4, 1 };
    static readonly int[] RatesOldJ = { 60, 30, 5, 4, 1 }, RatesGoodJ = { 40, 40, 15, 4, 1 }, RatesSuperJ = { 40, 40, 15, 4, 1 }, RatesRodK = { 40, 30, 15, 10, 5 };
    static int[] SlotRates(string gameKey, string kind)
    {
        var game = Game(gameKey);
        if (kind == "grass") return RatesGrass;
        if (kind == "surf") return RatesSurf;
        if (kind == "rock_smash") return game.Gen == 3 ? RatesRock3 : RatesRock4;
        if (game.Gen == 3) return kind == "old_rod" ? RatesOld3 : kind == "good_rod" ? RatesGood3 : RatesSuper3;
        if (game.Family == "dppt") return kind == "old_rod" ? RatesOldJ : kind == "good_rod" ? RatesGoodJ : RatesSuperJ;
        return RatesRodK;
    }
    public static double SpeciesShare(string gameKey, string kind, List<WizardSlot> slots, int dex)
    {
        var rates = SlotRates(gameKey, kind);
        int sum = 0;
        for (int i = 0; i < slots.Count && i < rates.Length; i++) if (slots[i].Species.Dex == dex) sum += rates[i];
        return sum / 100.0;
    }

    // ---- leads -------------------------------------------------------------------------------
    static readonly List<WizardLeadOption> LeadsE = new()
    {
        new("", "no lead effect"),
        new("SYNCHRONIZE", "Synchronize (nature)"), new("CUTE_CHARM", "Cute Charm (gender)"),
        new("MAGNET_PULL", "Magnet Pull (Steel slots, land)"), new("STATIC", "Static (Electric slots, land and surf)"),
        new("PRESSURE", "Pressure / Hustle / Vital Spirit (level)"), new("KEEN_EYE", "Keen Eye / Intimidate (level suppression)")
    };
    static readonly List<WizardLeadOption> LeadsRs = new() { new("", "no lead effect (Ruby / Sapphire have none: pokeruby/src/wild_encounter.c:271-312)") };
    static readonly List<WizardLeadOption> LeadsFrlg = new() { new("", "no lead effect (FireRed / LeafGreen roll the nature directly: pokefirered/src/wild_encounter.c:226-240)") };
    static readonly List<WizardLeadOption> LeadsGen4Wild = new()
    {
        new("", "no lead effect"), new("SYNCHRONIZE", "Synchronize (nature)"),
        new("MAGNET_PULL", "Magnet Pull (Steel slots)"), new("STATIC", "Static (Electric slots)"),
        new("PRESSURE", "Pressure / Hustle / Vital Spirit (level)")
    };
    static readonly List<WizardLeadOption> LeadsGen4Static = new() { new("", "no lead effect"), new("SYNCHRONIZE", "Synchronize (nature)") };
    public static List<WizardLeadOption> LeadOptions(string gameKey, string kind)
    {
        var game = Game(gameKey);
        if (game.Gen == 3) return kind == "static" ? new List<WizardLeadOption> { LeadsRs[0] } : game.Family == "e" ? LeadsE : game.Family == "rs" ? LeadsRs : LeadsFrlg;
        return kind == "static" ? LeadsGen4Static : LeadsGen4Wild;
    }
    public static Lead? MakeLead(string key, int nature, string gender, int level)
    {
        if (string.IsNullOrEmpty(key)) return null;
        return new Lead(key, key == "SYNCHRONIZE" ? nature : 0, key == "CUTE_CHARM" ? (gender == "F" ? 'F' : 'M') : 'M', key == "KEEN_EYE" ? level : 0);
    }
    public static string LeadText(Lead lead) => LeadWord(lead.Ability ?? "");
    static string LeadWord(string ability) { int i = ability.IndexOf('_'); return (i < 0 ? ability : ability[..i] + " " + ability[(i + 1)..]).ToLowerInvariant(); }

    // ---- the filter ----------------------------------------------------------------------------
    public static WizardFilter BuildFilter(WizardWanted w)
    {
        var f = new WizardFilter();
        for (int i = 0; i < 6; i++)
        {
            int a = w.IvMin[i] ?? 0, b = w.IvMax[i] ?? 31;
            if (a < 0 || b > 31 || a > b) throw new ArgumentException(IvNames[i] + " IV range must be whole numbers 0..31 with min <= max, got " + a + ".." + b);
            f.IvMin[i] = a; f.IvMax[i] = b;
        }
        if (w.Nature is int n) f.Natures = new[] { n };
        if (w.Gender == "M" || w.Gender == "F") f.Gender = w.Gender;
        if (w.Ability == 0 || w.Ability == 1) f.Ability = w.Ability;
        if (w.Shiny)
        {
            if (w.Tid is null || w.Sid is null) throw new ArgumentException("a shiny target needs your Trainer ID and Secret ID typed (the Trainer Card, and the Secret ID from the Gen 1 TID tab's Emerald / FRLG branch or a known shiny)");
            f.Shiny = true;
        }
        if (w.Species is int sp) f.Species = new[] { sp };
        return f;
    }
    public static (long Count, List<int[]>? Combos) IvCombos(WizardFilter f, long cap)
    {
        long n = 1;
        for (int i = 0; i < 6; i++) n *= f.IvMax[i] - f.IvMin[i] + 1;
        if (n > cap) return (n, null);
        var combos = new List<int[]>();
        var cur = new int[6];
        void Rec(int i)
        {
            if (i == 6) { combos.Add((int[])cur.Clone()); return; }
            for (int v = f.IvMin[i]; v <= f.IvMax[i]; v++) { cur[i] = v; Rec(i + 1); }
        }
        Rec(0);
        return (n, combos);
    }
    static long WordCount(int[] mn, int[] mx, int[] keys)
    {
        long n = 0;
        for (int w = 0; w < 65536; w++)
        {
            int[] v = { w & 31, (w >> 5) & 31, (w >> 10) & 31 };
            bool ok = true;
            for (int i = 0; i < 3 && ok; i++) if (v[i] < mn[keys[i]] || v[i] > mx[keys[i]]) ok = false;
            if (ok) n++;
        }
        return n;
    }
    static bool PidPasses(uint pid, WizardFilter f, WizardSpecies species, uint tid, uint sid)
    {
        if (f.Natures is not null && Array.IndexOf(f.Natures, (int)(pid % 25)) < 0) return false;
        if (f.Gender is not null) { int g = f.Gender == "F" ? 1 : 0; if (Generators.GenderOf(pid, species.GenderRatio) != g) return false; }
        if (f.Ability is int a && (int)(pid & 1) != a) return false;
        if (f.Shiny && !Gen3.IsShiny(pid, tid, sid)) return false;
        return true;
    }

    // ---- feasibility (design 5.1 step 5) ----------------------------------------------------------
    // The IV part is the exact count of LCRNG states whose two IV words pass (Generators.CountIvStates, the 2^32
    // cycle) when the matching-word product is affordable, else the independent-uniform estimate; the nature,
    // gender, ability, shiny and slot shares multiply in as independent odds (an estimate: the PID and the IV
    // words are consecutive outputs, not independent draws).
    public static WizardFeasibility Feasibility(WizardFilter f, string method, WizardSpecies? species, double? share)
    {
        long a = WordCount(f.IvMin, f.IvMax, new[] { 0, 1, 2 });
        long b = WordCount(f.IvMin, f.IvMax, new[] { 5, 3, 4 });
        bool exact = a * b <= 4000000;
        double ivPer100k;
        if (exact) ivPer100k = Generators.CountIvStates(new GenFilter { IvMin = f.IvMin, IvMax = f.IvMax }, method).Per100k;
        else { double p = 1; for (int i = 0; i < 6; i++) p *= (f.IvMax[i] - f.IvMin[i] + 1) / 32.0; ivPer100k = p * 100000; }
        double odds = 1;
        var parts = new List<string>();
        if (f.Natures is not null) { odds *= f.Natures.Length / 25.0; parts.Add("nature 1/25"); }
        if (f.Gender is not null && species is not null)
        {
            double pf = species.GenderRatio == 255 ? 0 : species.GenderRatio == 254 ? 1 : species.GenderRatio == 0 ? 0 : species.GenderRatio / 256.0;
            double pg = f.Gender == "F" ? pf : 1 - pf;
            odds *= pg; parts.Add("gender " + Js.F1(100 * pg) + " %");
        }
        if (f.Ability is not null) { odds *= 0.5; parts.Add("ability 1/2"); }
        if (f.Shiny) { odds *= 8 / 65536.0; parts.Add("shiny 8/65536"); }
        if (share is double sh && sh != 1) { odds *= sh; parts.Add("slot share " + Js.F1(100 * sh) + " %"); }
        double per100k = ivPer100k * odds;
        return new WizardFeasibility
        {
            IvPer100k = ivPer100k, IvExact = exact, WordsA = a, WordsB = b, Odds = odds, Parts = parts, Per100k = per100k,
            ExpectedFrames = per100k > 0 ? 100000 / per100k : double.PositiveInfinity
        };
    }
    public static List<string> FeasibilityLines(WizardFeasibility fs, string? consoleKey)
    {
        var lines = new List<string>();
        lines.Add("Feasibility: about " + (fs.Per100k >= 100 ? Js.Num(Js.Round(fs.Per100k)) : Js.Precision(fs.Per100k, 3)) + " matching frames per 100,000 (" +
            (fs.IvExact ? "IV count exact over the 2^32 LCRNG cycle: " + Js.Precision(fs.IvPer100k, 4) + " per 100,000" : "IV part estimated as independent uniform draws: " + Js.Precision(fs.IvPer100k, 4) + " per 100,000") +
            (fs.Parts.Count > 0 ? "; x " + string.Join(" x ", fs.Parts) : "") + ").");
        if (!double.IsInfinity(fs.ExpectedFrames)) lines.Add("  Expected first hit near frame " + Js.Num(Js.Round(fs.ExpectedFrames)) + (consoleKey is not null ? " (" + Js.FmtLong(FrameToMs(fs.ExpectedFrames, consoleKey)) + " at " + Js.Fixed(FpsOf(consoleKey), 4) + " fps)" : "") + " on average.");
        else lines.Add("  No state can match: the filter is empty.");
        return lines;
    }

    // ---- Gen 3: the forward search from the fixed (or typed) seed ----------------------------------------
    static List<EncounterSlot> EngineSlots(WizardCfg cfg) => (cfg.Slots ?? throw new ArgumentException("pick an encounter table")).Select(s => s.ToEngine()).ToList();
    public static List<GenResult> Gen3Run(WizardCfg cfg, GenFilter f, long frameStart, int frameCount)
    {
        uint seed = cfg.Seed ?? throw new ArgumentException("no seed: " + ModelOf(cfg.Game).Text);
        uint tid = (uint)(cfg.Wanted.Tid ?? 0), sid = (uint)(cfg.Wanted.Sid ?? 0);
        if (cfg.Kind == "static")
            return Generators.Gen3Static(seed, (cfg.Species ?? throw new ArgumentException("pick a static / gift entry")).Info, cfg.Level, cfg.Method, cfg.BuggedRoamer, frameStart, frameCount, tid, sid, f);
        return Generators.Gen3Wild(seed, cfg.Game, cfg.Encounter, EngineSlots(cfg), cfg.Rate, cfg.Lead, new Gen3WildOptions { Tanoby = cfg.Tanoby }, cfg.Method, frameStart, frameCount, tid, sid, f);
    }
    public static WizardGen3Result SearchGen3(WizardCfg cfg)
    {
        var game = Game(cfg.Game);
        if (game.Gen != 3) throw new ArgumentException("searchGen3 is for Gen 3 games");
        if (cfg.Seed is null) throw new ArgumentException("no seed: " + ModelOf(cfg.Game).Text);
        var f = BuildFilter(cfg.Wanted);
        if (cfg.Kind == "static") f.Species = null;
        var gf = f.ToGenFilter();
        long maxFrame = Math.Max(0, cfg.MaxFrame);
        int limit = cfg.Limit > 0 ? cfg.Limit : 20;
        var hits = new List<GenResult>();
        const int chunk = 16384;
        for (long frame = 0; frame <= maxFrame && hits.Count < limit; frame += chunk)
        {
            int count = (int)Math.Min(chunk, maxFrame - frame + 1);
            var res = Gen3Run(cfg, gf, frame, count);
            for (int i = 0; i < res.Count && hits.Count < limit; i++) hits.Add(res[i]);
        }
        double? share = cfg.Kind == "wild" && cfg.Wanted.Species is int dex ? SpeciesShare(cfg.Game, cfg.Encounter, cfg.Slots!, dex) : 1;
        var species = cfg.Kind == "static" ? cfg.Species : (cfg.Wanted.Species is int d2 ? SpeciesRec(3, d2) : null);
        var fs = Feasibility(f, cfg.Method, species, share);
        var out_ = new WizardGen3Result { Hits = hits, MaxFrame = maxFrame, Limit = limit, Feasibility = fs, Model = ModelOf(cfg.Game).Id };
        // statics: the exact first frame of the IV part over the whole cycle when the matching word 1 set is small
        if (cfg.Kind == "static" && fs.WordsA <= 128 && !cfg.BuggedRoamer)
        {
            string method = cfg.Method.ToUpperInvariant();
            var states = Generators.ListIvStates(new GenFilter { IvMin = f.IvMin, IvMax = f.IvMax }, method, null, null);
            var ex = new WizardExactFirst { States = states.Count };
            uint tid = (uint)(cfg.Wanted.Tid ?? 0), sid = (uint)(cfg.Wanted.Sid ?? 0);
            foreach (uint s in states)
            {
                var p = Generators.PidForIvState(s, method);
                if (!PidPasses(p.Pid, f, cfg.Species!, tid, sid)) continue;
                long fr = Generators.FrameForIvState(cfg.Seed.Value, s, method);
                if (!ex.Found || fr < ex.Frame) { ex.Frame = fr; ex.Pid = p.Pid; ex.State = s; }
            }
            out_.ExactFirst = ex;
        }
        return out_;
    }
    public static List<string> Gen3SearchLines(WizardGen3Result r, WizardCfg cfg)
    {
        var lines = new List<string>();
        var model = ModelOf(cfg.Game);
        lines.Add("Seed model: " + model.Id + " (" + model.Status + "); seed " + Js.Hex8(cfg.Seed ?? 0) + ", frames counted from the seed at " + Js.Fixed(FpsOf(cfg.Console), 4) + " fps.");
        if (r.Hits.Count > 0)
            lines.Add(r.Hits.Count + (r.Hits.Count >= r.Limit ? " (the first " + r.Limit + ")" : "") + " matching frame" + (r.Hits.Count == 1 ? "" : "s") + " within the first " + r.MaxFrame + " frames (" + Js.FmtMs(FrameToMs(r.MaxFrame, cfg.Console)) + "); the first at frame " + r.Hits[0].Frame + " = " + Js.FmtMs(FrameToMs(r.Hits[0].Frame, cfg.Console)) + " after the seed.");
        else
            lines.Add("No matching frame within the first " + r.MaxFrame + " frames (" + Js.FmtMs(FrameToMs(r.MaxFrame, cfg.Console)) + "): the honest limit of this seed model is stated, not promised away.");
        lines.AddRange(FeasibilityLines(r.Feasibility, cfg.Console));
        if (r.ExactFirst is not null)
        {
            if (r.ExactFirst.Found)
            {
                long fr = r.ExactFirst.Frame;
                double ms = FrameToMs(fr, cfg.Console);
                lines.Add("  Exact over the whole cycle: " + r.ExactFirst.States + " IV state" + (r.ExactFirst.States == 1 ? "" : "s") + " pass the IV ranges; the first one that also passes the PID filter is frame " + fr + " from this seed = " + Js.FmtLong(ms) + " (PID " + Js.Hex8(r.ExactFirst.Pid) + ").");
            }
            else lines.Add("  Exact over the whole cycle: " + r.ExactFirst.States + " IV state" + (r.ExactFirst.States == 1 ? "" : "s") + " pass the IV ranges and none passes the PID filter: this combination never occurs from any seed.");
        }
        return lines;
    }

    // ---- Gen 4: reachability first (design 5.3), then the generator verifies every candidate ----------------
    public static List<GenResult> Gen4Run(uint seed, WizardCfg cfg, GenFilter f, long frameStart, int frameCount)
    {
        uint tid = (uint)(cfg.Wanted.Tid ?? 0), sid = (uint)(cfg.Wanted.Sid ?? 0);
        if (cfg.Kind == "static")
            return Generators.Gen4Static(seed, (cfg.Species ?? throw new ArgumentException("pick a static / gift entry")).Info, cfg.Level, cfg.StaticMethod, cfg.ShinyMode, cfg.Lead, frameStart, frameCount, tid, sid, f);
        return Generators.Gen4Wild(seed, cfg.Game, Game(cfg.Game).Method!, cfg.Encounter, EngineSlots(cfg), cfg.Rate, cfg.Lead, new Gen4WildOptions(), frameStart, frameCount, tid, sid, f);
    }
    public static WizardGen4Result SearchGen4(WizardCfg cfg)
    {
        var game = Game(cfg.Game);
        if (game.Gen != 4) throw new ArgumentException("searchGen4 is for Gen 4 games");
        var f = BuildFilter(cfg.Wanted);
        if (cfg.Kind == "static") f.Species = null;
        var gf = f.ToGenFilter();
        bool method1 = cfg.Kind == "static" && cfg.StaticMethod == "M1";
        long cap = method1 ? Gen4ComboCapM1 : Gen4ComboCapJK;
        var (count, combos) = IvCombos(f, cap);
        if (combos is null)
            return new WizardGen4Result { Error = "the IV ranges span " + count + " combinations; the Gen 4 search reverses each exact IV set to its seeds, so narrow the ranges to at most " + cap + " combinations" + (method1 ? "" : " (Method J / K creations are verified frame by frame)"), Count = count };
        long maxFrame = Math.Max(0, cfg.MaxFrame);
        var species = cfg.Kind == "static" ? cfg.Species : (cfg.Wanted.Species is int d2 ? SpeciesRec(4, d2) : null);
        uint tid = (uint)(cfg.Wanted.Tid ?? 0), sid = (uint)(cfg.Wanted.Sid ?? 0);
        string shinyMode = cfg.Kind == "static" ? cfg.ShinyMode : "random";
        bool prefilter = shinyMode == "random" && !(cfg.Lead is not null && cfg.Lead.Ability == "SYNCHRONIZE");
        var origins = new List<uint>();
        foreach (var ivs in combos)
        {
            foreach (uint s2 in SeedTime4.IvsToSeeds(ivs[0], ivs[1], ivs[2], ivs[3], ivs[4], ivs[5]))
            {
                if (prefilter && species is not null)
                {
                    uint pid = ((s2 >> 16) << 16) | (SeedTime4.Prev(s2) >> 16);
                    if (!PidPasses(pid, f, species, tid, sid)) continue;
                }
                origins.Add(s2);
            }
        }
        int callsBefore = shinyMode == "always" ? 15 : 2;
        int lookback = method1 ? 0 : Gen4WildLookback;
        var cands = SeedTime4.ReachableSeeds(origins, callsBefore, checked((int)(maxFrame + lookback)));
        var seen = new HashSet<(uint, long)>();
        var verified = new List<(uint Seed, long Frame, uint Origin, GenResult Mon)>();
        foreach (var c in cands)
        {
            long lo; long cnt;
            if (method1) { lo = c.Frame; cnt = 1; }
            else { lo = Math.Max(0, c.Frame - lookback); cnt = Math.Min(maxFrame, c.Frame) - lo + 1; }
            if (cnt <= 0) continue;
            foreach (var res in Gen4Run(c.Seed, cfg, gf, lo, (int)cnt))
            {
                if (res.Frame > maxFrame || !seen.Add((c.Seed, res.Frame))) continue;
                verified.Add((c.Seed, res.Frame, c.Origin, res));
            }
        }
        verified.Sort((a, b) => a.Frame != b.Frame ? a.Frame.CompareTo(b.Frame) : a.Seed.CompareTo(b.Seed));
        var rows = SeedTime4.SeedsToTimes(verified.Select(v => new Candidate4(v.Seed, (int)v.Frame, (int)((v.Seed >> 16) & 0xFF), (int)(v.Seed >> 24), (int)(v.Seed & 0xFFFF), v.Origin)),
            new WantedFilter
            {
                YearMin = cfg.YearMin, YearMax = cfg.YearMax, DelayMin = cfg.DelayMin, DelayMax = cfg.DelayMax, TargetDelay = cfg.TargetDelay,
                TimesPerCandidate = cfg.TimesPerCandidate > 0 ? cfg.TimesPerCandidate : 2, YearsPerCandidate = 1
            });
        var byKey = new Dictionary<(uint, long), GenResult>();
        foreach (var v in verified) byKey[(v.Seed, v.Frame)] = v.Mon;
        int limit = cfg.Limit > 0 ? cfg.Limit : 30;
        var out_ = new List<WizardGen4Row>();
        foreach (var row in rows)
        {
            if (out_.Count >= limit) break;
            out_.Add(new WizardGen4Row
            {
                Seed = row.Seed, Frame = row.Frame, Year = row.Year, Month = row.Month, Day = row.Day, Hour = row.Hour, Minute = row.Minute, Second = row.Second,
                Delay = row.Delay, DelayDistance = row.DelayDistance, Origin = row.Origin, Mon = byKey[(row.Seed, row.Frame)]
            });
        }
        double? share = cfg.Kind == "wild" && cfg.Wanted.Species is int dex ? SpeciesShare(cfg.Game, cfg.Encounter, cfg.Slots!, dex) : 1;
        return new WizardGen4Result
        {
            Rows = out_, Combos = count, Origins = origins.Count, Candidates = cands.Count, Verified = verified.Count, MaxFrame = maxFrame,
            Feasibility = Feasibility(f, "M1", species, share), Model = ModelOf(cfg.Game).Id
        };
    }
    public static List<string> Gen4SearchLines(WizardGen4Result r, WizardCfg cfg)
    {
        var lines = new List<string>();
        var model = ModelOf(cfg.Game);
        if (r.Error is not null) { lines.Add(r.Error); return lines; }
        lines.Add("Seed model: " + model.Id + " (" + model.Status + ").");
        lines.Add(r.Combos + " IV combination" + (r.Combos == 1 ? "" : "s") + " -> " + Js.Plural(r.Origins, "IV origin state") + " after the PID filter -> " + Js.Plural(r.Candidates, "seed") + " a clock can produce within " + r.MaxFrame + " frames (hour byte 0-23) -> " + Js.Plural(r.Verified, "candidate") + " confirmed by the " + (cfg.Kind == "static" ? "static" : "wild") + " generator frame by frame.");
        if (r.Rows.Count > 0) lines.Add(r.Rows.Count + " date / time / delay row" + (r.Rows.Count == 1 ? "" : "s") + " inside the delay and year windows, nearest the target delay first (the year is a delay knob: +1 year = -1 delay for the same seed).");
        else lines.Add("No row inside the delay and year windows: widen the delay window or the years, or raise the frame limit; the design's flawless case, 7B0448D1 -> frame 0, needs delay 18641 in 2000.");
        lines.AddRange(FeasibilityLines(r.Feasibility, null));
        lines.Add("  A reachable seed exists for about 9.4 % of back-steps (the hour byte), so the search is exact within its windows, not a promise that a low frame exists.");
        return lines;
    }

    // ---- the result card (design 5.1 step 5) -----------------------------------------------------
    public static string NatureName(int nature) => Gen3.Natures[nature];
    public static string GenderText(int gender) => gender == 2 ? "none" : gender == 1 ? "F" : "M";
    public static string AbilityName(WizardSpecies species, int slot)
    {
        var names = species.Abilities;
        if (slot < names.Length && names[slot].Length > 0) return names[slot];
        return names.Length > 0 && names[0].Length > 0 ? names[0] : "?";
    }
    public static List<string> CardLines(GenResult mon, int gen, WizardSpecies? species, int? tid, int? sid, uint seed, WizardSeedModel model, string? timeText)
    {
        species ??= SpeciesRec(gen, mon.Species);
        bool hasIds = tid is not null && sid is not null;
        var lines = new List<string>();
        lines.Add("Result card (" + NoHardware.Split(':')[0] + ")");
        lines.Add("  " + SpeciesName(species) + " L" + mon.Level + "  PID " + Js.Hex8(mon.Pid) + "  nature " + NatureName(mon.Nature) + "  gender " + GenderText(mon.Gender) + "  ability " + AbilityName(species, mon.AbilitySlot) + " (slot " + (mon.AbilitySlot + 1) + ")");
        lines.Add("  IVs " + IvText(mon.Ivs) + " (HP/Atk/Def/SpA/SpD/Spe)  Hidden Power " + Js.TitleCase(Generators.HiddenPowerTypes[mon.HiddenPower]) + " " + mon.HiddenPowerPower + "  stats at L" + mon.Level + " " + string.Join("/", mon.Stats));
        lines.Add("  shiny: " + (hasIds ? (mon.Shiny ? "YES for TID " + tid + " / SID " + sid : "no for TID " + tid + " / SID " + sid) : "unknown (type your Trainer ID and Secret ID to know)") + (mon.EncounterSlot >= 0 ? "  slot " + mon.EncounterSlot : ""));
        lines.Add("  frame " + mon.Frame + "  seed " + Js.Hex8(seed) + (string.IsNullOrEmpty(timeText) ? "" : "  " + timeText) + "  calls used " + mon.CallsUsed);
        lines.Add("  seed model " + model.Id + ": " + model.Status);
        return lines;
    }
    public static List<string> CardLines(GenResult mon, WizardCfg cfg, uint seed, string? timeText)
        => CardLines(mon, Game(cfg.Game).Gen, cfg.Kind == "static" ? cfg.Species : null, cfg.Wanted.Tid, cfg.Wanted.Sid, seed, ModelOf(cfg.Game), timeText);

    // ---- procedures (design 5.1 step 6), numbered, every step under the seed model id ---------------------
    public static List<string> Gen3Procedure(WizardCfg cfg, GenResult hit, Gen3Model timerModel)
    {
        var model = ModelOf(cfg.Game); var game = Game(cfg.Game);
        double ms = FrameToMs(hit.Frame, cfg.Console);
        var phases = Timers.Gen3Phases(Settings(cfg.Console), timerModel);
        var lines = new List<string>();
        uint seed = cfg.Seed ?? 0;
        lines.Add("Procedure (" + model.Id + "; " + NoHardware + ")");
        lines.Add("1. Prepare the save: " + (cfg.Kind == "static" ? "stand where the encounter starts (" + cfg.StaticLabel + ") and save; the last A that starts the battle or the gift is the timed press." : "stand on the " + KindNames[cfg.Encounter] + " tile of " + cfg.TableName + " and save; the timed press is the one that triggers the encounter (a step, a cast, a Rock Smash)" + (cfg.Lead is not null ? "; lead " + LeadText(cfg.Lead) : "") + "."));
        lines.Add("2. The seed: " + (model.Kind == "fixed" ? "power on (or A+B+Start+Select soft reset) and the game seeds " + Js.Hex8(seed) + " at frame 0 (" + model.Id + ")." : "the typed seed " + Js.Hex8(seed) + " must be the one in force (" + model.Id + ": " + model.Text + ")"));
        lines.Add("3. Take the same input path every time from power-on to the press (title, CONTINUE, the last dialogue): the frame count runs from the seed, so a constant path is absorbed by the calibration and a variable one is not.");
        lines.Add("4. Timer: phase 1 " + Js.FmtMs(phases[0]) + " (the pre-timer: power on at its end, the first long beep), phase 2 " + Js.FmtMs(phases[1]) + " = frame " + hit.Frame + " x " + Js.Fixed(1000 / FpsOf(cfg.Console), 4) + " ms " + (timerModel.Calibration >= 0 ? "+ " : "- ") + Js.Num(Math.Abs(timerModel.Calibration)) + " ms calibration: press A on the last beep. Target " + Js.FmtMs(ms) + " after the seed" + (game.Family == "e" && cfg.Kind == "static" ? " (Emerald in battle advances twice per frame: the count here is up to the press that starts it)" : "") + ".");
        lines.Add("5. Read what you got (nature and the six stats on the summary screen, or the IVs from a calculator) and type it below: the tool finds the frame you hit and moves the calibration by the difference (EonTimer's frame model, core/timers.js calibrateGen3).");
        lines.Add("6. Repeat until the frame hit equals the target; then the card above is what the game creates.");
        return lines;
    }
    public static List<string> Gen4Procedure(WizardCfg cfg, WizardGen4Row row, Gen4Model timerModel, AdvancePlan plan, long current, int partyCount)
    {
        var model = ModelOf(cfg.Game); var game = Game(cfg.Game);
        var settings = Settings(cfg.Console);
        var phases = Timers.Gen4Phases(settings, timerModel);
        double minutes = Timers.Gen4MinutesBefore(settings, timerModel);
        var lines = new List<string>();
        lines.Add("Procedure (" + model.Id + "; " + NoHardware + ")");
        lines.Add("1. Prepare the save: " + (cfg.Kind == "static" ? "in front of " + cfg.StaticLabel + ", the last A before the battle or the gift is the frame that matters." : "on the " + KindNames[cfg.Encounter] + " tile of " + cfg.TableName + (cfg.Lead is not null ? ", lead " + LeadText(cfg.Lead) : "") + ".") + " Save with the party you will advance with (" + Js.Plural(partyCount, "member") + ").");
        lines.Add("2. DS clock: set " + row.Year + "-" + Js.Two(row.Month) + "-" + Js.Two(row.Day) + " " + Js.Two(row.Hour) + ":" + Js.Two(row.Minute) + " and confirm it " + Js.Num(minutes) + " minute" + (minutes == 1 ? "" : "s") + " before the target minute (the countdown spans that long); target second " + row.Second + ", target delay " + row.Delay + " -> seed " + Js.Hex8(row.Seed) + " (" + model.Id + ").");
        lines.Add("3. Timer: start it as the clock confirms; phase 1 " + Js.FmtMs(phases[0]) + " ends on the first long beep: press A to load the game from the DS menu; phase 2 " + Js.FmtMs(phases[1]) + " ends on the last beep: press A on CONTINUE, the seed forms then (calibrated delay " + Js.Num(timerModel.CalibratedDelay) + ", calibrated second " + Js.Num(timerModel.CalibratedSecond) + "; EonTimer's delay model, core/timers.js).");
        lines.Add("4. Verify the seed: " + (game.Family == "dppt" ? "open the Poketch coin toss and flip it 10-20 times (the MT only: the LCRNG frame does not move), type the H/T string below" : "call Elm (each call is one LCRNG advance: count them) and type the E/K/P letters below, with the roamers active on the save") + ": the tool names the delay you hit and corrects the calibrated delay. Repeat until the hit is the target.");
        lines.Add("5. Advance to frame " + row.Frame + ": " + (plan.Needed <= 0 ? "no advance needed from frame " + current + "." : string.Join(", ", plan.Plan.Select(p => p.Uses + " x " + p.Tool + " (+" + p.PerUse + " each, " + p.Label + ")")) + (plan.Remainder != 0 ? " and " + plan.Remainder + " left that no listed tool covers" : "") + " from frame " + current + " (type where you are after loading: DPPt sits a few frames in, HGSS more with roamers).") + " Then trigger the encounter.");
        lines.Add("6. Read the nature and stats: the card above says what frame " + row.Frame + " of seed " + Js.Hex8(row.Seed) + " creates.");
        return lines;
    }
    public static string[] AdvanceToolsFor(string gameKey) => Game(gameKey).Family == "dppt" ? new[] { "walk128", "journal", "chatot" } : new[] { "walk128", "elmCall", "chatot" };

    // ---- the typed outcome: Gen 3 frame hit and Gen 4 delay hit ----------------------------------------
    // Gen 3: nature plus IVs (or the six stats at the level) typed after the attempt; the frames around the target are
    // generated again and the nearest match is the frame hit. The IV words alone can repeat within the window, which
    // is said; the nature (and the stats) usually settle it.
    public static WizardGen3Hit Gen3IdentifyHit(WizardCfg cfg, long target, int? nature, int[]? ivs, int?[]? stats, int window = 3000)
    {
        long lo = Math.Max(0, target - window);
        int count = (int)(target + window - lo + 1);
        var f = new GenFilter { ValidOnly = true };
        if (nature is int n) f.Natures = new[] { n };
        if (ivs is not null) { f.IvMin = ivs; f.IvMax = ivs; }
        if (cfg.Kind == "wild" && cfg.Wanted.Species is int sp) f.Species = new[] { sp };
        var res = Gen3Run(cfg, f, lo, count);
        if (stats is not null)
            res = res.Where(r => Enumerable.Range(0, 6).All(i => stats[i] is null || r.Stats[i] == stats[i])).ToList();
        if (res.Count == 0) return new WizardGen3Hit { Hit = null, Candidates = 0, Window = window };
        var best = res[0];
        foreach (var r in res) if (Math.Abs(r.Frame - target) < Math.Abs(best.Frame - target)) best = r;
        return new WizardGen3Hit { Hit = best, Candidates = res.Count, Window = window };
    }
    // Gen 4: the typed coin flips (DPPt) or Elm calls (HGSS) against the calibrate rows around the target.
    public static string NormaliseCalls(string text) => Regex.Replace((text ?? "").ToUpperInvariant(), "[^HTEKP]", "");
    public static WizardGen4Hit Gen4IdentifyHit(string gameKey, WizardGen4Row target, string typed, int delayRange, int secondRange, bool raikou = false, bool entei = false, bool lati = false, int elmWays = 3)
    {
        string fam = Game(gameKey).Family == "dppt" ? "DPPt" : "HGSS";
        var rows = SeedTime4.CalibrateRows(target.Seed, delayRange, secondRange, fam, new CalibrateOptions
        {
            Target = new SeedTimeRow(target.Year, target.Month, target.Day, target.Hour, target.Minute, target.Second, (uint)target.Delay, target.Delay, target.Seed),
            RoamerRaikou = raikou, RoamerEntei = entei, RoamerLati = lati, ElmWays = elmWays
        });
        string s = NormaliseCalls(typed);
        if (s.Length < 5) return new WizardGen4Hit { Error = "type at least 5 " + (fam == "DPPt" ? "coin flips (H / T)" : "Elm calls (E / K / P)") + "; " + s.Length + " given", Family = fam, Typed = s };
        var matches = rows.Where(r => (fam == "DPPt" ? r.Flips ?? "" : r.Calls ?? "").StartsWith(s, StringComparison.Ordinal))
            .OrderBy(r => Math.Abs(r.DelayOffset)).ThenBy(r => Math.Abs(r.SecondOffset)).ToList();
        return new WizardGen4Hit { Matches = matches, Rows = rows.Count, Typed = s, Family = fam };
    }

    // ---- the store: the timer calibration per game and console, per mode ----------------------------------
    // Every record carries the mode it was made in and each mode has its own setting key (AppMode.Scoped in the
    // panel; the web tab's shinySolution.wizard.calibration[.practice]); inside a store a record of another mode or
    // another seed model is left out of the value in force and named, so a practice-derived correction is never in
    // force in a run.
    public static string EntryKey(string gameKey, string consoleKey) => gameKey + "/" + consoleKey;
    public static WizardCalEntry EntryFor(Dictionary<string, WizardCalEntry> store, string gameKey, string consoleKey)
    {
        string k = EntryKey(gameKey, consoleKey);
        if (!store.TryGetValue(k, out var e)) { e = new WizardCalEntry(); store[k] = e; }
        return e;
    }
    public static WizardCalValue DefaultValue(string gameKey) => Game(gameKey).Gen == 3
        ? new WizardCalValue { Calibration = 0, PreTimer = 5000 }
        : new WizardCalValue { CalibratedDelay = Timers.DefaultGen4.CalibratedDelay, CalibratedSecond = Timers.DefaultGen4.CalibratedSecond };
    // The calibration in force: the last sample made in this mode under this seed model (EonTimer keeps a running
    // value; every sample records the value it was applied to, so the chain is auditable). Samples of another mode or
    // model are left out and named.
    public static WizardInForce InForce(Dictionary<string, WizardCalEntry> store, string gameKey, string consoleKey, string mode, string modelId)
    {
        var dflt = DefaultValue(gameKey);
        if (!store.TryGetValue(EntryKey(gameKey, consoleKey), out var e)) return new WizardInForce { Value = dflt };
        var (kept0, rest) = Modes.SplitByMode(e.Samples, s => s.Mode, mode);
        var kept = kept0.Where(s => s.Model == modelId).ToList();
        var ignored = rest.Concat(kept0.Where(s => s.Model != modelId)).ToList();
        var value = kept.Count > 0 ? kept[^1].After : dflt;
        return new WizardInForce { Value = value, Samples = kept, Ignored = ignored };
    }
    public static List<string> IgnoredLines(List<WizardCalSample> ignored, string mode, string modelId)
    {
        var lines = new List<string>();
        var modes = new List<string>(); var models = new List<string>();
        foreach (var s in ignored)
        {
            if (Modes.Effective(s.Mode) != mode) { var d = Modes.Describe(s.Mode); if (!modes.Contains(d)) modes.Add(d); }
            else { var m = string.IsNullOrEmpty(s.Model) ? "no seed model" : s.Model; if (!models.Contains(m)) models.Add(m); }
        }
        if (modes.Count > 0) lines.Add(Js.Plural(ignored.Count(s => Modes.Effective(s.Mode) != mode), "sample") + " recorded in " + string.Join(", ", modes) + " mode, not " + Modes.Label(mode) + ": left out, never in force here");
        if (models.Count > 0) lines.Add(Js.Plural(ignored.Count(s => Modes.Effective(s.Mode) == mode), "sample") + " recorded under " + string.Join(", ", models) + ", not " + modelId + ": left out");
        return lines;
    }
    public static WizardCalSample AddSample(Dictionary<string, WizardCalEntry> store, string gameKey, string consoleKey, WizardCalSample sample, string mode, string? when = null)
    {
        var e = EntryFor(store, gameKey, consoleKey);
        sample.Mode = Modes.Check(mode);
        sample.When ??= when ?? Gen1TidText.Now();
        e.Samples.Add(sample);
        return sample;
    }
    // (removed, kept): the samples under this seed model made in this mode go; the others stay untouched
    public static (int Removed, int Kept) ClearSamples(Dictionary<string, WizardCalEntry> store, string gameKey, string consoleKey, string mode, string modelId)
    {
        if (!store.TryGetValue(EntryKey(gameKey, consoleKey), out var e)) return (0, 0);
        var kept = e.Samples.Where(s => !(Modes.Effective(s.Mode) == mode && s.Model == modelId)).ToList();
        int removed = e.Samples.Count - kept.Count;
        e.Samples = kept;
        return (removed, kept.Count);
    }

    // ---- the typed outcome as the panel records it (the web tab's recordGen3 / recordGen4, line for line) ----------
    public sealed class OutcomeReport
    {
        public List<string> Lines = new();
        public WizardCalSample? Sample;
        public string? Refused;
    }
    public static OutcomeReport RecordGen3(Dictionary<string, WizardCalEntry> store, WizardCfg cfg, GenResult target, Gen3Model timerModel, int? nature, int[]? ivs, int?[]? stats, string mode, string? attempt, string? when = null)
    {
        var out_ = new OutcomeReport();
        string modelId = ModelOf(cfg.Game).Id;
        try
        {
            if (ivs is null && stats is null && nature is null) throw new ArgumentException("type the nature and the IVs (or the six stats) you got");
            var r = Gen3IdentifyHit(cfg, target.Frame, nature, ivs, stats, 3000);
            if (r.Hit is null) throw new ArgumentException("nothing within " + 3000 + " frames of the target matches what you typed: check the values, or the seed model is not in force (a different seed, a different input path)");
            var settings = Settings(cfg.Console);
            double before = timerModel.Calibration;
            var next = Timers.Gen3Calibrated(settings, timerModel, r.Hit.Frame);
            var sample = new WizardCalSample
            {
                Model = modelId, Target = target.Frame, Hit = r.Hit.Frame,
                Before = new WizardCalValue { Calibration = before, PreTimer = timerModel.PreTimer }, After = new WizardCalValue { Calibration = next.Calibration, PreTimer = next.PreTimer },
                Candidates = r.Candidates, Attempt = attempt ?? ""
            };
            AddSample(store, cfg.Game, cfg.Console, sample, mode, when);
            out_.Sample = sample;
            long d3 = r.Hit.Frame - target.Frame;
            out_.Lines.Add("You hit frame " + r.Hit.Frame + ", aimed " + target.Frame + ": " + (d3 == 0 ? "on the frame" : Math.Abs(d3) + " frame" + (Math.Abs(d3) == 1 ? "" : "s") + " " + (d3 > 0 ? "late" : "early") + " (" + Js.F1(FrameToMs(d3, cfg.Console)) + " ms)") + "; " + Js.Plural(r.Candidates, "candidate") + " matched within +-" + r.Window + " frames" + (r.Candidates > 1 ? ", the nearest taken: type the stats too to settle it" : "") + ".");
            out_.Lines.Add("Calibration " + Js.F1(before) + " ms -> " + Js.F1(next.Calibration) + " ms (core/timers.js calibrateGen3, frame delta x " + Js.Fixed(1000 / FpsOf(cfg.Console), 4) + " ms); recorded under " + modelId + " [" + Modes.Label(mode) + " mode].");
        }
        catch (ArgumentException e) { out_.Refused = e.Message; out_.Lines.Add("not recorded: " + e.Message); }
        return out_;
    }
    public static OutcomeReport RecordGen4(Dictionary<string, WizardCalEntry> store, WizardCfg cfg, WizardGen4Row target, Gen4Model timerModel, string typedCalls, int delayRange, int secondRange, bool raikou, bool entei, bool lati, string mode, string? attempt, string? when = null)
    {
        var out_ = new OutcomeReport();
        string modelId = ModelOf(cfg.Game).Id;
        try
        {
            int dr = Math.Min(2000, Math.Max(1, delayRange)), sr = Math.Min(30, Math.Max(0, secondRange));
            var r = Gen4IdentifyHit(cfg.Game, target, typedCalls, dr, sr, raikou, entei, lati, 3);
            if (r.Error is not null) throw new ArgumentException(r.Error);
            if (r.Matches.Count == 0) throw new ArgumentException("no delay within +-" + delayRange + " and second +-" + secondRange + " of the target produces " + r.Typed + " (" + r.Rows + " rows checked): widen the ranges, or the clock was set to another minute");
            var m = r.Matches[0];
            var settings = Settings(cfg.Console);
            double before = timerModel.CalibratedDelay;
            var next = Timers.Gen4Calibrated(settings, timerModel, m.Delay);
            var sample = new WizardCalSample
            {
                Model = modelId, Target = target.Delay, Hit = m.Delay, SecondOffset = m.SecondOffset, Typed = r.Typed,
                Before = new WizardCalValue { CalibratedDelay = before, CalibratedSecond = timerModel.CalibratedSecond }, After = new WizardCalValue { CalibratedDelay = next.CalibratedDelay, CalibratedSecond = next.CalibratedSecond },
                Candidates = r.Matches.Count, Attempt = attempt ?? ""
            };
            AddSample(store, cfg.Game, cfg.Console, sample, mode, when);
            out_.Sample = sample;
            long d4 = (long)m.Delay - target.Delay;
            out_.Lines.Add("You hit delay " + m.Delay + " (seed " + Js.Hex8(m.Seed) + ", second " + (m.SecondOffset >= 0 ? "+" : "") + m.SecondOffset + "), aimed " + target.Delay + ": " + (d4 == 0 && m.SecondOffset == 0 ? "on the target" : Math.Abs(d4) + " delay" + (Math.Abs(d4) == 1 ? "" : "s") + " " + (d4 > 0 ? "late" : "early") + " (" + Js.F1(Timers.ToMilliseconds(settings, Math.Abs(d4))) + " ms)") + "; " + Js.Plural(r.Matches.Count, "row") + " of " + r.Rows + " match " + r.Typed + (r.Matches.Count > 1 ? " (the nearest taken: type more flips / calls to settle it)" : "") + ".");
            out_.Lines.Add("Calibrated delay " + Js.Num(before) + " -> " + Js.Num(next.CalibratedDelay) + " (core/timers.js calibrateGen4: the delta x 0.75 within 167 ms, else x 1.0, rounded half to even); recorded under " + modelId + " [" + Modes.Label(mode) + " mode].");
            if (m.Delay == target.Delay && m.SecondOffset == 0) out_.Lines.Add("The seed is hit: advance to frame " + target.Frame + " with the plan in the procedure, then trigger the encounter.");
        }
        catch (ArgumentException e) { out_.Refused = e.Message; out_.Lines.Add("not recorded: " + e.Message); }
        return out_;
    }
    // the neighbouring delays at the target second (the web tab's calRows)
    public static List<string> CalRowLines(string gameKey, WizardGen4Row target, int delayRange, bool raikou, bool entei, bool lati)
    {
        var out_ = new List<string>();
        string fam = Game(gameKey).Family == "dppt" ? "DPPt" : "HGSS";
        var rows = SeedTime4.CalibrateRows(target.Seed, Math.Min(50, Math.Max(1, delayRange)), 0, fam, new CalibrateOptions
        {
            Target = new SeedTimeRow(target.Year, target.Month, target.Day, target.Hour, target.Minute, target.Second, (uint)target.Delay, target.Delay, target.Seed),
            RoamerRaikou = raikou, RoamerEntei = entei, RoamerLati = lati, ElmWays = 3
        });
        out_.Add("Neighbouring delays at the target second (seed, delay, " + (fam == "DPPt" ? "coin flips" : "Elm calls") + "; core/seedtime4.js calibrateRows):");
        foreach (var r in rows) out_.Add("  " + Js.Hex8(r.Seed) + "  delay " + r.Delay + (r.DelayOffset == 0 ? " <- target" : "") + "  " + (r.Sequence.Length > 40 ? r.Sequence[..40] : r.Sequence));
        return out_;
    }

    // ---- the setup text (the web tab's refreshSetup model box) ----------------------------------------------
    public static List<string> ModelLines(string gameKey, string consoleKey)
    {
        var model = ModelOf(gameKey);
        var lines = new List<string> { "Seed model: " + model.Id, "  " + model.Text };
        if (model.Typed is not null) lines.Add("  " + model.Typed);
        lines.Add("  Validation status: " + model.Status + ".");
        lines.Add("  Console rate: " + Js.Fixed(FpsOf(consoleKey), 4) + " fps (core/timers.js, EonTimer's constants); a frame is " + Js.Fixed(1000 / FpsOf(consoleKey), 4) + " ms.");
        lines.Add("  " + NoHardware);
        return lines;
    }
    public static string TimeText(WizardGen4Row row) => row.Year + "-" + Js.Two(row.Month) + "-" + Js.Two(row.Day) + " " + Js.Two(row.Hour) + ":" + Js.Two(row.Minute) + ":" + Js.Two(row.Second) + " delay " + row.Delay;
}
