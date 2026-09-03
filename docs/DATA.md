# Data module: `core/data/*.json`

Six JSON files generated from the pret decompilations by one script. They are the data
layer for the RNG guide wizard (design doc section 6.3): species tables, wild encounter
tables and the static/gift catalogue for Gen 3 and Gen 4. No engine code reads them yet
(the engines are being changed elsewhere); `tests/test-data.cjs` is the only consumer.

| File | Bytes | Content |
|---|---|---|
| `species-gen3.json` | 159,990 | 386 species: base stats, gender byte, abilities, egg groups, types (Emerald primary, Ruby/FireRed cross-checked) |
| `species-gen4.json` | 258,457 | 493 species (Platinum primary, HeartGold/Diamond cross-checked) plus the Gen 3 to Gen 4 difference list |
| `encounters-gen3.json` | 1,028,632 | wild tables for Ruby, Sapphire, Emerald, FireRed, LeafGreen |
| `encounters-gen4.json` | 3,009,222 | wild tables for Platinum, HeartGold, SoulSilver, Diamond, Pearl; HGSS bug contest / safari / headbutt |
| `statics-gen3.json` | 65,758 | 71 static, gift, egg, event and roamer entries with decomp citations |
| `statics-gen4.json` | 101,232 | 116 entries; Diamond/Pearl entries carry PokeFinder provenance |

## Regeneration

```
python3 tools/gen-guide-data.py                     # writes core/data/*.json from ~/AI/pret
python3 tools/gen-guide-data.py --check             # regenerates in memory, fails if core/data differs
python3 tools/gen-guide-data.py --pokefinder /tmp/PokeFinder/Core/Resources/EncounterTables
                                                    # ... and diffs against PokeFinder's generator output
PRET_DIR=/elsewhere python3 tools/gen-guide-data.py # or --pret DIR
node tests/test-data.cjs                            # the data assertions (wired into tests/run-tests.sh)
DATA_TEST_NEGATIVE=1 node tests/test-data.cjs       # negative control: two Snorlax assertions made wrong on purpose
```

Python 3 standard library only. The output is deterministic (sorted keys, custom
pretty-printer that keeps scalar-only objects on one line, no timestamps): running the
generator twice gives byte-identical files, which `--check` relies on. Every file carries
the commit of each decomp it was read from in `meta.sources`.

The generator refuses to run if any cited decomp line no longer contains the cited text
(see "Static catalogue" below), so a pret update that moves a script line fails loudly
instead of silently drifting.

Inputs (read-only): `~/AI/pret/{pokeruby,pokeemerald,pokefirered,pokeplatinum,pokeheartgold,pokediamond}`.
PokeFinder's `EncounterTableGenerator` submodule is only needed for `--pokefinder`; the
generator imports it in a subprocess with `PYTHONDONTWRITEBYTECODE=1` and writes its
`.bin` tables to a temporary directory, never into the clone.

## Conventions shared by all files

- `species` in every encounter slot or catalogue entry is the **national dex number**. Gen 3
  internal ids (Hoenn species start at 277) are only in `species-gen3.json` (`internal_id`);
  in Gen 4 the internal id equals the dex number for 1..493.
- `constant` is the decomp's `SPECIES_*` name (Emerald spelling for Gen 3, Platinum for Gen 4).
- Ability, type and egg-group *names* are the constant suffix (`OVERGROW`, `GRASS`,
  `MONSTER`); the numeric ids are in the parallel `*_ids` arrays and the id tables in `meta`.
  `EGG_GROUP_NO_EGGS_DISCOVERED` (Emerald) is normalised to `UNDISCOVERED`.
- Gender byte: female iff `genderRatio > (PID & 0xFF)`; `0` always male, `254` always female,
  `255` genderless (design doc 5.3).
- `meta.generator` names the script; `meta.sources` holds repo commits.

## `species-gen3.json`

`meta`: `species_count` (386), `primary_source`, `cross_checked_against`, `sources`
(per game: repo, commit, files), `gender_ratio_byte` (the `PERCENT_FEMALE(p) =
min(254, (p*255)/100)` formula, truncated to `u8`; `pokeemerald/src/data/pokemon/species_info.h:1-3`,
`include/constants/pokemon.h:169-171`), `internal_id_note`, `hidden_ability` (none in Gen 3),
`ability_ids`, `type_ids`, `egg_group_ids` (id to name tables from
`include/constants/{abilities,pokemon}.h`).

