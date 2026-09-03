using System.Diagnostics;
using System.Text.Json;
using ShinySolution.Core;

namespace ShinySolution.App;

// The Gen 1 Trainer ID tab: game -> console -> methodology + validity -> target (a route-valid
// row, a typed Trainer ID or any offset) -> anchor + correction -> protocol -> cue (one
// pre-rendered buffer per schedule, so every beep is sample-exact; the display flashes with each)
// -> "What did you get?" calibration with P(hit) and drift, the save-corruption reset metronome,
// the moderators' verify, and the Emerald / FireRed / LeafGreen Secret ID branch. Calibration
// samples, pins and reset adjusts live in the app's settings (SettingsStore); each of the three
// stores follows the RUN / PRACTICE-HUNT mode (AppMode.Scoped), every record is stamped with the
// mode it was made in, and the cue log names the mode of every attempt.
public sealed class Gen1TidPanel : UserControl
{
    const string CalKeySetting = "gen1tid.calibration";
    const string PinsSetting = "gen1tid.sidPins";
    const string ResetAdjustSetting = "gen1tid.resetAdjust";

    readonly Gen1TidData _data = Gen1TidData.Load();
    readonly Gen3SidData _sid = Gen3SidData.Load();
    Dictionary<string, CalEntry> _cal;
    Dictionary<string, List<PinRecord>> _pins;
    Dictionary<string, ResetAdjustRecord> _resetAdjust;

