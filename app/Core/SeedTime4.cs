using System.Text;

namespace ShinySolution.Core;

// Gen 4 seed-to-time and LCRNG reversal: the C# twin of core/seedtime4.js (same functions, same
// ordering, same return semantics). Citations live in the JS file and docs/FACTS.md ("Gen 4 seed-to-time
// and reversal"); the short forms here name the same lines.
//   seed = ((month*day + minute + second) << 24) + (hour << 16) + (year - 2000) + delay
//   (pokeplatinum/src/main.c:306-315; pokeheartgold/src/main.c:281-284 + include/gf_rtc.h:46-51)
public sealed record SeedTimeRow(int Year, int Month, int Day, int Hour, int Minute, int Second, uint Delay, int DelaySigned, uint Seed);

public sealed record RoamerInfo(int Raikou, int Entei, int Lati, int Skips, string RouteString);

public sealed record CalibrateRow(int Year, int Month, int Day, int Hour, int Minute, int Second, uint Delay,
    int SecondOffset, int DelayOffset, uint Seed, string Sequence, string? Flips, string? Calls, RoamerInfo? Roamer);

public sealed class CalibrateOptions
{
    public SeedTimeRow? Target { get; set; }
    public int Year { get; set; } = 2000;
    public int? ForceSecond { get; set; }
    public bool RoamerRaikou { get; set; }
    public bool RoamerEntei { get; set; }
    public bool RoamerLati { get; set; }
    public int RouteRaikou { get; set; }
    public int RouteEntei { get; set; }
    public int RouteLati { get; set; }
    public int ElmWays { get; set; } = 3;
}

public sealed record AdvanceToolCost(int PerUse, bool PerPartyMon, string Label, string What, string Cite);
public sealed record AdvanceStep(string Tool, long Uses, int PerUse, long Advances, string Label, string Cite);
public sealed record AdvancePlan(long Needed, List<AdvanceStep> Plan, long Remainder, string? Note);

public sealed record Ivs4(int Hp, int Atk, int Def, int Spa, int Spd, int Spe);
public sealed record Mon4(uint Pid, int Nature, string NatureName, Ivs4 Ivs);
public sealed record Candidate4(uint Seed, int Frame, int Hour, int Ab, int Efgh, uint Origin);
public sealed record TimeCandidate4(uint Seed, int Frame, int Year, int Month, int Day, int Hour, int Minute, int Second,
    int Delay, int DelayDistance, uint Origin)
{
    public uint Pid { get; set; }
    public int Nature { get; set; }
    public string NatureName { get; set; } = "";
    public Ivs4? Ivs { get; set; }
    public bool? Shiny { get; set; }
}
public sealed record TidHit4(uint Seed, int Delay, int Tid, int Sid, int Tsv);
public sealed record ChatotPitch(int Value, string Band);

public sealed class WantedFilter
{
    public Ivs4? Ivs { get; set; }
    public uint? Pid { get; set; }
    public int? Tid { get; set; }
    public int? Sid { get; set; }
    public bool Shiny { get; set; }
    public string Method { get; set; } = "M1";
    public int? Nature { get; set; }
    public int MaxFrame { get; set; } = 100;
    public int MinFrame { get; set; }
    public int YearMin { get; set; } = 2000;
    public int YearMax { get; set; } = 2099;
    public int DelayMin { get; set; }
    public int DelayMax { get; set; } = 0xFFFF;
    public int? TargetDelay { get; set; }
    public int? ForceSecond { get; set; }
    public int TimesPerCandidate { get; set; } = 1;
    public int YearsPerCandidate { get; set; } = 1;
    public bool AllowHourOverflow { get; set; }
    public int Limit { get; set; } = 100;
}

public static class SeedTime4
{
    public const uint Mult = 0x41C64E6D;
    public const uint Add = 0x6073;
    public const uint RMult = 0xEEB9EB65; // PKHeX LCRNG.cs:30
    public const uint RAdd = 0x0A3561A1;  // PKHeX LCRNG.cs:31
    public const int MinYear = 2000, MaxYear = 2099;
    const int DayCount = 36525;

    static readonly string[] Natures =
    {
        "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
        "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash",
        "Calm", "Gentle", "Sassy", "Careful", "Quirky"
    };
    public static string NatureName(int i) => Natures[i];

    public static uint Next(uint s) => unchecked(s * Mult + Add);
    public static uint Prev(uint s) => unchecked(s * RMult + RAdd);
    static uint Hi(uint s) => s >> 16;
    public static string Hex8(uint s) => s.ToString("X8");

