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
  effectively **postgame only**: it requires ≥8 badges, game clear, the S.S. Ticket, a lead
  holding an Everstone, AND the Pokérus flag. Before the Pokérus flag it is a **2-way E/K** on
  the same draw, and active roamers eat advances first. Mid-game players will not see the 3-way
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

## Derived values

- Nature = PID % 25 (`pokeemerald/src/pokemon.c:5498-5500`).
- Gender: 0/254/255 fixed male/female/genderless, else female iff `genderRatio > (PID & 0xFF)`
  (`pokeemerald/src/pokemon.c:3471-3485`); reported 0 = M, 1 = F, 2 = none.
- Ability: bit `PID & 1` selects the second ability only when the species has one
  (`pokeemerald/src/pokemon.c:2298-2302`, `pokeplatinum/src/pokemon.c:475-483`). Results carry
  `abilityBit`, the effective `abilitySlot` and `abilityId`.
- Shiny iff `TID ^ SID ^ PIDhi ^ PIDlo < 8` (`pokeemerald/include/pokemon.h:371`,
  `pokeplatinum/src/pokemon.c:2755`). `shinyType` 2/1/0 (equal / < 8 / not) is PokeFinder's
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
| roamer *opt* | `Random()%4 == 0` (`src/roamer.c:216`) | `src/roamer.c:183` | `TryStartRoamerEncounter` |
| outbreak *opt* | `Random()%100 < probability` (`:487`) | `:371` | none |
| Feebas (fishing on the tile) | `Random()%100 > 49` -> no Feebas (`:137`), else Feebas 20-25 (`:67,784-790`) | `:98` | none |
| typed slot | Magnet Pull on land, Static on land and water, nothing on rocks (`:432,440,445-446`): `Random()%2 != 0` -> no (`:947`), else `Random()%count` over the Steel/Electric slots unless none or all (`:931-934`) | none | none |
| slot | `Random()%100` over 20/20/10/10/10/10/5/5/4/4/1/1 land, 60/30/5/4/1 water and rock, 70/30, 60/20/20, 40/40/15/4/1 rods (`:182-262`) | `:144-230` | `:71-130` |
| level | `Random()%range` (`:286`); Pressure/Hustle/Vital Spirit `Random()%2 == 0` -> max, else `rand--` if nonzero (`:292-297`) | `:254` | `:172` |
| Keen Eye/Intimidate *opt* (`lead.level`) | `Random()%2 == 0` suppresses when lead level > 5 and wild level <= lead-5 (`:906`, gated by `WILD_CHECK_KEEN_EYE` `:453`) | none | none |
| Cute Charm | `Random()%3 != 0` when the species' gender is not fixed (`:397-398`), then the PID loop demands the opposite gender of the lead (`:410`, `src/pokemon.c:2340-2343`) | none | none |
| Safari | one `Random()%100` (the `< 80` Pokeblock check, no block assumed: `:341`) | `:278` | none |
| nature | Synchronize `Random()%2 == 0` -> lead nature (`:371-372`) else `Random()%25` (`:378`) | `Random()%25` (`:305`) | `Random()%NUM_NATURES` (`:232`) |
| PID | `Random32()` until nature (and gender) match (`src/pokemon.c:2305-2311,2340-2343`) | `:311` | `:232`; Unown: `(Random()<<16)|Random()` until the chamber letter (`:237,243-251`), no nature roll |
| IVs | IV1, IV2 with the Method 2/4 skips | same | same |

RS and FRLG have no lead effects on slot, level, nature or gender (only Stench/Illuminate on
the odds, `pokeruby:413-419`, `pokefirered:334-346`); `gen3Wild` refuses a field ability for
those games instead of applying it. Fishing slots are reported per rod list (old 0-1, good 0-2,
super 0-4) as PokeFinder does; a Feebas hit reports the inserted pseudo-slot 2/3/5.

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
  loop, IVs, then one held-item roll after the IVs (`wild_encounters.c:1227-1235,1462`,
  `pokemon.c:4681`; HGSS `encounter_check.c:988-996,1350`); `callsUsedWithItem` counts it.
