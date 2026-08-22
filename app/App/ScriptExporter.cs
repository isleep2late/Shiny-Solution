using System.Reflection;

namespace ShinySolution.App;

public static class ScriptExporter
{
    public static readonly (string Resource, string FileName)[] Scripts =
    {
        ("lua.gen3", "shiny-solution.lua"),
        ("lua.gb", "shiny-solution-gb.lua")
    };

    public static List<string> ExportTo(string folder)
    {
        var written = new List<string>();
        var asm = Assembly.GetExecutingAssembly();
        foreach (var (resource, fileName) in Scripts)
        {
            using var stream = asm.GetManifestResourceStream(resource);
            if (stream is null) continue;
            var path = Path.Combine(folder, fileName);
            using var file = File.Create(path);
            stream.CopyTo(file);
            written.Add(path);
        }
        return written;
    }
}
