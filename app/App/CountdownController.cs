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

    // the correction of the mode in force (AppMode.Scoped: RUN's key is the one that always existed)
    public double Calibration => CalKey == "" ? 0 : SettingsStore.Get(AppMode.Scoped("cal." + CalKey));

    public void AdjustCalibration(double deltaMs)
    {
        if (CalKey == "") return;
        SettingsStore.Set(AppMode.Scoped("cal." + CalKey), Calibration + deltaMs);
        Refresh();
    }

    public void ResetCalibration()
    {
        if (CalKey == "") return;
        SettingsStore.Set(AppMode.Scoped("cal." + CalKey), 0);
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
        _calLabel.Text = $"calibration: {Math.Round(Calibration)} ms ({AppMode.Label} mode)";
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

// A two-phase countdown with EonTimer's shape, the one the wanted-IVs wizard runs for both generations (Gen 3: the
// pre-timer then the frame phase; Gen 4: the delay model's two phases): phase 1 counts down to a long beep, phase 2 to
// the last long beep with the five short beeps before it, the same beeps and the same 33 ms display as the Gen 4 panel's
// timer. Nothing here reads the game: the phases come from Timers and the start is your click.
public sealed class PhaseCountdown
{
    readonly Label _display;
    readonly Label _phase;
    volatile Stopwatch? _watch;
    System.Windows.Forms.Timer? _uiTimer;
    double _p1, _p2;
    string _label1 = "", _label2 = "";

    public bool Running { get; private set; }
    public event Action? Finished;

    public PhaseCountdown(Label display, Label phase)
    {
        _display = display;
        _phase = phase;
    }

    public void Start(double phase1Ms, double phase2Ms, string label1, string label2)
    {
        if (Running) return;
        _p1 = phase1Ms; _p2 = phase2Ms; _label1 = label1; _label2 = label2;
        Running = true;
        var watch = Stopwatch.StartNew();
        _watch = watch;
        _uiTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _uiTimer.Tick += (_, _) => Tick();
        _uiTimer.Start();
        // The worker keeps its own watch and phases: after Cancel, or Cancel followed by Start, it sees another watch
        // and stops, so a worker still asleep through a Cancel never beeps on the next run's times.
        new Thread(() => BeepWorker(watch, phase1Ms, phase2Ms)) { IsBackground = true }.Start();
    }

    void Tick()
    {
        if (_watch is null) return;
        double e = _watch.Elapsed.TotalMilliseconds;
        if (e < _p1) { _phase.Text = _label1; _display.Text = TimerMath.FmtMs(_p1 - e); }
        else if (e < _p1 + _p2) { _phase.Text = _label2; _display.Text = TimerMath.FmtMs(_p1 + _p2 - e); }
        else
        {
            _display.Text = "00:00.000";
            _uiTimer?.Stop();
            _uiTimer = null;
            Running = false;
            Finished?.Invoke();
        }
    }

    void BeepWorker(Stopwatch watch, double p1, double p2)
    {
        if (!SleepUntil(watch, p1)) return;
        BeepPlayer.PlayLong();
        for (int s = 5; s >= 1; s--)
        {
            double at = p1 + p2 - s * 1000;
            if (at <= watch.Elapsed.TotalMilliseconds) continue;
            if (!SleepUntil(watch, at)) return;
            BeepPlayer.PlayShort();
        }
        if (SleepUntil(watch, p1 + p2)) BeepPlayer.PlayLong();
    }

    // false as soon as the run this worker belongs to is cancelled or replaced by another Start
    bool SleepUntil(Stopwatch watch, double at)
    {
        while (true)
        {
            if (!ReferenceEquals(_watch, watch)) return false;
            double left = at - watch.Elapsed.TotalMilliseconds;
            if (left <= 0) return true;
            Thread.Sleep(left > 60 ? 25 : 1);
        }
    }

    public void Cancel()
    {
        Running = false;
        _uiTimer?.Stop();
        _uiTimer = null;
        _watch = null;
    }
}
