using ShinySolution.Core;

namespace ShinySolution.App;

public sealed class Gen3Panel : UserControl
{
    readonly EmuLink _link = new();
    readonly ListBox _log = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    readonly TextBox _host = Ui.Text("127.0.0.1", 100);
    readonly NumericUpDown _port = Ui.Num(1, 65535, 8356);
    readonly Button _btnConnect;
    readonly Label _linkStatus = Ui.L("not connected");
    readonly Label _stGame = Ui.L("game: -");
    readonly Label _stMode = Ui.L("mode: -");
    readonly Label _stAdv = Ui.L("advance: -");
    readonly Label _stTid = Ui.L("TID: -");
    readonly Label _stSid = Ui.L("SID: -");
    readonly Label _stDelta = Ui.L("delta: -");
    readonly ComboBox _fNature = Ui.NatureCombo();
    readonly ComboBox _fGender = Ui.Combo(90, "Any", "Male", "Female");
    readonly ComboBox _fGenderRatio = Ui.Combo(150, GenderRatios.Select(g => g.Label).ToArray());
    readonly NumericUpDown _fMinIv = Ui.Num(0, 31, 0, 60);

    // PID & 0xFF is compared against the species' gender ratio byte (gBaseStats.genderRatio):
    // values below it are female. Starters are 87.5% male (31).
    static readonly (string Label, int Threshold)[] GenderRatios =
    {
        ("87.5% M (starters)", 31),
        ("75% M", 63),
        ("50% / 50%", 127),
        ("25% M", 191),
        ("genderless / one gender", 0)
    };
    readonly NumericUpDown _cmdTid = Ui.Num(0, 65535, 7777, 80);
    readonly NumericUpDown _cmdTarget = Ui.Num(1, 999999999, 10000, 110);
    readonly ComboBox _shinyMode = Ui.Combo(150, "Starter / gift", "Static encounter");
    readonly ComboBox _huntTrigger = Ui.Combo(80, "A", "Start", "Up", "Down", "Left", "Right");

    readonly NumericUpDown _tTid = Ui.Num(0, 65535, 7777, 80);
    readonly NumericUpDown _tWindow = Ui.Num(1, 600, 15, 60);
    readonly DataGridView _tGrid = Ui.Grid(130, "Press at", "TID", "SID", "Advance");
    readonly NumericUpDown _sTid = Ui.Num(0, 65535, 0, 80);
    readonly NumericUpDown _sSid = Ui.Num(0, 65535, 0, 80);
    readonly ComboBox _sNature = Ui.NatureCombo();
    readonly ComboBox _sGender = Ui.Combo(90, "Any", "Male", "Female");
    readonly NumericUpDown _sMinIv = Ui.Num(0, 31, 0, 60);
    readonly NumericUpDown _sFrom = Ui.Num(0, 600, 5, 60);
    readonly NumericUpDown _sWindow = Ui.Num(1, 600, 120, 60);
    readonly DataGridView _sGrid = Ui.Grid(150, "Press at", "Nature", "Gender", "IVs", "PID", "Advance");

    readonly Label _display = new()
    {
        Text = "--:--.---",
        Font = new Font(FontFamily.GenericMonospace, 34, FontStyle.Bold),
        AutoSize = true,
        Margin = new Padding(12)
    };
    readonly Label _info = Ui.L("no target loaded");
    readonly Label _calLabel = Ui.L("calibration: 0 ms");
    readonly CountdownController _countdown;

    readonly NumericUpDown _calTidGot = Ui.Num(0, 65535, 0, 80);
    readonly Label _calTidResult = Ui.L("");
    readonly ComboBox _calSpecies = Ui.Combo(100, "Treecko", "Torchic", "Mudkip");
    readonly ComboBox _calNature = Ui.Combo(110, Gen3.Natures);
    readonly ComboBox _calGender = Ui.Combo(90, "Male", "Female");
    readonly TextBox[] _calStats = Enumerable.Range(0, 6).Select(_ => Ui.Text("", 44)).ToArray();
    readonly Label _calStarterResult = Ui.L("");

