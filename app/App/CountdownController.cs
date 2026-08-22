using System.Diagnostics;
using ShinySolution.Core;

namespace ShinySolution.App;

public sealed class CountdownController
{
    readonly Label _display;
    readonly Label _info;
    readonly Label _calLabel;
    System.Windows.Forms.Timer? _uiTimer;
    Stopwatch? _watch;
    volatile bool _cancelled;
    double _totalMs;
    string _description = "";

    public long TargetAdvance { get; private set; } = -1;
    public string CalKey { get; private set; } = "";
    public object? TargetTag { get; private set; }
    public bool Running { get; private set; }

    public CountdownController(Label display, Label info, Label calLabel)
    {
        _display = display;
        _info = info;
        _calLabel = calLabel;
    }

    public double Calibration => CalKey == "" ? 0 : SettingsStore.Get("cal." + CalKey);

    public void AdjustCalibration(double deltaMs)
    {
        if (CalKey == "") return;
        SettingsStore.Set("cal." + CalKey, Calibration + deltaMs);
        Refresh();
    }

    public void ResetCalibration()
    {
        if (CalKey == "") return;
        SettingsStore.Set("cal." + CalKey, 0);
        Refresh();
    }

    double TotalMs() => TimerMath.AdvancesToMs(TargetAdvance) + Calibration;

    public void LoadTarget(long advance, string calKey, string description, object? tag = null)
    {
        Cancel();
        TargetAdvance = advance;
        CalKey = calKey;
        TargetTag = tag;
        _description = description;
        Refresh();
    }

    public void Refresh()
    {
        if (TargetAdvance < 0) return;
        double total = TotalMs();
        _info.Text = $"{_description}  |  press at {TimerMath.FmtMs(total)} after power-on";
        if (!Running) _display.Text = TimerMath.FmtMs(total);
        _calLabel.Text = $"calibration: {Math.Round(Calibration)} ms";
    }

    public void Start()
    {
        if (TargetAdvance < 0 || Running) return;
        _totalMs = TotalMs();
        if (_totalMs <= 0)
        {
            _info.Text = "Target time is not in the future — pick a later target or reset the calibration.";
            return;
        }
        Running = true;
        _cancelled = false;
        _watch = Stopwatch.StartNew();
        _uiTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _uiTimer.Tick += (_, _) => Tick();
        _uiTimer.Start();
        new Thread(BeepWorker) { IsBackground = true }.Start();
    }

    void Tick()
    {
        double left = _totalMs - _watch!.Elapsed.TotalMilliseconds;
        if (left <= 0)
        {
            _display.Text = "00:00.000";
            _uiTimer?.Stop();
            Running = false;
            return;
        }
        _display.Text = TimerMath.FmtMs(left);
    }

    void BeepWorker()
    {
        for (int s = 5; s >= 1; s--)
        {
            double at = _totalMs - s * 1000;
            if (at <= _watch!.Elapsed.TotalMilliseconds) continue;
            if (!SleepUntil(at)) return;
            BeepPlayer.PlayShort();
        }
        if (_totalMs > _watch!.Elapsed.TotalMilliseconds && !SleepUntil(_totalMs)) return;
        if (!_cancelled) BeepPlayer.PlayLong();
    }

    bool SleepUntil(double at)
    {
        while (true)
        {
            if (_cancelled) return false;
            double left = at - _watch!.Elapsed.TotalMilliseconds;
            if (left <= 0) return true;
            Thread.Sleep(left > 60 ? 25 : 1);
        }
    }

    public void Cancel()
    {
        _cancelled = true;
        _uiTimer?.Stop();
        Running = false;
        if (TargetAdvance >= 0) Refresh();
    }
}
