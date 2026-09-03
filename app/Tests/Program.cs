using System.Text.Json;
using ShinySolution.Core;

int failures = 0;

void Check<T>(string label, T actual, T expected)
{
    var a = JsonSerializer.Serialize(actual);
    var e = JsonSerializer.Serialize(expected);
    if (a != e)
    {
        failures++;
        Console.Error.WriteLine($"FAIL {label}\n  expected {e}\n  actual   {a}");
    }
}

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: ShinySolution.Tests <path-to-vectors.json> | --emit-gen4-vectors <out.json> | --gen1tid <gen1tid-vectors.json> <repo-root>");
    return 2;
}

if (args[0] == "--gen1tid")
{
    if (args.Length < 3)
    {
        Console.Error.WriteLine("usage: ShinySolution.Tests --gen1tid <gen1tid-vectors.json> <repo-root>");
        return 2;
    }
    return Gen1TidChecks.Run(args[1], args[2]);
}

if (args[0] == "--emit-gen4-vectors")
{
    var seeds = new uint[] { 0, 1, 0x5A0, 0x12345678, 0xDEADBEEF, 0xFFFFFFFF, 0x01000000, 0xC4BD0000 };
    var seedCases = new List<object>();
    foreach (var (y, mo, d, h, mi, s, dl) in new[]
    {
        (2000, 1, 1, 0, 0, 0, 0u), (2026, 8, 21, 10, 30, 45, 1500u), (2000, 12, 31, 0, 59, 59, 0u),
        (2099, 12, 31, 23, 59, 59, 65535u), (2004, 3, 17, 7, 12, 3, 604u), (2026, 1, 1, 23, 0, 0, 80000u)
    })
    {
        seedCases.Add(new { y, mo, d, h, mi, s, dl, seed = Gen4.Seed(y, mo, d, h, mi, s, dl) });
    }
    var tidSids = seeds.Select(sv => { var (t, si) = Gen4.TidSid(sv); return new { seed = sv, tid = t, sid = si }; }).ToList();
    var flips = seeds.Select(sv => new { seed = sv, flips = Gen4.CoinFlips(sv, 20) }).ToList();
    var elm = seeds.Select(sv => new { seed = sv, calls = Gen4.ElmCalls(sv, 12, 2) }).ToList();
    var timers = new List<object>();
    foreach (var (td, ts, cd, cs) in new[] { (600u, 50, 500.0, 14.0), (5000u, 32, 512.5, 15.0), (65535u, 0, -300.0, 20.0) })
    {
        var t = new Gen4Timer { TargetDelay = td, TargetSecond = ts, CalibratedDelay = cd, CalibratedSecond = cs };
        var (p1, p2) = t.Phases();
        t.Calibrate(td + 40);
        timers.Add(new { td, ts, cd, cs, p1, p2, minutesBefore = new Gen4Timer { TargetDelay = td, TargetSecond = ts }.MinutesBefore(), calibrated = t.CalibratedDelay });
    }
    var search = Gen4.SearchTid(Gen4.TidSid(0x12345678).Tid, 2026, 8, 21, 10, 30, 0, 3000, 5)
        .Select(r => new { r.Second, r.Delay, r.SeedValue, r.Tid, r.Sid }).ToList();
    File.WriteAllText(args[1], JsonSerializer.Serialize(new { seedCases, tidSids, flips, elm, timers, search }));
    Console.WriteLine($"gen4 vectors written to {args[1]}");
    return 0;
}

var vectors = JsonDocument.Parse(File.ReadAllText(args[0])).RootElement;

foreach (var prop in vectors.GetProperty("sequences").EnumerateObject())
{
    uint s = uint.Parse(prop.Name);
    var expected = prop.Value.EnumerateArray().Select(x => x.GetUInt32()).ToArray();
    var got = new uint[expected.Length];
    for (int i = 0; i < expected.Length; i++)
    {
        s = Lcrng.Next(s);
        got[i] = s;
    }
    Check($"sequence seed={prop.Name}", got, expected);
}

foreach (var j in vectors.GetProperty("jumps").EnumerateArray())
{
    uint seed = j.GetProperty("seed").GetUInt32();
    ulong n = j.GetProperty("n").GetUInt64();
    Check($"jump n={n}", Lcrng.Jump(seed, n), j.GetProperty("state").GetUInt32());
}

foreach (var m in vectors.GetProperty("method1").EnumerateArray())
{
    long adv = m.GetProperty("advance").GetInt64();
    var mon = Gen3.Method1(Lcrng.Jump(0x5A0, (ulong)adv), adv);
    var ivs = m.GetProperty("ivs");
    Check($"method1 adv={adv} pid", mon.Pid, m.GetProperty("pid").GetUInt32());
    Check($"method1 adv={adv} nature", mon.NatureName, m.GetProperty("natureName").GetString()!);
    Check($"method1 adv={adv} gv", mon.GenderValue, m.GetProperty("genderValue").GetInt32());
    Check($"method1 adv={adv} ivs", new[] { mon.Ivs.Hp, mon.Ivs.Atk, mon.Ivs.Def, mon.Ivs.Spa, mon.Ivs.Spd, mon.Ivs.Spe },
        new[] { ivs.GetProperty("hp").GetInt32(), ivs.GetProperty("atk").GetInt32(), ivs.GetProperty("def").GetInt32(),
                ivs.GetProperty("spa").GetInt32(), ivs.GetProperty("spd").GetInt32(), ivs.GetProperty("spe").GetInt32() });
}

