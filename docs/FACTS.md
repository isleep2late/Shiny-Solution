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

# Gen 1/2 (Game Boy)

## The RNG

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
> the constants and their validation, unchanged.

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
(`engine/movie/intro_yellow.asm:12-20`); the title loop tests `hJoyHeld & (A|START)` (level,
`engine/movie/title.asm:166-175`); `PlayShootingStar` shows the copyright screen for 180 frames,
waits 64 more, then `AnimateShootingStar` polls `CheckForUserInterruption`
(`engine/movie/intro.asm:82-118`, `home/overworld.asm:2273-2302`). EMPIRICAL (the `hold` search at
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
- Mersenne Twister (textbook MT19937, init 1812433253) — `math_util.c:79-119`. Used for
  TID/SID and the DPPt Poketch Coin Toss.
- ARNG (`*0x6C078965 + 1`): Masuda-method rerolls, Mystery Gift. Not used by this tool yet.

## TID/SID

Decomp-proven in Platinum and HGSS (DP inferred, its new-game path is still asm): on New
Game the RNG is re-seeded at the end of the intro/naming sequence, one MT output goes to the
record-mix seed, and the SECOND MT output is the full 32-bit trainer ID — TID = low 16 bits,
SID = high 16 (`pokeplatinum/src/game_start.c:144-172`,
`pokeheartgold/src/overlay_36.c:185-202`). TID manip therefore targets the seed hit at that
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

## Gen 4 seed-to-time and reversal (`core/seedtime4.js` / `SeedTime4.cs`)

The tool layer over the seed formula, for the reachability-first search the design asks for
(RNG_GUIDE_DESIGN.md sections 5.3, 5.4, 6.2; Phase 5). Every function exists in both languages with
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
| Poketch coin flip | 0 | STRUCTURAL | `coin_toss/main.c:158`, MT only |
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
- The reversal is duplicated in Phase 3's `core/generators.js` (`seedsForIvWords`,
  `gen4SeedsForTarget`); the two are to be merged onto this module.

### The reachability search

`reachableSeeds(origins, callsBefore, maxFrame)` steps each origin back to the seed of frame 0
(`callsBefore` = 2 for IV origins, 0 for PID origins) and on to frame `maxFrame`, keeping the seeds
whose hour byte is 0..23 (24 of 256 values, so about 9.4% of back-steps). `seedsToTimes` then picks
the (year, delay) pairs inside the delay window nearest the target delay and lists the date/times;
`wantedToTimes` chains the two from IVs, a PID, or (TID, SID, shiny, nature): the shiny path
enumerates the 524,288 shiny PIDs (about 21k per nature) and reverses each. Gate (design Phase 5):
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

### Not measured

No DS session: the delay a console actually reaches, and whether a chosen (date, time, delay) lands
its seed on hardware, remain the Phase 5 hardware gate. The roamer model inherits PokeFinder's
assumption that the player is not standing on a roamer map at load.

# Gen 3 (Game Boy Advance)

