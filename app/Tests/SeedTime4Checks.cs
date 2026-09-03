using System.Text.Json;
using System.Text.Json.Serialization;
using ShinySolution.Core;

// app/Core/SeedTime4.cs against tests/seedtime4-vectors.json: the same cases tests/test-seedtime4.cjs checks in JS
// (PokeFinder seed-to-time / ID / reversal cases bit for bit, the design's gate seeds run forward, the
// reversal's soundness and completeness sample, the roamer routes from the decomp tables, the planner), and
// the JS <-> C# cross-check emitter for tests/seedtime4-cross.cjs.
static class SeedTime4Checks
{
    static int failures, checks;

    static readonly JsonSerializerOptions Out = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, IncludeFields = true };
    static JsonElement ToJson(object? o) => JsonSerializer.SerializeToElement(o, Out);

    static bool Same(JsonElement e, JsonElement a)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.String: return a.ValueKind == JsonValueKind.String && e.GetString() == a.GetString();
            case JsonValueKind.Number:
                if (a.ValueKind != JsonValueKind.Number) return false;
                if (e.TryGetInt64(out long ei) && a.TryGetInt64(out long ai)) return ei == ai;
                return e.GetDouble() == a.GetDouble();
            case JsonValueKind.True: case JsonValueKind.False: return e.ValueKind == a.ValueKind;
            case JsonValueKind.Null: return a.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
            case JsonValueKind.Array:
                if (a.ValueKind != JsonValueKind.Array || e.GetArrayLength() != a.GetArrayLength()) return false;
                var ea = e.EnumerateArray().ToArray(); var aa = a.EnumerateArray().ToArray();
                for (int i = 0; i < ea.Length; i++) if (!Same(ea[i], aa[i])) return false;
                return true;
            case JsonValueKind.Object:
                if (a.ValueKind != JsonValueKind.Object) return false;
                var ek = e.EnumerateObject().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToArray();
                var ak = a.EnumerateObject().Select(p => p.Name).OrderBy(x => x, StringComparer.Ordinal).ToArray();
                if (!ek.SequenceEqual(ak)) return false;
                foreach (var p in e.EnumerateObject()) if (!Same(p.Value, a.GetProperty(p.Name))) return false;
                return true;
            default: return false;
        }
    }

    static void Check(string label, object? actual, object? expected)
    {
        checks++;
        var e = expected is JsonElement je ? je : ToJson(expected);
        var a = actual is JsonElement ja ? ja : ToJson(actual);
        if (!Same(e, a))
        {
            failures++;
            string es = e.GetRawText(), az = a.GetRawText();
            Console.Error.WriteLine($"FAIL {label}\n  expected {(es.Length > 300 ? es[..300] + "..." : es)}\n  actual   {(az.Length > 300 ? az[..300] + "..." : az)}");
        }
    }

    static uint U(JsonElement e) => e.GetUInt32();
    static int I(JsonElement e) => e.GetInt32();
    static uint Hi15(uint s) => s & 0x7FFF0000;
    static Ivs4 IvsOf(JsonElement e) => new(I(e.GetProperty("hp")), I(e.GetProperty("atk")), I(e.GetProperty("def")), I(e.GetProperty("spa")), I(e.GetProperty("spd")), I(e.GetProperty("spe")));
    static object Pick(SeedTimeRow r) => new { year = r.Year, month = r.Month, day = r.Day, hour = r.Hour, minute = r.Minute, second = r.Second, delay = r.Delay };
    static object IvsObj(Ivs4 v) => new { hp = v.Hp, atk = v.Atk, def = v.Def, spe = v.Spe, spa = v.Spa, spd = v.Spd };

    static bool Sound(uint r, Ivs4 ivs, string method)
    {
        uint w1 = (uint)(ivs.Hp | (ivs.Atk << 5) | (ivs.Def << 10)) << 16;
        uint w2 = (uint)(ivs.Spe | (ivs.Spa << 5) | (ivs.Spd << 10)) << 16;
        uint s3 = SeedTime4.Next(r), s4 = SeedTime4.Next(s3), s5 = SeedTime4.Next(s4);
        return Hi15(s3) == w1 && Hi15(method == "M4" ? s5 : s4) == w2;
    }
    static List<object> BruteInverse(uint seed, int year, int? forceSecond)
    {
        var rows = new List<object>();
        for (int month = 1; month <= 12; month++) for (int day = 1; day <= SeedTime4.DaysInMonth(year, month); day++) for (int hour = 0; hour < 24; hour++)
            for (int minute = 0; minute < 60; minute++) for (int second = 0; second < 60; second++)
            {
                if (forceSecond is int fs && second != fs) continue;
                uint delay = unchecked(seed - Gen4.Seed(year, month, day, hour, minute, second, 0));
                if (delay <= 0xFFFF) rows.Add(new { year, month, day, hour, minute, second, delay });
            }
        return rows;
    }
    static bool PidSound(uint s0, uint pid) { uint s1 = SeedTime4.Next(s0), s2 = SeedTime4.Next(s1); return (((s2 >> 16) << 16) | (s1 >> 16)) == pid; }

    static object RowObj(CalibrateRow r) => new
    {
        year = r.Year, month = r.Month, day = r.Day, hour = r.Hour, minute = r.Minute, second = r.Second, delay = r.Delay,
        secondOffset = r.SecondOffset, delayOffset = r.DelayOffset, seed = r.Seed, sequence = r.Sequence,
        roamer = r.Roamer is null ? null : new { raikou = r.Roamer.Raikou, entei = r.Roamer.Entei, lati = r.Roamer.Lati, skips = r.Roamer.Skips, routeString = r.Roamer.RouteString }
    };

    static CalibrateOptions OptsOf(JsonElement o)
    {
        var co = new CalibrateOptions();
        if (o.TryGetProperty("year", out var y)) co.Year = I(y);
        if (o.TryGetProperty("forceSecond", out var fs) && fs.ValueKind == JsonValueKind.Number) co.ForceSecond = I(fs);
        if (o.TryGetProperty("elmWays", out var ew)) co.ElmWays = I(ew);
        if (o.TryGetProperty("roamers", out var rm) && rm.ValueKind == JsonValueKind.Object)
        {
            co.RoamerRaikou = rm.TryGetProperty("raikou", out var a) && a.ValueKind == JsonValueKind.True;
            co.RoamerEntei = rm.TryGetProperty("entei", out var b) && b.ValueKind == JsonValueKind.True;
            co.RoamerLati = rm.TryGetProperty("lati", out var c) && c.ValueKind == JsonValueKind.True;
        }
        if (o.TryGetProperty("routes", out var rt) && rt.ValueKind == JsonValueKind.Object)
        {
            co.RouteRaikou = rt.TryGetProperty("raikou", out var a) ? I(a) : 0;
            co.RouteEntei = rt.TryGetProperty("entei", out var b) ? I(b) : 0;
            co.RouteLati = rt.TryGetProperty("lati", out var c) ? I(c) : 0;
        }
        if (o.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Object)
        {
            co.Target = new SeedTimeRow(I(t.GetProperty("year")), I(t.GetProperty("month")), I(t.GetProperty("day")), I(t.GetProperty("hour")),
                I(t.GetProperty("minute")), I(t.GetProperty("second")), U(t.GetProperty("delay")), (int)U(t.GetProperty("delay")), 0);
        }
        return co;
    }

    public static int Run(string vectorsPath)
    {
        var v = JsonDocument.Parse(File.ReadAllText(vectorsPath)).RootElement;

        // 1. seedToTimes (PokeFinder's cases in its own convention: hour cd with the delay wrapped to a u32)
        foreach (var c in v.GetProperty("seedToTimes").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            uint seed = U(c.GetProperty("seed")); int year = I(c.GetProperty("year"));
            bool pf = c.TryGetProperty("convention", out var conv) && conv.GetString() == "pokefinder";
            var rows = SeedTime4.SeedToTimes(seed, year, I(c.GetProperty("forceSecond")), long.MaxValue, true, pf);
            Check($"seedToTimes {id}", rows.Select(Pick).ToList(), c.GetProperty("results"));
            Check($"seedToTimes {id} rows re-seed", rows.All(r => SeedTime4.CalcSeed(r.Year, r.Month, r.Day, r.Hour, r.Minute, r.Second, r.Delay) == seed), true);
            var all = SeedTime4.SeedToTimes(seed, year, null, long.MaxValue, true, pf);
            Check($"seedToTimes {id} unforced superset", all.Count >= rows.Count && all.All(r => SeedTime4.CalcSeed(r.Year, r.Month, r.Day, r.Hour, r.Minute, r.Second, r.Delay) == seed), true);
        }
        // 1b. the hardware decomposition against a brute force over every clock time with delay 0..65535 through Gen4.Seed
        foreach (var c in v.GetProperty("seedToTimesHardware").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            uint seed = U(c.GetProperty("seed")); int year = I(c.GetProperty("year"));
            int? forceSecond = c.TryGetProperty("forceSecond", out var fsE) && fsE.ValueKind == JsonValueKind.Number ? I(fsE) : null;
            bool bruteForce = !(c.TryGetProperty("bruteForce", out var bf) && bf.ValueKind == JsonValueKind.False);
            var rows = SeedTime4.SeedToTimes(seed, year, forceSecond);
            Check($"seedToTimesHardware {id} parity", rows.Select(Pick).ToList(), c.GetProperty("results"));
            Check($"seedToTimesHardware {id} rows re-seed", rows.All(r => Gen4.Seed(r.Year, r.Month, r.Day, r.Hour, r.Minute, r.Second, r.Delay) == seed), true);
            Check($"seedToTimesHardware {id} clock hours and non-negative delays", rows.All(r => r.Hour >= 0 && r.Hour <= 23 && r.DelaySigned >= 0 && (uint)r.DelaySigned == r.Delay), true);
            var brute = BruteInverse(seed, year, forceSecond);
            if (!bruteForce) Check($"seedToTimesHardware {id} beyond the brute force's delay range", new object[] { brute.Count, rows.Count > 0 && rows.All(r => r.Hour == 23 && r.Delay > 0xFFFF) }, new object[] { 0, true });
            else Check($"seedToTimesHardware {id} = brute force", rows.Select(Pick).ToList(), brute);
            Check($"seedToTimesHardware {id} PokeFinder convention on request", SeedTime4.SeedToTimes(seed, year, forceSecond, 1, true, true).Select(Pick).ToList(), c.GetProperty("pokefinder"));
        }
        {
            Check("seedToTimes carries into the hour byte", SeedTime4.SeedToTimes(0xE80E0001, 2018, null, 1).Select(r => new[] { r.Hour, r.Minute, r.Second, (int)r.Delay }).ToList(), new[] { new[] { 13, 57, 59, 65519 } });
            Check("seedToTimes hour byte 0 past 2000 + low16 has no time", SeedTime4.SeedToTimes(0x40000000, 2025).Count, 0);
            var carry = SeedTime4.SeedsToTimes(new[] { new Candidate4(0xE80E0001, 0, 14, 0xE8, 1, 0) }, new WantedFilter { YearMin = 2018, YearMax = 2018, DelayMax = 0xFFFFFF });
            Check("seedsToTimes carries into the hour byte", carry.Select(r => new[] { r.Hour, r.Delay }).ToList(), new[] { new[] { 13, 65519 } });
            Check("seedsToTimes hour byte 0 past 2000 + low16 has no time", SeedTime4.SeedsToTimes(new[] { new Candidate4(0x40000000, 0, 0, 0x40, 0, 0) }, new WantedFilter { YearMin = 2025, YearMax = 2025, DelayMax = 0xFFFFFF }).Count, 0);
            Check("seedsToTimes drops nothing the hardware can reach", SeedTime4.SeedsToTimes(new[] { new Candidate4(0xE80E0001, 0, 14, 0xE8, 1, 0) }, new WantedFilter { YearMin = 2000, YearMax = 2099, DelayMax = 0xFFFFFF, YearsPerCandidate = 100 }).Count, 100);
        }
        foreach (var c in v.GetProperty("carrySearch").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            uint seed = U(c.GetProperty("seed")); int frame = I(c.GetProperty("frame")); int year = I(c.GetProperty("year"));
            var ivs = IvsOf(c.GetProperty("ivs")); string method = c.GetProperty("method").GetString()!;
            var rows = SeedTime4.WantedToTimes(new WantedFilter { Ivs = ivs, Method = method, MaxFrame = 5, YearMin = year, YearMax = year, DelayMin = 0, DelayMax = 0xFFFFFF, Limit = 200 });
            var hit = rows.FirstOrDefault(r => r.Seed == seed && r.Frame == frame);
            if (c.GetProperty("expected").ValueKind == JsonValueKind.Object)
            {
                var e = c.GetProperty("expected");
                Check($"carrySearch {id} found", hit is null ? null : new[] { hit.Hour, hit.Delay }, new[] { I(e.GetProperty("hour")), I(e.GetProperty("delay")) });
                if (hit is not null) Check($"carrySearch {id} time re-seeds", Gen4.Seed(hit.Year, hit.Month, hit.Day, hit.Hour, hit.Minute, hit.Second, (uint)hit.Delay), seed);
            }
            else
            {
                Check($"carrySearch {id} has no time in {year}", hit is not null, false);
                int yearWithTime = I(c.GetProperty("yearWithTime"));
                var alt = SeedTime4.WantedToTimes(new WantedFilter { Ivs = ivs, Method = method, MaxFrame = 5, YearMin = yearWithTime, YearMax = yearWithTime, DelayMin = 0, DelayMax = 0xFFFFFF, Limit = 200 }).FirstOrDefault(r => r.Seed == seed && r.Frame == frame);
                Check($"carrySearch {id} found in {yearWithTime}", alt?.Delay, I(c.GetProperty("delayIn2000")));
            }
        }
        {
            var rows = SeedTime4.SeedToTimes(0x00190000, 2000, null, 1);
            Check("seedToTimes hour overflow -> 23 + delay", new[] { (uint)rows[0].Hour, rows[0].Delay }, new uint[] { 23, 0x20000 });
            Check("seedToTimes hour overflow re-seeds", SeedTime4.CalcSeed(rows[0].Year, rows[0].Month, rows[0].Day, rows[0].Hour, rows[0].Minute, rows[0].Second, rows[0].Delay), 0x00190000u);
            Check("seedToTimes strict hour filter", SeedTime4.SeedToTimes(0x00190000, 2000, null, long.MaxValue, false).Count, 0);
        }

        // 2. IDs
        foreach (var c in v.GetProperty("idGenerator").EnumerateArray())
        {
            var got = Gen4.SearchTid((uint)I(c.GetProperty("tid")), I(c.GetProperty("year")), I(c.GetProperty("month")), I(c.GetProperty("day")), I(c.GetProperty("hour")), I(c.GetProperty("minute")),
                U(c.GetProperty("minDelay")), U(c.GetProperty("maxDelay")), 1000000)
                .Select(r => new { delay = r.Delay, seconds = r.Second, seed = r.SeedValue, sid = r.Sid, tid = r.Tid, tsv = ((r.Tid ^ r.Sid) >> 3) & 0x1FFF }).ToList();
            Check($"idGenerator {c.GetProperty("id").GetString()}", got, c.GetProperty("results"));
        }
        foreach (var c in v.GetProperty("idSearcher").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            var hits = SeedTime4.TidToSeeds(I(c.GetProperty("tid")), I(c.GetProperty("year")), I(c.GetProperty("minDelay")), I(c.GetProperty("maxDelay")));
            Check($"idSearcher {id}", hits.Select(r => new { delay = r.Delay, seed = r.Seed, sid = r.Sid, tid = r.Tid, tsv = r.Tsv }).ToList(), c.GetProperty("results"));
            Check($"idSearcher {id} every hit re-derives through the full MT", hits.All(r => { var t = Gen4.TidSid(r.Seed); return t.Tid == r.Tid && t.Sid == r.Sid; }), true);
        }
        foreach (var c in v.GetProperty("mtSecond").EnumerateArray()) Check($"mtSecondOutput {U(c.GetProperty("seed"))}", SeedTime4.MtSecondOutput(U(c.GetProperty("seed"))), U(c.GetProperty("expected")));

        // 3. reversal
        var rev = v.GetProperty("lcrngReverse");
        foreach (var c in rev.GetProperty("ivs").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!; string method = c.GetProperty("method").GetString()!;
            var iv = c.GetProperty("ivs").EnumerateArray().Select(I).ToArray();
            var ivs = new Ivs4(iv[0], iv[1], iv[2], iv[3], iv[4], iv[5]);
            var got = SeedTime4.IvsToSeedsByMethod(ivs, method);
            Check($"lcrngReverse {id}", got, c.GetProperty("expected"));
            Check($"lcrngReverse {id} = prev(PokeFinder)", got.Select(SeedTime4.Next).ToList(), c.GetProperty("pokefinder"));
            Check($"lcrngReverse {id} sound", got.All(r => Sound(r, ivs, method)), true);
        }
        foreach (var c in rev.GetProperty("pid").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!; uint pid = U(c.GetProperty("pid"));
            var got = SeedTime4.PidToSeeds(pid);
            Check($"lcrngReverse {id}", got, c.GetProperty("expected"));
            Check($"lcrngReverse {id} sound", got.All(s0 => PidSound(s0, pid)), true);
        }
        var hist = new SortedDictionary<int, int>();
        int sum = 0, count = 0;
        foreach (var c in v.GetProperty("ivsRoundTrip").EnumerateArray())
        {
            uint origin = U(c.GetProperty("origin")); string method = c.GetProperty("method").GetString()!;
            var ivs = IvsOf(c.GetProperty("ivs"));
            var got = SeedTime4.IvsToSeedsByMethod(ivs, method);
            Check($"ivsRoundTrip {origin} {method} parity", got, c.GetProperty("results"));
            Check($"ivsRoundTrip {origin} {method} contains origin", got.Contains(origin), true);
            Check($"ivsRoundTrip {origin} {method} sound", got.All(r => Sound(r, ivs, method)), true);
            bool twins = got.Count % 2 == 0;
            for (int i = 1; i < got.Count; i += 2) if (got[i] != (got[i - 1] ^ 0x80000000)) twins = false;
            Check($"ivsRoundTrip {origin} {method} twins", twins, true);
            hist[got.Count] = hist.GetValueOrDefault(got.Count) + 1; sum += got.Count; count++;
        }
        Check("ivsRoundTrip histogram", hist.ToDictionary(k => k.Key.ToString(), k => k.Value), v.GetProperty("roundTripHistogram"));
        Check("ivsRoundTrip mean seeds per IV set near 4", sum / (double)count > 3 && sum / (double)count < 7, true);
        foreach (var c in v.GetProperty("pidRoundTrip").EnumerateArray())
        {
            uint s0 = U(c.GetProperty("frameSeed")); uint pid = U(c.GetProperty("pid"));
            var got = SeedTime4.PidToSeeds(pid);
            Check($"pidRoundTrip {s0} parity", got, c.GetProperty("results"));
            Check($"pidRoundTrip {s0} contains frame seed", got.Contains(s0), true);
            Check($"pidRoundTrip {s0} sound", got.All(s => PidSound(s, pid)), true);
        }
        foreach (var c in v.GetProperty("collisions").EnumerateArray())
            Check($"collisions {c.GetProperty("id").GetString()}", SeedTime4.IvsToSeedsByMethod(IvsOf(c.GetProperty("ivs")), c.GetProperty("method").GetString()!).Count, I(c.GetProperty("count")));
        {
            var pids = SeedTime4.ShinyPids(12345, 54321, 15);
            Check("shinyPids all shiny and Modest", pids.All(p => SeedTime4.IsShiny(p, 12345, 54321) && p % 25 == 15), true);
            Check("shinyPids count", pids.Count > 20000 && pids.Count < 22000, true);
            bool ok = true; int found = 0;
            for (int i = 0; i < 2000; i++) foreach (var s0 in SeedTime4.PidToSeeds(pids[i])) { found++; if (SeedTime4.MonFromFrameSeed(s0).Pid != pids[i]) ok = false; }
            Check("shinyPids -> pidToSeeds regenerate", ok && found > 1000, true);
        }

        // 4. gate
        foreach (var g in v.GetProperty("gate").EnumerateArray())
        {
            string id = g.GetProperty("id").GetString()!;
            uint seed = U(g.GetProperty("seed")); int frame = I(g.GetProperty("frame")); string method = g.GetProperty("method").GetString()!;
            int delayIn2000 = I(g.GetProperty("delayIn2000"));
            var mon = SeedTime4.MonFromFrameSeed(Lcrng.Jump(seed, (ulong)frame), method);
            Check($"gate {id} forward IVs", IvsObj(mon.Ivs), new { hp = 31, atk = 31, def = 31, spe = 31, spa = 31, spd = 31 });
            Check($"gate {id} IV1 state", Lcrng.Jump(seed, (ulong)(frame + 3)), U(g.GetProperty("ivState")));
            Check($"gate {id} hour byte", (int)((seed >> 16) & 0xFF), I(g.GetProperty("hour")));
            var rows = SeedTime4.WantedToTimes(new WantedFilter { Ivs = IvsOf(g.GetProperty("ivs")), Method = method, MaxFrame = 10, DelayMin = 0, DelayMax = 0xFFFF, YearMin = 2000, YearMax = 2000, TargetDelay = delayIn2000, Limit = 50 });
            var hit = rows.FirstOrDefault(r => r.Seed == seed && r.Frame == frame);
            Check($"gate {id} found by WantedToTimes", hit is not null, true);
            if (hit is not null)
            {
                Check($"gate {id} delay in 2000", hit.Delay, delayIn2000);
                Check($"gate {id} time re-seeds", Gen4.Seed(hit.Year, hit.Month, hit.Day, hit.Hour, hit.Minute, hit.Second, (uint)hit.Delay), seed);
                Check($"gate {id} first row is the target delay", rows[0].DelayDistance, 0);
            }
            var none = SeedTime4.WantedToTimes(new WantedFilter { Ivs = IvsOf(g.GetProperty("ivs")), Method = method, MaxFrame = 10, YearMin = 2000, YearMax = 2000, DelayMin = delayIn2000 + 1, DelayMax = delayIn2000 + 1, Limit = 50 });
            Check($"gate {id} excluded by a delay window that misses it", none.Any(r => r.Seed == seed), false);
        }
        {
            var cand = SeedTime4.ReachableSeeds(new uint[] { 0x68501323 }, 2, 8);
            Check("reachableSeeds hour filter", cand.All(c => c.Hour <= 23), true);
            Check("reachableSeeds frames", cand.Select(c => new object[] { SeedTime4.Hex8(c.Seed), c.Frame }).ToList(), new object[] { new object[] { "7B0448D1", 0 }, new object[] { "5D12A61D", 4 }, new object[] { "E2028A12", 5 } });
            Check("reachableSeeds unfiltered count", SeedTime4.ReachableSeeds(new uint[] { 0x68501323 }, 2, 8, 0, true).Count, 9);
        }

        // 5. calibrate rows
        foreach (var c in v.GetProperty("calibrate").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            uint seed = U(c.GetProperty("seed")); int dr = I(c.GetProperty("delayRange")), sr = I(c.GetProperty("secondRange"));
            var opts = OptsOf(c.GetProperty("opts"));
            var rows = SeedTime4.CalibrateRows(seed, dr, sr, c.GetProperty("game").GetString()!, opts);
            var expectedRows = c.GetProperty("rows").EnumerateArray().ToArray();
            Check($"calibrate {id} row count", rows.Count, expectedRows.Length);
            Check($"calibrate {id} centre row is the target", rows.Any(r => r.SecondOffset == 0 && r.DelayOffset == 0 && r.Seed == seed), true);
            for (int i = 0; i < Math.Min(rows.Count, expectedRows.Length); i++)
            {
                var r = rows[i]; var e = expectedRows[i];
                Check($"calibrate {id} row {i} parity", RowObj(r), ToJson(new
                {
                    year = I(e.GetProperty("year")), month = I(e.GetProperty("month")), day = I(e.GetProperty("day")), hour = I(e.GetProperty("hour")), minute = I(e.GetProperty("minute")), second = I(e.GetProperty("second")),
                    delay = U(e.GetProperty("delay")), secondOffset = I(e.GetProperty("secondOffset")), delayOffset = I(e.GetProperty("delayOffset")), seed = U(e.GetProperty("seed")), sequence = e.GetProperty("sequence").GetString(),
                    roamer = e.TryGetProperty("roamer", out var ro) && ro.ValueKind == JsonValueKind.Object
                        ? new { raikou = I(ro.GetProperty("raikou")), entei = I(ro.GetProperty("entei")), lati = I(ro.GetProperty("lati")), skips = I(ro.GetProperty("skips")), routeString = ro.GetProperty("routeString").GetString() } : null
                }));
                Check($"calibrate {id} row {i} seed", Gen4.Seed(r.Year, r.Month, r.Day, r.Hour, r.Minute, r.Second, r.Delay), r.Seed);
                if (r.Flips is not null)
                {
                    Check($"calibrate {id} row {i} flips", r.Flips, Gen4.CoinFlips(r.Seed, 20));
                    Check($"calibrate {id} row {i} sequence", r.Sequence, string.Join(", ", r.Flips.ToCharArray()));
                }
                else
                {
                    int skips = r.Roamer?.Skips ?? 0;
                    if (opts.ElmWays == 3) Check($"calibrate {id} row {i} calls", r.Calls, Gen4.ElmCalls(r.Seed, 20, skips));
                    else
                    {
                        uint s = r.Seed; var sb = new System.Text.StringBuilder();
                        for (int k = 0; k < 20 + skips; k++) { s = Lcrng.Next(s); if (k >= skips) sb.Append(Lcrng.Hi(s) % 2 == 0 ? 'E' : 'K'); }
                        Check($"calibrate {id} row {i} two-way calls", r.Calls, sb.ToString());
                    }
                    Check($"calibrate {id} row {i} sequence ends with calls", new string(r.Sequence.Where(ch => ch is 'E' or 'K' or 'P').ToArray())[^20..], r.Calls);
                    Check($"calibrate {id} row {i} legend covers the letters", r.Calls!.All(ch => SeedTime4.ElmLegend[opts.ElmWays == 2 ? 2 : 3].ContainsKey(ch)), true);
                    if (skips > 0) Check($"calibrate {id} row {i} skipped shown", r.Sequence.Contains(" skipped)  ") && r.Sequence[0] == '(', true);
                }
            }
        }
        {
            var rows = SeedTime4.CalibrateRows(0x01000000, 0, 2, "DP", new CalibrateOptions { Year = 2000, ForceSecond = 0 });
            Check("calibrate underflow before 2000-01-01 skips rows", rows.Select(r => r.SecondOffset).ToList(), new[] { 0, 1, 2 });
            var wrap = SeedTime4.CalibrateRows(0xEA17FFFF, 0, 1, "DP", new CalibrateOptions { Target = new SeedTimeRow(2099, 12, 31, 23, 59, 59, 65535 - 99, 65535 - 99, 0) });
            Check("calibrate wrap past 2099 goes to 2000-01-01", wrap.Select(r => new[] { r.Year, r.Month, r.Day, r.Hour, r.Minute, r.Second }).ToList(),
                new[] { new[] { 2099, 12, 31, 23, 59, 58 }, new[] { 2099, 12, 31, 23, 59, 59 }, new[] { 2000, 1, 1, 0, 0, 0 } });
        }

        // 6. roamers and Chatot
        foreach (var c in v.GetProperty("roamer").EnumerateArray())
        {
            var rm = c.GetProperty("roamers"); var rt = c.GetProperty("routes");
            var got = SeedTime4.RoamerRoutes(U(c.GetProperty("seed")), rm.GetProperty("raikou").GetBoolean(), rm.GetProperty("entei").GetBoolean(), rm.GetProperty("lati").GetBoolean(),
                I(rt.GetProperty("raikou")), I(rt.GetProperty("entei")), I(rt.GetProperty("lati")));
            Check($"roamer {c.GetProperty("id").GetString()}", new { raikou = got.Raikou, entei = got.Entei, lati = got.Lati, skips = got.Skips, routeString = got.RouteString }, c.GetProperty("expected"));
        }
        foreach (var c in v.GetProperty("chatot").EnumerateArray())
            Check($"chatot {U(c.GetProperty("seed"))}", SeedTime4.ChatotSequence(U(c.GetProperty("seed")), I(c.GetProperty("count"))).Select(p => new { value = p.Value, band = p.Band }).ToList(), c.GetProperty("expected"));
        Check("chatot bands at the PokeFinder thresholds 20/40/60/80", new uint[] { 0, 1638, 1639, 3277, 4915, 4916, 6554, 8191 }.Select(r => SeedTime4.ChatotPitchOf(r).Band).ToList(), new[] { "L", "L", "ML", "M", "M", "MH", "H", "H" });

        // 7. planner
        foreach (var c in v.GetProperty("planner").EnumerateArray())
        {
            string id = c.GetProperty("id").GetString()!;
            var got = SeedTime4.PlanAdvances(I(c.GetProperty("current")), I(c.GetProperty("target")), I(c.GetProperty("partyCount")), c.GetProperty("tools").EnumerateArray().Select(t => t.GetString()!).ToArray());
            Check($"planner {id}", new { needed = got.Needed, plan = got.Plan.Select(p => new { tool = p.Tool, uses = p.Uses, perUse = p.PerUse, advances = p.Advances }).ToList(), remainder = got.Remainder }, c.GetProperty("expected"));
            Check($"planner {id} sums", got.Plan.Sum(p => p.Advances) + got.Remainder, Math.Max(0, got.Needed));
        }
        Check("planner costs labelled", SeedTime4.AdvanceTools.Values.All(t => (t.Label == "STRUCTURAL" || t.Label == "EMPIRICAL") && t.Cite.Length > 10), true);
        Check("planner journal is EMPIRICAL", SeedTime4.AdvanceTools["journal"].Label, "EMPIRICAL");
        Check("planner coin flip costs nothing", SeedTime4.AdvanceTools["coinFlip"].PerUse, 0);

        Check("ElmLegend two-way names both branches", new[] { 'E', 'K' }.All(k => SeedTime4.ElmLegend[2][k].Contains(":86") && SeedTime4.ElmLegend[2][k].Contains(":59"))
            && SeedTime4.ElmLegend[2]['E'].Contains("egg", StringComparison.OrdinalIgnoreCase) && SeedTime4.ElmLegend[2]['K'].Contains("hatched", StringComparison.OrdinalIgnoreCase), true);
        Check("ElmLegend three-way", SeedTime4.ElmLegend[3].Keys.OrderBy(k => k).ToArray(), new[] { 'E', 'K', 'P' });

        // 8. input checking
        SeedTimeRow Target(int year = 2000, int month = 1, int day = 1, int hour = 0, int minute = 0, int second = 0, uint delay = 0) => new(year, month, day, hour, minute, second, delay, unchecked((int)delay), 0);
        Action WithTarget(SeedTimeRow t) => () => SeedTime4.CalibrateRows(0, 0, 0, "DP", new CalibrateOptions { Target = t });
        Check("calibrateRows accepts a valid target", SeedTime4.CalibrateRows(0, 0, 0, "DP", new CalibrateOptions { Target = Target() }).Count, 1);
        foreach (var (label, bad) in new (string, Action)[]
        {
            ("year 1999", () => SeedTime4.SeedToTimes(1, 1999)), ("forceSecond 60", () => SeedTime4.SeedToTimes(1, 2000, 60)),
            ("iv 32", () => SeedTime4.IvsToSeeds(32, 0, 0, 0, 0, 0)), ("game Emerald", () => SeedTime4.CalibrateRows(0, 1, 1, "Emerald")),
            ("tool bicycle", () => SeedTime4.PlanAdvances(0, 5, 1, new[] { "bicycle" })), ("empty filter", () => SeedTime4.WantedToTimes(new WantedFilter())),
            ("tid 70000", () => SeedTime4.TidToSeeds(70000, 2000, 0, 1)),
            ("target delay -1 (u32)", WithTarget(Target(delay: unchecked((uint)-1)))), ("target delay 0x1000000", WithTarget(Target(delay: 0x1000000))),
            ("target hour 24", WithTarget(Target(hour: 24))), ("target Feb 30", WithTarget(Target(month: 2, day: 30))), ("target year 1999", WithTarget(Target(year: 1999))),
            ("target minute 60", WithTarget(Target(minute: 60)))
        })
        {
            bool threw = false; try { bad(); } catch (ArgumentException) { threw = true; }
            Check("refuses " + label, threw, true);
        }

        if (failures > 0) { Console.Error.WriteLine($"{failures} failure(s) in {checks} seedtime4 checks"); return 1; }
        Console.WriteLine($"all {checks} seedtime4 checks passed (C#)");
        return 0;
    }

    // The cross-check emitter: answers tests/seedtime4-cross.cjs inputs with the same field names.
    public static int Cross(string inputsPath, string outPath)
    {
        var inp = JsonDocument.Parse(File.ReadAllText(inputsPath)).RootElement;
        int? OptInt(JsonElement e, string name) => e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number ? I(p) : null;
        var result = new
        {
            seedToTimes = inp.GetProperty("seedToTimes").EnumerateArray().Select(c => SeedTime4.SeedToTimes(U(c.GetProperty("seed")), I(c.GetProperty("year")), OptInt(c, "forceSecond"), 200, true,
                c.TryGetProperty("pokefinderDelay", out var pfd) && pfd.ValueKind == JsonValueKind.True).Select(Pick).ToList()).ToList(),
            calibrate = inp.GetProperty("calibrate").EnumerateArray().Select(c => SeedTime4.CalibrateRows(U(c.GetProperty("seed")), I(c.GetProperty("delayRange")), I(c.GetProperty("secondRange")), c.GetProperty("game").GetString()!, OptsOf(c)).Select(RowObj).ToList()).ToList(),
            ivs = inp.GetProperty("ivs").EnumerateArray().Select(c => { var iv = c.GetProperty("ivs").EnumerateArray().Select(I).ToArray(); return SeedTime4.IvsToSeedsByMethod(new Ivs4(iv[0], iv[1], iv[2], iv[3], iv[4], iv[5]), c.GetProperty("method").GetString()!); }).ToList(),
            pids = inp.GetProperty("pids").EnumerateArray().Select(p => SeedTime4.PidToSeeds(U(p))).ToList(),
            reachable = inp.GetProperty("reachable").EnumerateArray().Select(c => SeedTime4.ReachableSeeds(c.GetProperty("origins").EnumerateArray().Select(U), I(c.GetProperty("callsBefore")), I(c.GetProperty("maxFrame")))
                .Select(r => new { seed = r.Seed, frame = r.Frame, hour = r.Hour, origin = r.Origin }).ToList()).ToList(),
            wanted = inp.GetProperty("wanted").EnumerateArray().Select(w =>
            {
                var f = new WantedFilter
                {
                    Ivs = w.TryGetProperty("ivs", out var iv) && iv.ValueKind == JsonValueKind.Object ? IvsOf(iv) : null,
                    Pid = w.TryGetProperty("pid", out var pid) && pid.ValueKind == JsonValueKind.Number ? U(pid) : null,
                    Tid = OptInt(w, "tid"), Sid = OptInt(w, "sid"), Method = w.GetProperty("method").GetString()!, MaxFrame = I(w.GetProperty("maxFrame")),
                    DelayMin = I(w.GetProperty("delayMin")), DelayMax = I(w.GetProperty("delayMax")), TargetDelay = I(w.GetProperty("targetDelay")),
                    YearMin = I(w.GetProperty("yearMin")), YearMax = I(w.GetProperty("yearMax")), Limit = I(w.GetProperty("limit")), ForceSecond = OptInt(w, "forceSecond")
                };
                return SeedTime4.WantedToTimes(f).Select(r => new
                {
                    seed = r.Seed, frame = r.Frame, year = r.Year, month = r.Month, day = r.Day, hour = r.Hour, minute = r.Minute, second = r.Second, delay = r.Delay, delayDistance = r.DelayDistance,
                    pid = r.Pid, nature = r.Nature, ivs = new[] { r.Ivs!.Hp, r.Ivs.Atk, r.Ivs.Def, r.Ivs.Spa, r.Ivs.Spd, r.Ivs.Spe }, shiny = r.Shiny
                }).ToList();
            }).ToList(),
            planner = inp.GetProperty("planner").EnumerateArray().Select(c =>
            {
                var p = SeedTime4.PlanAdvances(I(c.GetProperty("current")), I(c.GetProperty("target")), I(c.GetProperty("partyCount")), c.GetProperty("tools").EnumerateArray().Select(t => t.GetString()!).ToArray());
                return new { needed = p.Needed, plan = p.Plan.Select(s => new { tool = s.Tool, uses = s.Uses, perUse = s.PerUse, advances = s.Advances }).ToList(), remainder = p.Remainder };
            }).ToList(),
            tidToSeeds = inp.GetProperty("tidToSeeds").EnumerateArray().Select(c => SeedTime4.TidToSeeds(I(c.GetProperty("tid")), I(c.GetProperty("year")), I(c.GetProperty("delayMin")), I(c.GetProperty("delayMax")))
                .Select(r => new { seed = r.Seed, delay = r.Delay, tid = r.Tid, sid = r.Sid, tsv = r.Tsv }).ToList()).ToList(),
            mtSecond = inp.GetProperty("mtSecond").EnumerateArray().Select(s => SeedTime4.MtSecondOutput(U(s))).ToList(),
            chatot = inp.GetProperty("chatot").EnumerateArray().Select(c => SeedTime4.ChatotSequence(U(c.GetProperty("seed")), I(c.GetProperty("count"))).Select(p => new { value = p.Value, band = p.Band }).ToList()).ToList()
        };
        File.WriteAllText(outPath, JsonSerializer.Serialize(result, Out));
        Console.WriteLine($"seedtime4 cross-check answers written to {outPath}");
        return 0;
    }
}
