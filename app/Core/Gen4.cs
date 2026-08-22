using System.Text;

namespace ShinySolution.Core;

public sealed class Mt19937
{
    readonly uint[] _state = new uint[624];
    int _index;

    public Mt19937(uint seed)
    {
        _state[0] = seed;
        for (uint i = 1; i < 624; i++)
        {
            _state[i] = 1812433253u * (_state[i - 1] ^ (_state[i - 1] >> 30)) + i;
        }
        _index = 624;
    }

    void Generate()
    {
        for (int i = 0; i < 624; i++)
        {
            uint y = (_state[i] & 0x80000000u) | (_state[(i + 1) % 624] & 0x7FFFFFFFu);
            uint next = _state[(i + 397) % 624] ^ (y >> 1);
            if ((y & 1) != 0) next ^= 0x9908B0DFu;
            _state[i] = next;
        }
        _index = 0;
    }

    public uint Next()
    {
        if (_index >= 624) Generate();
        uint y = _state[_index++];
        y ^= y >> 11;
        y ^= (y << 7) & 0x9D2C5680u;
        y ^= (y << 15) & 0xEFC60000u;
        y ^= y >> 18;
        return y;
    }
}

public static class Gen4
{
    public const double NdsFps = 59.8261;

    public static uint Seed(int year, int month, int day, int hour, int minute, int second, uint delay)
        => ((uint)(month * day + minute + second) << 24) + ((uint)hour << 16) + (uint)(year - 2000) + delay;

    public static (uint Tid, uint Sid) TidSid(uint seed)
    {
        var mt = new Mt19937(seed);
        mt.Next();
        uint r = mt.Next();
        return (r & 0xFFFF, r >> 16);
    }

    public static string CoinFlips(uint seed, int count)
    {
        var mt = new Mt19937(seed);
        var sb = new StringBuilder(count);
        for (int i = 0; i < count; i++)
        {
            sb.Append((mt.Next() & 1) == 0 ? 'T' : 'H');
        }
        return sb.ToString();
    }

    public static string ElmCalls(uint seed, int count, int skips)
    {
        uint s = seed;
        for (int i = 0; i < skips; i++) s = Lcrng.Next(s);
        var sb = new StringBuilder(count);
        for (int i = 0; i < count; i++)
        {
            s = Lcrng.Next(s);
            sb.Append((Lcrng.Hi(s) % 3) switch { 0 => 'E', 1 => 'K', _ => 'P' });
        }
        return sb.ToString();
    }

    public static List<(int Second, uint Delay, uint SeedValue, uint Tid, uint Sid)> SearchTid(
        uint targetTid, int year, int month, int day, int hour, int minute,
        uint delayMin, uint delayMax, int limit = 20)
    {
        var results = new List<(int, uint, uint, uint, uint)>();
        for (int second = 0; second < 60; second++)
        {
            for (uint delay = delayMin; delay <= delayMax; delay++)
            {
                uint seed = Seed(year, month, day, hour, minute, second, delay);
                var (tid, sid) = TidSid(seed);
                if (tid == targetTid)
                {
                    results.Add((second, delay, seed, tid, sid));
                    if (results.Count >= limit) return results;
                }
            }
        }
        return results;
    }

    public static List<(int Second, uint Delay, uint SeedValue)> MatchCoinFlips(
        string flips, int year, int month, int day, int hour, int minute,
        int secondCenter, int secondRadius, uint delayMin, uint delayMax, int limit = 20)
    {
        var results = new List<(int, uint, uint)>();
        string wanted = flips.Trim().ToUpperInvariant();
        if (wanted.Length == 0) return results;
        int lo = Math.Max(0, secondCenter - secondRadius);
        int hi = Math.Min(59, secondCenter + secondRadius);
        for (int second = lo; second <= hi; second++)
        {
            for (uint delay = delayMin; delay <= delayMax; delay++)
            {
                uint seed = Seed(year, month, day, hour, minute, second, delay);
                if (CoinFlips(seed, wanted.Length) == wanted)
                {
                    results.Add((second, delay, seed));
                    if (results.Count >= limit) return results;
                }
            }
        }
        return results;
    }
}

public sealed class Gen4Timer
{
    public double CalibratedDelay { get; set; } = 500;
    public double CalibratedSecond { get; set; } = 14;
    public uint TargetDelay { get; set; }
    public int TargetSecond { get; set; }

    public static double ToMs(double delays) => delays * 1000.0 / Gen4.NdsFps;
    public static double ToDelays(double ms) => ms * Gen4.NdsFps / 1000.0;

    public double CalibrationMs => ToMs(CalibratedDelay) - CalibratedSecond * 1000.0;

    public (double Phase1Ms, double Phase2Ms) Phases()
    {
        double calibration = CalibrationMs;
        double p2 = ToMs(TargetDelay) - calibration;
        double p1 = TargetSecond * 1000.0 + calibration + 200.0 - ToMs(TargetDelay);
        while (p1 < 14000) p1 += 60000;
        return (p1, p2);
    }

    // The two-phase countdown spans this many whole minutes. Because the seed depends on the
    // clock minute at boot, the DS clock must be set this many minutes BEFORE the target
    // minute so the A press at the end of phase 2 lands inside the target minute. EonTimer
    // computes the rollover with calibration held at 0 for stability, so we do too.
    public int MinutesBefore()
    {
        double p2 = ToMs(TargetDelay);
        double p1 = TargetSecond * 1000.0 + 200.0 - ToMs(TargetDelay);
        while (p1 < 14000) p1 += 60000;
        return (int)Math.Floor((p1 + p2) / 60000.0);
    }

    public void Calibrate(uint hitDelay)
    {
        double delta = ToMs(hitDelay) - ToMs(TargetDelay);
        if (Math.Abs(delta) <= 167) delta *= 0.75;
        CalibratedDelay += ToDelays(delta);
    }
}
