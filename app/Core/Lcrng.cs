namespace ShinySolution.Core;

public static class Lcrng
{
    public const uint Mult = 0x41C64E6D;
    public const uint Add = 0x6073;
    public const double GbaFps = 16777216.0 / 280896.0;
    public const uint DeadBatterySeedRs = 0x5A0;

    public static uint Next(uint s) => s * Mult + Add;

    public static uint Jump(uint s, ulong n)
    {
        uint a = Mult, c = Add, r = s;
        while (n > 0)
        {
            if ((n & 1) == 1) r = a * r + c;
            c = a * c + c;
            a *= a;
            n >>= 1;
        }
        return r;
    }

    public static uint Hi(uint s) => s >> 16;
}
