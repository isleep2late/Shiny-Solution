# Shiny-Solution

RNG manipulation for classic Pokémon, done for you: the exact frame that makes your target
shiny, the exact Trainer ID you want, and the one timed press that decides a Gen 1 Trainer ID.
One engine and one data set behind several heads: a Windows desktop app with mGBA scripts, a
static web app (the tool page at [hackmons.com/rng-solution](https://hackmons.com/rng-solution)),
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
| **Gen 1 Trainer ID: Red** | GSE / gambatte-speedrun in GBP mode with the GBC BIOS: emulator-exact (the table was derived on that core) | The one timed A press on NEW GAME under a named hold-START methodology, cued from the menu, the power switch or RESET; typed-TID calibration with P(hit) and drift; route-valid targets (the `$40xx` sled, PSR sets); the save-corruption RESET/A metronome; moderator verify | `red/gba/hold-start-v1`: GBA HD hardware-validated 5 of 5; GBA / GBA SP same silicon, not separately sampled; GameCube Game Boy Player UNVALIDATED. `red/dmg/hold-start-v1`: original Game Boy hardware-validated 5 of 6 |
| **Gen 1 Trainer ID: Blue** | same | same | `blue/gba/hold-start-v1`, `blue/dmg/hold-start-v1`: emulator-derived (every offset re-derived from three further cold boots, byte-identical); **no hardware sample yet** |
| **Gen 1 Trainer ID: Yellow** | same | same; no route-valid target (the PSR route's 6415 / 64EA are not produced by the shipped methodology) | `yellow/gba/hold-start-v1`, `yellow/dmg/hold-start-v1`: emulator-derived; **no hardware sample yet** |
| **Gen 1/2** R/B/Y/G/S/C shiny DVs | Automatic hunt bot: no seedable RNG exists, so the bot retries a savestate with shifted timing until the roll is shiny (Gen 2 rule) or matches your DV pattern: encounters, gifts/starters, and TIDs | Not practical (hardware divider RNG) | |
| **Gen 3** R/S (E/FRLG experimental) | Fully automatic: the mGBA script reads the live RNG, self-calibrates with a throwaway press + savestate rewind, and presses A on the exact shiny/TID frame: starters, gifts, AND static legendaries; a brute-force hunt covers wild grass | Calibrated power-on timer for dead-battery R/S (every boot seeds 0x5A0); TID manip converges in a few attempts and reveals your SID | verified on Ruby under libmgba (`tests/harness/`) |
| **Gen 3 Secret ID: Emerald / FireRed / LeafGreen** | | The Trainer ID cannot be chosen (a sub-frame Timer1 count); the Secret ID follows from the typed Trainer ID after k+1 LCRNG advances: one candidate per k, a press cue that pins k to a 27-frame window, pins (a PID seen shiny or not) that narrow it to one | `*/gba/typed-tid-sid-v1`: frame counts emulator-measured on mGBA 0.10.5 by two harnesses; hardware unverified |
| **Gen 4** D/P/Pt/HG/SS | Assisted: seed searcher + verifiers | Two-phase timer, TID-target search by delay, coin-flip seed matching (DPPt) and Elm-call prediction (HGSS), Method-1 shiny search per seed | decomp-verified in Platinum/HGSS (DP's TID path inferred) |
| **Timer models** (EonTimer's Gen 3 / Gen 4 / Gen 5 models, `core/timers.js` + `Timers.cs`) | on branch `rng-solution-phase4-timers`, merging | | checked against EonTimer-generated vectors |
| **Gen 5** engine (SHA-1 seeding into MT) | on branch `rng-solution-phase8-gen5`, merging | | |

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
  start without `--practice`.

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
| `webapp/` | The complete no-emulator toolset as a static web app: the Gen 3 timer and checker, Gen 4, Gen 1/2 DVs, and the **Gen 1 TID** tab (game -> console -> methodology and validity -> target -> anchor and correction -> protocol -> cue with count-in beeps, hold-window beeps, the A cue and a full-screen flash, all from one pre-rendered buffer on the audio clock -> "What did you get?" with P(hit) and drift kept in the browser; the RESET/A metronome; moderator verify; the Emerald / FRLG Secret ID branch). `sync-core.sh` copies the engines and the data in (`gen1-data.js` carries the JSON as globals, so no fetch is needed); `build-mobile-bundle.mjs` inlines everything into one HTML string for the Hackmons Hub mobile screen. It is the page at [hackmons.com/rng-solution](https://hackmons.com/rng-solution). |
| `app/` | **ShinySolution.exe**, the WinForms desktop app (.NET 10, self-contained single file): every searcher and timer, the **Gen 1 TID (R/B/Y)** tab (the same steps; one WAV rendered per schedule so every beep is sample-exact; calibration, pins and reset adjusts in the app's settings), plus the live TCP link that drives the mGBA scripts. |
| `electron/` | Linux AppImage/tar.gz and macOS dmg/zip of the web toolset (`build.sh`, the `build-desktop` workflow). |
| [RNG Solution](https://github.com/isleep2late/RNG-Solution) | The terminal front end: the same TARGET flow, the press trainer, dual-anchor fusion, `stats`, `verify`, `reset`, `sid`, and the practice-only PREDICT mode. It reads this repository's `core/data` in place of its own registry and CSVs with `--data-dir <Shiny Solution checkout>` (or `SHINY_SOLUTION_DATA`), so every head runs over one file. |
| `lua/shiny-solution.lua`, `lua/shiny-solution-gb.lua` | The Gen 3 mGBA auto-manip script and the Gen 1/2 hunt bot (also usable standalone). |
| `core/gen1tid.js` + `app/Core/Gen1Tid.cs` | The Gen 1 Trainer ID engine (cue schedules for the menu / power-on / reset anchors, target sets and verdicts, inversion, calibration with the 60-frame outlier and duplicate guards, the reset metronome, verify, the runner's press-jitter model: P(hit), drift, fusion) and the Gen 3 typed-TID -> SID model, ported from RNG Solution's Python and checked against the vectors it emits (`tests/gen1tid-vectors.json`, about 1,840 cases: integers, strings and error classes exact, floats to 1e-9 relative). Target sets are never defaulted (a verdict needs the game's sets), and every number is checked at the JS boundary. |
| `core/rng.js` + `core/gen4.js` + `core/gen12.js` + `app/Core/` | The Gen 3 LCRNG / Method 1, Gen 4 seed / MT19937 / timer and Gen 1-2 DV engines, parity-tested between JS and C#. |
| `docs/FACTS.md` | Every mechanic used, with decompilation citations and the hardware validation record. |
| `tests/` | The test suites (below). |

## Verification

- `tests/run-tests.sh`: the JS engine vs an algorithmically independent Python reference; the
  JS Gen 4 / Gen 1-2 ports vs vectors emitted by the C# engine; `core/gen1tid.js` vs
  `tests/gen1tid-vectors.json` (emitted by RNG Solution's Python) with a corrupted vector shown
  failing; the webapp smoke test (`tests/test-webapp.cjs`: the mobile bundle carries the Gen 1
  TID tab, the engine and the embedded data verbatim, and the tab's pure module reproduces the
  engine's schedules, sample-exact render onsets, the calibration guards, RNG Solution's control
  numbers: sd 20 ms -> P(hit) 32 %, the 199.2 / 397.9 ms reset centres, `$4003` at 9.0 s
  inconsistent, the Emerald worked example `$B0AF` -> `$7F16` at k = 5478 kept by a shiny pin
  and dropped by a contradicting one) with a bundle stripped of the tab shown failing; and, when
  Google Chrome is installed, the tab driven headless through its own handlers.
- `app/run-core-tests.sh`: the C# engine vs the same vectors, plus canonical MT19937 vectors,
  the Gen 4 seed/timer model, and `Gen1Tid.cs` vs the gen1tid vectors with its own negative
  control. `dotnet build app/App -c Release -p:EnableWindowsTargeting=true` compiles the
  desktop app on Linux.
- `tests/run-lua-sim.sh` and `tests/lua-sim-gb.py`: the mGBA scripts against stubbed APIs.
- `tests/harness/`: ground truth against real Pokémon Ruby under libmgba's Python bindings.
- RNG Solution's `tests/run-tests.sh` (196 tests plus negative controls) covers the terminal
  front end, and its `tests/test_shared_data.py` checks that this repository's `core/data`
  files are its registry and tables, and that `--data-dir` reads them.

## Building

```
export DOTNET_ROOT=$HOME/.dotnet PATH=$HOME/.dotnet:$PATH
dotnet publish app/App/ShinySolution.App.csproj -c Release -r win-x64 \
  -p:PublishSingleFile=true --self-contained true -o <outdir>     # the Windows app
bash webapp/sync-core.sh                                            # the static web app (serve webapp/)
node webapp/build-mobile-bundle.mjs out.ts                          # the mobile bundle
bash electron/build.sh                                              # Linux AppImage / tar.gz
python3 tools/gen-gen1-data.py ../RNG-Solution                      # regenerate core/data from the registry
```

## Roadmap, with the hardware that gates each step

- **Blue and Yellow cartridge samples**: the four tables are emulator-derived only; three
  in-table IDs near the aimed offset on a real console (GBA-silicon and DMG) are the transfer
  test, and Yellow's route protocol (6415 / 64EA) still has to be derived. Gate: Blue and
  Yellow carts on a GBA HD and a DMG.
- **GameCube Game Boy Player transfer test** of the hold-window table (one calibration attempt
  settles it) and the RESET fade constant from outcomes. Gate: a GameCube with the Game Boy Player.
- **Gen 2** (Gold/Silver/Crystal): a Trainer ID methodology of its own; nothing is tabulated.
  Gate: a Gen 2 cart on the same consoles.
- **Dead-battery Ruby/Sapphire** on hardware: `rs/gba/boot-seed-v0` is defined, not implemented;
  the console timer exists and needs its hardware record. Gate: a dead-battery R/S cart.
- **Gen 4**: one DS session to record the two-phase timer's calibration on hardware.
- **Gen 5**: the engine and the timer model are on their branches; one DS Lite session validates
  the seeding on hardware.
- Emerald / FRLG Secret ID frame counts on hardware (expected to transfer exactly: whole-VBlank
  counters), wild encounters, eggs and lead-ability aware searches for Gen 3/4, Gen 4 emulator
  automation, a hardware auto-mode through a Game Boy Player.

## License

GPL-3.0. The implementations are original, written against the pret decompilations; the
Gen 4 timing model follows EonTimer's MIT-licensed source, and seed-inversion edge cases
were cross-checked against PokeFinder (GPL-3.0), whose license this project shares.
