namespace ShinySolution.App;

public sealed class HelpPanel : UserControl
{
    const string HelpText = @"SHINY-SOLUTION — QUICKSTART

STEP 0 (once): install mGBA 0.10.2 or newer (mgba.io/downloads), then click
""Export mGBA scripts..."" below and save the two .lua files somewhere permanent.

=== GEN 3 (Ruby/Sapphire), EMULATOR — fully automatic ===
1. Open your ROM in mGBA. Tools > Scripting > File > Load script > shiny-solution.lua.
   The script console should say ""detected Ruby"" and ""net: listening on port 8356"".
2. In this app: Gen 3 tab > Emulator > Connect.
3. Shiny starter: play a NEW game to the starter bag on Route 101, select your starter,
   and STOP on the ""Do you choose this POKeMON?"" YES/NO box with YES highlighted.
   Set filters if you want (nature/gender/min IV — Apply), leave the mode dropdown on
   ""Starter / gift"", then click ""Shiny!"".
   The script checkpoints, measures its own timing with one throwaway press, rewinds,
   waits for the next shiny frame, presses A itself, and verifies the PID from RAM.
   Hands off the emulator until it reports SUCCESS. Long waits are normal with strict
   filters — the log tells you the ETA before it commits.
4. Exact TID: on a New Game, stop on Birch's FINAL text box (""Come see me in my
   POKeMON LAB."") — not the name confirm. Enter the TID and click ""TID manip"".
   It lands the exact TID and reports the SID that comes with it.
5. ANY static legendary (Rayquaza, Groudon, Kyogre, the Regis...): stand in front of it,
   stop on the last A press before the battle starts, switch the mode dropdown to
   ""Static encounter"", click Shiny!. Same self-calibrating flow, watching the enemy
   battle slot instead of your party.
6. Wild grass, or a site where calibration fails: use the Brute-force hunt row — stand
   one input from the encounter, pick the trigger, Start hunt, hold fast-forward. It
   takes its own checkpoint (savestate slot 9) and retries it with shifted timing until
   the encounter rolls shiny (1/8192 unfiltered, like a real hunt but hands-free).

=== GEN 3, REAL HARDWARE — dead-battery Ruby/Sapphire ===
Console timer sub-tab. A dead RTC battery makes every boot identical (seed 0x5A0),
so press times are measured from power-on:
1. Find TID targets > pick a row > Load selected.
2. Click ""Start at power-on"" at the EXACT instant you flip the power switch.
3. Play a New Game to Birch's final text box, wait, press A on the long beep.
4. Check your Trainer Card, type the TID you got into 4a, Calibrate. It computes the
   exact frame drift AND tells you your SID. Repeat — attempts converge fast because
   every boot replays the same timeline.
5. Shiny starter: enter TID+SID in group 2, pick a target, same loop. Calibrate with
   4b using the nature, gender and the six stats from the summary screen.

=== GEN 1/2 (GB/GBC), EMULATOR — automatic hunt bot ===
The old games have no seedable RNG, so the bot retries a savestate with shifted timing
until the roll comes out shiny:
1. Open Red/Blue/Yellow/Gold/Silver/Crystal in mGBA, load shiny-solution-gb.lua.
2. In-game, walk to ONE INPUT away from the roll: facing the gift/starter ball with
   the confirm box up (Gen 2), or standing at the edge of grass (trigger = the direction
   key that steps in), or on New Game for a TID hunt.
   GEN 1 STARTER/GIFT: stop on the ""Do you want to give a nickname?"" Yes/No box and set
   trigger B — in Red/Blue/Yellow the DVs are rolled only after you answer that box.
3. Gen 1/2 tab > Connect > set trigger/watch/target > Apply settings > Start hunt.
4. Hold Tab in mGBA (fast-forward) and let it grind. Gen 2 shiny odds are 1/8192, so
   expect thousands of attempts — the bot reports progress and stops on the shiny,
   leaving the game right there for you to play out and save.
   Gen 1 note: shininess doesn't exist in Gen 1; the ""shiny"" target hunts the DVs
   that become shiny when traded to Gen 2.

=== GEN 4 (NDS) — searcher + timer ===
Gen 4 seeds from the DS clock plus a frame-counter ""delay"" at Continue. The tab
searches target seeds, gives you a calibrated timer, and verifies which seed you hit
from what you observed in-game. Automatic input needs a scriptable DS emulator and is
on the roadmap; this tab is the assisted mode.

TROUBLESHOOTING
- ""not connected"": the script isn't loaded, or the emulator is paused (a paused
  emulator services no sockets), or a firewall is blocking localhost.
- Port busy after reloading a script: the script auto-tries the next 4 ports; match
  the port field to what the script console printed.
- The auto flows need mGBA savestate slot 9; the script warns if it can't use it.
- Shiny that wasn't shiny? Click ""Self-check"" (Gen 3 tab): it prints the TID/SID it
  reads from your save and the OT ID on your party's first Pokemon. They must match.
  As of v0.3.0 the script reads TID/SID with aligned 16-bit reads and verifies every
  result against the OT ID the game writes into the mon itself, so a reported SHINY is
  the game's own shiny check passing - not just the tool's bookkeeping.
- Non-starter gifts: stand on the confirm box; the flow watches the first empty party
  slot, so gifts work even when your party already has Pokemon (party must not be full).";

    public HelpPanel()
    {
        var text = new RichTextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            Text = HelpText,
            Font = new Font(FontFamily.GenericSansSerif, 10)
        };
        var buttons = Ui.Row(
            Ui.Btn("Export mGBA scripts...", (_, _) => Export()),
            Ui.L("Writes shiny-solution.lua and shiny-solution-gb.lua for loading in mGBA."));
        Controls.Add(text);
        Controls.Add(buttons);
    }

    void Export()
    {
        using var dialog = new FolderBrowserDialog { Description = "Choose where to save the mGBA Lua scripts" };
        if (dialog.ShowDialog() != DialogResult.OK) return;
        var written = ScriptExporter.ExportTo(dialog.SelectedPath);
        MessageBox.Show(written.Count > 0
            ? "Saved:\n" + string.Join("\n", written)
            : "No scripts were written (missing embedded resources).", "Shiny-Solution");
    }
}
