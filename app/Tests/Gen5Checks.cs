// Gen 5 checks for the C# engine: `--gen5 <vectors.json>` verifies app/Core/Gen5.cs against
// tests/gen5-vectors.json (PokeFinder's own vectors, the RNGWriteups worked seed and the
// Python oracles; see tests/build-gen5-vectors.py), and `--emit-gen5-random <out.json>`
// writes 200 deterministic random inputs with the C# results so tests/test-gen5.cjs can
// prove the JS port equal bit for bit.
using System.Text.Json;
using ShinySolution.Core;

namespace ShinySolution.Tests;

public static class Gen5Checks
{
    static int failures;
    static int checks;

    static void Check<T>(string label, T actual, T expected)
    {
        checks++;
        var a = JsonSerializer.Serialize(actual);
        var e = JsonSerializer.Serialize(expected);
        if (a != e)
        {
            failures++;
            Console.Error.WriteLine($"FAIL {label}\n  expected {e}\n  actual   {a}");
        }
    }

    static ulong ParseU64(string s) => s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? Convert.ToUInt64(s[2..], 16) : ulong.Parse(s);
    static ulong U64(JsonElement e) => e.ValueKind == JsonValueKind.String ? ParseU64(e.GetString()!) : e.GetUInt64();
    static uint U32(JsonElement e) => (uint)U64(e);
    static int I(JsonElement e, string name) => e.GetProperty(name).GetInt32();
    static string S(JsonElement e, string name) => e.GetProperty(name).GetString()!;
    static bool Bo(JsonElement e, string name) => e.GetProperty(name).GetBoolean();
    static int[] Ints(JsonElement e) => e.EnumerateArray().Select(x => x.GetInt32()).ToArray();
    static bool[] Bools(JsonElement e) => e.EnumerateArray().Select(x => x.GetBoolean()).ToArray();

    public static Gen5Game ParseGame(string s) => s.ToLowerInvariant() switch
    {
        "black" => Gen5Game.Black, "white" => Gen5Game.White, "black2" => Gen5Game.Black2, "white2" => Gen5Game.White2,
        _ => throw new ArgumentException($"unknown game {s}")
    };
    public static Gen5Language ParseLanguage(string s) => Enum.Parse<Gen5Language>(s, true);
    public static Gen5DsType ParseDs(string s) => s.ToLowerInvariant() switch
    {
        "ds" => Gen5DsType.DS, "dsi" => Gen5DsType.DSi, "3ds" or "ds3" => Gen5DsType.DS3,
        _ => throw new ArgumentException($"unknown DS type {s}")
    };
    static string GameName(Gen5Game g) => g.ToString().ToLowerInvariant();
    static string DsName(Gen5DsType t) => t switch { Gen5DsType.DS => "ds", Gen5DsType.DSi => "dsi", _ => "3ds" };

    static Gen5ProfileRange Range(JsonElement c) => new(
        ParseGame(S(c, "game")), ParseLanguage(S(c, "language")), ParseDs(S(c, "dsType")), U64(c.GetProperty("mac")),
        (Gen5Buttons)I(c, "buttons"), I(c, "year"), I(c, "month"), I(c, "day"), I(c, "hour"), I(c, "minute"),
        I(c, "minSecond"), I(c, "maxSecond"), I(c, "minVCount"), I(c, "maxVCount"), I(c, "minTimer0"), I(c, "maxTimer0"),
        I(c, "minGxStat"), I(c, "maxGxStat"), I(c, "minVFrame"), I(c, "maxVFrame"),
        c.TryGetProperty("softReset", out var sr) && sr.GetBoolean());

    static object[] RowShape(Gen5IdRow r) => [r.Advances, r.Tid, r.Sid, r.Tsv];
    static object[] RowShape(JsonElement r) => [(uint)I(r, "advances"), (ushort)I(r, "tid"), (ushort)I(r, "sid"), (ushort)I(r, "tsv")];
    static object[] HitShape(Gen5ProfileHit h) => [h.Seed.ToString(), h.Timer0, h.VCount, h.VFrame, h.GxStat, h.Second];