    public Gen3Panel()
    {
        _countdown = new CountdownController(_display, _info, _calLabel);
        _btnConnect = Ui.Btn("Connect", (_, _) => ToggleConnect());

        _link.Log += AddLog;
        _link.ConnectedChanged += ok =>
        {
            _linkStatus.Text = ok ? "connected" : "not connected";
            _btnConnect.Text = ok ? "Disconnect" : "Connect";
        };
        _link.State += st =>
        {
            _stGame.Text = "game: " + st.GetValueOrDefault("game", "-").Replace("_", " ");
            _stMode.Text = "mode: " + st.GetValueOrDefault("mode", "-");
            _stAdv.Text = "advance: " + st.GetValueOrDefault("adv", "-");
            _stTid.Text = "TID: " + st.GetValueOrDefault("tid", "-");
            _stSid.Text = "SID: " + st.GetValueOrDefault("sid", "-");
            _stDelta.Text = "delta: " + st.GetValueOrDefault("delta", "-");
        };

        var emuTab = BuildEmulatorTab();
        var consoleTab = BuildConsoleTab();

        var tabs = new TabControl { Dock = DockStyle.Fill };
        var p1 = new TabPage("Emulator (auto)");
        p1.Controls.Add(emuTab);
        var p2 = new TabPage("Console timer (dead battery R/S)");
        p2.Controls.Add(consoleTab);
        tabs.TabPages.Add(p1);
        tabs.TabPages.Add(p2);
        Controls.Add(tabs);
    }

    Control BuildEmulatorTab()
    {
        var panel = new Panel { Dock = DockStyle.Fill };
        var rows = new Control[]
        {
            Ui.Row(Ui.L("mGBA host"), _host, Ui.L("port"), _port, _btnConnect, _linkStatus),
            Ui.Row(_stGame, _stMode, _stAdv, _stTid, _stSid, _stDelta),
            Ui.Row(Ui.L("Filters:"), Ui.L("nature"), _fNature, Ui.L("gender"), _fGender, Ui.L("species ratio"), _fGenderRatio,
                Ui.L("min IV"), _fMinIv,
                Ui.Btn("Apply filters", (_, _) => ApplyFilters())),
            Ui.Row(_shinyMode, Ui.Btn("Shiny!", (_, _) => Send(_shinyMode.SelectedIndex == 1 ? "shiny enemy" : "shiny")),
                Ui.L("TID"), _cmdTid, Ui.Btn("TID manip", (_, _) => Send($"tid {(uint)_cmdTid.Value}")),
                Ui.L("advance"), _cmdTarget, Ui.Btn("Raw press", (_, _) => Send($"target {(long)_cmdTarget.Value}")),
                Ui.Btn("Re-arm", (_, _) => Send("rearm")),
                Ui.Btn("Cancel", (_, _) => Send("cancel")),
                Ui.Btn("Scan RNG", (_, _) => Send("scan")),
                Ui.Btn("Status", (_, _) => Send("status")),
                Ui.Btn("Self-check", (_, _) => Send("selfcheck"))),
            Ui.Row(Ui.L("Brute-force hunt (wild grass or anything the auto flow can't calibrate):"),
                Ui.L("trigger"), _huntTrigger,
                Ui.Btn("Start hunt", (_, _) => StartHunt()),
                Ui.Btn("Stop hunt", (_, _) => Send("stop")))
        };
        panel.Controls.Add(_log);
        for (int i = rows.Length - 1; i >= 0; i--) panel.Controls.Add(rows[i]);
        return panel;
    }

