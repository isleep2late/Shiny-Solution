// Shiny Solution - Gen 5 engine (Pokemon Black / White / Black 2 / White 2).
//
// Every algorithm and constant in this file is ported from PokeFinder by Admiral-Fish
// (GPL-3.0, https://github.com/Admiral-Fish/PokeFinder, commit 7adce35): Core/RNG/SHA1.cpp,
// Core/RNG/LCRNG64.hpp, Core/Gen5/Nazos.cpp, Core/Gen5/Keypresses.cpp,
// Core/Util/Utilities.cpp, Core/Gen5/Generators/IDGenerator5.cpp,
// Core/Gen5/Searchers/ProfileSearcher5.cpp and Core/Gen5/Searchers/IDSearcher5.cpp, and
// cross-read against Admiral-Fish's RNGWriteups (Gen 5/Initial Seeding.md, Initial Frame.md).
// Everything is EMPIRICAL: no Gen 5 decompilation exists. Citations per constant are in
// docs/FACTS.md ("Gen 5"). Where PokeFinder reads IVs from a precomputed cache
// (MTFast<8, true> / Profile5 ivCache) this port computes them from MT19937 (IvsFromSeed).
// The JS twin is core/gen5.js; tests/gen5-vectors.json holds the shared vectors.

namespace ShinySolution.Core;

public enum Gen5Game { Black, White, Black2, White2 }

public enum Gen5Language { English, French, German, Italian, Japanese, Korean, Spanish }

public enum Gen5DsType { DS, DSi, DS3 }

// Buttons.hpp:28-48 bit order.
[Flags]
public enum Gen5Buttons : ushort
{
    None = 0,
    R = 1 << 0, L = 1 << 1, X = 1 << 2, Y = 1 << 3, A = 1 << 4, B = 1 << 5,
    Select = 1 << 6, Start = 1 << 7, Right = 1 << 8, Left = 1 << 9, Up = 1 << 10, Down = 1 << 11,
    LR = L | R, SelectStart = Select | Start, UpDown = Up | Down, LeftRight = Left | Right,
    SoftReset = LR | SelectStart
}

// LCRNG64.hpp:270 (BWRNG) and :271 (BWRNGR, the inverse step).
public static class Lcrng64
{
    public const ulong Mult = 0x5D588B656C078965UL;
    public const ulong Add = 0x269EC3UL;
    public const ulong ReverseMult = 0xDEDCEDAE9638806DUL;
    public const ulong ReverseAdd = 0x9B1AE6E9A384E6F9UL;

    public static ulong Next(ulong s) => unchecked(s * Mult + Add);
    public static ulong Prev(ulong s) => unchecked(s * ReverseMult + ReverseAdd);
    public static ulong Jump(ulong s, ulong n) => JumpWith(s, n, Mult, Add);
    public static ulong JumpReverse(ulong s, ulong n) => JumpWith(s, n, ReverseMult, ReverseAdd);

    static ulong JumpWith(ulong s, ulong n, ulong a, ulong c)
    {
        unchecked
        {
            ulong r = s;
            while (n > 0)
            {
                if ((n & 1) == 1) r = a * r + c;
                c = a * c + c;
                a *= a;
                n >>= 1;
            }
            return r;
        }
    }

    // LCRNG64.hpp:248-251 and :261-264.
    public static uint High32(ulong s) => (uint)(s >> 32);
    public static ushort High16(ulong s) => (ushort)(s >> 48);
    public static uint Bounded(ulong s, uint max) => unchecked((uint)(((s >> 32) * max) >> 32));
}

public sealed class Gen5Rng
{
    public ulong State;
    public uint Count;

    public Gen5Rng(ulong seed, uint advances = 0)
    {
        State = Lcrng64.Jump(seed, advances);
    }

    public ulong Next()
    {
        State = Lcrng64.Next(State);
        Count++;
        return State;
    }

