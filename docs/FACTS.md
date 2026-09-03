# Corrections log

**v0.3.0 — the unaligned TID/SID read (the "non-shiny shiny" bug).**
`playerTrainerId` lives at `gSaveBlock2 + 0x0A`, which is 2-byte but **not** 4-byte aligned.
The Gen 3 script used to read it with a single `emu:read32(base + 0x0A)`. mGBA's `emu:read32`
goes through the CPU bus (`GBALoad32`), which masks the address down to a 4-byte boundary and
rotates the result by `(addr & 3) * 8` bits — so a read32 at `+0x0A` returns
`TID | (playerGender << 16) | (specialSaveWarp << 24)`, i.e. the correct TID but an **SID of
0 for any male player** (gender byte 0, warp byte 0). Every shiny search then targeted the
wrong SID and delivered a non-shiny mon that the tool nonetheless reported as SHINY.
Reproduced live on mGBA 0.10.5 against a real Ruby checkpoint (player LANDON, TID 53559 /
SID 56406): the old script read `SID 0` and armed for PID `B90F683F` (not shiny); the fixed
script reads `SID 56406` and delivers a truly shiny Torchic.
Fixes: read TID/SID with two **aligned 16-bit** reads (`+0x0A` → TID, `+0x0C` → SID); and,
as an independent backstop, cross-check every result against the OT ID the game writes into
the mon itself at `BoxPokemon + 4` (the value the game's own `IsShinyOtIdPersonality` uses),
adopting it if the save-block read ever disagrees. A new `selfcheck()` command dumps every
address the flows depend on and warns on any inconsistency (wrong ROM/hack, bad layout).
See [the RAM addresses table](#ram-addresses-retail-english-carts) for the alignment note.

**v0.3.0 — gift into a non-empty party.** The starter/gift flow only watched party slot 1,
so a gift received when the party already had Pokémon never triggered (it lands in
`gPlayerParty[gPlayerPartyCount]`). It now watches `gPlayerPartyCount` and the first empty
slot.

**v0.3.0 — gender filter threshold.** The gender filter compared `PID & 0xFF < 31` for
everything; 31 is only correct for the 87.5%-male species (the starters). A `gender_threshold`
setting (and a species-ratio dropdown in the app) now lets you match the right cutoff.

# Verified RNG facts

Every mechanic Shiny-Solution relies on was verified directly against the pret decompilations
(pokered, pokeyellow, pokecrystal, pokegold, pokeruby, pokeemerald, pokefirered,
pokediamond, pokeplatinum, pokeheartgold), not taken from community folklore. Citations below
are file paths within those repos.
The one exception is Gen 5 (last section): no decompilation exists, so that engine is a port
of PokeFinder (Admiral-Fish, GPL-3.0) and is labelled EMPIRICAL throughout, with PokeFinder
file:line citations instead.

The citations in this file are the registry the heads render as footnotes: `tools/gen-citations.py`
reads every `repo/path:lines` citation here (a bare `file.c:lines` inherits the repository of the
previous full citation in its paragraph; `repo/.../file.c:lines` finds the one file of that name),
reads each cited line in the pret checkout (a range whose first line is blank or a lone brace is
refused), and writes `core/data/citations.json` with the citation, the section of this file it sits in
(and every section that cites it), the line of this file and the text of the first cited line
(`docs/DATA.md`). The Gen 1 TID, Gen 2 TID and wizard tabs, and the desktop panels, mark each protocol
step, target line, schedule line and verify line with `[^n]` and list the sources under the protocol
(`webapp/footnotes.js`, `app/App/Citations.cs`): a decomp line with the section it is filed under here (a
source may name the one it means among the sections that cite the line),
SYNTHESISED for a source with no decomp line (a timer model, a community convention), or a measured
constant under its validation status word (EMULATOR-EXACT, HARDWARE-VALIDATED n or EMPIRICAL, from the
console's status in the Gen 1 and Gen 2 data files); a citation this file does not carry is printed as
NOT IN THE REGISTRY, which the tests refuse. `tests/run-tests.sh` regenerates the registry when pret is
present and requires it byte-identical.

# Gen 1/2 (Game Boy)

## The RNG (the hardware divider)

No seedable PRNG exists. The state is two HRAM bytes (`hRandomAdd`/`hRandomSub`) stirred by
the free-running hardware divider register rDIV: `Random_` adds rDIV into one byte and
subtracts it from the other (`pokered/engine/math/random.asm:1-13`,
`pokecrystal/home/random.asm:1-29`), and the VBlank handler runs the same update every frame
(`pokered/home/vblank.asm:37`, `pokecrystal/home/vblank.asm:68-79`). Results are a pure
function of input frame timing from a fixed savestate — which is why the hunt bot retries a
savestate with shifted timing instead of computing targets. State addresses: Gen 1
`FFD3/FFD4`, G/S `FFE3/FFE4`, Crystal `FFE1/FFE2` (built syms).

## Shininess (Gen 2 rule)

`CheckShininess` (`pokecrystal/engine/gfx/color.asm:8-43`): shiny iff Def DV == 10,
Spe DV == 10, Spc DV == 10 and Atk DV has bit 1 set (Atk in {2,3,6,7,10,11,14,15}) —
1/8192. On the packed DV word: byte0 & 0x2F == 0x2A pattern family, byte1 == 0xAA.
Gen 1 mons have no shininess; the Time Capsule copies DVs verbatim
(`pokecrystal/engine/link/link.asm:1024-1108`), so a Gen 1 mon is shiny in Gen 2 iff its
DVs already satisfy the rule — hunting "shiny" DVs in Gen 1 works.

## Where DVs are rolled

- Gen 1 wild: two `BattleRandom` calls at battle init (`pokered/engine/battle/core.asm:6007-6019`);
  trainer mons get fixed $98/$88. Catching copies `wEnemyMonDVs` into the party unchanged.
- Gen 1 gifts/starters: two `Random` calls in `_AddPartyMon` when not in battle
  (`pokered/engine/pokemon/add_mon.asm:114,116`). **Important ordering:** `_AddPartyMon`
  increments `wPartyCount` and shows the "give a nickname?" prompt (`predef AskName`) *before*
  the two `Random` DV calls. So the mon's slot exists (count already bumped) but its DVs are
  stale until the player finishes/declines naming. The hunt bot therefore watches a Gen 1 gift
  from the nickname box (trigger B to decline) and waits for the slot's DV bytes to change,
  rather than watching the party count.
- Gen 2 wild: `.GenerateDVs` in `LoadEnemyMon` (`pokecrystal/engine/battle/core.asm:6127-6137`);
  the wild held-item check consumes **one** `BattleRandom` call when it rolls no-item (~75%)
  and **two** when an item is rolled (~25%); `BATTLETYPE_FORCEITEM` encounters (Ho-Oh, Lugia,
  Snorlax) and trainer battles consume **none**. Unown/Magikarp filters can re-roll. Red
  Gyarados is hardcoded shiny; roamers roll once on first encounter; the Odd Egg picks a fixed
  table entry (shiny entries are exactly $2AAA).
- Gen 2 gifts/starters: DVs are rolled in `GeneratePartyMonStats` (via `TryAddMonToParty`)
  *before* the count is finalized and before any naming — the opposite order from Gen 1 — so
  the bot's party watch (count rises, then read the finished slot) is correct for Gen 2.
- Gen 2 gifts/starters: two `Random` calls in `GeneratePartyMonStats`
  (`pokecrystal/engine/pokemon/move_mon.asm:205-214`).
- Trainer IDs: Gen 1 `InitPlayerData` samples the RNG bytes during Oak's speech
  (`pokered/engine/movie/oak_speech/init_player_data.asm:1-10`); Crystal samples them one
  frame apart in `_ResetWRAM` plus two more calls for the Secret ID
  (`pokecrystal/engine/menus/intro_menu.asm:118-134`).

## Hunt-bot addresses (from rgbds builds sha1-verified against retail hashes)

| Symbol | Red/Blue | Yellow | Gold/Silver | Crystal 1.0 |
|---|---|---|---|---|
| `wEnemyMonDVs` | `0xCFF1` | `0xCFF0` | `0xD0F5` | `0xD20C` |
| `wPartyCount` | `0xD163` | `0xD162` | `0xDA22` | `0xDCD7` |
| `wPartyMon1DVs` | `0xD186` | `0xD185` | `0xDA3F` | `0xDCF4` |
| party stride | `0x2C` | `0x2C` | `0x30` | `0x30` |
| battle flag | `wIsInBattle 0xD057` | `0xD056` | `wBattleMode 0xD116` | `0xD22D` |
| `wPlayerID` | `0xD359` | `0xD358` | `0xD1A1` | `0xD47B` |

The community value 0xD204 for Crystal's enemy DVs is wrong — that address is
`wTempEnemyMonSpecies` in the sha1-verified sym. Yellow is shifted one byte from Red/Blue.
EN carts only; Crystal 1.1 inferred identical, other languages differ. The hunt bot rejects
non-English/Australian carts by the ROM game code at `0x013F` (Gold `AAUE`, Silver `AAXE`,
Crystal `BYTE`/`BYTU`) and Gen 1 by the destination byte at `0x014A` (`0x00` = Japan).

**Crystal WRAM banking:** Crystal's party/enemy/ID data lives in WRAM bank 1 (`0xD000`–
`0xDFFF`). `emu:read8` on the CGB bus returns whatever `rSVBK` (`0xFF70`) currently selects,
and game code briefly maps other banks, so the bot only trusts a `0xD000`–`0xDFFF` read while
`rSVBK & 7 <= 1`. Red/Blue/Yellow/Gold/Silver are unbanked, so this gate is Crystal-only.

## Gen 1 Trainer ID (hold-START methodologies, RNG Solution)

> The heads that run on these facts (the webapp's Gen 1 TID tab, the desktop app's Gen 1 TID
> panel, RNG Solution's terminal front end over the same `core/data` files) are described in
> [../README.md](../README.md) and [../USAGE.md](../USAGE.md); this section is the record of
> the constants and their validation, unchanged. The RUN / PRACTICE-HUNT wall the heads carry
> (RUN by default, the explicit switch and banner, the split calibration stores, the
> `webapp/hunt/` boundary the bundlers refuse) is the README's "Modes" section; it is a rule
> about inputs and stores, not a constant, so it is not recorded here. The PRACTICE / HUNT
> watcher itself (`webapp/hunt/hunt-panel.js`, RNG Solution's `rngsolution/hunt/`) and the
> capture constants it rests on (the box geometry and thresholds measured on the GBA HD, the
> 18.28-frame border-strip lag and the -26.03-frame whole-box lag, the DMG's 38.83-frame
> press-to-visible lag, the 2 samples-per-game-frame guard) are described in the README's
> "Practice & Hunt window" paragraph and in RNG Solution's README ("PREDICT mode: the hunt
> package") and `tests/fixtures/hunt/README.md`, where each fixture's provenance is listed.

Copied from RNG Solution's `docs/FACTS.md` (the Gen 1 console tool; the text is its commit e105e84's,
unchanged through bd47f98, the commit whose `tests/emit_vectors.py` emitted the vectors), which is
the source of `core/data/gen1-tid.json` (generated by `tools/gen-gen1-data.py` from its
`rngsolution/data/red/platforms.json` and the six CSV tables) and of the engine ported to
`core/gen1tid.js` / `app/Core/Gen1Tid.cs` (checked against vectors its Python emits,
`tests/gen1tid-vectors.json`: integers, strings and error classes exact, floats to 1e-9 relative).
File and line references below are to that repository (`rngsolution/timeline.py` is the oracle of
`core/gen1tid.js`). One section of the original is left out: `Audio` (the terminal tool's WAV
renderer and player probe), because Shiny Solution's heads render their own cues. Its labels and
citation note, verbatim:

Every constant the tool uses, where it comes from, and how far it has been checked. Four
labels are used: **emulator-measured** (from a harness on pokemon-speedrunning/gambatte-core),
**hardware-validated** (checked against a real console), **community constant** (used by the
community's emulator but never measured on hardware), and **inferred** (follows from measured
facts, not itself measured).

Decompilation citations refer to [pret/pokered](https://github.com/pret/pokered) at commit
`1e96034` (2026-07-02); function names are stable across revisions, line numbers are not.

### Timing units

| constant | value | source |
|---|---|---|
| frame rate | 4194304 / 70224 = 59.7275 Hz | Game Boy clock and frame length; `rngsolution/timeline.py` `FPS` |
| one frame | 16.7427 ms | 1000 / FPS |
| samples per frame | 35112 at 2097152 Hz | gambatte's audio rate; used by the reset harness |
| menu to table | 80 frames | the tables' definition: A press frame = menu frame + 80 + offset |

### Where the ID comes from (the game code)

The table rows below are measured; these are the routines they measure. Blue is pret's pokered built
for Blue, so its citations are pokered's.

| fact | where | label |
|---|---|---|
| the title screen waits in `.awaitUserInterruptionLoop` on `CheckForUserInterruption`, which runs one `DelayFrame` and one `JoypadLowSensitivity` per frame and returns on START or A (`hJoy5`) or Up+Select+B (`hJoyHeld`); the loop ends, the cry and the fade play, then `jp MainMenu`: START held is read on the first poll after the title's scroll-in, so any START-down frame inside the hold window opens the menu on one fixed frame | `pokered/engine/movie/title.asm:227-239,266`, `pokered/home/overworld.asm:2395-2424`; Yellow polls `hJoyHeld & (A\|START)` by level in its own title loop, `pokeyellow/engine/movie/title.asm:166-175` | STRUCTURAL (the loop); the window's frames EMPIRICAL (the tables below) |
| the NEW GAME menu waits in `HandleMenuInput` with `wMenuWatchedKeys = A\|B\|START`; A on NEW GAME goes to `StartNewGame` -> `OakSpeech` -> `InitPlayerData2`, whose first two `Random` calls write `wPlayerID`: `hRandomSub` (the high byte) then `hRandomAdd` (the low byte) | `pokered/engine/menus/main_menu.asm:64-68,85-86`, `pokered/engine/movie/oak_speech/oak_speech.asm:42-52`, `pokered/engine/movie/oak_speech/init_player_data.asm:1-10`; Yellow `pokeyellow/engine/menus/main_menu.asm:63-66,84`, `pokeyellow/engine/movie/oak_speech/oak_speech.asm:60`, `pokeyellow/engine/movie/oak_speech/init_player_data.asm:1-10` | STRUCTURAL |
| the only RNG is `Random_`: `hRandomAdd += rDIV` and `hRandomSub -= rDIV`, called once per VBlank, so the Trainer ID is a function of the frame of the A press and of the DIV phase that the hold-START boot fixes; the table's offset is that frame counted from the menu (A press frame = menu frame + 80 + offset) | `pokered/engine/math/random.asm:1-13`, `pokered/home/vblank.asm:37`; Yellow `pokeyellow/engine/math/random.asm:1-13`, `pokeyellow/home/vblank.asm:43` | STRUCTURAL (the stir); the offset EMPIRICAL (the tables' definition) |

### Trainer ID tables

Both tables are in `rngsolution/data/red/` with their derivation line preserved as the first
`#` comment. They are byte-identical (data rows) to the owner's derivation output
(`gba-holdtable-extended.csv`, `dmg-holdtable-extended.csv`), and the original 1200-row
tables agree with them on every overlapping offset (`tests/test_tables.py`, fixtures in
`tests/fixtures/`).

#### GBA silicon (`gba-gbp.csv`)

| fact | value | status |
|---|---|---|
| derivation | gambatte-core, `GB::CGB_MODE | GB::GBA_FLAG`, `cgb_boot.bin` (2304 bytes), START held from frame 1400, offsets 0–2399 | emulator-measured |
| hold window | frames 1300–1475 (21.77–24.70 s after the boot starts): holding from 1300/1350/1400/1450/1475 all open the menu on frame 1553 with a byte-identical table; 1495 slips to 1555; before ~1290 the menu never opens | emulator-measured |
| menu frame | 1553 (26.00 s) | emulator-measured |
| release timing | irrelevant: releasing 0/5/15/30/60/120/240 frames after the menu gives the same ID for a fixed A frame | emulator-measured |
| distinct IDs | 2359 of 2400 (41 collisions) | table |
| GBA HD | 2026-09-01: 5 of 5 observed IDs invert to the stopwatch offset and are absent from the DMG table (chance membership 3.6 % each); exact prediction of offset 201 on an untuned run | hardware-validated |
| GBA / GBA SP handheld | same silicon and boot ROM as the GBA HD; not separately sampled | inferred |
| GameCube Game Boy Player | **not sampled with this hold-window table.** An earlier method (per-START-frame tables without the GBC boot, 2026-08-30, six calibration triples) did not transfer to the GBP under any constant alignment. Whether the GBP shares the GBA HD's determinism is open; the tool labels it unvalidated, lists it after the validated choices, and asks for a transfer test | **unvalidated** |
| GSE / gambatte-speedrun | the derivation core and boot | emulator-exact |
| press-to-visible lag | 8.7 frames (0.146 s): the A press's first visible effect on the game screen, GBA HD, one sample; provisional. The GBA HD's button overlay in the black margin shows the press itself | hardware, n = 1 |
| route-valid offsets | 358 → `$4003`, 743 → `$400C`, 1131 → `$404A`, 1448 → `$405B`, 1640 → `$4052` | 358/743/1131 triple cold-boot verified; 1448/1640 one derivation |
| `$40xx` traps | 1647 → `$40D9`, 1785 → `$40EA` | table |

#### Original Game Boy (`dmg.csv`)

| fact | value | status |
|---|---|---|
| derivation | gambatte-core, DMG mode, `dmg_boot.bin` (256 bytes, sha1 `4ed31ec6b0b175bb109c0eb5fd3d193da823339f`), START held from frame 1545, offsets 0–2399 | emulator-measured |
| hold window | frames 1450–1640 (24.28–27.46 s) | emulator-measured |
| menu frame | 1701 (28.48 s) | emulator-measured |
| negative controls | holding from 1700/1800 (outside the window) gives unrelated IDs (`$3CFF`, `$DCA7`, `$4A4C`, `$FADF`) at the same offsets | emulator-measured |
| distinct IDs | 2366 of 2400 (34 collisions) | table |
| hardware | real DMG, 2026-09-01: 5 of 6 observed IDs in the table at the stopwatch offset; untuned prediction one frame out with the truth inside the printed ±1 set | hardware-validated |
| press-to-visible lag | 38.83 frames (650 ms): Red's fade-out is the first visible effect of the A press; fitted on two independent runs (38.55 and 39.10, a 0.55-frame spread) | hardware, n = 2 |
| route-valid offsets | 517 → `$400B`, 878 → `$4052`, 2359 → `$4033` | 517/878 re-derived with START held at 1450, 1545 and 1640 (byte-identical); 2359 one derivation |
| `$40xx` traps | 100 → `$40AD`, 236 → `$4093`, 1093 → `$40FB`, 1160 → `$40DC`, 1622 → `$4081`, 1777 → `$40D3`, 1978 → `$4073`, 2389 → `$405F` | table |

#### Blue (`rngsolution/data/blue/`)

Derived 2026-09-02 with `tidderive2.cpp` (the Red tool generalised: WRAM offsets as arguments;
`tools/gen1-tid-tables/tidderive2.cpp`, built from `~/gambatte-core` with the same g++ line; that directory has the scripts and the plateau, release, finite-hold and agreement logs) on
`pokeblue.gbc` sha1 `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2` (pret's byte-exact ROM), the same
boot ROMs as Red, `wSaveFileStatus $D088`, `wPlayerID $D359` (`pokeblue.sym`).

| fact | GBA silicon (`gba-gbp.csv`) | original Game Boy (`dmg.csv`) | status |
|---|---|---|---|
| plateau (`hold` search, step 5 over 0–2400 then step 1 over every candidate) | START held from any frame 1293–1492 opens the menu on frame 1560; 1280–1292 never open it; 1493+ slide 1:1 | 1441–1640 → frame 1708; 1430–1440 never; 1641+ slide | emulator-measured |
| derivation hold frame | 1400 | 1545 | |
| three further cold boots | START from 1293, 1350, 1492: byte-identical on all 2400 offsets | 1441, 1500, 1640: byte-identical | emulator-measured |
| negative control | START from 1500 (menu 1568): 0 of 2400 offsets agree | START from 1650 (menu 1718): 0 of 2400 agree | emulator-measured |
| release timing | irrelevant (0/5/15/30/60/120/240 frames after the menu, offset 300: `$8BF8` every time) | same (`$61A3`) | emulator-measured |
| finite hold | a 60-frame hold from 1400 never opens the menu; 100 frames does (1560) | | emulator-measured |
| white flash with no input | frames 1328–1392 (inside the window) | 1476–1540 (inside) | emulator-measured |
| distinct IDs | 2357 of 2400 (43 collisions); offset 1913 is a genuine `$0000` (the `wPlayerMoney` write that follows it was seen 22 frames after A) | 2344 (56 collisions) | table |
| `sled-40xx` hits | 1028 → `$404A`, 1699 → `$4026`, 1810 → `$4040` | 994 → `$4047`, 1513 → `$400E`, 2105 → `$402C` | all triple-verified |
| `psr-64c2` family | none in 0–5999 | none in 0–5999 | extended sweep |
| `$40xx` traps | 675, 1006, 1422, 2107 | 658, 1003, 1028, 1810, 2248, 2304 | table |
| hardware | **none** | **none** | unvalidated |

#### Yellow (`rngsolution/data/yellow/`)

`pokeyellow.gbc` sha1 `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1`, `wSaveFileStatus $D087`,
`wPlayerID $D358` (`pokeyellow.sym`). STRUCTURAL differences from Red (pret/pokeyellow):
`PlayIntroScene` polls `JoypadLowSensitivity` every frame and skips on `hJoyPressed & (A|B|START)`
(`pokeyellow/engine/movie/intro_yellow.asm:12-20`); the title loop tests `hJoyHeld & (A|START)` (level,
`pokeyellow/engine/movie/title.asm:166-175`); `PlayShootingStar` shows the copyright screen for 180 frames,
waits 64 more, then `AnimateShootingStar` polls `CheckForUserInterruption`
(`pokeyellow/engine/movie/intro.asm:82-123`, `pokeyellow/home/overworld.asm:2273-2302`). EMPIRICAL (the `hold` search at
step 1 over every candidate range, `timeline` brightness with no input):

| hold START from (frames) | GBA silicon: menu | DMG: menu | what happens |
|---|---|---|---|
| 0–520 (GBA) / 0–663 (DMG) | **2006** | **2107** | the hold's edge is spent at the star's first poll (frame 521 / 664), which cuts the star short; the intro plays in full; the title's held-START check opens the menu. **Shipped** (`yellow/*/hold-start-v1`). The copyright screen is frames 267–447 (GBA) / 411–591 (DMG) |
| 521–733 / 664–876 | holdFrom + 1486 | slides 1:1 | the star is interrupted on the press frame |
| 734–834 / 877–973 | 1048 | 1176 | a blind stretch (star tail, `Delay3`, intro set-up): the intro's first poll sees the edge and skips it |
| 835–1974 / 974–2087 | slides 1:1 | slides | the intro skips on the press frame |
| 1982–2202 / 2093–2305 | 2259 | 2360 | the intro has ended; the title's first held-START check is on a fixed frame |
| 2203+ / 2306+ | slides | slides | the title polls every frame |

Shipped plateau checks: three further cold boots (START from 0, 267, 520 on GBA; 0, 411, 663 on
DMG) byte-identical on all 2400 offsets; negative controls START from 600 (GBA, menu 2086) and
700 (DMG, menu 2144) agree on 0 of 2400; release timing after the menu irrelevant (offset 300:
`$ECDE` GBA, `$168C` DMG for every release delay); a hold released before the title never opens the
menu (hold lengths 200–1500 from frame 350: no menu; 1700+: frame 2006). Distinct IDs 2362 (GBA)
and 2351 (DMG). No `$0000`. **PSR targets**: `6415` and `64EA` absent from offsets 0–5999 under the
shipped plateau on both boots; under the after-intro plateau `64EA` at DMG offset 2005 only; under
the blind-stretch plateau neither (sweeps of 0–2399; logs in `/tmp/tidwork-by/logs`). `$40xx`
values do occur (GBA 164 → `$4027`, 370 → `$405B`, 380 → `$400A`, 2196 → `$4028`; DMG 1153 →
`$4024`) but Yellow has no bank-`$1D` sled route, so no target set accepts them. Hardware: **none**.

#### Why a `$40` high byte is not enough

The Any% save-corruption route forces `wCurMapScriptPtr` to `jp $40xx` with bank `$1D`
mapped. `1D:$4000–$405B` is map-block data that executes as a harmless 92-byte sled falling
into `HallOfFamePC` at `1D:$405C`; a low byte past `$5C` jumps into the middle of that
routine and hard-locks. The published rule also excludes `$39` (the one hole inside the
sled; the tool names it as such rather than as an overshoot). Hence `verdict()`: high byte
`$40` and low byte in `$00–$38` or `$3A–$5C`. This rule comes from the route documentation
(the practice kit's sled analysis and the PSR route docs); the tool applies it as published
and does not re-derive it. Route-valid density is (1/256) × (92/256) ≈ 1 in 712 offsets.

### Cue model

| constant | value | source |
|---|---|---|
| target seconds (menu anchor) | (80 + offset) / FPS | table definition |
| A cue time | anchor + target − correction | `manip-cue` `Timeline.java`, same model |
| default correction, menu anchor | 200 ms | human reaction to seeing the menu (~200 ms) plus audio launch delay; a starting point the calibration replaces |
| default correction, power-on and reset anchors | 100 ms | no visual reaction involved, only the audio launch delay; starting point only |
| implied correction | used + (hit − aimed) × 16.7427 ms | a late press means the cue must come earlier |
| active correction | mean of implied corrections | `Timeline.java` `mean()` |
| outlier guard | an in-table hit more than 60 frames (1.0 s) from the aim is not added unless forced | `timeline.OUTLIER_FRAMES`; ~3.6 % of arbitrary IDs are in a table by chance, and one such sample used to move the next cue by seconds |
| duplicate guard | same ID and aim as the newest sample, not tagged as another playback | `timeline.is_duplicate` |
| sample records the audio player | yes | the launch latency the correction absorbs differs by player (below) |
| count-in | 4 beeps, 1.0 s apart, 880 Hz 60 ms; spacing must be > 0 | configurable |
| count-in clearance (power-on / reset anchors) | beeps earlier than menu + 0.5 s are left out | so they cannot be confused with the hold and menu markers |
| A cue | 1320 Hz 150 ms | |
| hold beeps (power-on / reset anchors) | 660 Hz 80 ms at the window start and its centre | |
| menu marker (power-on / reset anchors) | 990 Hz 40 ms, twice 80 ms apart, at the menu frame | |
| RESET beat / A beat | 440 Hz 50 ms / 1320 Hz 50 ms | |

#### Anchors

* **menu**: ENTER when the NEW GAME menu appears. Available everywhere; the default.
* **poweron**: ENTER at the power switch; hold window and menu are the family's frame
  numbers divided by FPS; the A cue is at menu + target − correction. Offered on the GBA HD,
  handheld GBA/GBA SP and DMG. By hand it was accurate to 0.131 s (8 frames) on the DMG
  capture, which is why the menu anchor is the default.
* **reset** (GSE and GameCube Game Boy Player only): ENTER at Ctrl+R / the GameCube RESET
  button. gambatte-speedrun's GBP reset (`gambattesource.cpp` `resetStepPre`: `resetCounter_
  = resetFade_ + extraSamples()`, then `reset(resetStall_)`) keeps the game running for the
  fade and then stalls before the boot, so every time is later by (1234567 + 17555.5 +
  3309568) / 35112 = **129.918 frames = 2.1752 s** (`Timeline.java` `resetExtraSeconds()`,
  `timeline.reset_anchor_extra_seconds`). Exact on GSE; on a real GameCube the fade and stall
  are community constants, so a constant difference goes into this anchor's own correction.
  A plain power-on is **not** offered for the GameCube: with the disc in, the Game Boy Player
  disc software boots first with a disc-dependent delay, so GameCube power-on is not an anchor.

Each platform lists its anchors in `platforms.json` (`anchors`); `cue --anchor` refuses one
the platform does not have.

### Save-corruption reset

All save timings below are from the owner's `savewindow` harness on gambatte-core rev
`5a41a68c` in GBP mode (`reset-timing/RESET_TIMING.md`, `model.json`): 13,800 runs over
3000 consecutive press boundaries, two checksum sentinels, write-callback cross-checks, and
end-to-end reset checks in which a `GB::reset` inside the window really produced a file that
CONTINUE loads with `wPartyCount = $FF`, and 100 samples outside it on either side is
rejected.

#### The window in the game code

`engine/menus/save.asm`:

* `SaveMenu`: after YES on "Would you like to SAVE the game?", `wSaveFileStatus` is
  checked; status 1 (no valid file at boot: the route) goes straight to `SaveGameData`.
  Status 2 calls `CheckPreviousSaveFile` first, which recomputes the SRAM checksum
  (~3 frames) and, with the same Trainer ID, also proceeds to `SaveGameData` (the
  `direct` / practice-save path); a different ID asks "The older file will be erased".
* `SaveGameData`: `SaveMainData` (copies name, main data, sprite data, the current box, then
  `CalcCheckSum` and the store to `sMainDataCheckSum` = **c1**), `SaveCurrentBoxData`
  (second checksum store), `SavePartyAndDexData` (copies `wPartyDataStart..` to
  `sPartyData`, whose first byte is the party count = **p1**, then the third store).
* A reset after c1 and before p1 leaves a file whose checksum is valid but whose party
  count byte is still the cleared `$FF`: the 255-Pokémon party the route needs.

`engine/menus/text_box.asm` `DisplayTwoOptionMenu`: after the choice, `ld c, 15` /
`call DelayFrames` before `TwoOptionMenu_RestoreScreenTiles`. That 15-frame delay is why
the first SRAM write (`sPlayerName[0]`) is 15.22 frames after the press and why the YES/NO
box visibly vanishes 17–19 frames after the press, before c1.

#### Measured timings (frames after the press boundary)

| path | c1 mean [min, max] | p1 mean [min, max] | window |
|---|---|---|---|
| `route` (cleared SRAM, NEW GAME, first save; n = 3000) | 21.3855 [21.3409, **21.5602**] = 358.05 ms | 25.3914 [**25.3199**, 25.5490] = 425.12 ms | 4.0058 fr = 67.07 ms |
| `practice-save` (valid file, same Trainer ID; n = 600) | 24.3892 [24.3252, **24.5045**] | 28.3950 [**28.3047**, 28.4896] | 4.0057 fr |

The "press boundary" is the start of the frame in which A is first presented to the game.
The pad is read (`hJoyHeld` written) **r = 0.177 frames** after that boundary, observed
0.164–0.378 (VBlank ISR length, music engine); the 0.22-frame spread of c1/p1 has the same
cause. `platforms.json` carries the means, the worst-case bounds and the pad-read figures
(`pad_read_frames`, `_min_`, `_max_`).

#### GBP fade (community constant)

gambatte-speedrun `gambatte_qt/src/psrdata.h` `PLATFORM_GBP`: `resetFade = 1234567`
samples plus uniform 0..35111, `resetStall = 101 × (2 << 14)`. So the game keeps running
for F ∈ [35.1608, 36.1608] frames (588.7–605.4 ms, mean 35.6608) after RESET, then stalls
94.2575 frames. The constant has been 33 frames (before 2018-07), 37 frames (commit
`d09d6d6b`, 2018–2020) and the present value (commit `eb44f2bb`, 2020-02-22). **It has never
been measured on a real Game Boy Player.** The latency from the physical RESET press to the
start of the fade is also unmodelled.

#### Intervals: model terms and press-to-press

Condition for the 255-party file: `t_A + c1 < t_RESET + F < t_A + p1`, with `t_A` the press
boundary, so with Δ = t_A − t_RESET: `F − p1 < Δ < F − c1`. Safe for every F and every
boundary: `(F_hi − p1_min, F_lo − c1_max)`; centre `F_mean − (c1_max + p1_min)/2`. These are
the **model terms** (model.json `safe_lo/hi`, `delta_star`).

A human presses at some physical time P; the game latches it at the first pad read after
it, so the press boundary is `P − r + u` with `u` uniform on [0, 1) frame. Hence
`Δ = Δ_phys + U(−r, 1 − r)` (RESET_TIMING section 7), and the **physical plateau** where
every phase succeeds is

* RESET then A: `(lo + r, hi − 1 + r)`, conservative `(lo + r_max, hi − 1 + r_min)`;
* A then power off: the cut at `P + D` must fall in `(c1_max, p1_min)` after the boundary
  for every `u`, so `(c1_max + 1 − r, p1_min − r)`, conservative `(c1_max + 1 − r_min,
  p1_min − r_max)`.

The tool beats the centre of the physical plateau and prints it as the safe window; the
model terms are printed on a second line.

| model | path | model-term safe / centre | physical press-to-press safe (conservative) | **centre beaten** |
|---|---|---|---|---|
| RESET then A (GBP / GSE) | route | 10.8409–13.6006 fr = 181.5–227.7 ms / 12.2208 fr = 204.6 ms | 11.018–12.778 fr = 184.5–213.9 ms (187.8–213.7) | 11.898 fr = **199.2 ms** |
| RESET then A | practice-save | 7.8561–10.6564 fr = 131.5–178.4 ms / 155.0 ms | 8.033–9.833 fr = 134.5–164.6 ms (137.2–164.4) | 8.933 fr = **149.6 ms** |
| A then power off (DMG, handhelds) | route | 21.5602–25.3199 fr = 361.0–423.9 ms / 392.4 ms | 22.383–25.143 fr = 374.8–421.0 ms (375.0–417.6) | 23.763 fr = **397.9 ms** |
| A then power off | practice-save | 24.5045–28.3047 fr = 410.3–473.9 ms / 442.1 ms | 25.328–28.128 fr = 424.1–470.9 ms | 26.728 fr = **447.5 ms** |

These reproduce model.json (`best_physical_delta_ms` 199.17 and 149.53,
`physical_plateau_analytic_frames` [11.0180, 12.7777] and [8.0330, 9.8332],
`physical_plateau_conservative_ms` [187.8, 213.7]) to within 0.05 ms; the residual is the
model's rounded 0.325-frame shift versus the tool's 0.5 − r. The old boundary centre + 1
frame (221.4 ms), which the tool used to suggest trying, is outside the physical plateau
(model P_phys 0.70 at 229.7 ms), which is why the physical numbers are the ones printed.

Sensitivity: dΔ*/dF = 1, i.e. **16.74 ms per frame of fade**. The tool's `--fade-frames`
reproduces the historical constants (33 → 160.1 ms model term / 154.6 ms physical, 37 →
227.0 / 221.6 ms; `tests/test_timeline.py`). A remembered 0.48 s RESET→A lead is inconsistent
with the model (it would need a 52-frame fade); it is one of the things hardware calibration
must settle.

Calibration trap: in the model the picture is fully black for the last F/9 = 3.907 frames
= 65 ms before the reset and audio is muted from the start of the fade, so "RESET to
black" under-estimates F by 65 ms, 2.8× the safe half-width. Calibrate on outcomes.

Status per platform (`platforms.json` `reset_status`): GSE / gambatte-speedrun
**emulator-exact**; GameCube Game Boy Player **hardware: community constant, unverified**;
DMG **emulator-measured save timing, no fade, unverified on hardware**; GBA / GBA SP / GBA HD
**inferred** (a power switch has no fade, so the DMG numbers should apply; not measured).

### Moderator verification (`verify`)

`verify` inverts the Trainer ID and compares the offset(s) with the menu-to-press time the
moderator measured. The A press is invisible on a Game Boy Player or DMG capture; what is
visible is its first effect on the game screen, which lags the press by the family's
press-to-visible lag above (DMG 38.83 frames, GBA 8.7 frames provisional).
`--measured-from visible` subtracts it; `--measured-from press` (default) is for a button
overlay or a hand cam; `--visible-lag-frames` overrides. When the two readings disagree the
tool prints both, so a legitimate run measured the obvious way is not reported inconsistent
without saying why.

### Not modelled

* Game Boy Interface (GBI): its own reset delay.
* Hardware validation of the Blue and Yellow tables; the input pattern the PSR Yellow route videos
  use for 6415 / 64EA.
* Game Boy Pocket / Color boot ROMs.
* Any latency between the physical GameCube RESET press and the Game Boy Player noticing it.
* GameCube power-on as an anchor (disc-dependent boot of the Game Boy Player software).

## Gen 2 Trainer ID / Lucky ID (hold-START single-tap methodologies)

> The engine that runs on these facts is `core/gen2tid.js` / `app/Core/Gen2Tid.cs` over
> `core/data/gen2-tid.json` (generated by `tools/gen-gen2-data.py` from the derivation folder
> `~/Desktop/Red-WR-Practice/gen2-tid`: its `README.md`, `REVIEW.md`, the 10 primary CSVs and the 152
> `rtc-brackets/` CSVs, every sha1 recorded in `inputs_sha1`). Both ports are checked against
> `tests/gen2tid-vectors.json`, emitted by `tests/gen2_reference.py`, which reads the CSVs directly and
> restates every rule below in its own arithmetic (3,893 cases; a corrupted vector is shown failing in
> both runners). The head over it is the web app's Gen 2 TID tab (`webapp/gen2tid-ui.js`, also the Electron app
> and the mobile bundle): it resolves game, console, methodology and RTC state from this data, prints every
> methodology's protocol and validity conditions verbatim, names the methodology id on every output, states that no
> hardware sample exists and that the published route IDs need their community scripts, shows the reachability rule
> below, and calibrates in bins (`isOutlierBins` plus `gen1tid`'s `isDuplicate`; `gen1tid`'s `addSample` throws on
> a bin-centre offset, checked in `tests/test-webapp.cjs`) under `shinySolution.gen2tid.calibration` per mode. The
> desktop app's Gen 2 TID tab (`app/App/Gen2TidPanel.cs` over `Gen2TidSupport.cs`) is its twin: the same resolution,
> texts, guards and store split (`gen2tid.calibration` per mode), pinned to the web tab's output for 20 target inputs
> by `tests/gen2tid-panel-vectors.json` (emitted from the tab by `tools/gen-gen2-panel-vectors.cjs`, checked by
> `app/Tests/Gen2TidPanelChecks.cs`).

Labels as in the derivation folder: **STRUCTURAL** = read in the pret decomp (paths under
`pokegold/` and `pokecrystal/`), **EMPIRICAL** = measured on pokemon-speedrunning/gambatte-core
`5a41a68c` with the real boot ROMs (`cgb_boot.bin` sha1 `1293d68b…`, `dmg_boot.bin` `4ed31ec6…`) on the
pret ROMs (`pokegold.gbc` `d8b8a360…`, `pokesilver.gbc` `49b163f7…`, `pokecrystal.gbc` 1.0 `f4cd194b…`),
logs in the folder's `logs/`; **INFERRED** = follows from those, not itself measured. **There is no hardware
sample of any Gen 2 configuration**; every methodology's status is
`emulator-derived, community-script cross-validated on GBP, no hardware sample`.

### Where the IDs come from

| fact | where | label |
|---|---|---|
| `wPlayerID` is written once, first thing in `_ResetWRAM` (`NewGame` -> `ResetWRAM` -> `ClearTilemapEtc` -> `OakSpeech`): after the WRAM clear `DelayFrame; ldh a,[hRandomSub]; ld [wPlayerID],a` then `DelayFrame; ldh a,[hRandomAdd]; ld [wPlayerID+1],a`; gender / naming come after | `pokegold/engine/menus/intro_menu.asm:1-7,28-49`; `pokecrystal/engine/menus/intro_menu.asm:61-68,102-128` | STRUCTURAL |
| Crystal then rolls `wSecretID` with two `Random` calls a frame apart; it is not shown in game and has no shiny role in Gen 2 | `pokecrystal/engine/menus/intro_menu.asm:130-134` | STRUCTURAL |
| the RNG is only the VBlank stir (`hRandomAdd += DIV`, `hRandomSub -= DIV`); no seed, HRAM cleared at Init; `Random` does the same stir sub-frame | `pokegold/home/vblank.asm:68-79` (`pokecrystal/home/vblank.asm:68-79`), `pokegold/home/init.asm:79-86`, `pokegold/home/random.asm:1-29` | STRUCTURAL |
| the high byte is written on the frame whose `hRandomSub` equals it, the low byte and the LID one frame later, 13 frames after the accepting poll (Gold/Silver); `trainer_card.asm` prints big-endian | `REVIEW.md` section 5 (`gen2tid trace`, offsets 0-13 `0 NOROLL`, `1-8 C9FF/EEA4`, `9-12 9976/E0E0`, `13 4211/B1F8`) | EMPIRICAL |
| the Lucky ID: `LoadOrRegenerateLuckyIDNumber` rolls two `Random` only if SRAM `sLuckyNumberDay != wCurDay+1` (`wCurDay` is 0 after the WRAM clear) and writes `sLuckyNumberDay = 1` plus the LID to SRAM right there, without a save; first LID byte = `hRandomSub` after the second `Random` | `pokegold/engine/menus/intro_menu.asm:225-248`; `pokecrystal/engine/menus/intro_menu.asm:312-336`; SRAM `sLuckyNumberDay`/`sLuckyIDNumber` = bank 0 `$AC68`/`$AC69` (all three syms) | STRUCTURAL + EMPIRICAL (trace) |
| addresses read by the harness: G/S `wPlayerID $D1A1`, `wLuckyIDNumber $D9E9`, `wMoney $D573`, `wMenuDataPointer $CEBD`, `MainMenu.MenuData 01:5A9F`; Crystal `wPlayerID $D47B`, `wLuckyIDNumber $DC9F`, `wSecretID $D84A`, `wMoney $D84E`, `wMenuDataPointer $CF86`, `MainMenu.MenuData 12:5D1C`; roll trigger `wMoney == 00 0B B8` (`START_MONEY` 3000, written after the LID in `_ResetWRAM`) | `pokegold.sym`, `pokesilver.sym`, `pokecrystal.sym`; `gen2tid.cpp:59-63` | STRUCTURAL |

### The boot path with START held, and the 4-frame poll

| fact | where | label |
|---|---|---|
| the splash polls `JoyTextDelay` every frame and any button skips it; `pokegold/engine/movie/splash.asm:14` zeroes `hJoyDown`, which guarantees an edge for a START held since power-on; the intro movie polls the same way from its first frame; the title accepts START or A by LEVEL on its first `TitleScreenMain` frame (Crystal after a 28-frame scroll-in) | `pokegold/engine/movie/splash.asm:86-90,14`, `pokegold/engine/movie/intro.asm:15-19`, `pokegold/engine/menus/intro_menu.asm:968-1000` (Up+B+Select = clear save `pokegold/engine/menus/intro_menu.asm:987-989`); `pokecrystal/engine/menus/intro_menu.asm:1138-1200` | STRUCTURAL |
| the main menu polls once every 4 frames: `MainMenuJoypadLoop` calls `SetUpMenu`, which sets `_2DMENU_DISABLE_JOYPAD_FILTER_F`, so `_ScrollingMenuJoypad`'s `.loopRTC` exits after ONE poll and goes back through `Move2DMenuCursor; WaitBGMap` (4 `DelayFrame`s); A/B edge-triggered via `hJoyPressed`, START masked by `wMenuJoypadFilter` | `pokegold/engine/menus/main_menu.asm:142-152`, `pokegold/home/menu.asm:479-485,35-48`, `pokegold/engine/menus/menu.asm:190-234,236-247,185`, `pokegold/home/tilemap.asm:3-10`, `pokegold/home/joypad.asm:106-155`; `pokecrystal/engine/menus/main_menu.asm:240-252`, `pokecrystal/home/menu.asm:523-529` | STRUCTURAL (`REVIEW.md` m2 adds the `SetUpMenu` citation: `pokegold/engine/menus/menu.asm:190-234` alone would imply per-frame polling) |
| START-hold plateaus (any START-down frame in the range opens the menu on one fixed frame, 0-based harness frames from power-on incl. the GBP stall): Gold GBP/GBC 0-355 -> detector 446; Silver 0-355 -> 448; Gold DMG 0-545 -> 627 (split at 347/348, two tables); Silver DMG 0-545 -> 629; Crystal GBP/GBC 0-407 -> 522. Negative control: hold one frame past the plateau slides the menu (356 -> 447, 408 -> 523, 546 -> 628) and agrees on 0 of 2400 offsets | `logs/hold_*_0-3600.txt`, `logs/plateaus_summary.txt`, `REVIEW.md` section 1 | EMPIRICAL |
| the menu box becomes VISIBLE 4 frames after the detector on every configuration (brightness 255 -> 243 at detector + 4: 450/452, 631/633, 526); CSV offsets are relative to the detector, a human anchoring on the visible menu uses `v = offset - 4` | `logs/menu_visibility.txt` (`gen2tid menutl`, all 10 configurations) | EMPIRICAL |
| bins (offset = frames after the detector at which A goes down, tap 4-8 frames): Gold/Silver `offset 0 -> dropped; 1..8 -> bin 0; else bin = (offset - 5) // 4` (599 bins, bin 598 = 2397-2399); Crystal `offset <= 1 -> dropped; 2..9 -> bin 0; else (offset - 6) // 4`. Visible-menu form: G/S `v in -3..4 -> bin 0`, then `bin k = v in 4k+1..4k+4`; Crystal `v in -2..5 -> bin 0`, then `4k+2..4k+5`. Asserted on every row of all 162 tables by `make_csv.py` and again by `tools/gen-gen2-data.py` and `tests/gen2_reference.py` | README "Shiny Solution integration"; 597 of 599 bins per table exactly 4 wide (`logs/analysis_primaries.txt`) | EMPIRICAL |
| press frame = menu detector + 1 + offset; the roll frame is constant inside a bin: `menu + roll_base + 4·bin (+1 on ~1.5 % of bins: menu-loop slips)`, `roll_base` = 22 (G/S: first accepted A-down frame at detector + 9, roll 13 after it) / 24 (Crystal: detector + 10, roll 14 after it). The Crystal CSV headers state the first poll as 533 with the roll 13 later, the harness's other frame convention; the minimum press-to-roll gap in the rows (13 G/S, 14 Crystal) is convention-free | every CSV's `frame convention` header line and `roll_frame - press_frame` distribution; measured across all 162 tables by the generator (`roll_slips`) | EMPIRICAL |
| buffered A: A held from any frame between the title's poll and the menu's first poll lands in bin 0 | `logs/bufa_gold_gbp.txt` | EMPIRICAL |
| releasing START after the menu is harmless as long as it is up before the A tap (0-60 frames after the menu with A at offset 100, 0-240 with A at 400: one TID each); the original `release_..._d100.txt` rows "release 120/240" are a harness artefact (the press was delayed), marked in the log | `logs/release_gold_gbp_hf0_d{100,400}_fixed.txt`; `REVIEW.md` m7 | EMPIRICAL |
| what the runner sees: GBP/GBC: CGB boot logo 1-165, handoff 186, black 218-242, copyright text 243-347, Game Freak logo would start 355, title 398-401 (Silver 400-403); Crystal copyright 255-359, title 449-479. DMG: white 1-73, boot logo 74-333, handoff 334, white 334-434, copyright 435-536, GF logo 545, title 587-590. GBP power-on is NOT an observable anchor (disc boot, GBA->CGB stall); the harness's frame 0 includes gambatte's 485808-sample stall (`gambatte.cpp:230-231`) | `logs/menu_visibility.txt` (no-input and START-held timelines) | EMPIRICAL |
| DMG split: hold frames 0-347 and 348-545 give two byte-identical-within, different-between tables that differ by one DIV step on every bin (Gold offset 100 `A410` vs `A50F`); the boundary is 14 frames after the boot logo vanishes, so "press START when the logo disappears" lands on either side. Mechanism: the tables first differ in `hRandomSub` (+1) at `hVBlankCounter = 03`, the first VBlank after `InitSGBBorder`'s SGB-detection window (frames 347-395, interrupts disabled), a one-time event at the `ei` consistent with a pending joypad interrupt. No CGB split (holds 0/178/355 identical on GBP and GBC). The two DMG tables coincide in the 140-511-day brackets (days200/260/300/450), in days512 and in every halted state except halt-days700, and differ on every bin in days0, the carry brackets days700/780/850/1000 and halt-days700 (measured: the generator's identical-table grouping and the equal-bin count per state, `rtc.dmg_identical_states` / `rtc.dmg_equal_bins`, checked against the CSVs in both engines' vectors; the source README's "all halt states" is not exact) | `logs/dmg_subplateau_{coarse,fine}.txt`, `logs/platform_compare.txt`; `pokegold/engine/gfx/color.asm:762-797`, `pokegold/home/init.asm:148`; `REVIEW.md` m3 | EMPIRICAL (mechanism INFERRED) |
| platforms differ: GBP vs GBC (same CGB boot ROM, GBA flag on/off) share the TID high byte on 1635 of 2399 Gold offsets and the low byte on 0; DMG is unrelated to both; Gold vs Silver on GBC: 0 equal TIDs. Only 45 of 2396 Gold and 41 of 2396 Silver (platform, bin) entries share a TID with another platform's primary, so a typed TID normally also identifies the platform; the tool asks anyway | `logs/platform_compare.txt`, `inversion_summary.txt` `primaries_days0_all_platforms` | EMPIRICAL |

### Held input changes Gold/Silver IDs (REVIEW.md M1)

| fact | where | label |
|---|---|---|
| START never released, or A held 20 frames: the TID differs from the table on 248 of 2399 offsets (10.3 %) and the LID on 1103 (46.0 %) for Gold GBP; Gold GBC 160 / 1155; Gold DMG 199 / 964; Gold DMG late-start 199 / 960; Silver GBP 380 / 1228; Silver GBC 220 / 1120; Silver DMG 592 / 1055; Silver DMG late-start 592 / 1051; Crystal GBP and GBC 0 / 0 (SID 0). The TID change is +/-1 in one byte | `logs/heldinput_summary.txt`; per-offset rows in `sweeps-fix.tar.gz` (`held_*`) | EMPIRICAL |
| tap-length sweeps, every offset, START released at the detector: 4-8-frame taps reproduce every table on every offset (4-7-frame taps miss the first poll on 1-4 bin-0 offsets, counted NOROLL); a 9-frame tap changes the TID on 81 (Gold GBP) / 94 (Silver GBP) / 46 (Gold DMG) / 152 (Silver DMG) offsets; 13 frames on 293 / 377 / 199 | `logs/heldinput_summary.txt` | EMPIRICAL |
| the sensitive window: at Silver GBP offsets 101-103 the result changes as soon as the tap is still down 7 frames after the accepting poll; at Gold GBP offset 100 a tap through poll+11 is still fine and poll+12 is not; which frames matter is a per-bin property (the DIV phase), so the only rule that holds for every bin is the worst case: **nothing may be down from 7 frames after the accepting poll until the roll**. START-release scans: START down a few frames past the accepting poll is tolerated in the sampled bins (`same for rel 96-113; DIFFERENT for 114-120` at Gold offset 100) | `logs/scan_summary.txt`, `logs/scan_{alen,startrel}_*.txt` | EMPIRICAL |
| **rule (Gold/Silver, all platforms)**: release START, then tap A for 4-8 frames (67-134 ms at 59.7275 fps), and press nothing until the New Game roll is over (about 0.35 s after the tap). Crystal: immune, but the same tap length is what selects one bin | every CSV's `VALID ONLY IF (held input)` header line; carried into every methodology's `validity` and `protocol` in `gen2-tid.json` | EMPIRICAL |
| structural correlate: pokegold's `IE_DEFAULT` enables the joypad interrupt (handler `Joypad::` is a bare `reti`); pokecrystal's omits it. The cycle-level path is not traced | `pokegold/constants/ram_constants.asm:358` (`pokecrystal/constants/ram_constants.asm:392`), `pokegold/home/joypad.asm:1-6` | INFERRED |

### The Lucky ID's three conditions (REVIEW.md M2)

| fact | where | label |
|---|---|---|
| the LID column applies only to the FIRST New Game after "clear save data" (Up+B+Select on the title, `EmptyAllSRAMBanks`, zero-fill) or on a never-started cartridge; a later New Game returns the earlier LID unchanged; the TID column applies to every New Game. Controls: `sLuckyNumberDay = 01` with `sLuckyIDNumber = 1234` planted: `gold gbp off 100 -> E83B,1234` (TID unchanged), `day2 -> E83B,519A` (re-rolled); two boots with SRAM kept: `boot2 TID=BC66 LID=519A` (returned), with `EmptyAllSRAMBanks` between: `LID=F504` (= the table); same on Silver GBP, Gold DMG, Crystal GBP. The harness tables are the cleared case (gambatte's fresh SRAM is 0xFF, `initstate.cpp:415`, `READONLY_SAV`) | `logs/sram_luckyday_control.txt`, `logs/twoboot_lid_persistence.txt`; `pokegold/engine/menus/empty_sram.asm:1-19` | EMPIRICAL |
| the held-input rule above | | EMPIRICAL |
| the LID survives to the Radio Tower lottery only if the in-game day is Sunday (`wCurDay == 0`) when `ResetLuckyNumberShowFlag` runs: it calls the same routine, which re-rolls unless `sLuckyNumberDay == wCurDay+1`, and the New Game left 1 | `pokegold/engine/events/specials.asm:321-326` (the only other caller, grep) | STRUCTURAL, **not measured** |
| LID 01001 = Kenya's fixed OT ID, which is why the glitchless route wants it | `pokegold/engine/pokemon/move_mon.asm:1` `DEF RANDY_OT_ID EQU 01001` (checked in `~/AI/pret/pokegold`) | STRUCTURAL |

### RTC dependence of Gold/Silver (REVIEW.md M3)

| fact | where | label |
|---|---|---|
| pokegold runs `StartClock` (`pokegold/home/init.asm:123`) BEFORE the LCD is switched on (`pokegold/home/init.asm:140`); `StartClock` -> `_FixDays` -> `FixDays` loops `sub 140` once per 140 days, takes the day-high-bit branch at 256, calls `SetClock` and `RecordRTCStatus` when >= 140, so its cycle count moves the LCD (every VBlank DIV sample) relative to DIV. Bracket edges are the loop counts: 0-139 skip; 140-255 two `.mod` iterations; 256-279 `.modh` 1 + `.modl` 1; 280-395 1+2 and 396-419 2+1 (same cost, one bracket: 395/396/419 all `F32E`); 420-511 2+2. pokecrystal switches the LCD on (`pokecrystal/home/init.asm:131`) before `StartClock` (`pokecrystal/home/init.asm:143`) and clears `rIF` before `ei` (`pokecrystal/home/init.asm:155-159`): immune | `pokegold/engine/rtc/rtc.asm:91-101,103-115`, `pokegold/home/time.asm:61-120,205-250`; `pokecrystal/home/init.asm:131,143,155-159` | STRUCTURAL |
| Gold GBP offset 100: 0 s to 139 days -> `E83B`; 140-255 -> `1D0C`; 256-279 -> `0818`; 280-419 -> `F32E`; 420-511 -> `DE4E`; with the carry bit (>= 512 days) the five brackets recur on days mod 512 (`25F8`, `58C8`, `4FDE`, `2EF4`, `170A`); every edge confirmed at offsets 100 and 777 incl. `139 d 23:59:59` -> the 140-day value (the day is evaluated when `StartClock` runs, ~1.5-2 s after power-on); h/m/s have no effect inside a bracket; Silver the same; Crystal 0/100/139/140/200/512 days give one row | `logs/rtc_scan_gold_gbp_*.txt`, `logs/rtc_gold_gbp.txt`, `logs/rtc_scan_crystal_silver_gbp_d100.txt`; `REVIEW.md` section 4 | EMPIRICAL |
| the ten running-clock states (`days0` = the primary table; `days200/260/300/450` = 140-255 / 256-279 / 280-419 / 420-511; `days512/700/780/850/1000` = the same with the carry) exist on GBP, GBC, DMG and DMG-late-start: 72 bracket tables, one full sweep each plus a 20-offset spot re-derivation from a second hold frame (20/20 in every header; `make_csv.py` refuses to write a table whose spot check disagrees). Every bracket table differs from its platform's day-0 primary on all 2399 offsets | `rtc-brackets/*-rtc-days*.csv`, `logs/rtc_bracket_compare.txt`, `logs/rtc_offset100.txt` | EMPIRICAL |
| a HALTED clock (DH bit 6) is an eleventh family: set through the core's `<rom>.rtc` sidecar (`Cartridge::loadSavedata`, `mem/cartridge.cpp:379-447`, keeps `dh & 0xC1`; `GB::setTime` clears the halt bit, `mem/rtc.cpp:81-94`; a running-clock sidecar needs base time = now, `cartridge.cpp:406-408`), validated at table scale: sidecar `DH=00 DL=200` and `DH=80 DL=0` equal the `setTime` days200 / days512 tables on 2399/2399 offsets (Gold and Silver). 80 halted tables; every one differs from every running table of its platform; inside the family `halt-days300 == halt-days1000` and `halt-days260 == halt-days850` on every platform (2399/2399). Structural cause: with the halt bit set `_GetClock` also opens SRAM and writes `sRTCHaltCheckValue` and `_FixDays` takes `.reset_rtc`, both before LCD-on; the identity is read as the carry test saving 16 cycles = one `FixDays` loop iteration (INFERRED) | `rtc-brackets/*-rtc-halt-days*.csv`, `logs/rtc_bracket_compare.txt`, `logs/batch_completeness.txt`; `pokegold/engine/rtc/rtc.asm:117-137` | EMPIRICAL (identity's cause INFERRED) |
| what a cartridge does: the day counter is days since the battery went in (or the last write-back); `FixDays` writes it back mod 140 (`SetClock`), so brackets 140-511 are single-boot transients; the carry bit is written back unchanged and cleared only by `SaveRTC` on a save; `SetClock` clears the halt bit when it writes the clock (`res B_RAMB_RTC_DH_HALT`) and `StartRTC`, run at the end of `StartClock` on every boot (`pokegold/home/init.asm:123` -> `StartClock` -> `StartRTC`, `pokegold/engine/rtc/rtc.asm:100,13-22`), clears it unconditionally, so a halted cartridge is halted for its FIRST boot only, whatever its day count (the next boot is `days0`, or `days512` with the carry). **After the first boot only two states remain: `days0` or `days512`** (`rtc.states[*].reachable_after_first_boot` in the data, false for every bracket 140-511 and for every halted state; the engine's two-state prior); the rule is carried into every Gold/Silver methodology's `validity` and `protocol` text. GSE and the community bruteforcer boot with gambatte's fresh clock = `days0` | `pokegold/home/time.asm:61-120`, `SetClock` `pokegold/home/time.asm:205-250`, `StartRTC` `pokegold/engine/rtc/rtc.asm:13-22`, `SaveRTC` `pokegold/engine/rtc/rtc.asm:76-89` | STRUCTURAL |
| a dead-battery cartridge is unmodelled: its MBC3 registers after power loss are hardware behaviour the harness does not model; no bracket can be assigned a priori (halt bit set -> halted family; only carry -> `days512`; else a day bracket; which one only from a typed TID) | README "What a cartridge does" | — |

### Inversion (REVIEW.md M4)

| fact | where | label |
|---|---|---|
| over the ten GBP running tables: 5990 (table, bin) entries, 5714 distinct TIDs, 267 Gold TIDs with more than one candidate (543 entries = 9.1 %, max 4); Silver 260 (8.7 %, max 3); (TID, LID) pairs unique except one Silver pair `E94B/E6FE` (`gbp/days512/bin99` + `gbp/days1000/bin410`). With the two-state prior (`days0` + `days512`): 14 Gold / 12 Silver ambiguous TIDs (2.0-2.3 %, max 2), no pair collisions. All 18 GBP states: 769 / 817 ambiguous (14.7-15.7 %, max 5 / 4). DMG: the near-identical carry brackets (`days700` vs `days780`: 2247 of 2399 offsets equal; `halt-days200` vs `halt-days260`: 2279) produce hundreds of (TID, LID) collisions between those two states. Crystal (2 primaries): 13 ambiguous TIDs (2.2 %), pairs unique | `inversion_summary.txt`, `inversion-<game>.json`; recomputed by `tools/gen-gen2-data.py` (which refuses to write if any subset's numbers differ) and by `tests/gen2_reference.py`, and by both engines' `ambiguity()` in the vectors | EMPIRICAL |
| procedure (the engine's `invert`): know the platform; if the LID was typed, look up (TID, LID); else the TID with the two-state prior (`preferred`), then the ten running brackets, then the halted family only for a cartridge whose clock was halted and that has not been booted since (`StartRTC` clears the halt bit on every boot); no candidate: wrong platform (SGB, 3DS VC, header-renamed ROM), a dead-battery state, or a violated protocol: ask for a second boot. Identical tables are one candidate: `key` is the table that carries the payload (for a DMG late-start scope that can be the `dmg` table), `table` the first in-scope table (the one to show), `members` every in-scope (platform, state). An unknown platform, family or RTC state id, a non-integer or out-of-range ID, a SID for a game without one, or a NaN / infinite correction, spacing, reset delay or measured time throws (`ValueError` / `ArgumentException`) in both engines, so "no candidate" always means the IDs are absent from the tables in scope; for RTC-immune Crystal any valid state id scopes to its one table | README "Recommended inversion procedure"; `tests/gen2_reference.py` `inversionScope` / `reachable` cases and the NaN checks in both runners | — |

### Community validation (a different protocol, the same boot)

| fact | where | label |
|---|---|---|
| Gold Any% backup collision 09705 (`25E9`): `gold_gfwait_wait112(opt)_backout3_newgame` (pastebin ZF4QX7Ya), START held in the 687-706 "gfwait" plateau, W = 448 -> `25E9`; all 13 published neighbours in order for W = 424..472 step 4: `BDAA F0CA CA28 9BA1 7E10 C5FD 25E9 62EE 8A22 627E 32F2 D398 4869`; hold 710 gives `8EFD`; GBC `2DE4`, DMG `F05E`. Silver (HEXruHKq): 707-726 plateau, W = 216 -> `25E9` and its 13 neighbours | `logs/psr_gold_reproduction.txt`, `logs/psr_silver_reproduction.txt`; PSR `docs/gen-2/gold-silver/main-any/gold-silver-backup-collision-route/README.md:6-11` | EMPIRICAL (GBP, RTC day 0) |
| glitchless LID pair `6F49`/`03E9` (01001): `gold_gfskip_backout3_wait216(opt)_backout1_newgame` (hold from power-on, W = 864) reproduces the pair and its twelve published neighbours; 13,132-boot search with exactly one `6F49,03E9` line. The LID comes from two sub-frame `Random` DIV reads, so this is a bit-exact check of the core's cycle timing. `REVIEW.md` records a second build reproducing all three: identical | `logs/psr_gold_lidframes_reproduction.txt`, `logs/lidsearch_hits.txt`; PSR `docs/gen-2/gold-silver/main-glitchless/resources/lid-frames.md` | EMPIRICAL |
| none of the published targets is produced by the single-press methodologies in the day-0 primaries: 09705, 55785 (`D9E9`), Gold NSC `D900`/`D3EC` (PSR `catext/nsc/README.md:3-11`), `6F49`/`03E9`, Crystal `26FB`/`186F`. The generator searched every table of every state as well (`target_sets[*].single_press_hits`): `D9E9` at Silver GBP `halt-days260`/`halt-days850` bin 457; LID `03E9` in 8 (table, bin) entries of 140-511-day or halted brackets (single-boot states, never with the published TID); 09705, `D900`+`D3EC` and `26FB`+`186F` nowhere. The Crystal pair's provenance is secondary (RNG Solution `docs/ALL_GENERATIONS_FEASIBILITY.md` section 3: glitchcity wiki / pastebin EiQzry7w, "unverified fetch"; the PSR Crystal route only links an "LID Manip" video) | `logs/analysis_primaries.txt`; `gen2-tid.json` `target_sets` | EMPIRICAL |

### Cue model (the engine)

| constant | value | source |
|---|---|---|
| frame rate, one frame | 4194304 / 70224 = 59.7275 Hz, 16.7427 ms | as Gen 1 (`gen1tid.js`, reused) |
| A window of bin k (visible-menu-relative, Gold/Silver) | frames `4k+1..4k+4` (bin 0: `-3..4`); Crystal `4k+2..4k+5` (bin 0: `-2..5`) | the bin function |
| aim | the centre of the bin's offset range (`4k+6.5` detector-relative = `v = 4k+2.5`; bin 0 `4.5`, bin 598 `2398`) | README "Aim for the middle of a bin" |
| A cue time | menu anchor: `aim_v / FPS - correction`; power-on / reset: `visible_menu / FPS (+ reset extra) + aim_v / FPS - correction`; refused when it would fall before the anchor / the menu | `scheduleGen2` |
| tap | 4-8 frames = 67.0-133.9 ms; roll settle 0.35 s | M1 |
| hold beeps, menu marker, count-in, A cue tones | the Gen 1 tones (660/80, 990/40 twice 80 ms apart at the VISIBLE menu = "release START", 880/60, 1320/150); count-in clearance 0.5 s after the menu | `gen1tid.js` |
| default corrections | menu 200 ms, power-on / reset 100 ms (as Gen 1; starting points the calibration replaces) | `gen2-tid.json` `defaults` |
| reset anchor | GSE in GBP mode only: the Gen 1 `gbp-fade` model's fade + stall (2.1752 s) added to every power-on time | `gen1-tid.json` `reset_models`, `Timeline.java` `resetExtraSeconds()` |
| power-on anchor on a handheld GBA | INFERRED: the harness's frame 0 includes gambatte's 13.8-frame GBA->CGB stall; a real GBA's power-on-to-CGB-boot delay is not measured | `platforms.gba` |
| calibration | Gen 1's sample arithmetic over bin centres: implied = used + (aim(hit) - aim(aimed)) × 16.7427 ms; the 60-frame (15-bin) outlier guard applied in bins (`isOutlierBins`; `gen1tid`'s `addSample` checks whole-frame offsets, so it is not the guard here) and Gen 1's duplicate guard unchanged; `sampleFromHit` inverts the typed (TID, LID) on the platform under the two-state prior and takes the candidate nearest the aim | `gen1tid.js` `impliedCorrection`, `isDuplicate`, `meanCorrection`; `gen2tid.js` `isOutlierBins` |
| verify | measured seconds from the VISIBLE menu box to the press -> `offset = s × FPS + 4` -> bin, against the bins that produce the typed IDs (consistent within ±1 bin); no press-to-visible lag exists for Gen 2 (no hardware sample) | `verify` |

### Not derived

SGB2 / Super Game Boy path; 3DS Virtual Console; Crystal 1.1 and the header-renamed ROM copies
(`Gold.gbc` 58f8fcf1…, `Crystal.gbc` 7a859a1e…: the title bytes feed the CGB boot ROM's palette /
checksum logic); Crystal's `setopt` scripts and the old 55785 route (input sequence unknown); the Sunday
LID condition on a cartridge; a real MBC3's dead-battery register state; the held-input and DMG-split
mechanisms at the instruction level; **any hardware sample of any Gen 2 configuration**.

# Gen 4 (Nintendo DS)

## The seed

Verified in all three decomps (`pokeheartgold/include/gf_rtc.h:46-51` + `src/main.c:281-284`,
`pokeplatinum/src/main.c:306-315`, `pokediamond/arm9/src/main.c:239-249`):

```
seed = ((month*day + minute + second) << 24) + (hour << 16) + (year - 2000) + vblankCounter
```

with natural u32 overflow (no masks in code; the folklore byte-masks are emergent).
`vblankCounter` is the "delay": frames since power-on at 59.8261 fps. The same seed value
initializes BOTH the LCRNG and the Mersenne Twister — two independent streams.

## The generators

- LCRNG: identical constants to Gen 3 (`0x41C64E6D` / `0x6073`, top 16 bits out) —
  `pokeheartgold/src/math_util.c:70-74`. Used for PIDs, IVs, encounters, Chatot pitch,
  Elm calls, roamers. Advances strictly per use — there is no per-frame advance.
- Mersenne Twister (textbook MT19937, init 1812433253) — `pokeheartgold/src/math_util.c:80-119`. Used for
  TID/SID and the DPPt Poketch Coin Toss.
- ARNG (`*0x6C078965 + 1`): Masuda-method rerolls, Mystery Gift. Not used by this tool yet.

## TID/SID

Decomp-proven in Platinum and HGSS (DP inferred, its new-game path is still asm): on New
Game the RNG is re-seeded at the end of the intro/naming sequence, one MT output goes to the
record-mix seed, and the SECOND MT output is the full 32-bit trainer ID — TID = low 16 bits,
SID = high 16 (`pokeplatinum/src/game_start.c:144-172`,
`pokeheartgold/src/overlay_36.c:186-202`). TID manip therefore targets the seed hit at that
moment, not the title-screen seed.

## Starters and gifts

Classic Method 1 on the LCRNG — the same four calls as Gen 3 (PID low, PID high, IV word 1,
IV word 2), MT not involved (`pokeheartgold/src/pokemon.c:188-243`,
`pokeplatinum/src/pokemon.c:405-476`). HGSS rolls all three starters at scene launch in
order Chikorita (+1..+4), Cyndaquil (+5..+8), Totodile (+9..+12); DPPt rolls at the
give-script after the briefcase choice. Shiny rule: `(SID^TID^PIDhi^PIDlo) < 8`
(`pokeheartgold/src/pokemon.c:68-70`).

## Seed verification

- DPPt Poketch Coin Toss: each flip is one MT output, `& 1`, 1 = Heads
  (`pokeplatinum/src/applications/poketch/coin_toss/main.c:158`) — drains the Twister
  without consuming any LCRNG advances, making it the perfect seed check.
- HGSS Elm calls: each call is one LCRNG advance, `hi16 % 3` → E/K/P
  (`pokeheartgold/.../phone_scripts_prof_elm.c:84-86`) — but the 3-way E/K/P branch is
  effectively **postgame only**: it requires ≥8 badges, game clear, the S.S. Ticket, the
  Everstone received from Elm (`FLAG_GOT_EVERSTONE_FROM_ELM`, `:54,76`), AND the Pokérus flag. Before the Pokérus flag it is a **2-way E/K** on
  the same draw (`:86`); the other 2-way draw, after the Everstone before 7 badges (`:59`), starts
  at `PHONE_SCRIPT_014`, so its two calls are the egg-hatch-time and hatched-moves talks, not the
  evolution/Kanto ones. Active roamers eat advances first. Mid-game players will not see the 3-way
  sequence, so use the Coin-Toss check (DPPt) or Chatot instead where possible.
- Chatot: pitch derives from `rand16 % 8192` (`sound_chatot.c`), one advance per cry.
- Journal "+2 per entry" is empirically documented by the community but has no LCRNG call in
  Platinum's journal code — treat as empirical, not decomp-proven.

## Timing

The timer implements EonTimer's gen4 model (MIT source): calibration_ms =
ms(calibratedDelay) − calibratedSecond·1000; phase2 = ms(targetDelay) − calibration;
phase1 = targetSecond·1000 + calibration + 200 − ms(targetDelay), padded by whole minutes to
≥ 14 s; misses recalibrate by the delay delta (×0.75 within 10 frames). NDS slot-1 runs at
59.8261 fps. The "+1 year = −1 delay" trick follows from the seed formula's
`(year − 2000) + delay` term.

That paragraph describes `core/gen4.js` / `Gen4Timer`, which keeps every term unrounded. EonTimer
itself rounds the calibrated second to whole frames and every frame→ms conversion to whole ms
(half-to-even), so its phases differ from `gen4.js` by up to half a frame (measured 7.489 ms on
the 600/50/500/14 defaults, 8.044 ms max over 25 random NDS parameter sets, see the
[Timer models](#timer-models-eontimer-port) section). The exact EonTimer arithmetic lives in
`core/timers.js` / `app/Core/Timers.cs`; the webapp still runs `gen4.js` unchanged.

## Gen 4 seed-to-time and reversal (`core/seedtime4.js` / `SeedTime4.cs`)

The tool layer over the seed formula, for the reachability-first search the design asks for
(RNG_GUIDE_DESIGN.md sections 5.3, 5.4, 6.2). Every function exists in both languages with
the same ordering and return values; PokeFinder is the oracle for the tool conventions, the decomps
for the mechanics, PKHeX for the reversal algorithm.

### The inverse of `seed()` (STRUCTURAL from the formula; ordering EMPIRICAL from PokeFinder)

- `seed = ((month*day + minute + second) << 24) + (hour << 16) + (year - 2000) + delay`
  (`pokeplatinum/src/main.c:306-315`; `pokeheartgold/src/main.c:281-284` with
  `include/gf_rtc.h:46-51`), `delay` = `gSystem.vblankCounter`, the VBlanks since boot
  (`main.c:136-150`). So the top byte is `month*day + minute + second` mod 256, byte 2 is the hour,
  and the low 16 bits are `delay + (year - 2000)`.
- `seedToTimes(seed, year)` lists every (month, day, minute, second) whose sum matches the top byte,
  in month/day/minute/second order (PokeFinder's `SeedToTimeCalculator4::calculateTimes`,
  `Core/Gen4/Tools/SeedToTimeCalculator4.cpp:24-56`), with the hour and delay that decompose the
  low 24 bits at the smallest non-negative delay: hour = the hour byte and
  `delay = low16 - (year - 2000)` when that is >= 0. A year past `2000 + low16` means the console's
  sum carried into the hour byte, so the real time is hour byte - 1 at delay + 65536 (`E80E0001` in
  2018 is 13:57:59 at delay 65519, not 14:57:59 at delay -17); when the hour byte is 0 no clock hour
  reaches the seed in that year and the list is empty. An hour byte above 23 is PokeFinder's rule and
  the same decomposition: hour 23 with `(byte - 23) * 0x10000` moved into the delay (`:30-32`); the
  strict option drops such seeds instead. PokeFinder itself keeps hour = byte in the carry case and
  wraps the delay to a u32 (a delay no console reaches); `pokefinderDelay` reproduces that
  convention, which three of its four `calculateTimes` cases are written in (hour byte 0 in
  2025/2050/2075); all four (34 + 168 + 89 + 53 rows) reproduce bit for bit. The hardware
  decomposition is checked against a brute force over every clock time with delay 0..65535 through
  `gen4.seed` (6 cases in both harnesses, including the carry, the hour-byte-0 empty list and the
  hour-overflow case that lies beyond the brute force's range).
- The year is a delay knob: `+1 year = -1 delay` for the same seed, so a seed with low 16 bits
  `efgh` is reachable at any delay in `efgh - 99 .. efgh` (years 2099..2000) down to 0; past that
  the carry moves the time to the previous hour at delay + 65536 (`seedsToTimes` applies the same
  rule), or to nothing when the hour byte is 0.

### The neighbour table and its verification strings

`calibrateRows(seed, k, s, game)` is PokeFinder's `calibrate` (`SeedToTimeCalculator4.cpp:58-105`):
second offset `-s..+s` outer (a row whose date falls before 2000-01-01 is skipped; one past
2099-12-31 wraps to 2000-01-01, `Core/Util/DateTime.cpp:196-208`), delay offset `-k..+k` inner,
each row's seed from `Utilities4::calcSeed` (bytes truncated before the shift, u32 wrap; a delay
offset below 0 keeps PokeFinder's u32 wrap, so the row re-seeds but is not a reachable event). A
caller-supplied target is checked: a real date in 2000..2099, a clock hour, a delay 0..0xFFFFFF.
Each row carries the game's check:

- DPPt coin flips: 20 MT outputs, `& 1`, 1 = Heads, formatted `H, T, ...`
  (`pokeplatinum/src/applications/poketch/coin_toss/main.c:158`, `MTRNG_Next() % 2`;
  PokeFinder `Utilities4::coinFlips`). Drains the MT only: zero LCRNG advances.
- HGSS Elm calls: one LCRNG advance each, `hi16 % 3` -> E/K/P
  (`pokeheartgold/src/application/pokegear/phone/scripts/phone_scripts_prof_elm.c:84`). The 3-way
  branch needs 8 badges, the game clear, the S.S. Ticket, the Everstone and the Pokerus flag
  (`:66-84`); without the Pokerus flag it is `% 2` on the same draw (`:86`), as it is after the
  Everstone before 7 badges (`:59`). `elmWays: 2` produces that string. The letters name the draw
  (E = 0, K = 1, P = 2), not a fixed message: `:84`/`:86` start at `PHONE_SCRIPT_020`, whose
  messages are evolution / Kanto / Pokerus (`phone_script_defs.c:190-240` maps the scripts to
  `msgdata/msg/msg_0716.gmm` rows 27, 29, 31), while `:59` starts at `PHONE_SCRIPT_014`, whose two
  messages are the egg-hatch-time and hatched-moves talks (rows 15, 17) - so before 7 badges E and K
  mean those. `ELM_LEGEND` / `ElmLegend` carries both readings. PokeFinder's `getCalls` format
  (skipped roamer calls in parentheses, 20 calls after them) is reproduced.
- HGSS roamers: when a saved game is continued, every active roamer re-rolls its route from the
  LCRNG before the player has control, in the order Raikou, Entei, Latias, Latios: the continue task
  `FieldTask_ContinueGame_Normal` (`pokeheartgold/src/field_warp_tasks.c:355-379`, case 0) calls
  `sub_02067BE8`, a thunk at `asm/unk_02067A60.s:212-220` (`Save_Roamers_Get`, then
  `Save_RandomizeRoamersLocation`), which is `src/field_roamer.c:123-130` looping the active roamers
  of `include/constants/roamer.h:4-7` (two more thunks re-roll on the warps at
  `field_warp_tasks.c:633` and `:744`). The draw (`:236-254`): `LCRandom() % 16` into the Johto
  table for Raikou/Entei, `% 25` into the Kanto table for Latias/Latios, retried while it equals the
  roamer's current map or the player's last map (`:118-121` passes `PlayerLocationHistoryGetBack`);
  tables `:24-69`: Johto 29-39, 42-46, Kanto 1-22, 24, 26, 28. Those calls come before the Elm
  calls, so the row reports the routes and the number of skipped calls. PokeFinder's model (`Core/Gen4/HGSSRoamer.cpp`) retries against the
  previous route only (the player is assumed to be off the roamer maps); the port does the same and
  its routes are checked against the decomp's tables, not against PokeFinder's arithmetic.
- Chatot: one LCRNG advance per cry, pitch from `hi16 % 8192` (`pokeplatinum/src/sound_chatot.c:80`,
  `pokeheartgold/src/sound_chatot.c:59`). The five bands are PokeFinder's scale,
  `(rand % 8192) * 100 >> 13` at 20/40/60/80 (`Core/Gen4/States/State4.hpp:49`,
  `Core/Util/Utilities.cpp getPitch`): EMPIRICAL as a readout convention.

### Advance costs (`planAdvances`)

| Tool | Advances | Label | Where |
|---|---|---|---|
| Chatot cry | +1 | STRUCTURAL | `pokeplatinum/src/sound_chatot.c:80`; `pokeheartgold/src/sound_chatot.c:59` |
| 128-step friendship cycle | +1 per party member | STRUCTURAL | step counter wraps at 128 then every party mon is updated (`pokeplatinum/src/overlay005/field_control.c:759-760,871`), one `LCRNG_Next() & 1` per mon (`src/pokemon.c:2637-2641`; `pokeheartgold/src/pokemon.c:2037`) |
| Elm call | +1 | STRUCTURAL | `phone_scripts_prof_elm.c:59,84,86`, only on the story states that roll |
| Poketch coin flip | 0 | STRUCTURAL | `pokeplatinum/src/applications/poketch/coin_toss/main.c:158`, MT only |
| Journal page flip (DPPt) | +2 | EMPIRICAL | community convention; no LCRNG call in `pokeplatinum/src/journal.c` |
| Battle end | >= 1 | STRUCTURAL | the Pokerus roll (design 5.3); the per-battle count is not modelled |

The planner is greedy in the caller's tool order (default walk, journal, Chatot) and reports the
remainder no listed tool covers.

### The reversal (PKHeX algorithm, GPL-3 compatible)

- `ivsToSeeds(hp, atk, def, spa, spd, spe)`: `PKHeX.Core/Legality/RNG/Algorithms/LCRNGReversal.cs:36-41,
  77-106` (constants `:14-23`, lattice bounds from StarfBerry's `LCG_Recovery.py`). Returns every
  state R with `hi15(next(R))` = IV word 1 and `hi15(next(next(R)))` = IV word 2, i.e. the state one
  call before the IV1 call (Method 1's PID-high state), each with its top-bit twin (bit 15 of an IV
  word is never observed). `ivsToSeedsSkip` is `LCRNGReversalSkip.cs:34-39, 75-100` (a VBlank call
  between the two IV words: Method 4), same return semantics. `pidToSeeds(pid)` is
  `LCRNGReversal.cs:50-68` and returns the state before the PID-low call, i.e. the seed whose frame 0
  has that PID (empty for about 10% of PIDs where the bounds disagree).
- PokeFinder's `LCRNGReverse` returns the IV1 state / the PID-low state (one step later); its
  `Test/RNG/lcrngreverse.json` cases (6 IV, 2 PID) reproduce through `prev()`.
- Counts: with 30 of 32 bits fixed an IV set has 4 seeds on average; the flawless set has 6 Method 1
  states and 4 Method 4 states (the design's numbers, RNG_GUIDE_DESIGN.md:781-782, reproduced).
- `core/generators.js` (`seedsForIvWords`, `seedsForIvs`, `gen4SeedsForTarget`) and
  `app/Core/Generators.cs` keep their names and result shapes and delegate to this module's
  `seedsForIvWords` / `reachableSeeds`; the generator checks compare the two on 204 IV sets.

### The reachability search

`reachableSeeds(origins, callsBefore, maxFrame)` steps each origin back to the seed of frame 0
(`callsBefore` = 2 for IV origins, 0 for PID origins) and on to frame `maxFrame`, keeping the seeds
whose hour byte is 0..23 (24 of 256 values, so about 9.4% of back-steps). `seedsToTimes` then picks
the (year, delay) pairs inside the delay window nearest the target delay and lists the date/times;
`wantedToTimes` chains the two from IVs, a PID, or (TID, SID, shiny, nature): the shiny path
enumerates the 524,288 shiny PIDs (about 21k per nature) and reverses each. The design's gate seeds:
the flawless Method 1 state `7FFF305A` is frame 0 from seed `7B0448D1` (hour 4, delay 18641 in
2000, 2000-01-05 04:59:59) and `7FFFF961` is frame 3 from `7B0459CB` (hour 4, delay 22987 in
2000); both are found by `wantedToTimes` and re-derived forward.

`tidToSeeds(tid, year, delayMin, delayMax)` is PokeFinder's `IDSearcher4` (every hour and top byte
over the delay range, `Core/Gen4/Searchers/IDSearcher4.cpp`), using only the second MT output
(state built to word 398, one word twisted: `Core/RNG/MTFast.hpp`); PokeFinder's two `idsearcher4`
cases (100 + 76 hits) and two `idgenerator4` cases reproduce bit for bit.

### Verification

`tests/seedtime4-vectors.json` (`tools/gen-seedtime4-vectors.cjs`): 4 PokeFinder seed-to-time
cases (in PokeFinder's convention), 6 hardware-decomposition cases rebuilt by brute force over
every clock time with delay 0..65535 (the carry into the hour byte, the hour-byte-0 empty list, the
hour-overflow case beyond the brute force's range), 2 carry-through-the-search cases, 2 + 2
PokeFinder ID cases, 6 + 2 PokeFinder reversal cases, the 2 gate seeds, 500 IV and 200 PID round
trips (the generating seed present, every result regenerates the words, twins paired), 60 roamer
cases against the decomp tables, 20 Chatot sequences, 7 calibrate tables (77 rows, each re-seeded
and its string re-derived), 5 planner cases, 200 second-MT-output cases from the full generator,
and the refusal of a target that is not a real date, clock hour or delay. JS 3,306 checks, C# 3,372
checks, a JS/C# cross-check on 310 random inputs (10 of them carry cases), and negative controls
(corrupted vectors, tampered cross-check answers, and the module with its carry, target check and
legend line tampered) shown failing in both suites.

### Not measured (seed-to-time)

No DS session: the delay a console actually reaches, and whether a chosen (date, time, delay) lands
its seed on hardware, remain the hardware gate for Gen 4 seed-to-time: one DS session. The roamer model inherits PokeFinder's
assumption that the player is not standing on a roamer map at load.

# Gen 3 (Game Boy Advance)

## The RNG (the LCRNG)

One global 32-bit LCRNG. `pokeruby/src/random.c:7-13`:

```c
u32 gRngValue;
u16 Random(void)
{
    gRngValue = 1103515245 * gRngValue + 24691;
    return gRngValue >> 16;
}
```

Multiplier `0x41C64E6D`, increment `0x6073`, output = top 16 bits of the state.
`SeedRng(u16 seed)` sets the full 32-bit state to a zero-extended 16-bit seed
(`pokeruby/src/random.c:15-18`). Emerald and FRLG use the identical constants
(`pokeemerald/include/random.h:16`, `pokefirered/include/random.h:18-19`).

## When each game seeds

- **Ruby/Sapphire**: once, at boot. `AgbMain` calls `RtcInit()` then `SeedRngWithRtc()`
  (`pokeruby/src/main.c:111,115`). The seed is the RTC minutes-since-2000 count XOR-folded to
  16 bits (`pokeruby/src/main.c:201-206`, `pokeruby/src/rtc.c:367-371`).
- **Ruby/Sapphire with a dead battery**: the S-3511 RTC reports its power-failure status bit,
  `RtcCheckInfo` flags `RTC_ERR_POWER_FAILURE` (`pokeruby/src/rtc.c:169-170`), and `RtcGetInfo`
  substitutes the dummy time 2000-01-01 00:00 (`pokeruby/src/rtc.c:13,134-140`). Day count
  works out to 1, so the minute count is 1440 = **0x5A0**, and the XOR fold leaves it unchanged.
  **Every boot of a dry-battery cart seeds 0x5A0.** (Caveat: a chip that fails probing entirely
  takes a different path and reads raw hardware values; the normal dry-battery case is the
  power-failure flag.)
- **Emerald**: the RTC seeding call is compiled out (`#ifdef BUGFIX`,
  `pokeemerald/src/main.c:108-110`), so retail Emerald boots with state 0 and re-seeds from
  Timer1 only when the player-naming screen exits (`pokeemerald/src/main.c:208-213`,
  `naming_screen.c:701`).
- **FireRed/LeafGreen**: Timer1 starts at title-screen init (`pokefirered/src/title_screen.c:351`)
  and the RNG seed is latched at the *end* of the post-press cry/fade scene
  (`SeedRngAndSetTrainerId`, `title_screen.c:735`). **Correction:** that title-screen value does
  NOT survive as the TID — on a New Game the player-naming screen restarts Timer1
  (`naming_screen.c:428`) and reseeds again at naming exit (`SeedRngAndSetTrainerId`,
  `naming_screen.c:722`), overwriting it. So FRLG TID is determined by the naming-screen exit,
  not the title press; the RS "two consecutive `Random()` calls" pair model does not apply, and
  this tool does not offer FRLG/Emerald TID manip (see the Gen 3 press-windows note).

## The idle advance

`Random()` is called unconditionally in the VBlank interrupt handler, so the RNG advances
once per frame everywhere: `pokeruby/src/main.c:328`, `pokefirered/src/main.c:412`.
Emerald skips the VBlank advance only during link/frontier/recorded battles
(`pokeemerald/src/main.c:365-366`). Scripted events, wandering NPCs and battle logic consume
additional advances on top of this baseline.

## TID and SID

`NewGameInitData` → `InitPlayerTrainerId` (`pokeruby/src/new_game.c:76-79`):

```c
write_word_to_mem((Random() << 16) | Random(), gSaveBlock2.playerTrainerId);
```

Both halves come from two consecutive `Random()` calls. Evaluation order was verified by
compiling the exact expression with the in-tree agbcc (gcc 2.9-arm-000512) at -O2: the
**first** call produces the high halfword (**SID**), the **second** the low halfword
(**TID**).

## The starter is Method 1

Path: Route101 script → `ScrSpecial_ChooseStarter` → `CB2_GiveStarter` → `ScriptGiveMon` →
`CreateMon` → `CreateBoxMon` (`pokeruby/src/battle_setup.c:865-882`,
`contest_util.c:411-418`, `pokemon_1.c:1364-1455`). RNG call order:

1. `Random()` → PID low 16 bits
2. `Random()` → PID high 16 bits (`Random32()` evaluation order verified with agbcc)
3. `Random()` → IV word 1 (HP bits 0-4, Atk 5-9, Def 10-14)
4. `Random()` → IV word 2 (Spe bits 0-4, SpA 5-9, SpD 10-14)

OT ID is copied from the save block, no RNG. Nature (PID % 25), gender (PID & 0xFF vs the
species threshold, 31 for the 87.5%-male starters) and ability all derive from the PID.
A mon is shiny when `TID ^ SID ^ PID_hi ^ PID_lo < 8`.

Static overworld encounters (Rayquaza, Groudon/Kyogre, the Regis, FRLG Mewtwo...) generate
through the same `CreateMon` path into `gEnemyParty` — Method 1 again, which is why the
enemy-slot auto flow calibrates the same way the starter flow does. Wild grass instead
rolls encounter slot/level/nature and re-rolls the PID until the nature matches (the
Method H family; from Emerald onward also lead-ability dependent) — not modeled here; the
brute-force hunt covers it.

**Roamers are the exception:** the roaming Latias/Latios PID/IVs are fixed once in
`CreateInitialRoamerMon` (`pokeruby/src/roamer.c:62`) at `InitRoamer` time, not when you meet
them — the encounter just copies that fixed data into `gEnemyParty`. There is no post-press
`Random()` pair to lock onto, so `shiny("enemy")` calibration cannot work on a roamer battle
(it will report "calibration failed"). Roamers are out of scope for the enemy auto flow.

## The press windows

- **TID manip (RS):** the last user input before `InitPlayerTrainerId` runs is the A/B press
  dismissing Birch's final text box, "Come see me in my POKeMON LAB." — NOT the earlier
  "So it's PLAYER?" confirm, which is followed by two more text presses, a fixed 64-frame
  timer and the "Are you ready?" speech (`pokeruby/src/main_menu.c:1130-1319`,
  `data/text/birch_speech.inc:41-55`). From that final press everything is constant-length
  (48-frame shrink anim + two zero-delay palette fades), then `CB2_NewGame` →
  `NewGameInitData` → `InitPlayerTrainerId` (`overworld.c:1272-1277`, `new_game.c:174`).
  TID is therefore fully determined by the RNG state at the moment of that press.
- **Starter (RS):** after the YES press on "Do you choose this POKeMON?", the task switches
  callbacks with no message box, fade, or wait in between; `CreateMon` consumes the RNG on
  the very next frame (`starter_choose.c:434-445`, `battle_setup.c:871-883`,
  `contest_util.c:411-418`). The tightest press-to-RNG link in the game. Birch's rescue
  dialogue, the heal and the first battle all happen strictly after the PID is fixed.

## RAM addresses (retail English carts)

| Symbol | Ruby/Sapphire | Emerald | FireRed/LeafGreen | Provenance |
|---|---|---|---|---|
| `gRngValue` | `0x03004818` | `0x03005D80` | `0x03005000` | RS proven from checked-in sym files; E/FRLG derived via the same COMMON-section walk and matching community values |
| `gSaveBlock2` | `0x02024EA4` | via ptr `0x03005D90` | via ptr `0x0300500C` | RS proven (linker walk from `sym_ewram.txt`, annotated in `pokeruby/include/global.h:841`); E/FRLG pointers derived from proven object order anchored on `gRngValue` |
| `playerTrainerId` offset | `+0x0A` | `+0x0A` | `+0x0A` | proven from `struct SaveBlock2` (`pokeruby/include/global.h:843-846`) |
| `gPlayerPartyCount` | `0x03004350` | `0x020244E9`* | `0x02024029`* | RS proven (`sym_common.txt:140`, u8, then ALIGN(16) pads 0x03004354–0x0300435F before `gPlayerParty`); *E/FRLG values are derived, not decomp-proven |
| `gPlayerParty` | `0x03004360` | `0x020244EC` | `0x02024284` | RS proven (`sym_common.txt:140-141` walk, cross-validated on `gMain`/`gRngValue`); E/FRLG derived, byte-consistent with declaration order in `src/pokemon.c` |
| `gEnemyPartyCount` | `0x030045B8` | — | — | RS proven (`sym_common.txt:142`, precedes `gEnemyParty`) |
| `gEnemyParty` | `0x030045C0` | `0x02024744` | `0x0202402C` | RS proven (`sym_common.txt:141-143`: follows `gPlayerParty`+600 and `gEnemyPartyCount`+4, ALIGN(16)); E/FRLG derived from the same party-block adjacency |

The Lua auto-flow does **not** read `gPlayerPartyCount` (its address is easy to mis-derive as
`gPlayerParty-4`, forgetting the 12 bytes of `ALIGN(16)` padding). Instead it finds the first
party slot whose personality is 0 (an empty slot) and watches that — robust across all Gen 3
games and unaffected by the count byte's exact location. A `struct Pokemon` is 100 bytes;
personality is at +0, OT ID at +4.

Game codes at ROM `0x080000AC`: AXVE (Ruby), AXPE (Sapphire), BPEE (Emerald), BPRE
(FireRed), BPGE (LeafGreen) — confirmed from each repo's `config.mk`/`Makefile` and the
gbafix header layout. All addresses are English-cart; German RS shifts IWRAM COMMON before
`gPlayerParty`.

The trainer ID bytes are laid out little-endian as one 32-bit word: TID low, TID high,
SID low, SID high.

**Alignment note (important for emulator reads):** `playerTrainerId` starts at
`gSaveBlock2 + 0x0A` — 2-byte aligned but not 4-byte aligned. Read TID and SID as two
separate 16-bit values (`emu:read16(base + 0x0A)` → TID, `emu:read16(base + 0x0C)` → SID). A
32-bit read at `+0x0A` is silently rotated by the GBA bus to a 4-byte boundary and returns
the wrong SID (see the corrections log at the top of this file). The mon's own OT ID at
`BoxPokemon + 4` is 4-byte aligned and is the ground-truth TID/SID the game's shiny test uses.

As a fallback for unrecognized ROMs, `scan()` locates the RNG state at runtime by finding
the IWRAM word that steps by the LCRNG each frame, and adopts it for monitoring and raw
`target()` presses. The assisted `tid()`/`shiny()` flows additionally need the save-block
and party addresses above, so they require a recognized game.

## Empirical verification (live emulator)

The model was ground-truthed against Pokémon Ruby running under libmgba 0.10.2 with the
Python bindings (`tests/harness/`):

- Every observed post-seed state transition follows the LCRNG (1138/1138 frame transitions
  in the traced window; a 3254-frame run to New Game had zero untracked jumps).
- The advance rate is exactly 1 per frame through the intro, title, menus and dialogue.
  Rare bursts exist (a 2-advance frame during the intro cutscene, 3 advances on the TID
  frame itself, a 41-advance burst during the post-TID fade) — none inside the waiting
  windows the tool presses in, and the emulator script tolerates them anyway.
- TID/SID appeared at `0x02024EAE`/`0x02024EB0` as the top-16 bits of two consecutive RNG
  outputs, first = SID, second = TID, exactly as derived from the decomp.
- The press-to-generation delta for the TID flow measured a constant **74 frames** from the
  A press dismissing Birch's final text box to the `Random()` pair — the same constant the
  script measures for itself at calibration time.
- mGBA emulates a **live** RTC by default, so an emulator boot does not seed 0x5A0; the
  live-seed model reproduced bit-exactly only with Ruby's real quirks: the berry-glitch year
  loop contributes 0 days for 2000, `dayCount += day` (not day − 1), and the hour/minute
  bytes are added as **raw BCD**. The dead-battery derivation is unaffected (all-zero time,
  day count 1). This matters for the future live-battery seed-to-time feature.

## Timing constant

GBA runs at 16777216 Hz with 280896 cycles per frame = **59.7275005696 fps**. The console
timer converts advances to milliseconds with this constant; all constant offsets (console
startup, human reaction) are absorbed by the calibration loop.

## Secret ID from a typed Trainer ID (Emerald, FireRed, LeafGreen; RNG Solution `sid`)

Copied from RNG Solution's `docs/FACTS.md` (commit e105e84, unchanged through bd47f98), the source of `core/data/gen3-sid.json`
(its `platforms.json` `sid_methodologies`, generated by `tools/gen-gen1-data.py`) and of the model
ported to `core/gen1tid.js` / `app/Core/Gen1Tid.cs` (`sidCandidates`, `filterByPid`, `kFixed`,
`cueWindow`; the LCRNG is `core/rng.js` / `Lcrng.cs`). File and line references are to that repository
(`rngsolution/gen3.py`, `tests/test_gen3.py`, `tools/gba-sid-harness`); the labels are the ones in the
Gen 1 Trainer ID section above.

### Gen 3 Secret ID (Emerald, FireRed, LeafGreen): `sid`

Labels as elsewhere in this file; decomp citations are to [pret/pokeemerald](https://github.com/pret/pokeemerald)
and [pret/pokefirered](https://github.com/pret/pokefirered) at the checkouts under `~/AI/pret/` (2026-09-02;
function names are stable, line numbers are not). Methodologies `emerald/gba/typed-tid-sid-v1`,
`firered/gba/typed-tid-sid-v1`, `leafgreen/gba/typed-tid-sid-v1` (`platforms.json` `sid_methodologies`).

#### The mechanism (STRUCTURAL)

| fact | Emerald | FireRed / LeafGreen |
|---|---|---|
| Timer1 starts when the PLAYER naming screen is created | `pokeemerald/src/naming_screen.c:411-412` (`DoNamingScreen`: `if (templateNum == NAMING_SCREEN_PLAYER) StartTimer1()`) | `pokefirered/src/naming_screen.c:427-428`; also at the title screen, `pokefirered/src/title_screen.c:351` |
| the Trainer ID and the seed are the raw Timer1 count at the naming screen's exit, after the fade-out | `pokeemerald/src/naming_screen.c:696-701` `MainState_Exit` -> `SeedRngAndSetTrainerId`; `pokeemerald/src/main.c:208-214`: `val = REG_TM1CNT_L; SeedRng(val); REG_TM1CNT_H = 0; sTrainerId = val` | `pokefirered/src/naming_screen.c:717-723`; `pokefirered/src/main.c:264-270` (`gTrainerId`). The title-screen value (`pokefirered/src/title_screen.c:735`) is overwritten on every New Game |
| LCRNG | `pokeemerald/src/random.c:11-16`: `gRngValue = 0x41C64E6D * gRngValue + 0x6073`, output `>> 16`; `SeedRng`: `gRngValue = seed` | `pokefirered/src/random.c:9-17`, same constants |
| one `Random()` per VBlank | `pokeemerald/src/main.c:365-366` (skipped only in link / frontier / recorded battles) | `pokefirered/src/main.c:412` (unconditional) |
| the Secret ID roll | `pokeemerald/src/overworld.c:1532-1537` `CB2_NewGame` -> `NewGameInitData` (`pokeemerald/src/new_game.c:149-164`) -> `InitPlayerTrainerId` (`pokeemerald/src/new_game.c:84-88`): `(Random() << 16) \| GetGeneratedTrainerIdLower()` | `pokefirered/src/overworld.c:1527-1531`; `pokefirered/src/new_game.c:107-123`, `pokefirered/src/new_game.c:54-58` |
| no other `Random()` on the path | `NewGameInitData` before the roll: `RtcReset`, `ZeroPlayerPartyMons`, `ZeroEnemyPartyMons`, `ResetPokedex`, `ClearFrontierRecord`, `ClearSav1`, `ClearAllMail` draw nothing (grep of `src/rtc.c`, `pokedex.c`, `mail.c`, `frontier_util.c`, `pokemon.c` `ZeroMonData`); `main_menu.c`'s only draw is `Random() % NUM_PRESET_NAMES` at `pokeemerald/src/main_menu.c:1603`, before the naming screen; `naming_screen.c`, `palette.c`, `text.c`, `task.c`, `sprite.c`, `menu.c`, `window.c`, `bg.c`, `sound.c`, `m4a.c` contain no `Random()` | `pokefirered/src/oak_speech.c:2146,2148` draw only for the PLAYER default name, before the naming screen (`:2138-2160`); the rival presets draw nothing; `pokefirered/src/new_game.c:103` `SeedWildEncounterRng(Random())` is in `ResetMenuAndMonGlobals`, run at the title exit (`pokefirered/src/title_screen.c:737`), not on this path; `pokefirered/src/new_game.c:107-123` before the roll draws nothing |

So with **k = the number of VBlanks between the seed and the roll**,
`SID = hi16(LCRNG^(k+1)(TID))` and `TSV = (TID ^ SID) >> 3`; PokeFinder's `IDGenerator3::generateFRLGE`
(`Core/Gen3/Generators/IDGenerator3.cpp:51-69`, `PokeRNG rng(tid, initialAdvances); sid = rng.nextUShort()`)
labels the same row "advance k". The Python LCRNG (`rngsolution/gen3.py`) is checked against Shiny Solution's
`core/rng.js` on 50 vectors emitted by node (`tests/gen3_vectors.js`, fixture `tests/fixtures/gen3-lcrng-vectors.json`;
regenerated and compared in `tests/test_gen3.py` when node is present).

#### What is inside k: the presses after naming (STRUCTURAL: which waits exist; EMPIRICAL: their frame counts)

Every wait for a button on the path is a `JOY_NEW(A_BUTTON | B_BUTTON)` read: the YES/NO menus
(`pokeemerald/src/menu.c:1013-1022` `Menu_ProcessInputNoWrap`; `pokefirered/src/menu.c:342-349` `Menu_ProcessInput`) and the
text printer's three wait states, `RENDER_STATE_WAIT`, `RENDER_STATE_CLEAR` (`\p`, `CHAR_PROMPT_CLEAR` 0xFB) and
`RENDER_STATE_SCROLL_START` (`\l`, `CHAR_PROMPT_SCROLL` 0xFA, "waits for button press and scrolls"), all through
`TextPrinterWaitWithDownArrow` / `TextPrinterWait` (`pokeemerald/src/text.c:865-899,1167-1188`;
`pokefirered/src/text.c:550-585,859-875`; `pokeemerald/include/constants/characters.h:175-176`; `charmap.txt:1087-1088`). A press while the
text is still printing is not a wait press: it only zeroes the current character delay
(`pokeemerald/src/text.c:944-955` / `pokefirered/src/text.c:639-650`, `canABSpeedUpPrint`), so it is swallowed and the box is still waiting.
The earlier statement in this repo of "six paragraph presses" counted only `\p`; the `\l` scroll prompts
are presses too.

**Emerald** (`pokeemerald/src/main_menu.c:1788-1850` return from naming, `:1609-1786` the tasks; `pokeemerald/data/text/birch_speech.inc:42-61`):
YES on "So it's X?" (`:1626-1635`; NO at `:1637-1640` goes back to the gender box and re-enters naming, a new
Timer1 read), then `gText_Birch_YourePlayer` (`\p`, `\l`, `\p`) and `gText_Birch_AreYouReady`
(`\p`, `\p`, `\l`, `\p`, `\p`): **9 timed presses**. Fixed parts between them: the 16-step palette fade-in and
5-frame timer after naming, the sprite/platform fades (`NewGameBirchSpeech_StartFade*`, delay 2, 16 steps),
the 30-frame platform slide, the 64-frame `tTimer` before "are you ready?", the printing itself, and after
the last press the shrink (`sSpriteAffineAnim_PlayerShrink` 0x30 frames, `:445-448`), the fades and
`Cleanup` -> `CB2_NewGame` (`:1783`).

**FireRed / LeafGreen** (`pokefirered/src/oak_speech.c:1788-1880` return from naming, `:1460-1786` the tasks;
`pokefirered/data/text/new_game_intro.inc:218-243`): YES on "So your name is X." (`:1490-1520`; the box appears 25 frames
after the text, `:1473`), `gOakSpeech_Text_WhatWasHisName` (`\p`, `\p`), the rival name menu
(`:1413-1438`, cursor on NEW NAME; the first preset is DOWN then A; NEW NAME goes through the rival naming
screen, which neither starts Timer1 nor reseeds but adds the typing time), YES on "was it X?",
`RememberRivalsName` (`\p`), `LetsGo` (`\p`, `\p`): **8 timed presses** on the preset path (the DOWN is untimed, the A is a press) and **11** on the NEW NAME path (A on NEW NAME, then A / START / A on the rival naming screen, each a press the game must read). Fixed parts:
the 40-frame timers around the pic fades (`:1497,1529,1575`), the 30-frame slide (`:1385`), the 30-frame
`FadeOutBGM` timer (`:1600`), and after the last press the shrink (five 20-frame steps, `:1647-1672`),
the 36-frame timer, the fade and `FreeResources` -> `CB2_NewGame` (`:1784`). LeafGreen differs from
FireRed only by its first preset rival name (two boxes print it).

The text speed is read at print time in Emerald (`pokeemerald/src/menu.c:191-196` `AddTextPrinterForMessage`,
`GetPlayerTextSpeedDelay`) and cached when the Oak speech starts in FRLG (`pokefirered/src/oak_speech.c:761`,
`GetTextSpeedSetting`, `pokefirered/src/new_menu_helpers.c:27-32,658-664`: delays 8 / 4 / 1 for slow / mid / fast; a fresh
cartridge is MID, `SetDefaultOptions` via `Sav2_ClearSetDefault`, `pokeemerald/src/intro.c:1152-1156`,
`pokefirered/src/title_screen.c:737-741`). The name is printed by two boxes on each game's path, so the fixed
part is linear in the name length (measured: 8 / 4 / 1 frames per letter at SLOW / MID / FAST).

#### Measured frame counts (EMPIRICAL: mGBA 0.10.5 headless, byte-exact ROMs; hardware unverified)

Two harnesses over the RetroBridge mgx shim (`~/AI/Games/RetroBridge/embedded/shim`, `libmgx.so`, libmgba 0.10.5),
ROMs `pokeemerald.gba` sha1 `f3ae0881…`, `pokefirered.gba` `41cb23d8…`, `pokeleafgreen.gba` `574fa542…` (pret's hashes):

* `tools/gba-sid-harness` (the committed harness; the numbers below are its `results/*.json`, 101 runs, `results/summary.csv`;
  `make_registry.py` writes them into `platforms.json` and `tests/test_gen3.py` checks the two agree): symbol
  addresses from byte-exact agbcc builds of the decomps (`gRngValue` Emerald `0x03005D80`, FRLG `0x03005000`;
  `gSaveBlock2Ptr` `0x03005D90` / `0x0300500C`, `playerTrainerId` at +0x0A, `include/global.h`), each verified
  in-run (the RNG dword must step by the LCRNG on eight boot frames; a 4-byte-wrong address and the wrong ROM
  both abort, `controls.log`). The seed frame is the frame `TM1CNT_H` drops from 0x80 to 0 with `gRngValue`
  equal to `sTrainerId` (the 16-bit seed); the roll frame is the frame `playerTrainerId` is written. Every
  press is scripted on the first frame the game's own state accepts it (the YES/NO task, printer 0 in
  `RENDER_STATE_WAIT` / `CLEAR` / `SCROLL_START`, FR's rival-menu task, the rival naming screen's
  `HANDLE_INPUT`), held for two frames and read back from `gMain.newKeys`: a main-loop iteration that
  overruns a frame has no pad read in it, so a one-frame press set for that frame is never seen (observed
  on LeafGreen's rival menu, four runs: the press was read a frame late; a human's held A is read at the
  next iteration, which is what is recorded). A stage of several presses (DOWN then A; A / START / A on
  the rival naming screen) chains each press two iterations after the previous one was READ.
* `/tmp/gen3sid` (the savestate binary-search harness, not committed): memory reads only, each press's first accepted frame found by
  binary search from a savestate with a one-frame-earlier negative control at every stage (never
  accepted). It measured the Emerald mid 4-letter row kept below, and the 24 frames from the A on OK to
  the seed (every run).

In every run the observed Secret ID equals `hi16(LCRNG^(k+1)(TID))` at the frame-counted k (checked at
k +/- 3 by the savestate harness; from the step counter read at the write frame by the committed harness, whose
per-frame trace shows exactly one LCRNG step on every frame of the span and two on the roll frame), and
the all-earliest Secret IDs are inverted from k = 0 in `tests/test_gen3.py`. Slope test: every press d
frames late moves k by exactly d x the press count (d = 0 / 10 / 60 on every path and text speed; the
two harnesses agree to the frame on every row both measured: Emerald mid 1645 / 1693, fast 680 / 692;
FireRed preset 1781 / 1829, 866 / 878; LeafGreen preset 1765 / 1813, 862 / 874). k is independent of
the Trainer ID (six different seeds, same k). Text speed: Emerald's is settable from the main menu's
OPTION entry (a control through the real menu gives the same k as writing `SaveBlock2.optionsTextSpeed`:
680 = 680, 2937 = 2937); FRLG's main menu has no OPTION (`pokefirered/src/main_menu.c:23-35`) and the Oak
speech caches the speed at its start (`pokefirered/src/oak_speech.c:761`), so a fresh save is MID and fast / slow were
measured by writing the option at the main menu (as options carried over from a save would be). A held
A: A held 8 or 30 frames at every press gives the same k as one-frame taps (savestate harness, review run);
only a press while the text prints arms `hasPrintBeenSpedUp` (`pokeemerald/src/text.c:944-955`).

`d_i` below = frames from the previous press (the seed frame for press 1) to press i, the press frame
included; the preset stage is DOWN, one idle frame, A (the A is the timed press); the name-length rows
differ only on the two boxes that print the player's name (1 / 4 / 8 frames per letter at fast / mid /
slow). The 4-letter rows lie exactly on the 1-to-7 line (`tests/test_gen3.py`).

**Emerald, Birch's speech after naming (9 presses)** (OK press -> seed: 24 frames; 9 timed presses)

| press | mid, 1-letter | mid, 4-letter | mid, 7-letter | fast, 1-letter | fast, 7-letter | slow, 1-letter | slow, 4-letter | slow, 7-letter |
|---|---|---|---|---|---|---|---|---|
| 1. YES on 'So it's X?' | 53 | 65 | 77 | 23 | 29 | 93 | 117 | 141 |
| 2. 'Ah, okay!' paragraph end | 136 | 136 | 136 | 109 | 109 | 172 | 172 | 172 |
| 3. '...hometown of LITTLEROOT.' scroll prompt | 208 | 220 | 232 | 52 | 58 | 416 | 440 | 464 |
| 4. 'I get it now!' paragraph end | 66 | 66 | 66 | 20 | 20 | 130 | 130 | 130 |
| 5. 'All right, are you ready?' paragraph end | 267 | 267 | 267 | 189 | 189 | 371 | 371 | 371 |
| 6. '...to unfold.' paragraph end | 176 | 176 | 176 | 44 | 44 | 352 | 352 | 352 |
| 7. '...where dreams,' scroll prompt | 252 | 252 | 252 | 63 | 63 | 504 | 504 | 504 |
| 8. '...and friendships await!' paragraph end | 146 | 146 | 146 | 40 | 40 | 290 | 290 | 290 |
| 9. 'Come see me in my POKeMON LAB.' paragraph end | 264 | 264 | 264 | 66 | 66 | 528 | 528 | 528 |
| last press -> Secret ID roll | 77 | 77 | 77 | 74 | 74 | 81 | 81 | 81 |
| **k_fixed** (sum) | **1645** | **1669** | **1693** | **680** | **692** | **2937** | **2985** | **3033** |
| seed -> Secret ID of the all-earliest run | $10ED -> $577E | $C896 -> $9884 | $3A0D -> $06A9 | $10ED -> $19E8 | $3A0D -> $0BB4 | $10ED -> $8C87 | $CD2D -> $2339 | $3A0D -> $A462 |

**FireRed, NEW NAME rival, 1-letter name 'A' as in the PSR route (11 presses)** (OK press -> seed: 24 frames; 11 timed presses)

| press | mid, 1-letter | mid, 4-letter | mid, 7-letter | fast, 1-letter | fast, 7-letter | slow, 1-letter | slow, 7-letter |
|---|---|---|---|---|---|---|---|
| 1. YES on 'Right... So your name is X.' | 157 | 169 | 181 | 82 | 88 | 257 | 305 |
| 2. 'This is my grandson.' paragraph end | 196 | 196 | 196 | 136 | 136 | 276 | 276 |
| 3. '...since you both were babies.' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| 4. A on NEW NAME | 150 | 150 | 150 | 63 | 63 | 266 | 266 |
| 5. A on the naming screen's A key | 63 | 63 | 63 | 63 | 63 | 63 | 63 |
| 6. START | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| 7. A on OK | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| 8. YES on '...Er, was it X?' | 138 | 138 | 138 | 96 | 96 | 194 | 194 |
| 9. 'His name is X!' paragraph end | 176 | 176 | 176 | 44 | 44 | 352 | 352 |
| 10. 'X!' paragraph end | 128 | 140 | 152 | 119 | 125 | 140 | 188 |
| 11. '...about to unfold!' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| last press -> Secret ID roll | 464 | 464 | 464 | 272 | 272 | 720 | 720 |
| **k_fixed** (sum) | **1868** | **1892** | **1916** | **977** | **989** | **3056** | **3152** |
| seed -> Secret ID of the all-earliest run | $959B -> $0BFF | $4860 -> $343F | $9C27 -> $B92B | $530E -> $B3E8 | $5B8A -> $7A32 | $3AC4 -> $BCB2 | $4CA6 -> $4E93 |

**FireRed, preset rival name, DOWN then A on the name menu (9 presses)** (OK press -> seed: 24 frames; 8 timed presses)

| press | mid, 1-letter | mid, 4-letter | mid, 7-letter | fast, 1-letter | fast, 7-letter | slow, 1-letter | slow, 7-letter |
|---|---|---|---|---|---|---|---|
| 1. YES on 'Right... So your name is X.' | 157 | 169 | 181 | 82 | 88 | 257 | 305 |
| 2. 'This is my grandson.' paragraph end | 196 | 196 | 196 | 136 | 136 | 276 | 276 |
| 3. '...since you both were babies.' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| 4. when the name menu appears press DOWN once | 152 | 152 | 152 | 65 | 65 | 268 | 268 |
| 5. YES on '...Er, was it X?' | 100 | 100 | 100 | 46 | 46 | 172 | 172 |
| 6. 'His name is X!' paragraph end | 192 | 192 | 192 | 48 | 48 | 384 | 384 |
| 7. 'X!' paragraph end | 128 | 140 | 152 | 119 | 125 | 140 | 188 |
| 8. '...about to unfold!' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| last press -> Secret ID roll | 464 | 464 | 464 | 272 | 272 | 720 | 720 |
| **k_fixed** (sum) | **1781** | **1805** | **1829** | **866** | **878** | **3001** | **3097** |
| seed -> Secret ID of the all-earliest run | $959B -> $6B65 | $4860 -> $8554 | $9C27 -> $0F1D | $530E -> $67C4 | $5B8A -> $2705 | $3AC4 -> $44A9 | $4CA6 -> $31EB |

**Leafgreen, NEW NAME rival, 1-letter name 'A' as in the PSR route (11 presses)** (OK press -> seed: 24 frames; 11 timed presses)

| press | mid, 1-letter | mid, 4-letter | mid, 7-letter | fast, 1-letter | fast, 7-letter | slow, 1-letter | slow, 7-letter |
|---|---|---|---|---|---|---|---|
| 1. YES on 'Right... So your name is X.' | 157 | 169 | 181 | 82 | 88 | 257 | 305 |
| 2. 'This is my grandson.' paragraph end | 196 | 196 | 196 | 136 | 136 | 276 | 276 |
| 3. '...since you both were babies.' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| 4. A on NEW NAME | 150 | 150 | 150 | 63 | 63 | 266 | 266 |
| 5. A on the naming screen's A key | 63 | 63 | 63 | 63 | 63 | 63 | 63 |
| 6. START | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| 7. A on OK | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| 8. YES on '...Er, was it X?' | 138 | 138 | 138 | 96 | 96 | 194 | 194 |
| 9. 'His name is X!' paragraph end | 176 | 176 | 176 | 44 | 44 | 352 | 352 |
| 10. 'X!' paragraph end | 128 | 140 | 152 | 119 | 125 | 140 | 188 |
| 11. '...about to unfold!' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| last press -> Secret ID roll | 464 | 464 | 464 | 272 | 272 | 720 | 720 |
| **k_fixed** (sum) | **1868** | **1892** | **1916** | **977** | **989** | **3056** | **3152** |
| seed -> Secret ID of the all-earliest run | $95DB -> $0B48 | $48A0 -> $AA4E | $9C67 -> $A2F5 | $52C0 -> $77C4 | $5B2C -> $C702 | $3AE5 -> $BD72 | $4CC7 -> $74A1 |

**Leafgreen, preset rival name, DOWN then A on the name menu (9 presses)** (OK press -> seed: 24 frames; 8 timed presses)

| press | mid, 1-letter | mid, 4-letter | mid, 7-letter | fast, 1-letter | fast, 7-letter | slow, 1-letter | slow, 7-letter |
|---|---|---|---|---|---|---|---|
| 1. YES on 'Right... So your name is X.' | 157 | 169 | 181 | 82 | 88 | 257 | 305 |
| 2. 'This is my grandson.' paragraph end | 196 | 196 | 196 | 136 | 136 | 276 | 276 |
| 3. '...since you both were babies.' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| 4. when the name menu appears press DOWN once | 152 | 152 | 152 | 65 | 65 | 268 | 268 |
| 5. YES on '...Er, was it X?' | 92 | 92 | 92 | 44 | 44 | 156 | 156 |
| 6. 'His name is X!' paragraph end | 184 | 184 | 184 | 46 | 46 | 368 | 368 |
| 7. 'X!' paragraph end | 128 | 140 | 152 | 119 | 125 | 140 | 188 |
| 8. '...about to unfold!' paragraph end | 196 | 196 | 196 | 49 | 49 | 392 | 392 |
| last press -> Secret ID roll | 464 | 464 | 464 | 272 | 272 | 720 | 720 |
| **k_fixed** (sum) | **1765** | **1789** | **1813** | **862** | **874** | **2969** | **3065** |
| seed -> Secret ID of the all-earliest run | $95DB -> $CDDD | $48A0 -> $E241 | $9C67 -> $7B2F | $52C0 -> $FC38 | $5B2C -> $F982 | $3AE5 -> $E2A0 | $4CC7 -> $CCD0 |

LeafGreen's preset rival is RED (3 letters) against FireRed's GREEN (5): two boxes print it, so the preset
rows differ by 16 (mid) / 4 (fast) / 32 (slow) frames; the NEW NAME rows are identical in the two games. Mashing
A every 2 / 10 frames from the seed on (blind, which also speeds the printing) gives, at MID: Emerald 1009 / 1487,
FireRed NEW NAME 1273 / 1709, preset 1171 / 1619, LeafGreen 1273 / 1709, 1163 / 1599 (`RESULTS.md`; an earlier
version of the harness let the mash's A collide with the scripted rival presses and mislabelled those rows).

So `k = k_fixed(path, text speed, name length) + the lateness of every press`, where a press's lateness is how
many frames after its box's first accepted frame it landed, and only presses on a waiting box count (a
swallowed press adds nothing and the box keeps waiting). `k_fixed` for an unmeasured name length is the
line through the measured lengths (`gen3.stage_press_to_press`).

#### The cue (INFERRED design on the EMPIRICAL constants)

`sid --cue` anchors on the A press on OK and beeps each press `margin` frames (default 30) after its box's
first accepted frame, assuming the previous press was on its beep. Because the roll is a fixed count after
the LAST press, k depends only on that press: `k = k_fixed + n x margin + (lateness of the last press)`,
provided every earlier press landed after its box was ready and before the next beep. The printed window
is `[k - 6, k + 20]` frames (`--early-frames`, `--late-frames`), i.e. 27 candidates instead of the 1201 of
the default un-cued range; a pin then picks one. The audio path and reaction time are the same as the Red
cue's (a beep is heard about 200 ms before the finger lands), which is why the window is asymmetric. On the
FRLG preset path the DOWN is not cued: press it any time after the name menu appears and before the beep
(a DOWN before the menu is lost, and the A alone would pick NEW NAME, the cursor default).

#### Pins

A PID seen to be shiny under this Trainer ID allows exactly 8 Secret IDs (`(TID ^ SID ^ PID_hi ^ PID_lo) < 8`,
`gen3.shiny_sids_for_pid`); a PID seen not to be shiny excludes those 8. Pins are stored in
`~/.rng-solution/config.json` under `sid_pins/<methodology>/<Trainer ID>` and never applied to another
methodology or Trainer ID (a pin is a fact about one save). Negative controls in `tests/run-tests.sh`:
the worked example's shiny PID pinned as NOT shiny drops the true row; a vector with a corrupted state
fails the LCRNG parity check.

#### Not measured (Secret ID)

A `B` press instead of `A` (B on the name box answers NO and re-rolls the Trainer ID; B is also accepted by
the text waits); a rival name longer than one letter on the NEW NAME path (it prints in two boxes, so 4
frames per letter at MID like the player's, INFERRED); the GIRL player (BOY throughout); Japanese and other
languages (different text, different counts); real hardware (the counts are whole-VBlank counters in the
game code, so a discrepancy would mean an emulation error, not a timing one).

# Timer models (EonTimer port)

All EMPIRICAL: these are the formulas the RNG community's timer uses, not game code. Source of
truth is EonTimer (MIT, https://github.com/DasAmpharos/EonTimer), `main` @
`ad10886d83bc455ad208c82925610c642d9e8864` (2026-04-20, the React/TypeScript rewrite; the
project went Kotlin `2.x` → C++ `3.x-cpp` → Python `3.x-python` → TS). Ported function-for-function
into `core/timers.js` and `app/Core/Timers.cs` with EonTimer's operation order kept, and verified
by `tests/timer-vectors.json` (469 vectors, every expected value computed by running EonTimer's
own TS; 47 of them are the literal assertions of its Python unit tests at
`3.x-python` @ `13d15f72`, which the TS reproduces exactly) plus a 200-parameter-set JS/C#
cross-check (`tests/timer-parity.json`, also recomputed by EonTimer's TS with 0 mismatches).
Both vector checkers (`tests/test-timers.cjs`, `app/Tests/TimerChecks.cs`) fail outright on an
empty vector array, on a vector count that disagrees with the file's own `count` header, or when
the negative-control vector `default-gen4-phases-NDS_SLOT1` is absent.
Paths below are inside the EonTimer repo.

License: EonTimer's MIT notice is reproduced in `THIRD_PARTY_NOTICES.md` at the repo root.
`main` @ ad10886 ships no LICENSE file — its `README.md:74` links a `LICENSE.md` that exists only
on the `2.x` and `3.x-cpp` branches (Copyright (c) 2019 dylmeadows) and on `3.x-python`
(Copyright (c) 2019 DasAmpharos); the notice reproduced is `origin/3.x-python:LICENSE.md`.

## Console frame rates

| Console | fps | ms/frame | EonTimer |
|---|---|---|---|
| GBA | 16777216 / 280896 = 59.72750057 | 16.742706298828125 | `src/utils/constants.ts:23,27`; console switch `src/timers/calibrator.ts:40-41` |
| NDS slot-1 (DS cart) | 59.8261 | 16.71511263478649 | `constants.ts:24,28`; `calibrator.ts:45-47` |
| NDS slot-2 (GBA cart in a DS) | 59.6555 | 16.76291372966449 | `constants.ts:25,29`; `calibrator.ts:42-43` |
| DSi, 3DS | = slot-1 (59.8261) | | `calibrator.ts:44-47` (`case Console.DSI: case Console.THREE_DS:` fall into slot-1) |
| Custom | user fps; 0 throws | 1000 / fps | `calibrator.ts:48-53` |
| (unknown) | falls back to slot-1 | | `calibrator.ts:54-55`; `core/timers.js` looks consoles up as own properties so `Object.prototype` keys such as `"constructor"` count as unknown (vectors `unknown-console-constructor-*`) |

The exact ratio for GBA is TS-only: the Python (`eon_timer/settings/timer/model.py:8`) and C++
(`src/models/Console.cpp:8`) branches use 59.7275, and the 2019 Kotlin branch used 59.7271
(`model/settings/Console.kt:6`). `core/timers.js` takes GBA from `rng.js` (`GBA_FPS`) and slot-1
from `gen4.js` (`NDS_FPS`), so the three engines share one constant each. The RNG guide design
doc (`RNG-Solution/docs/RNG_GUIDE_DESIGN.md:805`) lists the same table — slot-2 59.6555, DSi/3DS =
slot-1 — with GBA as the 59.7275 shorthand.

## Rounding

`roundHalfToEven` (`calibrator.ts:15-36`): floor/ceil, and if the two distances agree within
`Number.EPSILON × max(1, |v|)` the even neighbour wins ("match the desktop timer's C#
`Math.Round(decimal)` midpoint-to-even"). Applied by `toDelays(ms) = rhe(ms / msPerFrame)`
(`:59-61`) and `toMilliseconds(frames) = rhe(msPerFrame × frames)` (`:63-65`), so every
frame↔ms conversion is a whole number. The Python tests pin the ties: 1.5→2, 2.5→2, 3.5→4
(`test/timers/calibrator_test.py:14-18`). The C# port uses 2^-52 explicitly (`double.Epsilon`
is the smallest denormal, not machine epsilon).

`precisionCalibration` (default off, `src/store/index.ts:124`): when on, calibration values are
kept in ms (`calibrateToMilliseconds` returns the value unchanged, `calibrateToDelays` rounds to
whole ms, `calibrator.ts:67-75`); when off they are stored in whole frames
(`toDelays`/`toMilliseconds`).

`createCalibration(frames, seconds) = toMilliseconds(frames − toDelays(seconds × 1000))`
(`calibrator.ts:77-83`): the calibrated second is quantised to whole frames *before* the
subtraction — this is the half-frame gap between EonTimer and `gen4.js`.

## Phase constants

| Constant | Value | EonTimer |
|---|---|---|
| Minimum phase length | 14000 ms, `while (value < min) value += 60000` | `src/utils/constants.ts:4,6-11`; user-configurable in seconds since #189 (`store/index.ts:127`, ×1000 in each panel) |
| Minutes before target | `floor(Σ finite phases / 60000)` | `constants.ts:13-20`; computed with calibration 0 (`gen4Timer.ts:25-29`, `gen5Timer.ts:53-72`) |
| Second-timer offset | +200 ms | `src/timers/secondTimer.ts:8` |
| Second-hit correction | (target − hit)×1000 − 500 if hit < target; + 500 if hit > target; 0 if equal | `secondTimer.ts:11-18` |
| Delay-hit close threshold | 167 ms | `src/timers/delayTimer.ts:5` |
| Delay-hit factors | ×1.0 normally, ×0.75 when \|Δ\| ≤ 167 ms | `delayTimer.ts:6-7,30-33` |
| Entralink phase-1 pad | +250 ms | `src/timers/entralinkTimer.ts:14` |
| Entralink advance rate | 0.837148929 advances/s (phase 3 = advances / 0.837148929 × 1000 + frameCalibration) | `entralinkTimer.ts:4,43` |
| Variable-target open phase | `Infinity` until "Set Target Frame" injects `toMilliseconds(frame) + calibration` | `frameTimer.ts:29-31`, `Gen3Panel.tsx:96-100`, worker `timerWorker.ts:111-151` |
| Action cue pattern | `count` (6) cues `interval` (500 ms) apart ending at every phase end | `store/index.ts:113-119`, `src/workers/timerWorker.ts:19-30,43` |

## Models

- **Frame (Gen 3 Standard)**: `[preTimer, toMilliseconds(targetFrame) + calibration]`
  (`frameTimer.ts:4-19`). Calibrate from a frame hit: `calibration += toMilliseconds(target −
  hit)` (`frameTimer.ts:21-27`, applied `Gen3Panel.tsx:68-73`). Defaults 5000 / 1000 / 0
  (`store/index.ts:149-154`). **Variable Target**: `[preTimer, ∞]` (`gen3Timer.ts:21-22`).
- **Delay (Gen 4)**: `calibration = createCalibration(calibratedDelay, calibratedSecond)`
  (`gen4Timer.ts:12-14`); `phase1 = toMinimumLength(toMinimumLength(second×1000 + calibration +
  200) − toMilliseconds(delay))`, `phase2 = toMilliseconds(delay) − calibration`
  (`delayTimer.ts:9-22`). Calibrate from a delay hit: `Δ = toMilliseconds(hit) −
  toMilliseconds(target)`, ×0.75 if \|Δ\| ≤ 167 else ×1.0, then `calibratedDelay +=
  toDelays(Δ)`; a hit of 0 is ignored (`delayTimer.ts:24-34`, `gen4Timer.ts:31-40`,
  `Gen4Panel.tsx:45-50`). Gen 4 always rounds to whole frames — it bypasses
  `precisionCalibration`. Defaults 600 / 50 / 500 / 14 (`store/index.ts:142-147`).
- **Second (Gen 5 Standard)**: `[toMinimumLength(second×1000 + calibrateToMilliseconds(cal) +
  200)]` (`secondTimer.ts:3-9`, `gen5Timer.ts:24,29`); calibrate `cal +=
  calibrateToDelays(secondHit rule)` (`gen5Timer.ts:96-103`; every Gen 5 mode's deltas are
  applied in `Gen5Panel.tsx:63-74`).
- **C-Gear (Gen 5)**: the Delay model with `calibrateToMilliseconds(cal)`; calibrate from the
  delay hit only (`gen5Timer.ts:31,104-111`).
- **Entralink (Gen 5)**: Delay phases, then `+250` on phase 1 and `− calibrateToMilliseconds
  (entralinkCalibration)` on phase 2 (`entralinkTimer.ts:6-17`). Calibrate: second hit → `cal`,
  delay hit → `entralinkCalibration`, each only when the hit differs from its target
  (`gen5Timer.ts:112-125`). **Entralink+** adds the advances phase and `frameCalibration +=
  (targetAdvances − advancesHit) / 0.837148929 × 1000` (`entralinkTimer.ts:27-49`,
  `gen5Timer.ts:126-133`). Defaults: calibration −95, entralink 256, frame 0, delay 1200,
  second 50, advances 100 (`store/index.ts:132-140`).
- **Custom**: per phase `unit ∈ {ms, advances, hex}`, `value + calibration` with advances/hex
  first through `toMilliseconds` (`customTimer.ts:10-18`); calibrate `calibration +=
  toMilliseconds(target − hit)` (ms unit: `target − hit`) (`customTimer.ts:20-29`, applied per
  phase in `CustomPanel.tsx:104-110`).

## Community starting calibrations (not in EonTimer's code)

−95 is EonTimer's own Gen 5 default (`store/index.ts:134`, also `3.x-python
eon_timer/timers/gen5/model.py:18`, Kotlin `Gen5TimerConstants.kt:6`). The −424 "3DS"
calibration named in the RNG guide design appears in **no** EonTimer branch (grepped `main`,
`2.x`, `3.x-cpp`, `3.x-python`); it is carried as `GEN5_COMMUNITY_CALIBRATION["3DS"]` /
`Gen5CommunityCalibration3ds` for the guide's use, source not recorded, re-measure per console.

## Where Shiny Solution's shipped timers differ from EonTimer

- `core/gen4.js` `timerPhases` / `Gen4Timer.Phases`: no rounding anywhere (`calibration =
  ms(cd) − cs×1000` instead of `toMilliseconds(cd − toDelays(cs×1000))`); measured gap 7.489 ms
  on the defaults, ≤ 8.044 ms over 25 random NDS sets, bound half a frame + 1 ms; the 14 s
  minimum is fixed rather than a setting. `calibrate` returns fractional frames
  (EonTimer: whole frames, half-to-even) and accepts a hit of 0 (EonTimer ignores it); within
  0.5 frame of EonTimer except when \|Δ\| sits within ~1 ms of the 167 ms threshold, where
  the two disagree on the ×0.75 factor.
- The webapp Gen 3 timer is a single phase from power-on (`advancesToMs(advance) + cal`, no
  pre-timer, no ms rounding); its calibration is `cal −= advancesToMs(drift)` unrounded.
- Cue pattern (`webapp/app.js:105-118`): five 1 s-spaced beeps then a long final beep on the
  last phase only, one beep at the end of earlier phases; EonTimer cues six 500 ms-spaced
  actions ending at every phase end. Variable-target (`∞`) phases and every Gen 5 mode are
  absent from the webapp.

# Gen 5 (Nintendo DS: Black / White / Black 2 / White 2)

**Status: EMPIRICAL throughout.** No Gen 5 decompilation exists (nothing under `~/AI/pret`),
so nothing in this section is read from game code. Every mechanic and constant is ported
from **PokeFinder by Admiral-Fish** (GPL-3.0, https://github.com/Admiral-Fish/PokeFinder,
commit `7adce35`; every `file:line` below is in that checkout) and cross-read against
Admiral-Fish's **RNGWriteups** (https://github.com/Admiral-Fish/RNGWriteups, `master`,
`Gen 5/Initial Seeding.md` and `Gen 5/Initial Frame.md`, fetched 2026-09-03). Engines:
`core/gen5.js` and `app/Core/Gen5.cs` (bit-for-bit twins). Vectors: `tests/gen5-vectors.json`,
built by `tests/build-gen5-vectors.py` from PokeFinder's own `Test/` JSON, the nazo table parsed
out of `Nazos.cpp`, the writeup's worked example, and Python `datetime` as an independent
weekday oracle; `tests/gen5-random.json` holds 200 random inputs answered by the C# engine
for the JS cross-check. Tests: `tests/test-gen5.cjs`, `app/Tests/Gen5Checks.cs`. Nothing here
has been validated on a DS by us (the hardware gate for Gen 5, a DS Lite calibration session, is pending).

## The RNG (LCRNG64)

`s = s * 0x5D588B656C078965 + 0x269EC3 (mod 2^64)` (`Core/RNG/LCRNG64.hpp:270`, `using BWRNG`;
writeup Initial Frame.md, `next()`). The inverse step is `s * 0xDEDCEDAE9638806D +
0x9B1AE6E9A384E6F9` (`:271`, `BWRNGR`). Two outputs: the high 32 bits (`:248-251`) and the
bounded draw `((s >> 32) * max) >> 32` (`:261-264`), which every table roll, the needle draw
and the TID/SID draw use. Jump-ahead by squaring (`:36-49` table, `:200-211`). Vectors:
`Test/RNG/lcrng64.json` (`next`, `advance`, `jump`; forward and reverse), all reproduced.

## The boot seed: SHA-1 over a 16-word message

The game hashes one 512-bit SHA-1 block whose 13 message words are (`Core/RNG/SHA1.cpp:178-192`
constructor and `:336-363` setters; writeup "Overall"):

| Word | Value | PokeFinder |
|---|---|---|
| 0-4 | The five **nazo** words for (game, language, DS type). BW: `bswap(n)`, `bswap(n+0xfc)` twice, `bswap(n+0xfc+0x4c)` twice. BW2: `bswap(n0)`, `bswap(n1)`, `bswap(n)`, `bswap(n+0x54)` twice | `Core/Gen5/Nazos.cpp:29-36` (BW), `:43-50` (BW2), table `:56-117`, lookup `:119-232` (DSi and 3DS share the DSi row) |
| 5 | `bswap((VCount << 16) \| Timer0)` | `SHA1.cpp:348` |
| 6 | `MAC & 0xffff` (the writeup XORs `0x01000000` in on a soft reset; PokeFinder does not implement that flag, this port carries it as an optional `softReset`) | `SHA1.cpp:183` |
| 7 | `(MAC >> 16) ^ (VFrame << 24) ^ GxStat` | `SHA1.cpp:184` |
| 8 | `BCD(year-2000) << 24 \| BCD(month) << 16 \| BCD(day) << 8 \| weekday`, weekday `= (JDN + 1) % 7`, **Sunday = 0** | `SHA1.cpp:50-53` (BCD), `:55-62,64-93`; `Core/Util/DateTime.cpp:66-72,88-91` |
| 9 | `BCD(hour) << 24 \| BCD(minute) << 16 \| BCD(second) << 8`, plus `0x40000000` when `hour >= 12` on a DS or DSi, **never on a 3DS** | `SHA1.cpp:95-120,356-363` |
| 10, 11 | 0 | `SHA1.cpp:187-188` |
| 12 | The **keypress word**: `0xff2f0000` minus, per held button, R `0x10000`, L `0x20000`, X `0x40000`, Y `0x80000`, A `0x1000000`, B `0x2000000`, Select `0x4000000`, Start `0x8000000`, Right `0x10000000`, Left `0x20000000`, Up `0x40000000`, Down `0x80000000` | `Core/Gen5/Keypresses.cpp:103-115`; bit order `Core/Enum/Buttons.hpp:28-48` |
| 13, 14, 15 | `0x80000000`, 0, `0x1a0`: standard SHA-1 padding for a 416-bit message | `SHA1.cpp:189-191` |

Digest to seed: after the 80 rounds (round constants `0x5a827999`, `0x6ed9eba1`, `0x8f1bbcdc`,
`0xca62c1d6` at `SHA1.cpp:124,136,148,160`; initial state `:307-311`) take `h0 = b + 0x67452301 (register rotation; `:298-299`)`
and `h1 = 0xefcdab89 + b` (`:298-299`), form `raw = bswap(h1) << 32 | bswap(h0)` (`:301`),
and **step it once**: `seed = raw * 0x5D588B656C078965 + 0x269EC3` (`:302`). That stepped value
is what PokeFinder and the community call the initial seed and what every advance count
below starts from. PokeFinder precomputes the first nine `section1Calc` calls (PokeFinder's own comment says eight) per (date, Timer0)
(`:304-334`); this port runs all 80 rounds per seed and is verified against the same vectors.

Worked example (writeup "Example"; identical to PokeFinder `Test/RNG/sha1.json` "White 1"):
White, English, DS Lite, Timer0 `0x621`, VCount `0x2f`, MAC `0x9BF123456`, VFrame 5, GxStat 6,
2000-01-01 00:00:00, no keys. Words `d0602102 cc612102 cc612102 18622102 18622102 21062f00
00003456 0509bf14 00010106 00000000 00000000 00000000 ff2f0000 80000000 00000000 000001a0`;
`h0 = 0x16a4a8f6`, `h1 = 0x9a2bb383`; `raw = 0x83b32b9af6a8a416`; **seed
`0xb082b4a755192171`**. The other seven `sha1.json` cases (Black/White/Black 2/White 2 at
00:00:00 and 12:00:00, Timer0 1544/1569/2418/2415, VCount 46/47/72/72) are reproduced too.

Which key combinations are searched: never Up+Down, never Left+Right, never the soft-reset
chord L+R+Select+Start, at most 8 buttons, optionally none with L or R (`Keypresses.cpp:35-56`,
`:83-98`); a profile enables combinations by how many buttons are held (0..8).

## Initial advances and the probability table

At boot the game burns a seed-dependent number of LCRNG steps through a probability table
(writeup Initial Frame.md: rows `[50, 100]`, `[50, 50, 100]`, `[30, 50, 100]`, `[25, 30, 50, 100]`,
`[20, 25, 33, 50]`, each roll `((s >> 32) * 101) >> 32` compared with the threshold; the
Smogon "Past Gen RNG Research" post it cites is the origin). PokeFinder's equivalent is
`advanceProbabilityTable` (`Core/Util/Utilities.cpp:29-70`: one step, then a roll per row that
continues while `roll > threshold`). Counts used by the generators:

- **BW, normal boot:** five table passes (`Utilities.cpp:283-294`).
- **BW2, normal boot:** five passes, plus 3 steps (2 with Memory Link) after the first pass,
  then up to 100 triples of `nextUInt(15)` until all three differ, 3 steps per triple
  (`:296-328`).
- **BW, new game (TID/SID):** **2 + three passes** (`:330-343`).
- **BW2, new game (TID/SID):** **10 + three passes**, with 2 uncounted steps after the first pass
  and 4 after the second (`:345-372`; the comment at `:349-354` itemises the 10 as 2 after the
  first table, 3 after the second, 1 when the main menu loads, 2 after the third, 2 right
  before Juniper appears).

For seed 0 the new-game base is 25 (BW) and 34 (BW2) (`Test/Gen5/id5.json`).

## TID / SID

`Core/Gen5/Generators/IDGenerator5.cpp:36-47`: from the new-game base above (plus the row
offset), each row is one bounded draw `rand = nextUInt(0xffffffff)`; **TID = rand & 0xffff,
SID = rand >> 16, TSV = (TID ^ SID) >> 3**. Vectors: `id5.json` seed 0, Black rows 25-34
(first TID 18185 / SID 39382) and Black 2 rows 34-43, reproduced by `idRows` / `IdRows`.
The design doc's "count of 'No' answers to Juniper adds to the index" is exposed here as the
row offset (`tidSid(seed, game, noCount)`), but **that mapping is not in PokeFinder's code**:
its ID form has only "Max Advances" (`Form/Gen5/IDs5.ui`), and the only Juniper reference is
the comment at `Utilities.cpp:354`. INFERRED from community guides, unverified here.

Timer0 ambiguity: a profile carries a Timer0 range (`Core/Gen5/Profile5.hpp:220-233`), and the
community's rule of thumb is two adjacent values on BW1 and more on BW2 (design doc 3.6,
EMPIRICAL); the typed TID after a boot picks the value that fired.

## Profile calibration: Timer0 / VCount / VFrame / GxStat from typed IVs or needles

`Core/Gen5/Searchers/ProfileSearcher5.cpp:121-160` (single-thread branch): for VFrame, GxStat,
Timer0, VCount and second in that nesting, hash the seed and keep it when a validator accepts
it; the seed-to-time search for IDs uses Timer0, then key combination, then second at a fixed
date and clock minute (`Core/Gen5/Searchers/IDSearcher5.cpp:63-90`). Validators:

- **IVs** (`ProfileSearcher5.cpp:171,177-186`): MT19937 seeded with the **high 32 bits of the
  seed**, skip 2 outputs on BW2 (0 on BW), then six outputs `>> 27` in the order **HP, Atk,
  Def, SpA, SpD, Spe** (`Core/Gen5/Generators/StaticGenerator5.cpp:29-31` `gen()`, `:67-88`
  order). PokeFinder computes this with `MTFast<8, true>` (`Core/RNG/MTFast.hpp:48-153`: the
  standard `0x6c078965` = 1812433253 initialisation at `:52-56`, and a tempering that keeps only
  the top five bits, `:72,97,131-132`) and normally serves the IVs from a precomputed per-profile
  IV cache (`Core/Gen5/IVCache.cpp`, `Profile5.hpp:112-115`). **This port computes them directly**
  from the same MT19937 as the Gen 4 engine (`ivsFromSeed`), verified against
  `Test/Gen5/profilesearcher5.json`: Black seed `0x5e89803c95fe8240` gives `[24, 4, 18, 5, 26, 0]`,
  Black 2 seed `0x490eabda126d5432` gives `[5, 4, 27, 10, 7, 17]`.
- **Needles** (`:205-229`): after the normal-boot initial advances (BW or BW2 with Memory Link),
  plus one when Unova Link is used without Memory Link, each needle is `nextUInt(8)`, with one
  extra step per needle over Unova Link. PokeFinder stores that advance count in a `u8`
  (`:207`); this port does not truncate (it would only matter if the BW2 dedupe loop ran more
  than ~64 times, probability below 1e-40). Vectors: Black `[5, 4, 0, 5]`, Black 2 Unova Link
  `[7, 4, 7, 0]`, with Memory Link `[0, 1, 0, 7]`.
- **Seed** (`:243`): equality.

## Open items (not ported, or ported with a known discrepancy)
- The writeup says the PM bit applies when the hour is "greater than 12"; PokeFinder (`SHA1.cpp:103,359`) and this port use >= 12, which the 12:00:00 vectors encode and which matches the DS RTC's 24-hour PM flag (hours 12-23). The code is right; the prose is loose, like the weekday prose above.

- **+2 / +10 vs the writeup's rounds.** RNGWriteups `Initial Frame.md` gives the new-game count
  as `1 + (2 or 3) table passes` for both BW and BW2 (`initial_frame_bw(prng, rounds)`,
  `initial_frame_bw2_id`, "2 if a save file already exists otherwise 3"), with no inter-pass
  advances; PokeFinder ships `2 + 3 passes` (BW) and `10 + 3 passes` with `advance(2)` /
  `advance(4)` between passes (BW2). This port follows PokeFinder, whose vectors it reproduces;
  the discrepancy is unreconciled and only a DS session (typed TIDs at known seeds) can settle
  which base applies with and without an existing save.
- **Weekday numbering.** The writeup's prose lists "1: Monday ... 7: Sunday", but its own worked
  `message[8] = 0x00010106` encodes Saturday 2000-01-01 as 6, i.e. Sunday = 0, which is what
  PokeFinder computes (`DateTime.cpp:90`). The vectors follow the code.
- **Soft reset.** The writeup's `^ 0x01000000` on word 6 is absent from PokeFinder; carried as an
  optional flag, exercised only in the JS-vs-C# cross-check.
- **The "No" count** is a design-doc claim, not a PokeFinder mechanic (above).
- **Korean Black 2 on DSi** uses base `0x02200770` in `Nazos.cpp:116`, the same as Korean White 2
  on a DS (`:114`); ported as found, likely a PokeFinder table slip.
- **Not ported:** PokeFinder's SIMD / SHA-extension SHA-1 paths and 8-round precompute
  (`SHA1.cpp:304-334,400-820`), the SHA-1 seed cache and IV cache files
  (`Core/Gen5/SHA1Cache.cpp`, `IVCache.cpp`), the C-Gear seed (writeup "Seed Generation (C-Gear)"),
  the multi-threaded searcher wrappers, and every encounter / egg / Dream Radar generator.
- **No hardware sample** and no emulator trace: melonDS / DeSmuME Timer0 and VCount are
  whatever the community profiles say (design doc 3.6).

# Generators (Gen 3 / Gen 4 encounter engines)

`core/generators.js` and `app/Core/Generators.cs` (identical APIs, pure functions; no data
file is read by the engines, the species and slot records of `core/data/*.json` are passed
in). Every RNG call is a decomp line (STRUCTURAL); the few EMPIRICAL items are PokeFinder
models we cannot read in code and are marked. `tools/check-generator-citations.py`
re-reads all 300 cited lines (276 decomp, 21 PokeFinder, 3 PKHeX) and fails if any drifted.
Decomp commits: pokeruby `63a8cbf`, pokeemerald `83df84e`, pokefirered `df4449a`,
pokeplatinum `7c0aa10b`, pokeheartgold `814275e`; PokeFinder `7adce35`.

## Conventions

- **Frame N** (PokeFinder's convention, `Core/Gen3/Generators/StaticGenerator3.cpp:33-38`):
  the generator starts from `jump(seed, N)`, so the first value it consumes is the (N+1)-th
  LCRNG output after the seed. A Method 1 mon at frame N uses outputs N+1..N+4.
- **LCRNG** `x = 0x41C64E6D*x + 0x6073`, output = `x >> 16` (`pokeemerald/src/random.c:11`,
  `pokeplatinum/src/math_util.c:82`, `pokeheartgold/src/math_util.c:71-73`).
- **Bounded rolls differ per game and this is load-bearing**: Gen 3 `Random() % n`;
  DPPt `LCRNG_RandMod(n) = rand / ((0xffff / n) + 1)` (`pokeplatinum/include/inlines.h:156-169`)
  except the places that spell `LCRNG_Next() % n` (surf/fish level `wild_encounters.c:967`,
  typed slot pick `:1312`, held item `pokemon.c:4681`, Unown form `:1489`); HGSS
  `LCRandRange(n) = LCRandom() % n` (`pokeheartgold/include/math_util.h:34`) everywhere.
- **PID** = `lo | (hi << 16)`, low half first: `Random32()` (`pokeemerald/include/random.h:12`),
  `pokeplatinum/src/pokemon.c:412`, `pokeheartgold/src/pokemon.c:195`. The one exception is
  the FRLG Unown loop, `(Random() << 16) | Random()`, high half first
  (`pokefirered/src/wild_encounter.c:248`; operand order is compiler output, verified for
  agbcc in the Gen 3 section above and by PokeFinder's vectors).
- **IV words**: word 1 = HP (bits 0-4), Atk (5-9), Def (10-14); word 2 = Spe, SpA, SpD
  (`pokeemerald/src/pokemon.c:2277-2296`, `pokeplatinum/src/pokemon.c:452-470`,
  `pokeheartgold/src/pokemon.c:226-239`). Result arrays use PokeFinder's order
  `[hp, atk, def, spa, spd, spe]`.
- **Methods 2 and 4** are a VBlank `Random()` (`pokeemerald/src/main.c:365-366`) landing
  between PID and IV word 1 (Method 2) or between the IV words (Method 4); the positions are
  PokeFinder's (EMPIRICAL, `WildGenerator3.cpp` `if (method == Method::Method2)` /
  `Method4`). Statics accept Method 2 too (PokeFinder's static generator only offers 4).
- Every result carries `callsUsed`, the number of LCRNG calls the creation consumed from the
  frame, so the wizard can place the next event.
- **The heads over these engines** are the web app's Wizard tab (`webapp/wizard-ui.js`, USAGE.md
  "Wanted-IVs wizard") and its desktop twin (`app/App/WizardPanel.cs` over `WizardSupport.cs`, the same
  flow, searches, cards, procedures and store split, pinned to the web module's output for its self-test
  scenarios and 20 random searches by `tests/wizard-panel-vectors.json`, emitted by
  `tools/gen-wizard-panel-vectors.cjs` and checked by `app/Tests/WizardPanelChecks.cs`). Its Gen 3 answer is a forward generation from the game's seed model
  (Ruby / Sapphire dead battery `0x5A0`, Emerald `0`, FireRed / LeafGreen a typed seed) with the
  engine's own filter, chunked to the horizon; its Gen 4 answer is the seed-to-time layer's
  back-step (below, "The reachability search") followed by the static or wild generator run on
  every candidate seed, so a Method J / K creation's slot, level, nature and PID-loop calls are
  counted by the engine and never assumed. The seed models it prints (`rs/gba/boot-seed-v0`,
  `emerald/gba/boot-seed-0-v0`, `frlg/gba/typed-seed-v0`, `dppt/nds/seed-to-time-v0`,
  `hgss/nds/seed-to-time-v0`) are EMPIRICAL / model output: no hardware session has run a wizard
  procedure. The tab's own checks: the Groudon Method 4 vector at frame 3, the Route 111 wild
  vector at frame 7, the design's gate seed `7B0448D1` at frame 0 and the Route 222 Magnet Pull
  vector's seed `5D1745D0` at frame 0 (`tests/test-webapp.cjs`, `?wizselftest`).

## Derived values

- Nature = PID % 25 (`pokeemerald/src/pokemon.c:5498-5500`).
- Gender: 0/254/255 fixed male/female/genderless, else female iff `genderRatio > (PID & 0xFF)`
  (`pokeemerald/src/pokemon.c:3471-3485`); reported 0 = M, 1 = F, 2 = none.
- Ability: bit `PID & 1` selects the second ability only when the species has one
  (`pokeemerald/src/pokemon.c:2298-2302`, `pokeplatinum/src/pokemon.c:476-483`). Results carry
  `abilityBit`, the effective `abilitySlot` and `abilityId`.
- Shiny iff `TID ^ SID ^ PIDhi ^ PIDlo < 8` (`pokeemerald/include/pokemon.h:371`,
  `pokeplatinum/src/pokemon.c:2754`). `shinyType` 2/1/0 (equal / < 8 / not) is PokeFinder's
  display split; the games only test `< 8`.
- Hidden Power: power = `40 * bit1-pack / 63 + 30`, type = `15 * bit0-pack / 63 + 1`, +1 past
  TYPE_MYSTERY (`pokeemerald/src/battle_script_commands.c:8905-8909`,
  `pokeplatinum/src/battle/battle_script.c:6025-6031`). `hiddenPower` is the 0..15 index
  (Fighting..Dark), `hiddenPowerTypeId` the decomp type id.
- Unown letter = the four PID bit pairs, mod 28 (`pokeemerald/include/pokemon.h:364-369`).
- Stats: `(2*base + IV) * level / 100 (+ level + 10 for HP, + 5 otherwise)`, nature ×110/×90
  in integers (`core/rng.js statsAtLevel`); PokeFinder's float multipliers give the same
  integers for every reachable value (the vectors compare all six stats).

## Gen 3 statics and gifts: `gen3Static`

PID lo, PID hi, [M2 skip], IV1, [M4 skip], IV2 (`pokeemerald/src/pokemon.c:2218,2277-2296`).
`buggedRoamer` (RS Latis, FRLG beasts): the roamer's IVs go through `SetBoxMonData(MON_DATA_IVS)`
which reads one byte, so only HP and the low 3 bits of Atk survive
(`pokeruby/src/pokemon_2.c:938`, `pokefirered/src/pokemon.c:3660`, stored at
`pokeruby/src/roamer.c:71`, `pokefirered/src/roamer.c:108`); Emerald reads all four bytes
(`pokeemerald/src/pokemon.c:4400`).

## Gen 3 wild Method H: `gen3Wild`

Call script from the frame, in order. Rolls marked *opt* are outside PokeFinder's frame
(it starts at the slot roll) and run only when the caller sets the option; they follow
`StandardWildEncounter` (`pokeemerald/src/wild_encounter.c:595-661`, `pokeruby:447-512`,
`pokefirered:366-440`).

| Step | Emerald | Ruby/Sapphire | FireRed/LeafGreen |
|---|---|---|---|
| new metatile *opt* | `Random()%100 >= 60` skips (`:537`) | `:429` | `:350` |
| encounter odds *opt* / rock smash always | `Random()%2880 < rate*16` (`:493,502`; bike ×80% `:504`, flutes/Cleanse Tag, cap 2880); rock smash `WildEncounterCheck(rate, TRUE)` `:680` | `:379,405-424`, rock smash `:531` | odds on the **separate** wild RNG `:304,669` (no main call); rock smash `:453` |
| roamer *opt* | `Random()%4 == 0` (`pokeemerald/src/roamer.c:216`) | `pokeruby/src/roamer.c:183` | `TryStartRoamerEncounter` |
| outbreak *opt* | `Random()%100 < probability` (`:487`) | `:371` | none |
| Feebas (fishing on Route 119) | `Random()%100 > 49` -> no Feebas (`:137`), else Feebas 20-25 (`:67,784-790`); the roll follows the map check (`:121-122`) and precedes the spot comparison, so every cast on the map spends it (`feebasMap`) and only a cast on the tile can hit (`feebasTile`; D7) | `:84-85,98` | none |
| typed slot | Magnet Pull on land, Static on land and water, nothing on rocks (`:432,440,445-446`): `Random()%2 != 0` -> no (`:947`), else `Random()%count` over the Steel/Electric slots unless none or all (`:931-934`) | none | none |
| slot | `Random()%100` over 20/20/10/10/10/10/5/5/4/4/1/1 land, 60/30/5/4/1 water and rock, 70/30, 60/20/20, 40/40/15/4/1 rods (`:182-262`) | `:144-230` | `:71-130` |
| level | `Random()%range` (`:286`); Pressure/Hustle/Vital Spirit `Random()%2 == 0` -> max, else `rand--` if nonzero (`:292-297`) | `:254` | `:172` |
| Keen Eye/Intimidate *opt* (`lead.level`) | `Random()%2 == 0` suppresses when lead level > 5 and wild level <= lead-5 (`:906`, gated by `WILD_CHECK_KEEN_EYE` `:453`) | none | none |
| Cute Charm | `Random()%3 != 0` when the species' gender is not fixed (`:397-398`), then the PID loop demands the opposite gender of the lead (`:410`, `pokeemerald/src/pokemon.c:2337-2342`) | none | none |
| Safari | one `Random()%100` (the `< 80` Pokeblock check, no block assumed: `:341`) | `:278` | none |
| nature | Synchronize `Random()%2 == 0` -> lead nature (`:371-372`) else `Random()%25` (`:378`) | `Random()%25` (`:305`) | `Random()%NUM_NATURES` (`:232`) |
| PID | `Random32()` until nature (and gender) match (`pokeemerald/src/pokemon.c:2305-2311,2340-2343`) | `:311` | `:232`; Unown: `(Random()<<16)|Random()` until the chamber letter (`:237,243-251`), no nature roll |
| IVs | IV1, IV2 with the Method 2/4 skips | same | same |

RS and FRLG have no lead effects on slot, level, nature or gender (only Stench/Illuminate on
the odds, `pokeruby:413-419`, `pokefirered:334-346`); `gen3Wild` refuses a field ability for
those games instead of applying it. Fishing slots are reported per rod list (old 0-1, good 0-2,
super 0-4) as PokeFinder does; a Feebas hit reports the inserted pseudo-slot 2/3/5, which
`feebasTile` requires (species 349) at that index of the rod table - a table without it is
refused with the requirement in the message.

## Gen 3 eggs: `gen3EggEmerald`, `gen3EggRSFRLG`

Trigger (held): the daycare step check `compatibility > Random()*100/USHRT_MAX`
(`pokeemerald/src/daycare.c:893`, `pokeruby:755`, `pokefirered:1152`). Emerald then rolls
Everstone inheritance only if the female/Ditto parent holds one: `Random() >= USHRT_MAX/2`
-> none (`:439-447`), seeds `Random2` from `vblankCounter2` (`:459`) and builds the PID as
`(Random2() << 16) | ((Random() % 0xfffe) + 1)` (`:465`) or loops `(Random2() << 16) | Random()`
until the nature matches and the PID is nonzero (`:476-481`, 2400 tries). RS/FRLG store only
the low half `(Random() % 0xfffe) + 1` (`pokeruby:364`, `pokefirered:750`).
Pickup: RS/FRLG add `Random() << 16` (`pokeruby:721`, `pokefirered:1121`); then `CreateMon`
draws IV1, IV2 (`pokeemerald:813,862`, `pokeruby:675`) and `InheritIVs` draws `%6 %5 %4`
then three `%2` parents (`pokeemerald:549-561`, `pokeruby:426-435`, `pokefirered:809-816`).
Removal bug: Emerald removes list position `i` (`:550`, fixed lists), RS/FRLG remove the
selected *value* as an index (`pokeruby:429`, `pokefirered:810`). EMPIRICAL (PokeFinder
`EggGenerator3.cpp`): the `Random2` seed model `(frame + 1 - calibration - 3*redraw) & 0xffff`,
the held `advances = frame - offset` reporting, the 17-try VBlank cut-off in the nature loop,
and the skip presets EBred {0,0,1}, EBredSplit {0,1,1}, EBredAlternate {0,0,2},
RSFRLGBred {1,0,1}, RSFRLGBredSplit {0,1,1}, RSFRLGBredAlternate {1,0,2}, RSFRLGBredMixed {0,0,2}
(iv1 skip, iv2 skip, inheritance skip). Nidoran/Illumise eggs take the male species when
bit 15 of the PID is set (`pokeemerald:784-791`).

## Gen 4 statics: `gen4Static`, `gen4StarterTriple`

- Method 1: PID lo|hi, IV1, IV2 (`pokeplatinum/src/pokemon.c:412,452-470`,
  `pokeheartgold/src/pokemon.c:195,226-239`).
- Shiny "always" (red Gyarados): `Pokemon_FindShinyPersonality` / `GenerateShinyPersonality`:
  `low = rand & 7`, `high = rand & 7`, then for each of 13 TSV bits one call decides which half
  gets the bit (`pokeplatinum/src/pokemon.c:2762-2795`, `pokeheartgold/src/pokemon.c:2132-2152`,
  called from `encounter_check.c:796`): 15 calls, then IVs.
- Shiny "never" (Manaphy egg): ARNG `x*0x6C078965 + 1` rerolls until not shiny, no LCRNG call
  (`pokeplatinum/src/overlay005/daycare.c:1130-1131`, `src/math_util.c:106`).
- Method J/K statics go through the wild creator: Cute Charm roll, Synchronize/nature, PID
  loop, IVs, then one held-item roll after the IVs (`pokeplatinum/src/overlay006/wild_encounters.c:1227-1235,1462`,
  `pokeplatinum/src/pokemon.c:4681`; HGSS `pokeheartgold/src/field/encounter_check.c:988-996,1350`); `callsUsedWithItem` counts it.
- HGSS starters are created three in a row, 4 calls each, so starter i is at frame + 4i
  (`pokeheartgold/src/choose_starter.c:55-59`); DPPt starters are single `GivePokemon` mons
  (`statics-gen4.json` creation notes).
- `call = output % 3` (E/K/P, `phone_scripts_prof_elm.c:84`) and `chatot = ((output % 8192) * 100) >> 13`
  (`pokeplatinum/src/sound_chatot.c:80`, `pokeheartgold/src/sound_chatot.c:59`; the 0..99
  scaling is PokeFinder's display) are derived from the frame's first output.

## Gen 4 wild Method J (DPPt): `gen4Wild` with `method: "J"`

`pokeplatinum/src/overlay006/wild_encounters.c`; every roll is `RandMod` (division) unless noted. The wild creator is
`CreateWildMon` (`pokeplatinum/src/overlay006/wild_encounters.c:1047-1087,1462`: the Cute Charm roll, the nature, the
PID loop and the IVs, then `AddWildMonToParty` rolls the held item).

1. Fishing: `RandMod(100) >= rate` -> no bite (`:396`); the frame still generates, reported
   `valid: false` (PokeFinder convention). Feebas: `RandMod(2) == 0` -> not a Feebas tile is the
   first statement of `PlayerAvatar_IsFacingFeebasTile` (`pokeplatinum/src/overlay006/feebas_fishing.c:37`), reached on every
   cast on Mt. Coronet B1F (`:407`, `pokeplatinum/src/map_header.c:194-196`): `feebasMap` spends it off the tile
   too and only `feebasTile` can hit (D7); on a hit the whole table is Feebas 10-20 (`:407-420`)
   and the normal slot roll (and the lead's typed check) still happens; reported as pseudo-slot
   5, which `feebasTile` requires at index 5 of the rod table.
2. Typed slot: Magnet Pull (Steel) then Static (Electric): `RandMod(2) == 0` (`:1319`) then
   `LCRNG_Next() % count` over the matching slots unless none or all (`:1308-1312`). On water
   and fishing the Magnet Pull result is overwritten by the Static check (`:1113-1115`, BUG
   comment): the calls are spent, the water roll decides.
3. Slot: `RandMod(100)` over 20/20/10/10/10/10/5/5/4/4/1/1 (`:822`), 60/30/5/4/1 surf and old
   rod, 40/40/15/4/1 good and super rod (`:853,872`).
4. Level: grass uses the slot's level; Pressure/Hustle/Vital Spirit `RandMod(2) == 0` **keeps**
   the rolled slot, otherwise the highest-level slot of the same species (`:1109-1110,1502-1509`).
   Surf/fish: `LCRNG_Next() % range` (`:967`), Pressure `RandMod(2) == 0` keeps it else max (`:971`).
5. Keen Eye/Intimidate *opt*: `RandMod(2) == 0` suppresses when wild level <= lead-5 (`:1372`).
6. Cute Charm: `RandMod(3) > 0` when the gender is not fixed (`:1063`), then nature
   (Synchronize `RandMod(2) == 0` -> lead nature else `RandMod(25)`, `:944-949`) and the
   **arithmetic** PID with no further call: `nature` for a female target,
   `25 * (ratio/25 + 1) + nature` for a male one (`:1075`, `pokeplatinum/src/pokemon.c:516,535-536`).
7. Otherwise nature, then `LCRNG_Next() | (LCRNG_Next() << 16)` until the nature matches
   (`:1083`, `pokeplatinum/src/pokemon.c:498-499`), then IV1, IV2.
8. Held item: `LCRNG_Next() % 100` (`pokeplatinum/src/pokemon.c:4681`; 45/95, Compound Eyes 20/80 `:4694`).
   Only the roll and its class are reported (the data module carries no item ids).
9. Unown: `LCRNG_Next() % count` over the map's form group (`:1489`, groups `:116-179`).
10. Honey tree: level `5 + RandMod(11)`, Pressure `RandMod(2) == 0` keeps it else 15
    (`:1210-1216`), then step 6 onward. Poke Radar with the chain kept: no slot roll
    (`:1149-1161`), a broken chain rolls the slot (`:1164-1194`); shiny patches use the shiny
    PID with a Cute Charm gender loop or a Synchronize nature loop (`:983-1045`); patch odds
    `1/max(200, 8200 - 200*chain)` (`pokeplatinum/src/pokeradar.c:474-479`).

`battleAdvances` = frame + `callsUsed` + 1 (ball position) + 1 for fishing + 4 on DP, 0 for
Great Marsh/Safari (EMPIRICAL, PokeFinder `WildGenerator4.cpp:247-270`).

## Gen 4 wild Method K (HGSS): `gen4Wild` with `method: "K"`

`pokeheartgold/src/field/encounter_check.c`; every roll is modulo. The wild creator is `generateWildNonShinyAndAddToParty`
(`pokeheartgold/src/field/encounter_check.c:821-875,1350`: the Cute Charm roll, the nature, the PID loop and the IVs, then
`addGeneratedMonToBattleSetupParty` rolls the held item).

1. Rock smash `(LCRandom() % 100) >= rate` (`:388`), fishing `LCRandRange(100) >= rate` (`:341`)
   with the friendship boost 0/20/30/40/50 when the follower is out (`:1062-1081`), Suction
   Cups/Sticky Hold ×2 for fishing, Arena Trap/No Guard/Illuminate ×2 otherwise, cap 100
   (`:1124-1136`).
2. Typed slot: `LCRandRange(2) == 0` (`:1112`) then `LCRandom() % count` (`:1104-1107`), for
   land, rock smash, surf, fishing and headbutt alike (`:883-903`).
3. Slot: `LCRandRange(100)` land (`:632`), surf (`:662`), all rods 40/30/15/10/5 (`:678`),
   rock smash 80/20 (`:694-696`), headbutt 50/15/15/10/5/5 (`:700`); Safari `LCRandom() % 10`
   (`:959`); Bug Contest `LCRandom() % 100`, first slot whose rate <= roll
   (`pokeheartgold/src/overlay_bug_contest.c:178-183`).
4. Level: land and Safari land use the slot's level with the Pressure slot swap
   (`LCRandRange(2) == 0` keeps, `:886-887,961-965,1358-1372`); the design doc's claim that
   HGSS grass spends a level roll was re-verified as **false** (`:886-887` read the slot level;
   `:893` is the rock-smash case). Rock smash, surf, fishing, headbutt: `LCRandom() % range`
   then Pressure `LCRandRange(2) == 0` keeps it else max (`:754-756`); Bug Contest level
   `LCRandom() % range` with no Pressure roll (`pokeheartgold/src/overlay_bug_contest.c:186`).
5. Keen Eye/Intimidate *opt* (`:1153`), on the regular (`:920`) and Safari (`:966`) paths only:
   the Bug Contest path (`:976-986`) never calls `DoesAbilitySuppressEncounter`.
6. Cute Charm `LCRandRange(3) != 0` (`:837`), nature `LCRandRange(25)` (Synchronize
   `LCRandRange(2) == 0`, `:734-737`), arithmetic PID via letter 0
   (`:846`, `pokeheartgold/src/pokemon.c:275,292`), IVs.
7. Safari and Bug Contest without Cute Charm: up to four full creations (nature, PID loop,
   IVs) until one IV is 31 (`:856-869`); `perfectIvTries` reports how many (1..4) and
   `perfectIvFound` whether the last one carried a 31 (false when all four missed).
8. Held item `LCRandom() % 100` (`pokeheartgold/src/pokemon.c:3748`, via `:1350`).
9. Unown: Sinjoh event hall `LCRandom() % 2` over `!`/`?` (`:1312`, map
   `MAP_RUINS_OF_ALPH_HALL_ENTRANCE_SINJOH_EVENT` = encounter bank 13,
   `pokeheartgold/include/constants/maps.h:495`, `pokeheartgold/include/encounter_tables_narc.h:31`); elsewhere the unlocked puzzle letters
   in the order A-J, R-V, K-Q, W-Z (`:1252-1297`), with the Unown radio `LCRandom() % 100 < 50`
   picking among the uncaught ones (`:1339-1342`).

## Gen 4 eggs: `gen4EggHeld`, `gen4EggPickup`, `gen4Egg`

Trigger: the Everstone check is an LCRNG roll, not an MT call: `LCRNG_Next() >= 0xffff/2`
(= 0x7fff) -> no inheritance (`pokeplatinum/src/overlay005/daycare.c:336-341`; HGSS
`LCRandom() >= 0x7FFF`, `pokeheartgold/src/get_egg.c:241,247`, preceded by `LCRandom() % 2` picking the holder
when both parents hold one, `pokeheartgold/src/get_egg.c:235-240`), so the parent's nature passes only 32767/65536 of the
time (`GEN4_EVERSTONE_INHERIT_CHANCE`). Then the PID is one MT19937 output (`pokeplatinum/src/overlay005/daycare.c:353`,
`pokeheartgold/src/get_egg.c:262`), or - when the roll passed - the first MT output with the parent's nature and
nonzero, 2400 tries (`pokeplatinum/src/overlay005/daycare.c:361-367`, `pokeheartgold/src/get_egg.c:266-267`). `everstoneNature` models the
passed roll and `everstoneProc: false` the failed one (plain MT PID); held and pickup results
carry `everstoneInherited`. The trigger-time LCRNG state (one call, two with two Everstones in
HGSS) is not tracked: pickup runs on its own seed. Masuda: up to four
ARNG rerolls until shiny (`pokeplatinum/src/overlay005/daycare.c:722-724`, `pokeheartgold/src/get_egg.c:601-604`). Pickup: IV1, IV2 from
`Pokemon_InitWith`/`CreateMon` (`pokeplatinum/src/overlay005/daycare.c:735,764`, `pokeheartgold/src/get_egg.c:611,631`), then `%6 %5 %4`
and three `%2` parents (`pokeplatinum/src/overlay005/daycare.c:405-410`, `pokeheartgold/src/get_egg.c:317-325`); DPPt removes position `i`
(Emerald's bug, `pokeplatinum/src/overlay005/daycare.c:406`), HGSS removes the rolled index (`pokeheartgold/src/get_egg.c:319`). HGSS power
items force the first stat and skip one pair of rolls (`pokeheartgold/src/get_egg.c:308-312,999-1029`, two items
-> `LCRandom() % 2` picks the parent).

## Rarity (exact over the 2^32 cycle, recomputed here)

`countIvStates(filter, method)` is exact: for IV1 word `w1` and IV2 word `w2` the number of
states is `h_k[(w2 - (a_k * w1 mod 2^16)) mod 2^16]`, where `h_k` is the histogram of
`hi16(a_k * t + c_k)` over the 65536 low halves and `(a_k, c_k)` the k-step LCRNG (k = 1
for Methods 1/2/J/K, 2 for Method 4); the cost is (matching first words) × (matching second
words). `listIvStates` enumerates them. Measured (`tests/test-generators.cjs` pins each):

| Filter | Method 1 | Method 4 | per 100k frames |
|---|---|---|---|
| 6 × 31 | 6 states | 4 | 0.00014 |
| exactly five 31 | 738 | 732 | 0.0172 |
| all >= 30 | 260 | 252 | 0.0061 |
| all >= 30 and Hidden Power Dark 70 | 6 | | |

Flawless table (IV1 state, PID, nature, PSV; frame = `lcrngDistance(seed, ivState) - 3`):

| Method | IV1 state | PID | Nature | PSV | Frame from Emerald 0 | from RS 0x5A0 |
|---|---|---|---|---|---|---|
| 1 | FFFF982D | 7942EF72 | Timid | 9630 | 176,562,488 | 1,860,923,800 |
| 1 | FFFF305A | E85091A9 | Docile | 79F9 | 816,994,415 | 2,501,355,727 |
| 1 | 7FFFF961 | E9375A48 | Calm | B37F | 1,821,972,668 | 3,506,333,980 |
| 1 | 7FFF982D | F9426F72 | Modest | 9630 | 2,324,046,136 | 4,008,407,448 |
| 1 | 7FFF305A | 685011A9 | Modest | 79F9 | 2,964,478,063 | 353,872,079 |
| 1 | FFFFF961 | 6937DA48 | Modest | B37F | 3,969,456,316 | 1,358,850,332 |
| 2 | same six IV states, PIDs 11A97B04 (Careful), 6F72469F (Lax), 5A48D694 (Naive), 91A9FB04 (Naive), EF72C69F (Hardy), DA485694 (Rash); frames one less than Method 1 | | | 6AAD/29ED/8CDC | | |
| 4 | 7FFF52E5 / FFFF52E5 | B8862C85 / 3886AC85 | Modest / Timid | 9403 | 1,129,328,144 / 3,276,811,792 | 2,813,689,456 / 666,205,808 |
| 4 | 7FFF8D6E / FFFF8D6E | 995ABC94 / 195A3C94 | Naive / Careful | 25CE | 356,047,747 / 2,503,531,395 | 2,040,409,059 / 4,187,892,707 |

So the first flawless Method 1 frame is 176,562,488 from Emerald's seed 0 (34.2 days) and
353,872,079 from RS 0x5A0. The flawless natures and TID^SID blocks are per method: Method 1
Calm/Docile/Modest/Timid with the 8-wide blocks 79F8/9630/B378, Method 2 Careful/Hardy/Lax/
Naive/Rash with 29E8/6AA8/8CD8, Method 4 Careful/Modest/Naive/Timid with 25C8/9400. The design
doc's "nine natures, eight blocks" (Calm, Careful, Docile, Hardy, Lax, Modest, Naive, Rash,
Timid; 25C8, 29E8, 6AA8, 79F8, 8CD8, 9400, 9630, B378) is the union over Methods 1, 2 and 4, so
a readout must show the set of the method in use (each set is pinned by a test).

## Reachability

- `lcrngDistance(from, to)`: the number of steps between two states in O(32) by matching one
  bit at a time with the 2^i jump table (the low k bits of a full-period power-of-two LCG have
  period 2^k; algorithm from PokeFinder `Core/RNG/LCRNG.hpp:51-64`). `frameForIvState(seed,
  ivState, method)` = distance - 3 (Method 1/4) or - 4 (Method 2).
- `prev(s) = s * 0xEEB9EB65 + 0x0A3561A1` (PKHeX `LCRNG.rMult`, PokeFinder `PokeRNGR`).
- `seedsForIvs(ivs)`: PKHeX `LCRNGReversal.GetSeedsIVs` (lattice bounds Lag0 0x67D3, Lag1
  0xC907, Lower 0x3443, Upper 0xC34E; `LCRNGReversal.cs:65-104`), returning every state whose
  next two outputs carry the 15-bit IV words (the PID-high state of a Method 1 mon), both
  bit-31 variants included. Checked on 300 random seeds in JS and C#. The computation is
  `core/seedtime4.js` / `SeedTime4.cs` `seedsForIvWords` (see "Gen 4 seed-to-time"); the
  generators entry shifts its 15-bit words to the high half and delegates.
- `gen4SeedsForTarget(ivs, {maxFrame})`: `seedtime4.reachableSeeds` over the IV origins (back-step
  each origin `callsBeforeIv1` (2) + N times, keep seeds whose hour byte `(seed >> 16) & 0xFF` is
  0..23, about 9.4 % of back-steps) with the fields `delayPlusYear` (the seed's low half) and
  `ivOrigin`; it reproduces the design doc's example (state 7FFF305A is frame 0 from seed
  7B0448D1: hour 4, low half 18641 = delay + year - 2000). The generator checks compare both
  entries with the seedtime4 module on 204 IV sets (200 from Method 1 and Method 4 mons, four
  edge sets; maxFrame 0, 5, 100; call counts 2 and 3) and verify every origin and hit
  independently; the JS suite shows the comparison failing on a tampered delegate.

## Disagreement log (decomp vs PokeFinder; the decomp wins, each pinned by a test)

| # | Where | Decomp | PokeFinder | Effect |
|---|---|---|---|---|
| D1 | Emerald typed slots | Magnet Pull on land only, Static on land and water, neither on rocks (`pokeemerald/src/wild_encounter.c:430,432,438,443-444`) | applies both leads to every encounter type (`WildGenerator3.cpp`, `if ((lead == Lead::MagnetPull \|\| lead == Lead::Static) && ...)`) | Emerald water tables have no Steel type and rock tables no Electric type, so no shipped table differs; pinned with synthetic tables (`pin D1`) |
| D2 | Emerald Everstone roll | `Random() >= USHRT_MAX/2` (= 0x7fff) -> no inheritance (`daycare.c:446-447`) | `(rand >> 15) == 0` inherits, so an output of exactly 0x7fff inherits | 1 in 65536 trigger frames (`pin D2`) |
| D3 | HGSS Bug Contest with a Pressure-family lead | slot and level only (`pokeheartgold/src/overlay_bug_contest.c:178-186`) | adds the Pressure `nextUShort(2)` roll (`calculateLevel<true, true>` with force) | Pressure lead in the contest (`pin D3`) |
| D4 | HGSS Safari surf/fishing with a Pressure-family lead | slot swap on land only (`pokeheartgold/src/field/encounter_check.c:961-965`) | `Grass \|\| safari` -> swap roll on water too | Pressure lead in Safari water (`pin D4`) |
| D5 | DPPt surf/fishing with Magnet Pull | typed pick overwritten by the Static check (`pokeplatinum/src/overlay006/wild_encounters.c:1113-1115`) | forces the Steel slot | needs a Steel type in a water table (none shipped); pinned with a synthetic table (`pin D5`) |
| D6 | Gen 4 Everstone | LCRNG roll at trigger, `>= 0x7fff` fails (`pokeplatinum/src/overlay005/daycare.c:336-341`, `pokeheartgold/src/get_egg.c:241,247`), then MT loops until the parent's nature (`pokeplatinum/src/overlay005/daycare.c:353-367`, `pokeheartgold/src/get_egg.c:259-274`) | `EggGenerator4` ignores the parents' items | our `everstoneNature` / `everstoneProc` options; the oracle vectors run with them off (`pin D6`) |
| D7 | Feebas roll off the tile | Route 119: `Random()%100` after the map check and before the spot comparison (`pokeemerald/src/wild_encounter.c:121-122,137`, `pokeruby:84-85,98`); Mt. Coronet B1F: `RandMod(2)` first in `PlayerAvatar_IsFacingFeebasTile` (`pokeplatinum/src/overlay006/feebas_fishing.c:37`, via `pokeplatinum/src/overlay006/wild_encounters.c:407`, `pokeplatinum/src/map_header.c:194-196`) | `feebasLocation && feebasTile` gates the roll (`WildGenerator3.cpp`, `WildGenerator4.cpp`), so an off-tile cast on the map spends no call | every off-tile cast on the map is one call later than PokeFinder's; `feebasMap` spends it, `feebasTile` can hit (`pin D7`) |

Not a mechanic but a label: PokeFinder folds the four Ruins of Alph interior banks into one
location and uses **10** for the Sinjoh-event hall (`hgss.py`, "Ruins of Alpha interior all
share the same table"); in the decomp that hall is bank 13 and bank 10 is the plain
underground hall (`pokeheartgold/src/field/encounter_check.c:1388`, `pokeheartgold/src/data/map_headers.h:9466-9467,14746-14747`). The
vector builder maps PokeFinder location 10 to `sinjoh: true`.

## Not modelled / open

- Emerald `TryGetRandomWildMonIndexByType` scans `NUM_LAND_MONS_ENCOUNTER_SLOTS` (12) entries
  even for the 5-slot water table (`:953`, no BUGFIX), reading past the array into the next
  ROM data; the Static-on-water count therefore depends on ROM layout. Both PokeFinder and
  this engine use the in-bounds 5 slots.
- Emerald egg nature loop: PokeFinder stops after 17 tries (a VBlank `Random()` is assumed to
  land there); the decomp allows 2400 tries with the VBlank call interleaving at an unknown
  point. `maxNatureTries` defaults to 17 for parity; the `pid != 0` condition (`:477`) is applied.
- Held items: only the roll and its class (none/common/rare); characteristics: not derived.
- HGSS two-Everstone parents: an extra `LCRandom() % 2` at trigger picks the holder
  (`pokeheartgold/src/get_egg.c:235-240`); with the trigger-time LCRNG untracked it changes nothing here. The
  two-Ditto coin flips (`pokeemerald/src/daycare.c:437-442`, `pokeplatinum/src/overlay005/daycare.c:326-331`)
  are dead code: two Dittos are `PARENTS_INCOMPATIBLE` in all three games
  (`pokeemerald/src/daycare.c:1039-1040`, `pokeplatinum/src/overlay005/daycare.c:836-838`,
  `pokeheartgold/src/get_egg.c:687-689`).
- Emerald egg results with a redraw range are ordered by (advances, pickupAdvances, redraws);
  PokeFinder's compare (`EggGenerator3.cpp`) has no tiebreak, so no oracle order exists for the
  ties (`cnt - 3*redraw` collides).
- DP battle-advance constants (+4 quick claw) come from PokeFinder, pokediamond has no C for it.
- Safari Pokeblocks (Emerald nature shuffle), Battle Pike/Pyramid tables, double battles.

## Verification record

- Oracle: `tests/generators-vectors.json`, built by `tools/build-generator-vectors.cjs` from
  PokeFinder's `Test/Gen3/{static3,wild3,egg3}.json` and `Test/Gen4/{static4,wild4,egg4}.json`
  (commit 7adce35), every generator case mapped, PokeFinder's names kept, inputs resolved to
  our data records: static3 3 cases / 30 results, wild3 16 / 133, egg3 6 / 350, static4 9 / 90,
  wild4 43 / 430, egg4 8 / 800 (85 cases, 1833 results). Compared fields: pid, ivs, stats,
  ability, abilityIndex, gender, hiddenPower, hiddenPowerStrength, level, nature, shiny,
  advances, specie, encounterSlot, form, valid, battleAdvances, call, chatot, inheritance,
  pickupAdvances, redraws. Not compared: item, characteristic.
- `node tests/test-generators.cjs`: 1986 assertions green (2287 with the C# cross file);
  `GEN_TEST_NEGATIVE=1` corrupts one oracle PID and fails with exit 1.
- `dotnet run --project app/Tests -- --generators`: 1959 assertions green on the same
  vectors; it writes `tests/generators-cross.json` (300 random seed/frame/method cases over
  the vector inputs, Emerald eggs with redraw ranges 0-2, Gen 4 eggs with and without the
  Everstone roll) which the JS suite recomputes bit for bit on pid, ivs, level, slot, form,
  advances, pickupAdvances, inheritance, perfectIvTries/Found, cuteCharm, itemRoll, redraws
  and everstoneInherited (the first cross file omitted the last six, which hid a JS 5 vs C# 4
  `perfectIvTries` split on Safari frames that missed all four creations).
- Disagreement pins D1-D7 plus the Keen Eye Bug Contest, Everstone-roll, redraw-order,
  per-method flawless-nature and Feebas-precondition checks run in both engines; each was run
  against the pre-fix engine (or a wrong expectation) and shown to fail there.
- `python3 tools/check-generator-citations.py`: all 323 citations present.
