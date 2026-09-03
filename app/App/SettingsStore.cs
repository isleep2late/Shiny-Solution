using System.Text.Json;

namespace ShinySolution.App;

// Per-user settings in %APPDATA%\ShinySolution\settings.json: numbers (the timers' calibrations),
// since the Gen 1 Trainer ID panel whole objects (its calibration samples, pins and reset adjusts), and
// the mode string (AppMode). Older files hold only numbers and still load. Calibration keys go through
// AppMode.Scoped: RUN keys are the ones that always existed, PRACTICE / HUNT keys end in ".practice".
public static class SettingsStore
{
    static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ShinySolution", "settings.json");

    static Dictionary<string, JsonElement> _values = Load();

    static Dictionary<string, JsonElement> Load()
    {
        try
        {
            if (File.Exists(Path))
                return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(Path)) ?? new();
        }
        catch { }
        return new();
    }

    public static double Get(string key, double fallback = 0)
        => _values.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : fallback;

    public static void Set(string key, double value)
    {
        _values[key] = JsonSerializer.SerializeToElement(value);
        Save();
    }

    public static string? GetString(string key)
        => _values.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static void SetString(string key, string value)
    {
        _values[key] = JsonSerializer.SerializeToElement(value);
        Save();
    }

    public static T? GetObject<T>(string key) where T : class
    {
        if (!_values.TryGetValue(key, out var v) || v.ValueKind != JsonValueKind.Object) return null;
        try { return JsonSerializer.Deserialize<T>(v.GetRawText()); } catch { return null; }
    }

    public static void SetObject<T>(string key, T value)
    {
        _values[key] = JsonSerializer.SerializeToElement(value);
        Save();
    }

    static void Save()
    {
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
            File.WriteAllText(Path, JsonSerializer.Serialize(_values));
        }
        catch { }
    }
}