    public uint NextUInt() => Lcrng64.High32(Next());
    public uint NextUInt(uint max) => Lcrng64.Bounded(Next(), max);

    public ulong Advance(uint n)
    {
        for (uint i = 0; i < n; i++) Next();
        return State;
    }
}

public sealed record Gen5SeedInput(
    Gen5Game Game, Gen5Language Language, Gen5DsType DsType, ulong Mac, byte VFrame, byte GxStat,
    uint Timer0, byte VCount, int Year, int Month, int Day, int Hour, int Minute, int Second,
    uint Keypress, bool SoftReset = false);

public sealed record Gen5Profile(
    Gen5Game Game, Gen5Language Language, Gen5DsType DsType, ulong Mac, byte VFrame, byte GxStat, byte VCount,
    ushort Timer0Min, ushort Timer0Max, bool[] Keypresses, bool SkipLR = false, bool SoftReset = false);

public sealed record Gen5ProfileRange(
    Gen5Game Game, Gen5Language Language, Gen5DsType DsType, ulong Mac, Gen5Buttons Buttons,
    int Year, int Month, int Day, int Hour, int Minute, int MinSecond, int MaxSecond,
    int MinVCount, int MaxVCount, int MinTimer0, int MaxTimer0, int MinGxStat, int MaxGxStat,
    int MinVFrame, int MaxVFrame, bool SoftReset = false);

public sealed record Gen5IdRow(uint Advances, ushort Tid, ushort Sid, ushort Tsv);

public sealed record Gen5ProfileHit(ulong Seed, ushort Timer0, byte VCount, byte VFrame, byte GxStat, byte Second);

public sealed record Gen5TidHit(
    int Year, int Month, int Day, int Hour, int Minute, int Second, ulong Seed, Gen5Buttons Buttons,
    uint Keypress, ushort Timer0, uint Advances, uint NoCount, ushort Tid, ushort Sid, ushort Tsv);

public static class Gen5
{
    public static bool IsBW(Gen5Game game) => game == Gen5Game.Black || game == Gen5Game.White;