`species[]` (ordered by `dex`, 1..386), one record each:

| Field | Meaning | Provenance |
|---|---|---|
| `dex` | national dex number | `include/constants/pokedex.h` enum (Emerald/FireRed), `include/constants/species.h` `NATIONAL_DEX_*` (Ruby) |
| `internal_id` | `SPECIES_*` value (1..411, the 25 `SPECIES_OLD_UNOWN_*` placeholders 252..276 are omitted) | `include/constants/species.h` |
| `constant`, `name` | `SPECIES_*`; in-game uppercase name (`NIDORAN♀`, `FARFETCH'D`) | `src/data/text/species_names.h` (`species_names_en.h` in pokeruby) |
| `base_stats` | `hp atk def spe spa spd` | `src/data/pokemon/species_info.h` (`base_stats.h` in pokeruby): `.baseHP` etc. |
| `types`, `type_ids` | two entries, duplicated for monotypes | `.types` / `.type1 .type2` |
| `gender_ratio` | the byte | `.genderRatio` via the `PERCENT_FEMALE` formula, `MON_MALE`/`MON_FEMALE`/`MON_GENDERLESS` |
| `abilities`, `ability_ids` | slot 1, slot 2 (`NONE`/0 when single) | `.abilities` / `.ability1 .ability2` |
| `egg_groups`, `egg_group_ids` | two entries | `.eggGroups` / `.eggGroup1 .eggGroup2` |
| `game_differences` | present only when Ruby or FireRed disagree with Emerald on any of the compared fields | never present today: the three decomps agree on every compared field for all 386 species |

Held items, catch rate, EV yields and friendship are not exported (not needed by the wizard).

## `species-gen4.json`

Same record shape plus:

| Field | Meaning | Provenance |
|---|---|---|
| `gender_ratio_enum` | Platinum's enum name (`GENDER_RATIO_FEMALE_12_5`) | `res/pokemon/<species>/data.json` `gender_ratio` |
| `gender_ratio` | byte | `pokeplatinum/generated/gender_ratios.txt` (`MALE_ONLY=0, FEMALE_12_5=31, FEMALE_25=63, FEMALE_50=127, FEMALE_75=191, FEMALE_87_5=223, FEMALE_ONLY=254, NO_GENDER=255`) |
| `hidden_ability` | always `null` | Gen 4 personal data has two ability slots only (`data.json` `abilities[2]`, pokeheartgold `struct BaseStats abilities[2]`); hidden abilities are a Gen 5 addition |
| `name` | in-game uppercase English name | `pokeheartgold/files/msgdata/msg/msg_0817.gmm`, row index = species id (Platinum's `res/text` has no species-name bank in this checkout) |
| `game_differences` | HeartGold / Diamond disagreement with Platinum | never present today |

Cross-check details: HGSS and DP `personal.json` store `genderRatio` as a fraction; the byte is
`GENDER_RATIO(frac) = frac <= 1 ? (u8)(frac*254.75) : 255`
(`pokeheartgold/include/constants/pokemon.h:364`, `pokediamond/include/constants/pokemon.h:309`),
which lands on the same bytes as Platinum's enum (0.125 -> 31, 0.5 -> 127, 1.0 -> 254, 2.0 -> 255).
Abilities are compared **by id**, because pokeheartgold spells `ABILITY_COMPOUNDEYES` and
`ABILITY_LIGHTNINGROD` where pokeplatinum and pokediamond spell `ABILITY_COMPOUND_EYES` and
`ABILITY_LIGHTNING_ROD`; the first draft compared names and reported 11 phantom differences.
`pokeplatinum/generated/abilities.txt` and `egg_groups.txt` are asserted to agree with
pokeheartgold's `#define`s.

`meta.differences_from_gen3`: 95 entries, every one of them `field: "abilities"` (a second
ability added or changed in Gen 4, e.g. Pidgey line `KEEN_EYE/NONE` -> `KEEN_EYE/TANGLED_FEET`,
the Nidoran families `POISON_POINT/NONE` -> `POISON_POINT/RIVALRY`). Base stats, types, gender
bytes and egg groups are identical for dex 1..386 between `pokeemerald` and `pokeplatinum`.

## `encounters-gen3.json`

`meta.slot_rates`: `land` `[20,20,10,10,10,10,5,5,4,4,1,1]`, `water` and `rock_smash`
`[60,30,5,4,1]`, `fishing` `old_rod [70,30]`, `good_rod [60,20,20]`, `super_rod [40,40,15,4,1]`.
These are the `encounter_rates` arrays of every `src/data/wild_encounters.json` and match the
`Random() % 100` cut-offs in `pokeemerald/src/wild_encounter.c:182-262`
(`ChooseWildMonIndex_Land/WaterRock/Fishing`), `pokeruby/src/wild_encounter.c:144-230`,
`pokefirered/src/wild_encounter.c:71-130`.

`games.<ruby|sapphire|emerald|firered|leafgreen>`: `source`, `commit`, `map_count`, `maps[]`.
Ruby/Sapphire and FireRed/LeafGreen come from one JSON each, split on the `base_label`
suffix (`_Ruby`, `_Sapphire`, `_FireRed`, `_LeafGreen`); every entry carries exactly one marker.

Each map record:

| Field | Meaning |
|---|---|
| `index` | position in the version-filtered `gWildMonHeaders` list. This is PokeFinder's location number: its generator enumerates the same list and merely *skips* duplicate tables (Altering Cave 2-9, Mt. Pyre floors, Seafloor Cavern rooms, ...), so Emerald has 124 maps here and 86 records there with the same numbering |
| `map`, `name`, `base_label` | `MAP_*` constant, a display name derived from it, the C label |
| `land` | `{rate, slots[12]}`; slots `{species, constant, min_level, max_level}` (Gen 3 land slots always have `min == max`) |
| `water`, `rock_smash` | `{rate, slots[5]}` |
| `fishing` | `{rate, old_rod[2], good_rod[3], super_rod[5]}` (the 10 JSON slots split by the file's `groups`) |
| `land.unown_letters`, `land.unown_letter_ids` | FRLG Tanoby chambers only: the Unown letter per land slot from `sUnownLetterSlots` (`pokefirered/src/wild_encounter.c:49-63`, chamber = map number minus Monean's, `:236-238`; ids 0-25 = A-Z, 26 = `!`, 27 = `?`) |

A section is absent when the map has no encounters of that kind (exactly as in the source JSON).
Level roll for water/rock/fishing: `min + Random() % (max - min + 1)` (`pokeemerald/src/wild_encounter.c:268-301`).

## `encounters-gen4.json`

`meta.slot_rates.dppt`: grass `[20,20,10,10,10,10,5,5,4,4,1,1]`, surf `[60,30,5,4,1]`,
old rod `[60,30,5,4,1]`, good and super rod `[40,40,15,4,1]`
(`pokeplatinum/src/overlay006/wild_encounters.c:820-915`, `LCRNG_RandMod(100)`).
`meta.slot_rates.hgss`: grass and surf as DPPt, fishing `[40,30,15,10,5]` for every rod,
rock smash `[80,20]`, headbutt `[50,15,15,10,5,5]`
(`pokeheartgold/src/field/encounter_check.c:631-716`, `LCRandRange(100)`).

`games.platinum.tables[]` (183, `index` = `pl_enc_data.narc` member = PokeFinder location;
order from `res/field/encounters/encounters.order`; the JSON layout is
`pokeplatinum/include/overlay006/wild_encounters.h:8-47`):

| Field | Meaning |
|---|---|
| `table`, `maps`, `names` | encounter file stem; `MAP_HEADER_*` constants whose `wildEncountersArchiveID` is this table (`pokeplatinum/include/data/map_headers.h`); display names |
| `grass` | `{rate, slots[12]}`, slots `{species, constant, level}` (one fixed level per slot) |
| `swarm[2]`, `day[2]`, `night[2]`, `radar[4]` | replacement species for slots (swarm: 0,1; day/night: 2,3; radar: 4,5,10,11) |
| `form_rates[5]`, `unown_table` | Shellos/Gastrodon and Unown form data, raw |
| `dual_slot.<ruby|sapphire|emerald|firered|leafgreen>[2]` | GBA-cartridge slot-2 replacement species (slots 8,9) |
| `surf`, `old_rod`, `good_rod`, `super_rod` | `{rate, slots[5]}`, slots `{species, constant, min_level, max_level}` |
| `map_category` | raw from the JSON |

`games.platinum.extra`: `honey_tree` (common/uncommon/rare lists) and `great_marsh_lookout`,
raw from the same directory (`encdata_ex`).

`games.heartgold` / `games.soulsilver` (142 tables each, `index` = `gs_enc_data` member;
layout `pokeheartgold/include/wild_encounter.h:17-56`; the JSON's `{"HEARTGOLD": x, "SOULSILVER": y}`
values are resolved per version):

| Field | Meaning |
|---|---|
| `table`, `maps`, `names` | the JSON `map` code (`T20`, `R29`, `D40R0107`); `MAP_*` constants with that `wildEncounterBank` (`pokeheartgold/src/data/map_headers.h` via `include/encounter_tables_narc.h`); display names from `mapsec` |
| `land` | `{rate, slots[12]}`, slots `{level, morning, day, night}` with one level shared by the three time-of-day species (`wild_encounter.h:23-28`); HGSS still spends the level roll (`encounter_check.c:893`) |
| `hoenn_sound[2]`, `sinnoh_sound[2]` | radio replacement species (slots 2-5) |
| `surf[5]`, `rock_smash[2]`, `old_rod[5]`, `good_rod[5]`, `super_rod[5]` | `{rate, slots}` with `min_level`/`max_level` |
| `swarm` | `{land, surf, night_fish, fish}` replacement species, keys present only when the JSON has them |

`hgss_shared`: `bug_contest` (`files/data/mushi/mushi_encount.csv`: species, level range,
rate, score), `safari_zone` (`files/arc/safari_enc.json`, raw: 12 areas, land/surf/rods by
time of day, block bonus tables) and `headbutt` (`files/arc/headbutt.json`, raw, only the
maps that have trees). These are carried verbatim (species as constants) for the later
generator phase; nothing is derived from them yet.

`games.diamond` / `games.pearl` (183 tables each): pokediamond has **no JSON or C form** of
the wild tables. What it does have is the retail NARC members committed as binaries,
`files/fielddata/encountdata/{d,p}_enc_data/narc_NNNN.bin` (git-tracked, 424 bytes each),
indexed by `wild_encounter_bank` in `pokediamond/arm9/src/map_header.c` and identical in
layout to Platinum's `WildEncounters` struct. The generator parses those with that layout
(`parse_dppt_bin`) and takes the map list from the `ENCDATA(NARC_d_enc_data_narc_NNNN_bin, ...)`
rows of `map_header.c`. The records are marked `provenance: EMPIRICAL (ROM dump carried by
the decomp)`: they are the same kind of source as PokeFinder's `d_enc_data.narc`, not
decompiled text. They match PokeFinder's diamond/pearl tables exactly (below).

Pruning: in every Gen 4 table a section whose rate is 0 and whose slots are all
`SPECIES_NONE` is omitted, as are all-`NONE` `swarm/day/night/radar/hoenn_sound/sinnoh_sound`
lists, all-zero `form_rates` and an all-`NONE` `dual_slot`. An absent key means "no
encounters of this kind on this table" (the comparison code treats absence as zeros).

## `statics-gen3.json` / `statics-gen4.json`

`entries[]`, one per (species, game set, location):

| Field | Meaning |
|---|---|
| `id` | stable key, `<game set>/<category>/<name>` (`rse/legend/rayquaza`, `hg/legend/lugia`) |
| `category` | `starter`, `fossil`, `gift`, `egg`, `game_corner`, `stationary`, `legendary`, `event`, `roamer` |
| `games` | subset of `ruby sapphire emerald firered leafgreen` / `diamond pearl platinum heartgold soulsilver` |
| `species`, `constant`, `name`, `internal_id` (Gen 3) | as in the species files |
| `level` | the level the script or C code passes to the creation call (eggs: 5 in Gen 3 = `EGG_HATCH_LEVEL`, 1 in Gen 4) |
| `location`, `held_item`, `form`, `shiny`, `catchable`, `notes` | `shiny: "always"` only for the Lake of Rage Gyarados (`WildBattle ..., 1`); `catchable: false` only for the ghost Marowak |
| `creation` | the call chain from the script command to `CreateMon`/`Pokemon_InitWith`/the wild generator, and which RNG method that implies (Method 1 for gifts, roamers and every Gen 3 static; the wild generator = Method J / K for Gen 4 scripted battles) |
| `sources[]` | `{repo, file, line, text}`: the decomp lines the entry rests on. The generator re-reads each line (tolerance +-3 lines) and aborts if the cited text is missing, so the species and level of every decomp-sourced entry are re-verified on every run |
| `provenance` | `decomp` or `pokefinder` |
| `level_verified_against_decomp` | `true` iff provenance is `decomp` (all Gen 3 entries; all Platinum and HGSS entries) |

`meta.creation_handlers[]` cites the shared handler code once per generation: for Gen 3
`ScriptGiveMon`, `CreateScriptedWildMon`, `ScrCmd_setwildbattle`, the `seteventmon` macro and
`CreateEnemyEventMon`, the daycare hatch call and `EGG_HATCH_LEVEL`
(`pokeemerald/src/script_pokemon_util.c:61-68,137-142`, `src/scrcmd.c:1876`,
`asm/macros/event.inc:1989`, `src/pokemon.c:2780`, `src/daycare.c:836`, and the pokeruby /
pokefirered equivalents); for Gen 4 the `StartWildBattle` / `StartLegendaryBattle` /
`StartGiratinaOriginBattle` / `StartFatefulEncounter` handlers (`pokeplatinum/src/scrcmd.c:4001-4037`),
`Encounter_NewVsSpeciesAtLevel` -> `CreateWildMon_Scripted` -> `CreateWildMon`
(`src/encounter.c:549-558`, `src/overlay006/wild_encounters.c:1227-1235`), `GivePokemon` ->
`Pokemon_InitWith` (`src/scrcmd_party.c:29-40`, `src/unk_02054884.c:44`), `GiveEgg` ->
`Egg_CreateEgg` (level 1, `src/overlay005/daycare.c:675`), roamers (`src/roaming_pokemon.c:291`),
and HGSS `WildBattle` -> `SetupAndStartWildBattle` -> `FieldSystem_GenerateSingleWildPokemon`
-> `generateWild{Shiny,NonShiny}AndAddToParty` (`pokeheartgold/src/scrcmd_c.c:2575-2580`,
`src/encounter.c:542-547`, `src/field/encounter_check.c:988-996`), `GiveMon` -> `CreateMon`
(`src/scrcmd_party.c:18-31`, `src/script_pokemon_util.c:33`), eggs (`SetEggStats(..., 1, ...)`),
starters (`src/choose_starter.c:59`), roamers (`src/field_roamer.c:174,210`, `src/scrcmd_c.c:3437-3439`).

Version-dependent HGSS entries cite the `GetGameVersion` branch: `VERSION_HEARTGOLD = 7`,
`VERSION_SOULSILVER = 8` (`pokeheartgold/include/config.h:9-10`). Lugia is L70 in HeartGold
and L45 in SoulSilver, Ho-Oh the reverse (`scr_seq_0104_D40R0107.s:70-85`,
`scr_seq_0021_D17R0110.s:58-73`); the Pewter City Enigma Stone static is Latios in HeartGold
and Latias in SoulSilver (`scr_seq_0750_T03.s:383-396`) while the **roamer** is the other one:
Steven's Vermilion script `Compare VAR_TEMP_x4004, 8` -> `CreateRoamer 3` (Latios) for
SoulSilver, else `CreateRoamer 2` (Latias) (`scr_seq_0776_T06.s:64-87`, `include/constants/roamer.h:6-7`).
Ruby/Sapphire aliases (`SPECIES_LATIAS_OR_LATIOS`, `SPECIES_GROUDON_OR_KYOGRE`) are resolved from
`pokeruby/constants/version.inc:21-31`.

Diamond/Pearl: pokediamond ships field scripts only as assembled binaries
(`files/fielddata/script/scr_seq_release/*.bin`) and its C has no roamer table, so the D/P
rows (`dp/...`, `d/legend/dialga`, `p/legend/palkia`, `gen4/event/manaphy-egg`) carry
`provenance: "pokefinder"` and `level_verified_against_decomp: false`. Where Platinum's
script proves a level that PokeFinder gives as `DPPt`, the entry is a `dppt/...` row citing
Platinum and noting that the D/P inclusion rests on PokeFinder (Riolu egg, Spiritomb, Uxie,
Azelf, Mesprit and Cresselia roamers).

## Verification record (this checkout)

Decomp commits: pokeruby `63a8cbf`, pokeemerald `83df84e`, pokefirered `df4449a`,
pokeplatinum `7c0aa10b`, pokeheartgold `814275e`, pokediamond `038cccae`; PokeFinder
`7adce35` with EncounterTableGenerator `9a2ed62`.

**(a) Wild tables vs PokeFinder's `EncounterTableGenerator`.** `--pokefinder` runs
PokeFinder's own `emerald/rs/frlg/pt/hgss/dp` generators, parses the packed records
(134 bytes Gen 3, 176 bytes DPPt, 196 bytes HGSS, layouts from its `pack.py`) and compares
every rate, species, level, form/letter, swarm, time-of-day, radar, radio and dual-slot value
with the table of the same location number:

| Game | PokeFinder records compared | Mismatches |
|---|---|---|
| Emerald | 86 | 0 |
| Ruby / Sapphire | 78 / 78 | 0 |
| FireRed / LeafGreen | 105 / 105 | 0 |
| Platinum | 122 | 0 |
| Diamond / Pearl | 122 / 122 | 0 |
| HeartGold / SoulSilver | 123 / 123 | 0 |

Two things looked like mismatches on the first run and were representation, not data:
PokeFinder packs a zero row for tables that have no land/radio section while the HGSS JSON
has an empty list (the comparison now pads); and PokeFinder skips duplicate tables, which is
why it has fewer records than we have maps (its location numbers still index our lists
directly). PokeFinder's Gen 3 JSON is a flattened copy of the same pret files, so agreement
there is expected; the Gen 4 comparison is against ROM dumps and is the real cross-check.

**(b) Gender bytes.** Snorlax `31` (12.5 % female) in Emerald, Ruby, FireRed, Platinum,
HeartGold and Diamond; Bulbasaur `31`; Nidoran♀ `254`, Nidoran♂ `0`; Magnemite `255`;
Chansey `254`, Tauros `0`, Pikachu `127`, Clefairy `191`, Growlithe `63`. Asserted by
`tests/test-data.cjs` for both generations, including "no per-game difference recorded".

**(c) Counts.** 386 Gen 3 species with dex 1..386 in order and internal ids skipping 252..276;
493 Gen 4 species with dex 1..493.

**(d) Determinism.** Two runs into different directories are byte-identical (`cmp` on all six
files); `--check` reports every file `unchanged`.

**Static catalogue vs PokeFinder's `encounters.json` (Gen 3 and Gen 4).** Every PokeFinder
entry (species, level, game set) has a matching entry here. Three entries here are not in
PokeFinder, all deliberate: the Emerald Mystery Gift Surfing Pichu egg
(`data/scripts/gift_pichu.inc:31`), the uncatchable ghost Marowak
(`PokemonTower_6F/scripts.inc:9`, `catchable: false`) and Platinum's Arceus at L80
(`scripts_hall_of_origin.s:46`). One correction went the other way: the first draft had the
HGSS Eon roamers inverted (HeartGold Latios / SoulSilver Latias); PokeFinder disagreed, and
the Vermilion script above proved PokeFinder right. The citation check does not catch a
wrong *version* assignment by itself, only a wrong species or level, which is why the
PokeFinder diff stays in the verification step.

**Test negative control.** `DATA_TEST_NEGATIVE=1 node tests/test-data.cjs` flips the
expected Snorlax byte to 30; the run fails with exactly the two Snorlax assertions
(`2 of 100 data checks failed`), exit 1.