## The RNG

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
  `NewGameInitData` → `InitPlayerTrainerId` (`overworld.c:1272-1276`, `new_game.c:174`).
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
| `gSaveBlock2` | `0x02024EA4` | via ptr `0x03005D90` | via ptr `0x0300500C` | RS proven (linker walk from `sym_ewram.txt`, annotated in `include/global.h:841`); E/FRLG pointers derived from proven object order anchored on `gRngValue` |
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
| Timer1 starts when the PLAYER naming screen is created | `src/naming_screen.c:411-412` (`DoNamingScreen`: `if (templateNum == NAMING_SCREEN_PLAYER) StartTimer1()`) | `src/naming_screen.c:427-428`; also at the title screen, `src/title_screen.c:351` |
| the Trainer ID and the seed are the raw Timer1 count at the naming screen's exit, after the fade-out | `src/naming_screen.c:696-701` `MainState_Exit` -> `SeedRngAndSetTrainerId`; `src/main.c:208-214`: `val = REG_TM1CNT_L; SeedRng(val); REG_TM1CNT_H = 0; sTrainerId = val` | `src/naming_screen.c:717-723`; `src/main.c:264-270` (`gTrainerId`). The title-screen value (`title_screen.c:735`) is overwritten on every New Game |
| LCRNG | `src/random.c:11-16`: `gRngValue = 0x41C64E6D * gRngValue + 0x6073`, output `>> 16`; `SeedRng`: `gRngValue = seed` | `src/random.c:8-17`, same constants |
| one `Random()` per VBlank | `src/main.c:365-366` (skipped only in link / frontier / recorded battles) | `src/main.c:412` (unconditional) |
| the Secret ID roll | `src/overworld.c:1532-1537` `CB2_NewGame` -> `NewGameInitData` (`src/new_game.c:140-164`) -> `InitPlayerTrainerId` (`:84-88`): `(Random() << 16) \| GetGeneratedTrainerIdLower()` | `src/overworld.c:1527-1531`; `src/new_game.c:82-96`, `:54-58` |
| no other `Random()` on the path | `NewGameInitData` before the roll: `RtcReset`, `ZeroPlayerPartyMons`, `ZeroEnemyPartyMons`, `ResetPokedex`, `ClearFrontierRecord`, `ClearSav1`, `ClearAllMail` draw nothing (grep of `src/rtc.c`, `pokedex.c`, `mail.c`, `frontier_util.c`, `pokemon.c` `ZeroMonData`); `main_menu.c`'s only draw is `Random() % NUM_PRESET_NAMES` at `:1603`, before the naming screen; `naming_screen.c`, `palette.c`, `text.c`, `task.c`, `sprite.c`, `menu.c`, `window.c`, `bg.c`, `sound.c`, `m4a.c` contain no `Random()` | `oak_speech.c:2146,2148` draw only for the PLAYER default name, before the naming screen (`:2138-2160`); the rival presets draw nothing; `new_game.c:103` `SeedWildEncounterRng(Random())` is in `ResetMenuAndMonGlobals`, run at the title exit (`title_screen.c:737`), not on this path; `new_game.c:82-96` before the roll draws nothing |

So with **k = the number of VBlanks between the seed and the roll**,
`SID = hi16(LCRNG^(k+1)(TID))` and `TSV = (TID ^ SID) >> 3`; PokeFinder's `IDGenerator3::generateFRLGE`
(`Core/Gen3/Generators/IDGenerator3.cpp:51-69`, `PokeRNG rng(tid, initialAdvances); sid = rng.nextUShort()`)
labels the same row "advance k". The Python LCRNG (`rngsolution/gen3.py`) is checked against Shiny Solution's
`core/rng.js` on 50 vectors emitted by node (`tests/gen3_vectors.js`, fixture `tests/fixtures/gen3-lcrng-vectors.json`;
regenerated and compared in `tests/test_gen3.py` when node is present).

#### What is inside k: the presses after naming (STRUCTURAL: which waits exist; EMPIRICAL: their frame counts)

Every wait for a button on the path is a `JOY_NEW(A_BUTTON | B_BUTTON)` read: the YES/NO menus
(`menu.c:1013-1022` `Menu_ProcessInputNoWrap`; pokefirered `menu.c:342-349` `Menu_ProcessInput`) and the
text printer's three wait states, `RENDER_STATE_WAIT`, `RENDER_STATE_CLEAR` (`\p`, `CHAR_PROMPT_CLEAR` 0xFB) and
`RENDER_STATE_SCROLL_START` (`\l`, `CHAR_PROMPT_SCROLL` 0xFA, "waits for button press and scrolls"), all through
`TextPrinterWaitWithDownArrow` / `TextPrinterWait` (pokeemerald `text.c:865-899,1167-1188`; pokefirered
`text.c:550-585,859-875`; `include/constants/characters.h:175-176`; `charmap.txt:1087-1088`). A press while the
text is still printing is not a wait press: it only zeroes the current character delay
(`text.c:944-955` / `:639-650`, `canABSpeedUpPrint`), so it is swallowed and the box is still waiting.
The earlier statement in this repo of "six paragraph presses" counted only `\p`; the `\l` scroll prompts
are presses too.