    // Nazos.cpp:56-117, verbatim: one base address for BW, [nazo, nazo0, nazo1] for BW2;
    // DSi and 3DS share the DSi row. The Korean Black 2 DSi base equals the Korean White 2
    // DS base in PokeFinder's table; ported as found.
    static readonly Dictionary<(Gen5Language, Gen5Game, bool), uint[]> NazoBase = new()
    {
        [(Gen5Language.English, Gen5Game.Black, false)] = [0x022160b0],
        [(Gen5Language.English, Gen5Game.White, false)] = [0x022160d0],
        [(Gen5Language.English, Gen5Game.Black, true)] = [0x02760190],
        [(Gen5Language.English, Gen5Game.White, true)] = [0x027601b0],
        [(Gen5Language.English, Gen5Game.Black2, false)] = [0x02200010, 0x0209aee8, 0x02039de9],
        [(Gen5Language.English, Gen5Game.White2, false)] = [0x02200050, 0x0209af28, 0x02039e15],
        [(Gen5Language.English, Gen5Game.Black2, true)] = [0x027a5f70, 0x0209aee8, 0x02039de9],
        [(Gen5Language.English, Gen5Game.White2, true)] = [0x027a5e90, 0x0209af28, 0x02039e15],

        [(Gen5Language.Japanese, Gen5Game.Black, false)] = [0x02215f10],
        [(Gen5Language.Japanese, Gen5Game.White, false)] = [0x02215f30],
        [(Gen5Language.Japanese, Gen5Game.Black, true)] = [0x02761150],
        [(Gen5Language.Japanese, Gen5Game.White, true)] = [0x02761150],
        [(Gen5Language.Japanese, Gen5Game.Black2, false)] = [0x021ff9b0, 0x0209a8dc, 0x02039ac9],
        [(Gen5Language.Japanese, Gen5Game.White2, false)] = [0x021ff9d0, 0x0209a8fc, 0x02039af5],
        [(Gen5Language.Japanese, Gen5Game.Black2, true)] = [0x027aa730, 0x0209a8dc, 0x02039ac9],
        [(Gen5Language.Japanese, Gen5Game.White2, true)] = [0x027aa5f0, 0x0209a8fc, 0x02039af5],

        [(Gen5Language.German, Gen5Game.Black, false)] = [0x02215ff0],
        [(Gen5Language.German, Gen5Game.White, false)] = [0x02216010],
        [(Gen5Language.German, Gen5Game.Black, true)] = [0x027602f0],
        [(Gen5Language.German, Gen5Game.White, true)] = [0x027602f0],
        [(Gen5Language.German, Gen5Game.Black2, false)] = [0x021fff50, 0x0209ae28, 0x02039d69],
        [(Gen5Language.German, Gen5Game.White2, false)] = [0x021fff70, 0x0209ae48, 0x02039d95],
        [(Gen5Language.German, Gen5Game.Black2, true)] = [0x027a6110, 0x0209ae28, 0x02039d69],
        [(Gen5Language.German, Gen5Game.White2, true)] = [0x027a6010, 0x0209ae48, 0x02039d95],

        [(Gen5Language.Spanish, Gen5Game.Black, false)] = [0x02216070],
        [(Gen5Language.Spanish, Gen5Game.White, false)] = [0x02216070],
        [(Gen5Language.Spanish, Gen5Game.Black, true)] = [0x027601f0],
        [(Gen5Language.Spanish, Gen5Game.White, true)] = [0x027601f0],
        [(Gen5Language.Spanish, Gen5Game.Black2, false)] = [0x021fffd0, 0x0209aea8, 0x02039db9],
        [(Gen5Language.Spanish, Gen5Game.White2, false)] = [0x021ffff0, 0x0209aec8, 0x02039de5],
        [(Gen5Language.Spanish, Gen5Game.Black2, true)] = [0x027a6070, 0x0209aea8, 0x02039db9],
        [(Gen5Language.Spanish, Gen5Game.White2, true)] = [0x027a5fb0, 0x0209aec8, 0x02039de5],

        [(Gen5Language.French, Gen5Game.Black, false)] = [0x02216030],
        [(Gen5Language.French, Gen5Game.White, false)] = [0x02216050],
        [(Gen5Language.French, Gen5Game.Black, true)] = [0x02760230],
        [(Gen5Language.French, Gen5Game.White, true)] = [0x02760250],
        [(Gen5Language.French, Gen5Game.Black2, false)] = [0x02200030, 0x0209af08, 0x02039df9],
        [(Gen5Language.French, Gen5Game.White2, false)] = [0x02200050, 0x0209af28, 0x02039e25],
        [(Gen5Language.French, Gen5Game.Black2, true)] = [0x027a5f90, 0x0209af08, 0x02039df9],
        [(Gen5Language.French, Gen5Game.White2, true)] = [0x027a5ef0, 0x0209af28, 0x02039e25],

        [(Gen5Language.Italian, Gen5Game.Black, false)] = [0x02215fb0],
        [(Gen5Language.Italian, Gen5Game.White, false)] = [0x02215fd0],
        [(Gen5Language.Italian, Gen5Game.Black, true)] = [0x027601d0],
        [(Gen5Language.Italian, Gen5Game.White, true)] = [0x027601d0],
        [(Gen5Language.Italian, Gen5Game.Black2, false)] = [0x021fff10, 0x0209ade8, 0x02039d69],
        [(Gen5Language.Italian, Gen5Game.White2, false)] = [0x021fff50, 0x0209ae28, 0x02039d95],
        [(Gen5Language.Italian, Gen5Game.Black2, true)] = [0x027a5f70, 0x0209ade8, 0x02039d69],
        [(Gen5Language.Italian, Gen5Game.White2, true)] = [0x027a5ed0, 0x0209ae28, 0x02039d95],

        [(Gen5Language.Korean, Gen5Game.Black, false)] = [0x022167b0],
        [(Gen5Language.Korean, Gen5Game.White, false)] = [0x022167b0],
        [(Gen5Language.Korean, Gen5Game.Black, true)] = [0x02761150],
        [(Gen5Language.Korean, Gen5Game.White, true)] = [0x02761150],
        [(Gen5Language.Korean, Gen5Game.Black2, false)] = [0x02200750, 0x0209b60c, 0x0203a4d5],
        [(Gen5Language.Korean, Gen5Game.White2, false)] = [0x02200770, 0x0209b62c, 0x0203a501],
        [(Gen5Language.Korean, Gen5Game.Black2, true)] = [0x02200770, 0x0209b60c, 0x0203a4d5],
        [(Gen5Language.Korean, Gen5Game.White2, true)] = [0x027a57b0, 0x0209b62c, 0x0203a501],
    };

