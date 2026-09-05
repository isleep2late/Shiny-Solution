#!/usr/bin/env python3
"""Generate core/data/gen1-tid.json and core/data/gen3-sid.json from RNG Solution's
registry (rngsolution/data/red/platforms.json) and its six Trainer ID tables
(rngsolution/data/{red,blue,yellow}/{gba-gbp,dmg}.csv).

The output is the single source of truth for the JS engine (core/gen1tid.js), the C#
engine (app/Core/Gen1Tid.cs) and the RNG Solution terminal front end. Every record is
copied verbatim (provenance strings included); this script only adds

  * "timing": the boot timing a methodology resolves to (its own hold window / menu
    frame / press-to-visible lag where it has one, else its console family's), the same
    rule as rngsolution/tables.py Platform._boot;
  * "table_data": the CSV table as 4 hex digits per offset, with the CSV's own '#'
    provenance header lines and a sha1 of the CSV file.

It also refuses to run over a registry whose Trainer ID target sets still window the ID's LOW
byte (see check_target_sets): on the save-corruption route only the high byte reaches the jump
pointer, and regenerating over the old rule would silently restore it.

Usage:  python3 tools/gen-gen1-data.py [path-to-RNG-Solution]   (default ../RNG-Solution)
Re-running it on the same inputs writes byte-identical files (no timestamps).
"""
import csv
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
RNG = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "RNG-Solution"))
DATA = os.path.join(RNG, "rngsolution", "data")
OUT_DIR = os.path.join(ROOT, "core", "data")

# verified_targets_evidence travels with verified_targets: the tag the front ends print is a claim
# about evidence ("[3x cold-boot verified]" only when the derivations are a fixture shipped in RNG
# Solution; the qualified tag otherwise), so a methodology that inherits the targets must inherit the
# evidence with them. RNG Solution's own mirror of these rules is tests/test_shared_data.py TIMING_KEYS.
TIMING_KEYS = ("hold_lo_frame", "hold_hi_frame", "menu_frame", "visible_lag_frames", "visible_lag_note",
               "verified_targets", "verified_targets_note", "verified_targets_evidence")


