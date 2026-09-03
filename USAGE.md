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
   **Mode.** Leave the switch above the tabs off: that is RUN, the default, and every sample,
   cue log and calibration result is stamped with it. Turn PRACTICE / HUNT on only to practise,
   calibrate or hunt: a banner stays on every tab, the tab reads and writes the practice store
   (a separate key; a practice-derived correction is never in force in RUN, and a practice
   sample that turns up in the RUN store is listed as ignored), and the correction, P(hit) and
   drift you see are the practice ones until you switch back. The reset adjustment you remember
   (step 6) and the Secret ID pins (below) are kept the same way: per mode, stamped, never mixed.
   **Practice & Hunt window (Electron, `bash electron/build.sh --with-hunt` builds only).** With
   PRACTICE / HUNT on in the main window (the menu item is greyed out otherwise and refuses if
   clicked), the "Practice & Hunt" menu opens a window that watches a capture instead of asking you: pick
   "Replay a PNG sequence" (the fixtures beside the app) or "Watch OBS" (obs-websocket
   screenshots of the capture input; confirm the dialog; practice only). It prints "menu open"
   when the NEW GAME box has persisted 0.6 s, then, when the box clears, the offset, the Trainer
   ID and the verdict, "this prediction assumes methodology red/gba/hold-start-v1", the hold
   verdict (`ok` / `unobserved` / a refusal when the hold was too close to the menu), and a
   warning with the quantisation if the source was sampled too slowly. Type the true Trainer ID
   of the last attempt and press "Calibrate" to store the implied lag under the practice key;
   the RUN calibration is never touched. The window has no switch of its own: turn the mode off
   in the main window and it closes.
6. **Save-corruption reset.** The metronome beats RESET then A (GSE, Game Boy Player: 199.2 ms
   on the route path, 149.6 ms over a practice save) or A then power off (handhelds, DMG:
   397.9 ms). Calibrate from outcomes (does CONTINUE give the 255-Pokémon party?), never from
   "RESET to black"; the practice-save path is 50 ms later than the route's first save.
7. **Verify (moderators).** A Trainer ID and the menu-to-press time measured from the video:
   is the ID one the table produces within N frames of that time? Say whether you measured the
   press itself (button overlay, hand cam) or its first visible effect (the DMG's 38.83-frame
   and the GBA's 8.7-frame press-to-visible lag are subtracted).

## Gen 2 Trainer ID / Lucky ID (Gold / Silver / Crystal): the one timed A tap

TARGET mode, human input only, in the web app's **Gen 2 TID** tab (the same page in the Electron app
and the mobile bundle) and the desktop app's **Gen 2 TID (G/S/C)** tab (the same steps, texts and
numbers; its cue is the Gen 1 tab's sample-exact WAV and its samples live in the app's settings under
`gen2tid.calibration`, per mode). The methodology is `<game>/<gbp|gbc|dmg>/hold-start-v1`
(Gold and Silver also `dmg/late-start-v1`): clear the save data (Up+B+Select on the title), hold
START from power-on until the NEW GAME menu box appears, release it as it appears, and tap A once for
4-8 frames at the cue; on Gold and Silver press nothing else until the roll is over (about 0.35 s).
The target is a 4-frame poll bin (0-598) counted from the menu box you can see, not a frame, and the
Trainer ID, the Lucky ID and (Crystal) the Secret ID are fixed per bin. **No hardware sample exists
for any Gen 2 configuration**: the tables are emulator-derived (GSE / gambatte-speedrun in GBP mode
is the exact case), so on a console the first attempts are a transfer test, as for Gen 1 Blue and
Yellow; the tab says so on every protocol. Gold and Silver also depend on the cartridge's RTC:
`days0` (a running clock under 140 days) and `days512` (the carry bit) recur; the other brackets
and the halted-clock family last one boot.

1. **Game, console, methodology, RTC state.** Pick Gold, Silver or Crystal and the console: GSE /
   gambatte-speedrun in GBP mode (emulator-exact), a GameCube Game Boy Player, a GBA / GBA SP / GBA
   HD, a Game Boy Color or the original Game Boy (which offers two methodologies: hold-start, START
   down before the boot logo ends, and late-start, START first pressed during the white gap or the
   copyright text). Read the **methodology** it resolves to (e.g. `gold/gbp/hold-start-v1`) and, in
   the details, every methodology of the game with its protocol text and validity conditions
   verbatim. For Gold and Silver choose the cartridge's **RTC state**: `days0` for GSE, a fresh
   battery or any cartridge booted before (or `days512` with the carry bit); a 140-511-day bracket
   or a halted-clock state only for a cartridge's FIRST boot since the battery went in or the clock
   was halted, and the tab marks every such state, row and protocol *first boot only*. Crystal is
   immune and has one table.