    Control BuildConsoleTab()
    {
        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var groups = new Control[]
        {
            Ui.Group("1. Find TID targets (New Game: press on Birch's final \"Come see me in my POKeMON LAB.\" box)",
                Ui.Row(Ui.L("Target TID"), _tTid, Ui.L("window (min)"), _tWindow,
                    Ui.Btn("Find", (_, _) => FindTidTargets()),
                    Ui.Btn("Load selected", (_, _) => LoadSelectedTid())),
                _tGrid),
            Ui.Group("2. Find shiny starter targets (press on the YES confirm of the starter pick)",
                Ui.Row(Ui.L("TID"), _sTid, Ui.L("SID"), _sSid, Ui.L("nature"), _sNature,
                    Ui.L("gender"), _sGender, Ui.L("min IV"), _sMinIv),
                Ui.Row(Ui.L("earliest press (min)"), _sFrom, Ui.L("window (min)"), _sWindow,
                    Ui.Btn("Find", (_, _) => FindStarterTargets()),
                    Ui.Btn("Load selected", (_, _) => LoadSelectedStarter())),
                _sGrid),
            Ui.Group("3. Timer — click Start at the exact instant you power the GBA on; press A on the long beep",
                Ui.Row(_info),
                Ui.Row(_display),
                Ui.Row(Ui.Btn("Start at power-on", (_, _) => _countdown.Start(), 160),
                    Ui.Btn("Cancel", (_, _) => _countdown.Cancel()),
                    _calLabel,
                    Ui.Btn("Reset calibration", (_, _) => { _countdown.ResetCalibration(); RefreshGrids(); }))),
            Ui.Group("4a. Calibrate after a TID attempt",
                Ui.Row(Ui.L("TID you got"), _calTidGot, Ui.Btn("Calibrate", (_, _) => CalibrateTid())),
                Ui.Row(_calTidResult)),
            Ui.Group("4b. Calibrate after a starter attempt (stats straight off the summary screen)",
                Ui.Row(Ui.L("starter"), _calSpecies, Ui.L("nature"), _calNature, Ui.L("gender"), _calGender),
                Ui.Row(Ui.L("HP"), _calStats[0], Ui.L("Atk"), _calStats[1], Ui.L("Def"), _calStats[2],
                    Ui.L("SpA"), _calStats[3], Ui.L("SpD"), _calStats[4], Ui.L("Spe"), _calStats[5],
                    Ui.Btn("Calibrate", (_, _) => CalibrateStarter())),
                Ui.Row(_calStarterResult))
        };
        for (int i = groups.Length - 1; i >= 0; i--) scroll.Controls.Add(groups[i]);
        return scroll;
    }

    void ToggleConnect()
    {
        if (_link.IsConnected) _link.Disconnect();
        else _link.Connect(_host.Text, (int)_port.Value);
    }

    void Send(string cmd)
    {
        if (!_link.IsConnected)
        {
            AddLog("not connected — load lua/shiny-solution.lua in mGBA (Tools > Scripting) first");
            return;
        }
        _link.Send(cmd);
    }

    void StartHunt()
    {
        Send("set hunt_trigger " + _huntTrigger.SelectedItem);
        Send("hunt");
    }

    void ApplyFilters()
    {
        Send("set nature " + (Ui.NatureIndexOf(_fNature) is int n ? Gen3.Natures[n] : "-"));
        Send("set gender " + (Ui.GenderOf(_fGender)?.ToString() ?? "-"));
        Send($"set gender_threshold {GenderRatios[Math.Max(0, _fGenderRatio.SelectedIndex)].Threshold}");
        Send($"set min_iv {(int)_fMinIv.Value}");
    }

    void AddLog(string msg)
    {
        if (_log.Items.Count > 500) _log.Items.RemoveAt(0);
        _log.Items.Add($"[{DateTime.Now:HH:mm:ss}] {msg}");
        _log.TopIndex = _log.Items.Count - 1;
    }

    static double Cal(string key) => SettingsStore.Get("cal." + key);

    void FindTidTargets()
    {
        long maxAdv = TimerMath.MsToAdvances((double)_tWindow.Value * 60000);
        var hits = Gen3.SearchTid(Lcrng.DeadBatterySeedRs, 0, (uint)_tTid.Value, maxAdv, 12);
        _tGrid.Rows.Clear();
        foreach (var h in hits)
        {
            int idx = _tGrid.Rows.Add(TimerMath.FmtMs(TimerMath.AdvancesToMs(h.Advance) + Cal("gen3.tid")), h.Tid, h.Sid, h.Advance);
            _tGrid.Rows[idx].Tag = h;
        }
        if (hits.Count == 0) AddLog($"no advance yields TID {(uint)_tTid.Value} within {_tWindow.Value} minutes");
    }

    void LoadSelectedTid()
    {
        if (_tGrid.SelectedRows.Count == 0 || _tGrid.SelectedRows[0].Tag is not (long adv, uint tid, uint sid)) return;
        _countdown.LoadTarget(adv, "gen3.tid", $"TID {tid} / SID {sid}", (adv, tid, sid));
    }

    void FindStarterTargets()
    {
        uint tid = (uint)_sTid.Value, sid = (uint)_sSid.Value;
        long from = TimerMath.MsToAdvances((double)_sFrom.Value * 60000);
        long max = from + TimerMath.MsToAdvances((double)_sWindow.Value * 60000);
        var filter = new MonFilter(Ui.NatureIndexOf(_sNature), Ui.GenderOf(_sGender), (int)_sMinIv.Value);
        var hits = Gen3.SearchStarter(Lcrng.Jump(Lcrng.DeadBatterySeedRs, (ulong)from), from, tid, sid, max, filter, 12);
        _sGrid.Rows.Clear();
        foreach (var m in hits)
        {
            int idx = _sGrid.Rows.Add(TimerMath.FmtMs(TimerMath.AdvancesToMs(m.Advance) + Cal("gen3.starter")),
                m.NatureName, m.Gender(), m.Ivs.ToString(), m.Pid.ToString("X8"), m.Advance);
            _sGrid.Rows[idx].Tag = m;
        }
        if (hits.Count == 0) AddLog("no shiny starter matches those filters in that window");
    }

