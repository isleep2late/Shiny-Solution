# Data module: `core/data/*.json`

Six JSON files generated from the pret decompilations by one script, and the decomp citation
registry `citations.json` generated from `docs/FACTS.md` (its own section at the end). They are the data
layer for the RNG guide wizard (design doc section 6.3): species tables, wild encounter
tables and the static/gift catalogue for Gen 3 and Gen 4. No engine reads the files: the
generator engines (`core/generators.js`, `app/Core/Generators.cs`) take these species and
slot records as arguments, `tools/build-generator-vectors.cjs` resolves PokeFinder's cases
against them, `tests/test-data.cjs` asserts them, and the web app's Wizard tab
(`webapp/wizard-ui.js`) resolves a picked game, table and static entry into the records the
engines take (`staticEntries`, `wildTables`, `slotsFor`).

Which heads load them, and how: the web app's **Wizard (Gen 3/4)** tab (`webapp/wizard-ui.js`)
and the desktop app's **Wizard (Gen 3/4)** tab (`app/App/WizardPanel.cs` over `WizardSupport.cs`)
are the consumers. `webapp/sync-core.sh` still writes `gen1-data.js` with `gen1-tid.json` /
`gen3-sid.json` / `gen2-tid.json` as globals (the Gen 2 tables are 1,034,046 bytes, read by the
Gen 2 TID tab as `window.ShinyGen2TidData`, so the plain mobile bundle is about 1.8 MB), and now
also writes `webapp/data/wizard-gen3.js` (1.26 MB: `window.ShinyWizardData3 = {species, encounters,
statics}`) and `webapp/data/wizard-gen4.js` (3.41 MB, `ShinyWizardData4`). The choice made for the
4.7 MB: **lazy load per generation on first use, as a script element**, not a fetch and not an
inline. The tab appends `<script src="data/wizard-genN.js">` when it is first opened (Emerald is
the default game, so the Gen 3 file) and when a game of the other generation is picked; nothing is
appended at page load, so the static site and the Electron `file://` page (`electron/build.sh`
copies both files into `electron/webapp/data/`) pay for the tables only when the wizard is used, and a script element
works over `file://` where `fetch` would be refused (the headless self-test `?wizselftest` in
`tests/run-tests.sh` loads them that way). The mobile bundle (`webapp/build-mobile-bundle.mjs`)
inlines neither file: it is one HTML string with no file beside it, so it sets
`window.SHINY_WIZARD_NO_DATA` before the tab's script and the tab states that its tables need the
static page or the Electron app. Served over http or https, the page's service worker (`webapp/sw.js`)
caches `data/wizard-genN.js` the first time it is requested and serves it from that cache afterwards
(cache-first, per build stamp), so the tables of a generation opened once online are there offline;
a generation never opened is not, and the tab reports the failed load. A per-game split was not taken: the encounter files are the bulk
and are read by one game at a time already, so splitting them would save a load only for a visitor
who never changes game.

