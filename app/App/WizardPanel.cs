using ShinySolution.Core;

namespace ShinySolution.App;

// The wanted-IVs wizard tab (Gen 3 / Gen 4), the twin of the web app's Wizard tab (webapp/wizard-ui.js) over
// app/Core/Generators.cs, SeedTime4.cs, Timers.cs and Gen4.cs with the embedded species, encounter and static
// tables: game -> console -> the seed model printed with its decomp source and validation status (EMPIRICAL /
// model output for every game: no hardware session) -> a static / gift from the catalogue or a wild slot from
// the encounter tables (time of day on Gen 4, each game's lead effects) -> the wanted IVs, nature, ability,
// gender and shiny with the typed IDs -> the matching frames from the game's seed (Gen 3, frames stated as
// times, the honest limit and the exact first frame when nothing is inside the horizon) or the seeds a DS clock
// can reach with their dates, times and delays (Gen 4) -> the result card -> the numbered procedure with the
// advance plan -> the two-phase countdown (PhaseCountdown, the Gen 4 panel's beeps) -> "What did you get?": the
// typed nature and IVs or stats (Gen 3) or the coin flips / Elm calls (Gen 4) inverted to the frame or delay hit
// and the calibration moved. Samples live in the app's settings under wizard.calibration, per mode
// (AppMode.Scoped), each stamped with the seed model and the mode it was made in; a sample of another mode or
// model is listed as left out and never in force. TARGET mode, human input only: nothing reads the game. The
// pure part is WizardSupport.cs, pinned to the web tab by tests/wizard-panel-vectors.json.
public sealed class WizardPanel : UserControl
{
    // 1. game / console / seed model
    readonly ComboBox _game = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200 };
    readonly ComboBox _console = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 360 };
    readonly TextBox _model = Box(130);
    readonly TextBox _seed = Ui.Text("", 110);
    readonly Label _seedNote = Ui.L("");
    readonly FlowLayoutPanel _seedRow;
    readonly Label _status = Ui.L("");
    // 2. encounter and the wanted outcome
    readonly ComboBox _kind = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 230 };
    readonly ComboBox _static = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 700 };
    readonly ComboBox _table = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly ComboBox _encKind = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 160 };
    readonly ComboBox _time = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 100 };
    readonly ComboBox _species = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly Label _encounterNote = Ui.L("");
    readonly ComboBox _lead = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
    readonly ComboBox _leadNature = Ui.Combo(110, Gen3.Natures);
    readonly ComboBox _leadGender = Ui.Combo(90, "Male", "Female");
    readonly NumericUpDown _leadLevel = Ui.Num(1, 100, 50, 60);
    readonly Label _leadNote = Ui.L("");
    readonly ComboBox _method = Ui.Combo(200, "Method 1 (M1)", "Method 2 (M2, VBlank between PID and IVs)", "Method 4 (M4, VBlank between the IV words)");
    readonly NumericUpDown[] _ivMin = new NumericUpDown[6];
    readonly NumericUpDown[] _ivMax = new NumericUpDown[6];
    readonly ComboBox _nature = Ui.NatureCombo();
    readonly ComboBox _ability = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 260 };
    readonly ComboBox _gender = Ui.Combo(90, "Any", "Male", "Female");
    readonly CheckBox _shiny = new() { Text = "shiny", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly TextBox _tid = Ui.Text("", 70);
    readonly TextBox _sid = Ui.Text("", 70);
    readonly Label _wantedNote = Ui.L("");
    readonly NumericUpDown _minutes = new() { Minimum = 0.1m, Maximum = 240, DecimalPlaces = 1, Increment = 5, Value = 60, Width = 70 };
    readonly NumericUpDown _maxFrame = Ui.Num(0, 2000, 100, 70);
    readonly NumericUpDown _yearMin = Ui.Num(2000, 2099, 2000, 70);
    readonly NumericUpDown _yearMax = Ui.Num(2000, 2099, 2099, 70);
    readonly NumericUpDown _delayMin = Ui.Num(0, 65535, 0, 80);
    readonly NumericUpDown _delayMax = Ui.Num(0, 65535, 65535, 80);
    readonly NumericUpDown _delayTarget = Ui.Num(0, 65535, 600, 80);
    readonly TextBox _searchOut = Box(150);
    readonly DataGridView _grid3 = Ui.Grid(150, "Frame", "Time after the seed", "PID", "Nature", "IVs", "Gender", "Shiny");
    readonly DataGridView _grid4 = Ui.Grid(150, "Seed", "Frame", "Date", "Time", "Delay", "PID", "Nature", "IVs", "Shiny");
    // 3. card and procedure
    readonly Label _targetInfo = Ui.L("Target: none yet (search, then click a row)");
    readonly TextBox _card = Box(110);
    readonly TextBox _procedure = Box(200);
    // 4. timer
    readonly Label _display = new() { Text = "--:--.---", Font = new Font(FontFamily.GenericMonospace, 34, FontStyle.Bold), AutoSize = true, Margin = new Padding(12) };
    readonly Label _phase = Ui.L("");
    readonly NumericUpDown _cal3 = new() { Minimum = -100000, Maximum = 100000, DecimalPlaces = 1, Increment = 1, Width = 90 };
    readonly NumericUpDown _preTimer = Ui.Num(0, 600000, 5000, 80);
    readonly NumericUpDown _calD = new() { Minimum = -20000, Maximum = 65535, DecimalPlaces = 0, Value = 500, Width = 90 };
    readonly NumericUpDown _calS = Ui.Num(0, 59, 14, 60);
    readonly NumericUpDown _currentFrame = Ui.Num(0, 100000, 0, 80);
    readonly NumericUpDown _party = Ui.Num(1, 6, 1, 50);
    readonly Button _startBtn;
    readonly TextBox _timerNote = Box(90);
    readonly TextBox _timerLog = Box(60);
    readonly PhaseCountdown _timer;
    // 5. what did you get
    readonly ComboBox _gotNature = Ui.NatureCombo();
    readonly TextBox[] _gotIv = new TextBox[6];
    readonly TextBox[] _gotStat = new TextBox[6];
    readonly TextBox _gotCalls = Ui.Text("", 300);
    readonly Label _gotCallsLabel = Ui.L("Coin flips you got (H/T, in order)");
    readonly NumericUpDown _delayRange = Ui.Num(1, 2000, 100, 70);
    readonly NumericUpDown _secondRange = Ui.Num(0, 30, 1, 60);
    readonly CheckBox _roamRaikou = new() { Text = "Raikou roams", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly CheckBox _roamEntei = new() { Text = "Entei roams", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly CheckBox _roamLati = new() { Text = "Latias / Latios roams", AutoSize = true, Margin = new Padding(3, 8, 3, 3) };
    readonly TextBox _outcome = Box(80);
    readonly TextBox _calRowsOut = Box(90);
    // rows shown or hidden by generation, kind and species
    readonly Control _staticRow, _wildRow, _timeRow, _leadRow, _leadNatureRow, _leadGenderRow, _leadLevelRow, _methodRow, _genderRow, _abilityRow, _gen3Window, _gen4Window, _timerGen3, _timerGen4, _gotGen3, _gotGen4, _hgssRow;

    // state
    string _gameKey = "emerald";
    string _consoleKey = "GBA";
    WizardStaticEntry? _staticEntry;
    WizardTable? _tableRec;
    WizardSlots? _slots;
    WizardCfg? _cfg;
    List<GenResult> _hits = new();
    List<WizardGen4Row> _rows = new();
    GenResult? _target3;
    WizardGen4Row? _target4;
    Gen3Model? _timerModel3;
    Gen4Model? _timerModel4;
    Dictionary<string, WizardCalEntry> _store;
    bool _cal3Touched, _preTimerTouched, _calDTouched, _calSTouched;
    bool _loading;
    string? _dataError;

    public WizardPanel()
    {
        _store = LoadStore();
        _startBtn = Ui.Btn("Start (Space)", (_, _) => StartTimer(), 200);
        _startBtn.Font = new Font(_startBtn.Font.FontFamily, 12, FontStyle.Bold);
        _startBtn.Height = 44;
        _timer = new PhaseCountdown(_display, _phase);
        for (int i = 0; i < 6; i++)
        {
            _ivMin[i] = Ui.Num(0, 31, 0, 50); _ivMax[i] = Ui.Num(0, 31, 31, 50);
            _gotIv[i] = Ui.Text("", 40); _gotStat[i] = Ui.Text("", 45);
        }
        _cal3.Value = 0;
        _seedRow = Ui.Row(Ui.L("seed (hex)"), _seed, _seedNote);

        var ivRow = new List<Control> { Ui.L("wanted IVs (min..max)") };
        for (int i = 0; i < 6; i++) { ivRow.Add(Ui.L(Wizard.IvNames[i])); ivRow.Add(_ivMin[i]); ivRow.Add(Ui.L("..")); ivRow.Add(_ivMax[i]); }
        var gotIvRow = new List<Control> { Ui.L("IVs you got (HP/Atk/Def/SpA/SpD/Spe; leave blank to use the stats)") };
        for (int i = 0; i < 6; i++) gotIvRow.Add(_gotIv[i]);
        var gotStatRow = new List<Control> { Ui.L("or the six stats on the summary screen") };
        for (int i = 0; i < 6; i++) gotStatRow.Add(_gotStat[i]);

        _staticRow = Ui.Row(Ui.L("static / gift"), _static);
        _wildRow = Ui.Row(Ui.L("map / table"), _table, Ui.L("kind"), _encKind, _time, Ui.L("species"), _species);
        _timeRow = _time;
        _leadRow = Ui.Row(Ui.L("lead"), _lead, _leadNote);
        _leadNatureRow = Ui.Row(Ui.L("Synchronize nature"), _leadNature);
        _leadGenderRow = Ui.Row(Ui.L("Cute Charm lead gender"), _leadGender);
        _leadLevelRow = Ui.Row(Ui.L("lead level (Keen Eye / Intimidate)"), _leadLevel);
        _methodRow = Ui.Row(Ui.L("method"), _method);
        _genderRow = Ui.Row(Ui.L("gender"), _gender);
        _abilityRow = Ui.Row(Ui.L("ability"), _ability);
        _gen3Window = Ui.Row(Ui.L("search horizon after the seed (minutes, at most 240)"), _minutes);
        _gen4Window = Ui.Row(Ui.L("frame limit"), _maxFrame, Ui.L("years"), _yearMin, Ui.L(".."), _yearMax, Ui.L("delay window"), _delayMin, Ui.L(".."), _delayMax, Ui.L("target delay (nearest first)"), _delayTarget);
        _timerGen3 = Ui.Row(Ui.L("calibration (ms)"), _cal3, Ui.L("pre-timer (ms)"), _preTimer);
        _timerGen4 = Ui.Row(Ui.L("calibrated delay"), _calD, Ui.L("calibrated second"), _calS, Ui.L("frame you are at after loading"), _currentFrame, Ui.L("party size"), _party);
        _gotGen3 = Group("", Ui.Row(Ui.L("nature you got"), _gotNature), Ui.Row(gotIvRow.ToArray()), Ui.Row(gotStatRow.ToArray()), Ui.Row(Ui.Btn("Record (Gen 3)", (_, _) => RecordGen3())));
        _hgssRow = Ui.Row(_roamRaikou, _roamEntei, _roamLati);
        _gotGen4 = Group("", Ui.Row(_gotCallsLabel, _gotCalls, Ui.L("delay range +-"), _delayRange, Ui.L("second range +-"), _secondRange), _hgssRow,
            Ui.Row(Ui.Btn("Record (Gen 4)", (_, _) => RecordGen4()), Ui.Btn("Neighbouring delays", (_, _) => CalRows())), _calRowsOut);

        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        var groups = new Control[]
        {
            Ui.Group("1. Wanted-IVs wizard (Gen 3 / Gen 4): the Pokemon you want -> the frame or the seed -> the procedure. TARGET mode, human input only: nothing reads the game. " + Wizard.StatusNoSession + ".",
                Ui.Row(Ui.L("game"), _game, Ui.L("console"), _console),
                _model,
                _seedRow,
                Ui.Row(_status)),
            Ui.Group("2. Encounter and the outcome you want",
                Ui.Row(Ui.L("encounter"), _kind),
                _staticRow,
                _wildRow,
                Ui.Row(_encounterNote),
                _leadRow, _leadNatureRow, _leadGenderRow, _leadLevelRow,
                _methodRow,
                Ui.Row(ivRow.ToArray()),
                Ui.Row(Ui.L("nature"), _nature, _shiny, Ui.L("Trainer ID"), _tid, Ui.L("Secret ID"), _sid),
                _abilityRow,
                _genderRow,
                Ui.Row(_wantedNote),
                _gen3Window,
                _gen4Window,
                Ui.Row(Ui.Btn("Search", (_, _) => Search(), 160)),
                _searchOut,
                _grid3,
                _grid4),
            Ui.Group("3. Result card and procedure (click a row above)",
                Ui.Row(_targetInfo),
                _card,
                _procedure),
            Ui.Group("4. Timer: Gen 3 power on at the first long beep and press A on the last; Gen 4 start as the DS clock confirms, load the game at the first long beep, A on CONTINUE at the last",
                Ui.Row(_display),
                Ui.Row(_phase),
                _timerGen3,
                _timerGen4,
                Ui.Row(_startBtn, Ui.Btn("Cancel", (_, _) => { _timer.Cancel(); RefreshTimer(); })),
                _timerNote,
                _timerLog),
            Ui.Group("5. What did you get? (the typed outcome moves the calibration of this game, console, seed model and mode)",
                _gotGen3,
                _gotGen4,
                _outcome,
                Ui.Row(Ui.Btn("Clear (this seed model, this mode)", (_, _) => ClearSamples())))
        };
        for (int i = groups.Length - 1; i >= 0; i--) scroll.Controls.Add(groups[i]);
        Controls.Add(scroll);

        _loading = true;
        foreach (var k in Wizard.GameOrder) _game.Items.Add(new Item(k, Wizard.Games[k].Name + " (Gen " + Wizard.Games[k].Gen + ")"));
        _game.SelectedIndex = Array.IndexOf(Wizard.GameOrder, _gameKey);
        _kind.Items.Add(new Item("static", "a static / gift from the catalogue"));
        _kind.Items.Add(new Item("wild", "a wild slot from the encounter tables"));
        _kind.SelectedIndex = 0;
        foreach (var t in new[] { "morning", "day", "night" }) _time.Items.Add(new Item(t, t));
        _time.SelectedIndex = 1;
        _loading = false;

        _game.SelectedIndexChanged += (_, _) => { if (!_loading) { _gameKey = KeyOf(_game); _consoleKey = Wizard.ConsolesFor(_gameKey)[0].Key; RefreshSetup(); } };
        _console.SelectedIndexChanged += (_, _) => { if (!_loading) { _consoleKey = KeyOf(_console); RefreshSetup(); } };
        _kind.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshEncounter(); };
        _static.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshEncounter(); };
        _table.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshEncounter(); };
        _encKind.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshEncounter(); };
        _time.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshEncounter(); };
        _species.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshWanted(); };
        _lead.SelectedIndexChanged += (_, _) => { if (!_loading) RefreshLeadRows(); };
        _grid3.CellClick += (_, e) => { if (e.RowIndex >= 0 && e.RowIndex < _hits.Count && _cfg is not null) SetTargetGen3(_cfg, _hits[e.RowIndex]); };
        _grid4.CellClick += (_, e) => { if (e.RowIndex >= 0 && e.RowIndex < _rows.Count && _cfg is not null) SetTargetGen4(_cfg, _rows[e.RowIndex]); };
        _cal3.ValueChanged += (_, _) => { if (!_loading) { _cal3Touched = true; RefreshTimer(); } };
        _preTimer.ValueChanged += (_, _) => { if (!_loading) { _preTimerTouched = true; RefreshTimer(); } };
        _calD.ValueChanged += (_, _) => { if (!_loading) { _calDTouched = true; RefreshTimer(); } };
        _calS.ValueChanged += (_, _) => { if (!_loading) { _calSTouched = true; RefreshTimer(); } };
        _currentFrame.ValueChanged += (_, _) => { if (!_loading) RefreshTimer(); };
        _party.ValueChanged += (_, _) => { if (!_loading) RefreshTimer(); };
        _gotCalls.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; RecordGen4(); } };
        // a mode change swaps the store: the values in force, the notes and the procedure are re-read from the mode's own
        AppMode.Changed += _ =>
        {
            _store = LoadStore();
            _cal3Touched = _preTimerTouched = _calDTouched = _calSTouched = false;
            _outcome.Text = "";
            RefreshTimer();
        };
        RefreshSetup();
    }

    sealed record Item(string Key, string Text) { public override string ToString() => Text; }
    static string KeyOf(ComboBox c) => c.SelectedItem is Item it ? it.Key : "";
    static TextBox Box(int height) => new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Top, Height = height, WordWrap = true,
        Font = new Font(FontFamily.GenericMonospace, 8.5f)
    };
    static GroupBox Group(string title, params Control[] rows)
    {
        var g = new GroupBox { Text = title, AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(4) };
        for (int i = rows.Length - 1; i >= 0; i--) g.Controls.Add(rows[i]);
        return g;
    }
    static void Set(TextBox box, IEnumerable<string> lines) => box.Text = string.Join(Environment.NewLine, lines);
    static void Fill(ComboBox c, IEnumerable<Item> items, string? keep)
    {
        c.Items.Clear();
        int sel = 0, i = 0;
        foreach (var it in items) { c.Items.Add(it); if (it.Key == keep) sel = i; i++; }
        if (c.Items.Count > 0) c.SelectedIndex = sel;
    }
    static int? ParseInt(TextBox box)
    {
        string t = box.Text.Trim();
        if (t == "") return null;
        return int.TryParse(t, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : throw new ArgumentException("not a number: " + t);
    }
    WizardGame Game => Wizard.Game(_gameKey);
    string ModelId => Wizard.ModelOf(_gameKey).Id;

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.Space && (_target3 is not null || _target4 is not null) && ActiveControl is not (TextBox or NumericUpDown or ComboBox or Button or CheckBox or DataGridView))
        {
            if (_timer.Running) { _timer.Cancel(); RefreshTimer(); } else StartTimer();
            return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    // ---- 1. game / console / seed model ---------------------------------------------------------------
    void RefreshSetup()
    {
        _loading = true;
        try
        {
            var game = Game; var model = Wizard.ModelOf(_gameKey);
            Fill(_console, Wizard.ConsolesFor(_gameKey).Select(c => new Item(c.Key, c.Name)), _consoleKey);
            _consoleKey = KeyOf(_console);
            Set(_model, Wizard.ModelLines(_gameKey, _consoleKey));
            _seedRow.Visible = game.Gen == 3;
            if (game.Gen == 3)
            {
                if (model.Kind == "fixed") _seed.Text = Js.Hex8(model.Seed ?? 0);
                else if (_seed.Text == "00000000" || _seed.Text == "000005A0") _seed.Text = "";
                _seedNote.Text = model.Kind == "fixed" ? "the model's fixed seed (edit it for a live-battery seed you know)" : "no fixed seed: type one, or this game is unavailable here";
            }
            _gen3Window.Visible = game.Gen == 3; _gen4Window.Visible = game.Gen == 4;
            _timerGen3.Visible = game.Gen == 3; _timerGen4.Visible = game.Gen == 4;
            _gotGen3.Visible = game.Gen == 3; _gotGen4.Visible = game.Gen == 4;
            _hgssRow.Visible = game.Family == "hgss";
            _grid3.Visible = game.Gen == 3; _grid4.Visible = game.Gen == 4;
            _gotCallsLabel.Text = game.Family == "dppt" ? "Coin flips you got (H/T, in order)" : "Elm calls you got (E/K/P, in order)";
            _target3 = null; _target4 = null; _hits.Clear(); _rows.Clear(); _grid3.Rows.Clear(); _grid4.Rows.Clear();
            _searchOut.Text = ""; _card.Text = ""; _procedure.Text = "";
            _targetInfo.Text = "Target: none yet (search, then click a row)";
            LoadData(game.Gen);
            if (_dataError is null)
            {
                // a copy beside the executable that parses but lacks a key fails here, not in the constructor: the status says so
                try
                {
                    var d = Wizard.DataFor(game.Gen);
                    _status.Text = "Gen " + game.Gen + " tables loaded: " + d.SpeciesCount + " species, " + Wizard.WildTables(_gameKey).Count + " encounter tables, " + Wizard.StaticEntries(_gameKey).Count + " static / gift entries for " + game.Name + " (docs/DATA.md; embedded in the app, a copy beside ShinySolution.exe is preferred).";
                }
                catch (Exception e) { _dataError = "the tables loaded but could not be read (" + e.Message + "); a copy beside ShinySolution.exe replaces the embedded one, so check that copy"; }
            }
            if (_dataError is not null) _status.Text = "Gen " + game.Gen + " tables: " + _dataError;
        }
        finally { _loading = false; }
        if (_dataError is null) RefreshEncounter();
        RefreshTimer();
    }
    void LoadData(int gen)
    {
        _dataError = null;
        if (Wizard.HasData(gen)) return;
        try { Wizard.SetData(WizardData.Load(gen)); }
        catch (Exception e) { _dataError = e.Message; }
    }

    // ---- 2. the encounter and the wanted outcome --------------------------------------------------------
    void RefreshEncounter()
    {
        if (_dataError is not null) return;
        _loading = true;
        try
        {
            var game = Game;
            string kind = KeyOf(_kind);
            _staticRow.Visible = kind == "static"; _wildRow.Visible = kind == "wild";
            var leads = Wizard.LeadOptions(_gameKey, kind);
            Fill(_lead, leads.Select(l => new Item(l.Key, l.Name)), KeyOf(_lead));
            _leadRow.Visible = leads.Count > 1;
            _leadNote.Text = game.Gen == 4 && kind == "wild" ? Wizard.Gen4CuteCharmNote : "";
            _methodRow.Visible = game.Gen == 3;
            if (kind == "static")
            {
                var entries = Wizard.StaticEntries(_gameKey);
                Fill(_static, entries.Select(e => new Item(e.Id, e.Label + (e.Refused is not null ? " - not offered: " + e.Refused : ""))), KeyOf(_static));
                string id = KeyOf(_static);
                _staticEntry = entries.FirstOrDefault(e => e.Id == id);
                _slots = null; _tableRec = null;
                _encounterNote.Text = _staticEntry is not null ? "creation: " + _staticEntry.Creation + (_staticEntry.Provenance == "pokefinder" ? " [provenance: PokeFinder; level not verified against a decomp]" : " [decomp; level verified]") : "";
            }
            else
            {
                var tables = Wizard.WildTables(_gameKey);
                Fill(_table, tables.Select(t => new Item(t.Index.ToString(), t.Name)), KeyOf(_table));
                var t = tables.FirstOrDefault(x => x.Index.ToString() == KeyOf(_table)) ?? tables[0];
                Fill(_encKind, t.Kinds.Select(k => new Item(k, Wizard.KindNames[k])), KeyOf(_encKind));
                string enc = KeyOf(_encKind);
                _timeRow.Visible = game.Gen == 4 && enc == "grass";
                var sl = Wizard.SlotsFor(_gameKey, t.Index, enc, KeyOf(_time));
                _tableRec = t; _slots = sl; _staticEntry = null;
                Fill(_species, Wizard.SpeciesInSlots(sl.Slots).Select(s => new Item(s.Species.Dex.ToString(), Wizard.SpeciesName(s.Species) + " (slots " + string.Join(",", s.Slots) + ", L" + string.Join("/", s.Levels) + ", " + Js.F1(100 * Wizard.SpeciesShare(_gameKey, enc, sl.Slots, s.Species.Dex)) + " % of the slot roll)")), KeyOf(_species));
                _encounterNote.Text = "table " + t.Index + ", rate " + sl.Rate + (sl.Note is not null ? "; " + sl.Note : "") + (game.Gen == 3 && enc == "rock_smash" && game.Family != "frlg" ? "; Rock Smash spends the odds roll (rate " + sl.Rate + " x 16 of 2880), frames that fail it are skipped" : "");
            }
        }
        catch (Exception e) { _encounterNote.Text = "cannot resolve the encounter: " + e.Message; }
        finally { _loading = false; }
        RefreshLeadRows();
        RefreshWanted();
    }
    void RefreshLeadRows()
    {
        string k = KeyOf(_lead);
        _leadNatureRow.Visible = k == "SYNCHRONIZE"; _leadGenderRow.Visible = k == "CUTE_CHARM"; _leadLevelRow.Visible = k == "KEEN_EYE";
    }
    WizardSpecies? WantedSpecies()
    {
        if (KeyOf(_kind) == "static") return _staticEntry?.Species;
        return int.TryParse(KeyOf(_species), out var dex) && Wizard.HasData(Game.Gen) ? Wizard.SpeciesRec(Game.Gen, dex) : null;
    }
    void RefreshWanted()
    {
        var sp = WantedSpecies();
        bool genderFixed = sp is null || sp.GenderFixed;
        _genderRow.Visible = !genderFixed;
        _abilityRow.Visible = sp is not null && sp.HasSecondAbility;
        var items = new List<Item> { new("", "any") };
        if (sp is not null) for (int i = 0; i < sp.Abilities.Length; i++) if (sp.Abilities[i] != "NONE") items.Add(new Item(i.ToString(), "slot " + (i + 1) + ": " + sp.Abilities[i].Replace("_", " ").ToLowerInvariant()));
        _loading = true;
        try { Fill(_ability, items, KeyOf(_ability)); } finally { _loading = false; }
        _wantedNote.Text = sp is not null ? Wizard.SpeciesName(sp) + ": gender byte " + sp.GenderRatio + (genderFixed ? " (fixed, no gender filter)" : "") + ", abilities " + string.Join(" / ", sp.Abilities.Where(a => a != "NONE")) : "";
    }
    WizardWanted ReadWanted()
    {
        var w = new WizardWanted();
        for (int i = 0; i < 6; i++) { w.IvMin[i] = (int)_ivMin[i].Value; w.IvMax[i] = (int)_ivMax[i].Value; }
        w.Nature = Ui.NatureIndexOf(_nature);
        w.Gender = _genderRow.Visible ? (Ui.GenderOf(_gender) is char g ? g.ToString() : null) : null;
        w.Ability = _abilityRow.Visible && int.TryParse(KeyOf(_ability), out var ab) ? ab : null;
        w.Shiny = _shiny.Checked;
        w.Tid = ParseInt(_tid); w.Sid = ParseInt(_sid);
        if ((w.Tid is int t && (t < 0 || t > 65535)) || (w.Sid is int s && (s < 0 || s > 65535))) throw new ArgumentException("Trainer ID and Secret ID are 0..65535");
        var sp = WantedSpecies();
        w.Species = KeyOf(_kind) == "wild" && sp is not null ? sp.Dex : null;
        return w;
    }
    Lead? ReadLead() => Wizard.MakeLead(KeyOf(_lead), _leadNature.SelectedIndex < 0 ? 0 : _leadNature.SelectedIndex, _leadGender.SelectedIndex == 1 ? "F" : "M", (int)_leadLevel.Value);
    static readonly string[] MethodKeys = { "M1", "M2", "M4" };
    WizardCfg BuildCfg()
    {
        var game = Game;
        var cfg = new WizardCfg { Game = _gameKey, Console = _consoleKey, Kind = KeyOf(_kind), Wanted = ReadWanted(), Lead = ReadLead() };
        if (cfg.Kind == "static")
        {
            if (_staticEntry is null) throw new ArgumentException("pick a static / gift entry");
            if (_staticEntry.Refused is not null) throw new ArgumentException(_staticEntry.Label + " is not offered: " + _staticEntry.Refused);
            cfg.Species = _staticEntry.Species; cfg.Level = _staticEntry.Level; cfg.BuggedRoamer = _staticEntry.BuggedRoamer; cfg.ShinyMode = _staticEntry.ShinyMode;
            cfg.StaticMethod = _staticEntry.Method; cfg.StaticLabel = _staticEntry.Label;
            cfg.Method = game.Gen == 3 ? MethodKeys[Math.Max(0, _method.SelectedIndex)] : _staticEntry.Method;
            if (game.Gen == 4 && cfg.StaticMethod == "M1" && cfg.Lead is not null) throw new ArgumentException("a Method 1 creation (gift, starter, roamer, fossil) takes no lead effect");
        }
        else
        {
            if (_slots is null || _tableRec is null) throw new ArgumentException("pick an encounter table");
            cfg.Slots = _slots.Slots; cfg.Rate = _slots.Rate; cfg.Encounter = KeyOf(_encKind); cfg.TableName = _tableRec.Name; cfg.Tanoby = _slots.Tanoby;
            cfg.Method = game.Gen == 3 ? MethodKeys[Math.Max(0, _method.SelectedIndex)] : game.Method!;
        }
        if (game.Gen == 3)
        {
            string seedText = _seed.Text.Trim();
            if (seedText.StartsWith("$")) seedText = seedText[1..];
            if (seedText.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) seedText = seedText[2..];
            if (!System.Text.RegularExpressions.Regex.IsMatch(seedText, "^[0-9a-fA-F]{1,8}$")) throw new ArgumentException("no seed: " + Wizard.ModelOf(_gameKey).Text);
            cfg.Seed = uint.Parse(seedText, System.Globalization.NumberStyles.HexNumber);
            cfg.MaxFrame = (long)Js.Round(Math.Min(240, Math.Max(0.1, (double)_minutes.Value)) * 60 * Wizard.FpsOf(_consoleKey));
            cfg.Limit = 20;
        }
        else
        {
            cfg.MaxFrame = (int)_maxFrame.Value;
            cfg.YearMin = (int)_yearMin.Value; cfg.YearMax = Math.Max(cfg.YearMin, (int)_yearMax.Value);
            cfg.DelayMin = (int)_delayMin.Value; cfg.DelayMax = Math.Max(cfg.DelayMin, (int)_delayMax.Value);
            cfg.TargetDelay = (int)_delayTarget.Value;
            cfg.Limit = 30;
        }
        return cfg;
    }
    void Search()
    {
        var out_ = new List<string>();
        _grid3.Rows.Clear(); _grid4.Rows.Clear(); _hits.Clear(); _rows.Clear();
        try
        {
            var cfg = BuildCfg();
            _cfg = cfg;
            _target3 = null; _target4 = null; _card.Text = ""; _procedure.Text = "";
            Cursor = Cursors.WaitCursor;
            if (Game.Gen == 3)
            {
                var r = Wizard.SearchGen3(cfg);
                out_ = Wizard.Gen3SearchLines(r, cfg);
                _hits = r.Hits;
                foreach (var m in r.Hits)
                    _grid3.Rows.Add(m.Frame, Js.FmtMs(Wizard.FrameToMs(m.Frame, cfg.Console)), Js.Hex8(m.Pid), Wizard.NatureName(m.Nature), Wizard.IvText(m.Ivs), m.Gender == 2 ? "-" : m.Gender == 1 ? "F" : "M", cfg.Wanted.Tid is null || cfg.Wanted.Sid is null ? "?" : (m.Shiny ? "YES" : "no"));
            }
            else
            {
                var r = Wizard.SearchGen4(cfg);
                out_ = Wizard.Gen4SearchLines(r, cfg);
                _rows = r.Rows;
                foreach (var row in r.Rows)
                    _grid4.Rows.Add(Js.Hex8(row.Seed), row.Frame, row.Year + "-" + Js.Two(row.Month) + "-" + Js.Two(row.Day), Js.Two(row.Hour) + ":" + Js.Two(row.Minute) + ":" + Js.Two(row.Second), row.Delay, Js.Hex8(row.Mon.Pid), Wizard.NatureName(row.Mon.Nature), Wizard.IvText(row.Mon.Ivs), cfg.Wanted.Tid is null || cfg.Wanted.Sid is null ? "?" : (row.Mon.Shiny ? "YES" : "no"));
            }
        }
        catch (Exception e) { out_ = new List<string> { "cannot search: " + e.Message }; }
        finally { Cursor = Cursors.Default; }
        Set(_searchOut, out_);
        RefreshTimer();
    }

    // ---- 3. the target: the card and the procedure ---------------------------------------------------------
    void SetTargetGen3(WizardCfg cfg, GenResult m)
    {
        _target3 = m; _target4 = null;
        string timeText = Js.FmtMs(Wizard.FrameToMs(m.Frame, cfg.Console)) + " after the seed";
        Set(_card, Wizard.CardLines(m, cfg, cfg.Seed ?? 0, timeText));
        _targetInfo.Text = "Target: frame " + m.Frame + " of seed " + Js.Hex8(cfg.Seed ?? 0) + " (" + timeText + "); seed model " + ModelId;
        RefreshTimer();
    }
    void SetTargetGen4(WizardCfg cfg, WizardGen4Row row)
    {
        _target4 = row; _target3 = null;
        string timeText = Wizard.TimeText(row);
        Set(_card, Wizard.CardLines(row.Mon, cfg, row.Seed, timeText));
        _targetInfo.Text = "Target: seed " + Js.Hex8(row.Seed) + " frame " + row.Frame + " (" + timeText + "); seed model " + ModelId;
        RefreshTimer();
    }

    // ---- 4. the timer -------------------------------------------------------------------------------
    Gen3Model TimerModelGen3(WizardInForce force) => new(Gen3Mode.Standard, (double)_preTimer.Value, _target3?.Frame ?? 0, (double)_cal3.Value);
    Gen4Model TimerModelGen4(WizardInForce force) => new(_target4?.Delay ?? 600, _target4?.Second ?? 50, (double)_calD.Value, (double)_calS.Value);
    void RefreshTimer()
    {
        var game = Game;
        var force = Wizard.InForce(_store, _gameKey, _consoleKey, AppMode.Mode, ModelId);
        _loading = true;
        try
        {
            if (game.Gen == 3)
            {
                if (!_cal3Touched) _cal3.Value = (decimal)Math.Max(-100000, Math.Min(100000, Math.Round(force.Value.Calibration ?? 0, 1)));
                if (!_preTimerTouched) _preTimer.Value = (decimal)Math.Max(0, Math.Min(600000, force.Value.PreTimer ?? 5000));
            }
            else
            {
                if (!_calDTouched) _calD.Value = (decimal)Math.Max(-20000, Math.Min(65535, force.Value.CalibratedDelay ?? 500));
                if (!_calSTouched) _calS.Value = (decimal)Math.Max(0, Math.Min(59, force.Value.CalibratedSecond ?? 14));
            }
        }
        finally { _loading = false; }
        var lines = new List<string>
        {
            "Calibration in force for " + game.Name + " on " + Wizard.Consoles[_consoleKey].Name + " in " + AppMode.Label + " mode (setting " + AppMode.Scoped(Wizard.CalKeySetting) + "): " + Js.Plural(force.Samples.Count, "sample") + " under " + ModelId + (force.Samples.Count > 0 ? ", last " + force.Samples[^1].When : "") + "."
        };
        lines.AddRange(Wizard.IgnoredLines(force.Ignored, AppMode.Mode, ModelId).Select(l => "  " + l));
        if ((_target3 is null && _target4 is null) || _cfg is null)
        {
            lines.Add("No target yet: search, then click a row.");
            Set(_timerNote, lines); _procedure.Text = "";
            if (!_timer.Running) { _display.Text = "--:--.---"; _phase.Text = ""; }
            return;
        }
        if (game.Gen == 3 && _target3 is not null)
        {
            _timerModel3 = TimerModelGen3(force);
            var ph = Timers.Gen3Phases(Wizard.Settings(_consoleKey), _timerModel3);
            lines.Add("Phases: " + Js.FmtMs(ph[0]) + " (pre-timer, power on at its end) then " + Js.FmtMs(ph[1]) + " (A on the last beep).");
            if (!_timer.Running) _display.Text = Js.FmtMs(ph[0] + ph[1]);
            Set(_procedure, Wizard.Gen3Procedure(_cfg, _target3, _timerModel3));
        }
        else if (_target4 is not null)
        {
            _timerModel4 = TimerModelGen4(force);
            var settings = Wizard.Settings(_consoleKey);
            var p4 = Timers.Gen4Phases(settings, _timerModel4);
            double minutes = Timers.Gen4MinutesBefore(settings, _timerModel4);
            lines.Add("Phases: " + Js.FmtMs(p4[0]) + " then " + Js.FmtMs(p4[1]) + "; set the clock " + Js.Num(minutes) + " minute" + (minutes == 1 ? "" : "s") + " before the target minute.");
            if (!_timer.Running) _display.Text = Js.FmtMs(p4[0] + p4[1]);
            long current = (long)_currentFrame.Value; int party = (int)_party.Value;
            var plan = SeedTime4.PlanAdvances(current, _target4.Frame, party, Wizard.AdvanceToolsFor(_gameKey));
            Set(_procedure, Wizard.Gen4Procedure(_cfg, _target4, _timerModel4, plan, current, party));
        }
        Set(_timerNote, lines);
    }
    void StartTimer()
    {
        if (_timer.Running || _cfg is null) return;
        double[] ph;
        string l1, l2;
        if (Game.Gen == 3 && _target3 is not null && _timerModel3 is not null)
        {
            ph = Timers.Gen3Phases(Wizard.Settings(_consoleKey), _timerModel3);
            l1 = "phase 1: the pre-timer (power on at the long beep)"; l2 = "phase 2: press A on the last beep (frame " + _target3.Frame + ")";
        }
        else if (_target4 is not null && _timerModel4 is not null)
        {
            ph = Timers.Gen4Phases(Wizard.Settings(_consoleKey), _timerModel4);
            l1 = "phase 1: load the game from the DS menu at the long beep"; l2 = "phase 2: press A on CONTINUE at the last beep (delay " + _target4.Delay + ")";
        }
        else return;
        if (ph[1] <= 0) { _timerNote.Text = "phase 2 is not positive: check the calibration"; return; }
        _timerLog.Text = "started at " + DateTime.Now.ToString("HH:mm:ss") + "  [" + AppMode.Label + " mode]  " + ModelId;
        _timer.Start(ph[0], ph[1], l1, l2);
    }

    // ---- 5. what did you get? ----------------------------------------------------------------------------
    string Attempt() => _timerLog.Text.Split('\n')[0].Trim();
    void RecordGen3()
    {
        try
        {
            if (_target3 is null || _cfg is null || _timerModel3 is null) throw new ArgumentException("no target: search and pick a frame first");
            int? nature = Ui.NatureIndexOf(_gotNature);
            var ivs = new int[6]; bool haveIvs = true;
            var stats = new int?[6]; bool haveStats = false;
            for (int i = 0; i < 6; i++)
            {
                var v = ParseInt(_gotIv[i]); if (v is null) haveIvs = false; else ivs[i] = v.Value;
                var s = ParseInt(_gotStat[i]); if (s is not null) { stats[i] = s; haveStats = true; }
            }
            var report = Wizard.RecordGen3(_store, _cfg, _target3, _timerModel3, nature, haveIvs ? ivs : null, haveStats ? stats : null, AppMode.Mode, Attempt());
            if (report.Sample is not null) { SaveStore(); _cal3Touched = false; }
            Set(_outcome, report.Lines);
        }
        catch (ArgumentException e) { _outcome.Text = "not recorded: " + e.Message; }
        RefreshTimer();
    }
    void RecordGen4()
    {
        try
        {
            if (_target4 is null || _cfg is null || _timerModel4 is null) throw new ArgumentException("no target: search and pick a row first");
            bool hgss = Game.Family == "hgss";
            var report = Wizard.RecordGen4(_store, _cfg, _target4, _timerModel4, _gotCalls.Text, (int)_delayRange.Value, (int)_secondRange.Value,
                hgss && _roamRaikou.Checked, hgss && _roamEntei.Checked, hgss && _roamLati.Checked, AppMode.Mode, Attempt());
            if (report.Sample is not null) { SaveStore(); _calDTouched = false; }
            Set(_outcome, report.Lines);
        }
        catch (ArgumentException e) { _outcome.Text = "not recorded: " + e.Message; }
        RefreshTimer();
    }
    void CalRows()
    {
        try
        {
            if (_target4 is null || Game.Gen != 4) throw new ArgumentException("a Gen 4 target is needed");
            bool hgss = Game.Family == "hgss";
            Set(_calRowsOut, Wizard.CalRowLines(_gameKey, _target4, (int)_delayRange.Value, hgss && _roamRaikou.Checked, hgss && _roamEntei.Checked, hgss && _roamLati.Checked));
        }
        catch (Exception e) { _calRowsOut.Text = e.Message; }
    }
    void ClearSamples()
    {
        var (removed, _) = Wizard.ClearSamples(_store, _gameKey, _consoleKey, AppMode.Mode, ModelId);
        SaveStore();
        _cal3Touched = _preTimerTouched = _calDTouched = _calSTouched = false;
        _outcome.Text = "cleared " + Js.Plural(removed, "sample") + " under " + ModelId + " in " + AppMode.Label + " mode; other modes' and other models' samples kept";
        RefreshTimer();
    }

    // the store of the mode in force: RUN's key is wizard.calibration, PRACTICE / HUNT's ends in ".practice"
    static Dictionary<string, WizardCalEntry> LoadStore() => SettingsStore.GetObject<Dictionary<string, WizardCalEntry>>(AppMode.Scoped(Wizard.CalKeySetting)) ?? new();
    void SaveStore() => SettingsStore.SetObject(AppMode.Scoped(Wizard.CalKeySetting), _store);
}