    static ulong RecomputeHit(Gen5ProfileRange p, Gen5ProfileHit h) => Gen5.InitialSeed(new Gen5SeedInput(p.Game, p.Language, p.DsType, p.Mac,
        h.VFrame, h.GxStat, h.Timer0, h.VCount, p.Year, p.Month, p.Day, p.Hour, p.Minute, h.Second, Gen5.KeypressValue(p.Buttons), p.SoftReset));

    public static int Run(string vectorsPath)
    {
        failures = 0;
        checks = 0;
        var v = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;

        var l = v.GetProperty("lcrng64");
        foreach (var c in l.GetProperty("next").EnumerateArray())
        {
            ulong seed = U64(c.GetProperty("seed"));
            Check($"lcrng64 next {S(c, "name")}", Lcrng64.Next(seed), U64(c.GetProperty("forward")));
            Check($"lcrng64 prev {S(c, "name")}", Lcrng64.Prev(seed), U64(c.GetProperty("reverse")));
        }
        foreach (var c in l.GetProperty("advance").EnumerateArray())
        {
            ulong seed = U64(c.GetProperty("seed"));
            uint n = (uint)I(c, "advances");
            Check($"lcrng64 advance {S(c, "name")}", Lcrng64.Jump(seed, n), U64(c.GetProperty("forward")));
            ulong s = seed;
            for (uint i = 0; i < n; i++) s = Lcrng64.Next(s);
            Check($"lcrng64 advance by steps {S(c, "name")}", s, U64(c.GetProperty("forward")));
            Check($"lcrng64 reverse advance {S(c, "name")}", Lcrng64.JumpReverse(seed, n), U64(c.GetProperty("reverse")));
        }
        foreach (var c in l.GetProperty("jump").EnumerateArray())
        {
            ulong seed = U64(c.GetProperty("seed"));
            ulong n = c.GetProperty("advances").GetUInt64();
            Check($"lcrng64 jump {S(c, "name")}", Lcrng64.Jump(seed, n), U64(c.GetProperty("forward")));
            Check($"lcrng64 reverse jump {S(c, "name")}", Lcrng64.JumpReverse(seed, n), U64(c.GetProperty("reverse")));
        }

        foreach (var c in v.GetProperty("nazoWords").EnumerateArray())
        {
            Check($"nazo {S(c, "language")} {S(c, "game")} {S(c, "dsType")}",
                Gen5.Nazo(ParseGame(S(c, "game")), ParseLanguage(S(c, "language")), ParseDs(S(c, "dsType"))),
                c.GetProperty("words").EnumerateArray().Select(U32).ToArray());
        }

        foreach (var c in v.GetProperty("keypress").EnumerateArray())
        {
            var mask = (Gen5Buttons)I(c, "mask");
            Check($"keypress value {S(c, "buttons")}", Gen5.KeypressValue(mask), U32(c.GetProperty("value")));
            Check($"keypress parse {S(c, "buttons")}", Gen5.ParseButtons(S(c, "buttons")), mask);
            Check($"keypress names {S(c, "buttons")}", Gen5.ButtonText(mask), S(c, "buttons"));
        }
        {
            var all = Gen5.KeypressCombos([true, true, true, true, true, true, true, true, true], false);
            Check("keypress combos: none first", (all[0].Buttons, all[0].Value), (Gen5Buttons.None, Gen5.KeypressBase));
            Check("keypress combos: Up+Down excluded", all.Any(k => (k.Buttons & Gen5Buttons.UpDown) == Gen5Buttons.UpDown), false);
            Check("keypress combos: Left+Right excluded", all.Any(k => (k.Buttons & Gen5Buttons.LeftRight) == Gen5Buttons.LeftRight), false);
            Check("keypress combos: soft reset excluded", all.Any(k => (k.Buttons & Gen5Buttons.SoftReset) == Gen5Buttons.SoftReset), false);
            Check("keypress combos: skipLR drops L and R", Gen5.KeypressCombos([true, true, false, false, false, false, false, false, false], true).Count, 11);
        }

        foreach (var c in v.GetProperty("dateWords").EnumerateArray())
            Check($"dateWord {I(c, "year")}-{I(c, "month")}-{I(c, "day")}", Gen5.DateWord(I(c, "year"), I(c, "month"), I(c, "day")), U32(c.GetProperty("word")));
        foreach (var c in v.GetProperty("timeWords").EnumerateArray())
            Check($"timeWord {I(c, "hour")}:{I(c, "minute")}:{I(c, "second")} {S(c, "dsType")}",
                Gen5.TimeWord(I(c, "hour"), I(c, "minute"), I(c, "second"), ParseDs(S(c, "dsType"))), U32(c.GetProperty("word")));
        Check("julianDay 2000-01-01", Gen5.JulianDay(2000, 1, 1), 2451545);
        Check("dateFromJulianDay roundtrip", Gen5.DateFromJulianDay(Gen5.JulianDay(2024, 2, 29)), (2024, 2, 29));

        foreach (var c in v.GetProperty("sha1").EnumerateArray())
        {
            var combos = Gen5.KeypressCombos(Bools(c.GetProperty("keypressCounts")), Bo(c, "skipLR"));
            Check($"sha1 {S(c, "name")} first combo is None", (int)combos[0].Buttons, I(c, "buttons"));
            var input = new Gen5SeedInput(ParseGame(S(c, "game")), ParseLanguage(S(c, "language")), ParseDs(S(c, "dsType")), U64(c.GetProperty("mac")),
                (byte)I(c, "vframe"), (byte)I(c, "gxstat"), (uint)I(c, "timer0"), (byte)I(c, "vcount"), I(c, "year"), I(c, "month"), I(c, "day"),
                I(c, "hour"), I(c, "minute"), I(c, "second"), combos[0].Value);
            Check($"sha1 {S(c, "name")}", Gen5.InitialSeed(input), U64(c.GetProperty("seed")));
        }

        {
            var w = v.GetProperty("writeup");
            var i = w.GetProperty("input");
            var input = new Gen5SeedInput(ParseGame(S(i, "game")), ParseLanguage(S(i, "language")), ParseDs(S(i, "dsType")), U64(i.GetProperty("mac")),
                (byte)I(i, "vframe"), (byte)I(i, "gxstat"), (uint)I(i, "timer0"), (byte)I(i, "vcount"), I(i, "year"), I(i, "month"), I(i, "day"),
                I(i, "hour"), I(i, "minute"), I(i, "second"), Gen5.KeypressValue((Gen5Buttons)I(i, "buttons")), Bo(i, "softReset"));
            var words = Gen5.Message(input);
            Check("writeup message words", words, w.GetProperty("message").EnumerateArray().Select(U32).ToArray());
            var h = Gen5.Sha1(words);
            Check("writeup h0", h[0], U32(w.GetProperty("h0")));
            Check("writeup h1", h[1], U32(w.GetProperty("h1")));
            Check("writeup raw seed", Gen5.Sha1Seed(words), U64(w.GetProperty("rawSeed")));
            Check("writeup initial seed", Gen5.InitialSeed(input), U64(w.GetProperty("seed")));
            Check("writeup soft reset flips word 6", Gen5.Message(input with { SoftReset = true })[6], words[6] ^ 0x01000000u);
        }

        foreach (var c in v.GetProperty("ids").EnumerateArray())
        {
            ulong seed = U64(c.GetProperty("seed"));
            var game = ParseGame(S(c, "game"));
            var rows = c.GetProperty("rows").EnumerateArray().ToArray();
            Check($"ids {S(c, "name")}", Gen5.IdRows(seed, game, (uint)I(c, "initialAdvances"), (uint)I(c, "maxAdvances")).Select(RowShape).ToArray(),
                rows.Select(RowShape).ToArray());
            Check($"ids {S(c, "name")} tidSid(no=0)", RowShape(Gen5.TidSid(seed, game, 0)), RowShape(rows[0]));
            Check($"ids {S(c, "name")} tidSid(no=3)", RowShape(Gen5.TidSid(seed, game, 3)), RowShape(rows[3]));
        }

        foreach (var c in v.GetProperty("profileIvs").EnumerateArray())
        {
            var p = Range(c);
            var min = Ints(c.GetProperty("minIvs")).Select(x => (byte)x).ToArray();
            var max = Ints(c.GetProperty("maxIvs")).Select(x => (byte)x).ToArray();
            var r = Gen5.ProfileSearchIvs(p, min, max);
            Check($"profile ivs {S(c, "name")} count", r.Count, 1);
            if (r.Count == 1)
            {
                Check($"profile ivs {S(c, "name")} seed", r[0].Seed, U64(c.GetProperty("result")));
                Check($"profile ivs {S(c, "name")} ivsFromSeed", Gen5.IvsFromSeed(U64(c.GetProperty("result")), p.Game), min);
                Check($"profile ivs {S(c, "name")} hit recomputes", RecomputeHit(p, r[0]), r[0].Seed);
            }
        }
        foreach (var c in v.GetProperty("profileNeedles").EnumerateArray())
        {
            var p = Range(c);
            var needles = Ints(c.GetProperty("needles")).Select(x => (byte)x).ToArray();
            var r = Gen5.ProfileSearchNeedles(p, needles, Bo(c, "unovaLink"), Bo(c, "memoryLink"));
            Check($"profile needles {S(c, "name")} count", r.Count, 1);
            if (r.Count == 1)
            {
                Check($"profile needles {S(c, "name")} seed", r[0].Seed, U64(c.GetProperty("result")));
                Check($"profile needles {S(c, "name")} needlesFromSeed",
                    Gen5.NeedlesFromSeed(U64(c.GetProperty("result")), p.Game, needles.Length, Bo(c, "unovaLink"), Bo(c, "memoryLink")), needles);
                Check($"profile needles {S(c, "name")} hit recomputes", RecomputeHit(p, r[0]), r[0].Seed);
            }
        }
        foreach (var c in v.GetProperty("profileSeed").EnumerateArray())
        {
            var r = Gen5.ProfileSearchSeed(Range(c), U64(c.GetProperty("seed")));
            Check($"profile seed {S(c, "name")} count", r.Count, 1);
            if (r.Count == 1) Check($"profile seed {S(c, "name")}", r[0].Seed, U64(c.GetProperty("result")));
        }

        if (failures > 0)
        {
            Console.Error.WriteLine($"{failures} failure(s) in {checks} gen5 checks");
            return 1;
        }
        Console.WriteLine($"all C# gen5 vector checks passed ({checks} checks)");
        return 0;
    }