2. **Target.** The table lists the bins that give a route target under the target sets in force,
   in the chosen state and in the console's other states (a row in another state switches the
   state and is first boot only): in `days0` there is none, because the published Gold/Silver
   route IDs (09705, 55785, the NSC pair, the glitchless Lucky ID 01001) and Crystal's 26FB/186F
   need their community multi-step scripts, which the tab says and does not tabulate. Otherwise
   type the Trainer ID you want (and the Lucky ID for a pair) and take one of its bins, or any bin.
3. **Anchor and correction.** The anchor is the moment you press ANCHOR (or Space): the NEW GAME /
   OPTION box appearing (recommended, the only anchor on a Game Boy Player), the power switch
   (handhelds, a Game Boy Color, a DMG; INFERRED on a GBA, where the power-on-to-boot delay is not
   measured), or GSE's Ctrl+R reset (the 2.175 s fade and stall are added). The correction starts at
   200 ms (menu) or 100 ms (power-on, reset) and becomes the mean of your calibrated attempts. Read
   the **PROTOCOL**: clear the save, hold START inside the window, release it as the box appears,
   then four short beeps and one long high beep: tap A ON the long beep, once, 67-134 ms, and press
   nothing for 0.35 s.
4. **Cue.** Press ANCHOR at the anchor moment: the schedule plays from the Gen 1 tab's player (one
   pre-rendered buffer, every beep on an exact sample, the screen flashing with each). The cue log
   names the attempt's mode.
5. **What did you get?** Type the Trainer ID (and, once you have seen it on the Radio Tower lottery
   screen, the Lucky ID). It inverts to the bin you hit in the outcome scope (the chosen first-boot
   state, else the two-state prior); the implied correction (used + bins late x 4 x 16.7427 ms) is
   averaged in; a hit more than 15 bins (60 frames) from the aim or the same attempt entered twice
   is refused unless you tick force; IDs absent from the scope teach nothing, and if they are
   produced in another RTC state of the console the tab says which (a first-boot state, the clock
   rather than your timing). Samples are kept per console and anchor under
   `shinySolution.gen2tid.calibration` (the desktop app: `gen2tid.calibration` in its settings) with
   their methodology id, RTC state and mode, per mode as in the Gen 1 tab (PRACTICE / HUNT has its
   own store; a sample of the other mode is listed as ignored, never averaged).
6. **Invert.** Any Trainer ID (and Lucky ID) against the console's tables in a chosen scope (the
   two-state prior, every state, the running or the halted family, the chosen state): each
   candidate table and bin, whether it recurs after the first boot, and the scope's ambiguity
   statistics (Gold under the prior: 14 of 1184 Trainer IDs ambiguous, no pair collision; over the
   18 GBP states 769, max 5 candidates, 2 pair collisions).
7. **Verify (moderators).** The Trainer ID (and Lucky ID) and the seconds from the visible menu box
   to the A press measured from the video: the bin that time predicts against the bins that produce
   the IDs, consistent within one bin. No press-to-visible lag is known for Gen 2 (no hardware
   sample): measure the press itself.

The same engine from node (`core/gen2tid.js`; the same functions in `app/Core/Gen2Tid.cs`) over
`core/data/gen2-tid.json` in a checkout, which is what the tab calls:

1. **What a bin gives, and what a typed ID inverts to.** `lookup` reads one table; `invert` takes
   the Trainer ID you typed (and the Lucky ID if you have it) back to the bin, under the two-state
   prior unless you scope it (`family`, `states`):

   ```
   node -e 'const g=require("./core/gen2tid.js"),d=require("./core/data/gen2-tid.json");const r=g.lookup(d,"gold","gbp","days0",300);console.log("bin 300:",g.hex(r.tid,4),g.hex(r.lid,4),"offsets",r.offsets,"visible",r.visible,"aim",r.aim);const inv=g.invert(d,"gold",r.tid,{platformKey:"gbp"});console.log("invert",g.hex(r.tid,4),"->",inv.ambiguous?"ambiguous":"resolved",inv.candidates.map(c=>c.table+" bin "+c.bin+" LID "+g.hex(c.lid,4)+(c.reachableAfterFirstBoot?"":" (first boot only)")).join("; "))'
   ```
   ```
   bin 300: 4F62 EE7C offsets [ 1205, 1208 ] visible [ 1201, 1204 ] aim 1206.5
   invert 4F62 -> resolved gold/gbp/days0 bin 300 LID EE7C
   ```
   `offsets` are frames after the game's menu detector at which A may go down, `visible` the same
   frames counted from the menu box you can see (4 frames later). A candidate in a bracket or
   halted state is marked `(first boot only)`; no candidate means the IDs are absent from every
   table in scope (wrong platform, a dead-battery clock, or a violated protocol), never an error.