    static int CheckInt(string name, int v, int lo, int hi)
    {
        if (v < lo || v > hi) throw new ArgumentOutOfRangeException(name, $"{name} must be in {lo}..{hi}, got {v}");
        return v;
    }

    // ---------------------------------------------------------------- dates (PokeFinder DateTime.cpp)
    static readonly int[] MonthDays = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    public static bool IsLeap(int year) => year % 4 == 0;
    public static int DaysInMonth(int year, int month) => month == 2 && IsLeap(year) ? 29 : MonthDays[month - 1];

    static int DayNumber(int year, int month, int day)
    {
        int n = 0;
        for (int y = MinYear; y < year; y++) n += IsLeap(y) ? 366 : 365;
        for (int m = 1; m < month; m++) n += DaysInMonth(year, m);
        return n + day - 1;
    }

    static (int Year, int Month, int Day) FromDayNumber(int n)
    {
        int year = MinYear;
        while (true) { int len = IsLeap(year) ? 366 : 365; if (n < len) break; n -= len; year++; }
        int month = 1;
        while (n >= DaysInMonth(year, month)) { n -= DaysInMonth(year, month); month++; }
        return (year, month, n + 1);
    }

    public static (int Year, int Month, int Day, int Hour, int Minute, int Second, bool Valid) AddSeconds(
        int year, int month, int day, int hour, int minute, int second, int seconds)
    {
        long total = hour * 3600L + minute * 60L + second + seconds;
        long days = (long)Math.Floor(total / 86400.0);
        int tod = (int)(total - days * 86400);
        long n = DayNumber(year, month, day) + days;
        bool valid = true;
        if (n >= DayCount) n %= DayCount;
        if (n < 0) valid = false;
        var d = valid ? FromDayNumber((int)n) : (year, month, day);
        return (d.Item1, d.Item2, d.Item3, tod / 3600, (tod / 60) % 60, tod % 60, valid);
    }

    // Utilities4::calcSeed: bytes truncated before the shift, u32 wrap.
    public static uint CalcSeed(int year, int month, int day, int hour, int minute, int second, uint delay)
    {
        uint ab = (uint)((month * day + minute + second) & 0xFF);
        uint cd = (uint)(hour & 0xFF);
        return unchecked(((ab << 24) | (cd << 16)) + delay + (uint)(year - 2000));
    }

    // ---------------------------------------------------------------- 1. SeedToTimes
    // hour and delay are the minimum-delay decomposition of the low 24 bits (core/seedtime4.js seedToTimes):
    // a year past 2000 + efgh carries into the hour byte (hour cd - 1, delay + 0x10000; empty when the hour
    // byte is 0), an hour byte above 23 is hour 23 with (cd - 23) * 0x10000 in the delay (PokeFinder's rule);
    // pokefinderDelay reports the carry case as PokeFinder's u32-wrapped delay at hour cd instead.
    public static List<SeedTimeRow> SeedToTimes(uint seed, int year, int? forceSecond = null, long limit = long.MaxValue, bool allowHourOverflow = true, bool pokefinderDelay = false)
    {
        CheckInt("year", year, MinYear, MaxYear);
        if (forceSecond is int fs) CheckInt("forceSecond", fs, 0, 59);
        uint ab = seed >> 24;
        int cd = (int)((seed >> 16) & 0xFF);
        uint efgh = seed & 0xFFFF;
        var results = new List<SeedTimeRow>();
        if (cd > 23 && !allowHourOverflow) return results;
        int hour = cd > 23 ? 23 : cd;
        long delayL = (long)(cd - hour) * 0x10000 + efgh - (year - 2000);
        if (delayL < 0)
        {
            if (pokefinderDelay) delayL = unchecked((uint)delayL);
            else if (hour >= 1) { hour -= 1; delayL += 0x10000; }
            else return results;
        }
        uint delay = (uint)delayL;
        for (int month = 1; month <= 12; month++)
        {
            int maxDays = DaysInMonth(year, month);
            for (int day = 1; day <= maxDays; day++)
            {
                for (int minute = 0; minute < 60; minute++)
                {
                    for (int second = 0; second < 60; second++)
                    {
                        if (ab == (uint)((month * day + minute + second) & 0xFF))
                        {
                            if (forceSecond is null || second == forceSecond)
                            {
                                results.Add(new SeedTimeRow(year, month, day, hour, minute, second, delay, unchecked((int)delay), seed));
                                if (results.Count >= limit) return results;
                            }
                        }
                    }
                }
            }
        }
        return results;
    }