    public static uint Bswap32(uint v) => ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >> 8) & 0xff00) | (v >> 24);

    public static uint[] Nazo(Gen5Game game, Gen5Language language, Gen5DsType dsType)
    {
        var b = NazoBase[(language, game, dsType != Gen5DsType.DS)];
        uint n = b[0];
        unchecked
        {
            if (b.Length == 1)
            {
                // Nazos.cpp:29-36.
                uint o1 = n + 0xfc, o2 = n + 0xfc + 0x4c;
                return [Bswap32(n), Bswap32(o1), Bswap32(o1), Bswap32(o2), Bswap32(o2)];
            }
            // Nazos.cpp:43-50.
            uint o = n + 0x54;
            return [Bswap32(b[1]), Bswap32(b[2]), Bswap32(n), Bswap32(o), Bswap32(o)];
        }
    }

    // Keypresses.cpp:103-115.
    static readonly uint[] KeypressValues =
    [
        0x10000, 0x20000, 0x40000, 0x80000, 0x1000000, 0x2000000,
        0x4000000, 0x8000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000
    ];
    public const uint KeypressBase = 0xff2f0000;

    public static uint KeypressValue(Gen5Buttons buttons)
    {
        uint value = KeypressBase;
        ushort bits = (ushort)buttons;
        unchecked
        {
            for (int i = 0; i < 12; i++)
            {
                if ((bits & (1 << i)) != 0) value -= KeypressValues[i];
            }
        }
        return value;
    }

    // Keypresses.cpp:35-56.
    public static bool KeypressValid(Gen5Buttons b, bool skipLR)
    {
        if (skipLR && (b & Gen5Buttons.LR) != Gen5Buttons.None) return false;
        if ((b & Gen5Buttons.UpDown) == Gen5Buttons.UpDown) return false;
        if ((b & Gen5Buttons.LeftRight) == Gen5Buttons.LeftRight) return false;
        if ((b & Gen5Buttons.SoftReset) == Gen5Buttons.SoftReset) return false;
        return true;
    }

    // Keypresses.cpp:83-98: enabledCounts[k] enables combinations of exactly k held buttons.
    public static List<(Gen5Buttons Buttons, uint Value)> KeypressCombos(bool[]? enabledCounts, bool skipLR)
    {
        bool[] counts = enabledCounts ?? [true, false, false, false, false, false, false, false, false];
        var list = new List<(Gen5Buttons, uint)>();
        for (int bits = 0; bits < 0x1000; bits++)
        {
            int c = System.Numerics.BitOperations.PopCount((uint)bits);
            var combo = (Gen5Buttons)bits;
            if (c <= 8 && counts[c] && KeypressValid(combo, skipLR)) list.Add((combo, KeypressValue(combo)));
        }
        return list;
    }

    static readonly string[] ButtonNames = ["R", "L", "X", "Y", "A", "B", "Select", "Start", "Right", "Left", "Up", "Down"];

    public static string ButtonText(Gen5Buttons b)
    {
        var names = new List<string>();
        for (int i = 0; i < 12; i++) if (((ushort)b & (1 << i)) != 0) names.Add(ButtonNames[i]);
        return names.Count == 0 ? "None" : string.Join("+", names);
    }

    public static Gen5Buttons ParseButtons(string text)
    {
        ushort mask = 0;
        foreach (var raw in text.Split(['+', ',', ' '], StringSplitOptions.RemoveEmptyEntries))
        {
            if (raw.Equals("None", StringComparison.OrdinalIgnoreCase)) continue;
            int idx = Array.FindIndex(ButtonNames, n => n.Equals(raw, StringComparison.OrdinalIgnoreCase));
            if (idx < 0) throw new ArgumentException($"unknown button {raw}");
            mask |= (ushort)(1 << idx);
        }
        return (Gen5Buttons)mask;
    }

    // SHA1.cpp:50-53.
    public static uint Bcd(int v) => (uint)(((v / 10) << 4) + (v % 10));

    // DateTime.cpp:66-72 and :88-91 (weekday = (jd + 1) % 7, Sunday = 0).
    public static int JulianDay(int year, int month, int day)
    {
        int a = month < 3 ? 1 : 0;
        int y = year + 4800 - a;
        int m = month + 12 * a - 3;
        return day + (153 * m + 2) / 5 - 32045 + 365 * y + y / 4 - y / 100 + y / 400;
    }

    // DateTime.cpp:98-113.
    public static (int Year, int Month, int Day) DateFromJulianDay(int jd)
    {
        int a = jd + 32044;
        int b = (4 * a + 3) / 146097;
        int c = a - (146097 * b) / 4;
        int d = (4 * c + 3) / 1461;
        int e = c - (1461 * d) / 4;
        int m = (5 * e + 2) / 153;
        return (100 * b + d - 4800 + m / 10, m + 3 - 12 * (m / 10), e - (153 * m + 2) / 5 + 1);
    }

    public static int DayOfWeek(int year, int month, int day) => (JulianDay(year, month, day) + 1) % 7;

    // SHA1.cpp:64-93.
    public static uint DateWord(int year, int month, int day)
        => (Bcd(year % 100) << 24) | (Bcd(month) << 16) | (Bcd(day) << 8) | (uint)DayOfWeek(year, month, day);

    // SHA1.cpp:95-120 and :356-363: the PM bit 0x40000000 for hour >= 12, never on a 3DS.
    public static uint TimeWord(int hour, int minute, int second, Gen5DsType dsType)
    {
        uint w = (Bcd(hour) << 24) | (Bcd(minute) << 16) | (Bcd(second) << 8);
        if (hour >= 12 && dsType != Gen5DsType.DS3) w |= 0x40000000;
        return w;
    }

    // SHA1.cpp:178-192 and :336-363; RNGWriteups "Overall". SoftReset is the writeup's
    // 0x01000000 XOR on word 6, absent from PokeFinder.
    public static uint[] Message(Gen5SeedInput p)
    {
        var w = new uint[16];
        var n = Nazo(p.Game, p.Language, p.DsType);
        Array.Copy(n, w, 5);
        unchecked
        {
            w[5] = Bswap32(((uint)p.VCount << 16) | p.Timer0);
            w[6] = (uint)(p.Mac & 0xffff) ^ (p.SoftReset ? 0x01000000u : 0u);
            w[7] = (uint)(p.Mac >> 16) ^ ((uint)p.VFrame << 24) ^ p.GxStat;
        }
        w[8] = DateWord(p.Year, p.Month, p.Day);
        w[9] = TimeWord(p.Hour, p.Minute, p.Second, p.DsType);
        w[10] = 0;
        w[11] = 0;
        w[12] = p.Keypress;
        w[13] = 0x80000000;
        w[14] = 0;
        w[15] = 0x1a0;
        return w;
    }

    static uint Rotl(uint x, int n) => (x << n) | (x >> (32 - n));

    // One SHA-1 compression of a single block (SHA1.cpp:122-168, :304-311).
    public static uint[] Sha1(uint[] words)
    {
        var w = new uint[80];
        Array.Copy(words, w, 16);
        for (int i = 16; i < 80; i++) w[i] = Rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        uint a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, e = 0xc3d2e1f0;
        unchecked
        {
            for (int i = 0; i < 80; i++)
            {
                uint f, k;
                if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
                else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
                else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
                else { f = b ^ c ^ d; k = 0xca62c1d6; }
                uint t = Rotl(a, 5) + f + e + k + w[i];
                e = d; d = c; c = Rotl(b, 30); b = a; a = t;
            }
            return [0x67452301 + a, 0xefcdab89 + b, 0x98badcfe + c, 0x10325476 + d, 0xc3d2e1f0 + e];
        }
    }

    // SHA1.cpp:298-301.
    public static ulong Sha1Seed(uint[] words)
    {
        var h = Sha1(words);
        return ((ulong)Bswap32(h[1]) << 32) | Bswap32(h[0]);
    }

    // SHA1.cpp:302: the seed the game runs from is the digest value stepped once.
    public static ulong InitialSeed(Gen5SeedInput p) => Lcrng64.Next(Sha1Seed(Message(p)));

    // Utilities.cpp:29-70.
    public static uint AdvanceProbabilityTable(Gen5Rng rng)
    {
        uint start = rng.Count;
        rng.Next();
        if (rng.NextUInt(101) > 50) rng.Next();
        if (rng.NextUInt(101) > 30) rng.Next();
        if (rng.NextUInt(101) > 25)
        {
            if (rng.NextUInt(101) > 30) rng.Next();
        }
        if (rng.NextUInt(101) > 20)
        {
            if (rng.NextUInt(101) > 25)
            {
                if (rng.NextUInt(101) > 33) rng.Next();
            }
        }
        return rng.Count - start;
    }

    // Utilities.cpp:283-294.
    public static uint InitialAdvancesBW(ulong seed)
    {
        var rng = new Gen5Rng(seed);
        uint count = 0;
        for (int i = 0; i < 5; i++) count += AdvanceProbabilityTable(rng);
        return count;
    }

    // Utilities.cpp:296-328.
    public static uint InitialAdvancesBW2(ulong seed, bool memoryLink)
    {
        var rng = new Gen5Rng(seed);
        uint count = 0;
        for (int i = 0; i < 5; i++)
        {
            count += AdvanceProbabilityTable(rng);
            if (i == 0)
            {
                uint k = memoryLink ? 2u : 3u;
                count += k;
                rng.Advance(k);
            }
        }
        for (int limit = 0; limit < 100; limit++)
        {
            count += 3;
            uint r1 = rng.NextUInt(15), r2 = rng.NextUInt(15), r3 = rng.NextUInt(15);
            if (r1 != r2 && r1 != r3 && r2 != r3) break;
        }
        return count;
    }

    // Utilities.cpp:330-343.
    public static uint InitialAdvancesBWID(ulong seed)
    {
        var rng = new Gen5Rng(seed);
        uint count = 2;
        for (int i = 0; i < 3; i++) count += AdvanceProbabilityTable(rng);
        return count;
    }

    // Utilities.cpp:345-372.
    public static uint InitialAdvancesBW2ID(ulong seed)
    {
        var rng = new Gen5Rng(seed);
        uint count = 10;
        for (int i = 0; i < 3; i++)
        {
            count += AdvanceProbabilityTable(rng);
            if (i == 0) rng.Advance(2);
            else if (i == 1) rng.Advance(4);
        }
        return count;
    }

    // Utilities.cpp:374-384 and :271-281.
    public static uint InitialAdvancesID(ulong seed, Gen5Game game) => IsBW(game) ? InitialAdvancesBWID(seed) : InitialAdvancesBW2ID(seed);
    public static uint InitialAdvances(ulong seed, Gen5Game game, bool memoryLink) => IsBW(game) ? InitialAdvancesBW(seed) : InitialAdvancesBW2(seed, memoryLink);

    // IDGenerator5.cpp:34-58 without the filter.
    public static List<Gen5IdRow> IdRows(ulong seed, Gen5Game game, uint extraAdvances, uint maxAdvances)
    {
        uint baseAdv = InitialAdvancesID(seed, game);
        var rng = new Gen5Rng(seed, baseAdv + extraAdvances);
        var rows = new List<Gen5IdRow>();
        for (uint cnt = 0; cnt <= maxAdvances; cnt++)
        {
            uint rand = rng.NextUInt(0xffffffff);
            ushort tid = (ushort)(rand & 0xffff);
            ushort sid = (ushort)(rand >> 16);
            rows.Add(new Gen5IdRow(baseAdv + extraAdvances + cnt, tid, sid, (ushort)((tid ^ sid) >> 3)));
        }
        return rows;
    }

    // The row offset noCount is the design doc's count of "No" answers to Juniper (EMPIRICAL,
    // community guides; PokeFinder exposes it only as a table row).
    public static Gen5IdRow TidSid(ulong seed, Gen5Game game, uint noCount = 0) => IdRows(seed, game, noCount, 0)[0];

    // ProfileSearcher5.cpp:171,177-186 + MTFast.hpp; StaticGenerator5.cpp:29-31,67-88.
    // MT19937 on the high 32 bits of the seed, skip 2 outputs on BW2, six outputs >> 27 in
    // HP, Atk, Def, SpA, SpD, Spe order. Computed directly instead of PokeFinder's IV cache.
    public static byte[] IvsFromSeed(ulong seed, Gen5Game game)
    {
        var mt = new Mt19937(Lcrng64.High32(seed));
        int skip = IsBW(game) ? 0 : 2;
        for (int i = 0; i < skip; i++) mt.Next();
        var ivs = new byte[6];
        for (int i = 0; i < 6; i++) ivs[i] = (byte)(mt.Next() >> 27);
        return ivs;
    }

    // ProfileSearcher5.cpp:205-229.
    public static byte[] NeedlesFromSeed(ulong seed, Gen5Game game, int count, bool unovaLink, bool memoryLink)
    {
        uint advances = InitialAdvances(seed, game, memoryLink);
        if (unovaLink && !memoryLink) advances++;
        var rng = new Gen5Rng(seed, advances);
        var outp = new byte[count];
        for (int i = 0; i < count; i++)
        {
            outp[i] = (byte)rng.NextUInt(8);
            if (unovaLink) rng.Next();
        }
        return outp;
    }

    // ProfileSearcher5.cpp:121-160 (single thread): VFrame -> GxStat -> Timer0 -> VCount -> second.
    public static List<Gen5ProfileHit> ProfileSearch(Gen5ProfileRange p, Func<ulong, bool> valid)
    {
        var results = new List<Gen5ProfileHit>();
        uint keypress = KeypressValue(p.Buttons);
        for (int vframe = p.MinVFrame; vframe <= p.MaxVFrame; vframe++)
        {
            for (int gxstat = p.MinGxStat; gxstat <= p.MaxGxStat; gxstat++)
            {
                for (int timer0 = p.MinTimer0; timer0 <= p.MaxTimer0; timer0++)
                {
                    for (int vcount = p.MinVCount; vcount <= p.MaxVCount; vcount++)
                    {
                        for (int second = p.MinSecond; second <= p.MaxSecond; second++)
                        {
                            ulong seed = InitialSeed(new Gen5SeedInput(p.Game, p.Language, p.DsType, p.Mac, (byte)vframe, (byte)gxstat,
                                (uint)timer0, (byte)vcount, p.Year, p.Month, p.Day, p.Hour, p.Minute, second, keypress, p.SoftReset));
                            if (valid(seed)) results.Add(new Gen5ProfileHit(seed, (ushort)timer0, (byte)vcount, (byte)vframe, (byte)gxstat, (byte)second));
                        }
                    }
                }
            }
        }
        return results;
    }

    public static List<Gen5ProfileHit> ProfileSearchIvs(Gen5ProfileRange p, byte[] minIvs, byte[] maxIvs)
        => ProfileSearch(p, seed =>
        {
            var ivs = IvsFromSeed(seed, p.Game);
            for (int i = 0; i < 6; i++) if (ivs[i] < minIvs[i] || ivs[i] > maxIvs[i]) return false;
            return true;
        });

    public static List<Gen5ProfileHit> ProfileSearchNeedles(Gen5ProfileRange p, byte[] needles, bool unovaLink, bool memoryLink)
        => ProfileSearch(p, seed =>
        {
            var got = NeedlesFromSeed(seed, p.Game, needles.Length, unovaLink, memoryLink);
            for (int i = 0; i < needles.Length; i++) if (got[i] != needles[i]) return false;
            return true;
        });

    public static List<Gen5ProfileHit> ProfileSearchSeed(Gen5ProfileRange p, ulong target)
        => ProfileSearch(p, seed => seed == target);

    // IDSearcher5.cpp:63-90: Timer0 -> keypress combination -> second, rows filtered by TID/SID.
    public static List<Gen5TidHit> SearchTid(Gen5Profile profile, int year, int month, int day, int hour, int minute,
        int minSecond, int maxSecond, ushort? targetTid, ushort? targetSid, uint maxAdvances, int limit = 0)
    {
        var combos = KeypressCombos(profile.Keypresses, profile.SkipLR);
        var hits = new List<Gen5TidHit>();
        for (int timer0 = profile.Timer0Min; timer0 <= profile.Timer0Max; timer0++)
        {
            foreach (var (buttons, value) in combos)
            {
                for (int second = minSecond; second <= maxSecond; second++)
                {
                    ulong seed = InitialSeed(new Gen5SeedInput(profile.Game, profile.Language, profile.DsType, profile.Mac, profile.VFrame,
                        profile.GxStat, (uint)timer0, profile.VCount, year, month, day, hour, minute, second, value, profile.SoftReset));
                    var rows = IdRows(seed, profile.Game, 0, maxAdvances);
                    for (int r = 0; r < rows.Count; r++)
                    {
                        var row = rows[r];
                        if (targetTid.HasValue && row.Tid != targetTid.Value) continue;
                        if (targetSid.HasValue && row.Sid != targetSid.Value) continue;
                        hits.Add(new Gen5TidHit(year, month, day, hour, minute, second, seed, buttons, value, (ushort)timer0,
                            row.Advances, (uint)r, row.Tid, row.Sid, row.Tsv));
                        if (limit > 0 && hits.Count >= limit) return hits;
                    }
                }
            }
        }
        return hits;
    }

    public static List<Gen5TidHit> SearchTidDates(Gen5Profile profile, int startJd, int endJd, int hour, int minute,
        int minSecond, int maxSecond, ushort? targetTid, ushort? targetSid, uint maxAdvances, int limit = 0)
    {
        var hits = new List<Gen5TidHit>();
        for (int jd = startJd; jd <= endJd; jd++)
        {
            var (y, m, d) = DateFromJulianDay(jd);
            hits.AddRange(SearchTid(profile, y, m, d, hour, minute, minSecond, maxSecond, targetTid, targetSid, maxAdvances,
                limit > 0 ? limit - hits.Count : 0));
            if (limit > 0 && hits.Count >= limit) break;
        }
        return hits;
    }
}
