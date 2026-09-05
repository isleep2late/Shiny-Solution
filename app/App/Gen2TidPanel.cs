using ShinySolution.Core;

namespace ShinySolution.App;

// The Gen 2 Trainer ID / Lucky ID tab (Gold / Silver / Crystal), the twin of the web app's Gen 2 TID tab
// over app/Core/Gen2Tid.cs and the embedded gen2-tid.json, modelled on Gen1TidPanel: game -> console ->
// methodology (every one of the game's listed with its protocol and validity conditions verbatim) -> the
// cartridge's RTC state with the reachability rule -> target (a route row across the console's RTC states,
// a typed Trainer ID / Lucky ID or any bin) -> anchor + correction -> protocol -> cue (the same pre-rendered
// buffer and cue player as the Gen 1 panel) -> "What did you get?" inverted in bins with the engine's 15-bin
// outlier guard and the Gen 1 duplicate guard, an invert panel with the ambiguity statistics, and the
// moderators' verify from the visible menu box. Calibration samples live in the app's settings under
// gen2tid.calibration, per mode (AppMode.Scoped), every record stamped with the mode it was made in; the
// cue log names the mode of every attempt. Every output names the methodology id and its validity, and the
// panel states that no hardware sample exists for any Gen 2 configuration. The pure part is Gen2TidSupport.cs.
public sealed class Gen2TidPanel : UserControl
{
    readonly Gen2TidData _data = Gen2TidData.Load();
    readonly Gen1TidData _data1 = Gen1TidData.Load();          // the reset models (GSE's gbp-fade) live in the Gen 1 data
    Dictionary<string, Gen2CalEntry> _cal;