    // ---------------------------------------------------------------- verification strings
    public static string CoinFlipsFormatted(uint seed) => string.Join(", ", Gen4.CoinFlips(seed, 20).ToCharArray());

    // The letters name the draw (E = 0, K = 1, P = 2), not a fixed message: the two %2 branches start at
    // different scripts (phone_scripts_prof_elm.c:86 PHONE_SCRIPT_020, :59 PHONE_SCRIPT_014; phone_script_defs.c:190-240).
    public static readonly IReadOnlyDictionary<int, IReadOnlyDictionary<char, string>> ElmLegend = new Dictionary<int, IReadOnlyDictionary<char, string>>
    {
        [3] = new Dictionary<char, string>
        {
            ['E'] = "evolution (PHONE_SCRIPT_020, msg_0716 row 27; :84)", ['K'] = "Kanto (PHONE_SCRIPT_021, row 29)", ['P'] = "Pokerus (PHONE_SCRIPT_022, row 31)"
        },
        [2] = new Dictionary<char, string>
        {
            ['E'] = "post-game before the Pokerus flag (:86): evolution (PHONE_SCRIPT_020, row 27); after the Everstone before 7 badges (:59): egg hatch time (PHONE_SCRIPT_014, row 15)",
            ['K'] = "post-game before the Pokerus flag (:86): Kanto (PHONE_SCRIPT_021, row 29); after the Everstone before 7 badges (:59): hatched moves (PHONE_SCRIPT_015, row 17)"
        }
    };

    public static (string Sequence, string Calls) ElmCallsFormatted(uint seed, int skips, int ways = 3)
    {
        int w = ways == 2 ? 2 : 3;
        uint s = seed;
        int total = 20 + skips;
        var sb = new StringBuilder(skips > 0 ? "(" : "");
        var compact = new StringBuilder();
        for (int i = 0; i < total; i++)
        {
            s = Next(s);
            uint call = Hi(s) % (uint)w;
            char letter = call == 0 ? 'E' : call == 1 ? 'K' : 'P';
            sb.Append(letter);
            if (i >= skips) compact.Append(letter);
            if (i != total - 1) sb.Append(skips != 0 && skips == i + 1 ? " skipped)  " : ", ");
        }
        return (sb.ToString(), compact.ToString());
    }

    public static int RouteJ(uint rand16) { uint v = rand16 & 15; return (int)(v < 11 ? v + 29 : v + 31); }
    public static int RouteK(uint rand16) { uint v = rand16 % 25; return v == 22 ? 24 : v == 23 ? 26 : v == 24 ? 28 : (int)v + 1; }

    public static RoamerInfo RoamerRoutes(uint seed, bool raikouActive, bool enteiActive, bool latiActive, int routeRaikou, int routeEntei, int routeLati)
    {
        uint s = seed;
        int skips = 0, raikou = 0, entei = 0, lati = 0;
        if (raikouActive) { do { s = Next(s); skips++; raikou = RouteJ(Hi(s)); } while (routeRaikou == raikou); }
        if (enteiActive) { do { s = Next(s); skips++; entei = RouteJ(Hi(s)); } while (routeEntei == entei); }
        if (latiActive) { do { s = Next(s); skips++; lati = RouteK(Hi(s)); } while (routeLati == lati); }
        var str = new StringBuilder();
        if (raikou != 0) str.Append("R: ").Append(raikou).Append(' ');
        if (entei != 0) str.Append("E: ").Append(entei).Append(' ');
        if (lati != 0) str.Append("L: ").Append(lati);
        return new RoamerInfo(raikou, entei, lati, skips, str.ToString());
    }

    public static ChatotPitch ChatotPitchOf(uint rand16)
    {
        int v = (int)(((rand16 % 8192) * 100) >> 13);
        string band = v < 20 ? "L" : v < 40 ? "ML" : v < 60 ? "M" : v < 80 ? "MH" : "H";
        return new ChatotPitch(v, band);
    }

    public static List<ChatotPitch> ChatotSequence(uint seed, int count)
    {
        uint s = seed;
        var list = new List<ChatotPitch>(count);
        for (int i = 0; i < count; i++) { s = Next(s); list.Add(ChatotPitchOf(Hi(s))); }
        return list;
    }

