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
        tabs.TabPages.Add(Wrap("Gen 4 (NDS)", new Gen4Panel()));
        tabs.TabPages.Add(Wrap("Help", new HelpPanel()));
        Controls.Add(tabs);
    }

    static TabPage Wrap(string title, Control panel)
    {
        var page = new TabPage(title);
        panel.Dock = DockStyle.Fill;
        page.Controls.Add(panel);
        return page;
    }
}