def sha1(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def load_csv(path):
    """CSV columns offset,tid_hex,hi,lo; '#' lines are provenance (rngsolution/tables.py load_table)."""
    table, header = {}, []
    with open(path, newline="") as f:
        for line in f:
            if line.startswith("#"):
                header.append(line.rstrip("\n"))
    with open(path, newline="") as f:
        for row in csv.reader(f):
            if not row or row[0].startswith("#") or not row[0].isdigit():
                continue
            tid = int(row[1], 16)
            if int(row[2], 16) != tid >> 8 or int(row[3], 16) != tid & 0xFF:
                raise SystemExit("%s: hi/lo bytes disagree with tid_hex at offset %s" % (path, row[0]))
            if int(row[0]) in table and table[int(row[0])] != tid:
                raise SystemExit("%s: offset %s listed twice with different IDs" % (path, row[0]))
            table[int(row[0])] = tid
    if not table:
        raise SystemExit("no rows in %s" % path)
    return table, header


def table_data(rel, path):
    table, header = load_csv(path)
    lo, hi = min(table), max(table)
    missing = [o for o in range(lo, hi + 1) if o not in table]
    if missing:
        raise SystemExit("%s: offsets missing inside %d-%d: %s" % (path, lo, hi, missing[:10]))
    tids = [table[o] for o in range(lo, hi + 1)]
    return {
        "file": rel,
        "sha1": sha1(path),
        "header": header,
        "format": "tids_hex holds 4 upper-case hex digits per offset, offset_min first; A press frame = menu frame + menu_to_table_frames + offset",
        "offset_min": lo,
        "offset_max": hi,
        "rows": len(tids),
        "distinct": len(set(tids)),
        "tids_hex": "".join("%04X" % t for t in tids),
    }


def check_target_sets(sets):
    """Refuse a Trainer ID set that puts a window on the ID's LOW byte.

    On the Any% save-corruption route only the Trainer ID's HIGH byte reaches the jump pointer:
    swap 1 overwrites $D35A-$D364 and destroys the ID's low byte before swap 2 copies
    ($D358, TID-high) into $D36E/$D36F. The bank-$1D sled window ($00-$38 / $3A-$5C) is real but
    constrains that pointer low byte ($D358 = wLetterPrintingDelayFlags = $01), not the ID, so a
    'sled' Trainer ID set is the 1-in-712 mistake this data was corrected away from on 2026-09-04.
    Regenerating over a registry that still carries it would silently restore it.
    """
    for key, spec in sets.items():
        if spec.get("kind") != "sled":
            continue
        lo = [(int(a, 16), int(b, 16)) for a, b in spec.get("lo_ranges", [])]
        if not any(a <= 0x00 and b >= 0xFF for a, b in lo):
            raise SystemExit(
                "target set %r is kind 'sled' with a restricted low byte %s: the bank-$1D window "
                "constrains the jump POINTER's low byte, not the Trainer ID's. Correct the registry "
                "(kind 'highbyte', or lo_ranges 00-FF) before regenerating." % (key, spec.get("lo_ranges")))


def main():
    reg_path = os.path.join(DATA, "red", "platforms.json")
    with open(reg_path) as f:
        reg = json.load(f)
    check_target_sets(reg["target_sets"])
    families = reg["families"]
    games = reg["games"]

    methodologies = {}
    for game_key, g in games.items():
        if g.get("status") != "supported":
            continue
        data_dir = g.get("data_dir", game_key)
        for mid in g["methodologies"]:
            rec = dict(reg["methodologies"][mid])
            fam = families[rec["console_id"]]
            rec["game_key"] = game_key
            rec["timing"] = {k: (rec[k] if k in rec else fam[k]) for k in TIMING_KEYS if k in rec or k in fam}
            table_name = rec.get("table", fam["table"])
            rel = "%s/%s" % (data_dir, table_name)
            rec["table_data"] = table_data(rel, os.path.join(DATA, data_dir, table_name))
            methodologies[mid] = rec
    for mid in reg["methodologies"]:
        if mid not in methodologies:
            raise SystemExit("methodology %s is defined but no supported game lists it" % mid)

    inputs = {"platforms.json": sha1(reg_path)}
    for m in methodologies.values():
        inputs[m["table_data"]["file"]] = m["table_data"]["sha1"]

    gen1 = {
        "source": "generated by tools/gen-gen1-data.py from RNG Solution rngsolution/data/red/platforms.json and the six "
                  "Trainer ID tables under rngsolution/data/{red,blue,yellow}; do not edit by hand, re-run the script",
        "inputs_sha1": inputs,
        "game": reg["game"],
        "fps_expression": reg["fps_expression"],
        "menu_to_table_frames": reg["menu_to_table_frames"],
        "menu_to_table_note": "the settle: A press frame = menu frame + menu_to_table_frames + offset (rngsolution/timeline.py MENU_TO_TABLE_FRAMES)",
        "defaults": reg["defaults"],
        "anchor_names": reg["anchor_names"],
        "families": families,
        "platforms": reg["platforms"],
        "reset_models": reg["reset_models"],
        "target_sets": reg["target_sets"],
        "games": {k: v for k, v in games.items() if v.get("status") == "supported"},
        "methodologies": methodologies,
        "unsupported": reg["unsupported"],
    }
    gen3 = {
        "source": "generated by tools/gen-gen1-data.py from RNG Solution rngsolution/data/red/platforms.json "
                  "(sid_methodologies, planned_methodologies); do not edit by hand, re-run the script",
        "inputs_sha1": {"platforms.json": inputs["platforms.json"]},
        "lcrng": "x = 0x41C64E6D * x + 0x6073 mod 2^32; SID = high 16 bits of LCRNG^(k+1)(TID); TSV = (TID ^ SID) >> 3",
        "gba_fps_expression": "16777216/280896",
        "games": {k: v for k, v in games.items() if v.get("status") in ("sid", "planned")},
        "methodologies": reg["sid_methodologies"],
        "planned_methodologies": reg["planned_methodologies"],
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, obj in (("gen1-tid.json", gen1), ("gen3-sid.json", gen3)):
        path = os.path.join(OUT_DIR, name)
        with open(path, "w") as f:
            json.dump(obj, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote %s (%d bytes)" % (os.path.relpath(path, ROOT), os.path.getsize(path)))


if __name__ == "__main__":
    main()
