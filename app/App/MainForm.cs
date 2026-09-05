using ShinySolution.Core;

namespace ShinySolution.App;

public sealed class MainForm : Form
{
    public MainForm()
    {
        Text = "Shiny-Solution";
        Width = 980;
        Height = 760;
        StartPosition = FormStartPosition.CenterScreen;

        var tabs = new TabControl { Dock = DockStyle.Fill };
        tabs.TabPages.Add(Wrap("Gen 3 (GBA)", new Gen3Panel()));
        tabs.TabPages.Add(Wrap("Gen 1/2 (GB/GBC)", new GbPanel()));
        tabs.TabPages.Add(Wrap("Gen 1 TID (R/B/Y)", new Gen1TidPanel()));
        tabs.TabPages.Add(Wrap("Gen 2 TID (G/S/C)", new Gen2TidPanel()));
        tabs.TabPages.Add(Wrap("Gen 4 (NDS)", new Gen4Panel()));
        tabs.TabPages.Add(Wrap("Wizard (Gen 3/4)", new WizardPanel()));
        tabs.TabPages.Add(Wrap("Help", new HelpPanel()));
        Controls.Add(tabs);
        Controls.Add(ModeBar());        // docked to the top above the tabs (added after them, so it is docked first): on every tab
    }

    // The RUN / PRACTICE-HUNT wall's switch and banner (AppMode). RUN is the default and needs no
    // action; PRACTICE / HUNT is turned on here explicitly and the banner stays up, above every tab,
    // while it is on. Every panel's calibration store follows the mode (AppMode.Scoped).
    static Control ModeBar()
    {
        var banner = new Label
        {
            Text = AppMode.Banner, AutoSize = true, Font = new Font(SystemFonts.DefaultFont.FontFamily, 10, FontStyle.Bold),
            BackColor = Color.Gold, ForeColor = Color.Black, Padding = new Padding(8, 6, 8, 6), Margin = new Padding(3), Visible = AppMode.IsPractice
        };
        var toggle = new CheckBox
        {
            Text = "PRACTICE / HUNT mode (off = RUN, the default: your own button press and the outcome you type, nothing reads the game; " +
                   "on = practice, calibration and hunting only, with its own calibration stores)",
            AutoSize = true, Checked = AppMode.IsPractice, Margin = new Padding(3, 4, 3, 4)
        };
        toggle.CheckedChanged += (_, _) => AppMode.Set(toggle.Checked ? Modes.Practice : Modes.Run);
        AppMode.Changed += m =>
        {
            banner.Visible = m == Modes.Practice;
            if (toggle.Checked != (m == Modes.Practice)) toggle.Checked = m == Modes.Practice;
        };
        var bar = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(4, 2, 4, 2) };
        bar.Controls.Add(banner);
        bar.Controls.Add(toggle);
        return bar;
    }

    static TabPage Wrap(string title, Control panel)
    {
        var page = new TabPage(title);
        panel.Dock = DockStyle.Fill;
        page.Controls.Add(panel);
        return page;
    }
}