    public static string GameFamily(string game)
    {
        string g = (game ?? "").ToLowerInvariant();
        if (g is "hgss" or "hg" or "ss" or "heartgold" or "soulsilver") return "HGSS";
        if (g is "dppt" or "dp" or "pt" or "d" or "p" or "diamond" or "pearl" or "platinum") return "DPPt";
        throw new ArgumentException($"game must be DPPt or HGSS (got {game})");
    }

    // ---------------------------------------------------------------- 2. CalibrateRows
    // A caller-supplied target must be a real date, a clock hour and a delay 0..0xFFFFFF.
    public static SeedTimeRow CheckTarget(SeedTimeRow t)
    {
        CheckInt("target.year", t.Year, MinYear, MaxYear);
        CheckInt("target.month", t.Month, 1, 12);
        CheckInt("target.day", t.Day, 1, DaysInMonth(t.Year, t.Month));
        CheckInt("target.hour", t.Hour, 0, 23);
        CheckInt("target.minute", t.Minute, 0, 59);
        CheckInt("target.second", t.Second, 0, 59);
        if (t.Delay > 0xFFFFFF) throw new ArgumentOutOfRangeException("target.delay", $"target.delay must be in 0..16777215, got {t.Delay}");
        return t;
    }

    public static List<CalibrateRow> CalibrateRows(uint seed, int delayRange, int secondRange, string game, CalibrateOptions? opts = null)
    {
        var o = opts ?? new CalibrateOptions();
        string fam = GameFamily(game);
        CheckInt("delayRange", delayRange, 0, 100000);
        CheckInt("secondRange", secondRange, 0, 3600);
        var target = o.Target is null ? null : CheckTarget(o.Target);
        if (target is null)
        {
            var times = SeedToTimes(seed, o.Year, o.ForceSecond, 1);
            if (times.Count == 0) throw new ArgumentException($"seed {Hex8(seed)} has no time in {o.Year}");
            target = times[0];
        }
        var rows = new List<CalibrateRow>();
        bool anyRoamer = o.RoamerRaikou || o.RoamerEntei || o.RoamerLati;
        for (int so = -secondRange; so <= secondRange; so++)
        {
            var t = AddSeconds(target.Year, target.Month, target.Day, target.Hour, target.Minute, target.Second, so);
            if (!t.Valid) continue;
            for (int dof = -delayRange; dof <= delayRange; dof++)
            {
                uint delay = unchecked(target.Delay + (uint)dof);
                uint rowSeed = CalcSeed(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second, delay);
                if (fam == "DPPt")
                {
                    rows.Add(new CalibrateRow(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second, delay, so, dof, rowSeed,
                        CoinFlipsFormatted(rowSeed), Gen4.CoinFlips(rowSeed, 20), null, null));
                }
                else
                {
                    RoamerInfo? roamer = anyRoamer ? RoamerRoutes(rowSeed, o.RoamerRaikou, o.RoamerEntei, o.RoamerLati, o.RouteRaikou, o.RouteEntei, o.RouteLati) : null;
                    var (sequence, calls) = ElmCallsFormatted(rowSeed, roamer?.Skips ?? 0, o.ElmWays);
                    rows.Add(new CalibrateRow(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second, delay, so, dof, rowSeed, sequence, null, calls, roamer));
                }
            }
        }
        return rows;
    }

    // ---------------------------------------------------------------- 3. advance planner
    public static readonly Dictionary<string, AdvanceToolCost> AdvanceTools = new()
    {
        ["chatot"] = new(1, false, "STRUCTURAL", "one Chatot cry (summary screen or Chatot's cry)",
            "pokeplatinum/src/sound_chatot.c:80 (LCRNG_Next() % 8192); pokeheartgold/src/sound_chatot.c:59"),
        ["journal"] = new(2, false, "EMPIRICAL", "one Journal page flip (DPPt)",
            "community convention (+2 per flip); no LCRNG call in pokeplatinum/src/journal.c, so not decomp-proven"),
        ["walk128"] = new(1, true, "STRUCTURAL", "one 128-step friendship cycle: +1 per party member",
            "pokeplatinum/src/overlay005/field_control.c:759-760,871 (step counter wraps at 128, then every party mon), src/pokemon.c:2637-2641 (LCRNG_Next() & 1 per mon); pokeheartgold/src/pokemon.c:2037"),
        ["elmCall"] = new(1, false, "STRUCTURAL", "one Elm call (HGSS, only on the story states that roll)",
            "pokeheartgold/src/application/pokegear/phone/scripts/phone_scripts_prof_elm.c:59,84,86"),
        ["coinFlip"] = new(0, false, "STRUCTURAL", "one Poketch coin flip (DPPt): drains the MT only",
            "pokeplatinum/src/applications/poketch/coin_toss/main.c:158 (MTRNG_Next() % 2)"),
        ["battleEnd"] = new(1, false, "STRUCTURAL", "a battle ending: at least the Pokerus roll",
            "design section 5.3 (battle_controller_player.c:4044-4048); count per battle may be higher")
    };

