using ShinySolution.Core;

namespace ShinySolution.App;

// The desktop app's side of the RUN / PRACTICE-HUNT wall: one persisted setting ("mode" in
// settings.json; absent means RUN), the banner MainForm shows above every tab while PRACTICE /
// HUNT is on, and Scoped(), which every calibration setting goes through so that the two modes
// never share a store (RUN keys are unchanged; PRACTICE / HUNT keys end in ".practice").
public static class AppMode
{
    public const string SettingKey = "mode";
    public const string Banner = Modes.Banner;

    static string _mode = Modes.IsMode(SettingsStore.GetString(SettingKey)) ? SettingsStore.GetString(SettingKey)! : Modes.Run;

    public static string Mode => _mode;
    public static bool IsPractice => _mode == Modes.Practice;
    public static string Label => Modes.Label(_mode);
    public static event Action<string>? Changed;

    public static void Set(string mode)
    {
        mode = Modes.Check(mode);
        if (mode == _mode) return;
        _mode = mode;
        SettingsStore.SetString(SettingKey, mode);
        Changed?.Invoke(mode);
    }

    public static string Scoped(string settingKey) => Modes.StoreKey(settingKey, _mode);
}