    // 1. game / console / methodology / RTC state
    readonly ComboBox _game = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200 };
    readonly ComboBox _platform = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly ComboBox _methodology = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly ComboBox _state = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly CheckedListBox _targetSets = new() { Width = 220, Height = 76, CheckOnClick = true };
    readonly TextBox _status = Box(150);
    readonly TextBox _methodologyText = Box(180);
    // 2. target
    readonly DataGridView _targets = Ui.Grid(110, "RTC state", "Bin", "A after the visible menu", "After the boot starts", "TID", "Lucky ID", "Set", "Reachable");
    readonly TextBox _tid = Ui.Text("", 110);
    readonly TextBox _lid = Ui.Text("", 90);
    readonly NumericUpDown _binN = Ui.Num(0, Gen2Tid.BinCount - 1, 300, 80);
    readonly TextBox _findOut = Box(90);
    readonly DataGridView _bins = Ui.Grid(70, "RTC state", "Bin", "A after the visible menu", "TID", "Lucky ID", "Reachable");
    readonly Label _targetInfo = Ui.L("Target: none yet");
    // 3. anchor / correction
    readonly ComboBox _anchor = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 520 };
    readonly NumericUpDown _correction = new() { Minimum = -5000, Maximum = 5000, DecimalPlaces = 1, Increment = 5, Width = 90 };
    readonly NumericUpDown _beeps = Ui.Num(0, 10, 4, 60);
    readonly NumericUpDown _spacing = new() { Minimum = 0.2m, Maximum = 5, DecimalPlaces = 1, Increment = 0.1m, Value = 1.0m, Width = 60 };
    readonly Label _correctionNote = Ui.L("");
    readonly TextBox _protocol = Box(280);
    readonly TextBox _schedule = Box(110);
    // 4. cue
    readonly Label _display = BigLabel();
    readonly Button _anchorBtn;
    readonly Label _phit = Ui.L("");
    readonly TextBox _cueLog = Box(110);
    // 5. outcome
    readonly TextBox _got = Ui.Text("", 110);
    readonly TextBox _gotLid = Ui.Text("", 90);
    readonly CheckBox _force = new() { Text = "force (add even if it looks like a duplicate or is more than 15 bins / 60 frames out)", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly TextBox _outcome = Box(120);
    readonly TextBox _stats = Box(140);
    // invert
    readonly TextBox _invertTid = Ui.Text("", 110);
    readonly TextBox _invertLid = Ui.Text("", 90);
    readonly ComboBox _invertScope = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly TextBox _invertOut = Box(150);
    readonly DataGridView _invertGrid = Ui.Grid(70, "Table", "Bin", "A after the visible menu", "TID", "Lucky ID", "Reachable");
    // verify
    readonly TextBox _verifyTid = Ui.Text("", 110);
    readonly TextBox _verifyLid = Ui.Text("", 90);
    readonly TextBox _verifyS = Ui.Text("", 80);
    readonly TextBox _verifyOut = Box(220);

    // state
    Gen2Platform? _plat;
    int? _bin;
    string _anchorKey = Gen2Tid.AnchorMenu;
    bool _correctionManual;
    double _correctionMs;
    Gen2Schedule? _sched;
    Schedule? _cueSched;
    BeepPlayer.RenderedSchedule? _prepared;
    string? _attempt;
    readonly CuePlayer _player = new();
    bool _loading;

    public Gen2TidPanel()
    {
        _cal = LoadCal();
        _anchorBtn = Ui.Btn("ANCHOR (Space)", (_, _) => AnchorNow(), 200);
        _anchorBtn.Font = new Font(_anchorBtn.Font.FontFamily, 12, FontStyle.Bold);
        _anchorBtn.Height = 44;

        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var groups = new Control[]
        {
            Ui.Group("1. Gen 2 Trainer ID / Lucky ID (Gold / Silver / Crystal): the one timed A tap on NEW GAME. " + Gen2TidText.RulesLine + " " + Gen2TidText.NoHardwareLine,
                Ui.Row(Ui.L("game"), _game, Ui.L("console or emulator"), _platform),
                Ui.Row(Ui.L("methodology"), _methodology, Ui.L("RTC state of the cartridge"), _state),
                Ui.Row(Ui.L("target sets in force"), _targetSets),
                _status,
                _methodologyText),
            Ui.Group("2. Target: a route row (double-click; a row in another RTC state switches the state and is first boot only), a typed Trainer ID / Lucky ID, or any bin",
                _targets,
                Ui.Row(Ui.Btn("Aim at the selected row", (_, _) => AimSelected(_targets)),
                    Ui.L("Trainer ID you want (decimal like 20322, or hex $4F62)"), _tid, Ui.L("Lucky ID (optional)"), _lid, Ui.Btn("Find bins", (_, _) => FindBins()),
                    Ui.L("or any bin (0-598)"), _binN, Ui.Btn("Aim at bin", (_, _) => SetTarget((int)_binN.Value))),
                _findOut,
                _bins,
                Ui.Row(Ui.Btn("Aim at the selected bin", (_, _) => AimSelected(_bins)), _targetInfo)),
            Ui.Group("3. Anchor and correction",
                Ui.Row(Ui.L("anchor: when will you click ANCHOR?"), _anchor, Ui.L("correction (ms)"), _correction,
                    Ui.Btn("Use the calibrated one", (_, _) => { _correctionManual = false; RefreshAnchor(); }),
                    Ui.L("count-in beeps"), _beeps, Ui.L("spacing (s)"), _spacing),
                Ui.Row(_correctionNote),
                _protocol,
                _schedule),
            Ui.Group("4. Cue: click ANCHOR at the anchor moment the protocol names (the beeps come from one pre-rendered buffer; the display flashes with each; on the long high beep tap A once for 4-8 frames)",
                Ui.Row(_display),
                Ui.Row(_anchorBtn, Ui.Btn("Cancel", (_, _) => _player.Stop(false))),
                Ui.Row(_phit),
                _cueLog),
            Ui.Group("5. What did you get?",
                Ui.Row(Ui.L("Trainer ID you got (Trainer Card, or a Pokemon's status screen IDNo; decimal or hex $...)"), _got, Ui.L("Lucky ID (Radio Tower lottery screen; optional)"), _gotLid, _force,
                    Ui.Btn("Record", (_, _) => Record()), Ui.Btn("Drop last", (_, _) => DropLast()), Ui.Btn("Clear (this methodology)", (_, _) => ClearSamples())),
                _outcome,
                Ui.Row(Ui.L("Your timing: spread, P(hit), attempts per hit, drift (samples are kept per console and anchor with their methodology id, RTC state and mode; only samples under the active methodology made in this mode are averaged)")),
                _stats),
            Ui.Group("Invert: any Trainer ID (and Lucky ID) against the console's tables in a chosen scope, with the ambiguity statistics (double-click a candidate to aim at it)",
                Ui.Row(Ui.L("Trainer ID"), _invertTid, Ui.L("Lucky ID (optional)"), _invertLid, Ui.L("scope"), _invertScope, Ui.Btn("Invert", (_, _) => InvertNow())),
                _invertOut,
                _invertGrid,
                Ui.Row(Ui.Btn("Aim at the selected candidate", (_, _) => AimSelected(_invertGrid)))),
            Ui.Group("Verify (moderators): are the IDs consistent with a hand-measured time from the visible menu box to the A press? (no press-to-visible lag is known for Gen 2: measure the press itself)",
                Ui.Row(Ui.L("Trainer ID in the run"), _verifyTid, Ui.L("Lucky ID (optional)"), _verifyLid, Ui.L("visible menu box to press (s, from the video)"), _verifyS, Ui.Btn("Verify", (_, _) => VerifyNow())),
                _verifyOut)
        };
        for (int i = groups.Length - 1; i >= 0; i--) scroll.Controls.Add(groups[i]);
        Controls.Add(scroll);

        _targets.CellDoubleClick += (_, _) => AimSelected(_targets);
        _bins.CellDoubleClick += (_, _) => AimSelected(_bins);
        _invertGrid.CellDoubleClick += (_, _) => AimSelected(_invertGrid);
        _game.SelectedIndexChanged += (_, _) => { if (!_loading) { _platform.Tag = null; _methodology.Tag = null; _state.Tag = null; RefreshPlatform(false); } };
        _platform.SelectedIndexChanged += (_, _) => { if (!_loading) { _methodology.Tag = null; RefreshPlatform(false); } };
        _methodology.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshPlatform(true); };
        _state.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshPlatform(true); };
        _targetSets.ItemCheck += (_, _) => { if (!_loading) BeginInvoke(new Action(() => RefreshPlatform(true))); };
        _anchor.SelectedIndexChanged += (_, _) => { if (!_loading) { _correctionManual = false; RefreshAnchor(); RefreshStats(); } };
        _correction.ValueChanged += (_, _) => { if (!_loading) { _correctionManual = true; RefreshAnchor(); } };
        _beeps.ValueChanged += (_, _) => { if (!_loading) RefreshAnchor(); };
        _spacing.ValueChanged += (_, _) => { if (!_loading) RefreshAnchor(); };
        _got.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Record(); } };
        _gotLid.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Record(); } };
        _tid.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; FindBins(); } };
        _invertTid.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; InvertNow(); } };
        // a mode change swaps the store: the correction, the stats and the notes are re-read from the mode's own
        AppMode.Changed += _ =>
        {
            _cal = LoadCal();
            _correctionManual = false;
            RefreshAnchor(); RefreshStats();
        };

        _loading = true;
        foreach (var g in Gen2Platform.SupportedGames(_data)) _game.Items.Add(new Item(g, J.S(_data.Game(g), "name", g)));
        _game.SelectedIndex = Math.Max(0, Gen2Platform.SupportedGames(_data).ToList().IndexOf(Gen2Platform.DefaultGame));
        _loading = false;
        RefreshPlatform(false);
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
    static string Sf(double seconds) => Gen1TidText.FmtSf(seconds);
    // a typed ID field: empty is "not given"; decimal or $hex as on the Gen 1 panel
    static int? ParseId(TextBox box, string what)
    {
        if (box.Text.Trim() == "") return null;
        try { return Gen1Tid.ParseTid(box.Text); }
        catch (ArgumentException e) { throw new ArgumentException("not a " + what + " (" + e.Message + ")"); }
    }

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

    // ---- 1. game / console / methodology / RTC state --------------------------------------------
    string[] CheckedTargetSets() => _targetSets.CheckedItems.Cast<object>().Select(x => x.ToString() ?? "").ToArray();

    void RefreshPlatform(bool keepTarget)
    {
        _loading = true;
        try
        {
            string game = KeyOf(_game);
            var plats = Gen2Platform.PlatformsFor(_data, game);
            Fill(_platform, plats.Select(p => new Item(p.Key, p.Name)), KeyOf(_platform) != "" ? KeyOf(_platform) : Gen2Platform.DefaultPlatform);
            string pk = KeyOf(_platform);
            var (def, ids) = Gen2Platform.PlatformMethodologies(_data, pk, game);
            string keepM = ids.Contains(KeyOf(_methodology)) ? KeyOf(_methodology) : def ?? "";
            Fill(_methodology, ids.Select(id => new Item(id, id + ": " + J.S(_data.Methodology(id).Raw, "name"))), keepM);
            var states = Gen2Platform.StateOptions(_data, game);
            string keepS = states.Any(s => s.Value == KeyOf(_state)) ? KeyOf(_state) : J.S(_data.Root.GetProperty("defaults"), "state", "days0");
            Fill(_state, states.Select(s => new Item(s.Value, s.Text)), keepS);
            _state.Enabled = states.Count > 1;
            var g = _data.Game(game);
            var wanted = (string?)_targetSets.Tag == game ? CheckedTargetSets() : J.SA(g, "default_target_sets");
            if (wanted.Length == 0 && (string?)_targetSets.Tag != game) wanted = J.SA(g, "target_sets");
            _targetSets.Items.Clear();
            foreach (var k in J.SA(g, "target_sets")) _targetSets.Items.Add(k, wanted.Contains(k));
            _targetSets.Tag = game;
            _plat = Gen2Platform.Resolve(_data, _data1, game, pk, KeyOf(_methodology), KeyOf(_state), CheckedTargetSets());
        }
        catch (Exception e)
        {
            _status.Text = "cannot resolve: " + e.Message;
            _loading = false;
            return;
        }
        var plat = _plat;
        var t = plat.Timing;
        Set(_status, new[]
        {
            $"{plat.GameName} on {plat.Name} [{plat.Status}]: {J.S(plat.Methodology, "landmark")}",
            $"Hold window frames {t.HoldLoFrame}-{t.HoldHiFrame} ({Gen1TidText.F(t.HoldLoFrame / Gen2Tid.Fps, 2)}-{Gen1TidText.F(t.HoldHiFrame / Gen2Tid.Fps, 2)} s after the boot starts); the NEW GAME / OPTION box is visible on frame " +
                $"{t.VisibleMenuFrame} ({Gen1TidText.F(plat.VisibleMenuS, 2)} s); the first poll accepts an A down up to {t.FirstPollFrame - t.VisibleMenuFrame} frames after it, then one poll every {t.PollPeriodFrames} frames: {Gen2Tid.BinCount} bins.",
            $"Methodology {plat.MethodologyId}: {J.S(plat.Methodology, "status")}. {plat.Validation}",
            $"RTC state {Gen2Platform.StateLabel(_data, plat.GameKey, plat.State)}.",
            Gen2TidText.NoHardwareLine,
            Gen2Platform.ScriptsLine(_data, plat.GameKey)
        }.Concat(Gen2Platform.ReachabilityLines(_data, plat.GameKey)));
        Set(_methodologyText, Gen2TidText.MethodologyLines(plat, true, "").Concat(new[] { "" }).Concat(Gen2TidText.TargetSetLines(plat)).Concat(new[] { "" }).Concat(Gen2TidText.AllMethodologyLines(_data, plat.GameKey)));
        _targets.Rows.Clear();
        var (inState, otherStates) = Gen2TidText.TargetRows(plat);
        foreach (var h in inState) AddTargetRow(h, plat.State, false);
        if (inState.Count == 0)
            _targets.Rows.Add(plat.State, "none", $"no single tap in this table (bins 0-{Gen2Tid.BinCount - 1}) produces an accepted ID", "", "", "", "", "type a Trainer ID or a bin instead");
        foreach (var h in otherStates) AddTargetRow(h, h.State ?? "", true);
        Fill(_anchor, plat.Anchors.Select(a => new Item(a, a + ": " + plat.AnchorName(a))), plat.Anchors.Contains(_anchorKey) ? _anchorKey : plat.Anchors[0]);
        _anchorKey = KeyOf(_anchor);
        RefreshInvertScope();
        if (!keepTarget) _bin = null;
        _loading = false;
        _correctionManual = false;
        if (_bin is int b) SetTarget(b); else RefreshAnchor();
        RefreshStats();
    }
    void AddTargetRow(Gen2Target h, string state, bool other)
    {
        var plat = _plat!;
        double aimV = (h.Offsets[0] + h.Offsets[1]) / 2.0 - Gen2Tid.VisibleMenuLagFrames;
        int idx = _targets.Rows.Add(state + (other ? " (other state)" : ""), h.Bin, Sf(aimV / Gen2Tid.Fps), Sf(plat.VisibleMenuS + aimV / Gen2Tid.Fps),
            Gen2TidText.FmtId(h.Tid), plat.HasLid ? Gen2TidText.FmtLid(h.Lid) : "", string.Join(", ", h.Sets), h.ReachableAfterFirstBoot ? "recurs boot after boot" : "first boot only");
        _targets.Rows[idx].Tag = (state, h.Bin);
    }

    // ---- 2. target -------------------------------------------------------------------------------
    void AimSelected(DataGridView grid)
    {
        if (grid.SelectedRows.Count == 0 || grid.SelectedRows[0].Tag is not (string state, int bin)) return;
        SetTargetIn(state, bin);
    }
    // a row of another RTC state switches the state first (the table is that state's; first boot only)
    void SetTargetIn(string state, int bin)
    {
        if (_plat is not null && state != _plat.State && _state.Enabled)
        {
            int idx = -1;
            for (int i = 0; i < _state.Items.Count; i++) if (_state.Items[i] is Item it && it.Key == state) idx = i;
            if (idx >= 0)
            {
                _bin = bin;
                _state.SelectedIndex = idx;          // RefreshPlatform(true) through the handler re-aims at _bin
                return;
            }
        }
        SetTarget(bin);
    }
    void SetTarget(int bin)
    {
        if (_plat is null) return;
        if (bin < 0 || bin >= Gen2Tid.BinCount) { _targetInfo.Text = $"bins run 0-{Gen2Tid.BinCount - 1}"; return; }
        _bin = bin;
        _targetInfo.Text = "Target: " + Gen2TidText.DescribeBin(_plat, bin);
        RefreshAnchor();
    }
    void FindBins()
    {
        if (_plat is null) return;
        int? tid, lid;
        try { tid = ParseId(_tid, "Trainer ID"); lid = ParseId(_lid, "Lucky ID"); }
        catch (ArgumentException e) { _findOut.Text = e.Message; return; }
        if (tid is null) { _findOut.Text = "type the Trainer ID you want"; return; }
        var inState = Gen2TidText.InvertLines(_plat, tid.Value, lid, "all", _plat.State);
        var lines = inState.Lines.Take(inState.Lines.Count - 1).ToList();     // the ambiguity line belongs to the invert panel
        var cands = inState.Inversion.Candidates.ToList();
        if (cands.Count == 0 && _plat.RtcDependent)
        {
            var all = Gen2Tid.Invert(_data, _plat.GameKey, tid.Value, lid, null, _plat.PlatformKey);
            if (all.Candidates.Count > 0)
            {
                lines.Add("  In other RTC states of this platform: " + string.Join("; ", all.Candidates.Select(c => c.Table + " bin " + c.Bin + (c.ReachableAfterFirstBoot ? "" : " (first boot only)"))));
                cands = all.Candidates;
            }
        }
        Set(_findOut, lines);
        FillCandidates(_bins, cands);
        if (cands.Count == 1 && Gen2Tid.SplitKey(cands[0].Table).State == _plat.State) SetTarget(cands[0].Bin);
    }
    void FillCandidates(DataGridView grid, IReadOnlyList<Gen2Candidate> cands)
    {
        grid.Rows.Clear();
        var plat = _plat!;
        foreach (var c in cands)
        {
            string st = Gen2Tid.SplitKey(c.Table).State;
            double aimV = (c.Offsets[0] + c.Offsets[1]) / 2.0 - Gen2Tid.VisibleMenuLagFrames;
            int idx = grid == _invertGrid
                ? grid.Rows.Add(c.Table, c.Bin, Sf(aimV / Gen2Tid.Fps), Gen2TidText.FmtId(c.Tid), plat.HasLid ? Gen2TidText.FmtLid(c.Lid) : "", c.ReachableAfterFirstBoot ? "recurs boot after boot" : "first boot only")
                : grid.Rows.Add(st + (st == plat.State ? "" : " (other state)"), c.Bin, Sf(aimV / Gen2Tid.Fps), Gen2TidText.FmtId(c.Tid), plat.HasLid ? Gen2TidText.FmtLid(c.Lid) : "", c.ReachableAfterFirstBoot ? "recurs boot after boot" : "first boot only");
            grid.Rows[idx].Tag = (st, c.Bin);
        }
    }

    // ---- 3. anchor / correction -----------------------------------------------------------------
    void RefreshAnchor()
    {
        if (_plat is null) return;
        var plat = _plat;
        _anchorKey = KeyOf(_anchor);
        if (_anchorKey == "") _anchorKey = plat.Anchors[0];
        var samples = Gen2TidText.SamplesFor(_cal, plat, _anchorKey, AppMode.Mode);
        double inForce = Gen2TidText.CorrectionInForce(_cal, plat, _anchorKey, AppMode.Mode);
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
        var ign = Gen2TidText.IgnoredSampleLines(_cal, plat, _anchorKey, AppMode.Mode);
        _correctionNote.Text = note + (ign.Count > 0 ? "   " + string.Join("   ", ign) : "");
        _sched = null;
        _cueSched = null;
        _prepared?.Dispose();
        _prepared = null;
        if (_bin is null)
        {
            _protocol.Text = "Pick a target first (a row above, a typed Trainer ID, or a bin).";
            _schedule.Text = "";
            _anchorBtn.Enabled = false;
            return;
        }
        int beeps = (int)_beeps.Value;
        double spacing = (double)_spacing.Value;
        try
        {
            _sched = Gen2TidText.BuildSchedule(plat, _anchorKey, _bin.Value, _correctionMs, beeps, spacing);
        }
        catch (ArgumentException e)
        {
            _protocol.Text = "cannot build the cue: " + e.Message + ". If the correction is the problem, clear the samples or type another correction.";
            _schedule.Text = "";
            _anchorBtn.Enabled = false;
            return;
        }
        Set(_protocol, Gen2TidText.ProtocolLines(plat, _anchorKey, _bin.Value, _sched, _correctionMs, beeps, spacing));
        Set(_schedule, Gen2TidText.ScheduleLines(_sched, _bin.Value, _correctionMs, plat));
        _phit.Text = Gen2TidText.HitSummary(samples, _anchorKey, plat.MethodologyId).Line;
        _cueSched = Gen2TidText.ToGen1Schedule(_sched);
        _prepared = BeepPlayer.RenderSchedule(_cueSched.Cues);      // before the anchor: no render time after the click
        _anchorBtn.Enabled = true;
        if (!_player.Running) _display.Text = $"A at {Gen1TidText.F(_sched.TA, 3)} s after the anchor";
    }

    // ---- 4. cue -----------------------------------------------------------------------------------
    void AnchorNow()
    {
        if (_plat is null || _bin is null || _sched is null || _cueSched is null || _prepared is null || _player.Running) return;
        _attempt = Gen1TidText.Now();
        var plat = _plat;
        int bin = _bin.Value;
        _player.Start(_cueSched, _prepared, _display, _cueLog, Gen2TidText.AnnounceCue, () =>
        {
            var r = Gen2TidText.Info(plat, bin);
            _cueLog.AppendText($"Done. Target was bin {bin} -> {Gen2TidText.IdsText(plat, r)} under {plat.MethodologyId} (RTC state {plat.State}). Type the Trainer ID you got below.{Environment.NewLine}");
            _got.Focus();
        });
    }

    // ---- 5. outcome -------------------------------------------------------------------------------
    void Record()
    {
        if (_plat is null || _bin is null) { _outcome.Text = "Load a target and play a cue first."; return; }
        int? tid, lid;
        try { tid = ParseId(_got, "Trainer ID"); lid = ParseId(_gotLid, "Lucky ID"); }
        catch (ArgumentException e) { _outcome.Text = e.Message; return; }
        if (tid is null) { _outcome.Text = "type the Trainer ID you got"; return; }
        var r = Gen2TidText.RecordOutcome(_cal, _plat, _anchorKey, _bin.Value, _correctionMs, tid.Value, lid, _force.Checked, _attempt, AppMode.Mode);
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
        var d = Gen2TidText.DropLastSample(_cal, _plat, _anchorKey, AppMode.Mode);
        SaveCal();
        _outcome.Text = d is null ? $"no samples under {_plat.MethodologyId} in {AppMode.Label} mode for {_plat.Key}/{_anchorKey}"
            : $"dropped the newest sample: aimed bin {d.AimedBin}, hit bin {d.HitBin}, TID {Gen2TidText.FmtId(d.Tid)} (under {_plat.MethodologyId}, {AppMode.Label} mode)";
        _correctionManual = false;
        RefreshAnchor();
        RefreshStats();
    }
    void ClearSamples()
    {
        if (_plat is null) return;
        var (removed, kept) = Gen2TidText.ClearSamples(_cal, _plat, _anchorKey, AppMode.Mode);
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
        Set(_stats, Gen2TidText.StatsLines(Gen2TidText.SamplesFor(_cal, _plat, _anchorKey, AppMode.Mode), _plat, _anchorKey, AppMode.Mode));
    }

    // the store of the mode in force: RUN's key is the one that always existed, PRACTICE / HUNT's ends in ".practice"
    static Dictionary<string, Gen2CalEntry> LoadCal() => SettingsStore.GetObject<Dictionary<string, Gen2CalEntry>>(AppMode.Scoped(Gen2TidText.CalKeySetting)) ?? new();
    void SaveCal() => SettingsStore.SetObject(AppMode.Scoped(Gen2TidText.CalKeySetting), _cal);

    // ---- the invert panel --------------------------------------------------------------------------
    void RefreshInvertScope()
    {
        var plat = _plat!;
        var items = plat.RtcDependent
            ? new[]
            {
                new Item("prior", "the two-state prior (days0, days512): a cartridge booted before"),
                new Item("all", "every RTC state (first boot of a cartridge)"),
                new Item("running", "the ten running-clock states"),
                new Item("halted", "the ten halted-clock states"),
                new Item("state", "the chosen RTC state only (" + plat.State + ")")
            }
            : new[] { new Item("all", "the one Crystal table") };
        Fill(_invertScope, items, KeyOf(_invertScope) != "" ? KeyOf(_invertScope) : "prior");
    }
    void InvertNow()
    {
        if (_plat is null) return;
        int? tid, lid;
        try { tid = ParseId(_invertTid, "Trainer ID"); lid = ParseId(_invertLid, "Lucky ID"); }
        catch (ArgumentException e) { _invertOut.Text = e.Message; return; }
        if (tid is null) { _invertOut.Text = "type the Trainer ID to invert"; return; }
        string v = KeyOf(_invertScope);
        var r = v == "state" ? Gen2TidText.InvertLines(_plat, tid.Value, lid, "all", _plat.State) : Gen2TidText.InvertLines(_plat, tid.Value, lid, v, null);
        Set(_invertOut, r.Lines);
        FillCandidates(_invertGrid, r.Inversion.Candidates);
    }

    // ---- verify ------------------------------------------------------------------------------------
    void VerifyNow()
    {
        if (_plat is null) return;
        int? tid, lid;
        try { tid = ParseId(_verifyTid, "Trainer ID"); lid = ParseId(_verifyLid, "Lucky ID"); }
        catch (ArgumentException e) { _verifyOut.Text = e.Message; return; }
        if (tid is null) { _verifyOut.Text = "type the Trainer ID in the run"; return; }
        double s = F(_verifyS.Text, double.NaN);
        if (!double.IsFinite(s)) { _verifyOut.Text = "give the seconds from the visible menu box to the press, measured from the video"; return; }
        var (_, _, lines) = Gen2TidText.VerifyLines(_plat, tid.Value, lid, s);
        Set(_verifyOut, lines);
    }
}
