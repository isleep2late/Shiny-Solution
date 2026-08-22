using System.Media;

namespace ShinySolution.App;

public static class BeepPlayer
{
    static readonly SoundPlayer ShortBeep = Create(880, 70);
    static readonly SoundPlayer LongBeep = Create(1320, 300);

    public static void PlayShort() => Play(ShortBeep);
    public static void PlayLong() => Play(LongBeep);

    static void Play(SoundPlayer player)
    {
        try { player.Play(); } catch { }
    }

    static SoundPlayer Create(double freq, int durationMs)
    {
        const int rate = 44100;
        int samples = rate * durationMs / 1000;
        int dataSize = samples * 2;
        var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        w.Write("RIFF"u8);
        w.Write(36 + dataSize);
        w.Write("WAVE"u8);
        w.Write("fmt "u8);
        w.Write(16);
        w.Write((short)1);
        w.Write((short)1);
        w.Write(rate);
        w.Write(rate * 2);
        w.Write((short)2);
        w.Write((short)16);
        w.Write("data"u8);
        w.Write(dataSize);
        int fade = Math.Min(samples / 10, 200);
        for (int i = 0; i < samples; i++)
        {
            double amp = 0.5;
            if (i < fade) amp *= i / (double)fade;
            if (i > samples - fade) amp *= (samples - i) / (double)fade;
            w.Write((short)(Math.Sin(2 * Math.PI * freq * i / rate) * amp * short.MaxValue));
        }
        ms.Position = 0;
        var player = new SoundPlayer(ms);
        try { player.Load(); } catch { }
        return player;
    }
}
