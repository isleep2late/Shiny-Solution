using System.Text.Json;

namespace ShinySolution.App;

public static class SettingsStore
{
    static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShinySolution", "settings.json");

    static Dictionary<string, double> _values = Load();

    static Dictionary<string, double> Load()
    {
        try
        {
            if (File.Exists(Path))
                return JsonSerializer.Deserialize<Dictionary<string, double>>(File.ReadAllText(Path)) ?? new();
        }
        catch { }
        return new();
    }

    public static double Get(string key, double fallback = 0)
        => _values.TryGetValue(key, out var v) ? v : fallback;

    public static void Set(string key, double value)
    {
        _values[key] = value;
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
            File.WriteAllText(Path, JsonSerializer.Serialize(_values));
        }
        catch { }
    }
}