- HGSS starters are created three in a row, 4 calls each, so starter i is at frame + 4i
  (`pokeheartgold/src/choose_starter.c:55-59`); DPPt starters are single `GivePokemon` mons
  (`statics-gen4.json` creation notes).
- `call = output % 3` (E/K/P, `phone_scripts_prof_elm.c:84`) and `chatot = ((output % 8192) * 100) >> 13`
  (`pokeplatinum/src/sound_chatot.c:80`, `pokeheartgold/src/sound_chatot.c:59`; the 0..99
  scaling is PokeFinder's display) are derived from the frame's first output.

## Gen 4 wild Method J (DPPt): `gen4Wild` with `method: "J"`

`pokeplatinum/src/overlay006/wild_encounters.c`; every roll is `RandMod` (division) unless noted.

1. Fishing: `RandMod(100) >= rate` -> no bite (`:396`); the frame still generates, reported
   `valid: false` (PokeFinder convention). Feebas tile: `RandMod(2) == 0` -> not a Feebas tile
   (`feebas_fishing.c:37`); otherwise the whole table is Feebas 10-20 (`:407-420`) and the
   normal slot roll (and the lead's typed check) still happens; reported as pseudo-slot 5.
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
   `25 * (ratio/25 + 1) + nature` for a male one (`:1075`, `pokemon.c:516,535-536`).
7. Otherwise nature, then `LCRNG_Next() | (LCRNG_Next() << 16)` until the nature matches
   (`:1083`, `pokemon.c:498-499`), then IV1, IV2.
8. Held item: `LCRNG_Next() % 100` (`pokemon.c:4681`; 45/95, Compound Eyes 20/80 `:4694`).
   Only the roll and its class are reported (the data module carries no item ids).
9. Unown: `LCRNG_Next() % count` over the map's form group (`:1489`, groups `:116-179`).
10. Honey tree: level `5 + RandMod(11)`, Pressure `RandMod(2) == 0` keeps it else 15
    (`:1210-1216`), then step 6 onward. Poke Radar with the chain kept: no slot roll
    (`:1149-1161`), a broken chain rolls the slot (`:1164-1194`); shiny patches use the shiny
    PID with a Cute Charm gender loop or a Synchronize nature loop (`:983-1045`); patch odds
    `1/max(200, 8200 - 200*chain)` (`pokeradar.c:473-478`).

`battleAdvances` = frame + `callsUsed` + 1 (ball position) + 1 for fishing + 4 on DP, 0 for
Great Marsh/Safari (EMPIRICAL, PokeFinder `WildGenerator4.cpp:247-270`).

## Gen 4 wild Method K (HGSS): `gen4Wild` with `method: "K"`

`pokeheartgold/src/field/encounter_check.c`; every roll is modulo.

1. Rock smash `(LCRandom() % 100) >= rate` (`:388`), fishing `LCRandRange(100) >= rate` (`:341`)
   with the friendship boost 0/20/30/40/50 when the follower is out (`:1062-1081`), Suction
   Cups/Sticky Hold ×2 for fishing, Arena Trap/No Guard/Illuminate ×2 otherwise, cap 100
   (`:1124-1136`).
2. Typed slot: `LCRandRange(2) == 0` (`:1112`) then `LCRandom() % count` (`:1104-1107`), for
   land, rock smash, surf, fishing and headbutt alike (`:883-903`).
3. Slot: `LCRandRange(100)` land (`:632`), surf (`:662`), all rods 40/30/15/10/5 (`:678`),
   rock smash 80/20 (`:694-696`), headbutt 50/15/15/10/5/5 (`:700`); Safari `LCRandom() % 10`
   (`:959`); Bug Contest `LCRandom() % 100`, first slot whose rate <= roll
   (`overlay_bug_contest.c:178-183`).
4. Level: land and Safari land use the slot's level with the Pressure slot swap
   (`LCRandRange(2) == 0` keeps, `:886-887,961-965,1358-1372`); the design doc's claim that
   HGSS grass spends a level roll was re-verified as **false** (`:886-887` read the slot level;
   `:893` is the rock-smash case). Rock smash, surf, fishing, headbutt: `LCRandom() % range`
   then Pressure `LCRandRange(2) == 0` keeps it else max (`:754-756`); Bug Contest level
   `LCRandom() % range` with no Pressure roll (`overlay_bug_contest.c:186`).
5. Keen Eye/Intimidate *opt* (`:1153`).
6. Cute Charm `LCRandRange(3) != 0` (`:837`), nature `LCRandRange(25)` (Synchronize
   `LCRandRange(2) == 0`, `:734-737`), arithmetic PID via letter 0
   (`:846`, `pokemon.c:275,292`), IVs.
7. Safari and Bug Contest without Cute Charm: up to four full creations (nature, PID loop,
   IVs) until one IV is 31 (`:856-869`); `perfectIvTries` reports how many.
8. Held item `LCRandom() % 100` (`pokemon.c:3748`, via `:1350`).
9. Unown: Sinjoh event hall `LCRandom() % 2` over `!`/`?` (`:1312`, map
   `MAP_RUINS_OF_ALPH_HALL_ENTRANCE_SINJOH_EVENT` = encounter bank 13,
   `constants/maps.h:495`, `encounter_tables_narc.h:31`); elsewhere the unlocked puzzle letters
   in the order A-J, R-V, K-Q, W-Z (`:1252-1297`), with the Unown radio `LCRandom() % 100 < 50`
   picking among the uncaught ones (`:1339-1342`).

## Gen 4 eggs: `gen4EggHeld`, `gen4EggPickup`, `gen4Egg`

Trigger: Everstone check on the LCRNG (`LCRNG_Next() >= 0x7fff` -> no inheritance,
`pokeplatinum/src/overlay005/daycare.c:327-336`; HGSS `get_egg.c:235-240`), then the PID is one
MT19937 output (`daycare.c:353`, `get_egg.c:262`), or the first MT output with the parent's
nature and nonzero, 2400 tries (`daycare.c:361-367`, `get_egg.c:266-267`). Masuda: up to four
ARNG rerolls until shiny (`daycare.c:722-724`, `get_egg.c:601-604`). Pickup: IV1, IV2 from
`Pokemon_InitWith`/`CreateMon` (`daycare.c:734,764`, `get_egg.c:611,631`), then `%6 %5 %4`
and three `%2` parents (`daycare.c:405-410`, `get_egg.c:317-325`); DPPt removes position `i`
(Emerald's bug, `daycare.c:406`), HGSS removes the rolled index (`get_egg.c:319`). HGSS power
items force the first stat and skip one pair of rolls (`get_egg.c:308-312,999-1029`, two items
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
353,872,079 from RS 0x5A0; only nine natures can be flawless (Calm, Careful, Docile, Hardy,
Lax, Modest, Naive, Rash, Timid) and a flawless shiny needs TID^SID in one of eight 8-wide
blocks (25C8, 29E8, 6AA8, 79F8, 8CD8, 9400, 9630, B378) - the design doc's numbers reproduce.

## Reachability

- `lcrngDistance(from, to)`: the number of steps between two states in O(32) by matching one
  bit at a time with the 2^i jump table (the low k bits of a full-period power-of-two LCG have
  period 2^k; algorithm from PokeFinder `Core/RNG/LCRNG.hpp:51-64`). `frameForIvState(seed,
  ivState, method)` = distance - 3 (Method 1/4) or - 4 (Method 2).
- `prev(s) = s * 0xEEB9EB65 + 0x0A3561A1` (PKHeX `LCRNG.rMult`, PokeFinder `PokeRNGR`).
- `seedsForIvs(ivs)`: PKHeX `LCRNGReversal.GetSeedsIVs` (lattice bounds Lag0 0x67D3, Lag1
  0xC907, Lower 0x3443, Upper 0xC34E; `LCRNGReversal.cs:65-104`), returning every state whose
  next two outputs carry the 15-bit IV words (the PID-high state of a Method 1 mon), both
  bit-31 variants included. Checked on 300 random seeds in JS and C#.
- `gen4SeedsForTarget(ivs, {maxFrame})`: back-steps each origin `callsBeforeIv1` (2) + N times
  and keeps seeds whose hour byte `(seed >> 16) & 0xFF` is 0..23 (about 9.4 % of back-steps);
  it reproduces the design doc's example (state 7FFF305A is frame 0 from seed 7B0448D1: hour 4,
  low half 18641 = delay + year - 2000).

## Disagreement log (decomp vs PokeFinder; the decomp wins, each pinned by a test)

| # | Where | Decomp | PokeFinder | Effect |
|---|---|---|---|---|
| D1 | Emerald typed slots | Magnet Pull on land only, Static on land and water, neither on rocks (`pokeemerald/src/wild_encounter.c:432,440,445-446`) | applies both leads to every encounter type (`WildGenerator3.cpp`, `if ((lead == Lead::MagnetPull \|\| lead == Lead::Static) && ...)`) | Emerald water tables have no Steel type and rock tables no Electric type, so no shipped table differs; pinned with synthetic tables (`pin D1`) |
| D2 | Emerald Everstone roll | `Random() >= USHRT_MAX/2` (= 0x7fff) -> no inheritance (`daycare.c:446-447`) | `(rand >> 15) == 0` inherits, so an output of exactly 0x7fff inherits | 1 in 65536 trigger frames (`pin D2`) |
| D3 | HGSS Bug Contest with a Pressure-family lead | slot and level only (`overlay_bug_contest.c:178-186`) | adds the Pressure `nextUShort(2)` roll (`calculateLevel<true, true>` with force) | Pressure lead in the contest (`pin D3`) |
| D4 | HGSS Safari surf/fishing with a Pressure-family lead | slot swap on land only (`encounter_check.c:961-965`) | `Grass \|\| safari` -> swap roll on water too | Pressure lead in Safari water (`pin D4`) |
| D5 | DPPt surf/fishing with Magnet Pull | typed pick overwritten by the Static check (`wild_encounters.c:1113-1115`) | forces the Steel slot | needs a Steel type in a water table (none shipped); pinned with a synthetic table (`pin D5`) |
| D6 | Gen 4 Everstone | MT loops until the parent's nature (`daycare.c:353-367`, `get_egg.c:259-274`) | `EggGenerator4` ignores the parents' items | our `everstoneNature` option; the oracle vectors run with it off (`pin D6`) |

Not a mechanic but a label: PokeFinder folds the four Ruins of Alph interior banks into one
location and uses **10** for the Sinjoh-event hall (`hgss.py`, "Ruins of Alpha interior all
share the same table"); in the decomp that hall is bank 13 and bank 10 is the plain
underground hall (`encounter_check.c:1388`, `map_headers.h:9466-9467,14746-14747`). The
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
- `node tests/test-generators.cjs`: 1955 assertions green (2256 with the C# cross file);
  `GEN_TEST_NEGATIVE=1` corrupts one oracle PID and fails with exit 1 (2 assertions).
- `dotnet run --project app/Tests -- --generators`: 1929 assertions green on the same
  vectors; it writes `tests/generators-cross.json` (300 random seed/frame/method cases over
  the vector inputs) which the JS suite recomputes bit for bit.
- `python3 tools/check-generator-citations.py`: all 300 citations present.
