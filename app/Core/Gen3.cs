namespace ShinySolution.Core;

public readonly record struct Ivs(int Hp, int Atk, int Def, int Spa, int Spd, int Spe)
{
    public int Min() => Math.Min(Hp, Math.Min(Atk, Math.Min(Def, Math.Min(Spa, Math.Min(Spd, Spe)))));
    public override string ToString() => $"{Hp}/{Atk}/{Def}/{Spa}/{Spd}/{Spe}";
}

public readonly record struct Mon(long Advance, uint Pid, int Nature, int GenderValue, Ivs Ivs)
{
    public string NatureName => Gen3.Natures[Nature];
    public char Gender(int threshold = 31) => GenderValue < threshold ? 'F' : 'M';
    public bool IsShiny(uint tid, uint sid) => Gen3.IsShiny(Pid, tid, sid);
}

public sealed record MonFilter(int? Nature, char? Gender, int MinIv, int GenderThreshold = 31)
{
    public bool Matches(in Mon mon)
    {
        if (Nature is int n && mon.Nature != n) return false;
        if (Gender is char g && mon.Gender(GenderThreshold) != g) return false;
        if (MinIv > 0 && mon.Ivs.Min() < MinIv) return false;
        return true;
    }
}

public static class Gen3
{
    public static readonly string[] Natures =
    {
        "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
        "Bold", "Docile", "Relaxed", "Impish", "Lax",
        "Timid", "Hasty", "Serious", "Jolly", "Naive",
        "Modest", "Mild", "Quiet", "Bashful", "Rash",
        "Calm", "Gentle", "Sassy", "Careful", "Quirky"
    };

    public static Ivs IvsFromWords(uint w1, uint w2) => new(
        (int)(w1 & 31), (int)((w1 >> 5) & 31), (int)((w1 >> 10) & 31),
        (int)((w2 >> 5) & 31), (int)((w2 >> 10) & 31), (int)(w2 & 31));

    public static Mon Method1(uint state, long advance)
    {
        uint s1 = Lcrng.Next(state);
        uint s2 = Lcrng.Next(s1);
        uint s3 = Lcrng.Next(s2);
        uint s4 = Lcrng.Next(s3);
        uint pid = (Lcrng.Hi(s2) << 16) | Lcrng.Hi(s1);
        return new Mon(advance, pid, (int)(pid % 25), (int)(pid & 255), IvsFromWords(Lcrng.Hi(s3), Lcrng.Hi(s4)));
    }

    public static bool IsShiny(uint pid, uint tid, uint sid) =>
        ((tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) & 0xFFFF) < 8;

    public static List<Mon> SearchStarter(uint startState, long startAdvance, uint tid, uint sid,
        long maxAdvance, MonFilter? filter = null, int limit = 10)
    {
        var results = new List<Mon>();
        uint s = startState;
        for (long i = startAdvance; i <= maxAdvance; i++)
        {
            uint t1 = Lcrng.Next(s);
            uint t2 = Lcrng.Next(t1);
            uint pid = (Lcrng.Hi(t2) << 16) | Lcrng.Hi(t1);
            if (IsShiny(pid, tid, sid))
            {
                var mon = Method1(s, i);
                if (filter is null || filter.Matches(mon))
                {
                    results.Add(mon);
                    if (results.Count >= limit) break;
                }
            }
            s = t1;
        }
        return results;
    }

    public static List<(long Advance, uint Tid, uint Sid)> SearchTid(uint startState, long startAdvance,
        uint targetTid, long maxAdvance, int limit = 10)
    {
        var results = new List<(long, uint, uint)>();
        uint s = startState;
        for (long i = startAdvance; i <= maxAdvance; i++)
        {
            uint t1 = Lcrng.Next(s);
            uint t2 = Lcrng.Next(t1);
            if (Lcrng.Hi(t2) == targetTid)
            {
                results.Add((i, Lcrng.Hi(t2), Lcrng.Hi(t1)));
                if (results.Count >= limit) break;
            }
            s = t1;
        }
        return results;
    }

    public static List<(long Advance, uint Tid, uint Sid)> FindByTid(uint startState, long startAdvance,
        uint tid, uint? sid, long maxAdvance)
    {
        var results = new List<(long, uint, uint)>();
        uint s = startState;
        for (long i = startAdvance; i <= maxAdvance; i++)
        {
            uint t1 = Lcrng.Next(s);
            uint t2 = Lcrng.Next(t1);
            if (Lcrng.Hi(t2) == tid && (sid is null || Lcrng.Hi(t1) == sid))
            {
                results.Add((i, Lcrng.Hi(t2), Lcrng.Hi(t1)));
            }
            s = t1;
        }
        return results;
    }

    public static List<Mon> FindByMon(uint startState, long startAdvance, long maxAdvance,
        int? nature, char? gender, int genderThreshold = 31)
    {
        var results = new List<Mon>();
        uint s = startState;
        for (long i = startAdvance; i <= maxAdvance; i++)
        {
            var mon = Method1(s, i);
            bool ok = nature is not int n || mon.Nature == n;
            if (ok && gender is char g && mon.Gender(genderThreshold) != g) ok = false;
            if (ok) results.Add(mon);
            s = Lcrng.Next(s);
        }
        return results;
    }

    public static T? Nearest<T>(IReadOnlyList<T> candidates, long target, Func<T, long> advanceOf) where T : struct
    {
        T? best = null;
        foreach (var c in candidates)
        {
            if (best is null || Math.Abs(advanceOf(c) - target) < Math.Abs(advanceOf(best.Value) - target))
                best = c;
        }
        return best;
    }
}

public static class Gen3Stats
{
    public static readonly IReadOnlyDictionary<string, int[]> StartersRs = new Dictionary<string, int[]>
    {
        ["Treecko"] = new[] { 40, 45, 35, 65, 55, 70 },
        ["Torchic"] = new[] { 45, 60, 40, 70, 50, 45 },
        ["Mudkip"] = new[] { 50, 70, 50, 50, 50, 40 }
    };

    static readonly int[] StatOrder = { 1, 2, 5, 3, 4 };

    public static int[] StatsAtLevel(int[] baseStats, in Ivs ivs, int level, int nature)
    {
        int[] ivArr = { ivs.Hp, ivs.Atk, ivs.Def, ivs.Spa, ivs.Spd, ivs.Spe };
        int[] baseOrdered = { baseStats[0], baseStats[1], baseStats[2], baseStats[3], baseStats[4], baseStats[5] };
        var outStats = new int[6];
        outStats[0] = (2 * baseOrdered[0] + ivArr[0]) * level / 100 + level + 10;
        int plus = nature / 5, minus = nature % 5;
        for (int k = 0; k < 5; k++)
        {
            int idx = StatOrder[k];
            int raw = (2 * baseOrdered[idx] + ivArr[idx]) * level / 100 + 5;
            int mod = 100;
            if (plus != minus)
            {
                if (k == plus) mod = 110;
                else if (k == minus) mod = 90;
            }
            outStats[idx] = raw * mod / 100;
        }
        return outStats;
    }
}
