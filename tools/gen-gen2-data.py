#!/usr/bin/env python3
"""Generate core/data/gen2-tid.json from the Gen 2 Trainer ID / Lucky ID derivation folder
(~/Desktop/Red-WR-Practice/gen2-tid: README.md, REVIEW.md, the 10 primary CSVs and the 152
rtc-brackets/ CSVs, inversion_summary.txt and inversion-<game>.json).

The output is the single source of truth for the JS engine (core/gen2tid.js) and the C#
engine (app/Core/Gen2Tid.cs). Every table is copied bin for bin from its CSV (the CSV's own
'#' provenance header lines are kept, deduplicated into "header_lines", and its sha1 is
recorded); the methodology records, the RTC state definitions, the LID and held-input rules
and the target sets are written here from the README's measured facts, and every number that
a CSV header also states (menu frame, visible menu frame, hold plateau, first poll, the bin
closed form, the NOROLL rows) is asserted against that header so the two cannot drift apart.

What this script computes rather than copies (and checks against the folder's own outputs):
  * bin -> (TID, LID[, SID]) per table, the closed-form bin function on every row, the roll
    frame per bin (constant within a bin) as roll_base + 4*bin + roll_slips[bin];
  * identical tables (same IDs on all 599 bins): the payload is stored once, the duplicates
    say "same_data_as" (the README's halt-days300 == halt-days1000 etc.);
  * the typed-TID / typed-(TID, LID) ambiguity statistics per game and subset, which must
    equal the folder's inversion-<game>.json "ambiguity" block where that file exists;
  * for every target set, the (table, bin) entries that produce it under the single-press
    protocol ("single_press_hits"; the README's analysis covers the primaries only).

Usage:  python3 tools/gen-gen2-data.py [path-to-gen2-tid-folder] [output-json]
        (default ~/Desktop/Red-WR-Practice/gen2-tid, read-only; the output defaults to
        core/data/gen2-tid.json or $SHINY_GEN2_OUT; tests/run-tests.sh regenerates into a
        temp file and cmp's it against the committed file, so a mismatch never dirties the tree)
Re-running it on the same inputs writes a byte-identical file (no timestamps, fixed order).
"""
import collections
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/Red-WR-Practice/gen2-tid"))
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else os.environ.get("SHINY_GEN2_OUT") or os.path.join(ROOT, "core", "data", "gen2-tid.json"))

FPS_EXPR = "4194304/70224"
DATE = "2026-09-03"          # the derivation and review date (README.md, REVIEW.md), not a run timestamp
CORE = "pokemon-speedrunning/gambatte-core 5a41a68c25402421fb1983ddadc9faf2418ddb0f"

GAMES = ["gold", "silver", "crystal"]
PLATFORM_KEYS = {"gold": ["gbp", "gbc", "dmg", "dmg-latestart"], "silver": ["gbp", "gbc", "dmg", "dmg-latestart"], "crystal": ["gbp", "gbc"]}
RUNNING = ["days0", "days200", "days260", "days300", "days450", "days512", "days700", "days780", "days850", "days1000"]
HALTED = ["halt-" + s for s in RUNNING]
STATES = RUNNING + HALTED

ROMS = {
    "gold": ("pokegold.gbc", "d8b8a3600a465308c9953dfa04f0081c05bdcb94"),
    "silver": ("pokesilver.gbc", "49b163f7e57702bc939d642a18f591de55d92dae"),
    "crystal": ("pokecrystal.gbc (Crystal 1.0)", "f4cd194bdee0d04ca4eac29e09b8e4e9d818c133"),
}
BOOT_ROMS = {
    "cgb": "cgb_boot.bin 2304 B sha1 1293d68bf9643bc4f36954c1e80e38f39864528d",
    "dmg": "dmg_boot.bin 256 B sha1 4ed31ec6b0b175bb109c0eb5fd3d193da823339f",
}

# Bin functions (README "Shiny Solution integration", asserted on every row of every table by make_csv.py and here).
BIN_RULES = {
    "gold-silver": {
        "games": ["gold", "silver"],
        "dropped_offsets": [0],
        "bin0_offsets": [1, 8],
        "subtract": 5,
        "formula": "offset == 0 -> dropped (NOROLL); offsets 1..8 -> bin 0; else bin = (offset - 5) // 4; bin 598 = offsets 2397-2399",
        "visible_bin0": [-3, 4],
        "visible_formula": "v = offset - 4 (frames after the VISIBLE menu box); v in -3..4 -> bin 0, then bin k = v in 4k+1..4k+4",
        "first_poll_after_detector": 9,
        "first_poll_after_visible": 5,
        "accept_to_roll_frames": 13,
        "why": "an 8-frame tap at offset 0 (frames 0-7) ends before the menu's first poll reads frame 8 and is dropped; the poll at detector+9 accepts taps that went down on or before detector+8, then one poll every 4 frames (SetUpMenu sets _2DMENU_DISABLE_JOYPAD_FILTER_F so _ScrollingMenuJoypad polls once per Move2DMenuCursor; WaitBGMap cycle)",
    },
    "crystal": {
        "games": ["crystal"],
        "dropped_offsets": [0, 1],
        "bin0_offsets": [2, 9],
        "subtract": 6,
        "formula": "offset <= 1 -> dropped (NOROLL); offsets 2..9 -> bin 0; else bin = (offset - 6) // 4; bin 598 = offsets 2398-2399",
        "visible_bin0": [-2, 5],
        "visible_formula": "v = offset - 4; v in -2..5 -> bin 0, then bin k = v in 4k+2..4k+5",
        "first_poll_after_detector": 10,
        "first_poll_after_visible": 6,
        "accept_to_roll_frames": 14,
        "why": "Crystal's first poll accepts taps that went down one frame later than Gold/Silver's (offsets 2-9 -> bin 0; offsets 0-1 are dropped) and the roll comes 14 frames after the last accepted A-down frame (13 in Gold/Silver): the CSV headers state the Crystal poll as 533 with the roll 13 after it, the same observable in the harness's other frame convention; the minimum press-to-roll gap in the CSV rows (14 for Crystal, 13 for Gold/Silver) is convention-free",
    },
}
BIN_COUNT = 599
OFFSET_MAX = 2399

# Measured boot timing per (game, platform key): START-hold plateau, menu detector frame, first poll (README "What a human
# sees" and "Human protocol" tables, logs/menu_visibility.txt, logs/plateaus_summary.txt). Asserted against every CSV header.
TIMING = {
    ("gold", "gbp"): (0, 355, 446), ("gold", "gbc"): (0, 355, 446),
    ("silver", "gbp"): (0, 355, 448), ("silver", "gbc"): (0, 355, 448),
    ("gold", "dmg"): (0, 347, 627), ("gold", "dmg-latestart"): (348, 545, 627),
    ("silver", "dmg"): (0, 347, 629), ("silver", "dmg-latestart"): (348, 545, 629),
    ("crystal", "gbp"): (0, 407, 522), ("crystal", "gbc"): (0, 407, 522),
}
VISIBLE_LAG = 4               # the menu box is drawn 4 frames after the detector on every configuration (logs/menu_visibility.txt)
# The IDs are written 13 frames after the accepting poll in Gold/Silver (review section 5: hJoyPressed on the poll frame, the roll on
# poll + 13); per bin rule because Crystal's rows show 14 frames from the last accepted A-down frame (header distributions).
TAP_FRAMES = [4, 8]           # the A tap: 4-8 frames (67-134 ms) (README "Held input", M1)
ROLL_SETTLE_S = 0.35          # press nothing until the New Game roll is over (README human protocol step 3)

