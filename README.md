# Shiny-Solution

RNG manipulation for classic Pokémon, done for you: the exact frame that makes your target
shiny, the exact Trainer ID you want, the one timed press that decides a Gen 1 Trainer ID, the one timed
tap that decides a Gen 2 Trainer ID and Lucky ID, and the DS clock time that reaches a chosen Gen 4 seed.
One engine and one data set behind several heads: a Windows desktop app with mGBA scripts, a
static web app (the tool page at [hackmons.com/rng-solution](https://hackmons.com/rng-solution), in
preview until it is promoted; the live [hackmons.com/shiny-solution](https://hackmons.com/shiny-solution)
page carries the earlier tools),
the Hackmons Hub mobile screen, Linux/macOS desktop builds, and a terminal front end
([RNG Solution](https://github.com/isleep2late/RNG-Solution)). Fully automatic on emulator
where the games allow it, and a self-calibrating assistant everywhere else.

Every mechanic is verified line-by-line against the pret decompilations
([docs/FACTS.md](docs/FACTS.md)); every port is checked against an independent oracle
(`tests/`: integers, strings and error classes exact, floats to 1e-9 relative). Step-by-step instructions are in [USAGE.md](USAGE.md) and in the desktop
app's Help tab.

## What each generation gets

| Generation | Emulator | Real hardware | Validation status |
|---|---|---|---|
| **Gen 1 Trainer ID: Red** | GSE / gambatte-speedrun in GBP mode with the GBC BIOS: emulator-exact (the table was derived on that core) | The one timed A press on NEW GAME under a named hold-START methodology, cued from the menu, the power switch or RESET; typed-TID calibration with P(hit) and drift; route-valid targets (any `$40xx` Trainer ID — high byte only, 1 in 256 — and the PSR sets); the save-corruption RESET/A metronome; moderator verify | `red/gba/hold-start-v1`: GBA HD hardware-validated 5 of 5; GBA / GBA SP same silicon, not separately sampled; GameCube Game Boy Player UNVALIDATED. `red/dmg/hold-start-v1`: original Game Boy hardware-validated 5 of 6. Those counts are of the **hold-START timing**, not of the target rule: the `$40xx` rule itself (any `$4000-$40FF`, high byte only) is **emulator-measured only** — PyBoy for the save-corruption route runs, gambatte-core for the tables — and is **unconfirmed on a cartridge** |
| **Gen 1 Trainer ID: Blue** | same | same, except that Blue's `$40xx` relaxation is **inferred from Red**, not measured on Blue | `blue/gba/hold-start-v1`, `blue/dmg/hold-start-v1`: emulator-derived (the sweep re-derived every offset from three further cold boots, byte-identical; what ships as evidence is a **sample** of that sweep - RNG Solution's `tests/fixtures/blue-gba-triple.csv` and `blue-dmg-triple.csv`, 55 and 57 rows: every route-valid offset plus every 50th); **no hardware sample yet**. The `$40xx` rule here is **inferred from Red** — byte-identical bank `$1D`, same swap source — and was **never swept on Blue**; like Red's it is emulator-only and unconfirmed on a cartridge |
| **Gen 1 Trainer ID: Yellow** | same | same; no route-valid target (the PSR route's 6415 / 64EA are not produced by the shipped methodology) | `yellow/gba/hold-start-v1`, `yellow/dmg/hold-start-v1`: emulator-derived; **no hardware sample yet** |
| **Gen 2 Trainer ID / Lucky ID: Gold, Silver, Crystal** (`core/gen2tid.js` + `Gen2Tid.cs`; the web app's **Gen 2 TID** tab and the desktop app's **Gen 2 TID (G/S/C)** tab, [USAGE.md](USAGE.md)) | GSE / gambatte-speedrun in GBP mode: emulator-exact (the 162 tables were derived on that core, RTC day 0 = GSE's fresh clock) | Clear the save data, hold START from power-on (or, on a DMG, first press it during the white gap or the copyright text: the late-start tables), release it as the NEW GAME menu box appears, one 4-8-frame A tap: the target is a 4-frame poll bin, not a frame (599 bins per table); TID + Lucky ID (+ Crystal's Secret ID) per bin; Gold/Silver tables per platform (GBP, GBC, DMG hold-start, DMG late-start) and per MBC3 RTC state (ten running-clock day brackets and ten halted-clock states, eight of them distinct); typed-TID / typed-(TID, LID) inversion with the two-state prior (`days0`, `days512`); cues from the menu, the power switch or GSE's reset; bin-based calibration and moderator verify | `gold|silver|crystal/<gbp|gbc>/hold-start-v1`, `gold|silver/dmg/hold-start-v1`, `gold|silver/dmg/late-start-v1`: **emulator-derived, community-script cross-validated on GBP, no hardware sample of any configuration** (the first console attempts are a transfer test). Only `days0` and `days512` recur boot after boot: a 140-511-day bracket lasts one boot (the game writes the counter back) and the halted family is a cartridge whose clock was halted and has not been booted since, so a prediction in either state is first-boot only. The published route IDs (Gold/Silver 09705 and 55785, Gold NSC `D900`+`D3EC`, the glitchless Lucky ID 01001, Crystal `26FB`+`186F`) are not produced by the single-tap tables in the day-0 state and need their community multi-step scripts, kept as `community-script` target sets: the Gold and Silver 09705 scripts and the Gold `6F49`/`03E9` script reproduce in the harness with their published neighbours; the 55785 route (input sequence unknown), the Gold NSC script and the Crystal pair (secondary provenance) are not reproduced. `D9E9` alone (halted-clock states) and LID `03E9` alone (halted and bracket states) turn up in a few first-boot-only bins (`target_sets[*].single_press_hits`), never with the published TID |
| **Gen 1/2** R/B/Y/G/S/C shiny DVs | Automatic hunt bot: no seedable RNG exists, so the bot retries a savestate with shifted timing until the roll is shiny (Gen 2 rule) or matches your DV pattern: encounters, gifts/starters, and TIDs | Not practical (hardware divider RNG) | |
| **Gen 3** R/S (E/FRLG experimental) | Fully automatic: the mGBA script reads the live RNG, self-calibrates with a throwaway press + savestate rewind, and presses A on the exact shiny/TID frame: starters, gifts, AND static legendaries; a brute-force hunt covers wild grass | Calibrated power-on timer for dead-battery R/S (every boot seeds 0x5A0); TID manip converges in a few attempts and reveals your SID | verified on Ruby under libmgba (`tests/harness/`) |
| **Gen 3 Secret ID: Emerald / FireRed / LeafGreen** | | The Trainer ID cannot be chosen (a sub-frame Timer1 count); the Secret ID follows from the typed Trainer ID after k+1 LCRNG advances: one candidate per k, a press cue that pins k to a 27-frame window, pins (a PID seen shiny or not) that narrow it to one | `*/gba/typed-tid-sid-v1`: frame counts emulator-measured on mGBA 0.10.5 by two harnesses; hardware unverified |
| **Gen 4** D/P/Pt/HG/SS | Assisted: seed searcher + verifiers | Two-phase timer, TID-target search by delay, coin-flip seed matching (DPPt) and Elm-call prediction (HGSS), Method-1 shiny search per seed | decomp-verified in Platinum/HGSS (DP's TID path inferred) |
| **Gen 4 seed-to-time and reversal** (`core/seedtime4.js` + `SeedTime4.cs`; the web app's **Wizard (Gen 3/4)** tab runs it for a wanted Pokemon, [USAGE.md](USAGE.md) also runs it from node) | The same functions in both languages: `seedToTimes` (a seed -> every date, time and delay of a year, PokeFinder's ordering and hour-overflow rule); `calibrateRows` (the neighbour table, seconds outer and delay inner, each row with its coin flips on DPPt or its Elm calls and roamer routes on HGSS); `ivsToSeeds` / `ivsToSeedsSkip` (Method 1 / Method 4) / `pidToSeeds` / `shinyPids` (PKHeX's LCRNG reversal); `reachableSeeds` -> `seedsToTimes` -> `wantedToTimes` (the reachable seed and frame by the hour-byte filter, then the times nearest a target delay, from IVs, a PID or TID + SID + shiny + nature); `planAdvances` (each tool's cost with its label and citation: Chatot cry +1, 128-step cycle +1 per party member, Elm call +1, coin flip 0, all STRUCTURAL; Journal page +2 EMPIRICAL, a community convention with no LCRNG call in the decomp; the Chatot pitch bands are PokeFinder's readout scale, EMPIRICAL); `tidToSeeds` (a TID -> seeds over every time of a year) | The times it lists are DS clock settings; the delay is the VBlank count the console must reach | PokeFinder's seed-to-time / ID / reversal test data bit for bit, the design's two gate seeds, the decomp roamer tables, a JS/C# cross-check on 310 inputs; **no DS session yet**: whether a chosen (date, time, delay) lands its seed on hardware is the gate |
| **Timer models** (EonTimer's Gen 3 / Gen 4 / Gen 5 models, `core/timers.js` + `Timers.cs`) | The frame, delay, second, C-Gear, Entralink and custom models, function-for-function in EonTimer's operation order; the web app's Wizard tab runs the Gen 3 frame model and the Gen 4 delay model (phases, calibration from the typed frame or delay hit) through the page's countdown | Same engine; the Gen 3 Timer and Gen 4 tabs and the desktop app still run the `gen4.js` / `Gen4Timer` model, within half a frame of EonTimer ([docs/FACTS.md](docs/FACTS.md), Timer models) | checked against 469 vectors computed by EonTimer's own TypeScript (47 of them its Python unit tests) and a 200-parameter-set JS/C# parity check |
| **Wanted-IVs wizard: Gen 3 / Gen 4** (the web app's **Wizard (Gen 3/4)** tab, `webapp/wizard-ui.js` over `core/generators.js`, `core/seedtime4.js`, `core/timers.js` and `core/data/{species,encounters,statics}-gen{3,4}.json`, [USAGE.md](USAGE.md)) | Game -> console -> a static / gift from the catalogue or a wild slot from the encounter tables (time of day on Gen 4; Emerald and Gen 4 lead effects) -> per-stat IV ranges, nature, ability slot, gender where the species allows, shiny with the typed IDs -> the matching frames from the game's seed model: Ruby / Sapphire dead-battery `0x5A0`, Emerald `0`, FireRed / LeafGreen a typed seed (else stated unavailable), a Gen 4 seed a DS clock can reach (the IV back-step, the hour-byte filter, every candidate re-generated by the wild or static generator) -> the result card (PID, IVs, nature, gender, ability, Hidden Power, stats, shiny yes / no, frame, seed, the seed model with its validation status) -> a numbered procedure, every step labelled with the seed model id (the clock setting and minutes-before rule, EonTimer's phases, the coin-flip / Elm-call verification, the advance plan) -> the page's countdown -> the typed outcome (nature and IVs or stats on Gen 3; coin flips or Elm calls on Gen 4) inverted to the frame or delay hit and the calibration moved, per game, console, seed model and mode | Frames are stated as times at the console's rate; a request with no frame inside the horizon (an hour by default) is answered with the honest limit: the expected count per 100,000 frames (exact over the LCRNG cycle when affordable) and, for statics, the exact first frame of the whole cycle (a flawless Emerald mon: frame 176,562,488, 34.2 days) | Every output is **EMPIRICAL / model output**: no hardware session has run any wizard procedure; the seed models are `rs/gba/boot-seed-v0`, `emerald/gba/boot-seed-0-v0`, `frlg/gba/typed-seed-v0`, `dppt/nds/seed-to-time-v0`, `hgss/nds/seed-to-time-v0`, each printed with its status. Checked against the generator vectors (Groudon Method 4 frame 3, Route 111 frame 7, Route 222 Magnet Pull seed `5D1745D0` frame 0) and the design's gate seed `7B0448D1` -> frame 0 |
| **Gen 5** B/W/B2/W2 (`core/gen5.js` + `Gen5.cs`) | Engine only in this release (no tab yet): the SHA-1 boot seed, the 64-bit LCRNG, the boot advances, TID/SID rows and the profile searcher (Timer0/VCount/VFrame/GxStat from typed IVs or save needles), ported from PokeFinder and vector-tested in JS and C# | Same engine; the console workflow (profile first, then date/time/keys for a wanted TID) arrives with its tab | PokeFinder's own vectors, the RNGWriteups worked seed and 200 random inputs answered by C# reproduced in JS; **not validated on a DS** (a DS Lite session is the gate) |

## TARGET and PREDICT modes, and the methodology contract

The Gen 1 Trainer ID heads follow the rules position of 2026-09-02 (PSR Discord, speedrun.com
moderators): timers and metronomes are allowed; RNG identifying tools must operate on human
input; reading the screen, VRAM or memory to identify RNG is not allowed in runs.

* **TARGET mode** (every head): you say which Trainer ID (or which table offset) you want, the
  tool says exactly what to do, cues the one timed press, and learns from the ID you type
  afterwards. Run-legal: the anchor is your button press, the outcome is the Trainer ID you
  read off the screen and type. Nothing reads the game. The website and the apps have no
  capture reading by design.
* **PREDICT mode** (RNG Solution's `watch --practice` only): the tool reads an OBS capture and
  predicts the Trainer ID. Practice and hunting only, never in a submitted run; it refuses to
  start without `--practice`. The heads here carry the same wall as a mode setting (next section).

## Modes: RUN (the default) and PRACTICE / HUNT

Every head has one persisted mode setting, and it is RUN unless you turn PRACTICE / HUNT on
yourself (the switch above the tabs in the web app, the Electron app and the mobile bundle, which
are one page; the checkbox above the tabs in the desktop app; `--practice` on RNG Solution's
`watch`). The wall between them is RNG Solution's, carried over unchanged
(`docs/RNG_GUIDE_DESIGN.md` section 4.2 there; `rngsolution/watch.py` is the only capture-reading
code that exists today):

| | RUN | PRACTICE / HUNT |
|---|---|---|
| Purpose | Leaderboard runs; casual manips done the legal way | Learning, calibrating, shiny hunting, verifying |
| Inputs | Your anchor press, beeps, the outcome you type | Everything in RUN plus, one day, the capture (video, audio), emulator memory, savestate retry |
| Turned on by | Nothing: it is the default | The switch, explicitly; while it is on, a banner sits above every tab: *PRACTICE / HUNT mode - tools that read the capture are enabled; not for submitted runs* |
| Calibration store | `shinySolution.gen1tid.calibration`, `shinySolution.gen1tid.resetAdjust`, `shinySolution.gen1tid.sidPins`, `shinySolution.gen2tid.calibration`, `shinySolution.cal.<kind>`, `shinySolution.g4.cald` (web); `gen1tid.calibration`, `gen1tid.resetAdjust`, `gen1tid.sidPins`, `gen2tid.calibration`, `cal.<key>`, `gen4.calibratedDelay`, `gen4.calibratedSecond` (desktop) | The same names with `.practice` appended: a separate namespace, never merged |
| Records and logs | Every Gen 1 TID and Gen 2 TID sample, remembered reset adjustment and Secret ID pin carries `mode: "run"`, every cue log's anchor line says `[RUN mode]`, every Gen 3 / Gen 4 calibration result is tagged | The same, stamped `practice` / `[PRACTICE / HUNT mode]` |
| Where capture-watching code may live | Nowhere | `webapp/hunt/` (the Electron "Practice & Hunt" window in a `--with-hunt` build; a `HuntPanel` in the desktop app when it exists) and RNG Solution's `rngsolution/hunt/` behind `watch --practice` / `hunt --practice` |

Inside a store, a sample under another methodology or made in the other mode is left out of
the correction and named in a note, the way RNG Solution names samples under another
methodology: *N stored samples for gse/menu ignored: recorded in PRACTICE / HUNT mode, not RUN.
Samples are never mixed across modes.* A sample without a mode was recorded before modes
existed, by a head that had no capture-reading tool at all, so it is a RUN sample. A record whose
mode is a value the head does not know (a typo, an empty string, a value a later hunt head writes)
is in force in neither mode and is named as unknown in the note; it never breaks the tab. The
remembered reset adjustment and the Secret ID pins follow the same rule: their own store per
mode, every record stamped, a record of the other mode in a store never applied and named.

The package boundary: `webapp/hunt/README.md` says what may live there. `webapp/index.html`
loads nothing from it, `webapp/build-mobile-bundle.mjs` and `electron/build.sh` refuse a page
that references it and a bundle or stage that turns out to contain the text of any file under it
(both compare every hunt file's whole text with what they built; the sentinel is a marker for
the tests, not what the check rests on), and both bundle it only with an explicit `--with-hunt`
(a practice build, never the published one; the `build-desktop` workflow stages without the
flag). `tests/run-tests.sh` greps the built bundle for the sentinel in `webapp/hunt/sentinel.js`
(absent in the plain bundle, present with `--with-hunt`, and the absence check is shown failing
on the `--with-hunt` bundle), exercises both refusals on a copy of the tree (a page that
references `hunt/`, the sentinel pasted into `app.js`, and a hunt file with no sentinel line
pasted into `gen1tid-ui.js`), and drives the page's switch headless: RUN by default, the banner
outside every tab section, a sample, a reset adjustment and a pin made in PRACTICE / HUNT stored
under the practice keys with the RUN stores untouched, the practice values gone once the switch
is off, and records planted in the RUN stores (a practice sample, a sample of an unknown mode, a
practice adjustment, a practice pin) never in force and named in the notes.
`tests/test-mode-wall.cjs` and the C# `--mode-wall` check share `tests/mode-wall-fixture.json`
(two RUN samples, one practice sample) and a corrupted copy with the practice sample restamped
`run` is shown failing in both suites.

**The Practice & Hunt window (Electron, `--with-hunt` builds only).** `webapp/hunt/hunt-panel.js`
is RNG Solution's Gen 1 menu-box watcher in JS (its `rngsolution/hunt/`, design section 7): a
frame source (a PNG-sequence replay from `tests/fixtures/hunt/`, or live obs-websocket
screenshots through the `ws` package, which `build.sh --with-hunt` installs and no
package.json lists, opened only after a confirmation dialog and never by a test), the extractor
for the GBA HD profile (the NEW GAME box's dark
fraction and the screen below it, geometry measured on the owner's capture), the sample-rate
guard (below 2 samples per game frame the source is refused and every prediction names its
quantisation), the open -> close state machine with the overlay's START-hold check, and the
table lookup with the lag calibrated from typed true Trainer IDs. The menu and the window live in
`webapp/hunt/electron-main.js`, which `electron/main.js` requires only when the directory was
staged; the menu item is enabled only while the main window's mode is PRACTICE / HUNT (read from
its page every second and at the click, which refuses with a dialog otherwise), the window has no
switch of its own, and it is closed, from the page and from the main process, as soon as the main
window goes back to RUN. `tests/test-hunt.cjs` drives that side with Electron stood in for, and a
copy with the mode check cut out is shown failing it. It runs only while PRACTICE /
HUNT is on, keeps its samples under `shinySolution.hunt.calibration.practice` (never a RUN key),
stamps every record `practice`, and prints "this prediction assumes methodology
red/gba/hold-start-v1" with every offset. `tests/test-hunt.cjs` replays the shared fixtures and
must reproduce RNG Solution's committed parity vector (`tests/fixtures/hunt/gen1-parity.json`:
every frame's features on the PNG poll; the attempts, hold events, guard verdict and predictions
on the real GBA HD timeline, including the hardware-measured offset-13 sample); a corrupted
vector is shown failing. The plain bundle, the static page and the plain desktop stage carry
none of it (the sentinel checks above now also look for the panel's own text). What it cannot
do is exactly what RNG Solution's cannot: it never sees the START press itself, it reports a
hold the overlay did not show as `unobserved`, and a menu that follows a hold too closely is a
refusal, not a prediction.

A prediction is only valid under one specific, named input protocol: its **methodology**
(`<game>/<console family>/<protocol>-v<version>`, e.g. `red/gba/hold-start-v1`: hold START
inside frames 1300-1475, the NEW GAME menu opens on frame 1553 regardless, one timed A press
whose frame = menu + 80 + offset). Every table, cue, protocol, inversion, verify result and
calibration sample carries the id and the sentence "predictions are valid only under this
methodology"; the protocol's printed steps ARE the methodology; samples are never mixed across
methodologies. The records live in `core/data/gen1-tid.json` (families, platforms, reset
models, target sets, games, the six methodologies with their tables) and
`core/data/gen3-sid.json` (the Secret ID models), generated by `tools/gen-gen1-data.py` from
RNG Solution's registry and tables and embedded in every head.

## The heads

| Path | What |
|---|---|
| `webapp/` | The complete no-emulator toolset as a static web app: the Gen 3 timer and checker, Gen 4, Gen 1/2 DVs, and the **Gen 1 TID** tab (game -> console -> methodology and validity -> target -> anchor and correction -> protocol -> cue with count-in beeps, hold-window beeps, the A cue and a full-screen flash, all from one pre-rendered buffer on the audio clock -> "What did you get?" with P(hit) and drift kept in the browser; the RESET/A metronome; moderator verify; the Emerald / FRLG Secret ID branch) and the **Gen 2 TID** tab (`gen2tid-ui.js` over `core/gen2tid.js`: game -> console -> methodology, every one of the game's listed with its protocol and validity conditions verbatim -> the cartridge's RTC state with the reachability rule (bracket and halted-clock states first boot only, only `days0` and `days512` after the first boot, Crystal one table) -> a target bin from the single-tap route hits across every state, a typed Trainer ID / Lucky ID or any bin -> the same anchors, cue player, flash and cue log as the Gen 1 tab -> "What did you get?" inverted in bins with the 15-bin outlier and duplicate guards under `shinySolution.gen2tid.calibration` per mode; an invert panel with the ambiguity statistics; moderator verify from the visible menu box; every output naming the methodology, the tab stating that no hardware sample exists and that the published route IDs need their community scripts), and the **Wizard (Gen 3/4)** tab (`wizard-ui.js`: game -> console -> seed model with its validation status -> a static / gift or a wild slot -> the wanted IVs, nature, ability, gender and shiny -> the matching frames or the reachable seeds with their dates, times and delays -> the result card -> the numbered procedure -> the page's countdown over `core/timers.js` -> the typed outcome that moves the calibration, stored under `shinySolution.wizard.calibration` per mode). `sync-core.sh` copies the engines and the data in (`gen1-data.js` carries the Gen 1 / Gen 2 TID and Gen 3 SID JSON as globals, so no fetch is needed; the wizard's species, encounter and static tables go to `data/wizard-gen3.js` and `data/wizard-gen4.js`, which the tab loads on first use with a script element, so `file://` works in the Electron app); `build-mobile-bundle.mjs` inlines everything but those tables into one HTML string for the Hackmons Hub mobile screen, and the wizard tab there says it needs the static page or the Electron app. The page is installable and works offline: `manifest.webmanifest` and `icons/` make it a home-screen app, and `sw.js` (registered over http or https only, never under `file://` and stripped from the mobile bundle) precaches the app shell on the first visit and caches each wizard table file the first time its tab is opened, so a later visit with no network gets the page and the tables opened so far; `sync-core.sh` stamps `sw.js` and `index.html` with the first 12 hex digits of the SHA-256 of every shipped source, so any change to a shipped file installs a new worker that drops the old caches (the footer's status line names the stamp and whether the worker controls the page). On a phone (600 px and narrower) the tab bar is one row that scrolls sideways inside its own box (scroll-snap on each button, the active one scrolled into view; the page never widens), the rows stack, the tables scroll inside their cards and each step's main button is 48 px tall and sticks to the bottom of the screen while its card is in view. It is the page at [hackmons.com/rng-solution](https://hackmons.com/rng-solution) (in preview until it is promoted; [hackmons.com/shiny-solution](https://hackmons.com/shiny-solution) is the live page with the earlier tools). |
| `app/` | **ShinySolution.exe**, the WinForms desktop app (.NET 10, self-contained single file): every searcher and timer, the **Gen 1 TID (R/B/Y)** tab (the same steps; one WAV rendered per schedule so every beep is sample-exact; calibration, pins and reset adjusts in the app's settings), the **Gen 2 TID (G/S/C)** tab (`Gen2TidPanel.cs` over `Gen2TidSupport.cs`: the web tab's steps, texts and numbers line for line, pinned to it by `tests/gen2tid-panel-vectors.json`; the same cue player as the Gen 1 tab; the bin calibration under `gen2tid.calibration` per mode), the **Wizard (Gen 3/4)** tab (`WizardPanel.cs` over `WizardSupport.cs`: the web wizard's flow, texts, searches, cards and procedures line for line, pinned to it by `tests/wizard-panel-vectors.json`; the species, encounter and static tables embedded in the Core assembly with a copy beside the executable preferred; a two-phase countdown with the Gen 4 panel's beeps; the calibration under `wizard.calibration` per game, console, seed model and mode), plus the live TCP link that drives the mGBA scripts. |
| `electron/` | Linux AppImage/tar.gz and macOS dmg/zip of the web toolset (`build.sh`, the `build-desktop` workflow). |
| [RNG Solution](https://github.com/isleep2late/RNG-Solution) | The terminal front end: the same TARGET flow, the press trainer, dual-anchor fusion, `stats`, `verify`, `reset`, `sid`, and the practice-only PREDICT mode. It reads this repository's `core/data` in place of its own registry and CSVs with `--data-dir <Shiny Solution checkout>` (or `SHINY_SOLUTION_DATA`), so every head runs over one file. |
| `lua/shiny-solution.lua`, `lua/shiny-solution-gb.lua` | The Gen 3 mGBA auto-manip script and the Gen 1/2 hunt bot (also usable standalone). |
| `core/gen1tid.js` + `app/Core/Gen1Tid.cs` | The Gen 1 Trainer ID engine (cue schedules for the menu / power-on / reset anchors, target sets and verdicts, inversion, calibration with the 60-frame outlier and duplicate guards, the reset metronome, verify, the runner's press-jitter model: P(hit), drift, fusion) and the Gen 3 typed-TID -> SID model, ported from RNG Solution's Python and checked against the vectors it emits (`tests/gen1tid-vectors.json`, about 1,840 cases: integers, strings and error classes exact, floats to 1e-9 relative). Target sets are never defaulted (a verdict needs the game's sets), and every number is checked at the JS boundary. |
| `core/gen2tid.js` + `app/Core/Gen2Tid.cs` | The Gen 2 Trainer ID / Lucky ID engine over `core/data/gen2-tid.json` (generated by `tools/gen-gen2-data.py` from the derivation folder's 162 CSVs, README.md and REVIEW.md, sha1s kept): the 4-frame bin function, bin -> offsets, lookups across every platform and RTC state, the typed-TID / typed-(TID, LID) inversion with the two-state prior and the README's ambiguity statistics, the target sets with their measured single-press hits, cue schedules (menu / power-on / GSE reset), bin-based calibration whose samples the Gen 1 mean and duplicate helpers take as they are (the outlier guard is the bin one), and verify; checked in JS and C# against `tests/gen2tid-vectors.json`, emitted by `tests/gen2_reference.py` from the CSVs read directly (3,893 cases). |
| `core/generators.js` + `app/Core/Generators.cs` | The Gen 3/4 encounter engines: Method 1/2/4 statics, wild Method H (RS, FRLG, Emerald leads), J and K (DPPt/HGSS leads, Safari, Bug Contest, headbutt, honey trees, Poke Radar), Gen 3 and Gen 4 eggs, per-stat/Hidden Power filters, exact rarity counts, LCRNG distance and the Gen 4 IV-to-seed back-step (its reversal is the seed-to-time layer's, `core/seedtime4.js`, which the page loads first). Every call cited in `docs/FACTS.md` ("Generators"), checked bit-for-bit against PokeFinder's own test vectors. |
| `core/data/{species,encounters,statics}-gen{3,4}.json` | The Gen 3/4 species tables, wild encounter tables and static/gift catalogue generated from the pret decompilations by `tools/gen-guide-data.py` (`docs/DATA.md`): the records the generator engines take as input, read by the web app's Wizard tab (loaded lazily on first use from `webapp/data/wizard-gen{3,4}.js`, which `sync-core.sh` writes; not in the mobile bundle, `docs/DATA.md`) and by the desktop app's Wizard tab (embedded in `ShinySolution.Core.dll`, a copy beside the executable preferred). |
| `core/rng.js` + `core/gen4.js` + `core/gen12.js` + `app/Core/` | The Gen 3 LCRNG / Method 1, Gen 4 seed / MT19937 / timer and Gen 1-2 DV engines, parity-tested between JS and C#. |
| `core/gen5.js` + `app/Core/Gen5.cs` | The Gen 5 engine: the SHA-1 boot seed, LCRNG64, the boot advances, TID/SID rows and the profile searcher (Timer0/VCount/VFrame/GxStat from typed IVs or save needles), a port of PokeFinder's code (Admiral-Fish) credited in the file headers and in `docs/FACTS.md`, bit-for-bit parity-tested between JS and C#. Engine only: no tab yet. |
| `core/timers.js` + `app/Core/Timers.cs` | EonTimer's timer models (Gen 3 frame, Gen 4 delay, Gen 5 second / C-Gear / Entralink / Entralink+, custom phases) ported function-for-function, parity-tested between JS and C#; the shipped timers still run `gen4.js` (the gap is recorded in `docs/FACTS.md`). |
| `core/seedtime4.js` + `app/Core/SeedTime4.cs` | The Gen 4 seed-to-time layer: the inverse of the seed formula, calibrate rows with their verification strings, the PKHeX-semantics IV/PID -> seed reversal (Method 1 and the Method 4 skip), the reachability search with the hour filter, the advance planner and the all-times TID search; vectors in `tests/seedtime4-vectors.json` (`tools/gen-seedtime4-vectors.cjs`). |
| `docs/FACTS.md` | Every mechanic used, with decompilation citations and the hardware validation record. |
| `core/data/citations.json` | The decomp citation registry generated from `docs/FACTS.md` by `tools/gen-citations.py` (each citation read in pret: the section of FACTS.md, the line, the cited line's text; `docs/DATA.md`). The Gen 1 TID, Gen 2 TID and Wizard tabs and the desktop panels mark each protocol step, target line, schedule line and verify line `[^n]` and list the sources under the protocol over this registry (`webapp/footnotes.js`, `app/App/Citations.cs`): a decomp line under its FACTS.md section (the Gen 1 hold-START title loop, the A on NEW GAME and the DIV stir from pokered or pokeyellow; the Gen 2 4-frame poll, the hRandomSub high byte, the RTC brackets and the StartRTC halt clear from pokegold or pokecrystal), SYNTHESISED where the source is a timer model or a community convention with no decomp line, or a measured constant (the hold window and menu frame, the Crystal 14-frame roll, the tap rule) under its validation status word from the data files: EMULATOR-EXACT on GSE, HARDWARE-VALIDATED n where a console was sampled (the GBA HD 5 of 5, the DMG 5 of 6), EMPIRICAL otherwise; a citation the registry lacks is printed as NOT IN THE REGISTRY and refused by the tests. |
| `tests/` | The test suites (below). |

## Verification

- `tests/run-tests.sh`: the RUN / PRACTICE-HUNT wall (`test-mode-wall.cjs` over
  `mode-wall-fixture.json` with the restamped copy shown failing, plus a sample of an unknown
  mode kept out of both modes without breaking the tab, and the reset adjustment and pin stores
  split by mode; the mobile bundle's hunt sentinel absent, present with `--with-hunt`, and the
  absence check shown failing on that bundle; both builders' refusals on a copy of the tree,
  including a hunt file without the sentinel; the page's switch driven headless);
  the JS engine vs an algorithmically independent Python reference; the
  JS Gen 4 / Gen 1-2 ports vs vectors emitted by the C# engine; `core/gen1tid.js` vs
  `tests/gen1tid-vectors.json` (emitted by RNG Solution's Python; when that checkout is present the
  file is re-emitted from it and must be byte-identical apart from line 2, the one-line provenance
  stamp that names RNG Solution's HEAD and legitimately drifts as that repository moves - both stamps
  must still be the emitter's own line - and the check says so and is skipped when the checkout is
  absent) with a corrupted vector shown failing, and the three `$40xx` controls that keep the 1-in-712
  mistake out (the target set windowed back onto the Trainer ID's low byte against the JS head,
  against the C# head's embedded-resource pin, and against `tools/gen-gen1-data.py`'s refusal): each
  requires that run's specific refusal - the exit status and the lines the refusing path prints, not
  merely a non-zero exit - and each is then shown NOT accepting an unrelated breakage of the same run
  (a repo root whose `gen3-sid.json` is missing; a registry whose Red DMG table is missing), which the
  non-zero-exit controls accepted as proof; `core/gen2tid.js` vs `tests/gen2tid-vectors.json` (emitted by `tests/gen2_reference.py`
  from the Gen 2 derivation CSVs; when that folder is present the vectors and `gen2-tid.json` are
  re-emitted and must be byte-identical) with a corrupted vector shown failing; the webapp smoke test (`tests/test-webapp.cjs`: the mobile bundle carries the Gen 1
  TID tab, the engine and the embedded data verbatim, and the tab's pure module reproduces the
  engine's schedules, sample-exact render onsets, the calibration guards, RNG Solution's control
  numbers: sd 20 ms -> P(hit) 32 %, the 199.2 / 397.9 ms reset centres, `$4003` at 9.0 s
  inconsistent, the Emerald worked example `$B0AF` -> `$7F16` at k = 5478 kept by a shiny pin
  and dropped by a contradicting one; the Gen 2 TID tab's module resolved for every game, console, methodology
  and RTC state with every validity condition verbatim, the USAGE worked schedule at 19.933 s, GSE's reset fade,
  the bin outcome guards with `gen1tid.addSample` shown refusing a bin-centre sample, the FACTS ambiguity counts
  14 / 12 under the prior and 769 / 817 over the 18 GBP states, the halted-clock 55785 hit first boot only;
  the wizard tab's module over the six data files: every game's seed model with its status, the Groudon Method 4
  vector found at frame 3 from the typed seed 0 with its card, procedure and typed outcome, the Route 111 wild
  vector at frame 7 with the slot share, a flawless Treecko on Emerald's seed 0 with no frame in an hour and the
  exact first frame 176,562,488, the gate seed `7B0448D1` at frame 0 / hour 4 / delay 18641 with the coin-flip
  identification of the delay hit and EonTimer's calibration 500 -> 503, the Route 222 Magnet Pull vector's seed
  `5D1745D0` at frame 0 confirmed by the wild generator, the refusals (a shiny target without IDs, FRLG without a
  seed, eggs however the catalogue files them, the fixed-PID Pichu, the combination cap) and the store split by mode and seed model)
  with a bundle stripped of the Gen 1 tab, one with the Gen 2 tab module renamed and one with the wizard module
  renamed shown failing; the plain Electron stage shown to carry `wizard-ui.js` and both lazily loaded table files; and, when
  Google Chrome is installed, the three tabs driven headless through their own handlers (`?g1selftest`, `?g2selftest`,
  `?wizselftest` with its tables loaded over `file://`, stores in memory, the origin's storage shown untouched).
- `tests/test-seedtime4.cjs` and `app/Tests --seedtime4` (in both runners): `core/seedtime4.js` and `SeedTime4.cs`
  vs `tests/seedtime4-vectors.json` (PokeFinder's seed-to-time / ID / reversal data, the design's
  gate seeds, round trips, decomp roamer tables) with a corrupted vector shown failing in both, and the
  JS/C# cross-check on 310 random inputs (`tests/seedtime4-cross.cjs`, `--seedtime4-cross`) with a
  tampered answer file shown failing.
- `tests/test-timers.cjs` and `app/Tests --check-timer-vectors` (in both runners): both timer engines vs
  `tests/timer-vectors.json` (469 vectors, every expected value computed by running EonTimer's own
  TypeScript; 47 are its Python unit tests' literal assertions; builder `tools/build-timer-vectors.js`),
  a corrupted vector shown failing, plus
  200 random parameter sets answered by C# (`--emit-timer-parity`) and re-checked in JS.
- `tests/test-gen5.cjs` and `app/Tests --gen5` (in both runners): both Gen 5 engines vs `tests/gen5-vectors.json`
  (PokeFinder's own test vectors, the RNGWriteups worked seed 0xb082b4a755192171, and
  independent oracles; provenance per vector, builder `tests/build-gen5-vectors.py`), plus
  200 random inputs answered by C# (`--emit-gen5-random`) and re-checked in JS.
- `tests/test-generators.cjs` and `app/Tests --generators` (in both runners): both generator engines vs
  PokeFinder's test suite (`tests/generators-vectors.json`, 85 cases / 1833 results), the
  decomp-vs-PokeFinder pins, the rarity and reversal math, the generators-vs-seedtime4 reversal
  comparison on 204 IV sets, and a 300-case JS/C# cross-check, a corrupted vector shown failing in
  both runners and a tampered seedtime4 delegate shown failing in the JS runner;
  `tools/check-generator-citations.py` re-reads every cited decomp line.
- The citation registry (in `run-tests.sh`): `core/data/citations.json` regenerated from `docs/FACTS.md` and pret and
  required byte-identical, with a FACTS.md copy citing a line past the end of its file and one citing a range that
  starts on a blank line each shown failing the generator;
  `test-webapp.cjs` requires every source the wizard procedures cite to be a registry entry, checks the footnotes of
  the pinned procedures (the scenarios and the 20 random searches) and shows the registry without the Ruby RTC line
  reported as NOT IN THE REGISTRY; it pins the Gen 1 and Gen 2 protocols' footnote lines (the pokered title loop under
  its FACTS.md section, the table under EMULATOR-EXACT on GSE and HARDWARE-VALIDATED 5 of 5 / 5 of 6 on the GBA HD and
  the DMG, Yellow's pokeyellow lines, the pokegold 4-frame poll and RTC lines, Crystal's immunity and Secret ID lines)
  to the same text the C# checks pin, requires every Gen 2 protocol the panel vectors carry to list its sources, and
  shows the registry without the Gen 1 hold-START line and without the Gen 2 poll line reported; the browser
  self-tests (`?g1selftest`, `?g2selftest`, `?wizselftest`) do the same through the page, and a copy of the page whose
  registry lacks the Gen 1 hold-START line is shown failing the Gen 1 footnote checks; `app/run-core-tests.sh` gives
  the C# checks a registry without the Ruby RTC line, without the Gen 1 hold-START line and without the Gen 2 poll
  line and shows each failing.
- The claim-SENTENCE guard, `tests/check-claim-sentences.cjs` (in `run-tests.sh` as cross-repo guard D; rule in
  `tests/claim-phrases.json`, byte-identical to RNG Solution's copy and shown failing when a sibling's copy has
  drifted). `check-verification-claims.cjs` above is about the per-offset TAG; this is about the sentences beside it:
  every rendered unit of text that asserts a multi-boot derivation must name what ships from that derivation within
  the same block and within 600 characters of the claim, and a panel that prints a `[3x cold-boot verified…]` tag must
  print the platform's note and evidence too. It judges both heads rendered for real (the web tab's module loaded in
  node, the desktop head's `--emit-gen1-claims` emission, which now carries the methodology panel), requires the two
  to render the same sentences, and reads `core/data/gen1-tid.json`, `gen2-tid.json` and `citations.json` (which the
  website renders verbatim) and `README.md`, `USAGE.md`, `docs/FACTS.md` and `docs/DATA.md`. Six negative controls:
  the note taken out from under a verified tag in the web head, an unqualified sweep sentence planted at the top of
  each head's methodology panel (the desktop one compiled and re-emitted), a `derivation` field in `gen1-tid.json`
  with its "what SHIPS" clause removed, an unqualified sentence appended to `USAGE.md`, and a sibling rule file with a
  claim pattern deleted - each shown failing.
- `tests/test-sw.cjs` (in `run-tests.sh`): `webapp/sw.js` driven in a node sandbox with fake caches, fetch and clients:
  install precaches every file `index.html` loads, activate drops the caches of other builds, and with the network gone
  the shell, a navigation to the page and a wizard table opened once are served from the caches while a table
  never opened is not (a navigation to another path under the scope gets, offline, a page that sends the browser to
  `index.html`, since the shell's relative URLs resolve only beside it; the precache asks with cache mode reload); the build stamp in `sw.js` equals the one in `index.html` and the hash the shipped sources give
  now; a copy of `sw.js` with its data route cut out is shown failing. `run-tests.sh` also loads the mobile bundle in
  headless Chrome with an Android WebView user agent at 360x780 and reads from its DOM that no worker is registered,
  why, and that no page error was raised.
- `tests/test-data.cjs` (in `run-tests.sh`): 128 assertions over `core/data/{species,encounters,statics}-gen{3,4}.json`
  (`DATA_TEST_NEGATIVE=1` is its negative control); regeneration, the citation re-read and the PokeFinder diff
  are `tools/gen-guide-data.py` (`docs/DATA.md`).
- `app/run-core-tests.sh`: the C# engine vs the same vectors, plus canonical MT19937 vectors,
  the Gen 4 seed/timer model, the generator vectors, `Gen1Tid.cs` vs the gen1tid vectors,
  `Gen2Tid.cs` vs the gen2tid vectors and `SeedTime4.cs` vs the seedtime4 vectors, each with its
  own negative control, and the wall over the
  mode-wall fixture with the restamped copy shown failing:
  `Modes.cs` and the Gen 1 TID panel's pure part (`Gen1TidSupport.cs`, compiled into the test
  project: the ignore notes, an unknown-mode record kept out without breaking the panel, the reset
  adjustment and the pins by mode); the Gen 2 TID panel's pure part (`Gen2TidSupport.cs`, compiled
  the same way) against `tests/gen2tid-panel-vectors.json`, what the web tab computes for 20 target
  inputs (every cue time, the schedule and protocol text, the typed outcome, the 15-bin outlier edge,
  the duplicate guard, a practice-stamped sample never averaged into RUN), with a corrupted copy shown
  failing; `tests/run-tests.sh` re-emits that file from the tab and requires it byte-identical; the wizard
  panel's pure part (`WizardSupport.cs`, compiled the same way) against `tests/wizard-panel-vectors.json`,
  what the web wizard's module computes for its three self-test scenarios (Groudon Method 4 at frame 3 with
  the typed outcome and the flawless Emerald limit, Route 111 at frame 7, the gate seed `7B0448D1` at frame 0
  with the coin-flip identification and 500 -> 503, Route 222 Magnet Pull) and 20 random wanted-IV searches
  (every game, both kinds, the leads, ranges and shiny targets: the hit and row lists with PID, IVs, frame,
  seed, date, time and delay, the search lines, cards, procedures, phases and typed outcomes, the store split
  by mode and seed model, and JavaScript's number formats reproduced exactly), 995 checks with a corrupted
  copy shown failing; `tests/run-tests.sh` re-emits that file too and requires it byte-identical. `dotnet build app/App -c Release -p:EnableWindowsTargeting=true`
  compiles the desktop app on Linux.
- `tests/run-lua-sim.sh` and `tests/lua-sim-gb.py`: the mGBA scripts against stubbed APIs.
- `tests/harness/`: ground truth against real Pokémon Ruby under libmgba's Python bindings.
- RNG Solution's `tests/run-tests.sh` (196 tests plus negative controls) covers the terminal
  front end, and its `tests/test_shared_data.py` checks that this repository's `core/data`
  files are its registry and tables, and that `--data-dir` reads them.

## Building, testing and regenerating

```
export DOTNET_ROOT=$HOME/.dotnet PATH=$HOME/.dotnet:$PATH
bash tests/run-tests.sh                                             # the JS suites, the JS/C# cross-checks, the builders' refusals and the webapp smoke test; every negative control shown failing
bash app/run-core-tests.sh                                          # the C# suites, each with its negative control
dotnet publish app/App/ShinySolution.App.csproj -c Release -r win-x64 \
  -p:PublishSingleFile=true --self-contained true -o <outdir>     # the Windows app
bash webapp/sync-core.sh                                            # the static web app (serve webapp/); also stamps sw.js and index.html with the build hash of the shipped sources
python3 tools/gen-icons.py                                          # regenerate webapp/icons/*.png (byte-reproducible)
node webapp/build-mobile-bundle.mjs out.ts                          # the mobile bundle (never --with-hunt for the published one)
bash electron/build.sh                                              # Linux AppImage / tar.gz (--stage-only stops after staging; never --with-hunt)
python3 tools/gen-gen1-data.py ../RNG-Solution                      # regenerate core/data from the registry
python3 tools/gen-guide-data.py                                     # regenerate core/data/{species,encounters,statics}-gen{3,4}.json from ~/AI/pret
node tools/build-timer-vectors.js <eontimer-dist>                   # regenerate tests/timer-vectors.json (the header has the EonTimer build recipe)
python3 tools/gen-gen2-data.py ~/Desktop/Red-WR-Practice/gen2-tid    # regenerate core/data/gen2-tid.json from the Gen 2 CSVs
python3 tests/gen2_reference.py ~/Desktop/Red-WR-Practice/gen2-tid > tests/gen2tid-vectors.json   # re-emit the Gen 2 vectors
node tools/gen-seedtime4-vectors.cjs [pokefinder-checkout] [out.json]     # regenerate tests/seedtime4-vectors.json (default checkout /tmp/PokeFinder)
node tools/build-generator-vectors.cjs [pokefinder-checkout] [out.json]   # regenerate tests/generators-vectors.json from PokeFinder's Test JSON
python3 tests/build-gen5-vectors.py [pokefinder-checkout] [out.json]      # regenerate tests/gen5-vectors.json
python3 tools/check-generator-citations.py                          # re-read every decomp line the generator engines cite
python3 tools/gen-citations.py core/data/citations.json             # regenerate the citation registry from docs/FACTS.md and ~/AI/pret
```

## Roadmap, with the hardware that gates each step

- **Blue and Yellow cartridge samples**: the four tables are emulator-derived only; three
  in-table IDs near the aimed offset on a real console (GBA-silicon and DMG) are the transfer
  test, and Yellow's route protocol (6415 / 64EA) still has to be derived. Gate: Blue and
  Yellow carts on a GBA HD and a DMG.
- **GameCube Game Boy Player transfer test** of the hold-window table (one calibration attempt
  settles it) and the RESET fade constant from outcomes. Gate: a GameCube with the Game Boy Player.
- **Gen 2** (Gold/Silver/Crystal): the ten single-tap methodologies are tabulated (every platform
  and RTC state), the engine is ported and vector-checked and the web app's and the desktop app's Gen 2 TID tabs cue them,
  but no hardware sample exists; the published route targets need the community multi-step scripts (the
  Gold and Silver 09705 scripts and the Gold 6F49/03E9 script are reproduced in the harness; the
  55785, NSC D900 and Crystal 26FB/186F scripts are not), none of which is tabulated as a
  methodology. Gate: a Gen 2 cart on a GBP / GBC / DMG for three in-table (TID, LID) samples typed
  into either tab.
- **Dead-battery Ruby/Sapphire** on hardware: `rs/gba/boot-seed-v0` is defined, not implemented;
  the console timer exists and needs its hardware record. Gate: a dead-battery R/S cart.
- **Gen 4**: one DS session to record the two-phase timer's calibration on hardware, and to land
  one seed chosen by the seed-to-time layer through the Wizard tab, web or desktop (its hardware gate: the tab's
  coin-flip / Elm-call step is the measurement).
- **Gen 3 wizard on a console**: the Wizard tab's Emerald / dead-battery Ruby procedures have no
  hardware record either; one static hit typed back (nature and IVs) into either tab is the first sample. Gate: an
  Emerald or dead-battery R/S cart on a GBA.
- **Gen 5**: the engine and the timer model are merged (no tab yet); one DS Lite session validates
  the seeding on hardware. Gen 5 UI: the profile branch of the console workflow over the ported
  engine (the +2/+10 boot-advance question and a DS calibration session are open).
- Gen 6+ needs memory reads or a CSPRNG and is out of scope.
- Emerald / FRLG Secret ID frame counts on hardware (expected to transfer exactly: whole-VBlank
  counters), wild encounters, eggs and lead-ability aware searches for Gen 3/4, Gen 4 emulator
  automation, a hardware auto-mode through a Game Boy Player.

## License

GPL-3.0. The implementations are original, written against the pret decompilations; the
Gen 4 timing model follows EonTimer's MIT-licensed source (notice reproduced in
`THIRD_PARTY_NOTICES.md`), and seed-inversion edge cases were cross-checked against
PokeFinder (GPL-3.0), whose license this project shares. The Gen 5
engine (`core/gen5.js`, `app/Core/Gen5.cs`) is a port of PokeFinder's SHA-1 seeding, LCRNG64,
initial-advance, TID/SID and profile-search code by Admiral-Fish, credited in the file headers
and in `docs/FACTS.md`; its test vectors are PokeFinder's own.
