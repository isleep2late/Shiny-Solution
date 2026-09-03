namespace ShinySolution.Core;

// The RUN / PRACTICE-HUNT wall's vocabulary, shared by the desktop app and the tests (the web
// app's copy is webapp/mode.js). RUN is the default; PRACTICE / HUNT is turned on explicitly.
// Every calibration record carries the mode it was made in, each mode keeps its own store key,
// and a record of the other mode that turns up in a store is left out (SplitByMode), so a
// practice-derived correction is never in force in RUN mode. The same split and the same store
// keys cover the Gen 1 TID panel's reset adjustments and Secret ID pins.
public static class Modes
{
    public const string Run = "run";
    public const string Practice = "practice";
    public const string Banner = "PRACTICE / HUNT mode - tools that read the capture are enabled; not for submitted runs";

    public static bool IsMode(string? m) => m == Run || m == Practice;
    public static string Check(string? m)
        => IsMode(m) ? m! : throw new ArgumentException($"mode must be \"run\" or \"practice\", not {(m is null ? "null" : "\"" + m + "\"")}");
    public static string Label(string? m) => Check(m) == Practice ? "PRACTICE / HUNT" : "RUN";
    // The label of a stored record's mode, for notes about records that are left out: tolerant of a
    // value this head does not know (a typo, an empty string, a mode a later hunt head writes), which
    // is named as unknown rather than thrown on, so one bad record never breaks a panel. Such a record
    // is in force in neither mode (SplitByMode keeps only exact matches).
    public static string Describe(string? stored)
    {
        var m = Effective(stored);
        return IsMode(m) ? Label(m) : "\"" + m + "\" (unknown mode)";
    }

    // The mode a stored record was made in. A record without one was written before modes existed,
    // by a head that had no capture-reading tool at all, so it is a RUN record; a practice-derived
    // record always carries "practice", stamped by the head that made it.
    public static string Effective(string? stored) => stored ?? Run;

    // (the records made in this mode, all the others); the others are never averaged in.
    public static (List<T> Kept, List<T> Others) SplitByMode<T>(IEnumerable<T> records, Func<T, string?> modeOf, string mode)
    {
        Check(mode);
        var list = records.ToList();
        return (list.Where(r => Effective(modeOf(r)) == mode).ToList(), list.Where(r => Effective(modeOf(r)) != mode).ToList());
    }

    // Each mode's store is its own key: RUN keeps the key as it was, PRACTICE / HUNT gets ".practice".
    public static string StoreKey(string baseKey, string mode) => Check(mode) == Practice ? baseKey + ".practice" : baseKey;
}
