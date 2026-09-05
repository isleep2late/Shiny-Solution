using System.Globalization;
using ShinySolution.Core;

namespace ShinySolution.App;

public sealed class Gen4Panel : UserControl
{
    readonly DateTimePicker _calcDate = MakePicker("yyyy-MM-dd HH:mm:ss");
    readonly NumericUpDown _calcDelay = Ui.Num(0, 65535, 600, 80);
    readonly NumericUpDown _calcSkips = Ui.Num(0, 50, 0, 60);
    readonly Label _calcOut = Ui.L("");

    readonly NumericUpDown _tTid = Ui.Num(0, 65535, 7777, 80);
    readonly DateTimePicker _tDate = MakePicker("yyyy-MM-dd HH:mm");
    readonly NumericUpDown _tDelayMin = Ui.Num(0, 65535, 300, 80);
    readonly NumericUpDown _tDelayMax = Ui.Num(0, 65535, 5000, 80);
    readonly DataGridView _tGrid = Ui.Grid(120, "Second", "Delay", "Seed", "TID", "SID");

    readonly TextBox _shSeed = Ui.Text("", 100);
    readonly NumericUpDown _shTid = Ui.Num(0, 65535, 0, 80);
    readonly NumericUpDown _shSid = Ui.Num(0, 65535, 0, 80);
    readonly ComboBox _shNature = Ui.NatureCombo();
    readonly ComboBox _shGender = Ui.Combo(90, "Any", "Male", "Female");
    readonly NumericUpDown _shMinIv = Ui.Num(0, 31, 0, 60);
    readonly NumericUpDown _shAdvMin = Ui.Num(0, 999999, 0, 80);
    readonly NumericUpDown _shAdvMax = Ui.Num(1, 9999999, 5000, 90);
    readonly DataGridView _shGrid = Ui.Grid(130, "Advance", "PID", "Nature", "Gender", "IVs");

    readonly Label _timerTarget = Ui.L("no target loaded");
    readonly Label _timerPhase = Ui.L("");
    readonly Label _timerDisplay = new()
    {
        Text = "--:--.---",
        Font = new Font(FontFamily.GenericMonospace, 34, FontStyle.Bold),
        AutoSize = true,
        Margin = new Padding(12)
    };
    readonly NumericUpDown _calDelay = Ui.Num(-20000, 65535, 500, 90);
    readonly NumericUpDown _calSecond = Ui.Num(0, 59, 14, 60);
    readonly NumericUpDown _hitDelay = Ui.Num(0, 65535, 0, 80);
    readonly Label _calResult = Ui.L("");

    readonly TextBox _flips = Ui.Text("", 200);
    readonly NumericUpDown _flipRadius = Ui.Num(0, 30, 3, 60);
    readonly NumericUpDown _flipWidth = Ui.Num(100, 65535, 2000, 80);
    readonly Label _flipResult = Ui.L("");

    readonly Gen4Timer _model = new();
    // the two-phase countdown with the beeps, shared with the wizard tab (CountdownController.cs)
    readonly PhaseCountdown _countdown;
    double _p1, _p2;
    int _targetSecondLoaded = -1;
    uint _targetDelayLoaded;

