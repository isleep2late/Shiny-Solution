#!/usr/bin/env python3
"""Regenerate core/data/*.json (species, wild encounter tables, static/gift catalogue)
from the pret decompilations under ~/AI/pret.  Python 3, standard library only.

    python3 tools/gen-guide-data.py                    # regenerate core/data/*.json
    python3 tools/gen-guide-data.py --check            # regenerate in memory, diff against core/data/
    python3 tools/gen-guide-data.py --pokefinder /tmp/PokeFinder/Core/Resources/EncounterTables
                                                       # ... and diff against PokeFinder's generator output

Outputs (all deterministic: sorted keys, no timestamps):
    core/data/species-gen3.json     core/data/species-gen4.json
    core/data/encounters-gen3.json  core/data/encounters-gen4.json
    core/data/statics-gen3.json     core/data/statics-gen4.json

docs/DATA.md documents every field and its provenance.  Every static/gift entry carries
`sources`; the generator re-reads each cited decomp line and refuses to run if the cited
text (species and level) is no longer there.
"""
import argparse
import csv
import io
import json
import os
import re
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PRET = os.environ.get("PRET_DIR", os.path.expanduser("~/AI/pret"))
GENERATOR = "tools/gen-guide-data.py"


# ----------------------------------------------------------------------------- helpers

def rd(repo, rel):
    with open(os.path.join(PRET, repo, rel), encoding="utf-8", errors="replace") as f:
        return f.read()


def rj(repo, rel):
    with open(os.path.join(PRET, repo, rel), encoding="utf-8") as f:
        return json.load(f)