    // 1. game / console / methodology
    readonly ComboBox _game = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200 };
    readonly ComboBox _platform = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly ComboBox _methodology = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly CheckedListBox _targetSets = new() { Width = 220, Height = 60, CheckOnClick = true };
    readonly TextBox _status = Box(70);
    readonly TextBox _methodologyText = Box(150);
    // 2. target
    readonly DataGridView _targets = Ui.Grid(120, "Offset", "Trainer ID", "A after the menu", "After the boot starts", "Set", "Derivation");
    readonly TextBox _tid = Ui.Text("16387", 110);
    readonly DataGridView _offsets = Ui.Grid(70, "Offset", "A after the menu", "After the boot starts");
    readonly NumericUpDown _offset = Ui.Num(0, 5999, 358, 80);
    readonly Label _targetInfo = Ui.L("Target: none yet");
    // 3. anchor / correction
    readonly ComboBox _anchor = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly NumericUpDown _correction = new() { Minimum = -5000, Maximum = 5000, DecimalPlaces = 1, Increment = 5, Width = 90 };
    readonly NumericUpDown _beeps = Ui.Num(0, 10, 4, 60);
    readonly NumericUpDown _spacing = new() { Minimum = 0.2m, Maximum = 5, DecimalPlaces = 1, Increment = 0.1m, Value = 1.0m, Width = 60 };
    readonly Label _correctionNote = Ui.L("");
    readonly TextBox _protocol = Box(260);
    readonly TextBox _schedule = Box(90);
    // 4. cue
    readonly Label _display = BigLabel();
    readonly Button _anchorBtn;
    readonly Label _phit = Ui.L("");
    readonly TextBox _cueLog = Box(110);
    // 5. outcome
    readonly TextBox _got = Ui.Text("", 110);
    readonly CheckBox _force = new() { Text = "force (add even if it looks like a duplicate or is more than 60 frames out)", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly TextBox _outcome = Box(110);
    readonly TextBox _stats = Box(140);
    // reset metronome
    readonly ComboBox _resetPreset = Ui.Combo(420, "route: cleared save, NEW GAME, first save", "practice-save: saving over a valid file with the same Trainer ID (+50 ms)");
    readonly NumericUpDown _resetAdjustN = new() { Minimum = -30, Maximum = 30, DecimalPlaces = 2, Increment = 0.5m, Width = 70 };
    readonly NumericUpDown _resetPairs = Ui.Num(1, 200, 15, 60);
    readonly NumericUpDown _resetCadence = new() { Minimum = 0.5m, Maximum = 10, DecimalPlaces = 1, Increment = 0.5m, Value = 2.0m, Width = 60 };
    readonly TextBox _resetInterval = Ui.Text("", 80);
    readonly Label _resetNote = Ui.L("");
    readonly TextBox _resetText = Box(200);
    readonly Label _resetDisplay = BigLabel();
    readonly TextBox _resetLog = Box(90);
    // verify
    readonly TextBox _verifyTid = Ui.Text("", 100);
    readonly TextBox _verifyS = Ui.Text("", 80);
    readonly ComboBox _verifyFrom = Ui.Combo(330, "the press itself (button overlay, hand cam)", "its first visible effect on the game screen (lag subtracted)");
    readonly NumericUpDown _verifyTol = Ui.Num(0, 30, 3, 60);
    readonly TextBox _verifyOut = Box(160);
    // SID
    readonly ComboBox _sidGame = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 180 };
    readonly ComboBox _sidSpeed = Ui.Combo(100, "(choose)", "fast", "mid", "slow");
    readonly NumericUpDown _sidNameLen = Ui.Num(1, 7, 7, 60);
    readonly ComboBox _sidRival = Ui.Combo(300, "NEW NAME, a 1-letter rival (the PSR route)", "preset name: DOWN then A");
    readonly TextBox _sidMethodologyText = Box(140);
    readonly NumericUpDown _sidMargin = Ui.Num(0, 120, 30, 60);
    readonly Button _sidCueBtn;
    readonly Label _sidDisplay = BigLabel();
    readonly TextBox _sidProtocol = Box(220);
    readonly TextBox _sidCueLog = Box(90);
    readonly TextBox _sidTid = Ui.Text("", 100);
    readonly TextBox _sidKMin = Ui.Text("", 70);
    readonly TextBox _sidKMax = Ui.Text("", 70);
    readonly TextBox _sidTsv = Ui.Text("", 60);
    readonly NumericUpDown _sidLimit = Ui.Num(0, 100000, 60, 70);
    readonly TextBox _sidShinyPids = Ui.Text("", 200);
    readonly TextBox _sidNonPids = Ui.Text("", 200);
    readonly CheckBox _sidNoPins = new() { Text = "ignore the stored pins", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly TextBox _sidPinPid = Ui.Text("", 110);
    readonly TextBox _sidPinNote = Ui.Text("", 160);
    readonly Label _sidPinOut = Ui.L("");
    readonly TextBox _sidOut = Box(150);
    readonly DataGridView _sidGrid = Ui.Grid(160, "k", "SID", "hex", "TSV");

    // state
    Gen1Platform? _plat;
    int? _target;
    string _anchorKey = Gen1Tid.AnchorMenu;
    bool _correctionManual;
    double _correctionMs;
    Schedule? _sched;
    BeepPlayer.RenderedSchedule? _prepared;
    string? _attempt;
    (int KExpected, int KMin, int KMax, Schedule Schedule, string Game, string Speed, string? Path, int NameLength)? _sidCue;
    BeepPlayer.RenderedSchedule? _sidPrepared;
    (ResetInterval Interval, double IntervalMs, Schedule Schedule, List<string> Lines)? _reset;
    BeepPlayer.RenderedSchedule? _resetPrepared;
    readonly CuePlayer _player = new();
    bool _loading;

    public Gen1TidPanel()
    {
        _cal = LoadCal();
        _pins = LoadPins();
        _resetAdjust = LoadResetAdjust();
        _anchorBtn = Ui.Btn("ANCHOR (Space)", (_, _) => AnchorNow(), 200);
        _anchorBtn.Font = new Font(_anchorBtn.Font.FontFamily, 12, FontStyle.Bold);
        _anchorBtn.Height = 44;
        _sidCueBtn = Ui.Btn("ANCHOR: A on OK (Space)", (_, _) => SidAnchorNow(), 220);
        _sidCueBtn.Enabled = false;

        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var groups = new Control[]
        {
            Ui.Group("1. Gen 1 Trainer ID (Red / Blue / Yellow): the one timed A press on NEW GAME. " + Gen1TidText.RulesLine,
                Ui.Row(Ui.L("game"), _game, Ui.L("console or emulator"), _platform),
                Ui.Row(Ui.L("methodology"), _methodology, Ui.L("target sets in force"), _targetSets),
                _status,
                _methodologyText),
            Ui.Group("2. Target: a route-valid row (double-click), a typed Trainer ID for another category, or any offset",
                _targets,
                Ui.Row(Ui.Btn("Aim at the selected row", (_, _) => AimSelected(_targets)),
                    Ui.L("Trainer ID you want (decimal like 16387, or hex $4003)"), _tid, Ui.Btn("Find press times", (_, _) => FindOffsets()),
                    Ui.L("or any offset"), _offset, Ui.Btn("Aim at offset", (_, _) => SetTarget((int)_offset.Value))),
                _offsets,
                Ui.Row(Ui.Btn("Aim at the selected press time", (_, _) => AimSelected(_offsets)), _targetInfo)),
            Ui.Group("3. Anchor and correction",
                Ui.Row(Ui.L("anchor: when will you click ANCHOR?"), _anchor, Ui.L("correction (ms)"), _correction,
                    Ui.Btn("Use the calibrated one", (_, _) => { _correctionManual = false; RefreshAnchor(); }),
                    Ui.L("count-in beeps"), _beeps, Ui.L("spacing (s)"), _spacing),
                Ui.Row(_correctionNote),
                _protocol,
                _schedule),
            Ui.Group("4. Cue: click ANCHOR at the anchor moment the protocol names (the beeps come from one pre-rendered buffer; the display flashes with each; the long high beep is the A press)",
                Ui.Row(_display),
                Ui.Row(_anchorBtn, Ui.Btn("Cancel", (_, _) => _player.Stop(false))),
                Ui.Row(_phit),
                _cueLog),
            Ui.Group("5. What did you get?",
                Ui.Row(Ui.L("Trainer ID you got (decimal as on the status screen, e.g. 16387, or hex $4003)"), _got, _force,
                    Ui.Btn("Record", (_, _) => Record()), Ui.Btn("Drop last", (_, _) => DropLast()), Ui.Btn("Clear (this methodology)", (_, _) => ClearSamples())),
                _outcome,
                Ui.Row(Ui.L("Your timing: spread, P(hit), attempts per hit, drift (samples are kept per console and anchor with their methodology id; only samples under the active methodology are averaged)")),
                _stats),
            Ui.Group("Save-corruption reset metronome (RESET then A, or A then power off)",
                Ui.Row(Ui.L("which save are you interrupting?"), _resetPreset, Ui.L("adjust (frames)"), _resetAdjustN,
                    Ui.Btn("Remember the adjust", (_, _) => SaveResetAdjust()), Ui.L("pairs"), _resetPairs, Ui.L("cadence (s)"), _resetCadence,
                    Ui.L("interval override (ms; blank = the centre)"), _resetInterval, Ui.Btn("Apply", (_, _) => RefreshReset())),
                Ui.Row(_resetNote),
                _resetText,
                Ui.Row(_resetDisplay),
                Ui.Row(Ui.Btn("Start the metronome", (_, _) => StartReset()), Ui.Btn("Stop", (_, _) => _player.Stop(false))),
                _resetLog),
            Ui.Group("Verify (moderators): is a Trainer ID consistent with a hand-measured press time?",
                Ui.Row(Ui.L("Trainer ID in the run"), _verifyTid, Ui.L("menu to press (s, from the video)"), _verifyS, Ui.L("measured from"), _verifyFrom,
                    Ui.L("tolerance (frames)"), _verifyTol, Ui.Btn("Verify", (_, _) => VerifyNow())),
                _verifyOut),
            Ui.Group("Emerald / FireRed / LeafGreen: the Secret ID from a typed Trainer ID ([TARGET] the Trainer ID is human input, read off the Trainer Card; nothing reads the game)",
                Ui.Row(Ui.L("game"), _sidGame, Ui.L("OPTIONS text speed"), _sidSpeed, Ui.L("player name length"), _sidNameLen, Ui.L("rival name path (FR/LG)"), _sidRival),
                _sidMethodologyText,
                Ui.Row(Ui.L("Cue the presses after naming (optional: k becomes a window of 27 instead of 1201).  margin (frames after each box is ready)"), _sidMargin,
                    Ui.Btn("Show the cue protocol", (_, _) => SidPrepareCue()), _sidCueBtn, Ui.Btn("Cancel", (_, _) => _player.Stop(false))),
                Ui.Row(_sidDisplay),
                _sidProtocol,
                _sidCueLog,
                Ui.Row(Ui.L("Trainer ID you got (Trainer Card IDNo)"), _sidTid, Ui.L("k min"), _sidKMin, Ui.L("k max"), _sidKMax, Ui.L("TSV filter"), _sidTsv,
                    Ui.L("rows to show (0 = all)"), _sidLimit, Ui.Btn("List candidates", (_, _) => SidRun())),
                Ui.Row(Ui.L("known shiny PIDs (hex, not stored)"), _sidShinyPids, Ui.L("known non-shiny PIDs (hex, not stored)"), _sidNonPids, _sidNoPins),
                Ui.Row(Ui.L("pin a PID (hex)"), _sidPinPid, Ui.L("note"), _sidPinNote, Ui.Btn("Pin: it IS shiny", (_, _) => SidPin(true)),
                    Ui.Btn("Pin: NOT shiny", (_, _) => SidPin(false)), Ui.Btn("Clear the pins for this ID", (_, _) => SidPinsClear())),
                Ui.Row(_sidPinOut),
                _sidOut,
                _sidGrid)
        };
        for (int i = groups.Length - 1; i >= 0; i--) scroll.Controls.Add(groups[i]);
        Controls.Add(scroll);

        _player.Flash = (kind) => { };
        _targets.CellDoubleClick += (_, _) => AimSelected(_targets);
        _offsets.CellDoubleClick += (_, _) => AimSelected(_offsets);
        _game.SelectedIndexChanged += (_, _) => { if (!_loading) { _platform.Tag = null; RefreshPlatform(false); } };
        _platform.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshPlatform(false); };
        _methodology.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshPlatform(true); };
        _targetSets.ItemCheck += (_, _) => { if (!_loading) BeginInvoke(new Action(() => RefreshPlatform(true))); };
        _anchor.SelectedIndexChanged += (_, _) => { if (!_loading) { _correctionManual = false; RefreshAnchor(); RefreshStats(); } };
        _correction.ValueChanged += (_, _) => { if (!_loading) { _correctionManual = true; RefreshAnchor(); } };
        _beeps.ValueChanged += (_, _) => { if (!_loading) RefreshAnchor(); };
        _spacing.ValueChanged += (_, _) => { if (!_loading) RefreshAnchor(); };
        _got.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Record(); } };
        _resetPreset.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshReset(); };
        _resetAdjustN.ValueChanged += (_, _) => { if (!_loading) { _resetAdjustN.Tag = "touched"; RefreshReset(); } };   // typed: the remembered value no longer overwrites it
        _resetPairs.ValueChanged += (_, _) => { if (!_loading) RefreshReset(); };
        _resetCadence.ValueChanged += (_, _) => { if (!_loading) RefreshReset(); };
        _sidGame.SelectedIndexChanged += (_, _) => { if (!_loading) { SidDropCue(); SidRefresh(); } };
        _sidSpeed.SelectedIndexChanged += (_, _) => { if (!_loading) SidDropCue(); };
        _sidRival.SelectedIndexChanged += (_, _) => { if (!_loading) SidDropCue(); };
        _sidNameLen.ValueChanged += (_, _) => { if (!_loading) SidDropCue(); };
        _sidMargin.ValueChanged += (_, _) => { if (!_loading) SidDropCue(); };
        _sidTid.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; SidRun(); } };
        // a mode change swaps the stores: the correction, the stats, the notes, the remembered reset adjustment and the
        // Secret ID pins are re-read from the mode's own
        AppMode.Changed += _ =>
        {
            _cal = LoadCal(); _pins = LoadPins(); _resetAdjust = LoadResetAdjust();
            _correctionManual = false; _resetAdjustN.Tag = null;
            RefreshAnchor(); RefreshStats(); RefreshReset();
            if (_sidTid.Text.Trim() != "") SidRun();
        };

        _loading = true;
        foreach (var g in Gen1Platform.SupportedGames(_data)) _game.Items.Add(new Item(g, J.S(_data.Root.GetProperty("games").GetProperty(g), "name", g)));
        _game.SelectedIndex = 0;
        foreach (var g in Gen1TidText.SidGames) _sidGame.Items.Add(new Item(g, J.S(_sid.Root.GetProperty("games").GetProperty(g), "name", g)));
        _sidGame.SelectedIndex = 0;
        _loading = false;
        RefreshPlatform(false);
        SidRefresh();
    }

    sealed record Item(string Key, string Text) { public override string ToString() => Text; }
    static string KeyOf(ComboBox c) => c.SelectedItem is Item it ? it.Key : "";
    static TextBox Box(int height) => new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Top, Height = height, WordWrap = true,
        Font = new Font(FontFamily.GenericMonospace, 8.5f)
    };
    static Label BigLabel() => new() { Text = "--", Font = new Font(FontFamily.GenericMonospace, 26, FontStyle.Bold), AutoSize = true, Margin = new Padding(12), Padding = new Padding(8) };
    static void Set(TextBox box, IEnumerable<string> lines) => box.Text = string.Join(Environment.NewLine, lines);
    static void Fill(ComboBox c, IEnumerable<Item> items, string? keep)
    {
        c.Items.Clear();
        int sel = 0, i = 0;
        foreach (var it in items) { c.Items.Add(it); if (it.Key == keep) sel = i; i++; }
        if (c.Items.Count > 0) c.SelectedIndex = sel;
    }
    static double F(string text, double fallback) => double.TryParse(text.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : fallback;

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.Space && ActiveControl is not (TextBox or NumericUpDown or ComboBox or Button or CheckedListBox or DataGridView))
        {
            if (_player.Running) _player.Stop(false);
            else if (_anchorBtn.Enabled) AnchorNow();
            return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    // ---- 1. game / console / methodology --------------------------------------------------------
    string[] CheckedTargetSets() => _targetSets.CheckedItems.Cast<object>().Select(x => x.ToString() ?? "").ToArray();

    void RefreshPlatform(bool keepTarget)
    {
        _loading = true;
        try
        {
            string game = KeyOf(_game);
            var plats = Gen1Platform.PlatformsFor(_data, game);
            Fill(_platform, plats.Select(p => new Item(p.Key, p.Name)), KeyOf(_platform));
            string pk = KeyOf(_platform);
            var (def, ids) = Gen1Platform.PlatformMethodologies(_data, pk, game);
            string keepM = ids.Contains(KeyOf(_methodology)) ? KeyOf(_methodology) : def ?? "";
            Fill(_methodology, ids.Select(id => new Item(id, id + ": " + J.S(_data.Root.GetProperty("methodologies").GetProperty(id), "name"))), keepM);
            var g = _data.Root.GetProperty("games").GetProperty(game);
            var wanted = (string?)_targetSets.Tag == game ? CheckedTargetSets() : J.SA(g, "default_target_sets");
            if (wanted.Length == 0 && (string?)_targetSets.Tag != game) wanted = J.SA(g, "target_sets");
            _targetSets.Items.Clear();
            foreach (var k in J.SA(g, "target_sets")) _targetSets.Items.Add(k, wanted.Contains(k));
            _targetSets.Tag = game;
            _plat = Gen1Platform.Resolve(_data, game, pk, KeyOf(_methodology), CheckedTargetSets());
        }
        catch (Exception e)
        {
            _status.Text = "cannot resolve: " + e.Message;
            _loading = false;
            return;
        }
        var plat = _plat;
        double menu = Gen1Tid.FramesToSeconds(plat.Timing.MenuFrame);
        Set(_status, new[]
        {
            $"{plat.GameName} on {plat.Name} [{plat.Status}]: hold START {Gen1TidText.F(Gen1Tid.FramesToSeconds(plat.Timing.HoldLoFrame), 2)}-" +
            $"{Gen1TidText.F(Gen1Tid.FramesToSeconds(plat.Timing.HoldHiFrame), 2)} s after the boot starts (frames {plat.Timing.HoldLoFrame}-{plat.Timing.HoldHiFrame}); " +
            $"the NEW GAME menu opens at {Gen1TidText.F(menu, 2)} s (frame {plat.Timing.MenuFrame}).",
            plat.Validation
        });
        Set(_methodologyText, Gen1TidText.MethodologyLines(plat, true, "").Concat(new[] { "" }).Concat(Gen1TidText.TargetSetLines(plat)));
        _targets.Rows.Clear();
        foreach (var (o, t) in Gen1Tid.RouteValidTargets(plat.Table, plat.TargetSets))
        {
            int idx = _targets.Rows.Add(o, Gen1Tid.FormatTid(t), Gen1TidText.FmtSf(Gen1Tid.TargetSeconds(o)), Gen1TidText.FmtSf(menu + Gen1Tid.TargetSeconds(o)),
                Gen1TidText.SetTag(plat, t), Gen1TidText.DerivationTag(plat, o));
            _targets.Rows[idx].Tag = o;
        }
        if (_targets.Rows.Count == 0)
            _targets.Rows.Add("none", $"no press time in offsets 0-{plat.MaxOffset} produces an accepted ID", "", "", "", "type a Trainer ID or an offset");
        Fill(_anchor, plat.Anchors.Select(a => new Item(a, a + ": " + plat.AnchorName(a))), plat.Anchors.Contains(_anchorKey) ? _anchorKey : plat.Anchors[0]);
        _anchorKey = KeyOf(_anchor);
        if (!keepTarget || _target is null || _target.Value > plat.MaxOffset) _target = null;
        _loading = false;
        _correctionManual = false;
        RefreshAnchor();
        RefreshReset();
        RefreshStats();
    }

    // ---- 2. target -------------------------------------------------------------------------------
    void AimSelected(DataGridView grid)
    {
        if (grid.SelectedRows.Count == 0 || grid.SelectedRows[0].Tag is not int o) return;
        SetTarget(o);
    }
    void SetTarget(int offset)
    {
        if (_plat is null) return;
        if (offset < 0 || offset > _plat.MaxOffset) { _targetInfo.Text = $"offsets run 0-{_plat.MaxOffset}"; return; }
        _target = offset;
        _targetInfo.Text = "Target: " + Gen1TidText.DescribeTarget(_plat, offset);
        RefreshAnchor();
    }
    void FindOffsets()
    {
        if (_plat is null) return;
        int tid;
        try { tid = Gen1Tid.ParseTid(_tid.Text); } catch (ArgumentException e) { _targetInfo.Text = "not a Trainer ID (" + e.Message + ")"; return; }
        _offsets.Rows.Clear();
        var offs = Gen1Tid.Invert(_plat.Table, tid);
        double menu = Gen1Tid.FramesToSeconds(_plat.Timing.MenuFrame);
        _targetInfo.Text = $"{Gen1Tid.FormatTid(tid)} on {_plat.Name} ({_plat.GameName}): {Gen1Tid.VerdictTextFor(tid, _plat.TargetSets)}" +
            (offs.Length == 0 ? " - not in this table: no press time produces it on this console." : offs.Length > 1 ? " - two press times give this ID: pick the one nearest your rough menu-to-press time." : "");
        foreach (var o in offs)
        {
            int idx = _offsets.Rows.Add(o, Gen1TidText.FmtSf(Gen1Tid.TargetSeconds(o)), Gen1TidText.FmtSf(menu + Gen1Tid.TargetSeconds(o)));
            _offsets.Rows[idx].Tag = o;
        }
        if (offs.Length == 1) SetTarget(offs[0]);
    }

    // ---- 3. anchor / correction -----------------------------------------------------------------
    void RefreshAnchor()
    {
        if (_plat is null) return;
        var plat = _plat;
        _anchorKey = KeyOf(_anchor);
        if (_anchorKey == "") _anchorKey = plat.Anchors[0];
        var samples = Gen1TidText.SamplesFor(_cal, plat, _anchorKey, AppMode.Mode);
        double inForce = Gen1TidText.CorrectionInForce(_cal, plat, _anchorKey, AppMode.Mode);
        if (!_correctionManual)
        {
            _loading = true;
            _correction.Value = (decimal)Math.Clamp(Math.Round(inForce, 1), (double)_correction.Minimum, (double)_correction.Maximum);
            _loading = false;
        }
        _correctionMs = (double)_correction.Value;
        var note = _correctionManual
            ? $"Correction: {Gen1TidText.FmtMs(_correctionMs)} (typed for this session; in force {Gen1TidText.FmtMs(inForce)})"
            : $"Correction in force: {Gen1TidText.FmtMs(inForce)} ({(samples.Count == 0 ? "default, no calibration yet" : "mean of " + Gen1TidText.Plural(samples.Count, "calibrated attempt"))}, {AppMode.Label} mode's store)";
        var ign = Gen1TidText.IgnoredSampleLines(_cal, plat, _anchorKey, AppMode.Mode);
        _correctionNote.Text = note + (ign.Count > 0 ? "   " + string.Join("   ", ign) : "");
        _sched = null;
        _prepared?.Dispose();
        _prepared = null;
        if (_target is null)
        {
            _protocol.Text = "Pick a target first (a row above, a typed Trainer ID, or an offset).";
            _schedule.Text = "";
            _anchorBtn.Enabled = false;
            return;
        }
        int beeps = (int)_beeps.Value;
        double spacing = (double)_spacing.Value;
        try
        {
            _sched = Gen1TidText.BuildSchedule(plat, _anchorKey, _target.Value, _correctionMs, beeps, spacing);
        }
        catch (ArgumentException e)
        {
            _protocol.Text = "cannot build the cue: " + e.Message + ". If the correction is the problem, clear the samples or type another correction.";
            _schedule.Text = "";
            _anchorBtn.Enabled = false;
            return;
        }
        Set(_protocol, Gen1TidText.ProtocolLines(plat, _anchorKey, _target.Value, _sched, _correctionMs, beeps, spacing));
        Set(_schedule, Gen1TidText.ScheduleLines(_sched, _target.Value, _correctionMs, plat));
        _phit.Text = Gen1TidText.HitSummary(samples, _anchorKey, plat.MethodologyId).Line;
        _prepared = BeepPlayer.RenderSchedule(_sched.Cues);          // before the anchor: no render time after the click
        _anchorBtn.Enabled = true;
        if (!_player.Running) _display.Text = $"A at {Gen1TidText.F(_sched.TA ?? 0, 3)} s after the anchor";
    }

    // ---- 4. cue -----------------------------------------------------------------------------------
    void AnchorNow()
    {
        if (_sched is null || _prepared is null || _player.Running) return;
        _attempt = Gen1TidText.Now();
        _player.Start(_sched, _prepared, _display, _cueLog, Gen1TidText.AnnounceCue, () =>
        {
            _cueLog.AppendText($"Done. Target was offset {_target} -> {Gen1Tid.FormatTid(_plat!.Table[_target!.Value])} under {_plat.MethodologyId}. Type the Trainer ID you got below.{Environment.NewLine}");
            _got.Focus();
        });
    }

    // ---- 5. outcome -------------------------------------------------------------------------------
    void Record()
    {
        if (_plat is null || _target is null) { _outcome.Text = "Load a target and play a cue first."; return; }
        int tid;
        try { tid = Gen1Tid.ParseTid(_got.Text); } catch (ArgumentException e) { _outcome.Text = "not a Trainer ID (" + e.Message + ")"; return; }
        var r = Gen1TidText.RecordOutcome(_cal, _plat, _anchorKey, _target.Value, _correctionMs, tid, _force.Checked, _attempt, AppMode.Mode);
        if (r.Added)
        {
            SaveCal();
            _force.Checked = false;
            _correctionManual = false;
        }
        Set(_outcome, r.Lines);
        RefreshAnchor();
        RefreshStats();
    }
    void DropLast()
    {
        if (_plat is null) return;
        var d = Gen1TidText.DropLastSample(_cal, _plat, _anchorKey, AppMode.Mode);
        SaveCal();
        _outcome.Text = d is null ? $"no samples under {_plat.MethodologyId} in {AppMode.Label} mode for {_plat.Key}/{_anchorKey}"
            : $"dropped the newest sample: aimed {d.Aimed}, hit {d.Hit}, {Gen1Tid.FormatTid(d.Tid)} (under {_plat.MethodologyId}, {AppMode.Label} mode)";
        _correctionManual = false;
        RefreshAnchor();
        RefreshStats();
    }
    void ClearSamples()
    {
        if (_plat is null) return;
        var (removed, kept) = Gen1TidText.ClearSamples(_cal, _plat, _anchorKey, AppMode.Mode);
        SaveCal();
        _outcome.Text = $"cleared calibration for {_plat.Key}/{_anchorKey} under {_plat.MethodologyId} ({AppMode.Label} mode): {Gen1TidText.Plural(removed, "sample")} removed" +
            (kept > 0 ? $"; {Gen1TidText.Plural(kept, "sample")} under other methodologies or modes kept, untouched" : "");
        _correctionManual = false;
        RefreshAnchor();
        RefreshStats();
    }
    void RefreshStats()
    {
        if (_plat is null) return;
        Set(_stats, Gen1TidText.StatsLines(Gen1TidText.SamplesFor(_cal, _plat, _anchorKey, AppMode.Mode), Gen1TidText.AllSamples(_cal, _plat.Key, _anchorKey), _plat, _anchorKey, AppMode.Mode));
    }

    // the stores of the mode in force: RUN's keys are the ones that always existed, PRACTICE / HUNT's end in ".practice"
    static Dictionary<string, CalEntry> LoadCal() => SettingsStore.GetObject<Dictionary<string, CalEntry>>(AppMode.Scoped(CalKeySetting)) ?? new();
    void SaveCal() => SettingsStore.SetObject(AppMode.Scoped(CalKeySetting), _cal);
    static Dictionary<string, List<PinRecord>> LoadPins() => SettingsStore.GetObject<Dictionary<string, List<PinRecord>>>(AppMode.Scoped(PinsSetting)) ?? new();
    void SavePins() => SettingsStore.SetObject(AppMode.Scoped(PinsSetting), _pins);
    static Dictionary<string, ResetAdjustRecord> LoadResetAdjust()
        => Gen1TidText.ParseResetAdjust(SettingsStore.GetObject<Dictionary<string, JsonElement>>(AppMode.Scoped(ResetAdjustSetting)));
    void PersistResetAdjust() => SettingsStore.SetObject(AppMode.Scoped(ResetAdjustSetting), _resetAdjust);

    // ---- the reset metronome ---------------------------------------------------------------------
    void RefreshReset()
    {
        if (_plat is null) return;
        var ra = Gen1TidText.ResetAdjustFor(_resetAdjust, _plat.Key, AppMode.Mode);
        if (!_loading && _resetAdjustN.Tag is null)
        {
            _loading = true;
            _resetAdjustN.Value = (decimal)Math.Clamp(ra.Frames, (double)_resetAdjustN.Minimum, (double)_resetAdjustN.Maximum);
            _loading = false;
        }
        string preset = _resetPreset.SelectedIndex == 1 ? "practice-save" : "route";
        double? iv = _resetInterval.Text.Trim() == "" ? null : F(_resetInterval.Text, double.NaN);
        if (iv is double d && double.IsNaN(d)) iv = null;
        _resetPrepared?.Dispose();
        _resetPrepared = null;
        try
        {
            _reset = Gen1TidText.ResetPlan(_plat, preset, (double)_resetAdjustN.Value, null, iv, (int)_resetPairs.Value, (double)_resetCadence.Value);
            var resetLines = _reset.Value.Lines.ToList();
            if (ra.Ignored is not null) { resetLines.Add(""); resetLines.Add(Gen1TidText.ResetAdjustIgnoredLine(ra.Ignored, _plat.Key, AppMode.Mode)); }
            Set(_resetText, resetLines);
            _resetPrepared = BeepPlayer.RenderSchedule(_reset.Value.Schedule.Cues);
        }
        catch (ArgumentException e)
        {
            _reset = null;
            _resetText.Text = "cannot build the metronome: " + e.Message;
        }
    }
    void SaveResetAdjust()
    {
        if (_plat is null) return;
        var saved = Gen1TidText.SetResetAdjust(_resetAdjust, _plat.Key, (double)_resetAdjustN.Value, AppMode.Mode);
        PersistResetAdjust();
        _resetNote.Text = $"Saved {Gen1TidText.F(saved.Frames, 2, true)} frames as the default adjustment for {_plat.Key} ({AppMode.Label} mode's store; recorded with the mode, never in force in the other).";
        RefreshReset();
    }
    void StartReset()
    {
        if (_reset is null || _resetPrepared is null || _player.Running) return;
        _player.Start(_reset.Value.Schedule, _resetPrepared, _resetDisplay, _resetLog, Gen1TidText.AnnounceCue, null);
    }

    // ---- verify ------------------------------------------------------------------------------------
    void VerifyNow()
    {
        if (_plat is null) return;
        int tid;
        try { tid = Gen1Tid.ParseTid(_verifyTid.Text); } catch (ArgumentException e) { _verifyOut.Text = "not a Trainer ID (" + e.Message + ")"; return; }
        double s = F(_verifyS.Text, double.NaN);
        if (double.IsNaN(s)) { _verifyOut.Text = "give the menu-to-press seconds measured from the video"; return; }
        var (_, lines) = Gen1TidText.VerifyLines(_plat, tid, s, _verifyFrom.SelectedIndex == 1, (int)_verifyTol.Value, null);
        Set(_verifyOut, lines);
    }

    // ---- the Secret ID branch ------------------------------------------------------------------------
    void SidRefresh()
    {
        string game = KeyOf(_sidGame);
        var m = Gen1TidText.SidMethodologyFor(_sid, game);
        _sidRival.Enabled = game != "emerald";
        if (game != "emerald" && _sidSpeed.SelectedIndex == 0) _sidSpeed.SelectedIndex = 2;
        Set(_sidMethodologyText, Gen1TidText.SidMethodologyLines(m, true));
    }
    (string Game, string GameName, System.Text.Json.JsonElement M, string Speed, string? Path, int NameLength) SidInputs()
    {
        string game = KeyOf(_sidGame);
        var m = Gen1TidText.SidMethodologyFor(_sid, game);
        string speed = _sidSpeed.SelectedIndex switch { 1 => "fast", 2 => "mid", 3 => "slow", _ => "" };
        if (speed == "")
        {
            if (game == "emerald")
                throw new ArgumentException("choose the text speed: Emerald's main menu has an OPTION entry and the PSR route sets FAST there before NEW GAME (a fresh cartridge is MID); the fixed part is 680 / 1645 / 2937 frames for a 1-letter name, so the tool will not guess");
            speed = "mid";
        }
        string? path = game == "emerald" ? null : (_sidRival.SelectedIndex == 1 ? "rival-preset" : "rival-newname");
        return (game, J.S(_sid.Root.GetProperty("games").GetProperty(game), "name", game), m, speed, path, (int)_sidNameLen.Value);
    }
    static List<uint> ParsePids(string text)
        => text.Split(new[] { ' ', ',', '\t', ';' }, StringSplitOptions.RemoveEmptyEntries).Select(Gen1Tid.ParsePid).ToList();

    void SidRun()
    {
        var lines = new List<string>();
        _sidGrid.Rows.Clear();
        try
        {
            var inp = SidInputs();
            int tid = Gen1Tid.ParseTid(_sidTid.Text);
            var model = Gen1TidText.SidModelFor(_sid, J.S(inp.M, "id"), inp.Speed, inp.Path);
            lines.Add($"{inp.GameName}: Secret ID from a typed Trainer ID");
            lines.Add("  [TARGET] The Trainer ID is human input: read it off the Trainer Card and type it. Nothing reads the game.");
            lines.Add($"  input path: {(model.Name != "" ? model.Name : "the one measured path")}; text speed {inp.Speed}" +
                (inp.Game != "emerald" && inp.Speed != "mid" ? " (carried over from an existing save: a fresh FireRed / LeafGreen save is MID)" : "") + $"; {inp.NameLength}-letter player name");
            var pinList = _sidNoPins.Checked ? new List<PinRecord>() : Gen1TidText.PinsFor(_pins, J.S(inp.M, "id"), tid, AppMode.Mode);
            var ignoredPins = _sidNoPins.Checked ? new List<PinRecord>() : Gen1TidText.IgnoredPins(_pins, J.S(inp.M, "id"), tid, AppMode.Mode);
            lines.AddRange(Gen1TidText.PinLines(pinList, J.S(inp.M, "id"), tid, AppMode.Mode, ignoredPins));
            int? kMin = _sidKMin.Text.Trim() == "" ? null : (int)F(_sidKMin.Text, 0);
            int? kMax = _sidKMax.Text.Trim() == "" ? null : (int)F(_sidKMax.Text, 0);
            (int, int, int)? cued = _sidCue is { } c && c.Game == inp.Game && c.Speed == inp.Speed && c.Path == inp.Path && c.NameLength == inp.NameLength
                ? (c.KExpected, c.KMin, c.KMax) : null;
            if (cued is not null && kMin is null && kMax is null) { kMin = cued.Value.Item2; kMax = cued.Value.Item3; }
            int? tsv = _sidTsv.Text.Trim() == "" ? null : (int)F(_sidTsv.Text, 0);
            var r = Gen1TidText.SidListing(model, tid, inp.NameLength, inp.Speed, kMin, kMax, pinList, ParsePids(_sidShinyPids.Text), ParsePids(_sidNonPids.Text), tsv, cued);
            lines.Add("");
            lines.AddRange(r.Lines);
            int limit = (int)_sidLimit.Value;
            var shown = limit > 0 && r.Kept.Count > limit ? r.Kept.Take(limit).ToList() : r.Kept;
            foreach (var cand in shown) _sidGrid.Rows.Add(cand.K, cand.Sid, $"${cand.Sid:X4}", cand.Tsv);
            if (shown.Count < r.Kept.Count) _sidGrid.Rows.Add("...", $"{r.Kept.Count - shown.Count} more", "(rows to show 0 lists all)", "");
        }
        catch (ArgumentException e) { lines.Add("  " + e.Message); }
        Set(_sidOut, lines);
    }
    void SidPin(bool shiny)
    {
        try
        {
            var inp = SidInputs();
            int tid = Gen1Tid.ParseTid(_sidTid.Text);
            uint pid = Gen1Tid.ParsePid(_sidPinPid.Text);
            Gen1TidText.AddPin(_pins, J.S(inp.M, "id"), tid, pid, shiny, _sidPinNote.Text, AppMode.Mode);
            SavePins();
            _sidPinOut.Text = $"pinned PID {pid:X8} as {(shiny ? "SHINY" : "not shiny")} for {J.S(inp.M, "id")} / Trainer ID {tid} ({AppMode.Label} mode's store; pins are kept per methodology, per Trainer ID and per mode, never shared)";
            SidRun();
        }
        catch (ArgumentException e) { _sidPinOut.Text = "pin refused: " + e.Message; }
    }
    void SidPinsClear()
    {
        try
        {
            var inp = SidInputs();
            int tid = Gen1Tid.ParseTid(_sidTid.Text);
            var (removed, kept) = Gen1TidText.ClearPins(_pins, J.S(inp.M, "id"), tid, AppMode.Mode);
            SavePins();
            _sidPinOut.Text = $"cleared {Gen1TidText.Plural(removed, "pin")} for {J.S(inp.M, "id")} / Trainer ID {tid} ({AppMode.Label} mode)" +
                (kept > 0 ? $"; {Gen1TidText.Plural(kept, "pin")} of the other mode kept, untouched" : "");
            SidRun();
        }
        catch (ArgumentException e) { _sidPinOut.Text = e.Message; }
    }
    // The cue's k window belongs to the model it was rendered for: changing the game, text speed, rival
    // path, name length or margin drops it, and SidRun uses it only when it matches the inputs.
    void SidDropCue()
    {
        _sidCue = null;
        _sidCueBtn.Enabled = false;
        _sidProtocol.Text = "";
    }
    void SidPrepareCue()
    {
        _sidPrepared?.Dispose();
        _sidPrepared = null;
        try
        {
            var inp = SidInputs();
            var model = Gen1TidText.SidModelFor(_sid, J.S(inp.M, "id"), inp.Speed, inp.Path);
            int margin = (int)_sidMargin.Value;
            var (kExp, kMin, kMax, beeps, sched) = Gen1TidText.SidCue(model, inp.NameLength, inp.Speed, margin, 6, 20);
            _sidCue = (kExp, kMin, kMax, sched, inp.Game, inp.Speed, inp.Path, inp.NameLength);
            Set(_sidProtocol, Gen1TidText.SidCueProtocolLines(inp.M, inp.GameName, inp.NameLength, inp.Speed, margin, model, beeps, kExp, kMin, kMax));
            _sidPrepared = BeepPlayer.RenderSchedule(sched.Cues);
            _sidCueBtn.Enabled = true;
            _sidDisplay.Text = $"last press at {Gen1TidText.F(sched.TA ?? 0, 3)} s after the anchor";
        }
        catch (ArgumentException e)
        {
            _sidCue = null;
            _sidProtocol.Text = e.Message;
            _sidCueBtn.Enabled = false;
        }
    }
    void SidAnchorNow()
    {
        if (_sidCue is null || _sidPrepared is null || _player.Running) return;
        var c = _sidCue.Value;
        _player.Start(c.Schedule, _sidPrepared, _sidDisplay, _sidCueLog, cue => cue.Kind == "A" ? ">>> A (last press) <<<" : $"A  ({cue.Label})", () =>
        {
            _sidCueLog.AppendText($"Done: expected k {c.KExpected} (window {c.KMin}-{c.KMax}). Read the Trainer ID off the Trainer Card, type it and list the candidates.{Environment.NewLine}");
            _sidTid.Focus();
        });
    }

    // One schedule playing: the pre-rendered buffer starts at the anchor click; the UI timer
    // announces each cue as its time passes, flashes the display and counts down to the A cue.
    sealed class CuePlayer
    {
        Stopwatch? _watch;
        System.Windows.Forms.Timer? _ui;
        BeepPlayer.RenderedSchedule? _rendered;
        Schedule? _sched;
        Label? _display;
        TextBox? _log;
        Func<Cue, string>? _announce;
        Action? _onDone;
        int _announced;
        double _flashUntil = -1;
        Color _base;
        public bool Running { get; private set; }
        public Action<string>? Flash { get; set; }

        public void Start(Schedule sched, BeepPlayer.RenderedSchedule rendered, Label display, TextBox log, Func<Cue, string> announce, Action? onDone)
        {
            if (Running) return;
            Running = true;
            _sched = sched; _rendered = rendered; _display = display; _log = log; _announce = announce; _onDone = onDone; _announced = 0;
            _base = display.BackColor;
            log.Text = "anchor at " + DateTime.Now.ToString("HH:mm:ss") + "  [" + AppMode.Label + " mode]" + Environment.NewLine;
            _watch = Stopwatch.StartNew();
            rendered.Play();
            _ui = new System.Windows.Forms.Timer { Interval = 15 };
            _ui.Tick += (_, _) => Tick();
            _ui.Start();
        }

        void Tick()
        {
            if (!Running || _watch is null || _sched is null || _display is null || _log is null) return;
            double elapsed = _watch.Elapsed.TotalSeconds;
            while (_announced < _sched.Cues.Count && _sched.Cues[_announced].T <= elapsed)
            {
                var c = _sched.Cues[_announced++];
                string text = _announce?.Invoke(c) ?? c.Label;
                if (text != "") _log.AppendText($"  {Gen1Tid.PyFixed(c.T, 3)}  {text}{Environment.NewLine}");
                bool big = c.Kind == "A" || c.Kind == "abeat";
                _display.BackColor = big ? Color.Gold : c.Kind == "hold" ? Color.LightSkyBlue : c.Kind == "menu" ? Color.LightGreen : c.Kind is "reset" or "power" ? Color.Salmon : Color.LightGoldenrodYellow;
                _flashUntil = elapsed + (big ? 0.22 : 0.09);
            }
            if (_flashUntil >= 0 && elapsed > _flashUntil) { _display.BackColor = _base; _flashUntil = -1; }
            if (_sched.TA is double tA)
            {
                double left = tA - elapsed;
                _display.Text = left > 0 ? $"A in {Gen1Tid.PyFixed(left, 3)} s" : "A!";
                _display.ForeColor = left > 0 && left < 4.5 ? Color.DarkOrange : SystemColors.ControlText;
            }
            else _display.Text = $"{Gen1Tid.PyFixed(elapsed, 1)} s";
            if (elapsed > _sched.Duration + 0.3) Stop(true);
        }

        public void Stop(bool done)
        {
            if (!Running) return;
            Running = false;
            _ui?.Stop();
            _ui = null;
            _rendered?.Stop();
            if (_display is not null)
            {
                _display.BackColor = _base;
                _display.ForeColor = SystemColors.ControlText;
                _display.Text = done ? "done" : "cancelled";
            }
            if (done) _onDone?.Invoke();
            else _log?.AppendText("  stopped" + Environment.NewLine);
        }
    }
}
