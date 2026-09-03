# Shiny-Solution — exact usage

## One-time setup

1. Install **mGBA 0.10.2 or newer** from mgba.io/downloads (the normal Qt desktop build —
   scripting and sockets are included in official Windows builds).
2. Run **ShinySolution.exe**. Go to the **Help** tab → **Export mGBA scripts...** and save
   `shiny-solution.lua` and `shiny-solution-gb.lua` somewhere permanent.

## Gen 3: fully automatic shiny starter (Ruby/Sapphire, emulator)

1. Open the ROM in mGBA. **Tools → Scripting → File → Load script** →
   `shiny-solution.lua`. The console prints `detected Ruby` and
   `net: listening on port 8356`.
2. In the app: **Gen 3 tab → Emulator → Connect** (defaults are right). The status labels
   go live.
3. Play a New Game normally until the Route 101 starter bag, pick your starter, and stop
   on **"Do you choose this POKéMON?" with YES highlighted**. Do not press A.
4. Optional: set nature/gender/min-IV filters and click **Apply filters**. Strict filters
   mean long waits — the log reports the ETA before committing.
5. Leave the mode dropdown on **Starter / gift**, click **Shiny!**, and take your hands
   off. The script saves a checkpoint to
   slot 9, fires one throwaway press to measure the game's press-to-generation delay,
   rewinds, waits for the next shiny frame, presses A itself, and verifies the PID from
   RAM. On `SUCCESS ... SHINY`, play on and save. If a press ever lands off-frame it
   recalibrates and retries by itself, up to twice; after that it stops and tells you to
   reload your pre-prompt savestate and click **Re-arm**.

## Gen 3: exact TID (emulator)

Same setup, but stop on **Birch's final text box — "Come see me in my POKéMON LAB."**
(NOT the earlier "So it's (name)?" confirm). Enter the TID, click **TID manip**. The
result line reports the SID that comes with your new TID — write it down.

> **Emerald / FireRed / LeafGreen are experimental.** Ruby and Sapphire are fully verified.
> On E/FRLG the memory addresses are derived (not decomp-proven) and the shiny model, while
> the same Method 1, is only auto-checked against the mon's own OT ID — so **TID manip is
> disabled** on these games (their trainer ID is seeded differently; see FACTS.md) and
> **Shiny!** prints an EXPERIMENTAL warning. Run **Self-check** first and confirm the TID/SID
> and the party's OT ID look right before trusting a result.

## Gen 3: any static legendary (emulator)

Rayquaza, Groudon, Kyogre, the Regis, Deoxys — anything that starts a battle from a fixed
overworld encounter. Save your game in front of it, stop on the **last A press before the
battle begins** (usually the press that dismisses the cry/roar text box), switch the mode
dropdown to **Static encounter**, and click **Shiny!**. It's the same self-calibrating
flow as the starter, watching the enemy battle slot instead of your party: throwaway
press to measure the site's timing, rewind, wait for the shiny frame, press, verify.
Statics generate exactly like starters (Method 1), so the calibration locks on.

## Gen 3: wild encounters and stubborn sites (emulator)

Wild grass rolls extra RNG (nature re-roll loops), so the model-based flow doesn't apply —
use the **Brute-force hunt** row instead: stand one input from the encounter (edge of the
grass, trigger = the direction key that steps in; or A in front of a stubborn static),
**Start hunt**, hold fast-forward. It retries your position with shifted timing and stops
when the encounter rolls shiny against your real TID/SID. Unfiltered odds are 1/8192, so
expect thousands of attempts — it reports progress every 25.

## Gen 3: real hardware (dead-battery Ruby/Sapphire)

Gen 3 tab → **Console timer** sub-tab. Works because a dry RTC battery makes every boot
identical (seed 0x5A0):

1. **Find TID targets** → pick a row → **Load selected**.
2. Click **Start at power-on** at the exact instant you flip the power switch.
3. Play a New Game to Birch's final text box, wait there, press A on the **long** beep
   (five short beeps count you in).
4. Check the Trainer Card, enter the TID you got in **4a → Calibrate**. It computes your
   exact frame drift, corrects the timer, and tells you that save's SID. Every boot
   replays the same timeline, so attempts converge fast.
5. Shiny starter: put TID + SID into group 2, pick a target, same loop. After an attempt,
   calibrate with **4b** using the nature, gender, and the six stats from the summary
   screen (the stats make your landing frame unambiguous).

## Gen 1/2: automatic hunt bot (emulator)

Works on Red/Blue/Yellow/Gold/Silver/Crystal. These games have no seedable RNG, so the bot
retries with shifted timing until the roll is what you want:

1. Open the ROM in mGBA, load `shiny-solution-gb.lua` (console prints the detected game
   and `net: listening on port 8357`).