def git_sha(repo):
    try:
        return subprocess.check_output(["git", "-C", os.path.join(PRET, repo), "rev-parse", "HEAD"],
                                       stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return None


DEFINE_RE = re.compile(r"^\s*#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)\b", re.M)


def parse_defines(text, prefix):
    out = {}
    for name, val in DEFINE_RE.findall(text):
        if name.startswith(prefix):
            out[name] = int(val, 0)
    return out


def parse_enum(text, first):
    """Values of an anonymous C enum starting at `first` (= 0), in declaration order."""
    i = text.index(first)
    j = text.index("}", i)
    names = re.findall(r"\b([A-Z][A-Z0-9_]+)\b\s*,?", text[i:j])
    return {n: k for k, n in enumerate(names)}


FIELD_RE = re.compile(r"\.(\w+)\s*=\s*(\{[^}]*\}|[^,\n]+)")


def iter_species_entries(text):
    """Yield (SPECIES_X, body) for every `[SPECIES_X] = { ... }` designated initializer."""
    for m in re.finditer(r"\[(SPECIES_\w+)\]\s*=\s*", text):
        pos = m.end()
        if pos >= len(text) or text[pos] != "{":
            continue
        depth, i = 0, pos
        while True:
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        yield m.group(1), text[pos + 1:i]


def brace_list(v):
    return [x.strip() for x in v.strip().strip("{}").split(",") if x.strip()]


def strip_prefix(name, prefix):
    return name[len(prefix):] if name.startswith(prefix) else name


def map_display_name(const):
    s = strip_prefix(const, "MAP_HEADER_")
    s = strip_prefix(s, "MAP_")
    s = strip_prefix(s, "MAPSEC_")
    s = re.sub(r"([A-Z])(\d)", r"\1 \2", s)
    return " ".join(w.capitalize() if len(w) > 2 or w.isalpha() else w for w in s.split("_"))


def _is_leaf(v):
    return not isinstance(v, (dict, list))


def _fmt(obj, indent):
    """Deterministic pretty-printer: sorted keys; dicts/lists made only of scalars stay on one line."""
    pad = " " * indent
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        if all(_is_leaf(v) for v in obj.values()):
            return "{" + ", ".join(json.dumps(k, ensure_ascii=False) + ": " + json.dumps(obj[k], ensure_ascii=False)
                                   for k in sorted(obj)) + "}"
        items = [pad + " " + json.dumps(k, ensure_ascii=False) + ": " + _fmt(obj[k], indent + 1) for k in sorted(obj)]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        if all(_is_leaf(v) for v in obj):
            return json.dumps(obj, ensure_ascii=False)
        return "[\n" + ",\n".join(pad + " " + _fmt(v, indent + 1) for v in obj) + "\n" + pad + "]"
    return json.dumps(obj, ensure_ascii=False)


def dump(obj):
    text = _fmt(obj, 0) + "\n"
    assert json.loads(text) == obj
    return text


# ----------------------------------------------------------------------------- Gen 3 species

GEN3_REPOS = {
    "emerald": dict(repo="pokeemerald", info="src/data/pokemon/species_info.h",
                    names="src/data/text/species_names.h",
                    dex=("enum", "include/constants/pokedex.h", "NATIONAL_DEX_NONE"),
                    egg=("define", "include/constants/pokemon.h")),
    "ruby": dict(repo="pokeruby", info="src/data/pokemon/base_stats.h",
                 names="src/data/text/species_names_en.h",
                 dex=("define", "include/constants/species.h", None),
                 egg=("enum", "include/pokemon.h")),
    "firered": dict(repo="pokefirered", info="src/data/pokemon/species_info.h",
                    names="src/data/text/species_names.h",
                    dex=("enum", "include/constants/pokedex.h", "NATIONAL_DEX_NONE"),
                    egg=("define", "include/constants/pokemon.h")),
}

STAT_KEYS = [("baseHP", "hp"), ("baseAttack", "atk"), ("baseDefense", "def"),
             ("baseSpeed", "spe"), ("baseSpAttack", "spa"), ("baseSpDefense", "spd")]


def gen3_gender_byte(val):
    """PERCENT_FEMALE(p) = min(254, (p * 255) / 100) truncated to u8 (species_info.h:3)."""
    val = val.strip()
    if val == "MON_GENDERLESS":
        return 255
    if val == "MON_MALE":
        return 0
    if val == "MON_FEMALE":
        return 254
    m = re.fullmatch(r"PERCENT_FEMALE\(([\d.]+)\)", val)
    if not m:
        raise ValueError("unknown gender ratio expression %r" % val)
    return min(254, int((float(m.group(1)) * 255) / 100))


def egg_name(const):
    n = strip_prefix(const, "EGG_GROUP_")
    return "UNDISCOVERED" if n == "NO_EGGS_DISCOVERED" else n


def parse_gen3_species(game):
    cfg = GEN3_REPOS[game]
    r = cfg["repo"]
    species_ids = parse_defines(rd(r, "include/constants/species.h"), "SPECIES_")
    ability_ids = parse_defines(rd(r, "include/constants/abilities.h"), "ABILITY_")
    type_ids = parse_defines(rd(r, "include/constants/pokemon.h"), "TYPE_")
    if cfg["egg"][0] == "enum":
        egg_ids = parse_enum(rd(r, cfg["egg"][1]), "EGG_GROUP_NONE")
    else:
        egg_ids = parse_defines(rd(r, cfg["egg"][1]), "EGG_GROUP_")
    if cfg["dex"][0] == "enum":
        dex_ids = parse_enum(rd(r, cfg["dex"][1]), cfg["dex"][2])
    else:
        dex_ids = parse_defines(rd(r, cfg["dex"][1]), "NATIONAL_DEX_")
    names = dict(re.findall(r'\[(SPECIES_\w+)\]\s*=\s*_\("([^"]*)"\)', rd(r, cfg["names"])))

    out = {}
    for const, body in iter_species_entries(rd(r, cfg["info"])):
        if const == "SPECIES_NONE" or const.startswith("SPECIES_OLD_UNOWN"):
            continue
        f = {k: v.strip() for k, v in FIELD_RE.findall(body)}
        if "types" in f:
            types = brace_list(f["types"])
        else:
            types = [f["type1"], f["type2"]]
        if "abilities" in f:
            abils = brace_list(f["abilities"])
        else:
            abils = [f["ability1"], f["ability2"]]
        if "eggGroups" in f:
            eggs = brace_list(f["eggGroups"])
        else:
            eggs = [f["eggGroup1"], f["eggGroup2"]]
        suffix = strip_prefix(const, "SPECIES_")
        out[const] = {
            "constant": const,
            "internal_id": species_ids[const],
            "dex": dex_ids["NATIONAL_DEX_" + suffix],
            "name": names[const],
            "base_stats": {short: int(f[key]) for key, short in STAT_KEYS},
            "types": [strip_prefix(t, "TYPE_") for t in types],
            "type_ids": [type_ids[t] for t in types],
            "gender_ratio": gen3_gender_byte(f["genderRatio"]),
            "abilities": [strip_prefix(a, "ABILITY_") for a in abils],
            "ability_ids": [ability_ids[a] for a in abils],
            "egg_groups": [egg_name(e) for e in eggs],
            "egg_group_ids": [egg_ids[e] for e in eggs],
        }
    return out, {"species": species_ids, "abilities": ability_ids, "types": type_ids, "eggs": egg_ids}


# abilities are compared by id: pokeheartgold spells some constants differently (ABILITY_COMPOUNDEYES,
# ABILITY_LIGHTNINGROD) from pokeemerald/pokeplatinum (ABILITY_COMPOUND_EYES, ABILITY_LIGHTNING_ROD)
COMPARE_FIELDS = ["base_stats", "types", "gender_ratio", "ability_ids", "egg_groups"]


def build_species_gen3():
    per_game = {g: parse_gen3_species(g) for g in GEN3_REPOS}
    primary, consts = per_game["emerald"]
    species = []
    for const in sorted(primary, key=lambda c: primary[c]["dex"]):
        rec = dict(primary[const])
        diffs = {}
        for g in ("ruby", "firered"):
            other = per_game[g][0].get(const)
            if other is None:
                diffs[g] = None
                continue
            d = {k: other[k] for k in COMPARE_FIELDS if other[k] != rec[k]}
            if d:
                diffs[g] = d
        if diffs:
            rec["game_differences"] = diffs
        species.append(rec)
    dexes = [s["dex"] for s in species]
    assert dexes == list(range(1, 387)), "Gen 3 dex numbering broken: %d entries" % len(dexes)
    meta = {
        "generation": 3,
        "generator": GENERATOR,
        "species_count": len(species),
        "primary_source": "pokeemerald/src/data/pokemon/species_info.h",
        "cross_checked_against": ["pokeruby/src/data/pokemon/base_stats.h",
                                  "pokefirered/src/data/pokemon/species_info.h"],
        "sources": {g: {"repo": GEN3_REPOS[g]["repo"], "commit": git_sha(GEN3_REPOS[g]["repo"]),
                        "files": [GEN3_REPOS[g]["info"], GEN3_REPOS[g]["names"],
                                  "include/constants/species.h", "include/constants/abilities.h",
                                  "include/constants/pokemon.h", GEN3_REPOS[g]["dex"][1],
                                  GEN3_REPOS[g]["egg"][1]]}
                    for g in GEN3_REPOS},
        "gender_ratio_byte": "PERCENT_FEMALE(p) = min(254, (p*255)/100) truncated to u8; "
                             "MON_MALE=0x00, MON_FEMALE=0xFE, MON_GENDERLESS=0xFF "
                             "(pokeemerald/src/data/pokemon/species_info.h:1-3, "
                             "include/constants/pokemon.h:169-171). female iff genderRatio > (PID & 0xFF)",
        "internal_id_note": "internal ids 1..411; 252..276 are SPECIES_OLD_UNOWN_B..Z placeholders and are omitted; "
                            "Hoenn species start at 277 (SPECIES_TREECKO). dex = national number",
        "hidden_ability": "none in Gen 3 (two ability slots; ability = PID & 1 only when slot 2 is non-zero)",
        "ability_ids": {str(v): strip_prefix(k, "ABILITY_") for k, v in sorted(consts["abilities"].items(), key=lambda kv: kv[1])},
        "type_ids": {str(v): strip_prefix(k, "TYPE_") for k, v in sorted(consts["types"].items(), key=lambda kv: kv[1])},
        "egg_group_ids": {str(v): egg_name(k) for k, v in sorted(consts["eggs"].items(), key=lambda kv: kv[1])},
    }
    return {"meta": meta, "species": species}


# ----------------------------------------------------------------------------- Gen 4 species

def gen4_gender_byte_from_fraction(frac):
    """pokeheartgold/include/constants/pokemon.h:364  GENDER_RATIO(frac) = frac <= 1 ? (u8)(frac * 254.75) : 255"""
    return int(frac * 254.75) if frac <= 1 else 255


def parse_gmm_rows(repo, rel):
    src = rd(repo, rel)
    rows = re.findall(r'<row id="[^"]+" index="(\d+)">.*?<language name="English">(.*?)</language>', src, re.S)
    return {int(i): t for i, t in rows}


def build_species_gen4(gen3):
    pt = "pokeplatinum"
    species_list = rd(pt, "generated/species.txt").split()
    gender_enum = {k: int(v) for k, v in re.findall(r"(\w+)\s*=\s*(\d+)", rd(pt, "generated/gender_ratios.txt"))}
    pt_abilities = rd(pt, "generated/abilities.txt").split()
    pt_eggs = rd(pt, "generated/egg_groups.txt").split()
    hg_abil = parse_defines(rd("pokeheartgold", "include/constants/abilities.h"), "ABILITY_")
    hg_types = parse_defines(rd("pokeheartgold", "include/constants/pokemon.h"), "TYPE_")
    hg_eggs = parse_defines(rd("pokeheartgold", "include/constants/pokemon.h"), "EGG_GROUP_")
    warnings = []
    for i, a in enumerate(pt_abilities):
        if a in hg_abil and hg_abil[a] != i:
            raise SystemExit("ability id disagreement %s: platinum %d heartgold %d" % (a, i, hg_abil[a]))
    for i, e in enumerate(pt_eggs):
        if e in hg_eggs and hg_eggs[e] != i:
            raise SystemExit("egg group id disagreement %s" % e)
    names = parse_gmm_rows("pokeheartgold", "files/msgdata/msg/msg_0817.gmm")
    hg = rj("pokeheartgold", "files/poketool/personal/personal.json")["baseStats"]
    dp = rj("pokediamond", "files/poketool/personal/personal.json")["baseStats"]

    dp_abil = parse_defines(rd("pokediamond", "include/constants/abilities.h"), "ABILITY_")

    def from_personal(rec, abil):
        return {
            "base_stats": {"hp": rec["hp"], "atk": rec["atk"], "def": rec["def"], "spe": rec["speed"],
                           "spa": rec["spatk"], "spd": rec["spdef"]},
            "types": [strip_prefix(t, "TYPE_") for t in rec["types"]],
            "gender_ratio": gen4_gender_byte_from_fraction(rec["genderRatio"]),
            "ability_ids": [abil[a] for a in rec["abilities"]],
            "egg_groups": [strip_prefix(e, "EGG_GROUP_") for e in rec["eggGroups"]],
        }

    species = []
    for sid in range(1, 494):
        const = species_list[sid]
        suffix = strip_prefix(const, "SPECIES_")
        data = rj(pt, "res/pokemon/%s/data.json" % suffix.lower())
        bs = data["base_stats"]
        rec = {
            "constant": const,
            "internal_id": sid,
            "dex": sid,
            "name": names[sid],
            "base_stats": {"hp": bs["hp"], "atk": bs["attack"], "def": bs["defense"], "spe": bs["speed"],
                           "spa": bs["special_attack"], "spd": bs["special_defense"]},
            "types": [strip_prefix(t, "TYPE_") for t in data["types"]],
            "type_ids": [hg_types[t] for t in data["types"]],
            "gender_ratio": gender_enum[data["gender_ratio"]],
            "gender_ratio_enum": data["gender_ratio"],
            "abilities": [strip_prefix(a, "ABILITY_") for a in data["abilities"]],
            "ability_ids": [pt_abilities.index(a) for a in data["abilities"]],
            "hidden_ability": None,
            "egg_groups": [strip_prefix(e, "EGG_GROUP_") for e in data["egg_groups"]],
            "egg_group_ids": [pt_eggs.index(e) for e in data["egg_groups"]],
        }
        diffs = {}
        for gname, table, abil in (("heartgold", hg, hg_abil), ("diamond", dp, dp_abil)):
            other = table[sid]
            if other["species"] != suffix:
                warnings.append("%s personal[%d] is %s, platinum %s" % (gname, sid, other["species"], suffix))
            o = from_personal(other, abil)
            d = {k: o[k] for k in COMPARE_FIELDS if o[k] != rec[k]}
            if d:
                diffs[gname] = d
        if diffs:
            rec["game_differences"] = diffs
        species.append(rec)

    g3 = {s["dex"]: s for s in gen3["species"]}
    changes = []
    for s in species:
        if s["dex"] in g3:
            for k in COMPARE_FIELDS:
                if g3[s["dex"]][k] != s[k]:
                    shown = "abilities" if k == "ability_ids" else k
                    changes.append({"dex": s["dex"], "constant": s["constant"], "field": shown,
                                    "gen3": g3[s["dex"]][shown], "gen4": s[shown]})
    meta = {
        "generation": 4,
        "generator": GENERATOR,
        "species_count": len(species),
        "primary_source": "pokeplatinum/res/pokemon/<species>/data.json (order: pokeplatinum/generated/species.txt)",
        "cross_checked_against": ["pokeheartgold/files/poketool/personal/personal.json",
                                  "pokediamond/files/poketool/personal/personal.json"],
        "names_source": "pokeheartgold/files/msgdata/msg/msg_0817.gmm (English species names, row index = species id)",
        "sources": {r: {"repo": r, "commit": git_sha(r)} for r in ("pokeplatinum", "pokeheartgold", "pokediamond")},
        "gender_ratio_byte": "Platinum stores the byte directly (pokeplatinum/generated/gender_ratios.txt: "
                             "MALE_ONLY=0, FEMALE_12_5=31, FEMALE_25=63, FEMALE_50=127, FEMALE_75=191, "
                             "FEMALE_87_5=223, FEMALE_ONLY=254, NO_GENDER=255); HGSS/DP JSON stores a fraction "
                             "converted by GENDER_RATIO(frac) = frac <= 1 ? (u8)(frac*254.75) : 255 "
                             "(pokeheartgold/include/constants/pokemon.h:364, pokediamond/include/constants/pokemon.h:309)",
        "hidden_ability": "not applicable: Gen 4 personal data has exactly two ability slots "
                          "(pokeplatinum data.json 'abilities'[2], pokeheartgold struct BaseStats abilities[2]); "
                          "hidden abilities were introduced in Gen 5",
        "internal_id_note": "Gen 4 internal id == national dex number for 1..493; 494+ are eggs and alternate forms (omitted)",
        "differences_from_gen3": changes,
        "warnings": warnings,
        "ability_ids": {str(i): strip_prefix(a, "ABILITY_") for i, a in enumerate(pt_abilities)},
        "type_ids": {str(v): strip_prefix(k, "TYPE_") for k, v in sorted(hg_types.items(), key=lambda kv: kv[1]) if v < 18},
        "egg_group_ids": {str(i): strip_prefix(e, "EGG_GROUP_") for i, e in enumerate(pt_eggs)},
    }
    return {"meta": meta, "species": species}


# ----------------------------------------------------------------------------- Gen 3 encounters

GEN3_RATES = {
    "land": [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1],
    "water": [60, 30, 5, 4, 1],
    "rock_smash": [60, 30, 5, 4, 1],
    "fishing": {"old_rod": [70, 30], "good_rod": [60, 20, 20], "super_rod": [40, 40, 15, 4, 1]},
}
UNOWN_LETTERS = [chr(ord("A") + i) for i in range(26)] + ["!", "?"]


def parse_unown_slots():
    src = rd("pokefirered", "src/wild_encounter.c")
    i = src.index("sUnownLetterSlots[][LAND_WILD_COUNT] =")
    j = src.index("};", i)
    rows = re.findall(r"\{\s*([\d\s,]+?)\s*\}", src[i:j])
    table = [[int(x) for x in r.split(",")] for r in rows]
    # map numbers come from data/maps/map_groups.json (include/constants/map_groups.h is a build artifact)
    groups = rj("pokefirered", "data/maps/map_groups.json")
    out = {}
    for gname in groups["group_order"]:
        folders = groups[gname]
        if "SevenIsland_TanobyRuins_MoneanChamber" not in folders:
            continue
        base = folders.index("SevenIsland_TanobyRuins_MoneanChamber")
        for num, folder in enumerate(folders):
            if "TanobyRuins" in folder and folder.endswith("Chamber"):
                const = rj("pokefirered", "data/maps/%s/map.json" % folder)["id"]
                out[const] = table[num - base]
    assert len(out) == 7 and len(table) == 7, (len(out), len(table))
    return out


def build_encounters_gen3(species3):
    by_const = {s["constant"]: s for s in species3["species"]}
    unown = parse_unown_slots()
    games = {}
    for game, repo, marker in (("ruby", "pokeruby", "Ruby"), ("sapphire", "pokeruby", "Sapphire"),
                               ("emerald", "pokeemerald", None),
                               ("firered", "pokefirered", "FireRed"), ("leafgreen", "pokefirered", "LeafGreen")):
        data = rj(repo, "src/data/wild_encounters.json")
        group = [g for g in data["wild_encounter_groups"] if g["label"] == "gWildMonHeaders"][0]
        fields = {f["type"]: f for f in group["fields"]}
        assert fields["land_mons"]["encounter_rates"] == GEN3_RATES["land"]
        assert fields["water_mons"]["encounter_rates"] == GEN3_RATES["water"]
        assert fields["rock_smash_mons"]["encounter_rates"] == GEN3_RATES["rock_smash"]
        assert fields["fishing_mons"]["encounter_rates"] == [70, 30, 60, 20, 20, 40, 40, 15, 4, 1]
        fg = fields["fishing_mons"]["groups"]
        encs = [e for e in group["encounters"] if marker is None or marker in e["base_label"]]

        def slot(m):
            s = by_const[m["species"]]
            return {"species": s["dex"], "constant": m["species"],
                    "min_level": m["min_level"], "max_level": m["max_level"]}

        maps = []
        for idx, e in enumerate(encs):
            rec = {"index": idx, "map": e["map"], "name": map_display_name(e["map"]), "base_label": e["base_label"]}
            for key, out in (("land_mons", "land"), ("water_mons", "water"), ("rock_smash_mons", "rock_smash")):
                if key in e:
                    rec[out] = {"rate": e[key]["encounter_rate"], "slots": [slot(m) for m in e[key]["mons"]]}
            if "fishing_mons" in e:
                slots = [slot(m) for m in e["fishing_mons"]["mons"]]
                rec["fishing"] = {"rate": e["fishing_mons"]["encounter_rate"],
                                  "old_rod": [slots[i] for i in fg["old_rod"]],
                                  "good_rod": [slots[i] for i in fg["good_rod"]],
                                  "super_rod": [slots[i] for i in fg["super_rod"]]}
            if e["map"] in unown and "land" in rec:
                rec["land"]["unown_letters"] = [UNOWN_LETTERS[x] for x in unown[e["map"]]]
                rec["land"]["unown_letter_ids"] = list(unown[e["map"]])
            maps.append(rec)
        games[game] = {"source": "%s/src/data/wild_encounters.json (gWildMonHeaders%s)" % (
            repo, ", base_label containing '%s'" % marker if marker else ""),
            "commit": git_sha(repo), "map_count": len(maps), "maps": maps}
    meta = {
        "generation": 3,
        "generator": GENERATOR,
        "slot_rates": GEN3_RATES,
        "slot_rate_sources": {
            "emerald": "pokeemerald/src/wild_encounter.c:182-262 (ChooseWildMonIndex_Land/WaterRock/Fishing: Random()%100 "
                       "against cumulative 20/40/50/60/70/80/85/90/94/98/99; water 60/90/95/99; old rod 70; good 60/80; "
                       "super 40/80/95/99)",
            "ruby": "pokeruby/src/wild_encounter.c:144-230 (same tables)",
            "firered": "pokefirered/src/wild_encounter.c:71-130 (same tables)",
            "json": "encounter_rates arrays in each src/data/wild_encounters.json wild_encounter_groups[].fields",
        },
        "index_note": "index = position in the version-filtered gWildMonHeaders list; this equals PokeFinder's "
                      "EncounterTableGenerator location number before its duplicate-table skips",
        "species_note": "species = national dex number (Gen 3 internal ids are in species-gen3.json)",
        "level_note": "land slots use min_level == max_level in all Gen 3 games; water/rock/fishing roll "
                      "min_level + Random() % (max_level - min_level + 1) (pokeemerald/src/wild_encounter.c:268-301)",
        "unown_note": "FRLG Tanoby chambers: the letter per land slot comes from sUnownLetterSlots "
                      "(pokefirered/src/wild_encounter.c:49-63, chamber = mapNum - Monean chamber, :236-238); "
                      "letter ids 0-25 = A-Z, 26 = !, 27 = ?",
    }
    return {"meta": meta, "games": games}


# ----------------------------------------------------------------------------- Gen 4 encounters

GEN4_RATES = {
    "dppt": {"grass": [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1], "surf": [60, 30, 5, 4, 1],
             "old_rod": [60, 30, 5, 4, 1], "good_rod": [40, 40, 15, 4, 1], "super_rod": [40, 40, 15, 4, 1]},
    "hgss": {"grass": [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1], "surf": [60, 30, 5, 4, 1],
             "fishing_all_rods": [40, 30, 15, 10, 5], "rock_smash": [80, 20], "headbutt": [50, 15, 15, 10, 5, 5]},
}


def parse_pt_map_headers():
    src = rd("pokeplatinum", "include/data/map_headers.h")
    entries = re.findall(r"\[(MAP_HEADER_[A-Z0-9_]+)\]\s*=\s*\{(.*?)\n    \}", src, re.S)
    by_table = {}
    for name, body in entries:
        enc = re.search(r"\.wildEncountersArchiveID\s*=\s*(\w+)", body).group(1)
        by_table.setdefault(enc, []).append(name)
    return by_table


def build_platinum(species4):
    pt = "pokeplatinum"
    species_list = rd(pt, "generated/species.txt").split()
    sid = {c: i for i, c in enumerate(species_list)}
    order = rd(pt, "res/field/encounters/encounters.order").split()
    headers = parse_pt_map_headers()

    def sp(c):
        return {"species": sid[c], "constant": c}

    def dyn(m):
        return {"species": sid[m["species"]], "constant": m["species"],
                "min_level": m["level_min"], "max_level": m["level_max"]}

    tables = []
    for idx, name in enumerate(order):
        d = rj(pt, "res/field/encounters/%s.json" % name)
        rec = {
            "index": idx, "table": name, "maps": headers.get(name, []),
            "names": sorted({map_display_name(m) for m in headers.get(name, [])}),
            "grass": {"rate": d["land_rate"],
                      "slots": [{"species": sid[m["species"]], "constant": m["species"], "level": m["level"]}
                                for m in d["land_encounters"]]},
            "swarm": [sp(c) for c in d["swarms"]],
            "day": [sp(c) for c in d["day"]],
            "night": [sp(c) for c in d["night"]],
            "radar": [sp(c) for c in d["radar"]],
            "form_rates": [d["rate_form%d" % i] for i in range(5)],
            "unown_table": d["unown_table"],
            "dual_slot": {g: [sp(c) for c in d[g]] for g in ("ruby", "sapphire", "emerald", "firered", "leafgreen")},
            "surf": {"rate": d["surf_rate"], "slots": [dyn(m) for m in d["surf_encounters"]]},
            "old_rod": {"rate": d["old_rod_rate"], "slots": [dyn(m) for m in d["old_rod_encounters"]]},
            "good_rod": {"rate": d["good_rod_rate"], "slots": [dyn(m) for m in d["good_rod_encounters"]]},
            "super_rod": {"rate": d["super_rod_rate"], "slots": [dyn(m) for m in d["super_rod_encounters"]]},
            "map_category": d.get("map_category"),
        }
        tables.append(prune_empty(rec, ("grass", "surf", "old_rod", "good_rod", "super_rod"), ("swarm", "day", "night", "radar")))
    extra = {}
    for name in ("encounters_honey_tree", "encounters_great_marsh_lookout"):
        extra[strip_prefix(name, "encounters_")] = rj(pt, "res/field/encounters/%s.json" % name)
    return {
        "source": "pokeplatinum/res/field/encounters/*.json in encounters.order (= pl_enc_data.narc index); "
                  "maps from pokeplatinum/include/data/map_headers.h wildEncountersArchiveID",
        "commit": git_sha(pt),
        "struct": "pokeplatinum/include/overlay006/wild_encounters.h:8-47 (WildEncounters)",
        "table_count": len(tables), "tables": tables, "extra": extra,
    }


def prune_empty(rec, slot_keys, list_keys):
    """Drop encounter sections that carry no data (rate 0 and every species SPECIES_NONE); an absent key
    means 'no encounters of this kind on this table'."""
    for k in slot_keys:
        sec = rec.get(k)
        if sec is not None and sec["rate"] == 0 and all(s["species"] == 0 for s in sec["slots"]):
            del rec[k]
    for k in list_keys:
        if k in rec and all(s["species"] == 0 for s in rec[k]):
            del rec[k]
    if "dual_slot" in rec and all(s["species"] == 0 for v in rec["dual_slot"].values() for s in v):
        del rec["dual_slot"]
    if "form_rates" in rec and not any(rec["form_rates"]):
        del rec["form_rates"]
    return rec


def pick(v, ver):
    if isinstance(v, dict) and ("HEARTGOLD" in v or "SOULSILVER" in v):
        return v[ver]
    return v


def build_hgss(species4):
    hg = "pokeheartgold"
    species_list = rd("pokeplatinum", "generated/species.txt").split()
    sid = {c: i for i, c in enumerate(species_list)}
    banks = {"ENCDATA_" + n: int(i) for n, i in
             re.findall(r"#define ENCDATA_(\w+)\s+ENCDATA\(_(\d+)\)", rd(hg, "include/encounter_tables_narc.h"))}
    hdr = rd(hg, "src/data/map_headers.h")
    by_bank = {}
    for name, bank, mapsec in re.findall(
            r"\[(MAP_\w+)\]\s*=\s*\{\s*\.wildEncounterBank = (\w+),.*?\.mapsec = (\w+),", hdr, re.S):
        if bank in banks:
            by_bank.setdefault(banks[bank], []).append({"map": name, "mapsec": mapsec})
    encs = rj(hg, "files/fielddata/encountdata/gs_enc_data.json")["encounters"]
    versions = {}
    for game, ver in (("heartgold", "HEARTGOLD"), ("soulsilver", "SOULSILVER")):
        def sp(c):
            c = pick(c, ver)
            return {"species": sid[c], "constant": c}

        def dyn(m):
            c = pick(m["species"], ver)
            return {"species": sid[c], "constant": c,
                    "min_level": pick(m["level"]["min"], ver), "max_level": pick(m["level"]["max"], ver)}

        tables = []
        for idx, e in enumerate(encs):
            land = []
            for m in e["land"]["mons"]:
                land.append({"level": pick(m["level"], ver),
                             "morning": sp(m["species"]["morn"]), "day": sp(m["species"]["day"]),
                             "night": sp(m["species"]["nite"])})
            rec = {
                "index": idx, "table": e["map"],
                "maps": [x["map"] for x in by_bank.get(idx, [])],
                "names": sorted({map_display_name(x["mapsec"]) for x in by_bank.get(idx, [])}),
                "land": {"rate": e["land"]["rate"], "slots": land},
                "hoenn_sound": [sp(c) for c in e["hoenn"]],
                "sinnoh_sound": [sp(c) for c in e["sinnoh"]],
                "surf": {"rate": e["surf"]["rate"], "slots": [dyn(m) for m in e["surf"]["mons"]]},
                "rock_smash": {"rate": e["rock_smash"]["rate"], "slots": [dyn(m) for m in e["rock_smash"]["mons"]]},
                "old_rod": {"rate": e["fishing"]["old_rod"]["rate"], "slots": [dyn(m) for m in e["fishing"]["old_rod"]["mons"]]},
                "good_rod": {"rate": e["fishing"]["good_rod"]["rate"], "slots": [dyn(m) for m in e["fishing"]["good_rod"]["mons"]]},
                "super_rod": {"rate": e["fishing"]["super_rod"]["rate"], "slots": [dyn(m) for m in e["fishing"]["super_rod"]["mons"]]},
                "swarm": {k: sp(e[j]) for k, j in
                          (("land", "landSwarm"), ("surf", "surfSwarm"), ("night_fish", "nightFish"), ("fish", "fishSwarm")) if j in e},
            }
            if not rec["swarm"]:
                del rec["swarm"]
            tables.append(prune_empty(rec, ("land", "surf", "rock_smash", "old_rod", "good_rod", "super_rod"), ("hoenn_sound", "sinnoh_sound")))
        versions[game] = {"source": "pokeheartgold/files/fielddata/encountdata/gs_enc_data.json (%s branch); "
                                    "maps from pokeheartgold/src/data/map_headers.h wildEncounterBank via "
                                    "include/encounter_tables_narc.h" % ver,
                          "commit": git_sha(hg),
                          "struct": "pokeheartgold/include/wild_encounter.h:17-56 (EncounterData)",
                          "table_count": len(tables), "tables": tables}
    bug = []
    for row in csv.DictReader(io.StringIO(rd(hg, "files/data/mushi/mushi_encount.csv"))):
        bug.append({"species": sid[row["species"]], "constant": row["species"], "min_level": int(row["lvlmin"]),
                    "max_level": int(row["lvlmax"]), "rate": int(row["rate"]), "score": int(row["score"])})
    safari = rj(hg, "files/arc/safari_enc.json")["encounters"]
    headbutt = [t for t in rj(hg, "files/arc/headbutt.json")["tables"] if t["CommonMons"] or t["RareMons"] or t["SecretMons"]]
    shared = {"bug_contest": {"source": "pokeheartgold/files/data/mushi/mushi_encount.csv", "slots": bug},
              "safari_zone": {"source": "pokeheartgold/files/arc/safari_enc.json (raw; species constants)", "areas": safari},
              "headbutt": {"source": "pokeheartgold/files/arc/headbutt.json (raw; only non-empty maps)", "tables": headbutt}}
    return versions, shared


def parse_dppt_bin(b):
    """WildEncounters (pokeplatinum/include/overlay006/wild_encounters.h:8-47), little-endian, 424 bytes."""
    assert len(b) == 424, len(b)
    off = 0

    def u32():
        nonlocal off
        v = struct.unpack_from("<I", b, off)[0]
        off += 4
        return v

    def s8():
        nonlocal off
        v = struct.unpack_from("<b", b, off)[0]
        off += 1
        return v

    rec = {"grass_rate": u32(), "grass": []}
    for _ in range(12):
        lvl = s8()
        off += 3
        rec["grass"].append((lvl, u32()))
    rec["swarm"] = [u32(), u32()]
    rec["day"] = [u32(), u32()]
    rec["night"] = [u32(), u32()]
    rec["radar"] = [u32() for _ in range(4)]
    rec["form_rates"] = [u32() for _ in range(5)]
    rec["unown_table"] = u32()
    for g in ("ruby", "sapphire", "emerald", "firered", "leafgreen"):
        rec[g] = [u32(), u32()]
    for key in ("surf", "unused", "old_rod", "good_rod", "super_rod"):
        rate = u32()
        slots = []
        for _ in range(5):
            mx, mn = s8(), s8()
            off += 2
            slots.append((mn, mx, u32()))
        rec[key] = {"rate": rate, "slots": slots}
    assert off == 424
    return rec


def build_dp(species4):
    dia = "pokediamond"
    species_list = rd("pokeplatinum", "generated/species.txt").split()
    hdr = rd(dia, "arm9/src/map_header.c")
    by_index = {}
    for d_idx, p_idx, mapsec, mapname in re.findall(
            r"ENCDATA\(NARC_d_enc_data_narc_(\d+)_bin, NARC_p_enc_data_narc_(\d+)_bin\).*?(MAPSEC_\w+).*?// (MAP_\w+)", hdr):
        assert d_idx == p_idx
        by_index.setdefault(int(d_idx), []).append({"map": mapname, "mapsec": mapsec})
    games = {}
    for game, folder in (("diamond", "d_enc_data"), ("pearl", "p_enc_data")):
        base = os.path.join(PRET, dia, "files/fielddata/encountdata", folder)
        files = sorted(f for f in os.listdir(base) if f.endswith(".bin"))
        tables = []

        def sp(i):
            return {"species": i, "constant": species_list[i]}

        for idx, fn in enumerate(files):
            assert fn == "narc_%04d.bin" % idx
            with open(os.path.join(base, fn), "rb") as f:
                r = parse_dppt_bin(f.read())
            rec = {
                "index": idx, "table": folder + "/" + fn,
                "maps": [x["map"] for x in by_index.get(idx, [])],
                "names": sorted({map_display_name(x["mapsec"]) for x in by_index.get(idx, [])}),
                "grass": {"rate": r["grass_rate"], "slots": [dict(sp(s), level=l) for l, s in r["grass"]]},
                "swarm": [sp(i) for i in r["swarm"]], "day": [sp(i) for i in r["day"]],
                "night": [sp(i) for i in r["night"]], "radar": [sp(i) for i in r["radar"]],
                "form_rates": r["form_rates"], "unown_table": r["unown_table"],
                "dual_slot": {g: [sp(i) for i in r[g]] for g in ("ruby", "sapphire", "emerald", "firered", "leafgreen")},
            }
            for key in ("surf", "old_rod", "good_rod", "super_rod"):
                rec[key] = {"rate": r[key]["rate"],
                            "slots": [dict(sp(s), min_level=mn, max_level=mx) for mn, mx, s in r[key]["slots"]]}
            tables.append(prune_empty(rec, ("grass", "surf", "old_rod", "good_rod", "super_rod"), ("swarm", "day", "night", "radar")))
        games[game] = {
            "source": "pokediamond/files/fielddata/encountdata/%s/narc_NNNN.bin (binary NARC members committed in the "
                      "decomp tree, extracted from the retail ROM; no JSON/C form exists in pokediamond). Parsed with "
                      "the Platinum WildEncounters layout (pokeplatinum/include/overlay006/wild_encounters.h:8-47, "
                      "424 bytes) which pokediamond/include/map_header.h wild_encounter_bank indexes; maps from "
                      "pokediamond/arm9/src/map_header.c ENCDATA(...) rows" % folder,
            "commit": git_sha(dia),
            "provenance": "EMPIRICAL (ROM dump carried by the decomp) rather than decomp source; identical in kind "
                          "to PokeFinder's d_enc_data.narc/p_enc_data.narc",
            "table_count": len(tables), "tables": tables,
        }
    return games


def build_encounters_gen4(species4):
    games = {"platinum": build_platinum(species4)}
    hgss, shared = build_hgss(species4)
    games.update(hgss)
    games.update(build_dp(species4))
    meta = {
        "generation": 4,
        "generator": GENERATOR,
        "slot_rates": GEN4_RATES,
        "slot_rate_sources": {
            "dppt": "pokeplatinum/src/overlay006/wild_encounters.c:820-915 (GetGroundEncounterSlot, GetWaterEncounterSlot, "
                    "GetRodEncounterSlot: LCRNG_RandMod(100) against cumulative 20/40/50/60/70/80/85/90/94/98/99; "
                    "water 60/90/95/99; old rod 60/90/95/99; good and super rod 40/80/95/99)",
            "hgss": "pokeheartgold/src/field/encounter_check.c:631-716 (EncounterSlot_WildMonSlotRoll_Land/Surfing/Fishing/"
                    "RockSmash/Headbutt: LCRandRange(100); land as DPPt; surf 60/90/95/99; fishing 40/70/85/95 for every rod; "
                    "rock smash 80; headbutt 50/65/80/90/95)",
        },
        "level_note": "DPPt grass slots carry one fixed level; surf/fishing roll min..max. HGSS land slots carry one level "
                      "shared by the morning/day/night species (pokeheartgold/include/wild_encounter.h:23-28) and the level "
                      "roll is still spent (encounter_check.c:893).",
        "species_note": "species = national dex number = Gen 4 internal id",
        "index_note": "index = NARC member index (= PokeFinder's location number). Platinum: encounters.order; "
                      "HGSS: gs_enc_data.json order; D/P: narc_NNNN.bin",
    }
    return {"meta": meta, "games": games, "hgss_shared": shared}


# ----------------------------------------------------------------------------- static catalogue

RSE = ["ruby", "sapphire", "emerald"]
RS = ["ruby", "sapphire"]
E = ["emerald"]
FRLG = ["firered", "leafgreen"]
FR = ["firered"]
LG = ["leafgreen"]
DPPT = ["diamond", "pearl", "platinum"]
DP = ["diamond", "pearl"]
PT = ["platinum"]
HGSS = ["heartgold", "soulsilver"]
HG = ["heartgold"]
SS = ["soulsilver"]
GEN4_ALL = DPPT + HGSS

G3_GIFT = ("givemon -> ScriptGiveMon -> CreateMon(species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0): "
           "PID then IV words from the main RNG (Method 1)")
G3_STARTER = ("special ChooseStarter -> ScriptGiveMon(starter, 5, ITEM_NONE) -> CreateMon(..., USE_RANDOM_IVS, ..., "
              "OT_ID_PLAYER_ID): Method 1")
G3_WILD = ("setwildbattle -> CreateScriptedWildMon -> CreateMon(&gEnemyParty[0], species, level, USE_RANDOM_IVS, 0, 0, "
           "OT_ID_PLAYER_ID, 0): Method 1")
G3_EVENT = ("seteventmon -> special CreateEnemyEventMon -> CreateEventMon(&gEnemyParty[0], species, level, USE_RANDOM_IVS, "
            "FALSE, 0, OT_ID_PLAYER_ID, 0): Method 1, fateful-encounter flag")
G3_EGG = ("giveegg -> egg; on hatching CreateMon(species, EGG_HATCH_LEVEL=5, ...); the egg PID is split "
          "(R/S/FRLG: low half at trigger, high half at pickup; Emerald: high half from Random2) - see the design doc 5.3")
G3_ROAMER = ("CreateMon(species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0) when the roamer is created: "
             "Method 1 (R/S and FRLG then keep only the low IV bits, PokeFinder's buggedRoamer)")
G4_PT_GIFT = ("GivePokemon -> Pokemon_GiveMonFromScript -> Pokemon_InitWith(mon, species, level, INIT_IVS_RANDOM, FALSE, 0, "
              "OTID_NOT_SET, 0): Method 1")
G4_PT_WILD = ("StartWildBattle -> Encounter_NewVsSpeciesAtLevel -> CreateWildMon_Scripted -> CreateWildMon: the wild "
              "generator (Method J, lead-ability effects apply)")
G4_PT_LEGEND = ("StartLegendaryBattle -> Encounter_NewVsSpeciesAtLevel(isLegendary=TRUE) -> CreateWildMon_Scripted -> "
                "CreateWildMon: the wild generator (Method J), BATTLE_STATUS_LEGENDARY")
G4_PT_FATEFUL = ("StartFatefulEncounter -> Encounter_NewFatefulVsSpeciesAtLevel -> CreateWildMon_Scripted (Method J) "
                 "then MON_DATA_FATEFUL_ENCOUNTER")
G4_PT_GIRATINA = "StartGiratinaOriginBattle -> Encounter_NewVsGiratinaOrigin: wild generator (Method J), Origin form"
G4_PT_EGG = "GiveEgg -> Egg_CreateEgg -> Pokemon_InitWith(egg, species, 1, INIT_IVS_RANDOM, FALSE, 0, OTID_NOT_SET, 0): level-1 egg"
G4_PT_ROAMER = ("RoamingPokemon_ActivateSlot -> Pokemon_InitWith(mon, species, level, INIT_IVS_RANDOM, FALSE, 0, OTID_SET, "
                "TrainerInfo_ID_LowHalf): Method 1")
G4_HG_GIFT = "GiveMon -> GiveMon() -> CreateMon(mon, species, level, 32, FALSE, 0, 0, 0): Method 1"
G4_HG_STARTER = ("choose_starter.c creates the three starters in a row with CreateMon(mon, species[i], 5, 32, FALSE, 0, "
                 "OT_ID_PLAYER_ID, 0): Method 1, starter i at advance 4*i")
G4_HG_WILD = ("WildBattle species, level, shiny -> SetupAndStartWildBattle -> FieldSystem_GenerateSingleWildPokemon -> "
              "generateWildNonShinyAndAddToParty: the wild generator (Method K)")
G4_HG_SHINY = ("WildBattle ..., shiny=1 -> FieldSystem_GenerateSingleWildPokemon(shiny=TRUE) -> "
               "generateWildShinyAndAddToParty: forced shiny")
G4_HG_TRAP = "RocketTrapBattle -> SetupAndStartWildBattle(canFlee=FALSE, shiny=FALSE): Method K"
G4_HG_EGG = "GiveEgg -> SetEggStats(mon, species, 1, ...): level-1 egg"
G4_HG_ROAMER = "CreateMon(mon, species, level, 32, FALSE, 0, OT_ID_PRESET, TID) when the roamer is created: Method 1"
G4_DP_PF = ("not derivable from pokediamond (field scripts exist only as binary scr_seq_release/*.bin); level and "
            "location carried from PokeFinder Gen4/encounters.json")

GEN3_HANDLERS = [
    ("pokeemerald", "src/script_pokemon_util.c", 61, "ScriptGiveMon(u16 species, u8 level"),
    ("pokeemerald", "src/script_pokemon_util.c", 68, "CreateMon(&mon, species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokeemerald", "src/script_pokemon_util.c", 137, "CreateScriptedWildMon(u16 species, u8 level, u16 item)"),
    ("pokeemerald", "src/script_pokemon_util.c", 142, "CreateMon(&gEnemyParty[0], species, level, USE_RANDOM_IVS, 0, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokeemerald", "src/scrcmd.c", 1876, "CreateScriptedWildMon(species, level, item)"),
    ("pokeemerald", "asm/macros/event.inc", 1989, ".macro seteventmon species:req, level:req"),
    ("pokeemerald", "src/pokemon.c", 2780, "CreateEventMon(&gEnemyParty[0], species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokeemerald", "src/daycare.c", 836, "CreateMon(mon, species, EGG_HATCH_LEVEL, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokeemerald", "include/constants/daycare.h", 17, "#define EGG_HATCH_LEVEL 5"),
    ("pokeruby", "src/contest_util.c", 418, "CreateMon(&mon, species, level, 32, 0, 0, 0, 0)"),
    ("pokeruby", "src/contest_util.c", 492, "CreateMon(&gEnemyParty[0], species, level, 0x20, 0, 0, 0, 0)"),
    ("pokeruby", "src/daycare.c", 695, "CreateMon(mon, species, EGG_HATCH_LEVEL, 0x20, FALSE, 0, FALSE, 0)"),
    ("pokefirered", "src/script_pokemon_util.c", 55, "CreateMon(mon, species, level, 32, 0, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokefirered", "src/script_pokemon_util.c", 133, "CreateMon(&gEnemyParty[0], species, level, 32, 0, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokefirered", "src/pokemon.c", 6222, "CreateEventMon(&gEnemyParty[0], species, level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokefirered", "src/daycare.c", 1095, "CreateMon(mon, species, EGG_HATCH_LEVEL, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)"),
]
GEN4_HANDLERS = [
    ("pokeplatinum", "src/scrcmd.c", 4001, "ScrCmd_StartWildBattle(ScriptContext *ctx)"),
    ("pokeplatinum", "src/scrcmd.c", 4007, "Encounter_NewVsSpeciesAtLevel(ctx->task, species, level, battleResultMaskPtr, FALSE)"),
    ("pokeplatinum", "src/scrcmd.c", 4017, "Encounter_NewVsSpeciesAtLevel(ctx->task, species, level, battleResultMaskPtr, TRUE)"),
    ("pokeplatinum", "src/scrcmd.c", 4027, "Encounter_NewVsGiratinaOrigin(ctx->task, species, level, battleResultMaskPtr, TRUE)"),
    ("pokeplatinum", "src/scrcmd.c", 4037, "Encounter_NewFatefulVsSpeciesAtLevel(ctx->task, species, level, battleResultMaskPtr, TRUE)"),
    ("pokeplatinum", "src/encounter.c", 549, "void Encounter_NewVsSpeciesAtLevel(FieldTask *task, u16 species, u8 level, int *resultMaskPtr, BOOL isLegendary)"),
    ("pokeplatinum", "src/encounter.c", 558, "CreateWildMon_Scripted(fieldSystem, species, level, dto)"),
    ("pokeplatinum", "src/encounter.c", 970, "void Encounter_NewVsGiratinaOrigin(FieldTask *task, u16 species, u8 level, int *resultMaskPtr, BOOL isLegendary)"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1227, "void CreateWildMon_Scripted(FieldSystem *fieldSystem, u16 species, u8 level, FieldBattleDTO *battleParams)"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1235, "CreateWildMon(species, level, 1, &encounterFieldParams, firstPartyMon, battleParams)"),
    ("pokeplatinum", "src/scrcmd_party.c", 29, "BOOL ScrCmd_GivePokemon(ScriptContext *ctx)"),
    ("pokeplatinum", "src/scrcmd_party.c", 40, "Pokemon_GiveMonFromScript(HEAP_ID_FIELD2, fieldSystem->saveData, species, level, heldItem, metLocation, metTerrain)"),
    ("pokeplatinum", "src/unk_02054884.c", 44, "Pokemon_InitWith(mon, species, level, INIT_IVS_RANDOM, FALSE, 0, OTID_NOT_SET, 0)"),
    ("pokeplatinum", "src/scrcmd_party.c", 95, "Egg_CreateEgg(egg, species, 1, trainer, 3, specialMetLoc)"),
    ("pokeplatinum", "src/overlay005/daycare.c", 675, "Pokemon_InitWith(egg, species, 1, INIT_IVS_RANDOM, FALSE, 0, OTID_NOT_SET, 0)"),
    ("pokeplatinum", "src/roaming_pokemon.c", 291, "Pokemon_InitWith(roamerMonData, species, level, INIT_IVS_RANDOM, FALSE, 0, OTID_SET, TrainerInfo_ID_LowHalf(trainer))"),
    ("pokeheartgold", "src/scrcmd_c.c", 2575, "BOOL ScrCmd_WildBattle(ScriptContext *ctx)"),
    ("pokeheartgold", "src/scrcmd_c.c", 2580, "SetupAndStartWildBattle(ctx->taskman, species, level, winFlag, TRUE, shiny)"),
    ("pokeheartgold", "src/scrcmd_c.c", 2567, "BOOL ScrCmd_RocketTrapBattle(ScriptContext *ctx)"),
    ("pokeheartgold", "src/encounter.c", 542, "void SetupAndStartWildBattle(TaskManager *taskManager, u16 species, u8 level, u32 *winFlag, BOOL canFlee, BOOL shiny)"),
    ("pokeheartgold", "src/encounter.c", 547, "FieldSystem_GenerateSingleWildPokemon(fieldSystem, species, level, shiny, setup)"),
    ("pokeheartgold", "src/field/encounter_check.c", 988, "void FieldSystem_GenerateSingleWildPokemon(FieldSystem *fieldSystem, u16 species, u8 level, BOOL shiny, BattleSetup *battleSetup)"),
    ("pokeheartgold", "src/field/encounter_check.c", 994, "generateWildShinyAndAddToParty(species, level, BATTLER_ENEMY, otid, &encounterGen, leadMon, battleSetup)"),
    ("pokeheartgold", "src/field/encounter_check.c", 996, "generateWildNonShinyAndAddToParty(species, level, BATTLER_ENEMY, FALSE, &encounterGen, leadMon, battleSetup)"),
    ("pokeheartgold", "src/scrcmd_party.c", 18, "BOOL ScrCmd_GiveMon(ScriptContext *ctx)"),
    ("pokeheartgold", "src/scrcmd_party.c", 31, "GiveMon(HEAP_ID_FIELD2, fieldSystem->saveData, species, level, form, ability, heldItem, map, 24)"),
    ("pokeheartgold", "src/script_pokemon_util.c", 33, "CreateMon(mon, species, level, 32, FALSE, 0, 0, 0)"),
    ("pokeheartgold", "src/scrcmd_party.c", 92, "SetEggStats(mon, species, 1, profile, 3, val)"),
    ("pokeheartgold", "src/choose_starter.c", 59, "CreateMon(mon, species[i], 5, 32, FALSE, 0, OT_ID_PLAYER_ID, 0)"),
    ("pokeheartgold", "src/field_roamer.c", 210, "CreateMon(mon, species, level, 32, FALSE, 0, OT_ID_PRESET, PlayerProfile_GetTrainerID_VisibleHalf(profile))"),
    ("pokeheartgold", "include/config.h", 9, "#define VERSION_HEARTGOLD  7"),
    ("pokeheartgold", "src/scrcmd_c.c", 3437, "BOOL ScrCmd_CreateRoamer(ScriptContext *ctx)"),
    ("pokeheartgold", "src/scrcmd_c.c", 3439, "Save_CreateRoamerByID(ctx->fieldSystem->saveData, roamerNo)"),
    ("pokeheartgold", "src/field_roamer.c", 174, "void Save_CreateRoamerByID(SaveData *saveData, u8 idx)"),
]

_LINE_CACHE = {}


def cite(repo, rel, line, must_contain):
    """Return a source record after checking that `must_contain` is on the cited line (+-3 lines)."""
    key = (repo, rel)
    if key not in _LINE_CACHE:
        _LINE_CACHE[key] = rd(repo, rel).split("\n")
    lines = _LINE_CACHE[key]
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    for delta in (0, -1, 1, -2, 2, -3, 3):
        n = line + delta
        if 1 <= n <= len(lines) and norm(must_contain) in norm(lines[n - 1]):
            return {"repo": repo, "file": rel, "line": n, "text": norm(lines[n - 1])}
    raise SystemExit("citation check failed: %s/%s:%d does not contain %r (line is %r)" % (
        repo, rel, line, must_contain, lines[line - 1].strip() if line <= len(lines) else "<eof>"))


def scr(name):
    return "data/maps/%s/scripts.inc" % name


def pts(name):
    return "res/field/scripts/scripts_%s.s" % name


def hgs(name):
    return "files/fielddata/script/scr_seq/scr_seq_%s.s" % name


def make_catalogue(entries, species_by_const, gen, extra_meta):
    out = []
    ids = set()
    for e in entries:
        s = species_by_const[e["species"]]
        rec = {
            "id": e["id"], "category": e["category"], "games": e["games"],
            "species": s["dex"], "constant": e["species"], "name": s["name"],
            "level": e["level"], "location": e["location"],
            "held_item": e.get("held_item"), "form": e.get("form"), "shiny": e.get("shiny"),
            "catchable": e.get("catchable", True),
            "creation": e["creation"],
            "provenance": e.get("provenance", "decomp"),
            "sources": [cite(*c) for c in e.get("sources", [])],
            "notes": e.get("notes"),
        }
        if gen == 3:
            rec["internal_id"] = s["internal_id"]
        assert rec["id"] not in ids, rec["id"]
        ids.add(rec["id"])
        rec["level_verified_against_decomp"] = bool(e.get("sources")) and e.get("provenance", "decomp") == "decomp"
        out.append(rec)
    meta = {"generation": gen, "generator": GENERATOR, "entry_count": len(out),
            "categories": sorted({r["category"] for r in out}),
            "verification": "every entry's `sources` lines were re-read at generation time and must contain the cited "
                            "text (species and level); level_verified_against_decomp is false only for entries whose "
                            "provenance is PokeFinder (no text script in the decomp)"}
    meta.update(extra_meta)
    return {"meta": meta, "entries": out}


def gen3_static_entries():
    ent = []

    def add(id, category, games, species, level, location, creation, sources, **kw):
        ent.append(dict(id=id, category=category, games=games, species=species, level=level, location=location,
                        creation=creation, sources=sources, **kw))

    # --- starters
    for sp in ("TREECKO", "TORCHIC", "MUDKIP"):
        add("rse/starter/" + sp.lower(), "starter", RSE, "SPECIES_" + sp, 5, "Route 101 (Birch's bag)", G3_STARTER, [
            ("pokeemerald", scr("Route101"), 228, "special ChooseStarter"),
            ("pokeemerald", "src/battle_setup.c", 923, "ScriptGiveMon(starterMon, 5, ITEM_NONE, 0, 0, 0)"),
            ("pokeemerald", "src/starter_choose.c", 115 + ["TREECKO", "TORCHIC", "MUDKIP"].index(sp), "SPECIES_" + sp),
            ("pokeruby", "src/battle_setup.c", 877, "ScriptGiveMon(starterPoke, 5, ITEM_NONE, 0, 0, 0)"),
            ("pokeruby", "src/starter_choose.c", 50, "sStarterMons[] = {SPECIES_TREECKO, SPECIES_TORCHIC, SPECIES_MUDKIP}")])
    for sp, line in (("CHIKORITA", 418), ("CYNDAQUIL", 336), ("TOTODILE", 377)):
        add("e/starter/" + sp.lower(), "starter", E, "SPECIES_" + sp, 5, "Littleroot Town, Birch's Lab (after the Hoenn Dex)",
            G3_GIFT, [("pokeemerald", scr("LittlerootTown_ProfessorBirchsLab"), line, "givemon SPECIES_%s, 5" % sp)])
    for sp, line in (("BULBASAUR", 1073), ("SQUIRTLE", 1216), ("CHARMANDER", 1229)):
        add("frlg/starter/" + sp.lower(), "starter", FRLG, "SPECIES_" + sp, 5, "Pallet Town, Oak's Lab", G3_GIFT, [
            ("pokefirered", scr("PalletTown_ProfessorOaksLab"), 1122, "givemon PLAYER_STARTER_SPECIES, 5"),
            ("pokefirered", scr("PalletTown_ProfessorOaksLab"), line, "setvar PLAYER_STARTER_SPECIES, SPECIES_" + sp)])
    # --- fossils
    for sp, el, rl in (("LILEEP", 146, 145), ("ANORITH", 191, 165)):
        add("rse/fossil/" + sp.lower(), "fossil", RSE, "SPECIES_" + sp, 20, "Rustboro City, Devon Corp. 2F", G3_GIFT, [
            ("pokeemerald", scr("RustboroCity_DevonCorp_2F"), el, "givemon SPECIES_%s, 20" % sp),
            ("pokeruby", scr("RustboroCity_DevonCorp_2F"), rl, "givemon SPECIES_%s, 20, ITEM_NONE" % sp)])
    for sp, line in (("OMANYTE", 201), ("KABUTO", 212), ("AERODACTYL", 223)):
        add("frlg/fossil/" + sp.lower(), "fossil", FRLG, "SPECIES_" + sp, 5, "Cinnabar Island, Pokemon Lab", G3_GIFT,
            [("pokefirered", scr("CinnabarIsland_PokemonLab_ExperimentRoom"), line, "givemon SPECIES_%s, 5" % sp)])
    # --- gifts and eggs
    add("rse/gift/castform", "gift", RSE, "SPECIES_CASTFORM", 25, "Route 119, Weather Institute 2F", G3_GIFT, [
        ("pokeemerald", scr("Route119_WeatherInstitute_2F"), 85, "givemon SPECIES_CASTFORM, 25, ITEM_MYSTIC_WATER"),
        ("pokeruby", scr("Route119_WeatherInstitute_2F"), 65, "givemon SPECIES_CASTFORM, 25, ITEM_MYSTIC_WATER")],
        held_item="ITEM_MYSTIC_WATER")
    add("rse/gift/beldum", "gift", RSE, "SPECIES_BELDUM", 5, "Mossdeep City, Steven's house", G3_GIFT, [
        ("pokeemerald", scr("MossdeepCity_StevensHouse"), 86, "givemon SPECIES_BELDUM, 5"),
        ("pokeruby", scr("MossdeepCity_StevensHouse"), 85, "givemon SPECIES_BELDUM, 5, ITEM_NONE")])
    add("rse/egg/wynaut", "egg", RSE, "SPECIES_WYNAUT", 5, "Lavaridge Town (hot spring old lady)", G3_EGG, [
        ("pokeemerald", scr("LavaridgeTown"), 245, "giveegg SPECIES_WYNAUT"),
        ("pokeruby", scr("LavaridgeTown"), 287, "giveegg SPECIES_WYNAUT"),
        ("pokeemerald", "src/daycare.c", 836, "CreateMon(mon, species, EGG_HATCH_LEVEL"),
        ("pokeemerald", "include/constants/daycare.h", 17, "#define EGG_HATCH_LEVEL 5")],
        notes="level = hatch level")
    add("e/event/pichu-egg", "event", E, "SPECIES_PICHU", 5, "Mystery Gift (Surfing Pichu egg)", G3_EGG,
        [("pokeemerald", "data/scripts/gift_pichu.inc", 31, "giveegg SPECIES_PICHU")],
        notes="e-Reader/Mystery Gift distribution script; level = hatch level")
    for sp, line in (("HITMONLEE", 25), ("HITMONCHAN", 46)):
        add("frlg/gift/" + sp.lower(), "gift", FRLG, "SPECIES_" + sp, 25, "Saffron City, Fighting Dojo", G3_GIFT, [
            ("pokefirered", scr("SaffronCity_Dojo"), 59, "givemon VAR_TEMP_1, 25"),
            ("pokefirered", scr("SaffronCity_Dojo"), line, "setvar VAR_TEMP_1, SPECIES_" + sp)])
    add("frlg/gift/magikarp", "gift", FRLG, "SPECIES_MAGIKARP", 5, "Route 4, Pokemon Center (Magikarp salesman)", G3_GIFT,
        [("pokefirered", scr("Route4_PokemonCenter_1F"), 49, "givemon SPECIES_MAGIKARP, 5")])
    add("frlg/gift/lapras", "gift", FRLG, "SPECIES_LAPRAS", 25, "Silph Co. 7F", G3_GIFT,
        [("pokefirered", scr("SilphCo_7F"), 121, "givemon SPECIES_LAPRAS, 25")])
    add("frlg/gift/eevee", "gift", FRLG, "SPECIES_EEVEE", 25, "Celadon City, Celadon Condominiums roof", G3_GIFT,
        [("pokefirered", scr("CeladonCity_Condominiums_RoofRoom"), 12, "givemon SPECIES_EEVEE, 25")])
    add("frlg/egg/togepi", "egg", FRLG, "SPECIES_TOGEPI", 5, "Five Island, Water Labyrinth", G3_EGG, [
        ("pokefirered", scr("FiveIsland_WaterLabyrinth"), 33, "giveegg SPECIES_TOGEPI"),
        ("pokefirered", "src/daycare.c", 1095, "CreateMon(mon, species, EGG_HATCH_LEVEL"),
        ("pokefirered", "include/constants/daycare.h", 17, "#define EGG_HATCH_LEVEL 5")],
        notes="level = hatch level")
    # --- game corner
    gc = scr("CeladonCity_GameCorner_PrizeRoom")
    for game, gl, sp, level, line in (
            (FR, "fr", "ABRA", 9, 124), (LG, "lg", "ABRA", 7, 127), (FR, "fr", "CLEFAIRY", 8, 135), (LG, "lg", "CLEFAIRY", 12, 138),
            (FR, "fr", "DRATINI", 18, 146), (LG, "lg", "DRATINI", 24, 149), (FR, "fr", "SCYTHER", 25, 156),
            (FR, "fr", "PORYGON", 26, 162), (LG, "lg", "PORYGON", 18, 165), (LG, "lg", "PINSIR", 18, 172)):
        add("%s/game-corner/%s" % (gl, sp.lower()), "game_corner", game, "SPECIES_" + sp, level, "Celadon City, Game Corner prize room",
            G3_GIFT, [("pokefirered", gc, line, "givemon VAR_TEMP_1, %d" % level)],
            notes="species chosen by the prize menu (VAR_TEMP_1); FireRed/LeafGreen branches are .ifdef in the script")
    # --- stationary
    add("rse/static/kecleon", "stationary", RSE, "SPECIES_KECLEON", 30, "Route 119 / Route 120 (Devon Scope)", G3_WILD, [
        ("pokeemerald", scr("Route120"), 193, "setwildbattle SPECIES_KECLEON, 30"),
        ("pokeemerald", "data/scripts/kecleon.inc", 74, "setwildbattle SPECIES_KECLEON, 30"),
        ("pokeruby", scr("Route120"), 222, "setwildbattle SPECIES_KECLEON, 30, ITEM_NONE"),
        ("pokeruby", "data/scripts/static_pokemon.inc", 106, "setwildbattle SPECIES_KECLEON, 30, ITEM_NONE")])
    add("rse/static/voltorb", "stationary", RSE, "SPECIES_VOLTORB", 25, "New Mauville (three item balls)", G3_WILD, [
        ("pokeemerald", scr("NewMauville_Inside"), 179, "setwildbattle SPECIES_VOLTORB, 25"),
        ("pokeemerald", scr("NewMauville_Inside"), 203, "setwildbattle SPECIES_VOLTORB, 25"),
        ("pokeemerald", scr("NewMauville_Inside"), 227, "setwildbattle SPECIES_VOLTORB, 25"),
        ("pokeruby", scr("NewMauville_Inside"), 166, "setwildbattle SPECIES_VOLTORB, 25, ITEM_NONE")])
    add("rse/static/electrode", "stationary", RSE, "SPECIES_ELECTRODE", 30, "Magma Hideout (Ruby) / Aqua Hideout (Sapphire, Emerald) item balls",
        G3_WILD, [
            ("pokeemerald", scr("AquaHideout_B1F"), 32, "setwildbattle SPECIES_ELECTRODE, 30"),
            ("pokeemerald", scr("AquaHideout_B1F"), 56, "setwildbattle SPECIES_ELECTRODE, 30"),
            ("pokeruby", "data/scripts/static_pokemon.inc", 4, "setwildbattle SPECIES_ELECTRODE, 30, ITEM_NONE"),
            ("pokeruby", "data/scripts/static_pokemon.inc", 19, "setwildbattle SPECIES_ELECTRODE, 30, ITEM_NONE")])
    add("e/static/sudowoodo", "stationary", E, "SPECIES_SUDOWOODO", 40, "Battle Frontier (Wailmer Pail)", G3_WILD,
        [("pokeemerald", scr("BattleFrontier_OutsideEast"), 129, "setwildbattle SPECIES_SUDOWOODO, 40")])
    add("frlg/static/snorlax", "stationary", FRLG, "SPECIES_SNORLAX", 30, "Route 12 / Route 16 (Poke Flute)", G3_WILD, [
        ("pokefirered", scr("Route12"), 22, "setwildbattle SPECIES_SNORLAX, 30"),
        ("pokefirered", scr("Route16"), 40, "setwildbattle SPECIES_SNORLAX, 30")])
    add("frlg/static/electrode", "stationary", FRLG, "SPECIES_ELECTRODE", 34, "Power Plant item balls", G3_WILD, [
        ("pokefirered", scr("PowerPlant"), 75, "setwildbattle SPECIES_ELECTRODE, 34"),
        ("pokefirered", scr("PowerPlant"), 101, "setwildbattle SPECIES_ELECTRODE, 34")])
    add("frlg/static/hypno", "stationary", FRLG, "SPECIES_HYPNO", 30, "Three Island, Berry Forest", G3_WILD,
        [("pokefirered", scr("ThreeIsland_BerryForest"), 24, "setwildbattle SPECIES_HYPNO, 30")])
    add("frlg/static/marowak-ghost", "stationary", FRLG, "SPECIES_MAROWAK", 30, "Pokemon Tower 6F (ghost Marowak)", G3_WILD,
        [("pokefirered", scr("PokemonTower_6F"), 9, "setwildbattle SPECIES_MAROWAK, 30")],
        catchable=False, notes="cannot be caught; listed because it is a scripted static in the decomp")
    # --- legendaries
    for sp, mp, el, rl in (("REGIROCK", "DesertRuins", 64, 61), ("REGICE", "IslandCave", 97, 80), ("REGISTEEL", "AncientTomb", 64, 61)):
        add("rse/legend/" + sp.lower(), "legendary", RSE, "SPECIES_" + sp, 40, map_display_name("MAP_" + re.sub(r"(?<!^)(?=[A-Z])", "_", mp).upper()),
            G3_WILD, [("pokeemerald", scr(mp), el, "setwildbattle SPECIES_%s, 40" % sp),
                      ("pokeruby", scr(mp), rl, "setwildbattle SPECIES_%s, 40, ITEM_NONE" % sp)])
    add("e/legend/latias", "legendary", E, "SPECIES_LATIAS", 50, "Southern Island (the Eon not chosen to roam)", G3_EVENT,
        [("pokeemerald", scr("SouthernIsland_Interior"), 109, "seteventmon SPECIES_LATIAS, 50, ITEM_SOUL_DEW"),
         ("pokeemerald", scr("SouthernIsland_Interior"), 78, "special BattleSetup_StartLatiBattle")], held_item="ITEM_SOUL_DEW")
    add("e/legend/latios", "legendary", E, "SPECIES_LATIOS", 50, "Southern Island (the Eon not chosen to roam)", G3_EVENT,
        [("pokeemerald", scr("SouthernIsland_Interior"), 105, "seteventmon SPECIES_LATIOS, 50, ITEM_SOUL_DEW")], held_item="ITEM_SOUL_DEW")
    add("ruby/legend/latias", "legendary", ["ruby"], "SPECIES_LATIAS", 50, "Southern Island", G3_WILD, [
        ("pokeruby", scr("SouthernIsland_Interior"), 64, "setwildbattle SPECIES_LATIAS_OR_LATIOS, 50, ITEM_SOUL_DEW"),
        ("pokeruby", "constants/version.inc", 30, ".set SPECIES_LATIAS_OR_LATIOS, SPECIES_LATIAS")], held_item="ITEM_SOUL_DEW")
    add("sapphire/legend/latios", "legendary", ["sapphire"], "SPECIES_LATIOS", 50, "Southern Island", G3_WILD, [
        ("pokeruby", scr("SouthernIsland_Interior"), 64, "setwildbattle SPECIES_LATIAS_OR_LATIOS, 50, ITEM_SOUL_DEW"),
        ("pokeruby", "constants/version.inc", 28, ".set SPECIES_LATIAS_OR_LATIOS, SPECIES_LATIOS")], held_item="ITEM_SOUL_DEW")
    add("ruby/legend/groudon", "legendary", ["ruby"], "SPECIES_GROUDON", 45, "Cave of Origin B4F", G3_WILD, [
        ("pokeruby", scr("CaveOfOrigin_B4F"), 57, "setwildbattle SPECIES_GROUDON_OR_KYOGRE, 45, ITEM_NONE"),
        ("pokeruby", "constants/version.inc", 24, ".set SPECIES_GROUDON_OR_KYOGRE, SPECIES_GROUDON")])
    add("sapphire/legend/kyogre", "legendary", ["sapphire"], "SPECIES_KYOGRE", 45, "Cave of Origin B4F", G3_WILD, [
        ("pokeruby", scr("CaveOfOrigin_B4F"), 57, "setwildbattle SPECIES_GROUDON_OR_KYOGRE, 45, ITEM_NONE"),
        ("pokeruby", "constants/version.inc", 22, ".set SPECIES_GROUDON_OR_KYOGRE, SPECIES_KYOGRE")])
    add("e/legend/kyogre", "legendary", E, "SPECIES_KYOGRE", 70, "Marine Cave", G3_WILD,
        [("pokeemerald", scr("MarineCave_End"), 36, "setwildbattle SPECIES_KYOGRE, 70")])
    add("e/legend/groudon", "legendary", E, "SPECIES_GROUDON", 70, "Terra Cave", G3_WILD,
        [("pokeemerald", scr("TerraCave_End"), 36, "setwildbattle SPECIES_GROUDON, 70")])
    add("rse/legend/rayquaza", "legendary", RSE, "SPECIES_RAYQUAZA", 70, "Sky Pillar top", G3_WILD, [
        ("pokeemerald", scr("SkyPillar_Top"), 49, "setwildbattle SPECIES_RAYQUAZA, 70"),
        ("pokeruby", scr("SkyPillar_Top"), 16, "setwildbattle SPECIES_RAYQUAZA, 70, ITEM_NONE")])
    for sp, mp, line, level, loc in (("ARTICUNO", "SeafoamIslands_B4F", 159, 50, "Seafoam Islands B4F"),
                                     ("ZAPDOS", "PowerPlant", 40, 50, "Power Plant"),
                                     ("MOLTRES", "MtEmber_Summit", 29, 50, "Mt. Ember summit"),
                                     ("MEWTWO", "CeruleanCave_B1F", 37, 70, "Cerulean Cave B1F")):
        add("frlg/legend/" + sp.lower(), "legendary", FRLG, "SPECIES_" + sp, level, loc, G3_WILD,
            [("pokefirered", scr(mp), line, "setwildbattle SPECIES_%s, %d" % (sp, level))])
    # --- events
    add("e/event/mew", "event", E, "SPECIES_MEW", 30, "Faraway Island", G3_EVENT,
        [("pokeemerald", scr("FarawayIsland_Interior"), 130, "seteventmon SPECIES_MEW, 30")])
    add("e/event/deoxys", "event", E, "SPECIES_DEOXYS", 30, "Birth Island", G3_EVENT,
        [("pokeemerald", scr("BirthIsland_Exterior"), 83, "seteventmon SPECIES_DEOXYS, 30")], form="speed")
    add("fr/event/deoxys", "event", FR, "SPECIES_DEOXYS", 30, "Birth Island", G3_EVENT,
        [("pokefirered", scr("BirthIsland_Exterior"), 83, "seteventmon SPECIES_DEOXYS, 30")], form="attack")
    add("lg/event/deoxys", "event", LG, "SPECIES_DEOXYS", 30, "Birth Island", G3_EVENT,
        [("pokefirered", scr("BirthIsland_Exterior"), 83, "seteventmon SPECIES_DEOXYS, 30")], form="defense")
    add("e-frlg/event/lugia", "event", E + FRLG, "SPECIES_LUGIA", 70, "Navel Rock (bottom)", G3_EVENT, [
        ("pokeemerald", scr("NavelRock_Bottom"), 54, "seteventmon SPECIES_LUGIA, 70"),
        ("pokefirered", scr("NavelRock_Base"), 56, "seteventmon SPECIES_LUGIA, 70")])
    add("e-frlg/event/ho-oh", "event", E + FRLG, "SPECIES_HO_OH", 70, "Navel Rock (top)", G3_EVENT, [
        ("pokeemerald", scr("NavelRock_Top"), 58, "seteventmon SPECIES_HO_OH, 70"),
        ("pokefirered", scr("NavelRock_Summit"), 60, "seteventmon SPECIES_HO_OH, 70")])
    # --- roamers
    for sp, line in (("LATIAS", 87), ("LATIOS", 89)):
        add("e/roamer/" + sp.lower(), "roamer", E, "SPECIES_" + sp, 40, "roaming Hoenn (chosen on the TV at home)", G3_ROAMER, [
            ("pokeemerald", "src/roamer.c", line, "ROAMER->species = SPECIES_" + sp),
            ("pokeemerald", "src/roamer.c", 91, "CreateMon(&gEnemyParty[0], ROAMER->species, 40, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)")])
    add("ruby/roamer/latios", "roamer", ["ruby"], "SPECIES_LATIOS", 40, "roaming Hoenn", G3_ROAMER, [
        ("pokeruby", "src/roamer.c", 65, "CreateMon(&gEnemyParty[0], ROAMER_SPECIES, 40, 0x20, 0, 0, 0, 0)"),
        ("pokeruby", "include/constants/species.h", 1285, "#define ROAMER_SPECIES SPECIES_LATIOS")])
    add("sapphire/roamer/latias", "roamer", ["sapphire"], "SPECIES_LATIAS", 40, "roaming Hoenn", G3_ROAMER, [
        ("pokeruby", "src/roamer.c", 65, "CreateMon(&gEnemyParty[0], ROAMER_SPECIES, 40, 0x20, 0, 0, 0, 0)"),
        ("pokeruby", "include/constants/species.h", 1283, "#define ROAMER_SPECIES SPECIES_LATIAS")])
    for sp, line in (("RAIKOU", 87), ("ENTEI", 90), ("SUICUNE", 93)):
        add("frlg/roamer/" + sp.lower(), "roamer", FRLG, "SPECIES_" + sp, 50, "roaming Kanto (depends on the starter)", G3_ROAMER, [
            ("pokefirered", "src/roamer.c", line, "a = SPECIES_" + sp),
            ("pokefirered", "src/roamer.c", 103, "CreateMon(mon, species, 50, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0)")])
    return ent


def gen4_static_entries():
    ent = []

    def add(id, category, games, species, level, location, creation, sources, **kw):
        ent.append(dict(id=id, category=category, games=games, species=species, level=level, location=location,
                        creation=creation, sources=sources, **kw))

    # ---------------- Platinum (text scripts)
    for i, sp in enumerate(("TURTWIG", "CHIMCHAR", "PIPLUP")):
        add("pt/starter/" + sp.lower(), "starter", PT, "SPECIES_" + sp, 5, "Route 201 / Lake Verity (Rowan's briefcase)", G4_PT_GIFT, [
            ("pokeplatinum", pts("route_201"), 286, "GivePokemon VAR_0x8000, 5, ITEM_NONE, VAR_RESULT"),
            ("pokeplatinum", "src/choose_starter/choose_starter_app.c", 51 + i, "#define STARTER_OPTION_%d    SPECIES_%s" % (i, sp))])
    for sp in ("OMANYTE", "KABUTO", "AERODACTYL", "LILEEP", "ANORITH", "CRANIDOS", "SHIELDON"):
        add("pt/fossil/" + sp.lower(), "fossil", PT, "SPECIES_" + sp, 20, "Oreburgh City, Mining Museum", G4_PT_GIFT,
            [("pokeplatinum", pts("mining_museum"), 228, "GivePokemon VAR_REVIVED_POKEMON_SPECIES, 20, ITEM_NONE, VAR_RESULT")],
            notes="species = VAR_REVIVED_POKEMON_SPECIES set from the fossil item handed in")
    add("pt/gift/eevee", "gift", PT, "SPECIES_EEVEE", 20, "Hearthome City, Bebe's house", G4_PT_GIFT,
        [("pokeplatinum", pts("hearthome_city_northwest_house"), 38, "GivePokemon SPECIES_EEVEE, 20, ITEM_NONE, VAR_RESULT")])
    add("pt/gift/porygon", "gift", PT, "SPECIES_PORYGON", 25, "Veilstone City (north-east house)", G4_PT_GIFT,
        [("pokeplatinum", pts("veilstone_city_northeast_house"), 39, "GivePokemon SPECIES_PORYGON, 25, ITEM_NONE, VAR_RESULT")])
    add("pt/egg/togepi", "egg", PT, "SPECIES_TOGEPI", 1, "Eterna City (Cynthia)", G4_PT_EGG, [
        ("pokeplatinum", pts("eterna_city"), 1089, "GiveEgg SPECIES_TOGEPI, SPECIAL_METLOC_NAME_CYNTHIA"),
        ("pokeplatinum", "src/overlay005/daycare.c", 675, "Pokemon_InitWith(egg, species, 1, INIT_IVS_RANDOM")])
    add("dppt/egg/riolu", "egg", DPPT, "SPECIES_RIOLU", 1, "Iron Island (Riley)", G4_PT_EGG, [
        ("pokeplatinum", pts("iron_island_b2f_left_room"), 245, "GiveEgg SPECIES_RIOLU, SPECIAL_METLOC_NAME_RILEY"),
        ("pokeplatinum", "src/overlay005/daycare.c", 675, "Pokemon_InitWith(egg, species, 1, INIT_IVS_RANDOM")],
        notes="Diamond/Pearl inclusion from PokeFinder (DPPt); the citation is Platinum's script")
    add("pt/static/rotom", "stationary", PT, "SPECIES_ROTOM", 20, "Old Chateau (TV at night)", G4_PT_WILD,
        [("pokeplatinum", pts("old_chateau_back_middle_west_room"), 24, "StartWildBattle SPECIES_ROTOM, 20")])
    add("dppt/static/spiritomb", "stationary", DPPT, "SPECIES_SPIRITOMB", 25, "Route 209, Hallowed Tower", G4_PT_WILD,
        [("pokeplatinum", pts("route_209"), 78, "StartWildBattle SPECIES_SPIRITOMB, 25")],
        notes="Diamond/Pearl inclusion from PokeFinder (DPPt, same level); the citation is Platinum's script")
    add("pt/static/drifloon", "stationary", PT, "SPECIES_DRIFLOON", 15, "Valley Windworks (Fridays)", G4_PT_LEGEND,
        [("pokeplatinum", pts("valley_windworks_outside"), 146, "StartLegendaryBattle SPECIES_DRIFLOON, 15")])
    for id_, games, sp, level, mp, line, loc in (
            ("dppt/legend/uxie", DPPT, "UXIE", 50, "acuity_cavern", 33, "Acuity Cavern"),
            ("dppt/legend/azelf", DPPT, "AZELF", 50, "valor_cavern", 47, "Valor Cavern"),
            ("pt/legend/dialga", PT, "DIALGA", 70, "spear_pillar_dialga", 43, "Spear Pillar"),
            ("pt/legend/palkia", PT, "PALKIA", 70, "spear_pillar_palkia", 43, "Spear Pillar"),
            ("pt/legend/giratina", PT, "GIRATINA", 47, "turnback_cave_giratina_room", 35, "Turnback Cave"),
            ("pt/legend/heatran", PT, "HEATRAN", 50, "stark_mountain_room_3", 83, "Stark Mountain"),
            ("pt/legend/regigigas", PT, "REGIGIGAS", 1, "snowpoint_temple_b5f", 51, "Snowpoint Temple B5F"),
            ("pt/legend/regirock", PT, "REGIROCK", 30, "rock_peak_ruins", 47, "Rock Peak Ruins"),
            ("pt/legend/regice", PT, "REGICE", 30, "iceberg_ruins", 47, "Iceberg Ruins"),
            ("pt/legend/registeel", PT, "REGISTEEL", 30, "iron_ruins", 47, "Iron Ruins")):
        add(id_, "legendary", games, "SPECIES_" + sp, level, loc, G4_PT_LEGEND,
            [("pokeplatinum", pts(mp), line, "StartLegendaryBattle SPECIES_%s, %d" % (sp, level))],
            notes=("Diamond/Pearl inclusion from PokeFinder (DPPt, same level); the citation is Platinum's script"
                   if games is DPPT else None))
    add("pt/legend/giratina-origin", "legendary", PT, "SPECIES_GIRATINA", 47, "Distortion World", G4_PT_GIRATINA,
        [("pokeplatinum", pts("distortion_world_giratina_room"), 74, "StartGiratinaOriginBattle SPECIES_GIRATINA, 47")], form="origin")
    add("pt/event/darkrai", "event", PT, "SPECIES_DARKRAI", 50, "Newmoon Island (Member Card)", G4_PT_LEGEND,
        [("pokeplatinum", pts("newmoon_island_forest"), 44, "StartLegendaryBattle SPECIES_DARKRAI, 50")])
    add("pt/event/shaymin", "event", PT, "SPECIES_SHAYMIN", 30, "Flower Paradise (Oak's Letter)", G4_PT_FATEFUL,
        [("pokeplatinum", pts("flower_paradise"), 46, "StartFatefulEncounter SPECIES_SHAYMIN, 30")])
    add("pt/event/arceus", "event", PT, "SPECIES_ARCEUS", 80, "Hall of Origin (Azure Flute)", G4_PT_LEGEND,
        [("pokeplatinum", pts("hall_of_origin"), 46, "StartLegendaryBattle SPECIES_ARCEUS, 80")])
    for id_, games, sp, level, line in (("dppt/roamer/mesprit", DPPT, "MESPRIT", 50, 255), ("dppt/roamer/cresselia", DPPT, "CRESSELIA", 50, 259),
                                        ("pt/roamer/articuno", PT, "ARTICUNO", 60, 275), ("pt/roamer/zapdos", PT, "ZAPDOS", 60, 271),
                                        ("pt/roamer/moltres", PT, "MOLTRES", 60, 267)):
        add(id_, "roamer", games, "SPECIES_" + sp, level, "roaming Sinnoh", G4_PT_ROAMER, [
            ("pokeplatinum", "src/roaming_pokemon.c", line, "species = SPECIES_" + sp),
            ("pokeplatinum", "src/roaming_pokemon.c", line + 1, "level = %d" % level),
            ("pokeplatinum", "src/roaming_pokemon.c", 291, "Pokemon_InitWith(roamerMonData, species, level, INIT_IVS_RANDOM, FALSE, 0, OTID_SET")],
            notes=("Diamond/Pearl inclusion from PokeFinder (DPPt, same level); the citation is Platinum's code; "
                   "Platinum also keeps an unused ROAMING_SLOT_DARKRAI at level 40 (roaming_pokemon.c:263-264)"
                   if games is DPPT else None))
    # ---------------- Diamond / Pearl (no text scripts in pokediamond: PokeFinder provenance)
    for sp in ("TURTWIG", "CHIMCHAR", "PIPLUP"):
        add("dp/starter/" + sp.lower(), "starter", DP, "SPECIES_" + sp, 5, "Lake Verity (Rowan's briefcase)", G4_DP_PF, [], provenance="pokefinder")
    for sp in ("OMANYTE", "KABUTO", "AERODACTYL", "LILEEP", "ANORITH", "CRANIDOS", "SHIELDON"):
        add("dp/fossil/" + sp.lower(), "fossil", DP, "SPECIES_" + sp, 20, "Oreburgh City, Mining Museum", G4_DP_PF, [], provenance="pokefinder")
    add("dp/gift/eevee", "gift", DP, "SPECIES_EEVEE", 5, "Hearthome City, Bebe's house", G4_DP_PF, [], provenance="pokefinder")
    add("dp/egg/happiny", "egg", DP, "SPECIES_HAPPINY", 1, "Hearthome City (traveling man)", G4_DP_PF, [], provenance="pokefinder")
    add("dp/static/drifloon", "stationary", DP, "SPECIES_DRIFLOON", 22, "Valley Windworks (Fridays)", G4_DP_PF, [], provenance="pokefinder")
    add("dp/static/rotom", "stationary", DP, "SPECIES_ROTOM", 15, "Old Chateau (TV at night)", G4_DP_PF, [], provenance="pokefinder")
    add("d/legend/dialga", "legendary", ["diamond"], "SPECIES_DIALGA", 47, "Spear Pillar", G4_DP_PF, [], provenance="pokefinder")
    add("p/legend/palkia", "legendary", ["pearl"], "SPECIES_PALKIA", 47, "Spear Pillar", G4_DP_PF, [], provenance="pokefinder")
    add("dp/legend/heatran", "legendary", DP, "SPECIES_HEATRAN", 70, "Stark Mountain", G4_DP_PF, [], provenance="pokefinder")
    add("dp/legend/regigigas", "legendary", DP, "SPECIES_REGIGIGAS", 70, "Snowpoint Temple B5F", G4_DP_PF, [], provenance="pokefinder")
    add("dp/legend/giratina", "legendary", DP, "SPECIES_GIRATINA", 70, "Turnback Cave", G4_DP_PF, [], provenance="pokefinder")
    add("gen4/event/manaphy-egg", "event", GEN4_ALL, "SPECIES_MANAPHY", 1, "Pokemon Ranger egg (Mystery Gift)", G4_DP_PF, [],
        provenance="pokefinder", notes="PokeFinder lists a Shiny::Never and a plain variant")
    # ---------------- HeartGold / SoulSilver
    for i, sp in enumerate(("CHIKORITA", "CYNDAQUIL", "TOTODILE")):
        add("hgss/starter/" + sp.lower(), "starter", HGSS, "SPECIES_" + sp, 5, "New Bark Town, Elm's Lab", G4_HG_STARTER, [
            ("pokeheartgold", "src/choose_starter.c", 46 + i, "SPECIES_" + sp),
            ("pokeheartgold", "src/choose_starter.c", 59, "CreateMon(mon, species[i], 5, 32, FALSE, 0, OT_ID_PLAYER_ID, 0)")])
    for sp, line, val in (("BULBASAUR", 522, 1), ("SQUIRTLE", 559, 7), ("CHARMANDER", 596, 4)):
        add("hgss/starter/" + sp.lower(), "starter", HGSS, "SPECIES_" + sp, 5, "Pallet Town, Oak's Lab (after Red)", G4_HG_GIFT, [
            ("pokeheartgold", hgs("0740_T01R0301"), 629, "GiveMon VAR_SPECIAL_x8004, 5, 0, 0, 0, VAR_SPECIAL_RESULT"),
            ("pokeheartgold", hgs("0740_T01R0301"), line, "SetVar VAR_SPECIAL_x8004, %d" % val)])
    for sp, line, val in (("TREECKO", 160, 252), ("TORCHIC", 166, 255), ("MUDKIP", 170, 258)):
        add("hgss/starter/" + sp.lower(), "starter", HGSS, "SPECIES_" + sp, 5, "Saffron City, Silph Co. (Steven)", G4_HG_GIFT, [
            ("pokeheartgold", hgs("0837_T11R0701"), 178, "GiveMon VAR_SPECIAL_x8004, 5, 0, 0, 0, VAR_SPECIAL_RESULT"),
            ("pokeheartgold", hgs("0837_T11R0701"), line, "SetVar VAR_SPECIAL_x8004, %d" % val)])
    for sp, line in (("AERODACTYL", 9), ("OMANYTE", 10), ("KABUTO", 11), ("LILEEP", 12), ("ANORITH", 13), ("SHIELDON", 14), ("CRANIDOS", 15)):
        add("hgss/fossil/" + sp.lower(), "fossil", HGSS, "SPECIES_" + sp, 20, "Pewter City, Museum of Science", G4_HG_GIFT, [
            ("pokeheartgold", hgs("0755_T03R0101"), 359, "GiveMon VAR_UNK_407F, 20, 0, 0, 0, VAR_SPECIAL_RESULT"),
            ("pokeheartgold", "src/scrcmd_fossils.c", line, "SPECIES_" + sp)])
    add("hgss/gift/tyrogue", "gift", HGSS, "SPECIES_TYROGUE", 10, "Mt. Mortar B1F (Kiyo)", G4_HG_GIFT,
        [("pokeheartgold", hgs("0098_D38R0104"), 37, "GiveMon SPECIES_TYROGUE, 10, 0, 0, 0, VAR_SPECIAL_RESULT")])
    add("hgss/gift/dratini", "gift", HGSS, "SPECIES_DRATINI", 15, "Dragon's Den shrine (Extreme Speed quiz)", G4_HG_GIFT,
        [("pokeheartgold", hgs("0112_D44R0103"), 351, "GiveMon SPECIES_DRATINI, 15, 0, 0, 0, VAR_SPECIAL_RESULT")])
    add("hgss/gift/tentacool", "gift", HGSS, "SPECIES_TENTACOOL", 15, "Cianwood City, Pokemon Center", G4_HG_GIFT,
        [("pokeheartgold", hgs("0878_T24PC0101"), 56, "GiveMon SPECIES_TENTACOOL, 15, 0, 0, 0, VAR_SPECIAL_RESULT")])
    add("hgss/gift/eevee", "gift", HGSS, "SPECIES_EEVEE", 5, "Goldenrod City, Bill's house", G4_HG_GIFT,
        [("pokeheartgold", hgs("0892_T25R0401"), 34, "GiveMon SPECIES_EEVEE, 5, 0, 0, 0, VAR_SPECIAL_RESULT")])
    add("hgss/egg/togepi", "egg", HGSS, "SPECIES_TOGEPI", 1, "New Bark Town, Elm's Lab (Mystery Egg)", G4_HG_EGG,
        [("pokeheartgold", "src/field/scrcmd_pokemon_misc.c", 1053, "SetEggStats(mon, SPECIES_TOGEPI, 1")])
    for sp, line in (("MAREEP", 79), ("WOOPER", 91), ("SLUGMA", 103)):
        add("hgss/egg/" + sp.lower(), "egg", HGSS, "SPECIES_" + sp, 1, "Violet City, Pokemon Center (Primo)", G4_HG_EGG, [
            ("pokeheartgold", hgs("0860_T22PC0101"), line, "GiveEgg SPECIES_%s, MAPLOC(METLOC_PRIMO)" % sp),
            ("pokeheartgold", "src/scrcmd_party.c", 92, "SetEggStats(mon, species, 1")])
    for sp, line, item, form in (("DIALGA", 697, "135", None), ("PALKIA", 704, "136", None), ("GIRATINA", 709, "112", "origin")):
        add("hgss/event/%s-sinjoh" % sp.lower(), "event", HGSS, "SPECIES_" + sp, 1, "Sinjoh Ruins (Arceus event)", G4_HG_GIFT,
            [("pokeheartgold", hgs("0131_D51R0201"), line, "GiveMon SPECIES_%s, 1, %s" % (sp, item))],
            held_item="item id " + item, form=form)
    for sp, val, line, games in (("ABRA", 63, 509, HGSS), ("EKANS", 23, 513, HG), ("DRATINI", 147, 517, HGSS), ("SANDSHREW", 27, 521, SS)):
        add("hgss/game-corner/goldenrod-" + sp.lower(), "game_corner", games, "SPECIES_" + sp, 15, "Goldenrod City, Game Corner", G4_HG_GIFT, [
            ("pokeheartgold", hgs("0910_T25SP0101"), 582, "GiveMon VAR_TEMP_x4002, 15, 0, 0, 0, VAR_SPECIAL_RESULT"),
            ("pokeheartgold", hgs("0910_T25SP0101"), line, "SetOrCopyVar VAR_TEMP_x4002, %d" % val)],
            notes="Ekans (HeartGold) / Sandshrew (SoulSilver) split per PokeFinder; both branches exist in the script")
    for sp, val, line in (("MR_MIME", 122, 427), ("EEVEE", 133, 431), ("PORYGON", 137, 435)):
        add("hgss/game-corner/celadon-" + sp.lower().replace("_", "-"), "game_corner", HGSS, "SPECIES_" + sp, 15, "Celadon City, Game Corner", G4_HG_GIFT, [
            ("pokeheartgold", hgs("0804_T07R0501"), 479, "GiveMon VAR_TEMP_x4002, 15, 0, 0, 0, VAR_SPECIAL_RESULT"),
            ("pokeheartgold", hgs("0804_T07R0501"), line, "SetOrCopyVar VAR_TEMP_x4002, %d" % val)])
    for sp, level, line in (("KOFFING", 21, 1000), ("VOLTORB", 23, 1013), ("GEODUDE", 21, 1026)):
        add("hgss/static/rocket-trap-" + sp.lower(), "stationary", HGSS, "SPECIES_" + sp, level, "Team Rocket HQ B1F (trap floor)", G4_HG_TRAP,
            [("pokeheartgold", hgs("0089_D35R0102"), line, "RocketTrapBattle SPECIES_%s, %d" % (sp, level))])
    add("hgss/static/electrode", "stationary", HGSS, "SPECIES_ELECTRODE", 23, "Team Rocket HQ B2F (generator)", G4_HG_WILD, [
        ("pokeheartgold", hgs("0090_D35R0103"), 599, "WildBattle SPECIES_ELECTRODE, 23, 0"),
        ("pokeheartgold", hgs("0090_D35R0103"), 622, "WildBattle SPECIES_ELECTRODE, 23, 0"),
        ("pokeheartgold", hgs("0090_D35R0103"), 645, "WildBattle SPECIES_ELECTRODE, 23, 0")])
    add("hgss/static/gyarados", "stationary", HGSS, "SPECIES_GYARADOS", 30, "Lake of Rage (red Gyarados)", G4_HG_SHINY,
        [("pokeheartgold", hgs("0938_T29"), 289, "WildBattle SPECIES_GYARADOS, 30, 1")], shiny="always")
    add("hgss/static/lapras", "stationary", HGSS, "SPECIES_LAPRAS", 20, "Union Cave B2F (Fridays)", G4_HG_WILD,
        [("pokeheartgold", hgs("0058_D25R0103"), 46, "WildBattle SPECIES_LAPRAS, 20, 0")])
    add("hgss/static/snorlax", "stationary", HGSS, "SPECIES_SNORLAX", 50, "Route 11 / Route 12 (Poke Flute channel)", G4_HG_WILD, [
        ("pokeheartgold", hgs("0197_R11"), 49, "WildBattle SPECIES_SNORLAX, 50, 0"),
        ("pokeheartgold", hgs("0199_R12"), 198, "WildBattle SPECIES_SNORLAX, 50, 0")])
    add("hgss/static/sudowoodo", "stationary", HGSS, "SPECIES_SUDOWOODO", 20, "Route 36 (SquirtBottle)", G4_HG_WILD, [
        ("pokeheartgold", hgs("0243_R36"), 100, "WildBattle SPECIES_SUDOWOODO, 20, 0"),
        ("pokeheartgold", hgs("0243_R36"), 217, "WildBattle SPECIES_SUDOWOODO, 20, 0")])
    for sp, level, f, line, loc in (("ARTICUNO", 50, "0014_D11R0105", 29, "Seafoam Islands B4F"),
                                    ("ZAPDOS", 50, "0191_R10", 180, "Route 10 (Power Plant)"),
                                    ("MOLTRES", 50, "0106_D41R0105", 29, "Mt. Silver Cave"),
                                    ("MEWTWO", 70, "0011_D03R0103", 29, "Cerulean Cave B1F"),
                                    ("SUICUNE", 40, "0216_R25", 559, "Route 25 (Bill's house)"),
                                    ("RAYQUAZA", 50, "0135_D52R0103", 81, "Embedded Tower")):
        add("hgss/legend/" + sp.lower(), "legendary", HGSS, "SPECIES_" + sp, level, loc, G4_HG_WILD,
            [("pokeheartgold", hgs(f), line, "WildBattle SPECIES_%s, %d, 0" % (sp, level))])
    add("hg/legend/kyogre", "legendary", HG, "SPECIES_KYOGRE", 50, "Embedded Tower", G4_HG_WILD,
        [("pokeheartgold", hgs("0134_D52R0102"), 70, "WildBattle SPECIES_KYOGRE, 50, 0")])
    add("ss/legend/groudon", "legendary", SS, "SPECIES_GROUDON", 50, "Embedded Tower", G4_HG_WILD,
        [("pokeheartgold", hgs("0133_D52R0101"), 70, "WildBattle SPECIES_GROUDON, 50, 0")])
    add("hg/legend/lugia", "legendary", HG, "SPECIES_LUGIA", 70, "Whirl Islands B3F", G4_HG_WILD, [
        ("pokeheartgold", hgs("0104_D40R0107"), 70, "SetVar VAR_TEMP_x400A, 249"),
        ("pokeheartgold", hgs("0104_D40R0107"), 76, "Compare VAR_SPECIAL_RESULT, 7"),
        ("pokeheartgold", hgs("0104_D40R0107"), 78, "SetVar VAR_SPECIAL_x8004, 70"),
        ("pokeheartgold", hgs("0104_D40R0107"), 85, "WildBattle VAR_TEMP_x400A, VAR_SPECIAL_x8004, 0")],
        notes="GetGameVersion == 7 (VERSION_HEARTGOLD) branch")
    add("ss/legend/lugia", "legendary", SS, "SPECIES_LUGIA", 45, "Whirl Islands B3F", G4_HG_WILD, [
        ("pokeheartgold", hgs("0104_D40R0107"), 70, "SetVar VAR_TEMP_x400A, 249"),
        ("pokeheartgold", hgs("0104_D40R0107"), 82, "SetVar VAR_SPECIAL_x8004, 45"),
        ("pokeheartgold", hgs("0104_D40R0107"), 85, "WildBattle VAR_TEMP_x400A, VAR_SPECIAL_x8004, 0")],
        notes="GetGameVersion != 7 branch")
    add("hg/legend/ho-oh", "legendary", HG, "SPECIES_HO_OH", 45, "Bell Tower roof", G4_HG_WILD, [
        ("pokeheartgold", hgs("0021_D17R0110"), 58, "SetVar VAR_TEMP_x400A, 250"),
        ("pokeheartgold", hgs("0021_D17R0110"), 64, "Compare VAR_SPECIAL_RESULT, 7"),
        ("pokeheartgold", hgs("0021_D17R0110"), 66, "SetVar VAR_SPECIAL_x8004, 45"),
        ("pokeheartgold", hgs("0021_D17R0110"), 73, "WildBattle VAR_TEMP_x400A, VAR_SPECIAL_x8004, 0")],
        notes="GetGameVersion == 7 (VERSION_HEARTGOLD) branch")
    add("ss/legend/ho-oh", "legendary", SS, "SPECIES_HO_OH", 70, "Bell Tower roof", G4_HG_WILD, [
        ("pokeheartgold", hgs("0021_D17R0110"), 58, "SetVar VAR_TEMP_x400A, 250"),
        ("pokeheartgold", hgs("0021_D17R0110"), 70, "SetVar VAR_SPECIAL_x8004, 70"),
        ("pokeheartgold", hgs("0021_D17R0110"), 73, "WildBattle VAR_TEMP_x400A, VAR_SPECIAL_x8004, 0")],
        notes="GetGameVersion != 7 branch")
    add("hg/legend/latios", "legendary", HG, "SPECIES_LATIOS", 40, "Pewter City (Enigma Stone)", G4_HG_WILD, [
        ("pokeheartgold", hgs("0750_T03"), 383, "SetVar VAR_TEMP_x400A, SPECIES_LATIOS"),
        ("pokeheartgold", hgs("0750_T03"), 396, "WildBattle VAR_TEMP_x400A, 40, 0")])
    add("ss/legend/latias", "legendary", SS, "SPECIES_LATIAS", 40, "Pewter City (Enigma Stone)", G4_HG_WILD, [
        ("pokeheartgold", hgs("0750_T03"), 389, "SetVar VAR_TEMP_x400A, SPECIES_LATIAS"),
        ("pokeheartgold", hgs("0750_T03"), 396, "WildBattle VAR_TEMP_x400A, 40, 0")])
    for id_, games, sp, level, line in (("hgss/roamer/raikou", HGSS, "RAIKOU", 40, 184), ("hgss/roamer/entei", HGSS, "ENTEI", 40, 188)):
        add(id_, "roamer", games, "SPECIES_" + sp, level, "roaming Johto (released at the Burned Tower)", G4_HG_ROAMER, [
            ("pokeheartgold", "src/field_roamer.c", line, "species = SPECIES_" + sp),
            ("pokeheartgold", "src/field_roamer.c", line + 1, "level = %d" % level),
            ("pokeheartgold", "src/field_roamer.c", 210, "CreateMon(mon, species, level, 32, FALSE, 0, OT_ID_PRESET"),
            ("pokeheartgold", hgs("0024_D18R0102"), 77 + ["RAIKOU", "ENTEI"].index(sp), "CreateRoamer %d" % ["RAIKOU", "ENTEI"].index(sp))])
    # Vermilion City (Steven): GetGameVersion == 8 (VERSION_SOULSILVER) -> CreateRoamer 3 (ROAMER_LATIOS), else CreateRoamer 2 (ROAMER_LATIAS)
    for id_, games, sp, level, line, rline, slot in (("hg/roamer/latias", HG, "LATIAS", 35, 192, 70, 2),
                                                     ("ss/roamer/latios", SS, "LATIOS", 35, 196, 87, 3)):
        add(id_, "roamer", games, "SPECIES_" + sp, level, "roaming Kanto (released by Steven in Vermilion City)", G4_HG_ROAMER, [
            ("pokeheartgold", "src/field_roamer.c", line, "species = SPECIES_" + sp),
            ("pokeheartgold", "src/field_roamer.c", line + 1, "level = %d" % level),
            ("pokeheartgold", "src/field_roamer.c", 210, "CreateMon(mon, species, level, 32, FALSE, 0, OT_ID_PRESET"),
            ("pokeheartgold", hgs("0776_T06"), 65, "Compare VAR_TEMP_x4004, 8"),
            ("pokeheartgold", hgs("0776_T06"), rline, "CreateRoamer %d" % slot),
            ("pokeheartgold", "include/constants/roamer.h", 6 + (slot - 2), "#define ROAMER_%s %d" % (sp, slot)),
            ("pokeheartgold", "include/config.h", 10, "#define VERSION_SOULSILVER 8")],
            notes="the other Eon is the Pewter City Enigma Stone static (hg/legend/latios, ss/legend/latias)")
    return ent


# ----------------------------------------------------------------------------- PokeFinder comparison

PF_GAMES = {
    "Game::Ruby": {"ruby"}, "Game::Sapphire": {"sapphire"}, "Game::RS": {"ruby", "sapphire"}, "Game::Emerald": {"emerald"},
    "Game::RSE": {"ruby", "sapphire", "emerald"}, "Game::FireRed": {"firered"}, "Game::LeafGreen": {"leafgreen"},
    "Game::FRLG": {"firered", "leafgreen"}, "Game::Gen3": {"ruby", "sapphire", "emerald", "firered", "leafgreen"},
    "Game::Diamond": {"diamond"}, "Game::Pearl": {"pearl"}, "Game::DP": {"diamond", "pearl"}, "Game::Platinum": {"platinum"},
    "Game::DPPt": {"diamond", "pearl", "platinum"}, "Game::HeartGold": {"heartgold"}, "Game::SoulSilver": {"soulsilver"},
    "Game::HGSS": {"heartgold", "soulsilver"}, "Game::Gen4": {"diamond", "pearl", "platinum", "heartgold", "soulsilver"},
}


def pf_games(v):
    out = set()
    for part in v.split("|"):
        out |= PF_GAMES[part.strip()]
    return out


def run_pokefinder(src):
    tmp = tempfile.mkdtemp(prefix="pf-tables-")
    code = ("import sys; sys.path.insert(0, %r)\n"
            "from Gen3 import emerald, rs, frlg\nfrom Gen4 import pt, hgss, dp\n"
            "emerald.encounters(%r, False); rs.encounters(%r, False); frlg.encounters(%r, False)\n"
            "pt.encounters(%r); hgss.encounters(%r, False); dp.encounters(%r, False)\n") % ((src,) + (tmp,) * 6)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    subprocess.check_call([sys.executable, "-c", code], env=env, cwd=tmp)
    return tmp


def compare_gen3(game, mine, path, report):
    with open(path, "rb") as f:
        data = f.read()
    n = 0
    maps = {m["index"]: m for m in mine["maps"]}
    for off in range(0, len(data), 134):
        rec = data[off:off + 134]
        loc = rec[0]
        n += 1
        m = maps.get(loc)
        if m is None:
            report.append("%s: PokeFinder location %d has no table here" % (game, loc))
            continue
        rates = list(rec[1:5])
        ours = [m.get("land", {}).get("rate", 0), m.get("water", {}).get("rate", 0),
                m.get("rock_smash", {}).get("rate", 0), m.get("fishing", {}).get("rate", 0)]
        if rates != ours:
            report.append("%s %s (loc %d): rates PokeFinder %s vs ours %s" % (game, m["map"], loc, rates, ours))
        p = 6
        land = [(struct.unpack_from("<H", rec, p + 4 * i)[0], rec[p + 4 * i + 2]) for i in range(12)]
        p += 48
        if "land" in m:
            for i, (sp, lvl) in enumerate(land):
                s = m["land"]["slots"][i]
                form = sp >> 11
                sp &= 0x7FF
                letter = m["land"].get("unown_letter_ids", [0] * 12)[i]
                if (sp, lvl, form) != (s["species"], s["min_level"], letter):
                    report.append("%s %s (loc %d) land slot %d: PokeFinder (%d, L%d, form %d) vs ours (%d, L%d, form %d)" % (
                        game, m["map"], loc, i, sp, lvl, form, s["species"], s["min_level"], letter))
        elif any(x != (0, 0) for x in land):
            report.append("%s %s (loc %d): PokeFinder has land slots, we have none" % (game, m["map"], loc))
        for key, count in (("water", 5), ("rock_smash", 5), ("fishing", 10)):
            slots = [(struct.unpack_from("<H", rec, p + 4 * i)[0], rec[p + 4 * i + 2], rec[p + 4 * i + 3]) for i in range(count)]
            p += 4 * count
            if key == "fishing":
                ours = m.get("fishing", {}).get("old_rod", []) + m.get("fishing", {}).get("good_rod", []) + m.get("fishing", {}).get("super_rod", [])
            else:
                ours = m.get(key, {}).get("slots", [])
            if not ours:
                if any(x != (0, 0, 0) for x in slots):
                    report.append("%s %s (loc %d): PokeFinder has %s slots, we have none" % (game, m["map"], loc, key))
                continue
            for i, (sp, mx, mn) in enumerate(slots):
                s = ours[i]
                if (sp, mx, mn) != (s["species"], s["max_level"], s["min_level"]):
                    report.append("%s %s (loc %d) %s slot %d: PokeFinder (%d, L%d-%d) vs ours (%d, L%d-%d)" % (
                        game, m["map"], loc, key, i, sp, mn, mx, s["species"], s["min_level"], s["max_level"]))
    return n


def compare_dppt(game, mine, path, report):
    with open(path, "rb") as f:
        data = f.read()
    tables = {t["index"]: t for t in mine["tables"]}
    n = 0
    for off in range(0, len(data), 176):
        rec = data[off:off + 176]
        loc = rec[0]
        n += 1
        t = tables.get(loc)
        if t is None:
            report.append("%s: PokeFinder location %d has no table here" % (game, loc))
            continue
        rates = list(rec[1:6])
        zero = {"rate": 0, "slots": []}
        sec = lambda k: t.get(k, zero)
        ours = [sec("grass")["rate"], sec("surf")["rate"], sec("old_rod")["rate"], sec("good_rod")["rate"], sec("super_rod")["rate"]]
        if rates != ours:
            report.append("%s %s (loc %d): rates PokeFinder %s vs ours %s" % (game, t["table"], loc, rates, ours))
        p = 6
        for i in range(12):
            sp, lvl = struct.unpack_from("<H", rec, p)[0], rec[p + 2]
            p += 4
            slots = sec("grass")["slots"]
            s = slots[i] if i < len(slots) else {"species": 0, "level": 0}
            if (sp, lvl) != (s["species"], s["level"]):
                report.append("%s %s (loc %d) grass slot %d: PokeFinder (%d, L%d) vs ours (%d, L%d)" % (
                    game, t["table"], loc, i, sp, lvl, s["species"], s["level"]))
        for key, count in (("swarm", 2), ("day", 2), ("night", 2), ("radar", 4)):
            vals = [struct.unpack_from("<H", rec, p + 2 * i)[0] for i in range(count)]
            p += 2 * count
            ours = [s["species"] for s in t.get(key, [])] or [0] * count
            if vals != ours:
                report.append("%s %s (loc %d) %s: PokeFinder %s vs ours %s" % (game, t["table"], loc, key, vals, ours))
        forms = [rec[p], rec[p + 1]]
        p += 2
        if forms != t.get("form_rates", [0] * 5)[:2]:
            report.append("%s %s (loc %d) form rates: PokeFinder %s vs ours %s" % (game, t["table"], loc, forms, t.get("form_rates")))
        for g in ("ruby", "sapphire", "emerald", "firered", "leafgreen"):
            vals = [struct.unpack_from("<H", rec, p)[0], struct.unpack_from("<H", rec, p + 2)[0]]
            p += 4
            ours = [s["species"] for s in t.get("dual_slot", {}).get(g, [])] or [0, 0]
            if vals != ours:
                report.append("%s %s (loc %d) dual-slot %s: PokeFinder %s vs ours %s" % (game, t["table"], loc, g, vals, ours))
        for key in ("surf", "old_rod", "good_rod", "super_rod"):
            for i in range(5):
                sp, mx, mn = struct.unpack_from("<H", rec, p)[0], rec[p + 2], rec[p + 3]
                p += 4
                slots = sec(key)["slots"]
                s = slots[i] if i < len(slots) else {"species": 0, "max_level": 0, "min_level": 0}
                if (sp, mx, mn) != (s["species"], s["max_level"], s["min_level"]):
                    report.append("%s %s (loc %d) %s slot %d: PokeFinder (%d, L%d-%d) vs ours (%d, L%d-%d)" % (
                        game, t["table"], loc, key, i, sp, mn, mx, s["species"], s["min_level"], s["max_level"]))
        assert p == 176
    return n


def compare_hgss(game, mine, path, report):
    with open(path, "rb") as f:
        data = f.read()
    tables = {t["index"]: t for t in mine["tables"]}
    n = 0
    for off in range(0, len(data), 196):
        rec = data[off:off + 196]
        loc = rec[0]
        n += 1
        t = tables.get(loc)
        if t is None:
            report.append("%s: PokeFinder location %d has no table here" % (game, loc))
            continue
        rates = list(rec[1:7])
        zero = {"rate": 0, "slots": []}
        t = dict(t)
        for k in ("land", "surf", "rock_smash", "old_rod", "good_rod", "super_rod"):
            t.setdefault(k, zero)
        for k in ("hoenn_sound", "sinnoh_sound"):
            t.setdefault(k, [])
        t.setdefault("swarm", {})
        ours = [t["land"]["rate"], t["surf"]["rate"], t["rock_smash"]["rate"], t["old_rod"]["rate"], t["good_rod"]["rate"], t["super_rod"]["rate"]]
        if rates != ours:
            report.append("%s %s (loc %d): rates PokeFinder %s vs ours %s" % (game, t["table"], loc, rates, ours))
        p = 8
        pad = lambda xs, n: (xs + [0] * n)[:n] if xs else [0] * n
        for key in ("morning", "day", "night"):
            vals = [struct.unpack_from("<H", rec, p + 2 * i)[0] for i in range(12)]
            p += 24
            ours = pad([s[key]["species"] for s in t["land"]["slots"]], 12)
            if vals != ours:
                report.append("%s %s (loc %d) land %s: PokeFinder %s vs ours %s" % (game, t["table"], loc, key, vals, ours))
        levels = list(rec[p:p + 12])
        p += 12
        ours = pad([s["level"] for s in t["land"]["slots"]], 12)
        if levels != ours:
            report.append("%s %s (loc %d) land levels: PokeFinder %s vs ours %s" % (game, t["table"], loc, levels, ours))
        for key in ("hoenn_sound", "sinnoh_sound"):
            vals = [struct.unpack_from("<H", rec, p)[0], struct.unpack_from("<H", rec, p + 2)[0]]
            p += 4
            ours = pad([s["species"] for s in t[key]], 2)
            if vals != ours:
                report.append("%s %s (loc %d) %s: PokeFinder %s vs ours %s" % (game, t["table"], loc, key, vals, ours))
        for key, count in (("surf", 5), ("rock_smash", 2), ("old_rod", 5), ("good_rod", 5), ("super_rod", 5)):
            for i in range(count):
                sp, mx, mn = struct.unpack_from("<H", rec, p)[0], rec[p + 2], rec[p + 3]
                p += 4
                slots = t[key]["slots"]
                s = slots[i] if i < len(slots) else {"species": 0, "max_level": 0, "min_level": 0}
                if (sp, mx, mn) != (s["species"], s["max_level"], s["min_level"]):
                    report.append("%s %s (loc %d) %s slot %d: PokeFinder (%d, L%d-%d) vs ours (%d, L%d-%d)" % (
                        game, t["table"], loc, key, i, sp, mn, mx, s["species"], s["min_level"], s["max_level"]))
        swarm = [struct.unpack_from("<H", rec, p + 2 * i)[0] for i in range(4)]
        p += 8
        ours = [t["swarm"].get(k, {}).get("species", 0) for k in ("land", "surf", "night_fish", "fish")]
        if swarm != ours:
            report.append("%s %s (loc %d) swarm: PokeFinder %s vs ours %s" % (game, t["table"], loc, swarm, ours))
        assert p == 196
    return n


def compare_statics(gen, mine, pf_json, report):
    pf = json.load(open(pf_json, encoding="utf-8"))
    ours = mine["entries"]
    matched = set()
    for cat, entries in pf.items():
        if cat in ("galesColo", "galesColoShadow", "channel"):
            continue
        for e in entries:
            games = pf_games(e["version"])
            hits = [o for o in ours if o["species"] == e["specie"] and o["level"] == e["level"] and games & set(o["games"])]
            if not hits:
                near = [o for o in ours if o["species"] == e["specie"] and games & set(o["games"])]
                report.append("gen%d statics: PokeFinder %s %r (%s L%d) has no entry here%s" % (
                    gen, cat, e["description"], e["version"], e["level"],
                    "; ours: " + ", ".join("%s L%d" % (o["id"], o["level"]) for o in near) if near else ""))
            for h in hits:
                matched.add(h["id"])
    for o in ours:
        if o["id"] not in matched:
            report.append("gen%d statics: %s (%s L%d, %s) is not in PokeFinder's catalogue" % (
                gen, o["id"], o["name"], o["level"], "/".join(o["games"])))


# ----------------------------------------------------------------------------- main

def main():
    global PRET
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pret", default=PRET, help="directory holding the pret clones (default ~/AI/pret)")
    ap.add_argument("--out", default=os.path.join(ROOT, "core", "data"))
    ap.add_argument("--check", action="store_true", help="do not write; fail if the output differs from --out")
    ap.add_argument("--pokefinder", help="PokeFinder Core/Resources/EncounterTables directory to compare against")
    args = ap.parse_args()
    PRET = args.pret

    species3 = build_species_gen3()
    species4 = build_species_gen4(species3)
    enc3 = build_encounters_gen3(species3)
    enc4 = build_encounters_gen4(species4)
    s3 = {s["constant"]: s for s in species3["species"]}
    s4 = {s["constant"]: s for s in species4["species"]}
    handlers3 = [cite(*h) for h in GEN3_HANDLERS]
    handlers4 = [cite(*h) for h in GEN4_HANDLERS]
    statics3 = make_catalogue(gen3_static_entries(), s3, 3, {
        "creation_handlers": handlers3,
        "sources": {r: git_sha(r) for r in ("pokeruby", "pokeemerald", "pokefirered")},
        "seed_catalogue": "PokeFinder Core/Resources/EncounterTables/Gen3/encounters.json (levels re-verified against the "
                          "cited script lines; Marowak ghost and the Surf Pichu egg added from the decomp)"})
    statics4 = make_catalogue(gen4_static_entries(), s4, 4, {
        "creation_handlers": handlers4,
        "sources": {r: git_sha(r) for r in ("pokeplatinum", "pokeheartgold", "pokediamond")},
        "seed_catalogue": "PokeFinder Core/Resources/EncounterTables/Gen4/encounters.json; Platinum and HGSS levels "
                          "re-verified against the cited script lines; Diamond/Pearl entries carry PokeFinder provenance "
                          "because pokediamond ships field scripts only as binary scr_seq_release/*.bin",
        "version_check_note": "HGSS scripts branch on GetGameVersion == 7 (VERSION_HEARTGOLD, pokeheartgold/include/config.h:9)"})

    outputs = {
        "species-gen3.json": species3, "species-gen4.json": species4,
        "encounters-gen3.json": enc3, "encounters-gen4.json": enc4,
        "statics-gen3.json": statics3, "statics-gen4.json": statics4,
    }
    rc = 0
    os.makedirs(args.out, exist_ok=True)
    for name, obj in outputs.items():
        text = dump(obj)
        path = os.path.join(args.out, name)
        if args.check:
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            status = "unchanged" if old == text else "DIFFERS"
            if old != text:
                rc = 1
            print("%-22s %8d bytes  %s" % (name, len(text.encode("utf-8")), status))
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print("%-22s %8d bytes  written" % (name, len(text.encode("utf-8"))))
    print("species: gen3 %d, gen4 %d; gen4 differences from gen3: %d; statics: gen3 %d, gen4 %d" % (
        species3["meta"]["species_count"], species4["meta"]["species_count"],
        len(species4["meta"]["differences_from_gen3"]), statics3["meta"]["entry_count"], statics4["meta"]["entry_count"]))
    for w in species4["meta"]["warnings"]:
        print("warning:", w)

    if args.pokefinder:
        tmp = run_pokefinder(args.pokefinder)
        report = []
        counts = {}
        for game, fn in (("emerald", "emerald.bin"), ("ruby", "ruby.bin"), ("sapphire", "sapphire.bin"),
                         ("firered", "firered.bin"), ("leafgreen", "leafgreen.bin")):
            counts[game] = compare_gen3(game, enc3["games"][game], os.path.join(tmp, fn), report)
        for game, fn in (("platinum", "platinum.bin"), ("diamond", "diamond.bin"), ("pearl", "pearl.bin")):
            counts[game] = compare_dppt(game, enc4["games"][game], os.path.join(tmp, fn), report)
        for game, fn in (("heartgold", "heartgold.bin"), ("soulsilver", "soulsilver.bin")):
            counts[game] = compare_hgss(game, enc4["games"][game], os.path.join(tmp, fn), report)
        compare_statics(3, statics3, os.path.join(args.pokefinder, "Gen3", "encounters.json"), report)
        compare_statics(4, statics4, os.path.join(args.pokefinder, "Gen4", "encounters.json"), report)
        print("PokeFinder tables compared (records):", ", ".join("%s %d" % kv for kv in counts.items()))
        print("PokeFinder mismatches: %d" % len(report))
        for line in report:
            print("  " + line)
    return rc


if __name__ == "__main__":
    sys.exit(main())
