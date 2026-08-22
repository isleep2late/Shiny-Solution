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

- **hackmons.com/shiny-solution** — the full toolset in the browser, under Tools.
- **Hackmons Hub app** — Fun → Shiny Solution (same tools, beeps included).
- **Linux/macOS desktop** — the calculators-and-timers app from the releases page
  (Linux AppImage/tarball; macOS dmg/zip, unsigned — right-click → Open the first time).

Only the Windows desktop app drives mGBA for automatic manipulation; everything else is
the assisted toolset. The math is identical everywhere (parity-tested against the C#
engine every test run).