2. **Target sets and verdicts.** The route IDs are `community-script` sets: `verdictText` says
   so, and `targetsAllStates` searches every RTC state of a platform for a single-tap bin that
   produces a member:

   ```
   node -e 'const g=require("./core/gen2tid.js"),d=require("./core/data/gen2-tid.json");const sets=g.targetSetsFor(d,"gold");sets.forEach(s=>console.log(g.setDescribe(s)));console.log(g.verdictText(0xE83B,null,null,sets));console.log(g.verdictText(0x25E9,null,null,sets));const hits=g.targetsAllStates(d,"gold","gbp",sets);console.log("single-press hits on gold/gbp over every RTC state:",hits.length?hits.map(h=>h.state+" bin "+h.bin+" "+g.hex(h.tid,4)+"/"+g.hex(h.lid,4)+" "+h.sets.join(",")+(h.reachableAfterFirstBoot?"":" (first boot only)")).join("; "):"none")'
   ```
   ```
   psr-gs-any-09705: TID $25E9 (9705)
   psr-gs-old-55785: TID $D9E9 (55785)
   psr-gold-nsc-d900: TID $D900 + LID $D3EC
   glitchless-lid-01001: Lucky ID $03E9 (01001)
   not a route target (accepted by none of: psr-gs-any-09705, psr-gs-old-55785, psr-gold-nsc-d900, glitchless-lid-01001)
   route target (target set psr-gs-any-09705); the published protocol for it is a community multi-step script, not this single-tap methodology
   single-press hits on gold/gbp over every RTC state: halt-days200 bin 392 6F53/03E9 glitchless-lid-01001 (first boot only)
   ```
   None of the published IDs is a single-tap target in the day-0 table: they need their
   community scripts (which of those reproduce in the harness is in the README's support table
   and in each set's `provenance`). The one hit above gives the Lucky ID on a halted-clock first
   boot, with a different Trainer ID from the published pair.

3. **The cue schedule.** `scheduleGen2` renders the cues for a bin under a methodology; the
   `menu` anchor is the moment the NEW GAME box becomes visible (press ANCHOR then), `poweron`
   the power switch, `reset` GSE's reset (which needs `resetExtraS`, the fade + stall):

   ```
   node -e 'const g=require("./core/gen2tid.js"),d=require("./core/data/gen2-tid.json");const s=g.scheduleGen2(d,"gold/gbp/hold-start-v1",300,200,{anchor:"menu"});console.log("A at",s.tA.toFixed(3),"s after the visible menu (aim",s.aimV,"frames, minus the 200 ms correction); A window",s.aWindow.map(x=>x.toFixed(3)).join("-"),"s; tap",s.tapMs.map(x=>x.toFixed(0)).join("-"),"ms; then nothing for",s.rollSettleS,"s");s.cues.forEach(c=>console.log(" ",c.t.toFixed(3),"s",c.label,c.freq+" Hz",c.ms+" ms"))'
   ```
   ```
   A at 19.933 s after the visible menu (aim 1202.5 frames, minus the 200 ms correction); A window 20.108-20.175 s; tap 67-134 ms; then nothing for 0.35 s
     15.933 s count-4 880 Hz 60 ms
     16.933 s count-3 880 Hz 60 ms
     17.933 s count-2 880 Hz 60 ms
     18.933 s count-1 880 Hz 60 ms
     19.933 s A 1320 Hz 150 ms
   ```
   Four count-in beeps a second apart, then the long high beep: tap A on it. The 200 ms is the
   default menu-anchor correction (100 ms for the other anchors); after an attempt,
   `sampleFromHit(data, game, platform, state, tid, lid, aimedBin, correctionUsed)` inverts what
   you typed, takes the candidate nearest the aim and builds a sample the Gen 1 helpers average
   (`meanCorrection`, `isDuplicate`), with the outlier guard in bins (`isOutlierBins`). Bins
   close to the menu drop count-in beeps that would fall before the anchor (`droppedCountIn`).
   `verify(data, game, platform, tid, lid, measuredS)` is the moderator's check: the seconds from
   the visible menu box to the press against the bins that produce the typed IDs.

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

## Gen 4 seed-to-time from node

The seed-to-time layer (`core/seedtime4.js`; the same functions in `app/Core/SeedTime4.cs`) has
no tab yet either. It answers the reverse question of the Gen 4 tab above: which DS clock setting
and delay reach a seed that produces the mon you want, and how to tell which delay you hit. No DS
session has landed one of its times yet; the delay a console reaches is the open hardware gate.

```
node -e 'const s=require("./core/seedtime4.js");const rows=s.wantedToTimes({ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31},method:"M1",maxFrame:100,delayMin:0,delayMax:65535,targetDelay:600,limit:3});rows.forEach(r=>console.log(s.hex8(r.seed),"frame",r.frame,r.year+"-"+r.month+"-"+r.day,r.hour+":"+r.minute+":"+r.second,"delay",r.delay,"PID",s.hex8(r.pid),r.natureName));const t=s.seedToTimes(0x7B0448D1,2000,{limit:2});console.log("7B0448D1 in 2000:",t.map(x=>x.month+"/"+x.day+" "+x.hour+":"+x.minute+":"+x.second+" delay "+x.delay).join("; "));const p=s.planAdvances(0,7,{partyCount:1,tools:["journal","chatot"]});console.log("advance 0 -> 7:",p.plan.map(x=>x.uses+" x "+x.tool+" ("+x.label+")").join(", "),"remainder",p.remainder);const c=s.calibrateRows(0x7B0448D1,1,0,"DPPt");console.log("calibrate rows:",c.map(r=>s.hex8(r.seed)+" delay "+r.delay+" "+r.sequence.slice(0,23)+"...").join(" | "))'
```
```
7B100958 frame 23 2099-1-5 16:59:59 delay 2293 PID 685011A9 Modest
FB100958 frame 23 2099-5-27 16:57:59 delay 2293 PID E85091A9 Docile
700217A2 frame 66 2099-1-1 2:52:59 delay 5951 PID E9375A48 Calm
7B0448D1 in 2000: 1/5 4:59:59 delay 18641; 1/6 4:58:59 delay 18641
advance 0 -> 7: 3 x journal (EMPIRICAL), 1 x chatot (STRUCTURAL) remainder 0
calibrate rows: 7B0448D0 delay 18640 H, H, T, T, T, T, T, H,... | 7B0448D1 delay 18641 H, T, T, H, H, H, T, H,... | 7B0448D2 delay 18642 T, T, T, T, T, T, T, H,...
```

- `wantedToTimes` takes IVs (Method 1, or `method: "M4"` for the VBlank-skip statics), a PID, or
  `tid`, `sid`, `shiny: true` and a nature; reverses them to seeds (PKHeX's algorithm), keeps the
  seeds a clock can produce within `maxFrame` (the hour byte must be 0-23) and lists the date,
  time and delay of each, nearest `targetDelay` first. A flawless Method 1 mon within 100 frames
  is not reachable near delay 600: the nearest is delay 2293 at frame 23. The year is a delay
  knob (+1 year = -1 delay for the same seed), which is why the rows sit in 2099.
- `seedToTimes(seed, year)` lists every time of a year that produces one seed, so a row's
  neighbours are one call away.
- `planAdvances(current, target, {partyCount, tools})` spends the frames with the tools you name:
  a Journal page flip is +2 (EMPIRICAL: a community convention with no LCRNG call in Platinum's
  journal code), a Chatot cry +1, a 128-step friendship cycle +1 per party member, an Elm call +1
  (STRUCTURAL, each cited in `advanceCosts()`).
- `calibrateRows(seed, delayRange, secondRange, game)` is the verification table: the Poketch
  coin-flip strings of the neighbouring delays (DPPt; the Chatot pitch bands and the HGSS Elm calls
  and roamer routes are the other readouts) tell you which delay you actually hit, as the tab's
  **Verify** does for the timer.

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
  browser, including the Gen 1 TID tab, the Emerald / FRLG Secret ID search and the Gen 2 TID tab (no capture reading
  by design: `webapp/hunt/` is never bundled into it, and the RUN / PRACTICE-HUNT switch above the
  tabs only changes which calibration store is in force). **hackmons.com/shiny-solution** is the
  live page with the earlier tools until then.
- **Hackmons Hub app** — Fun → Shiny Solution (same tools, beeps included).
- **Linux/macOS desktop** — the calculators-and-timers app from the releases page
  (Linux AppImage/tarball; macOS dmg/zip, unsigned — right-click → Open the first time).

- **RNG Solution** (github.com/isleep2late/RNG-Solution) — the terminal front end: the same
  Gen 1 flow plus the press trainer, dual-anchor fusion and the practice-only PREDICT mode;
  `--data-dir <this checkout>` makes it read `core/data` here instead of its own registry.

Only the Windows desktop app drives mGBA for automatic manipulation; everything else is
the assisted toolset. The math is identical everywhere (parity-tested against the C#
engine every test run, and against RNG Solution's Python for the Gen 1 engine).