    // xorshift64* with a fixed seed: the same inputs every run, so the emitted file is stable.
    sealed class Rand
    {
        ulong s = 0x9E3779B97F4A7C15UL;
        public ulong Next()
        {
            unchecked
            {
                s ^= s >> 12; s ^= s << 25; s ^= s >> 27;
                return s * 0x2545F4914F6CDD1DUL;
            }
        }
        public int Int(int n) => (int)(Next() % (ulong)n);
        public bool Bool() => (Next() & 1) == 1;
    }

    static object Hit(Gen5TidHit h) => new
    {
        year = h.Year, month = h.Month, day = h.Day, hour = h.Hour, minute = h.Minute, second = h.Second, seed = h.Seed.ToString(),
        buttons = (int)h.Buttons, keypress = h.Keypress, timer0 = h.Timer0, advances = h.Advances, noCount = h.NoCount, tid = h.Tid, sid = h.Sid, tsv = h.Tsv
    };

    static object Profile(Gen5Profile p) => new
    {
        game = GameName(p.Game), language = p.Language.ToString().ToLowerInvariant(), dsType = DsName(p.DsType), mac = p.Mac,
        vframe = p.VFrame, gxstat = p.GxStat, vcount = p.VCount, timer0Min = p.Timer0Min, timer0Max = p.Timer0Max,
        keypresses = p.Keypresses, skipLR = p.SkipLR, softReset = p.SoftReset
    };

