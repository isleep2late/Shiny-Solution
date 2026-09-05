using System.Media;
using ShinySolution.Core;

namespace ShinySolution.App;

public static class BeepPlayer
{
    public const int Rate = 44100;
    const double Amplitude = 0.5;
    const double AttackMs = 2.0;      // short ramps so the tones do not click
    const double ReleaseMs = 5.0;

    static readonly SoundPlayer ShortBeep = Create(880, 70);
    static readonly SoundPlayer LongBeep = Create(1320, 300);

    public static void PlayShort() => Play(ShortBeep);
    public static void PlayLong() => Play(LongBeep);

    static void Play(SoundPlayer player)
    {
        try { player.Play(); } catch { }
    }

    // A whole cue schedule rendered into one 16-bit mono WAV, every tone starting on its exact
    // sample (the same synthesis as RNG Solution's audio.render and the webapp's renderCues), so
    // once the file plays the spacing between sounds cannot jitter; the only latency is the
    // constant launch delay, which the calibration absorbs. Render before the anchor, Play at it.
    public sealed class RenderedSchedule : IDisposable
    {
        readonly SoundPlayer _player;
        public IReadOnlyList<Cue> Cues { get; }
        public IReadOnlyDictionary<string, int> Onsets { get; }
        public int Samples { get; }

        internal RenderedSchedule(SoundPlayer player, IReadOnlyList<Cue> cues, IReadOnlyDictionary<string, int> onsets, int samples)
        {
            _player = player;
            Cues = cues;
            Onsets = onsets;
            Samples = samples;
        }

        public void Play() { try { _player.Play(); } catch { } }
        public void Stop() { try { _player.Stop(); } catch { } }
        public void Dispose() { Stop(); _player.Dispose(); }
    }

    public static RenderedSchedule RenderSchedule(IReadOnlyList<Cue> cues, double tailS = 0.25)
    {
        if (cues.Count == 0) throw new ArgumentException("nothing to render");
        int end = 0;
        foreach (var c in cues) end = Math.Max(end, OnsetSample(c.T) + (int)Math.Round(c.Ms / 1000.0 * Rate));
        int total = end + (int)(tailS * Rate) + 1;
        var buf = new short[total];
        int na = Math.Max(1, (int)(AttackMs / 1000.0 * Rate)), nr = Math.Max(1, (int)(ReleaseMs / 1000.0 * Rate));
        var onsets = new Dictionary<string, int>();
        foreach (var c in cues)
        {
            int s0 = OnsetSample(c.T), n = (int)Math.Round(c.Ms / 1000.0 * Rate);
            double w = 2.0 * Math.PI * c.Freq / Rate;
            for (int i = 0; i < n; i++)
            {
                double env = Math.Min(1.0, (i + 1) / (double)na) * Math.Min(1.0, (n - i) / (double)nr);
                int v = buf[s0 + i] + (int)Math.Round(32767 * Amplitude * env * Math.Sin(w * (i + 1)));
                buf[s0 + i] = (short)Math.Max(-32768, Math.Min(32767, v));
            }
            onsets[c.Label] = s0;
        }
        var player = new SoundPlayer(Wav(buf));
        try { player.Load(); } catch { }
        return new RenderedSchedule(player, cues, onsets, total);
    }

    public static int OnsetSample(double t) => (int)Math.Round(t * Rate);

    static MemoryStream Wav(short[] samples)
    {
        int dataSize = samples.Length * 2;
        var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        w.Write("RIFF"u8);
        w.Write(36 + dataSize);
        w.Write("WAVE"u8);
        w.Write("fmt "u8);
        w.Write(16);
        w.Write((short)1);
        w.Write((short)1);
        w.Write(Rate);
        w.Write(Rate * 2);
        w.Write((short)2);
        w.Write((short)16);
        w.Write("data"u8);
        w.Write(dataSize);
        foreach (var s in samples) w.Write(s);
        ms.Position = 0;
        return ms;
    }

    static SoundPlayer Create(double freq, int durationMs)
    {
        int samples = Rate * durationMs / 1000;
        var buf = new short[samples];
        int fade = Math.Min(samples / 10, 200);
        for (int i = 0; i < samples; i++)
        {
            double amp = 0.5;
            if (i < fade) amp *= i / (double)fade;
            if (i > samples - fade) amp *= (samples - i) / (double)fade;
            buf[i] = (short)(Math.Sin(2 * Math.PI * freq * i / Rate) * amp * short.MaxValue);
        }
        var player = new SoundPlayer(Wav(buf));
        try { player.Load(); } catch { }
        return player;
    }
}