    public static AdvancePlan PlanAdvances(long currentFrame, long targetFrame, int partyCount = 1, string[]? tools = null)
    {
        if (currentFrame < 0 || currentFrame > 0xFFFFFFFFL) throw new ArgumentOutOfRangeException(nameof(currentFrame));
        if (targetFrame < 0 || targetFrame > 0xFFFFFFFFL) throw new ArgumentOutOfRangeException(nameof(targetFrame));
        CheckInt("partyCount", partyCount, 1, 6);
        tools ??= new[] { "walk128", "journal", "chatot" };
        long needed = targetFrame - currentFrame;
        var plan = new List<AdvanceStep>();
        if (needed < 0) return new AdvancePlan(needed, plan, 0, "target frame is behind the current frame: reset and start again");
        long remaining = needed;
        foreach (var name in tools)
        {
            if (!AdvanceTools.TryGetValue(name, out var t)) throw new ArgumentException($"unknown advance tool {name}");
            int per = t.PerPartyMon ? t.PerUse * partyCount : t.PerUse;
            if (per <= 0) continue;
            long uses = remaining / per;
            if (uses > 0)
            {
                plan.Add(new AdvanceStep(name, uses, per, uses * per, t.Label, t.Cite));
                remaining -= uses * per;
            }
        }
        return new AdvancePlan(needed, plan, remaining, null);
    }

    // ---------------------------------------------------------------- 4. reversal (PKHeX LCRNGReversal.cs / LCRNGReversalSkip.cs)
    const uint Lag0 = 0x67D3, Lag1 = 0xC907, Lower = 0x3443, Upper = 0xC34E;          // LCRNGReversal.cs:20-23
    const uint RLag0 = 0x7ED7, RLag1 = 0xD33, RLower = 0x50F5A0B, RUpper = 0x50F40B4;  // LCRNGReversal.cs:14-18
    const uint RMult2 = 0xDC6C95D9, SLag0 = 0x6C31, SLag1Ivs = 0x2E90, SLowerIvs = 0x1574621D, SUpperIvs = 0x157488D6; // LCRNGReversalSkip.cs:14-21

    static (uint First, uint Second) IvWords(int hp, int atk, int def, int spa, int spd, int spe)
    {
        CheckInt("hp", hp, 0, 31); CheckInt("atk", atk, 0, 31); CheckInt("def", def, 0, 31);
        CheckInt("spa", spa, 0, 31); CheckInt("spd", spd, 0, 31); CheckInt("spe", spe, 0, 31);
        return ((uint)(hp | (atk << 5) | (def << 10)) << 16, (uint)(spe | (spa << 5) | (spd << 10)) << 16);
    }

    static void AddSeedsIvs(List<uint> result, uint low, uint first, uint second)   // LCRNGReversal.cs:93-106
    {
        low %= Lag1;
        do
        {
            uint seed = first | low;
            if ((Next(seed) & 0x7FFF0000) != second) continue;
            seed = Prev(seed);
            result.Add(seed);
            result.Add(seed ^ 0x80000000);
        } while ((low += Lag1) < 0x10000);
    }

    public static List<uint> SeedsForIvWords(uint first, uint second)               // LCRNGReversal.cs:77-91
    {
        uint tmp = unchecked(((second - Mult * first) >> 16) * Lag1);
        uint lo = unchecked(((tmp + Lower) >> 15) * Lag0);
        uint mi = unchecked(lo + Lag0);
        uint up = unchecked(((tmp + Upper) >> 15) * Lag0);
        var result = new List<uint>();
        AddSeedsIvs(result, lo, first, second);
        AddSeedsIvs(result, mi, first, second);
        if (mi != up) AddSeedsIvs(result, up, first, second);
        return result;
    }

    public static List<uint> IvsToSeeds(int hp, int atk, int def, int spa, int spd, int spe)   // LCRNGReversal.cs:36-41
    {
        var (first, second) = IvWords(hp, atk, def, spa, spd, spe);
        return SeedsForIvWords(first, second);
    }