2. In-game, get **one input away from the roll**:
   - Gen 2 starter/gift (Gold/Silver/Crystal): the confirm box before receiving the mon →
     trigger **A**, watch **party**
   - **Gen 1 starter/gift (Red/Blue/Yellow): stop on the "Do you want to give a nickname?"
     Yes/No box** — in Gen 1 the DVs are rolled only *after* you answer that box, so savestate
     there, set trigger **B** (declines the name), watch **party**. (Savestating on the earlier
     receive-confirm will just hang at the nickname screen; the bot tells you to move.)
   - Static encounter (Ho-Oh, Lugia, Suicune in Crystal, Snorlax, Mewtwo and the birds in
     Gen 1...): facing it with the last text box up → trigger **A**, watch **enemy**
   - Wild encounter: standing at the edge of grass → trigger = the direction that steps in,
     watch **enemy**
   - Trainer ID: the menu press that starts a New Game → trigger **A**, watch **tid**,
     target **custom** with your TID as 4 hex digits (`?` wildcards allowed)
   Special cases: Red Gyarados is always shiny; Raikou/Entei roll their DVs once on their
   first-ever encounter (savestate before that trigger); the Odd Egg picks from a fixed
   table.
3. App → **Gen 1/2 tab → Connect** → set trigger/watch/target → **Apply settings** →
   **Start hunt**.
4. Hold **Tab** (fast-forward) in mGBA and let it grind. Gen 2 shiny odds are 1/8192, so
   thousands of attempts are normal — progress is reported live. On **FOUND** the bot
   stops with the game sitting right there: play out the battle/catch and save.
   - Gen 1 note: shininess doesn't exist in Gen 1. The "shiny" target hunts the DVs that
     are shiny when traded forward to Gen 2.
   - Red Gyarados is always shiny; roamers and the Odd Egg roll differently (see FACTS).

## Gen 1 Trainer ID (Red / Blue / Yellow): the one timed A press

TARGET mode, human input only: you say which Trainer ID (or which table offset) you want, the
tool says what to do, cues the one timed press, and learns from the ID you type afterwards. The
same steps in the web app's **Gen 1 TID** tab (hackmons.com/rng-solution, in preview until it is
promoted), the desktop app's
**Gen 1 TID (R/B/Y)** tab, and RNG Solution's terminal (`./rng-solution.sh`).

1. **Game and console.** Pick Red, Blue or Yellow and the console: GSE / gambatte-speedrun in
   GBP mode with the GBC BIOS (emulator-exact), GBA HD (Red: hardware-validated 5 of 5), GBA /
   GBA SP (same silicon), GameCube Game Boy Player (UNVALIDATED: your first attempts are a
   transfer test), or the original Game Boy (Red: 5 of 6). Read the **methodology** it resolves
   to (e.g. `red/gba/hold-start-v1`) and its validity conditions: the prediction holds only
   under that input pattern, and the protocol's steps are that pattern.
2. **Target.** Click a route-valid row (Red / Blue: the `$40xx` sled for the Any% save
   corruption, `[3x cold-boot verified]` or `[extended sweep, one derivation]`; the PSR sets
   are opt-in target sets), or type any Trainer ID and take one of its press times, or any
   offset. Yellow has no route-valid ID under the shipped methodology.
3. **Anchor and correction.** The anchor is the moment you press ANCHOR (or Space): the NEW
   GAME menu appearing (recommended), the power switch (handhelds, GBA HD, DMG), or RESET
   (GSE, Game Boy Player: the 2.175 s fade and stall are added). The correction starts at
   200 ms (menu) or 100 ms (power-on, reset) and becomes the mean of your calibrated attempts.
   Read the **PROTOCOL**: clear the save, power on, hold START inside the window, press ANCHOR
   at the anchor moment, then four short beeps and one long high beep: press A ON the long
   beep. On the power-on and reset anchors low beeps mark the START window and a double blip
   marks when the menu should appear.
4. **Cue.** Press ANCHOR at the anchor moment. The whole schedule is one pre-rendered buffer
   (every beep on an exact sample) and the screen or display flashes with each beep.
