namespace ShinySolution.App;

public sealed class GbPanel : UserControl
{
    readonly EmuLink _link = new();
    readonly ListBox _log = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    readonly TextBox _host = Ui.Text("127.0.0.1", 100);
    readonly NumericUpDown _port = Ui.Num(1, 65535, 8357);
    readonly Button _btnConnect;
    readonly Label _linkStatus = Ui.L("not connected");
    readonly Label _stGame = Ui.L("game: -");
    readonly Label _stMode = Ui.L("mode: -");
    readonly Label _stAttempt = Ui.L("attempt: -");
    readonly Label _stWait = Ui.L("wait: -");
    readonly Label _stLast = Ui.L("last DVs: -");
    readonly ComboBox _trigger = Ui.Combo(90, "A", "B", "Start", "Up", "Down", "Left", "Right");
    readonly ComboBox _watch = Ui.Combo(140, "enemy (encounters)", "party (gifts)", "tid (new game)");
    readonly ComboBox _target = Ui.Combo(150, "shiny (Gen 2 rule)", "custom pattern");
    readonly TextBox _custom = Ui.Text("", 70);
    readonly NumericUpDown _step = Ui.Num(1, 600, 1, 60);
    readonly NumericUpDown _timeout = Ui.Num(60, 36000, 900, 70);

    public GbPanel()
    {
        _btnConnect = Ui.Btn("Connect", (_, _) => ToggleConnect());
        _link.ScriptName = "lua/shiny-solution-gb.lua";
        _link.ExpectedPort = 8357;
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
            _stAttempt.Text = "attempt: " + st.GetValueOrDefault("attempt", "-");
            _stWait.Text = "wait: " + st.GetValueOrDefault("wait", "-");
            _stLast.Text = "last DVs: " + st.GetValueOrDefault("last", "-");
        };

        var rows = new Control[]
        {
            Ui.Row(Ui.L("mGBA host"), _host, Ui.L("port"), _port, _btnConnect, _linkStatus),
            Ui.Row(_stGame, _stMode, _stAttempt, _stWait, _stLast),
            Ui.Row(Ui.L("trigger"), _trigger, Ui.L("watch"), _watch, Ui.L("target"), _target,
                Ui.L("custom (hex, or a plain TID number, ? wildcards)"), _custom),
            Ui.Row(Ui.L("wait step"), _step, Ui.L("timeout frames"), _timeout,
                Ui.Btn("Apply settings", (_, _) => ApplySettings()),
                Ui.Btn("Start hunt", (_, _) => Send("hunt")),
                Ui.Btn("Stop", (_, _) => Send("stop")),
                Ui.Btn("Status", (_, _) => Send("status"))),
            Ui.Row(Ui.L("Savestate first, stand one input away from the roll (grass step, gift YES, or New Game confirm), then Start hunt. Use mGBA fast-forward (Tab) to speed attempts."))
        };
        Controls.Add(_log);
        for (int i = rows.Length - 1; i >= 0; i--) Controls.Add(rows[i]);
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
            AddLog("not connected — load lua/shiny-solution-gb.lua in mGBA (Tools > Scripting) first");
            return;
        }
        _link.Send(cmd);
    }

    void ApplySettings()
    {
        Send("set trigger " + _trigger.SelectedItem);
        Send("set watch " + _watch.SelectedItem!.ToString()!.Split(' ')[0]);
        Send("set target " + (_target.SelectedIndex == 0 ? "shiny" : "custom"));
        if (_target.SelectedIndex == 1 && _custom.Text.Length > 0)
        {
            var pattern = NormalisePattern(_custom.Text.Trim(), WatchIsTid());
            if (pattern is null)
            {
                AddLog("that custom target is not a 4-character hex pattern (or, for a TID hunt, a plain "
                    + "number 0-65535) - nothing was applied");
                return;
            }
            Send("set custom_dvs " + pattern);
        }
        Send($"set wait_step {(int)_step.Value}");
        Send($"set timeout_frames {(int)_timeout.Value}");
    }

    bool WatchIsTid() => _watch.SelectedIndex == 2;

    /// <summary>
    /// The script matches a 4-character hex pattern with '?' wildcards. A TID, though, is a number
    /// every game shows in DECIMAL - so in TID mode a bare number is read as decimal and converted,
    /// and hex is written with a 0x prefix. Getting this wrong is silent and expensive: TID 1234 is
    /// a perfectly valid hex string too, so guessing by shape would hunt the wrong trainer forever.
    /// </summary>
    internal static string? NormalisePattern(string text, bool tidMode)
    {
        if (text.Length == 0) return null;

        var hex = text;
        if (hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            hex = hex[2..];
        else if (tidMode && text.All(char.IsDigit))
        {
            if (!ushort.TryParse(text, out var tid)) return null;
            return tid.ToString("X4");
        }

        hex = hex.ToUpperInvariant();
        if (hex.Length != 4) return null;
        foreach (var c in hex)
        {
            if (c != '?' && !Uri.IsHexDigit(c)) return null;
        }
        return hex;
    }

    void AddLog(string msg)
    {
        if (_log.Items.Count > 500) _log.Items.RemoveAt(0);
        _log.Items.Add($"[{DateTime.Now:HH:mm:ss}] {msg}");
        _log.TopIndex = _log.Items.Count - 1;
    }
}