    static void AddSeedsIvsSkip(List<uint> result, uint low, uint first, uint third)  // LCRNGReversalSkip.cs:88-100
    {
        do
        {
            uint seed = Prev(Prev(third | low));
            if ((seed & 0x7FFF0000) != first) continue;
            seed = Prev(seed);
            result.Add(seed);
            result.Add(seed ^ 0x80000000);
        } while ((low += SLag0) < 0x10000);
    }

    public static List<uint> SeedsForIvWordsSkip(uint first, uint third)             // LCRNGReversalSkip.cs:75-86
    {
        uint tmp = unchecked(((first - third * RMult2) >> 16) * SLag0);
        uint lo = unchecked((tmp + SLowerIvs) >> 15);
        uint up = unchecked((tmp + SUpperIvs) >> 15);
        var result = new List<uint>();
        AddSeedsIvsSkip(result, unchecked(lo * SLag1Ivs) % SLag0, first, third);
        if (lo != up) AddSeedsIvsSkip(result, unchecked(up * SLag1Ivs) % SLag0, first, third);
        return result;
    }

    public static List<uint> IvsToSeedsSkip(int hp, int atk, int def, int spa, int spd, int spe)  // LCRNGReversalSkip.cs:34-39
    {
        var (first, third) = IvWords(hp, atk, def, spa, spd, spe);
        return SeedsForIvWordsSkip(first, third);
    }

    public static bool IsMethod4(string method)
    {
        string m = (method ?? "M1").ToUpperInvariant();
        if (m is "M4" or "METHOD4" or "4") return true;
        if (m is "M1" or "METHOD1" or "1" or "J" or "K") return false;
        throw new ArgumentException($"method must be M1 or M4 (got {method})");
    }

    public static List<uint> IvsToSeedsByMethod(Ivs4 ivs, string method)
        => IsMethod4(method) ? IvsToSeedsSkip(ivs.Hp, ivs.Atk, ivs.Def, ivs.Spa, ivs.Spd, ivs.Spe)
                             : IvsToSeeds(ivs.Hp, ivs.Atk, ivs.Def, ivs.Spa, ivs.Spd, ivs.Spe);

    public static List<uint> PidToSeeds(uint pid)                                   // LCRNGReversal.cs:50-68
    {
        uint first = pid << 16;
        uint second = pid & 0xFFFF0000;
        uint tmp = unchecked(((second * RMult - first) >> 16) * RLag0);
        uint lo = unchecked((tmp + RLower) >> 16);
        uint up = unchecked((tmp + RUpper) >> 16);
        var result = new List<uint>();
        if (lo != up) return result;
        uint low = unchecked(lo * RLag1) % RLag0;
        do
        {
            uint seed = Prev(second | low);
            if ((seed & 0xFFFF0000) == first) result.Add(Prev(seed));
        } while ((low += RLag0) < 0x10000);
        return result;
    }

    public static Mon4 MonFromFrameSeed(uint frameSeed, string method = "M1")
    {
        uint s1 = Next(frameSeed), s2 = Next(s1), s3 = Next(s2), s4 = Next(s3);
        uint ivState2 = IsMethod4(method) ? Next(s4) : s4;
        uint pid = (Hi(s2) << 16) | Hi(s1);
        uint w1 = Hi(s3), w2 = Hi(ivState2);
        return new Mon4(pid, (int)(pid % 25), Natures[pid % 25],
            new Ivs4((int)(w1 & 31), (int)((w1 >> 5) & 31), (int)((w1 >> 10) & 31), (int)((w2 >> 5) & 31), (int)((w2 >> 10) & 31), (int)(w2 & 31)));
    }

    public static List<Candidate4> ReachableSeeds(IEnumerable<uint> origins, int callsBefore = 2, int maxFrame = 100, int minFrame = 0, bool allowHourOverflow = false)
    {
        CheckInt("callsBefore", callsBefore, 0, 16);
        CheckInt("maxFrame", maxFrame, 0, 10000000);
        CheckInt("minFrame", minFrame, 0, maxFrame);
        int hourMax = allowHourOverflow ? 255 : 23;
        var hits = new List<Candidate4>();
        foreach (var origin in origins)
        {
            uint s = origin;
            for (int b = 0; b < callsBefore; b++) s = Prev(s);
            for (int frame = 0; frame <= maxFrame; frame++)
            {
                if (frame >= minFrame)
                {
                    int hour = (int)((s >> 16) & 0xFF);
                    if (hour <= hourMax) hits.Add(new Candidate4(s, frame, hour, (int)(s >> 24), (int)(s & 0xFFFF), origin));
                }
                s = Prev(s);
            }
        }
        hits.Sort((a, b) => a.Frame != b.Frame ? a.Frame.CompareTo(b.Frame) : a.Seed.CompareTo(b.Seed));
        return hits;
    }