**Emerald** (`main_menu.c:1788-1850` return from naming, `:1609-1786` the tasks; `data/text/birch_speech.inc:42-61`):
YES on "So it's X?" (`:1626-1635`; NO at `:1637-1640` goes back to the gender box and re-enters naming, a new
Timer1 read), then `gText_Birch_YourePlayer` (`\p`, `\l`, `\p`) and `gText_Birch_AreYouReady`
(`\p`, `\p`, `\l`, `\p`, `\p`): **9 timed presses**. Fixed parts between them: the 16-step palette fade-in and
5-frame timer after naming, the sprite/platform fades (`NewGameBirchSpeech_StartFade*`, delay 2, 16 steps),
the 30-frame platform slide, the 64-frame `tTimer` before "are you ready?", the printing itself, and after
the last press the shrink (`sSpriteAffineAnim_PlayerShrink` 0x30 frames, `:445-448`), the fades and
`Cleanup` -> `CB2_NewGame` (`:1783`).

**FireRed / LeafGreen** (`oak_speech.c:1788-1880` return from naming, `:1460-1786` the tasks;
`data/text/new_game_intro.inc:218-243`): YES on "So your name is X." (`:1490-1520`; the box appears 25 frames
after the text, `:1473`), `gOakSpeech_Text_WhatWasHisName` (`\p`, `\p`), the rival name menu
(`:1413-1438`, cursor on NEW NAME; the first preset is DOWN then A; NEW NAME goes through the rival naming
screen, which neither starts Timer1 nor reseeds but adds the typing time), YES on "was it X?",
`RememberRivalsName` (`\p`), `LetsGo` (`\p`, `\p`): **8 timed presses** on the preset path (the DOWN is untimed, the A is a press) and **11** on the NEW NAME path (A on NEW NAME, then A / START / A on the rival naming screen, each a press the game must read). Fixed parts:
the 40-frame timers around the pic fades (`:1497,1529,1575`), the 30-frame slide (`:1385`), the 30-frame
`FadeOutBGM` timer (`:1600`), and after the last press the shrink (five 20-frame steps, `:1647-1672`),
the 36-frame timer, the fade and `FreeResources` -> `CB2_NewGame` (`:1784`). LeafGreen differs from
FireRed only by its first preset rival name (two boxes print it).

The text speed is read at print time in Emerald (`menu.c:191-196` `AddTextPrinterForMessage`,
`GetPlayerTextSpeedDelay`) and cached when the Oak speech starts in FRLG (`oak_speech.c:761`,
`GetTextSpeedSetting`, `new_menu_helpers.c:27-32,658-664`: delays 8 / 4 / 1 for slow / mid / fast; a fresh
cartridge is MID, `SetDefaultOptions` via `Sav2_ClearSetDefault`, pokeemerald `intro.c:1152-1156`,
pokefirered `title_screen.c:737-741`). The name is printed by two boxes on each game's path, so the fixed
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
speech caches the speed at its start (`oak_speech.c:761`), so a fresh save is MID and fast / slow were
measured by writing the option at the main menu (as options carried over from a save would be). A held
A: A held 8 or 30 frames at every press gives the same k as one-frame taps (savestate harness, review run);
only a press while the text prints arms `hasPrintBeenSpedUp` (`text.c:944-955`).

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

#### Not measured

A `B` press instead of `A` (B on the name box answers NO and re-rolls the Trainer ID; B is also accepted by
the text waits); a rival name longer than one letter on the NEW NAME path (it prints in two boxes, so 4
frames per letter at MID like the player's, INFERRED); the GIRL player (BOY throughout); Japanese and other
languages (different text, different counts); real hardware (the counts are whole-VBlank counters in the
game code, so a discrepancy would mean an emulation error, not a timing one).
