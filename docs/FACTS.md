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
has been validated on a DS by us (the Phase 8 gate, a DS Lite calibration session, is pending).

## The RNG (LCRNG64)

`s = s * 0x5D588B656C078965 + 0x269EC3 (mod 2^64)` (`Core/RNG/LCRNG64.hpp:270`, `using BWRNG`;
writeup Initial Frame.md, `next()`). The inverse step is `s * 0xDEDCEDAE9638806D +
0x9B1AE6E9A384E6F9` (`:271`, `BWRNGR`). Two outputs: the high 32 bits (`:248-251`) and the
bounded draw `((s >> 32) * max) >> 32` (`:261-264`), which every table roll, the needle draw
and the TID/SID draw use. Jump-ahead by squaring (`:104-116` table, `:206-217`). Vectors:
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
`0xca62c1d6` at `SHA1.cpp:124,136,148,160`; initial state `:307-311`) take `h0 = 0x67452301 + a`
and `h1 = 0xefcdab89 + b` (`:298-299`), form `raw = bswap(h1) << 32 | bswap(h0)` (`:301`),
and **step it once**: `seed = raw * 0x5D588B656C078965 + 0x269EC3` (`:302`). That stepped value
is what PokeFinder and the community call the initial seed and what every advance count
below starts from. PokeFinder precomputes the first eight rounds per (date, Timer0)
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