FAMILIES = {
    "gbp": {
        "name": "GBA silicon booted with the CGB boot ROM and the GBA flag: GameCube Game Boy Player, GBA / GBA SP / GBA HD, GSE or gambatte-speedrun in GBP mode with the GBC BIOS",
        "boot_rom": BOOT_ROMS["cgb"], "load_flags": "CGB_MODE|GBA_FLAG|READONLY_SAV",
        "platform_keys": ["gbp"],
        "anchors": ["menu", "poweron", "reset"],
        "poweron_note": "On a GameCube Game Boy Player power-on is NOT an observable anchor (the Game Boy Player disc boots first, then the GBA->CGB stall); the harness's frame 0 includes gambatte's 485808-sample GBA->CGB stall (gambatte.cpp:230-231). Only the menu anchor is offered on the GBP; GSE adds the reset anchor with its fade + stall; a handheld GBA's power-on to CGB-boot delay is not measured.",
        "start_rule": "Hold START before the copyright text ends (frames 243-347 after power-on, 4.07-5.81 s) and keep it held until the NEW GAME / OPTION menu box appears; any START-down frame 0-355 (Crystal 0-407) opens the menu on the same frame.",
        "timeline": "CGB boot logo frames 1-165 (fade-in 68-165), white 166-217, handoff to the game at 186 (PC 0217 -> 0605), black 218-242, copyright text 243-347, black 348-375; with START held: title 398-401 (Silver 400-403), menu detector 446 (Silver 448), menu box VISIBLE 450 (452). Crystal: copyright 255-359, black 360-427, white 428-447, black 448, title 449-479, white 480-525, detector 522, visible 526.",
        "hardware_validation": "none. The 13 published Gold script TIDs (pastebin ZF4QX7Ya) and the 13 Silver ones (HEXruHKq) and the PSR (TID, LID) pair 6F49/03E9 all reproduce on this boot in the harness under their own multi-step protocols (logs/psr_*.txt), which is a bit-exact check of the core's cycle timing on this boot, not a hardware sample of the single-press tables.",
    },
    "gbc": {
        "name": "Game Boy Color: CGB boot ROM, no GBA flag",
        "boot_rom": BOOT_ROMS["cgb"], "load_flags": "CGB_MODE|READONLY_SAV",
        "platform_keys": ["gbc"],
        "anchors": ["menu", "poweron"],
        "poweron_note": "The power switch and the boot logo are observable; the hold window is wide enough that 'hold START before switching on' is the only instruction needed.",
        "start_rule": "Hold START before switching the console on (or at any rate before the copyright text ends) and keep it held until the NEW GAME / OPTION menu box appears.",
        "timeline": "as the GBP family (same CGB boot ROM, no GBA stall in the frame count: the harness's GBP frame 0 already includes its stall, so the frame numbers coincide)",
        "hardware_validation": "none",
    },
    "dmg": {
        "name": "Original Game Boy (DMG) with the genuine DMG boot ROM",
        "boot_rom": BOOT_ROMS["dmg"], "load_flags": "READONLY_SAV (DMG, no CGB_MODE)",
        "platform_keys": ["dmg", "dmg-latestart"],
        "anchors": ["menu", "poweron"],
        "poweron_note": "The power switch and the boot logo are observable.",
        "start_rule": "Two protocols, two tables: 'hold-start' = START down before the boot logo ends (hold frames 0-347: hold it before switching on); 'late-start' = START first pressed while the copyright text is on screen (frames 435-536; the white gap 348-434 also belongs to this table). The 347/348 boundary is 14 frames after the boot logo vanishes (334), so 'press START when the logo disappears' lands on either side: never cue that.",
        "timeline": "white 1-73, DMG boot logo 74-333, handoff at 334 (PC 0066 -> 05F8), white 334-434, copyright text 435-536, white 537-586; with START held: title 587-590, menu detector 627 (Silver 629), menu box VISIBLE 631 (633). The Game Freak logo would start at 545.",
        "hardware_validation": "none",
    },
}
PLATFORM_KEY_INFO = {
    "gbp": {"family": "gbp", "protocol": "hold-start", "name": "GBP / GBA silicon (CGB boot ROM + GBA flag)"},
    "gbc": {"family": "gbc", "protocol": "hold-start", "name": "Game Boy Color"},
    "dmg": {"family": "dmg", "protocol": "hold-start", "name": "DMG, START down before the boot logo ends"},
    "dmg-latestart": {"family": "dmg", "protocol": "late-start", "name": "DMG, START first pressed during the white gap or the copyright text"},
}
PLATFORMS = {
    "gse": {"name": "GSE or gambatte-speedrun in GBP mode with the GBC BIOS", "family": "gbp", "platform_key": "gbp", "anchors": ["menu", "reset"],
            "status": "emulator-exact", "validation": "The tables were derived on this core with this boot (CGB_MODE|GBA_FLAG, cgb_boot.bin), so the numbers are exact here; GSE boots with gambatte's fresh clock (RTC day 0, running) = the primary tables' state.",
            "reset": "gbp-fade", "reset_note": "Ctrl+R is the emulator's hard reset; in GBP mode it fades the game and stalls before the boot (the Gen 1 'gbp-fade' reset model in gen1-tid.json: 2.175 s), added to every power-on time. Keep a copy of the ROM with no .sav beside it: gambatte auto-loads a .sav and NEW GAME becomes CONTINUE; the LID column also needs a cleared save."},
    "gbp": {"name": "GameCube Game Boy Player", "family": "gbp", "platform_key": "gbp", "anchors": ["menu"],
            "status": "no hardware sample", "validation": "Same boot as the derivation (CGB boot ROM + GBA flag). No Gen 2 hardware sample exists; the community's Gold/Silver script manips are done on this console, which is consistent with, but not a test of, these tables."},
    "gba": {"name": "GBA, GBA SP or GBA HD", "family": "gbp", "platform_key": "gbp", "anchors": ["menu", "poweron"],
            "status": "no hardware sample", "validation": "Same silicon and boot ROM as the GBP path. The power-on anchor is INFERRED: the harness's frame 0 includes gambatte's 485808-sample (13.8-frame) GBA->CGB stall and a real GBA's power-on-to-CGB-boot delay is not measured, so use the menu anchor until a calibration sample settles the offset."},
    "gbc": {"name": "Game Boy Color", "family": "gbc", "platform_key": "gbc", "anchors": ["menu", "poweron"], "status": "no hardware sample", "validation": "Emulator-derived (CGB boot ROM, no GBA flag)."},
    "dmg": {"name": "Original Game Boy (DMG)", "family": "dmg", "platform_key": "dmg", "anchors": ["menu", "poweron"], "status": "no hardware sample",
            "validation": "Emulator-derived (DMG boot ROM). Choose the hold-start or the late-start methodology by when START went down (family note)."},
}
ANCHOR_NAMES = {
    "menu": "the instant the NEW GAME / OPTION menu box appears (recommended; the only anchor on a Game Boy Player)",
    "poweron": "as you flip the power on, START already held (GBC / DMG / handheld GBA; beeps then mark the START window and the menu)",
    "reset": "as you press the emulator's hard reset (GSE: the GBP fade and stall are added; beeps then mark the START window and the menu)",
}
DEFAULTS = {"platform": "gse", "state": "days0", "correction_ms": {"menu": 200.0, "poweron": 100.0, "reset": 100.0},
            "count_in_beeps": 4, "count_in_spacing_s": 1.0}

RTC_STATE_DEFS = [
    # id, family, carry, day bracket, representative day count, reachable after the first boot
    ("days0", "running", False, [0, 139], 0, True),
    ("days200", "running", False, [140, 255], 200, False),
    ("days260", "running", False, [256, 279], 260, False),
    ("days300", "running", False, [280, 419], 300, False),
    ("days450", "running", False, [420, 511], 450, False),
    ("days512", "running", True, [0, 139], 512, True),
    ("days700", "running", True, [140, 255], 700, False),
    ("days780", "running", True, [256, 279], 780, False),
    ("days850", "running", True, [280, 419], 850, False),
    ("days1000", "running", True, [420, 511], 1000, False),
]
HALTED_IDENTICAL = [["halt-days300", "halt-days1000"], ["halt-days260", "halt-days850"]]

STATUS = "emulator-derived, community-script cross-validated on GBP, no hardware sample"


