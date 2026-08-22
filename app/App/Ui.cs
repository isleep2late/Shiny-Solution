namespace ShinySolution.App;

public static class Ui
{
    public static Label L(string text, int width = 0)
    {
        var l = new Label { Text = text, AutoSize = width == 0, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(3, 8, 3, 3) };
        if (width > 0) l.Width = width;
        return l;
    }

    public static NumericUpDown Num(decimal min, decimal max, decimal value, int width = 80)
        => new() { Minimum = min, Maximum = max, Value = value, Width = width };

    public static TextBox Text(string value, int width = 100) => new() { Text = value, Width = width };

    public static ComboBox Combo(int width, params string[] items)
    {
        var c = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = width };
        c.Items.AddRange(items);
        c.SelectedIndex = 0;
        return c;
    }

    public static ComboBox NatureCombo(int width = 110)
    {
        var items = new List<string> { "Any" };
        items.AddRange(Core.Gen3.Natures);
        return Combo(width, items.ToArray());
    }

    public static Button Btn(string text, EventHandler onClick, int width = 0)
    {
        var b = new Button { Text = text, AutoSize = width == 0 };
        if (width > 0) b.Width = width;
        b.Click += onClick;
        return b;
    }

    public static FlowLayoutPanel Row(params Control[] controls)
    {
        var p = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true, WrapContents = true, Dock = DockStyle.Top };
        p.Controls.AddRange(controls);
        return p;
    }

    public static GroupBox Group(string title, params Control[] rows)
    {
        var g = new GroupBox { Text = title, AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(8) };
        for (int i = rows.Length - 1; i >= 0; i--) g.Controls.Add(rows[i]);
        return g;
    }

    public static DataGridView Grid(int height, params string[] columns)
    {
        var g = new DataGridView
        {
            Height = height,
            Dock = DockStyle.Top,
            ReadOnly = true,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            RowHeadersVisible = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            MultiSelect = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill
        };
        foreach (var c in columns) g.Columns.Add(c.Replace(" ", ""), c);
        return g;
    }

    public static int? NatureIndexOf(ComboBox combo) => combo.SelectedIndex <= 0 ? null : combo.SelectedIndex - 1;

    public static char? GenderOf(ComboBox combo) => combo.SelectedItem?.ToString() switch
    {
        "Male" => 'M',
        "Female" => 'F',
        _ => null
    };
}
