namespace ShinySolution.Core;

public static class TimerMath
{
    public static double AdvancesToMs(long n, double fps = Lcrng.GbaFps) => n * 1000.0 / fps;

    public static long MsToAdvances(double ms, double fps = Lcrng.GbaFps) => (long)Math.Round(ms * fps / 1000.0);

    public static string FmtMs(double ms)
    {
        long total = Math.Max(0, (long)Math.Round(ms));
        long m = total / 60000;
        long s = total % 60000 / 1000;
        long frac = total % 1000;
        return $"{m:00}:{s:00}.{frac:000}";
    }
}