    public static List<TimeCandidate4> SeedsToTimes(IEnumerable<Candidate4> candidates, WantedFilter o)
    {
        int yearMin = CheckInt("yearMin", o.YearMin, MinYear, MaxYear);
        int yearMax = CheckInt("yearMax", o.YearMax, yearMin, MaxYear);
        int delayMin = CheckInt("delayMin", o.DelayMin, 0, 0xFFFFFF);
        int delayMax = CheckInt("delayMax", o.DelayMax, delayMin, 0xFFFFFF);
        int targetDelay = o.TargetDelay is int td ? CheckInt("targetDelay", td, 0, 0xFFFFFF) : delayMin;
        int yearsPer = CheckInt("yearsPerCandidate", o.YearsPerCandidate, 1, 100);
        int timesPer = CheckInt("timesPerCandidate", o.TimesPerCandidate, 1, 100000);
        var rows = new List<TimeCandidate4>();
        foreach (var c in candidates)
        {
            int cd = (int)((c.Seed >> 16) & 0xFF);
            if (cd > 23 && !o.AllowHourOverflow) continue;
            int efgh = (int)(c.Seed & 0xFFFF);
            int extra = cd > 23 ? (cd - 23) * 0x10000 : 0;
            var pairs = new List<(int Year, int Delay, int Dist)>();
            for (int year = yearMin; year <= yearMax; year++)
            {
                int delay = efgh - (year - 2000) + extra;
                if (delay < 0) { if (cd >= 1) delay += 0x10000; else continue; } // the hour-byte carry (SeedToTimes)
                if (delay >= delayMin && delay <= delayMax) pairs.Add((year, delay, Math.Abs(delay - targetDelay)));
            }
            pairs.Sort((a, b) => a.Dist != b.Dist ? a.Dist.CompareTo(b.Dist) : a.Year.CompareTo(b.Year));
            for (int p = 0; p < pairs.Count && p < yearsPer; p++)
            {
                foreach (var tm in SeedToTimes(c.Seed, pairs[p].Year, o.ForceSecond, timesPer))
                {
                    if (tm.Delay != (uint)pairs[p].Delay) throw new InvalidOperationException($"SeedsToTimes: delay {pairs[p].Delay} does not match SeedToTimes {tm.Delay}");
                    rows.Add(new TimeCandidate4(c.Seed, c.Frame, tm.Year, tm.Month, tm.Day, tm.Hour, tm.Minute, tm.Second, pairs[p].Delay, pairs[p].Dist, c.Origin));
                }
            }
        }
        rows.Sort((a, b) =>
        {
            int r = a.DelayDistance.CompareTo(b.DelayDistance); if (r != 0) return r;
            r = a.Frame.CompareTo(b.Frame); if (r != 0) return r;
            r = a.Seed.CompareTo(b.Seed); if (r != 0) return r;
            r = a.Year.CompareTo(b.Year); if (r != 0) return r;
            r = a.Month.CompareTo(b.Month); if (r != 0) return r;
            r = a.Day.CompareTo(b.Day); if (r != 0) return r;
            r = a.Minute.CompareTo(b.Minute); if (r != 0) return r;
            return a.Second.CompareTo(b.Second);
        });
        return rows;
    }