    static object RangeObject(Gen5ProfileRange p) => new
    {
        game = GameName(p.Game), language = p.Language.ToString().ToLowerInvariant(), dsType = DsName(p.DsType), mac = p.Mac,
        buttons = (int)p.Buttons, year = p.Year, month = p.Month, day = p.Day, hour = p.Hour, minute = p.Minute,
        minSecond = p.MinSecond, maxSecond = p.MaxSecond, minVCount = p.MinVCount, maxVCount = p.MaxVCount, minTimer0 = p.MinTimer0,
        maxTimer0 = p.MaxTimer0, minGxStat = p.MinGxStat, maxGxStat = p.MaxGxStat, minVFrame = p.MinVFrame, maxVFrame = p.MaxVFrame,
        softReset = p.SoftReset
    };

    public static void EmitRandom(string outPath)
    {
        var rnd = new Rand();
        var cases = new List<object>();
        for (int n = 0; n < 200; n++)
        {
            var game = (Gen5Game)rnd.Int(4);
            var language = (Gen5Language)rnd.Int(7);
            var ds = (Gen5DsType)rnd.Int(3);
            ulong mac = rnd.Next() & 0xffffffffffffUL;
            byte vframe = (byte)rnd.Int(256), gxstat = (byte)rnd.Int(256), vcount = (byte)rnd.Int(256);
            uint timer0 = (uint)rnd.Int(0x10000);
            int year = 2000 + rnd.Int(100), month = 1 + rnd.Int(12), day = 1 + rnd.Int(28);
            int hour = rnd.Int(24), minute = rnd.Int(60), second = rnd.Int(60);
            var buttons = (Gen5Buttons)rnd.Int(0x1000);
            bool skipLR = rnd.Bool(), softReset = rnd.Bool(), unova = rnd.Bool(), memory = rnd.Bool();
            uint keypress = Gen5.KeypressValue(buttons);
            var input = new Gen5SeedInput(game, language, ds, mac, vframe, gxstat, timer0, vcount, year, month, day, hour, minute, second, keypress, softReset);
            var words = Gen5.Message(input);
            ulong seed = Gen5.InitialSeed(input);
            uint jumpN = (uint)rnd.Next();
            uint boundedMax = (uint)rnd.Next() | 1;
            uint idExtra = (uint)rnd.Int(5);
            cases.Add(new
            {
                input = new
                {
                    game = GameName(game), language = language.ToString().ToLowerInvariant(), dsType = DsName(ds), mac, vframe, gxstat, timer0, vcount,
                    year, month, day, hour, minute, second, buttons = (int)buttons, skipLR, softReset
                },
                keypressValid = Gen5.KeypressValid(buttons, skipLR),
                keypress,
                nazo = Gen5.Nazo(game, language, ds),
                dateWord = Gen5.DateWord(year, month, day),
                timeWord = Gen5.TimeWord(hour, minute, second, ds),
                message = words,
                seed = seed.ToString(),
                rawSeed = Gen5.Sha1Seed(words).ToString(),
                prev = Lcrng64.Prev(seed).ToString(),
                jumpN,
                jumped = Lcrng64.Jump(seed, jumpN).ToString(),
                high32 = Lcrng64.High32(seed),
                boundedMax,
                bounded = Lcrng64.Bounded(seed, boundedMax),
                advancesBW = Gen5.InitialAdvancesBW(seed),
                advancesBW2 = Gen5.InitialAdvancesBW2(seed, false),
                advancesBW2Memory = Gen5.InitialAdvancesBW2(seed, true),
                advancesBWID = Gen5.InitialAdvancesBWID(seed),
                advancesBW2ID = Gen5.InitialAdvancesBW2ID(seed),
                idExtra,
                idRows = Gen5.IdRows(seed, game, idExtra, 2).Select(r => new { advances = r.Advances, tid = r.Tid, sid = r.Sid, tsv = r.Tsv }).ToArray(),
                ivs = Gen5.IvsFromSeed(seed, game).Select(x => (int)x).ToArray(),
                unovaLink = unova,
                memoryLink = memory,
                needles = Gen5.NeedlesFromSeed(seed, game, 4, unova, memory).Select(x => (int)x).ToArray()
            });
        }

        var tidSearches = new List<object>();
        bool[][] keypressSets =
        [
            [true, false, false, false, false, false, false, false, false],
            [true, true, false, false, false, false, false, false, false],
            [false, false, true, false, false, false, false, false, false]
        ];
        for (int n = 0; n < 3; n++)
        {
            var game = (Gen5Game)n;
            var profile = new Gen5Profile(game, (Gen5Language)rnd.Int(7), (Gen5DsType)rnd.Int(3), rnd.Next() & 0xffffffffffffUL, 5, 6, (byte)rnd.Int(256),
                (ushort)(0x600 + rnd.Int(0x200)), 0, keypressSets[n], n == 2, false);
            profile = profile with { Timer0Max = (ushort)(profile.Timer0Min + 2) };
            int year = 2000 + rnd.Int(100), month = 1 + rnd.Int(12), day = 1 + rnd.Int(28), hour = rnd.Int(24), minute = rnd.Int(60);
            var combos = Gen5.KeypressCombos(profile.Keypresses, profile.SkipLR);
            var pick = combos[rnd.Int(combos.Count)];
            ulong seed = Gen5.InitialSeed(new Gen5SeedInput(profile.Game, profile.Language, profile.DsType, profile.Mac, profile.VFrame, profile.GxStat,
                (uint)(profile.Timer0Min + 1), profile.VCount, year, month, day, hour, minute, 17, pick.Value, false));
            var row = Gen5.IdRows(seed, game, 0, 5)[2];
            ushort? targetSid = n == 1 ? row.Sid : null;
            var hits = Gen5.SearchTid(profile, year, month, day, hour, minute, 0, 59, row.Tid, targetSid, 5, 0);
            tidSearches.Add(new
            {
                name = $"{GameName(game)} {combos.Count} combos", profile = Profile(profile), year, month, day, hour, minute, minSecond = 0, maxSecond = 59,
                targetTid = row.Tid, targetSid, maxAdvances = 5, limit = 0, hits = hits.Select(Hit).ToArray()
            });
        }

        var profileSearches = new List<object>();
        for (int n = 0; n < 2; n++)
        {
            var game = n == 0 ? Gen5Game.White : Gen5Game.White2;
            int timer0 = 0x600 + rnd.Int(0x200), vcount = 40 + rnd.Int(40);
            var range = new Gen5ProfileRange(game, (Gen5Language)rnd.Int(7), (Gen5DsType)rnd.Int(3), rnd.Next() & 0xffffffffffffUL,
                (Gen5Buttons)(n == 0 ? 0 : 16), 2000 + rnd.Int(100), 1 + rnd.Int(12), 1 + rnd.Int(28), rnd.Int(24), rnd.Int(60), 0, 59,
                vcount - 1, vcount + 1, timer0 - 2, timer0 + 2, 6, 6, 5, 6);
            ulong seed = Gen5.InitialSeed(new Gen5SeedInput(range.Game, range.Language, range.DsType, range.Mac, 5, 6, (uint)timer0, (byte)vcount,
                range.Year, range.Month, range.Day, range.Hour, range.Minute, 33, Gen5.KeypressValue(range.Buttons), false));
            var ivs = Gen5.IvsFromSeed(seed, game);
            var hits = Gen5.ProfileSearchIvs(range, ivs, ivs);
            profileSearches.Add(new
            {
                name = GameName(game), range = RangeObject(range), minIvs = ivs.Select(x => (int)x).ToArray(), maxIvs = ivs.Select(x => (int)x).ToArray(),
                hits = hits.Select(h => new { seed = h.Seed.ToString(), timer0 = h.Timer0, vcount = h.VCount, vframe = h.VFrame, gxstat = h.GxStat, second = h.Second }).ToArray()
            });
        }

        File.WriteAllText(outPath, JsonSerializer.Serialize(new { cases, tidSearches, profileSearches }));
        Console.WriteLine($"gen5 random cross-check inputs written to {outPath} ({cases.Count} cases, {tidSearches.Count} TID searches, {profileSearches.Count} profile searches)");
    }
}