    public Gen4Panel()
    {
        _countdown = new PhaseCountdown(_timerDisplay, _timerPhase);
        LoadCalibration();

        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var groups = new Control[]
        {
            Ui.Group("Seed & TID/SID calculator (DS clock time at boot + delay)",
                Ui.Row(Ui.L("boot time"), _calcDate, Ui.L("delay"), _calcDelay, Ui.L("Elm skips"), _calcSkips,
                    Ui.Btn("Compute", (_, _) => Compute())),
                Ui.Row(_calcOut)),
            Ui.Group("Find TID targets (DPPt/HGSS: TID/SID = 2nd Mersenne output of the seed at the end of the intro)",
                Ui.Row(Ui.L("Target TID"), _tTid, Ui.L("boot minute"), _tDate,
                    Ui.L("delay range"), _tDelayMin, Ui.L("to"), _tDelayMax,
                    Ui.Btn("Find", (_, _) => FindTid()),
                    Ui.Btn("Load selected into timer", (_, _) => LoadSelectedTid())),
                _tGrid),
            Ui.Group("Shiny Method-1 search from a seed (starters/gifts; route to the advance with Chatot/Journal)",
                Ui.Row(Ui.L("seed (hex)"), _shSeed, Ui.L("TID"), _shTid, Ui.L("SID"), _shSid,
                    Ui.L("nature"), _shNature, Ui.L("gender"), _shGender, Ui.L("min IV"), _shMinIv),
                Ui.Row(Ui.L("advance range"), _shAdvMin, Ui.L("to"), _shAdvMax,
                    Ui.Btn("Find", (_, _) => FindShiny())),
                _shGrid),
            Ui.Group("Timer — start when you confirm the DS clock; phase 1 covers the boot, press A on Continue at the end of phase 2",
                Ui.Row(_timerTarget),
                Ui.Row(_timerPhase),
                Ui.Row(_timerDisplay),
                Ui.Row(Ui.Btn("Start at clock confirm", (_, _) => StartTimer(), 170),
                    Ui.Btn("Cancel", (_, _) => CancelTimer()),
                    Ui.L("calibrated delay"), _calDelay, Ui.L("calibrated second"), _calSecond,
                    Ui.Btn("Save calibration", (_, _) => SaveCalibration())),
                Ui.Row(Ui.L("delay you hit"), _hitDelay,
                    Ui.Btn("Calibrate from hit", (_, _) => CalibrateFromHit()),
                    _calResult)),
            Ui.Group("Verify which seed you hit — DPPt Poketch Coin Toss (Continue-screen seed only, NOT after a New Game)",
                Ui.Row(Ui.L("flips"), _flips, Ui.L("second ±"), _flipRadius, Ui.L("delay ±"), _flipWidth,
                    Ui.Btn("Match", (_, _) => MatchFlips())),
                Ui.Row(Ui.L("Elm E/K/P (HGSS) is a postgame check: needs 8 badges + game clear + S.S. Ticket + Everstone + Pokérus; before that it is a 2-way E/K.")),
                Ui.Row(_flipResult))
        };
        for (int i = groups.Length - 1; i >= 0; i--) scroll.Controls.Add(groups[i]);
        Controls.Add(scroll);
        // a mode change swaps the store: the calibrated delay and second are re-read from the mode's own (AppMode.Scoped)
        AppMode.Changed += _ => { LoadCalibration(); _calResult.Text = $"{AppMode.Label} mode: its own calibration"; UpdateIdleDisplay(); };
    }

    static DateTimePicker MakePicker(string format) => new()
    {
        Format = DateTimePickerFormat.Custom,
        CustomFormat = format,
        ShowUpDown = true,
        Width = 170,
        Value = new DateTime(2026, 1, 1, 10, 0, 0)
    };

    void Compute()
    {
        var d = _calcDate.Value;
        uint seed = Gen4.Seed(d.Year, d.Month, d.Day, d.Hour, d.Minute, d.Second, (uint)_calcDelay.Value);
        var (tid, sid) = Gen4.TidSid(seed);
        _calcOut.Text = $"seed {seed:X8}  |  TID {tid} / SID {sid}  |  coin flips {Gen4.CoinFlips(seed, 10)}  |  Elm {Gen4.ElmCalls(seed, 10, (int)_calcSkips.Value)}";
    }

    void FindTid()
    {
        var d = _tDate.Value;
        var hits = Gen4.SearchTid((uint)_tTid.Value, d.Year, d.Month, d.Day, d.Hour, d.Minute,
            (uint)_tDelayMin.Value, (uint)_tDelayMax.Value, 20);
        _tGrid.Rows.Clear();
        foreach (var h in hits)
        {
            int idx = _tGrid.Rows.Add(h.Second, h.Delay, h.SeedValue.ToString("X8"), h.Tid, h.Sid);
            _tGrid.Rows[idx].Tag = h;
        }
        if (hits.Count == 0) _flipResult.Text = "no seed in that window yields the target TID — widen the delay range";
    }

    void LoadSelectedTid()
    {
        if (_tGrid.SelectedRows.Count == 0 ||
            _tGrid.SelectedRows[0].Tag is not (int second, uint delay, uint seed, uint tid, uint sid)) return;
        _targetSecondLoaded = second;
        _targetDelayLoaded = delay;
        _model.TargetSecond = second;
        _model.TargetDelay = delay;
        _shSeed.Text = seed.ToString("X8");
        _shTid.Value = tid;
        _shSid.Value = sid;
        var d = _tDate.Value;
        int k = _model.MinutesBefore();
        var setClock = d.AddMinutes(-k);
        _timerTarget.Text = $"target: {d:HH:mm} second {second}, delay {delay}, seed {seed:X8} (TID {tid} / SID {sid})  —  " +
            (k > 0 ? $"SET THE DS CLOCK TO {setClock:HH:mm} ({k} min before), confirm it, then Start" : "set the DS clock to the target minute, confirm, then Start");
        UpdateIdleDisplay();
    }