The desktop app takes the other choice: the six files are **embedded in `ShinySolution.Core.dll`**
(`app/Core/ShinySolution.Core.csproj`, logical names `data.species-gen3` ... `data.statics-gen4`, 4.7 MB
in the self-contained single file, as `gen2-tid.json` already is), and `WizardData.Load(gen)` prefers the
three JSON files of a generation placed beside `ShinySolution.exe` (`species-genN.json`,
`encounters-genN.json`, `statics-genN.json`) over the embedded copies, so a regenerated table can be
dropped in without a rebuild. A generation is parsed on first use (the tab's game switch), not at start-up.

| File | Bytes | Content |
|---|---|---|
| `species-gen3.json` | 159,990 | 386 species: base stats, gender byte, abilities, egg groups, types (Emerald primary, Ruby/FireRed cross-checked) |
| `species-gen4.json` | 258,457 | 493 species (Platinum primary, HeartGold/Diamond cross-checked) plus the Gen 3 to Gen 4 difference list |
| `encounters-gen3.json` | 1,032,300 | wild tables for Ruby, Sapphire, Emerald, FireRed, LeafGreen; the Route 119 Feebas record (RSE) |
| `encounters-gen4.json` | 3,051,027 | wild tables for Platinum, HeartGold, SoulSilver, Diamond, Pearl; DPPt `encdata_ex` extras (honey trees, Trophy Garden dailies, Feebas, Great Marsh lookout), Unown form groups, swarm host maps; HGSS bug contest / safari / headbutt / swarm hosts |
| `statics-gen3.json` | 65,758 | 71 static, gift, egg, event and roamer entries with decomp citations |
| `statics-gen4.json` | 102,841 | 117 entries; Diamond/Pearl entries carry PokeFinder provenance |

## Regeneration

```
# ~/AI/pret below is the uncommitted local pret clones, not part of either repository
python3 tools/gen-guide-data.py                     # writes core/data/*.json from ~/AI/pret
python3 tools/gen-guide-data.py --check             # regenerates in memory, fails if core/data differs
python3 tools/gen-guide-data.py --pokefinder /tmp/PokeFinder/Core/Resources/EncounterTables   # a scratch clone, not committed
                                                    # --check, plus a diff against PokeFinder's generator output and
                                                    # its hard-coded Gen 4 tables; exit 1 on any mismatch that is not
                                                    # in KNOWN_DELIBERATE; nothing is written unless --write is added
python3 tools/gen-guide-data.py --relocate          # a moved citation line is reported with its new number (exit 1)
PRET_DIR=/elsewhere python3 tools/gen-guide-data.py # or --pret DIR
node tests/test-data.cjs                            # the data assertions (wired into tests/run-tests.sh)
DATA_TEST_NEGATIVE=1 node tests/test-data.cjs       # negative control: two Snorlax assertions made wrong on purpose
DATA_DIR=/tmp/mutated node tests/test-data.cjs      # run the assertions against another directory (a scratch copy, not committed)
```

Python 3 standard library only. The output is deterministic (sorted keys, custom
pretty-printer that keeps scalar-only objects on one line, no timestamps): running the
generator twice gives byte-identical files, which `--check` relies on. Every file carries
the commit of each decomp it was read from in `meta.sources`.

The generator refuses to run if any cited decomp line no longer contains the cited text
on **exactly** the cited line (no tolerance; see "Static catalogue" below), so a pret update
that moves a script line fails loudly instead of silently drifting. `--relocate` searches
+-40 lines and prints the corrected literals so they can be pasted back into the script.

`--pokefinder` is a check, not a write: it implies `--check`, compares every table and
every extra against PokeFinder, prints the known deliberate catalogue differences
(`KNOWN_DELIBERATE` in the script) separately from real mismatches, returns exit 1 when a
real mismatch exists, and removes its temporary directory.

Inputs (read-only, and not committed in either repository):
`~/AI/pret/{pokeruby,pokeemerald,pokefirered,pokeplatinum,pokeheartgold,pokediamond}`.
PokeFinder's `EncounterTableGenerator` submodule is only needed for `--pokefinder`; the
generator imports it in a subprocess with `PYTHONDONTWRITEBYTECODE=1` and writes its
`.bin` tables to a temporary directory (deleted afterwards), never into the clone. It also
reads `Core/Gen4/Encounters4.cpp` and `EncounterArea4.cpp` for the tables PokeFinder
hard-codes (Trophy Garden pools, Great Marsh lookout sets, honey tree hosts, Feebas, Unown).

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

`meta`: `species_count` (386), `generation`, `generator`, `primary_source`, `cross_checked_against`, `sources`
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

`meta` adds `names_source` (the HGSS message bank the English names come from),
`differences_from_gen3` and `warnings` (species-name disagreements between the three
personal tables; empty in this checkout). Same record shape plus:

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
| `index` | position in the version-filtered `gWildMonHeaders` list. This is PokeFinder's location number: its generator enumerates the same list and merely *skips* tables it does not expose (Altering Cave 2-9, eight *distinct* Mareep/Pineco/Houndour/Teddiursa/Aipom/Shuckle/Stantler/Smeargle tables that its generator comments as "8 unused tables", the "Unused" Cave of Origin tables, and floors that share a table), so Emerald has 124 maps here and 86 records there with the same numbering |
| `map`, `name`, `base_label` | `MAP_*` constant, a display name derived from it, the C label |
| `land` | `{rate, slots[12]}`; slots `{species, constant, min_level, max_level}` (Gen 3 land slots always have `min == max`) |
| `water`, `rock_smash` | `{rate, slots[5]}` |
| `fishing` | `{rate, old_rod[2], good_rod[3], super_rod[5]}` (the 10 JSON slots split by the file's `groups`) |
| `land.unown_letters`, `land.unown_letter_ids` | FRLG Tanoby chambers only: the Unown letter per land slot from `sUnownLetterSlots` (`pokefirered/src/wild_encounter.c:49-63`, chamber = map number minus Monean's, `:236-238`; ids 0-25 = A-Z, 26 = `!`, 27 = `?`) |

A section is absent when the map has no encounters of that kind (exactly as in the source JSON).
Level roll for water/rock/fishing: `min + Random() % (max - min + 1)` (`pokeemerald/src/wild_encounter.c:268-301`).

`games.<ruby|sapphire|emerald>.feebas`: the Route 119 Feebas record, which is not in any
table: `{species 349, min_level 20, max_level 25, map MAP_ROUTE119, index, any_rod, note,
sources}`. `FishingWildEncounter` first runs `CheckFeebas()` (Route 119, the rod tile is one
of the six Feebas tiles derived from the Dewford trend seed, and `Random() % 100 <= 49`) and
if it passes bypasses the fishing table for every rod with
`CreateWildMon(SPECIES_FEEBAS, ChooseWildMonLevel({20, 25}))`
(`pokeemerald/src/wild_encounter.c:67,137,784-788`; `pokeruby/src/wild_encounter.c:23,98,602-606`).
FireRed/LeafGreen have no Feebas code and carry no record.

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

`games.platinum.extra`: everything the wild generators need that is not in a per-map table.
`encdata_ex_order` lists the 12 members of `encdata_ex.narc`
(`res/field/encounters/encdata_ex.order`): 0-1 Feebas species/tiles, 2-4 honey tree
common/uncommon/rare, 5-7 the same three again (Pearl's unused copy), 8 Trophy Garden dailies,
9-11 Great Marsh lookout (with dex / without dex / binocular coordinates).

| Key | Content | Decomp |
|---|---|---|
| `honey_tree` | `common/uncommon/rare` (6 constants each, raw from `encounters_honey_tree.json`), `encdata_ex_members {2,3,4}`, `unused_pearl_members [5,6,7]`, `hosts[21]` (`MAP_HEADER_*` and the map's wild `table_index`, `null` for Eterna Forest outside and Floaroma Meadow which have `ENCOUNTERS_NONE`), `min_level 5`, `max_level 15`, `group_rates` (normal tree 10/70/20/0, Munchlax tree 9/20/70/1 for none/A/B/C), `slot_rates [40,20,20,10,5,5]`, `sources` | `overlay005/honey_tree.c:41,66,73,212,238,456,461`; level `overlay006/wild_encounters.c:1196,1208,1210` (`5 + LCRNG_RandMod(11)`, Hustle/Vital Spirit/Pressure `RandMod(2) != 0` forces 15); `include/field/field_system.h:44` |
| `great_marsh_lookout` | `before_national_dex[32]`, `after_national_dex[32]`, `binocular_coords[36]` (raw), `encdata_ex_members {9,10,11}`, `replaces_grass_slots [6,7]`, `sources` | `overlay006/great_marsh_daily_encounters.c:11,19,21,25` (member 9 with the dex, 10 without; index = 5 bits of `DAILY_MARSH` per area), `wild_encounters.c:1393` |
| `trophy_garden_daily` | `pool[16]` (`{species, constant}`, member 8), `table_index 117`, `replaces_grass_slots [6,7]`, `requires_national_dex`, `sources` | `overlay006/trophy_garden_daily_encounters.c:14,19,36` (`LCRNG_RandMod(16)` re-rolled until it differs from both current indices), `wild_encounters.c:209,216,336`, `include/special_encounter.h:13`, `src/map_header.c:201` |
| `feebas` | `species 349`, `min_level 10`, `max_level 20`, `table_index 22` (Mt. Coronet B1F), `map_dimensions [228,300]`, `tile_count 528`, `tiles[]` (map-tile indices, member 1), `encdata_ex_members {0,1}`, `all_rods`, `sources` | `wild_encounters.c:407,411,412` (facing one of the day's four Feebas tiles replaces all five slots of the rod table with Feebas), `overlay006/feebas_fishing.c:55,99,101,102,108`, `src/map_header.c:196` |
| `unown_tables` | `tables[8]`: `{unown_table 1..8, array, form_count, form_ids, letters}`; a table's `unown_table` value selects row value-1 (0 = no Unown); the form is `forms[LCRNG_Next() % form_count]`, one extra RNG call after the PID. Row 1 = the 20 forms of the dead-end rooms, rows 2-7 = F, R, I, N, E, D (table order), row 8 = `!`/`?` | `wild_encounters.c:116-179,1489,1541`, `include/constants/forms.h:21-48` |
| `swarm_hosts` | `hosts[22]` (`MAP_HEADER_*`, `table_index`), `replaces_grass_slots [0,1]` | `overlay006/swarm.c:12,37`, `include/overlay006/swarm.h:4`, `wild_encounters.c:195,202,335` (`DAILY_SWARM % 22` picks the host; grass slots 0 and 1 become the table's `swarm[0..1]`) |

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

`hgss_shared`: `bug_contest` (`files/data/mushi/mushi_encount.csv`: 40 slots = 4 areas x 10,
species, level range, rate, score), `safari_zone` (`files/arc/safari_enc.json`, raw: 12 areas,
land/surf/rods by time of day, block bonus tables), `headbutt` (`files/arc/headbutt.json`, raw,
the 60 tables that have trees; species that differ by version are `{"gold": .., "silver": ..}`
objects) and `swarm_hosts` (`hosts[20]`: `map`, `kind` land/surf/fish, `table_index`,
`table`; `src/unk_02097F6C.c:13,16,49`, `src/field/encounter_check.c:167,175,182`:
`Roamers_GetRand(2) % 20` picks the row; land replaces land slots 0-1 with `landSwarm`, surf
the surf slot with `surfSwarm`, fish the rod slots (old 2; good 0,2,3; super all) with
`fishSwarm`). Bug contest, safari and headbutt are carried verbatim (species as constants).

`games.diamond` / `games.pearl` (183 tables each): pokediamond has **no JSON or C form** of
the wild tables. What it does have is the retail NARC members committed as binaries,
`files/fielddata/encountdata/{d,p}_enc_data/narc_NNNN.bin` (git-tracked, 424 bytes each),
indexed by `wild_encounter_bank` in `pokediamond/arm9/src/map_header.c` and identical in
layout to Platinum's `WildEncounters` struct. The generator parses those with that layout
(`parse_dppt_bin`) and takes the map list from the `ENCDATA(NARC_d_enc_data_narc_NNNN_bin, ...)`
rows of `map_header.c`. The records are marked `provenance: EMPIRICAL (ROM dump carried by
the decomp)`: they are the same kind of source as PokeFinder's `d_enc_data.narc`, not
decompiled text. They match PokeFinder's diamond/pearl tables exactly (below).

`games.diamond.extra` / `games.pearl.extra`: the same `encdata_ex` archive read from
`pokediamond/files/arc/encdata_ex/narc_0000..0011.bin` (member sizes 4, 1068, 24 x 6, 64,
128, 128, 144; pokediamond has no decompiled reader, `arm9/src/filesystem.c:119` only names
the archive), parsed with the layouts of Platinum's converters
(`pokeplatinum/tools/jsoncnv/encdata_ex_{elusive_rod,honey_trees,trophy_garden,great_marsh}.py`)
and marked `provenance: EMPIRICAL`. Keys: `honey_tree` (Diamond reads members 2-4, Pearl 5-7,
the split `overlay005/honey_tree.c:452-458` keeps and PokeFinder `Gen4/dp.py:92-93` uses;
Diamond's common list has Silcoon where Pearl's has Cascoon), `feebas` (member 0 species,
member 1 tiles: the same 528 tiles as Platinum), `trophy_garden_daily` (member 8: Porygon
where Platinum has Ditto) and `great_marsh_lookout` (members 9-11). Their `min_level`/`max_level`
carry a `level_provenance` note: the numbers are Platinum's code, and PokeFinder applies the
same to D/P (`Gen4/pack.py:149-150`, `Core/Gen4/Encounters4.cpp:540-541`). `not_derivable`
names what pokediamond cannot give: swarm host maps, the Unown form groups (the D/P tables
carry the same `unown_table` ids 1..8, and PokeFinder applies one table to all of DPPt,
`Core/Gen4/EncounterArea4.cpp:23-30,93-112`) and honey tree host maps.

### Encounter kinds: present, deliberately out, pending

Present (per game unless noted): grass/land, surf, rock smash, old/good/super rod, Gen 3
Route 119 Feebas (RSE), FRLG Unown letters, DPPt swarm / day / night / radar / dual-slot species,
Platinum swarm hosts, DPPt Trophy Garden dailies, DPPt honey trees, DPPt Feebas tiles, DPPt Great
Marsh lookout, Platinum Unown form groups, HGSS morning/day/night, Hoenn/Sinnoh Sound, HGSS
swarm species and host maps, HGSS bug contest, safari zone (raw) and headbutt (raw).

Deliberately out: D/P swarm hosts, D/P Unown groups and D/P honey hosts (not in pokediamond's
C; see `not_derivable`); Gen 3 Feebas *tile* positions (a function of the Dewford trend seed,
not a table); the HGSS Safari Zone block-bonus arithmetic (carried raw, not derived). The
Gen 3 Altering Cave tables 2-9 are exported like every other `gWildMonHeaders` entry.

Pending (needed by the generators, not derived here yet): the HGSS safari and headbutt
records as `{species, constant, min_level, max_level}` slots rather than raw JSON.

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
| `location`, `held_item`, `form`, `shiny`, `catchable`, `notes` | `shiny: "always"` only for the Lake of Rage Gyarados (`WildBattle ..., 1`); `shiny: "never"` only for the Spiky-eared Pichu (fixed PID); `catchable: false` only for the ghost Marowak |
| `creation` | the call chain from the script command to `CreateMon`/`Pokemon_InitWith`/the wild generator, and which RNG method that implies (Method 1 for gifts, roamers and every Gen 3 static; the wild generator = Method J / K for Gen 4 scripted battles) |
| `sources[]` | `{repo, file, line, text}`: the decomp lines the entry rests on. The generator re-reads each line (no tolerance: the text must be on exactly that line) and aborts if the cited text is missing, so the species and level of every decomp-sourced entry are re-verified on every run; `--relocate` reports moved lines |
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
`pokeruby/constants/version.inc:21-31`. Suicune cites both scripted battle sites, Route 25
(`scr_seq_0216_R25.s:559`) and Burned Tower B1F (`scr_seq_0024_D18R0102.s:247`), both L40.

`hgss/gift/pichu-spiky-eared` is the one entry that is not RNG-manipulable: `GiveSpikyEarPichu`
(`scr_seq_0092_D36R0101.s:1910`, Ilex Forest shrine) creates it with a personality fixed by
`ChangePersonalityToNatureGenderAndAbility(trainer id, 0xac, NATURE_NAUGHTY, MON_FEMALE, 0, 0)`
(`src/field/scrcmd_pokemon_misc.c:1120-1121`), so only its IVs are rolled; it carries
`shiny: "never"` so the wizard can refuse it with the reason.

Deliberately out of the catalogue (fixed data or no decomp text): the HGSS NPC-trade loans
Shuckie (`scr_seq_0880_T24R0201.s:47 GiveLoanMon 6, 20, 75`) and Kenya
(`scr_seq_0241_R35R0101.s:61 GiveLoanMon 7, 20, 101`), created by `_CreateTradeMon` with the
trade record's fixed PID and OT (`src/npc_trade.c:191-197`); the other NPC trades likewise;
and the Diamond/Pearl Darkrai / Shaymin / Arceus event statics, for which pokediamond has no
text script and PokeFinder lists only the Platinum versions (its `events` category is
Manaphy x2, Darkrai and Shaymin, both `Game::Platinum`).

Diamond/Pearl: pokediamond ships field scripts only as assembled binaries
(`files/fielddata/script/scr_seq_release/*.bin`) and its C has no roamer table, so the D/P
rows (`dp/...`, `d/legend/dialga`, `p/legend/palkia`, `gen4/event/manaphy-egg`) carry
`provenance: "pokefinder"` and `level_verified_against_decomp: false`. Where Platinum's
script proves a level that PokeFinder gives as `DPPt`, the entry is a `dppt/...` row citing
Platinum and noting that the D/P inclusion rests on PokeFinder (Riolu egg, Spiritomb, Uxie,
Azelf, Mesprit and Cresselia roamers).

## `citations.json`: the decomp citation registry

Generated from `docs/FACTS.md` by `tools/gen-citations.py` (`python3 tools/gen-citations.py core/data/citations.json`,
pret at `~/AI/pret` or `--pret`; those clones are not committed in either repository). One entry per distinct citation, sorted by citation:

| key | content |
|---|---|
| `cite` | the citation as resolved, `repo/path:lines` (`pokeruby/src/rtc.c:13,134-140`) |
| `repo`, `path`, `lines` | its parts; `lines` is the list as written (`13,134-140`) |
| `as_written` | the text in FACTS.md (a bare `file.c:lines` inherits the repository of the previous full citation in its paragraph; `repo/.../file.c:lines` finds the one file of that name in the repository) |
| `section` | the heading path of FACTS.md it sits under, `H1 / H2 / H3` with trailing parentheses and backticks dropped (the first occurrence's) |
| `sections` | every such heading path that cites it, in FACTS.md order; `section` is the first |
| `facts_line` | the line of FACTS.md |
| `context` | that line, whitespace collapsed, cut at 240 characters |
| `first_line` | the text of the first cited line as read in pret, cut at 160 characters |
| `count` | how many times FACTS.md cites it |

The file also carries `pret` (the HEAD commit of each repository the entries were read in) and `skipped`: every
citation the generator could not resolve (a bare path with no repository in its paragraph, a file name that is
not unique) with the FACTS.md line and the reason, so nothing is dropped silently; a cited line past the end of its
file, or a range whose first cited line is blank or a lone brace (it points beside the routine it names), is an
error (exit 1), not a skip. Readers: `webapp/footnotes.js` (as `window.ShinyCitations`, written into
`gen1-data.js` by `sync-core.sh` and inlined by the mobile bundle; the Gen 1 TID, Gen 2 TID and wizard tabs render
their footnotes through it) and `app/App/Citations.cs` (embedded as `data.citations`, a `citations.json` beside the
executable preferred; the three desktop panels render through it): each protocol step, target line, schedule line
and verify line that rests on a mechanic is marked `[^n]` and the sources are listed under the protocol, a decomp
line with its FACTS.md section (`section`, or the one the source names, which must be in `sections`), SYNTHESISED for a source with no decomp line, or a measured constant under its
validation status word (EMULATOR-EXACT, HARDWARE-VALIDATED n or EMPIRICAL from the console's status in
`gen1-tid.json` and `gen2-tid.json`); a source the registry lacks is printed as NOT IN THE REGISTRY, which the tests
refuse. Every Gen 1 and Gen 2 citation of FACTS.md names its repository (pokered, pokeyellow, pokegold, pokecrystal),
so the file carries no skipped citation. `tests/run-tests.sh` regenerates the file when pret is present and requires
it byte-identical to the committed one.

## Verification record (this checkout)

Decomp commits: pokeruby `63a8cbf`, pokeemerald `83df84e`, pokefirered `df4449a`,
pokeplatinum `7c0aa10b`, pokeheartgold `814275e`, pokediamond `038cccae`; PokeFinder
`7adce35` with EncounterTableGenerator `9a2ed62`.

**(a) Wild tables vs PokeFinder's `EncounterTableGenerator`.** `--pokefinder` runs
PokeFinder's own `emerald/rs/frlg/pt/hgss/dp` generators plus its `honey`, `bug` and
`headbutt` packers, parses the packed records (134 bytes Gen 3, 176 bytes DPPt, 196 bytes
HGSS, 74 bytes honey and headbutt, 42 bytes per bug-contest area; layouts from its `pack.py`)
and compares every rate, species, level, form/letter, swarm, time-of-day, radar, radio and
dual-slot value with the table of the same location number:

| Game | PokeFinder records compared | Mismatches |
|---|---|---|
| Emerald | 86 | 0 |
| Ruby / Sapphire | 78 / 78 | 0 |
| FireRed / LeafGreen | 105 / 105 | 0 |
| Platinum | 122 | 0 |
| Diamond / Pearl | 122 / 122 | 0 |
| HeartGold / SoulSilver | 123 / 123 | 0 |
| Platinum / Diamond / Pearl honey trees (`pt/d/p_honey.bin`: 18 species, levels 5-15, 21 host locations) | 21 / 21 / 21 | 0 |
| HGSS bug contest (`hgss_bug.bin`, 4 areas x 10 slots) | 4 | 0 |
| HeartGold / SoulSilver headbutt (`hg/ss_headbutt.bin`, 12 tree + 6 special slots, special flag) | 59 / 59 | 0 |
| Trophy Garden pools vs `trophyGardenDP/Pt`, Great Marsh sets vs `greatMarsh{DP,DPDex,Pt,PtDex}`, Feebas vs `feebasLocation`/`Slot(349, 10, 20)`, Unown rows vs `unown0..7` and the eight `case` locations (`Core/Gen4/Encounters4.cpp:193-204,540-541`, `EncounterArea4.cpp:23-30,32-39,93-112`) | constants | 0 |

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
(species, level) pair is covered by entries here whose game sets together contain its games
(PokeFinder's `DPPt` starters and fossils, for instance, are matched by a `pt/` row citing
Platinum plus a `dp/` row with PokeFinder provenance). Four entries here are not in
PokeFinder, all deliberate and listed in `KNOWN_DELIBERATE`: the Emerald Mystery Gift Surfing
Pichu egg (`data/scripts/gift_pichu.inc:31`), the uncatchable ghost Marowak
(`PokemonTower_6F/scripts.inc:9`, `catchable: false`), Platinum's Arceus at L80
(`scripts_hall_of_origin.s:46`) and the Spiky-eared Pichu (`shiny: "never"`). Any other
difference makes `--pokefinder` exit 1. One correction went the other way: the first draft had the
HGSS Eon roamers inverted (HeartGold Latios / SoulSilver Latias); PokeFinder disagreed, and
the Vermilion script above proved PokeFinder right. The citation check does not catch a
wrong *version* assignment by itself, only a wrong species or level, which is why the
PokeFinder diff stays in the verification step.

**(e) Citations.** Every `sources` line is checked on exactly the cited line. Fourteen
literals (Platinum starters `choose_starter_app.c:50-52`, the five Platinum roamer species
and level lines in `roaming_pokemon.c:256-277`, `scrcmd_party.c:97`) had drifted by one or
two lines at the pinned commit and were corrected; the JSON already carried the resolved
numbers, so no data changed. `--relocate` demonstrates the check: citing `roaming_pokemon.c:255`
for `species = SPECIES_MESPRIT` aborts without it and reports `255 -> 256` with it.

**Test negative controls.** `DATA_TEST_NEGATIVE=1 node tests/test-data.cjs` flips the
expected Snorlax byte to 30; the run fails with exactly the two Snorlax assertions
(`2 of 128 data checks failed`), exit 1. Running the assertions with `DATA_DIR` pointing at
a copy in which every new extra field was altered (Trophy Garden Ditto/Porygon swapped, honey
members, Feebas levels and tile count, Unown letters, swarm host indices, Gen 3 Feebas levels,
the Pichu `shiny` flag, the second Suicune source) fails all 23 of the new assertions. The
`--pokefinder` comparisons were each shown to report when one value is mutated in memory
(trophy pool, honey list / level / host, Feebas level / location, Unown forms / table id, Great
Marsh lists, bug slot level, headbutt species / secret flag, a static's level, an un-allowlisted
extra static, and removing an id from `KNOWN_DELIBERATE`), returning 1 in every case and 0
on the unmodified data.