def sha1(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def parse_csv(path):
    """Returns (header_lines, rows); rows = list of dicts with ints / None for NOROLL."""
    header, rows = [], []
    with open(path, newline="") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("#"):
                header.append(line)
                continue
            if line.startswith("offset,") or not line:
                continue
            f_ = line.split(",")
            if len(f_) != 10:
                raise SystemExit("%s: bad row %r" % (path, line))
            offset, press = int(f_[0]), int(f_[2])
            if f_[4] == "NOROLL":
                rows.append({"offset": offset, "bin": None, "press": press, "roll": None, "tid": None, "lid": None, "sid": None})
                continue
            tid, lid, sid = int(f_[4], 16), int(f_[6], 16), int(f_[8], 16)
            if int(f_[5]) != tid or int(f_[7]) != lid or int(f_[9]) != sid:
                raise SystemExit("%s: hex/dec disagree at offset %d" % (path, offset))
            rows.append({"offset": offset, "bin": int(f_[1]), "press": press, "roll": int(f_[3]), "tid": tid, "lid": lid, "sid": sid})
    if len(rows) != OFFSET_MAX + 1:
        raise SystemExit("%s: %d rows, expected %d" % (path, len(rows), OFFSET_MAX + 1))
    return header, rows


def closed_form_bin(offset, rule):
    if offset in rule["dropped_offsets"]:
        return None
    lo, hi = rule["bin0_offsets"]
    if lo <= offset <= hi:
        return 0
    return (offset - rule["subtract"]) // 4


def header_int(header, pattern, path, what):
    m = re.search(pattern, "\n".join(header))
    if not m:
        raise SystemExit("%s: header lacks %s (%s)" % (path, what, pattern))
    return int(m.group(1))


def build_table(game, plat, state, rel, path, rule, timing):
    header, rows = parse_csv(path)
    hold_lo, hold_hi, menu = timing
    # Every number the header states is checked against the constants above and the rows.
    if header_int(header, r"# menu_frame[^\[]*\[(\d+)\]", path, "menu_frame") != menu:
        raise SystemExit("%s: menu frame differs from the README timing" % path)
    if header_int(header, r"visible_menu_frame = menu_frame \+ 4 = (\d+)", path, "visible menu") != menu + VISIBLE_LAG:
        raise SystemExit("%s: visible menu frame is not menu + 4" % path)
    hp = "\n".join(header)
    m = (re.search(r"START held from any frame (\d+)-(\d+)", hp) or re.search(r"START pressed at any frame (\d+)-(\d+)", hp)
         or re.search(r"sub-plateau (\d+)-(\d+)", hp) or re.search(r"START held from frame 0 \(plateau (\d+)-(\d+)\)", hp))
    if not m:
        raise SystemExit("%s: header lacks the hold plateau" % path)
    plateau = (int(m.group(1)), int(m.group(2)))
    # bracket tables restate the whole plateau (0-355 / 0-407 / the DMG 0-347 or 348-545 sub-plateau)
    if plateau != (hold_lo, hold_hi) and not (state != "days0" and plat in ("gbp", "gbc") and plateau == (0, hold_hi)):
        raise SystemExit("%s: hold plateau %s differs from the README timing %s" % (path, plateau, (hold_lo, hold_hi)))
    mp = re.search(r"first menu poll(?: frame)? (\d+)", hp)
    first_poll = menu + 1 + rule["bin0_offsets"][1]
    if mp and int(mp.group(1)) not in (first_poll, first_poll + 1):
        raise SystemExit("%s: first poll %s vs computed %d" % (path, mp.group(1), first_poll))
    dropped = [r["offset"] for r in rows if r["bin"] is None]
    if dropped != rule["dropped_offsets"]:
        raise SystemExit("%s: NOROLL offsets %s, rule says %s" % (path, dropped, rule["dropped_offsets"]))
    bins = {}
    for r in rows:
        if r["press"] != menu + 1 + r["offset"]:
            raise SystemExit("%s: press_frame %d != menu + 1 + offset at offset %d" % (path, r["press"], r["offset"]))
        if r["bin"] is None:
            continue
        if r["bin"] != closed_form_bin(r["offset"], rule):
            raise SystemExit("%s: bin %d at offset %d disagrees with the closed form" % (path, r["bin"], r["offset"]))
        ent = (r["tid"], r["lid"], r["sid"], r["roll"])
        if r["bin"] in bins and bins[r["bin"]] != ent:
            raise SystemExit("%s: bin %d is not constant (%s vs %s)" % (path, r["bin"], bins[r["bin"]], ent))
        bins[r["bin"]] = ent
    if sorted(bins) != list(range(BIN_COUNT)):
        raise SystemExit("%s: bins are not 0..%d" % (path, BIN_COUNT - 1))
    deltas = {b: bins[b][3] - (menu + 4 * b) for b in bins}
    roll_base = min(deltas.values())
    slips = {str(b): deltas[b] - roll_base for b in sorted(deltas) if deltas[b] != roll_base}
    if roll_base != (first_poll - menu) + rule["accept_to_roll_frames"]:
        raise SystemExit("%s: roll base %d is not first-poll + %d" % (path, roll_base, rule["accept_to_roll_frames"]))
    if any(v < 1 or v > 8 for v in map(int, slips.values())):
        raise SystemExit("%s: implausible roll slip %s" % (path, slips))
    tids = [bins[b][0] for b in range(BIN_COUNT)]
    lids = [bins[b][1] for b in range(BIN_COUNT)]
    sids = [bins[b][2] for b in range(BIN_COUNT)]
    if game != "crystal" and any(sids):
        raise SystemExit("%s: a non-zero SID in a Gold/Silver table" % path)
    payload = {
        "file": rel, "sha1": sha1(path), "header": header,
        "bins": BIN_COUNT, "offset_min": rule["bin0_offsets"][0], "offset_max": OFFSET_MAX, "dropped_offsets": rule["dropped_offsets"],
        "distinct_tids": len(set(tids)), "distinct_lids": len(set(lids)), "distinct_tid_lid_pairs": len(set(zip(tids, lids))),
        "tids_hex": "".join("%04X" % t for t in tids), "lids_hex": "".join("%04X" % t for t in lids),
        "roll_base": roll_base, "roll_slips": slips,
    }
    if game == "crystal":
        payload["sids_hex"] = "".join("%04X" % t for t in sids)
        payload["distinct_sids"] = len(set(sids))
    data_key = (tuple(tids), tuple(lids), tuple(sids), roll_base, tuple(sorted(slips.items())))
    return payload, data_key, (tids, lids, sids)


def ambiguity(tables_by_key, keys, crystal):
    """inversion.py's stats over a set of (merged) tables; tables_by_key[k] = (tids, lids, sids)."""
    bt, bp = collections.defaultdict(list), collections.defaultdict(list)
    for k in keys:
        tids, lids, _ = tables_by_key[k]
        for b in range(BIN_COUNT):
            bt[tids[b]].append((k, b))
            bp[(tids[b], lids[b])].append((k, b))
    tot = sum(len(v) for v in bt.values())
    if not tot:
        return {"tables": 0, "entries": 0, "distinct_tids": 0, "tids_with_multiple_candidates": 0, "ambiguous_entries": 0,
                "ambiguous_entry_rate": 0.0, "max_candidates": 0, "tid_lid_pairs_with_multiple_candidates": 0, "tid_lid_collisions": []}
    mu = {t: v for t, v in bt.items() if len(v) > 1}
    return {
        "tables": len(keys), "entries": tot, "distinct_tids": len(bt), "tids_with_multiple_candidates": len(mu),
        "ambiguous_entries": sum(len(v) for v in mu.values()),
        "ambiguous_entry_rate": round(100.0 * sum(len(v) for v in mu.values()) / tot, 2),
        "max_candidates": max(len(v) for v in bt.values()),
        "tid_lid_pairs_with_multiple_candidates": sum(1 for v in bp.values() if len(v) > 1),
        "tid_lid_collisions": [{"tid": "%04X" % t, "lid": "%04X" % l, "candidates": [{"table": k, "bin": b} for k, b in v]}
                               for (t, l), v in sorted(bp.items()) if len(v) > 1],
    }


def main():
    if not os.path.isdir(SRC):
        raise SystemExit("source folder not found: %s" % SRC)
    inputs = {}
    for name in ("README.md", "REVIEW.md", "inversion_summary.txt", "make_csv.py"):
        p = os.path.join(SRC, name)
        if os.path.exists(p):
            inputs[name] = sha1(p)

    header_ids, header_lines = {}, {}

    def hid(line):
        if line not in header_ids:
            header_ids[line] = "h%03d" % (len(header_ids) + 1)
            header_lines[header_ids[line]] = line
        return header_ids[line]

    methodologies, rtc_tables = {}, {}
    payload_by_datakey = {}          # data key -> table key that carries the payload
    ids_by_table = {}                # table key -> (tids, lids, sids)
    table_order = []
    # 1. the primaries (methodologies), 2. the bracket tables in a fixed order
    for game in GAMES:
        rule_name = "crystal" if game == "crystal" else "gold-silver"
        rule = BIN_RULES[rule_name]
        for plat in PLATFORM_KEYS[game]:
            for state in ([s for s in STATES] if game != "crystal" else ["days0"]):
                if state == "days0":
                    rel = "%s-%s.csv" % (game, plat)
                else:
                    rel = "rtc-brackets/%s-%s-rtc-%s.csv" % (game, plat, state.replace("halt-", "halt-"))
                path = os.path.join(SRC, rel)
                if not os.path.exists(path):
                    raise SystemExit("missing table %s" % rel)
                payload, dkey, ids = build_table(game, plat, state, rel, path, rule, TIMING[(game, plat)])
                key = "%s/%s/%s" % (game, plat, state)
                inputs[rel] = payload["sha1"]
                payload["header"] = [hid(h) for h in payload["header"]]
                ids_by_table[key] = ids
                table_order.append(key)
                if dkey in payload_by_datakey:
                    # identical on every bin (IDs and roll frames): keep the provenance, point at the payload
                    dup = {"file": payload["file"], "sha1": payload["sha1"], "header": payload["header"], "same_data_as": payload_by_datakey[dkey],
                           "identical": "all %d bins (TID, LID%s, roll frame) identical to same_data_as" % (BIN_COUNT, ", SID" if game == "crystal" else "")}
                    payload = dup
                else:
                    payload_by_datakey[dkey] = key
                if state == "days0":
                    methodologies[key] = payload
                else:
                    rtc_tables[key] = payload

    # identical groups (for the record; must include the README's pairs)
    groups = collections.defaultdict(list)
    for key in table_order:
        p = methodologies.get(key) or rtc_tables[key]
        groups[p.get("same_data_as", key)].append(key)
    identical_groups = sorted([sorted(v) for v in groups.values() if len(v) > 1])
    for game in ("gold", "silver"):
        for plat in PLATFORM_KEYS[game]:
            for a, b in HALTED_IDENTICAL:
                ka, kb = "%s/%s/%s" % (game, plat, a), "%s/%s/%s" % (game, plat, b)
                if not any(ka in g and kb in g for g in identical_groups):
                    raise SystemExit("README claims %s == %s but the CSVs differ" % (ka, kb))

    # DMG hold-start vs late-start per RTC state, MEASURED from the payloads (the README's "all halt states" is not exact:
    # halt-days700 differs); Gold and Silver must agree, and the identical-table grouping must agree with the equal-bin count.
    def carrier_of(key):
        p = methodologies.get(key) or rtc_tables[key]
        return p.get("same_data_as", key)
    dmg_identical, dmg_equal_bins = None, None
    for game in ("gold", "silver"):
        same, eq = [], {}
        for state in STATES:
            a, b = ids_by_table["%s/dmg/%s" % (game, state)], ids_by_table["%s/dmg-latestart/%s" % (game, state)]
            eq[state] = sum(1 for i in range(BIN_COUNT) if a[0][i] == b[0][i] and a[1][i] == b[1][i])
            if carrier_of("%s/dmg/%s" % (game, state)) == carrier_of("%s/dmg-latestart/%s" % (game, state)):
                same.append(state)
            if (eq[state] == BIN_COUNT) != (state in same):
                raise SystemExit("%s %s: DMG tables equal on %d bins but the payload grouping says %s" % (game, state, eq[state], state in same))
        if dmg_identical is None:
            dmg_identical, dmg_equal_bins = same, eq
        elif (same, eq) != (dmg_identical, dmg_equal_bins):
            raise SystemExit("Gold and Silver disagree on which RTC states the DMG hold-start and late-start tables coincide in")
    dmg_split = [st for st in STATES if st not in dmg_identical]

    # methodology records
    meth_records = {}
    for game in GAMES:
        rule_name = "crystal" if game == "crystal" else "gold-silver"
        rule = BIN_RULES[rule_name]
        gname = "Pokemon %s (English)" % game.capitalize()
        for plat in PLATFORM_KEYS[game]:
            info = PLATFORM_KEY_INFO[plat]
            fam = FAMILIES[info["family"]]
            hold_lo, hold_hi, menu = TIMING[(game, plat)]
            mid = "%s/%s/%s-v1" % (game, info["family"], info["protocol"])
            first_poll = menu + 1 + rule["bin0_offsets"][1]
            gs = game != "crystal"
            if info["protocol"] == "hold-start":
                if info["family"] == "dmg":
                    start_step = ("Hold START before switching the Game Boy on, so it is down before the boot logo ends (START-down frames 0-347;"
                                  " the logo vanishes at 334), and keep it held until the NEW GAME / OPTION menu box appears.")
                elif info["family"] == "gbc":
                    start_step = ("Hold START before switching the Game Boy Color on (any START-down frame 0-%d works, i.e. before the copyright"
                                  " text ends) and keep it held until the NEW GAME / OPTION menu box appears." % hold_hi)
                else:
                    start_step = ("Press START before the copyright text ends (START-down frames 0-%d after power-on; the copyright text is"
                                  " frames %s) and keep it held until the NEW GAME / OPTION menu box appears." % (hold_hi, "255-359" if game == "crystal" else "243-347"))
            else:
                start_step = ("Switch the Game Boy on with nothing held. Press START while the copyright text is on screen (frames 435-536;"
                              " the white gap 348-434 after the boot logo also belongs to this table, START-down frames 348-545) and keep it"
                              " held until the NEW GAME / OPTION menu box appears.")
            protocol = " ".join([
                "Clear the save data (Up+B+Select on the title screen) so the menu shows NEW GAME with no CONTINUE; the Lucky ID column"
                " applies only to the first New Game after that clear.",
                "RTC: a Gold/Silver cartridge must have its clock running with fewer than 140 days on the counter (the primary table, RTC state"
                " days0) or a known bracket (the rtc tables; a 140-511-day bracket lasts ONE boot: the game writes the counter back mod 140, so the"
                " next boot of the same cartridge is days0, or days512 with the carry bit); Crystal is immune." if gs else "Crystal is immune to the RTC state and to held input.",
                start_step,
                "The menu box is drawn 4 frames after the game's detector frame (%d, visible %d); release START as it appears." % (menu, menu + VISIBLE_LAG),
                "At the cue tap A ONCE for 4-8 frames (67-134 ms). The A press is the one timed input: with v = frames after the visible menu,"
                " %s; the menu's first poll accepts an A that went down up to visible+%d and then every 4 frames, so the target is a 4-frame bin, not a frame."
                % (rule["visible_formula"], rule["first_poll_after_visible"]),
                ("Gold/Silver: START must be up before the A tap and nothing may be down from 7 frames after the accepting poll until the"
                 " New Game roll 13 frames after it (about 0.35 s after the tap): a tap over 8 frames or START still held changes the"
                 " Lucky ID on 40-51 % of bins and the Trainer ID (+/-1 in one byte) on 7-25 %." if gs else
                 "The same 4-8 frame tap is what selects exactly one bin; Crystal's IDs do not change under held input."),
                "Read the Trainer ID (and the Lucky ID on the Radio Tower lottery screen%s) afterwards." % (", the Secret ID is not shown" if game == "crystal" else ""),
            ])
            validity = [
                "%s booted on %s (%s, %s)." % (gname, fam["name"], fam["boot_rom"], fam["load_flags"]),
                "The save is cleared (Up+B+Select on the title: EmptyAllSRAMBanks): the menu shows NEW GAME with no CONTINUE; for the Lucky ID"
                " column this must be the FIRST New Game after the clear (a later New Game returns the earlier Lucky ID unchanged).",
                ("START goes down inside START-down frames %d-%d after power-on and stays held until the NEW GAME / OPTION menu box appears;"
                 " the menu detector fires on frame %d and the box is visible on %d whatever the START frame inside the window." % (hold_lo, hold_hi, menu, menu + VISIBLE_LAG)),
                "START is released before the A tap; one A tap of 4-8 frames (67-134 ms) on NEW GAME is the only timed input; nothing else"
                " is pressed until the New Game roll is over (about 0.35 s after the tap).",
                "The A tap's bin: %s (offset = frames after the detector at which A goes down)." % rule["formula"],
            ]
            if gs:
                validity += [
                    "The MBC3 RTC is running (halt bit clear) with a day counter of 0-139 days and no carry at the moment StartClock reads it"
                    " (~1.5-2 s after power-on): RTC state days0 = this methodology's table. Other day brackets, the carry bit and a halted clock"
                    " select the other tables of the same methodology (rtc_tables); a dead-battery cartridge's register state is unmodelled.",
                    "The day brackets 140-511 (days200/260/300/450 and, with the carry bit, days700/780/850/1000) apply to ONE boot only: FixDays"
                    " writes the day counter back mod 140 through SetClock (pokegold home/time.asm:61-120, :205-250), so the next boot of the same"
                    " cartridge is in days0, or days512 if the carry bit was set (written back unchanged, cleared only by SaveRTC on a save); SetClock"
                    " clears the halt bit and StartRTC (the end of StartClock, run on every boot from home/init.asm:123) clears it unconditionally,"
                    " so a halted cartridge is halted for its FIRST boot only, whatever its day count. A cartridge booted at least once since its"
                    " battery went in is therefore in days0 or days512 (rtc.states[*].reachable_after_first_boot; the engine's two-state prior);"
                    " GSE and the community bruteforcer boot with gambatte's fresh clock = days0.",
                    "Any other input pattern (a longer tap, START still down at the roll, a second press, the community multi-step scripts,"
                    " a CONTINUE menu) gives a different deterministic result that this methodology does not cover.",
                ]
            else:
                validity += ["Any RTC state (Crystal's StartClock runs after the LCD is on and rIF is cleared before ei, so the clock's cycle count"
                             " is absorbed: measured identical for 0-1000 days including the carry brackets, the nine bracket sweeps equal the"
                             " primary; the halted family was not swept for Crystal).",
                             "Any other input pattern (a second press, the community setopt scripts, a CONTINUE menu) gives a different"
                             " deterministic result that this methodology does not cover."]
            if info["protocol"] == "late-start":
                validity.append("START was NOT down while the boot logo was showing (that is the hold-start methodology's table; the two differ by"
                                " one DIV step on every bin in RTC state days0, differ as well in %s, and coincide in %s: measured,"
                                " rtc.identical_tables / rtc.dmg_equal_bins)."
                                % (", ".join("%s (%d of %d bins equal)" % (st, dmg_equal_bins[st], BIN_COUNT) for st in dmg_split if st != "days0"),
                                   ", ".join(dmg_identical)))
            elif info["family"] == "dmg":
                validity.append("START was already down when the boot logo ended (frame 334); a START first pressed after that is the late-start methodology.")
            timing = {
                "hold_lo_frame": hold_lo, "hold_hi_frame": hold_hi, "menu_frame": menu, "visible_menu_frame": menu + VISIBLE_LAG,
                "first_poll_frame": first_poll, "poll_period_frames": 4, "accept_to_roll_frames": rule["accept_to_roll_frames"],
                "press_frame_rule": "press_frame = menu_frame + 1 + offset (0-based harness frames from power-on; on GBP including the GBA->CGB stall)",
                "first_poll_rule": "first_poll_frame = menu_frame + 1 + (last offset of bin 0) = the last A-down frame the menu's first poll accepts; the poll of bin k accepts A-down frames up to first_poll_frame + 4k; the roll is accept_to_roll_frames after that frame (plus roll_slips)",
                "visible_lag_frames": None,
                "visible_lag_note": "no hardware press-to-visible lag exists for Gen 2 (no hardware sample); the menu box itself is the visible anchor",
                "frame_convention": "frame 0 = the first frame after power-on (35112 audio samples = 70224 cycles per frame); seconds = frames / (4194304/70224)",
            }
            meth_records[mid] = {
                "id": mid, "name": ("hold START from power-on, release it at the menu, one 4-8-frame A tap on NEW GAME" if info["protocol"] == "hold-start"
                                    else "press START during the copyright text, release it at the menu, one 4-8-frame A tap on NEW GAME"),
                "game": gname, "game_key": game, "console_id": info["family"], "console_name": fam["name"], "platform_key": plat,
                "version": 1, "date": DATE, "status": STATUS,
                "predicts": "the Trainer ID and the Lucky ID" + (" and the Secret ID (wSecretID)" if game == "crystal" else "") + " of the New Game",
                "protocol": protocol, "landmark": fam["start_rule"], "validity": validity,
                "anchors": list(fam["anchors"]),
                "anchor_note": "menu = the visible menu box (every platform); poweron = the power switch (GBC, DMG, handheld GBA: inferred there);"
                               " reset = GSE's hard reset in GBP mode (the Gen 1 gbp-fade model's fade + stall added). platforms[] says which a console offers.",
                "bin_rule": rule_name, "rolls": ["tid", "lid"] + (["sid"] if game == "crystal" else []),
                "rtc_dependent": gs, "table": "%s-%s.csv" % (game, plat), "timing": timing,
                "derivation": "%s, %s, START held from frame %d (plateau %d-%d), one 8-frame A tap at every offset 0-2399; three independent"
                              " full derivations (hold frames at the start, middle and end of the plateau) byte-identical; the negative control"
                              " (hold one frame past the plateau) agrees on 0 of 2400; the review added 40 random offsets from an unused hold"
                              " frame (40/40) and, for Gold GBP, a fourth full derivation (2400/2400)"
                              % (CORE, fam["load_flags"], hold_lo if info["protocol"] == "hold-start" else 544, hold_lo, hold_hi),
                "validation": fam["hardware_validation"],
                "provenance": "STRUCTURAL: wPlayerID is written once, first thing in _ResetWRAM (pokegold engine/menus/intro_menu.asm:28-49;"
                              " pokecrystal :107-128): hRandomSub after a DelayFrame, hRandomAdd after another; Crystal then rolls wSecretID"
                              " (:130-134); the LID two Randoms later in LoadOrRegenerateLuckyIDNumber (:225-248) when sLuckyNumberDay != 1."
                              " The RNG is only the VBlank DIV stir (home/vblank.asm:68-79), so the IDs are a function of the A frame."
                              " EMPIRICAL: the table is a per-offset sweep on the cycle-accurate core (README.md, REVIEW.md in the derivation folder).",
                "table_data": methodologies["%s/%s/days0" % (game, plat)],
            }
            meth_records[mid]["table_data"]["format"] = (
                "tids_hex / lids_hex%s hold 4 upper-case hex digits per BIN, bin 0 first (599 bins); bin -> offsets by bin_rules[bin_rule];"
                " press frame = menu_frame + 1 + offset; the accepting poll of bin k = first_poll_frame + 4k; roll frame (the frame in which"
                " wMoney becomes 3000 and the IDs are written) = menu_frame + roll_base + 4k + roll_slips[k] (accept_to_roll_frames after the"
                " last accepted A-down frame of the bin, one frame more on the slipped bins)" % (" / sids_hex" if game == "crystal" else ""))

    # link each rtc table to its methodology and state
    for key, p in rtc_tables.items():
        game, plat, state = key.split("/")
        info = PLATFORM_KEY_INFO[plat]
        p["methodology"] = "%s/%s/%s-v1" % (game, info["family"], info["protocol"])
        p["state"] = state
        p["platform_key"] = plat
        p["game_key"] = game
    for mid, m in meth_records.items():
        m["rtc_tables"] = sorted(k for k, p in rtc_tables.items() if p["methodology"] == mid)

    # RTC state / family records
    states = {}
    for sid, fam, carry, bracket, rep, reach in RTC_STATE_DEFS:
        label = "%d-%d days%s" % (bracket[0], bracket[1], " (mod 512) + carry" if carry else ", no carry")
        states[sid] = {"family": "running", "halt": False, "carry": carry, "day_bracket": bracket, "representative_days": rep, "label": label,
                       "reachable_after_first_boot": reach,
                       "why": ("the day counter is written back mod 140 by FixDays/SetClock on this boot, so the next boot is in 0-139"
                               if not reach and not carry else
                               "the carry bit is written back unchanged by SetClock and cleared only by SaveRTC on a save, but the day counter"
                               " is written back mod 140, so the next boot is days512" if not reach else
                               "persists across boots (the carry is cleared only by a save)" if carry else "the fresh-battery / GSE / bruteforcer state; persists")}
    for sid, fam, carry, bracket, rep, reach in RTC_STATE_DEFS:
        h = "halt-" + sid
        same = [pair for pair in HALTED_IDENTICAL if h in pair]
        states[h] = {"family": "halted", "halt": True, "carry": carry, "day_bracket": bracket, "representative_days": rep,
                     "label": "HALTED, " + states[sid]["label"], "registers": "DH = 0x40 | (carry << 7) | (day bit 8), DL = days & 0xFF, H = M = S = 0",
                     "reachable_after_first_boot": False,
                     "why": ("StartRTC, called at the end of StartClock on every boot (home/init.asm:123 -> engine/rtc/rtc.asm StartClock -> StartRTC:"
                             " res B_RAMB_RTC_DH_HALT), clears the halt bit unconditionally, so a halted cartridge is halted for its first boot only;"
                             " the next boot is %s" % ("days512 (the carry is written back unchanged)" if carry else "days0"))
                            + ("" if bracket[0] == 0 else "; on this boot FixDays also writes the day counter back mod 140 through SetClock, which clears the halt bit as well"),
                     "identical_to": [x for pair in same for x in pair if x != h]}
    rtc = {
        "applies_to": ["gold", "silver"],
        "crystal": "immune: pokecrystal home/init.asm switches the LCD on (:131) before StartClock (:143) and clears rIF before ei (:155-159), so"
                   " the clock's cycle count never moves the VBlank DIV samples; measured: 0/100/139/140/200/512 days give one row and the nine"
                   " bracket sweeps equal the primary (README 'RTC dependence')",
        "structural": "pokegold home/init.asm runs StartClock (:123) BEFORE the LCD is switched on (:140); StartClock (engine/rtc/rtc.asm:91-101)"
                      " -> _FixDays (:103-115) -> FixDays (home/time.asm:61-120) loops 'sub 140' once per 140 days, takes the day-high-bit branch"
                      " at 256, calls SetClock (home/time.asm:205-250) and RecordRTCStatus when >= 140, so its cycle count moves the LCD (every"
                      " VBlank DIV sample) relative to DIV. Bracket edges = the loop counts: 0-139 skip; 140-255 two .mod iterations; 256-279"
                      " .modh 1 + .modl 1; 280-395 1+2 and 396-419 2+1 (same cost, one bracket); 420-511 2+2. With the halt bit set _GetClock"
                      " (engine/rtc/rtc.asm:117-137) also opens SRAM and writes sRTCHaltCheckValue and _FixDays takes .reset_rtc, both before"
                      " LCD-on: the halted family matches none of the running brackets.",
        "measured": "gen2tid rtc / .rtc sidecars on Gold GBP, offsets 100 and 777: every edge (140 / 256 / 280 / 420 / 512 + carry) confirmed;"
                    " hours/minutes/seconds have no effect inside a bracket; the day is evaluated when StartClock runs, ~1.5-2 s after power-on"
                    " (139 d 23:59:59 already gives the 140-day value). Every bracket table differs from its platform's day-0 primary on all 2399"
                    " offsets; every halted table differs from every running table of its platform (logs/rtc_bracket_compare.txt).",
        "states": states,
        "families": {
            "running": {"name": "RTC running (halt bit clear)", "states": RUNNING, "default_state": "days0", "two_state_prior": ["days0", "days512"],
                        "note": "the ten day-count brackets (five without and five with the day-carry bit, recurring mod 512)"},
            "halted": {"name": "RTC halted (DH bit 6 set)", "states": HALTED, "distinct_tables": 8, "identical_pairs": HALTED_IDENTICAL,
                       "note": "an eleventh family, set through the core's <rom>.rtc sidecar (Cartridge::loadSavedata, mem/cartridge.cpp:379-447;"
                               " GB::setTime clears the halt bit, mem/rtc.cpp:81-94); halt-days300 == halt-days1000 and halt-days260 == halt-days850"
                               " on every platform (the carry test saves 16 cycles in _FixDays = one FixDays loop iteration, INFERRED from the identity)"},
        },
        "on_cart": "STRUCTURAL (home/time.asm:110-113, SetClock :205-250, SaveRTC rtc.asm:76-89): the day counter is days since the battery went in"
                   " (or the last write-back); FixDays writes it back mod 140, so brackets 140-511 are single-boot transients; the carry bit is"
                   " written back unchanged and cleared only by SaveRTC on a save. A runner who resets repeatedly is, after the first boot, in"
                   " one of two states only: days0 (the primary table) or days512 (carry, < 140 days). GSE and the community bruteforcer boot"
                   " with gambatte's fresh clock (0 days, running) = days0.",
        "dead_battery": "unmodelled: what a real MBC3's registers read after power loss (halt bit, carry, garbage day count, or nothing) is"
                        " hardware behaviour the harness does not model; no bracket can be assigned a priori. If the halt bit reads set it is in"
                        " the halted family; if only the carry, in the days512 family; otherwise in a day bracket; which one can only come from a"
                        " typed TID (inversion).",
        "identical_tables": identical_groups,
        "dmg_identical_states": dmg_identical,
        "dmg_split_states": dmg_split,
        "dmg_equal_bins": dmg_equal_bins,
        "dmg_note": "the DMG hold-start and late-start tables coincide in RTC states %s (measured: identical_tables) and differ in %s"
                    " (dmg_equal_bins = bins with the same TID and LID in both tables); the source README's 'all halt states' is not exact"
                    " (halt-days700 differs). Some DMG brackets are near-identical without being equal (days700 vs days780: 2247 of 2399"
                    " offsets equal; halt-days200 vs halt-days260: 2279)."
                    % (", ".join(dmg_identical), ", ".join("%s (%d of %d)" % (st, dmg_equal_bins[st], BIN_COUNT) for st in dmg_split)),
        "tables": rtc_tables,
    }

    # inversion statistics per game, computed here and checked against the folder's inversion-<game>.json
    inversion = {"procedure": [
        "know the platform (console; on a DMG also whether START was down before the boot logo ended): a typed TID normally also identifies the"
        " platform (45 of 2396 Gold and 41 of 2396 Silver (platform, bin) entries share a TID with another platform's primary) but ask, do not infer",
        "if the Lucky ID was typed, look up (TID, LID): unique across every table of a platform except the listed collisions (Silver GBP: one,"
        " between two carry brackets); this needs the LID conditions (first New Game after a clear, a 4-8-frame tap)",
        "otherwise look up the TID with the two-state prior: a cartridge booted at least once since the battery went in is in days0 or days512"
        " (2.0-2.3 % of entries ambiguous between the two, max 2 candidates); fall back to the ten running brackets (8.7-9.1 % ambiguous, max 4),"
        " then the halted family, only for a cartridge whose clock was halted and that has not been booted since (StartRTC clears the halt"
        " bit on every boot)",
        "no candidate at all: wrong platform (SGB, 3DS Virtual Console, a header-renamed ROM), a dead-battery register state, or a violated"
        " protocol (held input, tap length, a second press): ask for a second boot",
    ], "games": {}}
    for game in GAMES:
        merged = {}     # table key (the payload carrier) -> ids ; plus the member list
        members = collections.defaultdict(list)
        for key in table_order:
            if not key.startswith(game + "/"):
                continue
            p = methodologies.get(key) or rtc_tables[key]
            carrier = p.get("same_data_as", key)
            merged[carrier] = ids_by_table[carrier]
            members[carrier].append(key)
        crystal = game == "crystal"

        def has_pl(k, pl):
            return any(m.split("/")[1] == pl for m in members[k])

        def state_of(k):
            return k.split("/")[2]

        def is_halt(k):
            return state_of(k).startswith("halt")

        subsets = {
            "all_distinct_tables": list(merged),
            "gbp_running_10": [k for k in merged if has_pl(k, "gbp") and not is_halt(k)],
            "gbp_days0_and_days512": [k for k in merged if has_pl(k, "gbp") and state_of(k) in ("days0", "days512")],
            "primaries_days0_all_platforms": [k for k in merged if state_of(k) == "days0"],
            "running_10_all_platforms": [k for k in merged if not is_halt(k)],
            "halted_distinct_all_platforms": [k for k in merged if is_halt(k)],
        }
        for pl in PLATFORM_KEYS[game]:
            subsets["%s_all_states" % pl] = [k for k in merged if has_pl(k, pl)]
            subsets["%s_running_10" % pl] = [k for k in merged if has_pl(k, pl) and not is_halt(k)]
            subsets["%s_halted_distinct" % pl] = [k for k in merged if has_pl(k, pl) and is_halt(k)]
            subsets["%s_days0_only" % pl] = [k for k in merged if has_pl(k, pl) and state_of(k) == "days0"]
        stats = {name: ambiguity(merged, keys, crystal) for name, keys in subsets.items()}
        full_collisions = {name: st["tid_lid_collisions"] for name, st in stats.items()}
        src_inv = os.path.join(SRC, "inversion-%s.json" % game)
        checked = False
        if os.path.exists(src_inv):
            with open(src_inv) as f:
                src = json.load(f)["ambiguity"]
            for name, st in stats.items():
                if name not in src:
                    raise SystemExit("inversion-%s.json lacks subset %s" % (game, name))
                for fld in ("tables", "entries", "distinct_tids", "tids_with_multiple_candidates", "ambiguous_entries", "ambiguous_entry_rate",
                            "max_candidates", "tid_lid_pairs_with_multiple_candidates"):
                    if src[name][fld] != st[fld]:
                        raise SystemExit("inversion %s/%s/%s: folder says %s, recomputed %s" % (game, name, fld, src[name][fld], st[fld]))
                mine = sorted((c["tid"], c["lid"]) for c in full_collisions[name])
                theirs = sorted((c["tid"], c["lid"]) for c in src[name]["tid_lid_collisions"])
                if mine != theirs:
                    raise SystemExit("inversion %s/%s collisions differ: %s vs %s" % (game, name, mine, theirs))
            inputs["inversion-%s.json" % game] = sha1(src_inv)
            checked = True
        # the full collision lists are checked above; the DMG subsets have thousands (near-identical brackets), so the file keeps
        # the count and at most 20 examples per subset (the engines recompute every collision from the tables anyway)
        for name, st in stats.items():
            if len(st["tid_lid_collisions"]) > 20:
                st["tid_lid_collisions"] = st["tid_lid_collisions"][:20]
                st["tid_lid_collisions_truncated"] = True
        inversion["games"][game] = {
            "distinct_tables": len(merged), "shipped_tables": sum(len(v) for v in members.values()),
            "merged_members": {k: sorted(v) for k, v in sorted(members.items()) if len(v) > 1},
            "ambiguity": stats,
            "cross_checked_against": "inversion-%s.json (same numbers on every subset)" % game if checked else "nothing (inversion-%s.json not present)" % game,
        }

    # target sets, with the single-press hits measured across every table
    target_sets = {
        "psr-gs-any-09705": {
            "name": "PSR Gold/Silver Any% backup-collision route: 'Manip TID to 09705' ($25E9)", "kind": "tid-list", "tids": ["25E9"], "games": ["gold", "silver"],
            "protocol": "community-script",
            "route": "the Trainer ID is executed as code through the Coin Case ACE collision (community; the byte mechanism is not traced here)",
            "provenance": "EMPIRICAL: pokemon-speedrunning/speedrun-routes docs/gen-2/gold-silver/main-any/gold-silver-backup-collision-route/README.md:6-11"
                          " ('Manip TID to 09705', Gold offsets 13750/22750 pastebin ZF4QX7Ya, Silver 14100/23350 pastebin HEXruHKq). The scripts"
                          " reproduce in the harness (Gold: gold_gfwait_wait112(opt)_backout3_newgame, START held in the 687-706 plateau, W = 448"
                          " -> 25E9 and all 13 published neighbours BDAA F0CA CA28 9BA1 7E10 C5FD 25E9 62EE 8A22 627E 32F2 D398 4869 for W = 424..472"
                          " step 4; Silver: silver_intro0_backout3_wait52_backout5_newgame, 707-726 plateau, W = 216 -> 25E9 and its 13 neighbours),"
                          " on GBP with RTC day 0 (logs/psr_gold_reproduction.txt, psr_silver_reproduction.txt).",
            "note": "NOT reachable by the single-press methodologies in RTC state days0 (logs/analysis_primaries.txt): those values come from the"
                    " multi-step scripts (buffered backouts to the title and an OPTION in/out), which are a different input stream.",
        },
        "psr-gs-old-55785": {
            "name": "older Gold/Silver Any% route: TID 55785 ($D9E9)", "kind": "tid-list", "tids": ["D9E9"], "games": ["gold", "silver"],
            "protocol": "community-script",
            "route": "the older collision route (Gold without collision: pastebin VDWfuung, linked from docs/gen-2/gold-silver/main-any/silver-no-collision-route/README.md:3)",
            "provenance": "RNG Solution docs/ALL_GENERATIONS_FEASIBILITY.md section 3 row Gold/Silver ('older 55785'); the derivation folder's analyse.py"
                          " searched every primary for D9E9 (none). The route's input sequence is not reproduced in the harness.",
            "note": "NOT reachable by the single-press methodologies in RTC state days0; community script protocol, input sequence unknown.",
        },
        "psr-gold-nsc-d900": {
            "name": "PSR Gold NSC: TID $D900 (55552) with LID $D3EC (54252)", "kind": "pair-list", "pairs": [["D900", "D3EC"]], "games": ["gold"],
            "protocol": "community-script",
            "route": "gold_gfwait_backout4_wait337(setopt)_backout10_newgame: TID = 0xD900 (55552), LID = 0xD3EC (54252), Offset (wait) 43.297, offset (wait GBI) 42.720, Offset (NG) 58.32; adjacent framerules -3 32656, -2 62051, -1 65433, 0 55552, 1 14846, 2 02669",
            "provenance": "EMPIRICAL: docs/gen-2/gold-silver/catext/nsc/README.md:3-11 (verbatim above). Not reproduced in the harness.",
            "note": "NOT reachable by the single-press methodologies in RTC state days0; community script protocol.",
        },
        "glitchless-lid-01001": {
            "name": "Gold/Silver/Crystal Any% Glitchless LID manip: Lucky ID 01001 ($03E9) = Kenya's OT ID wins the lottery", "kind": "lid-list", "lids": ["03E9"],
            "published_pair": ["6F49", "03E9"], "games": ["gold", "silver", "crystal"],
            "protocol": "community-script",
            "route": "LID 01001 equals Kenya's fixed OT ID (pokegold engine/pokemon/move_mon.asm:1 'DEF RANDY_OT_ID EQU 01001'), so the Radio Tower"
                      " lottery pays the Master Ball; the TID 6F49 is a by-product listed alongside; the LID must survive to the Radio Tower special"
                      " (Sunday condition, lid_rules)",
            "provenance": "EMPIRICAL: docs/gen-2/gold-silver/main-glitchless/resources/lid-frames.md TARGET row 0x6F49 (28489) / 0x03E9 (01001) with"
                          " six early / six late neighbours; script gold_gfskip_backout3_wait216(opt)_backout1_newgame (hold from power-on, W = 864)"
                          " reproduces the pair and its twelve neighbours in the harness (13,132-boot search, logs/psr_gold_lidframes_reproduction.txt)."
                          " The Crystal glitchless route (docs/gen-2/crystal/main-glitchless/README.md:5,13) links its own 'LID Manip' video and"
                          " 'Start Second 0' timer; its script is not reproduced.",
            "note": "NOT reachable by the single-press methodologies in RTC state days0 (LID 03E9 absent from every primary); community script protocol."
                    " A single-press hit in some other table would give the LID but not the published TID.",
        },
        "crystal-26fb-186f": {
            "name": "Crystal Any% (Coin Case ACE): TID $26FB (09979) AND LID $186F (06255)", "kind": "pair-list", "pairs": [["26FB", "186F"]], "games": ["crystal"],
            "protocol": "community-script",
            "route": "TID 0x26FB acts as 'ld h,$FB' through Cyndaquil's OT ID (pokecrystal engine/pokemon/move_mon.asm:145-148) and LID 0x186F as 'jr $6F': a two-value target from one input script",
            "provenance": "SECONDARY: RNG Solution docs/ALL_GENERATIONS_FEASIBILITY.md section 3 row Crystal (glitchcity wiki, pastebin EiQzry7w,"
                          " 'unverified fetch'). The PSR Crystal route docs under /tmp/psr_routes/docs/gen-2/crystal do not name these values"
                          " (the glitchless README links an 'LID Manip' video only). Not reproduced in the harness (Crystal setopt scripts).",
            "note": "NOT reachable by the single-press methodologies (both primaries searched, logs/analysis_primaries.txt); community script protocol,"
                    " provenance secondary.",
        },
    }

    def accepts(ts, tid, lid, sid):
        if ts["kind"] == "tid-list":
            return "%04X" % tid in ts["tids"]
        if ts["kind"] == "lid-list":
            return "%04X" % lid in ts["lids"]
        if ts["kind"] == "pair-list":
            return ["%04X" % tid, "%04X" % lid] in ts["pairs"]
        raise SystemExit("unknown target set kind %s" % ts["kind"])

    for key, ts in target_sets.items():
        hits = []
        for tkey in table_order:
            game = tkey.split("/")[0]
            if game not in ts["games"]:
                continue
            p = methodologies.get(tkey) or rtc_tables[tkey]
            tids, lids, sids = ids_by_table[p.get("same_data_as", tkey)]
            for b in range(BIN_COUNT):
                if accepts(ts, tids[b], lids[b], sids[b]):
                    hits.append({"table": tkey, "bin": b, "tid": "%04X" % tids[b], "lid": "%04X" % lids[b],
                                 "state": tkey.split("/")[2], "reachable_after_first_boot": states[tkey.split("/")[2]]["reachable_after_first_boot"] if game != "crystal" else True})
        ts["single_press_hits"] = hits
        ts["single_press_hits_note"] = ("measured over every shipped table (all RTC states, identical tables counted once per state) of the set's games:"
                                        " %d (table, bin) entries produce a member of this set under the single-press protocol; the README's analysis"
                                        " covers the day-0 primaries only. A hit in a 140-511-day or halted bracket is a single-boot state (rtc.states)." % len(hits))

    games = {}
    for game in GAMES:
        games[game] = {
            "name": "Pokemon %s (English)" % game.capitalize(), "rom": "%s sha1 %s (pret build)" % ROMS[game], "status": "supported",
            "ids": ["tid", "lid"] + (["sid"] if game == "crystal" else []),
            "rtc_dependent": game != "crystal", "bin_rule": "crystal" if game == "crystal" else "gold-silver",
            "platform_keys": PLATFORM_KEYS[game],
            "methodologies": [mid for mid in meth_records if meth_records[mid]["game_key"] == game],
            "target_sets": [k for k, ts in target_sets.items() if game in ts["games"]],
            "default_target_sets": [k for k, ts in target_sets.items() if game in ts["games"]],
            "wram": {"gold": "wPlayerID $D1A1, wLuckyIDNumber $D9E9, wMoney $D573, wMenuDataPointer $CEBD, MainMenu.MenuData 01:5A9F (pokegold.sym; gen2tid.cpp:59-61)",
                     "silver": "wPlayerID $D1A1, wLuckyIDNumber $D9E9, wMoney $D573, wMenuDataPointer $CEBD, MainMenu.MenuData 01:5A9F (pokesilver.sym; gen2tid.cpp:59-61)",
                     "crystal": "wPlayerID $D47B, wLuckyIDNumber $DC9F, wSecretID $D84A, wMoney $D84E, wMenuDataPointer $CF86, MainMenu.MenuData 12:5D1C (pokecrystal.sym; gen2tid.cpp:62-64)"}[game],
        }

    held_input = {
        "rule": "Gold/Silver, all platforms: release START, then tap A for 4-8 frames (67-134 ms at 59.7275 fps), and press nothing until the New"
                " Game roll is over (about 0.35 s after the tap). A tap under 4 frames can miss the 4-frame poll grid; a tap over 8 frames, or START"
                " still down, changes the LID on 40-51 % of bins and the TID (+/-1 in one byte) on 7-25 %. Crystal: immune (0 differences under"
                " both abuses), but the same tap length is what selects one bin.",
        "window": "nothing may be down from 7 frames after the accepting poll until the roll 13 frames after it (the worst case over the sampled"
                  " poll phases: Silver GBP offsets 101-103 change as soon as the tap is still down 7 frames after the poll; Gold GBP offset 100"
                  " tolerates a tap through poll+11)",
        "measured": {
            "START never released / A held 20 frames (TID differs, LID differs, of 2399 offsets)": {
                "gold/gbp": [248, 1103], "gold/gbc": [160, 1155], "gold/dmg": [199, 964], "gold/dmg-latestart": [199, 960],
                "silver/gbp": [380, 1228], "silver/gbc": [220, 1120], "silver/dmg": [592, 1055], "silver/dmg-latestart": [592, 1051],
                "crystal/gbp": [0, 0], "crystal/gbc": [0, 0]},
            "tap length sweeps (TID differs / LID differs): 4-8 frames": {"gold/gbp": [0, 0], "silver/gbp": [0, 0], "gold/dmg": [0, 0], "silver/dmg": [0, 0]},
            "tap 9 frames": {"gold/gbp": [81, 3], "silver/gbp": [94, 94], "gold/dmg": [46, 0], "silver/dmg": [152, 54]},
            "tap 13 frames": {"gold/gbp": [293, 12], "silver/gbp": [377, 377], "gold/dmg": [199, 0]},
        },
        "structural": "INFERRED: pokegold's IE_DEFAULT enables the joypad interrupt (constants/ram_constants.asm:358; handler Joypad:: is a bare"
                      " reti, home/joypad.asm:1-6); pokecrystal's IE_DEFAULT (:392) omits it and Crystal is immune. The cycle-level path is not"
                      " traced; the protocol consequence is measured (logs/heldinput_summary.txt, logs/scan_summary.txt, sweeps-fix.tar.gz).",
    }
    lid_rules = {
        "summary": "all three required for a target Lucky ID; the Trainer ID column needs none of them",
        "conditions": [
            {"id": "first-new-game-after-clear",
             "text": "SRAM sLuckyNumberDay != 1 at the New Game, i.e. the FIRST New Game after 'clear save data' (Up+B+Select on the title,"
                     " EmptyAllSRAMBanks, zero-fill) or on a never-started cartridge; every later New Game returns the earlier LID unchanged.",
             "structural": "LoadOrRegenerateLuckyIDNumber (pokegold engine/menus/intro_menu.asm:225-248; pokecrystal :312-336) rolls two Random"
                           " only if sLuckyNumberDay != wCurDay+1 (wCurDay is 0 after the WRAM clear) and writes sLuckyNumberDay = 1 plus the LID"
                           " to SRAM right there, without a save; EmptyAllSRAMBanks engine/menus/empty_sram.asm:1-19",
             "measured": "logs/sram_luckyday_control.txt (sLuckyNumberDay = 1 with LID 1234 planted: LID comes back 1234, TID/SID unchanged; day 2:"
                         " re-rolled) and logs/twoboot_lid_persistence.txt (New Game, soft reset keeping SRAM, New Game: LID returned unchanged;"
                         " with EmptyAllSRAMBanks between: re-rolled = the table) on Gold GBP/DMG, Silver GBP, Crystal GBP"},
            {"id": "no-button-down-until-the-roll", "text": held_input["rule"], "structural": held_input["structural"], "measured": "logs/heldinput_summary.txt"},
            {"id": "sunday-at-the-radio-tower",
             "text": "the LID survives to the Radio Tower lottery only if the in-game day is Sunday (wCurDay == 0) when the special runs, i.e."
                     " the clock set to Sunday and the special reached before the in-game day changes.",
             "structural": "ResetLuckyNumberShowFlag (pokegold engine/events/specials.asm:321-326) calls the same LoadOrRegenerateLuckyIDNumber,"
                           " which re-rolls unless sLuckyNumberDay == wCurDay+1; a New Game left 1",
             "measured": "NOT measured (read only); the twoboot control covers persistence across New Games, not the Radio Tower"},
        ],
        "crystal_sid": "wSecretID is rolled in _ResetWRAM two Random calls after the TID (pokecrystal intro_menu.asm:130-134), is immune to held"
                       " input and the RTC, and is in the Crystal tables (sids_hex); it is not shown in game.",
    }
    community = {
        "gold_09705": {"script": "gold_gfwait_wait112(opt)_backout3_newgame (pastebin ZF4QX7Ya)", "platform": "gbp", "rtc_days": 0,
                       "hold_plateau": "687-706 (the 'gfwait' plateau: intro movie skipped at its first poll)", "W": 448,
                       "neighbours_W_424_to_472_step_4": ["BDAA", "F0CA", "CA28", "9BA1", "7E10", "C5FD", "25E9", "62EE", "8A22", "627E", "32F2", "D398", "4869"],
                       "also": "hold 687 and 706 give 25E9; hold 710 (the next plateau) gives 8EFD; GBC gives 2DE4, DMG F05E"},
        "silver_09705": {"script": "silver_intro0_backout3_wait52_backout5_newgame (pastebin HEXruHKq)", "platform": "gbp", "rtc_days": 0, "hold_plateau": "707-726", "W": 216,
                         "neighbours_W_192_to_240_step_4": ["A7BE", "D0DE", "C82E", "9AA4", "5529", "D1FB", "25E9", "9BB9", "B3E8", "A53C", "87A4", "3140", "AD0E"]},
        "gold_lid_pair": {"script": "gold_gfskip_backout3_wait216(opt)_backout1_newgame (hold from power-on, W = 864)", "platform": "gbp", "rtc_days": 0,
                          "tid": "6F49", "lid": "03E9", "search": "lidsearch.sh: 13,132 boots, exactly one 6F49,03E9 line",
                          "note": "the LID comes from two sub-frame Random DIV reads, so this is a bit-exact check of the core's cycle timing"},
        "note": "The review re-ran all three from its own build: identical. These validate the emulator boot the tables share, under a different"
                " input protocol; they are not hardware samples.",
    }
    plateaus = {
        "gold": {"gbp+gbc": "power-on 0-355 -> menu 446 (first poll 455); gfwait 687-706 -> 778, 707-726 -> 800; movie-end 3251-3341 -> 3387",
                 "dmg": "power-on 0-545 -> 627 (split at 347/348, two tables; first poll 636); gfwait 875-894 -> 957, 895-915 -> 978; movie-end 3416-3505 -> 3543"},
        "silver": {"gbp+gbc": "0-355 -> 448 (457); gfwait 687-706 -> 780, 707-726 -> 802; movie-end 3251-3343 -> 3389",
                   "dmg": "0-545 -> 629 (split at 347/348; 638); gfwait 875-894 -> 959, 895-915 -> 980; movie-end 3416-3507 -> 3545"},
        "crystal": {"gbp+gbc": "0-407 -> 522 (532); gfwait 784-803 -> 906, 804-869 -> 972; then 999-1043, 1173-1238, 1368-1471, ... (16 plateaus); movie-end 3246-3305 -> 3349"},
        "note": "logs/hold_*_0-3600.txt, logs/plateaus_summary.txt; only the power-on plateaus are tabulated (the community scripts use the gfwait plateaus)",
    }

    out = {
        "source": "generated by tools/gen-gen2-data.py from the Gen 2 derivation folder (README.md, REVIEW.md, the 10 primary CSVs and the 152"
                  " rtc-brackets CSVs, inversion-<game>.json); do not edit by hand, re-run the script",
        "inputs_sha1": dict(sorted(inputs.items())),
        "generation": 2,
        "date": DATE,
        "core": CORE + " built with g++ 13.3.0 -O2 -std=c++14 -DREVISION=0 -DHAVE_CSTDINT; harness gen2tid.cpp in the derivation folder",
        "fps_expression": FPS_EXPR,
        "frame_convention": "all frame numbers are 0-based harness frame indices from power-on (frame 0 = the first frame after power-on; on GBP"
                            " including gambatte's GBA->CGB stall); one frame = 70224 cycles = 35112 audio samples; seconds = frames / (4194304/70224)",
        "visible_menu_lag_frames": VISIBLE_LAG,
        "visible_menu_note": "the menu detector (wMenuDataPointer == MainMenu.MenuData) fires 4 frames before the box is drawn on every configuration"
                             " (logs/menu_visibility.txt: brightness 255 -> 243 at detector + 4); CSV offsets are relative to the detector; a human"
                             " anchoring on the visible menu uses v = offset - 4",
        "poll_period_frames": 4,
        "accept_to_roll_frames": {k: v["accept_to_roll_frames"] for k, v in BIN_RULES.items()},
        "tap_frames": TAP_FRAMES,
        "tap_note": "the A tap must last 4-8 frames (67-134 ms): under 4 can miss the 4-frame poll grid, over 8 violates the held-input rule (Gold/Silver)",
        "roll_settle_s": ROLL_SETTLE_S,
        "defaults": DEFAULTS,
        "anchor_names": ANCHOR_NAMES,
        "bin_rules": BIN_RULES,
        "families": FAMILIES,
        "platform_keys": PLATFORM_KEY_INFO,
        "platforms": PLATFORMS,
        "games": games,
        "methodologies": meth_records,
        "rtc": rtc,
        "held_input": held_input,
        "lid_rules": lid_rules,
        "inversion": inversion,
        "target_sets": target_sets,
        "community_validation": community,
        "hold_plateaus": plateaus,
        "header_lines": header_lines,
        "not_derived": ["SGB2 / Super Game Boy path", "3DS Virtual Console", "Crystal 1.1 and the header-renamed ROM copies (Gold.gbc 58f8fcf1, Crystal.gbc 7a859a1e)",
                        "Crystal's setopt scripts and the old 55785 route (input sequence unknown)", "the Sunday LID condition on a cartridge",
                        "a real MBC3's dead-battery register state", "any hardware sample of any Gen 2 configuration"],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    n_payload = sum(1 for k in table_order if "same_data_as" not in (methodologies.get(k) or rtc_tables[k]))
    print("wrote %s (%d bytes): %d methodologies, %d tables (%d payloads, %d identical groups), %d header lines, %d target sets"
          % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT), len(meth_records), len(table_order), n_payload, len(identical_groups),
             len(header_lines), len(target_sets)))
    for k, ts in target_sets.items():
        print("  %-22s single-press hits: %d %s" % (k, len(ts["single_press_hits"]),
                                                    ["%s/bin%d" % (h["table"], h["bin"]) for h in ts["single_press_hits"]][:6]))


if __name__ == "__main__":
    main()