    void FindShiny()
    {
        if (!uint.TryParse(_shSeed.Text.Trim(), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out uint seed))
        {
            _flipResult.Text = "enter a hex seed first (or load a TID target)";
            return;
        }
        var filter = new MonFilter(Ui.NatureIndexOf(_shNature), Ui.GenderOf(_shGender), (int)_shMinIv.Value);
        long from = (long)_shAdvMin.Value;
        var hits = Gen3.SearchStarter(Lcrng.Jump(seed, (ulong)from), from,
            (uint)_shTid.Value, (uint)_shSid.Value, (long)_shAdvMax.Value, filter, 15);
        _shGrid.Rows.Clear();
        foreach (var m in hits)
        {
            _shGrid.Rows.Add(m.Advance, m.Pid.ToString("X8"), m.NatureName, m.Gender(), m.Ivs.ToString());
        }
        if (hits.Count == 0) _flipResult.Text = "no shiny in that advance range with those filters";
    }

    void UpdateIdleDisplay()
    {
        if (_targetSecondLoaded < 0 || _countdown.Running) return;
        (_p1, _p2) = _model.Phases();
        _timerPhase.Text = $"phase 1: {TimerMath.FmtMs(_p1)}   phase 2: {TimerMath.FmtMs(_p2)}";
        _timerDisplay.Text = TimerMath.FmtMs(_p1 + _p2);
    }

    void StartTimer()
    {
        if (_targetSecondLoaded < 0 || _countdown.Running) return;
        (_p1, _p2) = _model.Phases();
        if (_p2 <= 0)
        {
            _timerPhase.Text = "phase 2 is not positive — check the calibration values";
            return;
        }
        _countdown.Start(_p1, _p2, "phase 1 (boot the DS, get to the Continue screen)", "phase 2 (press A on Continue at zero)");
    }

    void CancelTimer()
    {
        _countdown.Cancel();
        UpdateIdleDisplay();
    }

    void LoadCalibration()
    {
        _model.CalibratedDelay = SettingsStore.Get(AppMode.Scoped("gen4.calibratedDelay"), 500);
        _model.CalibratedSecond = SettingsStore.Get(AppMode.Scoped("gen4.calibratedSecond"), 14);
        _calDelay.Value = (decimal)Math.Clamp(Math.Round(_model.CalibratedDelay, 1), (double)_calDelay.Minimum, (double)_calDelay.Maximum);
        _calSecond.Value = (decimal)Math.Clamp(_model.CalibratedSecond, (double)_calSecond.Minimum, (double)_calSecond.Maximum);
    }

    void SaveCalibration()
    {
        _model.CalibratedDelay = (double)_calDelay.Value;
        _model.CalibratedSecond = (double)_calSecond.Value;
        SettingsStore.Set(AppMode.Scoped("gen4.calibratedDelay"), _model.CalibratedDelay);
        SettingsStore.Set(AppMode.Scoped("gen4.calibratedSecond"), _model.CalibratedSecond);
        _calResult.Text = $"calibration saved [{AppMode.Label} mode]";
        UpdateIdleDisplay();
    }

    void CalibrateFromHit()
    {
        if (_targetSecondLoaded < 0)
        {
            _calResult.Text = "load a target first";
            return;
        }
        _model.Calibrate((uint)_hitDelay.Value);
        _model.CalibratedDelay = Math.Clamp(_model.CalibratedDelay, (double)_calDelay.Minimum, (double)_calDelay.Maximum);
        _calDelay.Value = (decimal)Math.Round(_model.CalibratedDelay, 1);
        SettingsStore.Set(AppMode.Scoped("gen4.calibratedDelay"), _model.CalibratedDelay);
        _calResult.Text = $"calibrated delay is now {_model.CalibratedDelay:F1} [{AppMode.Label} mode]";
        UpdateIdleDisplay();
    }

    void MatchFlips()
    {
        if (_targetSecondLoaded < 0)
        {
            _flipResult.Text = "load a TID target first so the search has a center";
            return;
        }
        var d = _tDate.Value;
        uint lo = (uint)Math.Max(0, (long)_targetDelayLoaded - (long)_flipWidth.Value);
        uint hi = (uint)Math.Min(65535, (long)_targetDelayLoaded + (long)_flipWidth.Value);
        var hits = Gen4.MatchCoinFlips(_flips.Text, d.Year, d.Month, d.Day, d.Hour, d.Minute,
            _targetSecondLoaded, (int)_flipRadius.Value, lo, hi, 10);
        if (hits.Count == 0)
        {
            _flipResult.Text = "no candidate seed matches those flips in the window — widen it or re-check the flips";
            return;
        }
        var best = hits.OrderBy(h => Math.Abs((long)h.Delay - _targetDelayLoaded)).First();
        _hitDelay.Value = best.Delay;
        _flipResult.Text = $"{hits.Count} candidate(s); nearest: second {best.Second}, delay {best.Delay}, seed {best.SeedValue:X8}. Hit delay filled in — click Calibrate from hit.";
    }
}