    void LoadSelectedStarter()
    {
        if (_sGrid.SelectedRows.Count == 0 || _sGrid.SelectedRows[0].Tag is not Mon m) return;
        _countdown.LoadTarget(m.Advance, "gen3.starter", $"{m.NatureName} {m.Gender()} {m.Ivs}", m);
    }

    void RefreshGrids()
    {
        if (_tGrid.Rows.Count > 0) FindTidTargets();
        if (_sGrid.Rows.Count > 0) FindStarterTargets();
    }

    void CalibrateTid()
    {
        if (_countdown.CalKey != "gen3.tid" || _countdown.TargetAdvance < 0)
        {
            _calTidResult.Text = "Load a TID target and run an attempt first.";
            return;
        }
        uint got = (uint)_calTidGot.Value;
        long center = _countdown.TargetAdvance;
        long from = Math.Max(0, center - 6000);
        var candidates = Gen3.FindByTid(Lcrng.Jump(Lcrng.DeadBatterySeedRs, (ulong)from), from, got, null, center + 6000);
        var hit = Gen3.Nearest(candidates, center, c => c.Advance);
        if (hit is null)
        {
            _calTidResult.Text = $"TID {got} not found within ±6000 advances of the target — check the entry.";
            return;
        }
        long drift = hit.Value.Advance - center;
        _countdown.AdjustCalibration(-TimerMath.AdvancesToMs(drift));
        _calTidResult.Text = $"Landed at advance {hit.Value.Advance} ({(drift >= 0 ? "+" : "")}{drift} frames). Timer corrected. " +
            $"That save's SID is {hit.Value.Sid} — keep it and use TID {got} / SID {hit.Value.Sid} for the starter search.";
        RefreshGrids();
    }

    void CalibrateStarter()
    {
        if (_countdown.CalKey != "gen3.starter" || _countdown.TargetAdvance < 0)
        {
            _calStarterResult.Text = "Load a starter target and run an attempt first.";
            return;
        }
        int nature = _calNature.SelectedIndex;
        char gender = _calGender.SelectedIndex == 1 ? 'F' : 'M';
        var given = new int?[6];
        bool haveStats = false;
        for (int i = 0; i < 6; i++)
        {
            if (int.TryParse(_calStats[i].Text, out int v))
            {
                given[i] = v;
                haveStats = true;
            }
        }
        long center = _countdown.TargetAdvance;
        long from = Math.Max(0, center - 3000);
        var candidates = Gen3.FindByMon(Lcrng.Jump(Lcrng.DeadBatterySeedRs, (ulong)from), from, center + 3000, nature, gender);
        var filtered = candidates;
        if (haveStats)
        {
            var baseStats = Gen3Stats.StartersRs[_calSpecies.SelectedItem!.ToString()!];
            filtered = candidates.Where(c =>
            {
                var stats = Gen3Stats.StatsAtLevel(baseStats, c.Ivs, 5, c.Nature);
                for (int i = 0; i < 6; i++)
                {
                    if (given[i] is int g && stats[i] != g) return false;
                }
                return true;
            }).ToList();
        }
        var hit = Gen3.Nearest(filtered, center, c => c.Advance);
        if (hit is null)
        {
            _calStarterResult.Text = haveStats
                ? "Nothing nearby matches that nature/gender/stat combination — double-check the summary screen."
                : $"No {Gen3.Natures[nature]} {gender} within ±3000 advances.";
            return;
        }
        long drift = hit.Value.Advance - center;
        _countdown.AdjustCalibration(-TimerMath.AdvancesToMs(drift));
        string note = haveStats
            ? $"{filtered.Count} stat-consistent candidate(s) in window."
            : $"WARNING: {candidates.Count} candidates matched on nature/gender alone — enter the six stats for a reliable fix.";
        _calStarterResult.Text = $"Match at advance {hit.Value.Advance} ({(drift >= 0 ? "+" : "")}{drift} frames). {note} Try again with the same target.";
        RefreshGrids();
    }
}