    public static bool IsShiny(uint pid, int tid, int sid) => (((uint)tid ^ (uint)sid ^ (pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF) < 8;

    public static List<uint> ShinyPids(int tid, int sid, int? nature = null)
    {
        CheckInt("tid", tid, 0, 0xFFFF); CheckInt("sid", sid, 0, 0xFFFF);
        if (nature is int n) CheckInt("nature", n, 0, 24);
        var list = new List<uint>();
        uint x = (uint)((tid ^ sid) & 0xFFFF);
        for (uint lo = 0; lo < 0x10000; lo++)
        {
            for (uint v = 0; v < 8; v++)
            {
                uint pid = (((lo ^ x ^ v) & 0xFFFF) << 16) | lo;
                if (nature is null || pid % 25 == (uint)nature) list.Add(pid);
            }
        }
        return list;
    }

    public static List<TimeCandidate4> WantedToTimes(WantedFilter f)
    {
        bool hasIds = f.Tid is not null && f.Sid is not null;
        var origins = new List<uint>();
        int callsBefore;
        if (f.Ivs is not null)
        {
            callsBefore = 2;
            foreach (var s2 in IvsToSeedsByMethod(f.Ivs, f.Method))
            {
                uint pid = (Hi(s2) << 16) | Hi(Prev(s2));
                if (f.Pid is uint wp && pid != wp) continue;
                if (f.Nature is int n && pid % 25 != (uint)n) continue;
                if (f.Shiny && hasIds && !IsShiny(pid, f.Tid!.Value, f.Sid!.Value)) continue;
                origins.Add(s2);
            }
        }
        else if (f.Pid is uint pid)
        {
            callsBefore = 0;
            origins = PidToSeeds(pid);
        }
        else if (f.Shiny && hasIds)
        {
            callsBefore = 0;
            foreach (var p in ShinyPids(f.Tid!.Value, f.Sid!.Value, f.Nature)) origins.AddRange(PidToSeeds(p));
        }
        else throw new ArgumentException("WantedToTimes needs Ivs, a Pid, or Tid+Sid with Shiny");
        var candidates = ReachableSeeds(origins, callsBefore, f.MaxFrame, f.MinFrame, f.AllowHourOverflow);
        var rows = SeedsToTimes(candidates, f);
        var list = new List<TimeCandidate4>();
        foreach (var row in rows)
        {
            if (list.Count >= f.Limit) break;
            var mon = MonFromFrameSeed(Lcrng.Jump(row.Seed, (ulong)row.Frame), f.Method);
            if (f.Nature is int n && mon.Nature != n) continue;
            row.Pid = mon.Pid; row.Nature = mon.Nature; row.NatureName = mon.NatureName; row.Ivs = mon.Ivs;
            row.Shiny = hasIds ? IsShiny(mon.Pid, f.Tid!.Value, f.Sid!.Value) : null;
            list.Add(row);
        }
        return list;
    }

    // ---------------------------------------------------------------- TID search over every time (IDSearcher4)
    public static uint MtSecondOutput(uint seed)
    {
        uint s1 = unchecked(1812433253u * (seed ^ (seed >> 30)) + 1);
        uint s2 = unchecked(1812433253u * (s1 ^ (s1 >> 30)) + 2);
        uint x = s2;
        for (uint i = 3; i <= 398; i++) x = unchecked(1812433253u * (x ^ (x >> 30)) + i);
        uint y = (s1 & 0x80000000u) | (s2 & 0x7FFFFFFFu);
        uint v = x ^ (y >> 1) ^ ((y & 1) != 0 ? 0x9908B0DFu : 0u);
        v ^= v >> 11;
        v ^= (v << 7) & 0x9D2C5680u;
        v ^= (v << 15) & 0xEFC60000u;
        v ^= v >> 18;
        return v;
    }

    public static List<TidHit4> TidToSeeds(int tid, int year, int delayMin, int delayMax, int? sid = null, long limit = long.MaxValue)
    {
        CheckInt("tid", tid, 0, 0xFFFF);
        CheckInt("year", year, MinYear, MaxYear);
        CheckInt("delayMin", delayMin, 0, 0xFFFF); CheckInt("delayMax", delayMax, delayMin, 0xFFFF);
        if (sid is int ws) CheckInt("sid", ws, 0, 0xFFFF);
        var list = new List<TidHit4>();
        for (int delay = delayMin; delay <= delayMax; delay++)
        {
            int efgh = delay + (year - 2000);
            if (efgh > 0xFFFF) break;
            for (uint ab = 0; ab < 256; ab++)
            {
                for (uint cd = 0; cd < 24; cd++)
                {
                    uint seed = unchecked(((ab << 24) | (cd << 16)) + (uint)efgh);
                    uint r = MtSecondOutput(seed);
                    int t = (int)(r & 0xFFFF);
                    if (t != tid) continue;
                    int s = (int)(r >> 16);
                    if (sid is int want && s != want) continue;
                    list.Add(new TidHit4(seed, delay, t, s, ((t ^ s) >> 3) & 0x1FFF));
                    if (list.Count >= limit) return list;
                }
            }
        }
        return list;
    }
}