foreach (var t in vectors.GetProperty("tidPairs").EnumerateArray())
{
    long adv = t.GetProperty("advance").GetInt64();
    uint tid = t.GetProperty("tid").GetUInt32();
    uint sid = t.GetProperty("sid").GetUInt32();
    var found = Gen3.FindByTid(0x5A0, 0, tid, sid, adv + 10);
    Check($"tidPair adv={adv}", found.Any(f => f.Advance == adv && f.Tid == tid && f.Sid == sid), true);
}

{
    var anchor = vectors.GetProperty("shinyAnchor");
    uint tid = anchor.GetProperty("tid").GetUInt32();
    uint sid = anchor.GetProperty("sid").GetUInt32();
    var expected = vectors.GetProperty("shinyHits").EnumerateArray().ToArray();
    var hits = Gen3.SearchStarter(Lcrng.Jump(0x5A0, 701), 701, tid, sid, 3000000, null, expected.Length);
    Check("shinyHits count", hits.Count, expected.Length);
    for (int i = 0; i < Math.Min(hits.Count, expected.Length); i++)
    {
        Check($"shinyHit[{i}] advance", hits[i].Advance, expected[i].GetProperty("advance").GetInt64());
        Check($"shinyHit[{i}] pid", hits[i].Pid, expected[i].GetProperty("pid").GetUInt32());
        Check($"shinyHit[{i}] shiny", hits[i].IsShiny(tid, sid), true);
    }
}

{
    uint s = 0xDEADBEEF;
    Check("jump composition", Lcrng.Jump(s, 12345), Lcrng.Jump(Lcrng.Jump(s, 12000), 345));
    Check("jump single", Lcrng.Jump(s, 1), Lcrng.Next(s));
    Check("jump zero", Lcrng.Jump(s, 0), s);
}

{
    var mt = new Mt19937(5489);
    Check("MT19937 seed 5489 outputs", new[] { mt.Next(), mt.Next(), mt.Next(), mt.Next(), mt.Next() },
        new uint[] { 3499211612, 581869302, 3890346734, 3586334585, 545404204 });
    var mt1 = new Mt19937(1);
    Check("MT19937 seed 1 first output", mt1.Next(), 1791095845u);
}

{
    Check("gen4 seed identity", Gen4.Seed(2000, 1, 1, 0, 0, 0, 0), 0x01000000u);
    Check("gen4 seed formula", Gen4.Seed(2026, 8, 21, 10, 30, 45, 1500),
        ((uint)(8 * 21 + 30 + 45) << 24) + (10u << 16) + 26u + 1500u);
    Check("gen4 seed byte overflow", Gen4.Seed(2000, 12, 31, 0, 59, 59, 0), ((12u * 31 + 59 + 59) << 24));
    var (tid, sid) = Gen4.TidSid(0x12345678);
    var mtRef = new Mt19937(0x12345678);
    mtRef.Next();
    uint second = mtRef.Next();
    Check("gen4 tid/sid = MT output 2", (tid, sid), (second & 0xFFFF, second >> 16));
    Check("gen4 coin flips deterministic", Gen4.CoinFlips(0x12345678, 10), Gen4.CoinFlips(0x12345678, 10));
    var found = Gen4.SearchTid(tid, 2026, 8, 21, 10, 30, 0, 5000, 5);
    Check("gen4 tid search self-consistency", found.Any(f => Gen4.TidSid(f.SeedValue).Tid == tid), true);
    var timer = new Gen4Timer { TargetDelay = 600, TargetSecond = 50 };
    var (p1, p2) = timer.Phases();
    Check("gen4 timer phase1 minimum", p1 >= 14000, true);
    Check("gen4 timer phase2 positive", p2 > 0, true);
    Check("gen4 timer total structure", Math.Abs(p1 + p2 - (50 * 1000.0 + 200.0)) % 60000 < 1e-6, true);
    // Minute rollover: an early target second forces phase 1 past a whole minute, so the DS
    // clock must be set 1 minute early; a late second fits in one minute (k=0).
    Check("gen4 minutes-before rolls over for early second", new Gen4Timer { TargetDelay = 600, TargetSecond = 5 }.MinutesBefore(), 1);
    Check("gen4 minutes-before zero for late second", new Gen4Timer { TargetDelay = 600, TargetSecond = 50 }.MinutesBefore(), 0);
}

{
    var mudkip = Gen3Stats.StartersRs["Mudkip"];
    Check("L5 Mudkip Atk IV0 neutral", Gen3Stats.StatsAtLevel(mudkip, new Ivs(0, 0, 0, 0, 0, 0), 5, 0)[1], 12);
    Check("L5 Mudkip Atk IV31 Adamant", Gen3Stats.StatsAtLevel(mudkip, new Ivs(0, 31, 0, 0, 0, 0), 5, 3)[1], 14);
    var treecko = Gen3Stats.StartersRs["Treecko"];
    Check("L5 Treecko HP IV31", Gen3Stats.StatsAtLevel(treecko, new Ivs(31, 0, 0, 0, 0, 0), 5, 0)[0], 20);
}

if (failures > 0)
{
    Console.Error.WriteLine($"{failures} failure(s)");
    return 1;
}
Console.WriteLine("all C# vector and invariant checks passed");
return 0;