5. **What did you get?** Type the Trainer ID (a Pokémon's status screen shows IDNo). It inverts
   to the offset you hit; the implied correction (used + frames late x 16.7427 ms) is averaged
   in; an in-table ID more than 60 frames from the aim, or the same attempt entered twice, is
   refused unless you tick force; an ID that is not in the table teaches nothing (START held
   outside the window, a CONTINUE menu, the wrong console). Then P(hit) with its 90 % range,
   attempts per hit, a drift flag and a recommendation. Samples are kept per console and anchor
   with their methodology id (the browser's localStorage, the desktop app's settings.json,
   `~/.rng-solution/config.json`); samples under another methodology are ignored, never mixed.
6. **Save-corruption reset.** The metronome beats RESET then A (GSE, Game Boy Player: 199.2 ms
   on the route path, 149.6 ms over a practice save) or A then power off (handhelds, DMG:
   397.9 ms). Calibrate from outcomes (does CONTINUE give the 255-Pokémon party?), never from
   "RESET to black"; the practice-save path is 50 ms later than the route's first save.
7. **Verify (moderators).** A Trainer ID and the menu-to-press time measured from the video:
   is the ID one the table produces within N frames of that time? Say whether you measured the
   press itself (button overlay, hand cam) or its first visible effect (the DMG's 38.83-frame
   and the GBA's 8.7-frame press-to-visible lag are subtracted).

## Emerald / FireRed / LeafGreen: the Secret ID from a typed Trainer ID

These games cannot have their Trainer ID chosen (it is the raw Timer1 count at the naming
screen's exit), but the Secret ID follows from it: SID = high 16 bits of LCRNG^(k+1)(TID), k
being the VBlank count from the seed to the roll (one Random() per VBlank; the fixed part is
680 / 1645 / 2937 frames for Emerald at fast / mid / slow with a 1-letter name, 1868 for
FireRed and LeafGreen at mid on the NEW NAME rival path). The same card in the web tab and the
desktop tab, and `rng-solution sid` in the terminal.

1. Pick the game, the OPTIONS text speed (Emerald: you must say; the PSR route sets FAST from
   the main menu, a fresh cartridge is MID; FireRed / LeafGreen: MID unless carried over from
   a save), the player name length, and on FireRed / LeafGreen the rival path (NEW NAME, a
   1-letter rival, or a preset name).
2. Optional cue: show the cue protocol, press ANCHOR as you press A on OK at the naming screen,
   then tap A ON each beep, once (never while the text is still printing, never B). Only the
   last press sets k: the window is expected k -6 / +20, 27 candidates instead of 1201.
3. Read the Trainer ID off the Trainer Card, type it, list the candidates (k, SID, TSV).
4. Narrow it later: catch anything and pin its PID as shiny (allows exactly 8 Secret IDs) or
   not shiny (excludes 8). Pins are kept per methodology and per Trainer ID; one shiny pin
   usually leaves a single candidate.

## Gen 4: assisted manip (real DS or emulator by hand)

Gen 4 seeds from the DS clock + a frame-counter "delay" at the moment the game re-seeds.
The tab gives you targets, a two-phase timer, and seed verification:

1. **Find TID targets**: enter the wanted TID, the calendar minute you'll boot into, and a
   delay range (300–5000 covers normal boots). Pick a row → **Load selected into timer**.
   The row's seed/TID/SID also auto-fill the shiny search group.
2. Set the DS clock to the target minute (set it one minute ahead — phase 1 is always at
   least 14 s). Click **Start at clock confirm** the moment you confirm the clock.
3. Phase 1: boot the game to the Continue/New Game screen and wait. The single beep marks
   the phase change. Press A at the end of **phase 2** (five short beeps, then the long one).
4. Verify what you hit: DPPt — open the Poketch Coin Toss and flip ~10 times, type the
   H/T string into **Verify** → **Match**; it identifies your actual delay and fills
   **delay you hit** → click **Calibrate from hit**. HGSS — call Elm a few times and
   compare the E/K/P sequence against the calculator group's prediction, trying nearby
   delays until one matches; enter that delay and click **Calibrate from hit**. Repeat;
   the calibration converges like EonTimer.
5. **Shiny search from a seed** lists Method-1 shiny advances for the loaded seed and
   TID/SID — this covers starters, gifts, AND static legendaries (Palkia, Dialga,
   Giratina, Ho-Oh, Lugia, the lake trio...), which all generate the same way. Reach the
   advance count using Chatot cries (+1 each, both games) or the community's Journal
   method, per pokemonrng.com guides, then trigger the encounter.
   HGSS starters: all three are rolled when the selection scene opens — Chikorita occupies
   advances 1–4, Cyndaquil 5–8, Totodile 9–12.

## Troubleshooting

- **"not connected"**: script not loaded, emulator paused (a paused emulator services no
  sockets), or the port differs — match the app's port field to what the script printed.
- **Port busy after reloading a script**: the script tries the next four ports
  automatically; check its console line.
- **Auto flows need savestate slot 9** — the script warns if it can't write it.
- **Hands off while armed**: a human keypress during an armed press window shifts the RNG
  and causes a miss (the script will recover, but it costs an attempt).

## Web, mobile, and non-Windows desktop

The no-emulator toolset (all searchers, calculators, checkers, and both timers) is also
available without installing anything:

- **hackmons.com/rng-solution** (in preview until it is promoted) — the full toolset in the
  browser, including the Gen 1 TID tab and the Emerald / FRLG Secret ID search (no capture reading
  by design). **hackmons.com/shiny-solution** is the live page with the earlier tools until then.
- **Hackmons Hub app** — Fun → Shiny Solution (same tools, beeps included).
- **Linux/macOS desktop** — the calculators-and-timers app from the releases page
  (Linux AppImage/tarball; macOS dmg/zip, unsigned — right-click → Open the first time).

- **RNG Solution** (github.com/isleep2late/RNG-Solution) — the terminal front end: the same
  Gen 1 flow plus the press trainer, dual-anchor fusion and the practice-only PREDICT mode;
  `--data-dir <this checkout>` makes it read `core/data` here instead of its own registry.

Only the Windows desktop app drives mGBA for automatic manipulation; everything else is
the assisted toolset. The math is identical everywhere (parity-tested against the C#
engine every test run, and against RNG Solution's Python for the Gen 1 engine).
