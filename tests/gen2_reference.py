#!/usr/bin/env python3
"""Independent reference for the Gen 2 Trainer ID / Lucky ID engine (core/gen2tid.js, app/Core/Gen2Tid.cs).

Reads the derivation folder's CSVs DIRECTLY (not core/data/gen2-tid.json) and computes, with its own
arithmetic, everything the ports compute: the 4-frame bin function, bin -> offsets, table lookups, the
typed-TID / typed-(TID, LID) inversion across RTC states with the two-state prior, the target sets,
the cue schedules from the menu / power-on / reset anchors, the bin-based calibration and the verify.
Emits tests/gen2tid-vectors.json; the JS and C# runners check the ports (over the generated JSON) against
it. Every expected value here therefore also checks tools/gen-gen2-data.py: a table decoded from the JSON
must reproduce the CSV rows this script read.

    python3 tests/gen2_reference.py [path-to-gen2-tid-folder] > tests/gen2tid-vectors.json

Deterministic: random.Random(20260903), no timestamps. Standard library only.
NaN / infinities never occur; a case whose call raises records {"error": <class name>} and the port must throw.
"""
import collections
import hashlib
import json
import os
import random
import sys

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/Red-WR-Practice/gen2-tid"))
SEED = 20260903

FPS = 4194304.0 / 70224.0
FRAME_MS = 1000.0 / FPS
VISIBLE_LAG = 4
BIN_COUNT = 599
OFFSET_MAX = 2399
TAP_FRAMES = (4, 8)
ROLL_SETTLE_S = 0.35
OUTLIER_FRAMES = 60          # Gen 1's outlier guard reused: 60 frames = 15 bins

COUNT_IN = (880.0, 60.0)
A_CUE = (1320.0, 150.0)
HOLD = (660.0, 80.0)
MENU_MARK = (990.0, 40.0)
COUNT_IN_CLEAR_S = 0.5

GAMES = ["gold", "silver", "crystal"]
PLATFORM_KEYS = {"gold": ["gbp", "gbc", "dmg", "dmg-latestart"], "silver": ["gbp", "gbc", "dmg", "dmg-latestart"], "crystal": ["gbp", "gbc"]}
RUNNING = ["days0", "days200", "days260", "days300", "days450", "days512", "days700", "days780", "days850", "days1000"]
HALTED = ["halt-" + s for s in RUNNING]
STATES = RUNNING + HALTED
TWO_STATE = ["days0", "days512"]
REACHABLE = {"days0", "days512", "halt-days0", "halt-days512"}       # after the first boot (README "What a cartridge does")
FAMILY_OF = {"gbp": "gbp", "gbc": "gbc", "dmg": "dmg", "dmg-latestart": "dmg"}
PROTOCOL_OF = {"gbp": "hold-start", "gbc": "hold-start", "dmg": "hold-start", "dmg-latestart": "late-start"}
ANCHORS_OF = {"gbp": ["menu", "poweron", "reset"], "gbc": ["menu", "poweron"], "dmg": ["menu", "poweron"]}

# The bin rules (README "Shiny Solution integration") and the boot timing (README tables), restated here.
RULES = {
    "gold": {"dropped": [0], "bin0": (1, 8), "sub": 5, "accept_to_roll": 13},
    "silver": {"dropped": [0], "bin0": (1, 8), "sub": 5, "accept_to_roll": 13},
    "crystal": {"dropped": [0, 1], "bin0": (2, 9), "sub": 6, "accept_to_roll": 14},
}
TIMING = {
    ("gold", "gbp"): (0, 355, 446), ("gold", "gbc"): (0, 355, 446), ("silver", "gbp"): (0, 355, 448), ("silver", "gbc"): (0, 355, 448),
    ("gold", "dmg"): (0, 347, 627), ("gold", "dmg-latestart"): (348, 545, 627), ("silver", "dmg"): (0, 347, 629), ("silver", "dmg-latestart"): (348, 545, 629),
    ("crystal", "gbp"): (0, 407, 522), ("crystal", "gbc"): (0, 407, 522),
}
GBP_RESET_EXTRA_S = ((35.160828206880836 + 36.1607997265892) / 2.0 + 94.2574618364092) / FPS   # gen1-tid.json gbp-fade: 2.1752 s

# Target sets (the same members tools/gen-gen2-data.py records; membership is what is tested, provenance lives in the JSON).
TARGET_SETS = {
    "psr-gs-any-09705": {"kind": "tid-list", "tids": [0x25E9], "games": ["gold", "silver"]},
    "psr-gs-old-55785": {"kind": "tid-list", "tids": [0xD9E9], "games": ["gold", "silver"]},
    "psr-gold-nsc-d900": {"kind": "pair-list", "pairs": [(0xD900, 0xD3EC)], "games": ["gold"]},
    "glitchless-lid-01001": {"kind": "lid-list", "lids": [0x03E9], "games": ["gold", "silver", "crystal"]},
    "crystal-26fb-186f": {"kind": "pair-list", "pairs": [(0x26FB, 0x186F)], "games": ["crystal"]},
}


def mid_of(game, plat):
    return "%s/%s/%s-v1" % (game, FAMILY_OF[plat], PROTOCOL_OF[plat])


def table_path(game, plat, state):
    if state == "days0":
        return "%s-%s.csv" % (game, plat)
    return "rtc-brackets/%s-%s-rtc-%s.csv" % (game, plat, state)


def sha1(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def read_table(path):
    """CSV -> (menu_frame, bins) where bins[b] = (tid, lid, sid, roll_frame); checks the closed form on every row."""
    bins, menu = {}, None
    with open(path) as f:
        for line in f:
            if line.startswith("# menu_frame"):
                menu = int(line.split("[")[1].split("]")[0])
            if line.startswith("#") or line.startswith("offset,") or not line.strip():
                continue
            fld = line.rstrip("\n").split(",")
            offset = int(fld[0])
            if fld[4] == "NOROLL":
                continue
            b = int(fld[1])
            ent = (int(fld[4], 16), int(fld[6], 16), int(fld[8], 16), int(fld[3]))
            if b in bins:
                assert bins[b] == ent, (path, b)
            bins[b] = ent
            assert int(fld[2]) == menu + 1 + offset, (path, offset)
    assert sorted(bins) == list(range(BIN_COUNT)), path
    return menu, bins


# ---- the engine's arithmetic, restated ---------------------------------------------------------------

def bin_of(game, offset):
    r = RULES[game]
    if offset < 0 or offset > OFFSET_MAX or offset in r["dropped"]:
        return None
    if r["bin0"][0] <= offset <= r["bin0"][1]:
        return 0
    return (offset - r["sub"]) // 4


def offsets_for_bin(game, b):
    r = RULES[game]
    if b < 0 or b >= BIN_COUNT:
        raise ValueError("bin %d is outside 0..%d" % (b, BIN_COUNT - 1))
    if b == 0:
        return list(r["bin0"])
    lo = 4 * b + r["sub"]
    return [lo, min(lo + 3, OFFSET_MAX)]


def aim_offset(game, b):
    lo, hi = offsets_for_bin(game, b)
    return (lo + hi) / 2.0


def visible_window(game, b):
    lo, hi = offsets_for_bin(game, b)
    return [lo - VISIBLE_LAG, hi - VISIBLE_LAG]


def implied_correction(game, used_ms, hit_bin, aimed_bin):
    return used_ms + (aim_offset(game, hit_bin) - aim_offset(game, aimed_bin)) * FRAME_MS


def cue(t, tone, label, kind):
    return {"t": t, "freq": tone[0], "ms": tone[1], "label": label, "kind": kind}


def count_in(t_a, beeps, spacing, not_before=0.0):
    if not spacing > 0:
        raise ValueError("count-in spacing must be positive")
    if beeps < 0:
        raise ValueError("count-in beeps must be 0 or more")
    out, dropped = [], 0
    for k in range(beeps, 0, -1):
        t = t_a - k * spacing
        if t < not_before:
            dropped += 1
            continue
        out.append(cue(t, COUNT_IN, "count-%d" % k, "count"))
    return out, dropped


def schedule(game, plat, b, anchor, correction_ms, beeps=4, spacing=1.0, reset_extra_s=None):
    hold_lo, hold_hi, menu_frame = TIMING[(game, plat)]
    if anchor not in ANCHORS_OF[FAMILY_OF[plat]]:
        raise ValueError("anchor %s is not offered for %s" % (anchor, plat))
    v_lo, v_hi = visible_window(game, b)
    aim_v = aim_offset(game, b) - VISIBLE_LAG
    if anchor == "menu":
        t_a = aim_v / FPS - correction_ms / 1000.0
        if t_a <= 0:
            raise ValueError("the A cue would be due before the anchor")
        cues, dropped = count_in(t_a, beeps, spacing)
        cues.append(cue(t_a, A_CUE, "A", "A"))
        hold_lo_s = hold_hi_s = menu_s = None
        base = 0.0
    else:
        extra = 0.0
        if anchor == "reset":
            if reset_extra_s is None:
                raise ValueError("the reset anchor needs the console's reset delay")
            extra = reset_extra_s
        hold_lo_s = hold_lo / FPS + extra
        hold_hi_s = hold_hi / FPS + extra
        menu_s = (menu_frame + VISIBLE_LAG) / FPS + extra
        t_a = menu_s + aim_v / FPS - correction_ms / 1000.0
        if t_a <= menu_s:
            raise ValueError("the A cue would be due before the menu")
        cues = [cue(hold_lo_s, HOLD, "hold-start", "hold"), cue((hold_lo_s + hold_hi_s) / 2.0, HOLD, "hold-centre", "hold"),
                cue(menu_s, MENU_MARK, "menu", "menu"), cue(menu_s + 0.08, MENU_MARK, "menu-2", "menu")]
        ci, dropped = count_in(t_a, beeps, spacing, menu_s + COUNT_IN_CLEAR_S)
        cues += ci
        cues.append(cue(t_a, A_CUE, "A", "A"))
        base = menu_s
    cues.sort(key=lambda c: c["t"])
    return {
        "anchor": anchor, "tA": t_a, "holdLo": hold_lo_s, "holdHi": hold_hi_s, "menu": menu_s, "droppedCountIn": dropped,
        "duration": max(c["t"] + c["ms"] / 1000.0 for c in cues), "countInTimes": [c["t"] for c in cues if c["kind"] == "count"], "cues": cues,
        "bin": b, "aimOffset": aim_offset(game, b), "aimV": aim_v, "aWindow": [base + v_lo / FPS, base + (v_hi + 1) / FPS],
        "tapMs": [TAP_FRAMES[0] * FRAME_MS, TAP_FRAMES[1] * FRAME_MS], "rollSettleS": ROLL_SETTLE_S, "methodology": mid_of(game, plat),
    }


def attempt(fn, *a, **kw):
    try:
        return {"result": fn(*a, **kw)}
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}


def accepts(ts, tid, lid, sid):
    if ts["kind"] == "tid-list":
        return tid in ts["tids"]
    if ts["kind"] == "lid-list":
        return lid is not None and lid in ts["lids"]
    return lid is not None and (tid, lid) in ts["pairs"]


def verdict(game, tid, lid, sid, keys):
    for k in keys:
        ts = TARGET_SETS[k]
        if game not in ts["games"]:
            raise ValueError("target set %s is not defined for %s" % (k, game))
    hits = [k for k in keys if accepts(TARGET_SETS[k], tid, lid, sid)]
    return {"verdict": "RUN" if hits else "no", "sets": hits}


# ---- load every table -------------------------------------------------------------------------------

def main():
    rng = random.Random(SEED)
    tables = {}     # key -> (menu, bins)
    for game in GAMES:
        for plat in PLATFORM_KEYS[game]:
            for state in (STATES if game != "crystal" else ["days0"]):
                key = "%s/%s/%s" % (game, plat, state)
                menu, bins = read_table(os.path.join(SRC, table_path(game, plat, state)))
                assert menu == TIMING[(game, plat)][2], key
                tables[key] = (menu, bins)
    order = list(tables)

    def ids(key):
        return tables[key][1]

    # identical groups by IDs and roll frames (the engines merge tables that carry the same payload)
    carrier = {}
    seen = {}
    for key in order:
        sig = tuple(sorted(ids(key).items()))
        carrier[key] = seen.setdefault(sig, key)
    groups = collections.defaultdict(list)
    for key in order:
        groups[carrier[key]].append(key)

    def state_of(k):
        return k.split("/")[2]

    def plat_of(k):
        return k.split("/")[1]

    def is_reachable(k):
        return state_of(k) in REACHABLE

    def invert(game, tid, lid=None, sid=None, plat=None, family="all", states=None):
        scope = [k for k in order if k.startswith(game + "/") and (plat is None or plat_of(k) == plat)
                 and (family == "all" or (family == "halted") == state_of(k).startswith("halt")) and (states is None or state_of(k) in states)]
        by_carrier = collections.OrderedDict()
        for k in scope:
            by_carrier.setdefault(carrier[k], []).append(k)
        cands = []
        for c, members in by_carrier.items():
            for b in range(BIN_COUNT):
                t, l, s, roll = ids(c)[b]
                if t == tid and (lid is None or l == lid) and (sid is None or s == sid):
                    cands.append({"key": c, "members": [[plat_of(m), state_of(m)] for m in members], "bin": b, "offsets": offsets_for_bin(game, b),
                                  "tid": t, "lid": l, "sid": s if game == "crystal" else None,
                                  "family": "halted" if state_of(c).startswith("halt") else "running",
                                  "reachableAfterFirstBoot": any(is_reachable(m) for m in members)})
        preferred = [x for x in cands if game == "crystal" or any(m[1] in TWO_STATE for m in x["members"])]
        resolved = cands[0] if len(cands) == 1 else (preferred[0] if len(preferred) == 1 else None)
        return {"candidates": cands, "preferred": preferred, "ambiguous": len(cands) > 1, "resolved": resolved}

    out = {
        "source": "tests/gen2_reference.py over the derivation folder's CSVs (read directly); seed %d" % SEED,
        "constants": {"fps": FPS, "frameMs": FRAME_MS, "visibleMenuLagFrames": VISIBLE_LAG, "binCount": BIN_COUNT, "offsetMax": OFFSET_MAX,
                      "tapFrames": list(TAP_FRAMES), "tapMs": [TAP_FRAMES[0] * FRAME_MS, TAP_FRAMES[1] * FRAME_MS], "rollSettleS": ROLL_SETTLE_S,
                      "outlierFrames": OUTLIER_FRAMES, "twoStatePrior": TWO_STATE, "gbpResetExtraS": GBP_RESET_EXTRA_S},
        "binRules": {g: {"droppedOffsets": r["dropped"], "bin0Offsets": list(r["bin0"]), "subtract": r["sub"], "acceptToRollFrames": r["accept_to_roll"]} for g, r in RULES.items()},
    }

    # bin edges: every rule, the offsets around the drops and the bin boundaries, the table ends and beyond
    edge_offsets = list(range(0, 22)) + [2395, 2396, 2397, 2398, 2399, 2400, 2401, -1]
    out["binEdges"] = [{"game": g, "offset": o, "bin": bin_of(g, o)} for g in GAMES for o in edge_offsets]
    out["offsetsForBin"] = [{"game": g, "bin": b, **attempt(lambda: {"offsets": offsets_for_bin(g, b), "aim": aim_offset(g, b), "visible": visible_window(g, b)})}
                            for g in GAMES for b in [0, 1, 2, 3, 50, 297, 597, 598, 599, -1]]

    # tables: every methodology and every rtc table, with checksums and sampled bins (edges + every 37th)
    sample_bins = sorted(set(range(0, BIN_COUNT, 37)) | {0, 1, 2, 3, 596, 597, 598})
    tl = []
    for key in order:
        game, plat, state = key.split("/")
        menu, bins = tables[key]
        r = RULES[game]
        first_poll = menu + 1 + r["bin0"][1]
        tl.append({
            "key": key, "game": game, "platformKey": plat, "state": state, "methodology": mid_of(game, plat), "file": table_path(game, plat, state),
            "sha1": sha1(os.path.join(SRC, table_path(game, plat, state))), "sameDataAs": carrier[key] if carrier[key] != key else None,
            "menuFrame": menu, "visibleMenuFrame": menu + VISIBLE_LAG, "firstPollFrame": first_poll,
            "holdLo": TIMING[(game, plat)][0], "holdHi": TIMING[(game, plat)][1], "rows": BIN_COUNT,
            "distinctTids": len({v[0] for v in bins.values()}), "distinctLids": len({v[1] for v in bins.values()}),
            "checksumTid": sum((b + 1) * v[0] for b, v in bins.items()) & 0xFFFFFFFF, "checksumLid": sum((b + 1) * v[1] for b, v in bins.items()) & 0xFFFFFFFF,
            "checksumSid": sum((b + 1) * v[2] for b, v in bins.items()) & 0xFFFFFFFF, "checksumRoll": sum(v[3] for v in bins.values()),
            "samples": [[b, bins[b][0], bins[b][1], bins[b][2], bins[b][3]] for b in sample_bins],
        })
    out["tables"] = tl

    # lookups: 200 random (state, bin) per (game, platform key)
    lk = []
    for game in GAMES:
        for plat in PLATFORM_KEYS[game]:
            states = STATES if game != "crystal" else ["days0"]
            for _ in range(200):
                state = rng.choice(states)
                b = rng.randrange(BIN_COUNT)
                key = "%s/%s/%s" % (game, plat, state)
                menu, bins = tables[key]
                t, l, s, roll = bins[b]
                lo, hi = offsets_for_bin(game, b)
                lk.append({"game": game, "platformKey": plat, "state": state, "bin": b, "tid": t, "lid": l, "sid": s if game == "crystal" else None,
                           "offsets": [lo, hi], "pressFrames": [menu + 1 + lo, menu + 1 + hi], "acceptFrame": menu + 1 + RULES[game]["bin0"][1] + 4 * b,
                           "rollFrame": roll, "visible": visible_window(game, b), "aim": aim_offset(game, b)})
    out["lookups"] = lk

    # inversion statistics (the subsets the README quotes) and cases
    def stats(keys):
        bt, bp = collections.defaultdict(list), collections.defaultdict(list)
        for k in keys:
            for b, (t, l, s, _) in ids(k).items():
                bt[t].append((k, b))
                bp[(t, l)].append((k, b))
        mu = {t: v for t, v in bt.items() if len(v) > 1}
        tot = sum(len(v) for v in bt.values())
        return {"tables": len(keys), "entries": tot, "distinctTids": len(bt), "ambiguousTids": len(mu), "ambiguousEntries": sum(len(v) for v in mu.values()),
                "maxCandidates": max((len(v) for v in bt.values()), default=0), "pairCollisions": sum(1 for v in bp.values() if len(v) > 1),
                "pairCollisionList": sorted(["%04X/%04X" % k for k, v in bp.items() if len(v) > 1])[:20]}

    st = []
    cases = []
    for game in GAMES:
        distinct = [c for c in groups if c.startswith(game + "/")]
        has = lambda c, pl: any(plat_of(m) == pl for m in groups[c])  # noqa: E731
        subsets = {"gbp_running_10": [c for c in distinct if has(c, "gbp") and not state_of(c).startswith("halt")],
                   "gbp_days0_and_days512": [c for c in distinct if has(c, "gbp") and state_of(c) in TWO_STATE],
                   "primaries_days0_all_platforms": [c for c in distinct if state_of(c) == "days0"],
                   "gbp_all_states": [c for c in distinct if has(c, "gbp")],
                   "gbp_halted_distinct": [c for c in distinct if has(c, "gbp") and state_of(c).startswith("halt")]}
        for pl in PLATFORM_KEYS[game]:
            subsets["%s_all_states" % pl] = [c for c in distinct if has(c, pl)]
            subsets["%s_running_10" % pl] = [c for c in distinct if has(c, pl) and not state_of(c).startswith("halt")]
        for name, keys in subsets.items():
            st.append({"game": game, "subset": name, **stats(keys)})

        # cases: the most ambiguous TIDs of the GBP running family, the two-state ambiguities, random TIDs per platform, halted, absent
        bt = collections.defaultdict(list)
        for c in subsets["gbp_running_10"]:
            for b, (t, l, s, _) in ids(c).items():
                bt[t].append((c, b))
        worst = sorted(bt.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:12]
        for t, _ in worst:
            cases.append({"game": game, "tid": t, "lid": None, "sid": None, "platformKey": "gbp", "family": "running", "states": None, **invert(game, t, plat="gbp", family="running")})
            l = ids(bt[t][0][0])[bt[t][0][1]][1]
            cases.append({"game": game, "tid": t, "lid": l, "sid": None, "platformKey": "gbp", "family": "running", "states": None, **invert(game, t, lid=l, plat="gbp", family="running")})
        two = collections.defaultdict(list)
        for c in subsets["gbp_days0_and_days512"]:
            for b, (t, l, s, _) in ids(c).items():
                two[t].append((c, b))
        for t in sorted(t for t, v in two.items() if len(v) > 1)[:12]:
            cases.append({"game": game, "tid": t, "lid": None, "sid": None, "platformKey": "gbp", "family": "all", "states": TWO_STATE, **invert(game, t, plat="gbp", states=TWO_STATE)})
            cases.append({"game": game, "tid": t, "lid": None, "sid": None, "platformKey": "gbp", "family": "all", "states": None, **invert(game, t, plat="gbp")})
        for pl in PLATFORM_KEYS[game]:
            for _ in range(15):
                state = rng.choice(STATES if game != "crystal" else ["days0"])
                b = rng.randrange(BIN_COUNT)
                t, l, s, _ = ids("%s/%s/%s" % (game, pl, state))[b]
                cases.append({"game": game, "tid": t, "lid": None, "sid": None, "platformKey": pl, "family": "all", "states": None, **invert(game, t, plat=pl)})
                cases.append({"game": game, "tid": t, "lid": l, "sid": None, "platformKey": pl, "family": "all", "states": None, **invert(game, t, lid=l, plat=pl)})
                cases.append({"game": game, "tid": t, "lid": None, "sid": None, "platformKey": None, "family": "all", "states": None, **invert(game, t)})
                if game == "crystal":
                    cases.append({"game": game, "tid": t, "lid": l, "sid": s, "platformKey": pl, "family": "all", "states": None, **invert(game, t, lid=l, sid=s, plat=pl)})
        if game != "crystal":
            for _ in range(10):
                pl = rng.choice(PLATFORM_KEYS[game])
                state = rng.choice(HALTED)
                b = rng.randrange(BIN_COUNT)
                t, l, s, _ = ids("%s/%s/%s" % (game, pl, state))[b]
                cases.append({"game": game, "tid": t, "lid": None, "sid": None, "platformKey": pl, "family": "halted", "states": None, **invert(game, t, plat=pl, family="halted")})
                cases.append({"game": game, "tid": t, "lid": l, "sid": None, "platformKey": pl, "family": "all", "states": None, **invert(game, t, lid=l, plat=pl)})
        # a TID absent from every table of the game, and an absent (TID, LID) pair
        present = {v[0] for k in order if k.startswith(game + "/") for v in ids(k).values()}
        absent = next(t for t in range(0x0100, 0x10000) if t not in present)
        cases.append({"game": game, "tid": absent, "lid": None, "sid": None, "platformKey": None, "family": "all", "states": None, **invert(game, absent)})
        t0, l0, _, _ = ids("%s/gbp/days0" % game)[100]
        cases.append({"game": game, "tid": t0, "lid": (l0 + 1) & 0xFFFF, "sid": None, "platformKey": "gbp", "family": "all", "states": None, **invert(game, t0, lid=(l0 + 1) & 0xFFFF, plat="gbp")})
    # the one Silver (TID, LID) collision inside the GBP running family (README, M4)
    cases.append({"game": "silver", "tid": 0xE94B, "lid": 0xE6FE, "sid": None, "platformKey": "gbp", "family": "running", "states": None, **invert("silver", 0xE94B, lid=0xE6FE, plat="gbp", family="running")})
    out["inversionStats"] = st
    out["inversionCases"] = cases

    # target sets over every table (the measured single-press hits) and the primaries (expected empty)
    tg = []
    for game in GAMES:
        keys = [k for k in TARGET_SETS if game in TARGET_SETS[k]["games"]]
        for pl in PLATFORM_KEYS[game]:
            states = STATES if game != "crystal" else ["days0"]
            for state in states:
                key = "%s/%s/%s" % (game, pl, state)
                hits = []
                for b in range(BIN_COUNT):
                    t, l, s, _ = ids(key)[b]
                    sets = [k for k in keys if accepts(TARGET_SETS[k], t, l, s)]
                    if sets:
                        hits.append({"bin": b, "offsets": offsets_for_bin(game, b), "tid": t, "lid": l, "sid": s if game == "crystal" else None, "sets": sets,
                                     "reachableAfterFirstBoot": state in REACHABLE})
                if hits or state == "days0":
                    tg.append({"game": game, "platformKey": pl, "state": state, "sets": keys, "hits": hits})
    out["targets"] = tg
    out["targetSets"] = {k: {"kind": v["kind"], "games": v["games"],
                             "members": (["%04X" % t for t in v["tids"]] if v["kind"] == "tid-list" else ["%04X" % l for l in v["lids"]] if v["kind"] == "lid-list"
                                         else ["%04X/%04X" % p for p in v["pairs"]]),
                             "singlePressHits": sum(len(x["hits"]) for x in tg if k in x["sets"] for h in [x] for hh in x["hits"] if k in hh["sets"]) if False else
                             sum(1 for x in tg if k in x["sets"] for h in x["hits"] if k in h["sets"])} for k, v in TARGET_SETS.items()}

    # verdicts
    vd = []
    for game, tid, lid, sid, keys in [
        ("gold", 0x25E9, None, None, ["psr-gs-any-09705"]), ("silver", 0x25E9, 0x1234, None, ["psr-gs-any-09705", "psr-gs-old-55785"]),
        ("gold", 0xD9E9, None, None, ["psr-gs-old-55785"]), ("gold", 0xD900, 0xD3EC, None, ["psr-gold-nsc-d900"]), ("gold", 0xD900, None, None, ["psr-gold-nsc-d900"]),
        ("gold", 0xD900, 0xD3ED, None, ["psr-gold-nsc-d900"]), ("gold", 0x6F49, 0x03E9, None, ["glitchless-lid-01001"]), ("gold", 0x1234, 0x03E9, None, ["glitchless-lid-01001"]),
        ("gold", 0x6F49, None, None, ["glitchless-lid-01001"]), ("crystal", 0x26FB, 0x186F, 0x1111, ["crystal-26fb-186f"]), ("crystal", 0x26FB, 0x186E, None, ["crystal-26fb-186f"]),
        ("crystal", 0xAAAA, 0x03E9, None, ["glitchless-lid-01001", "crystal-26fb-186f"]), ("silver", 0xE83B, 0x519A, None, ["psr-gs-any-09705", "glitchless-lid-01001"]),
        ("gold", 0xE83B, 0x519A, None, []), ("crystal", 0x25E9, None, None, ["psr-gs-any-09705"]),
    ]:
        vd.append({"game": game, "tid": tid, "lid": lid, "sid": sid, "sets": keys, **attempt(verdict, game, tid, lid, sid, keys)})
    out["verdicts"] = vd

    # schedules: bins x anchors x methodologies x corrections
    sc = []
    for game in GAMES:
        for plat in PLATFORM_KEYS[game]:
            for anchor in ["menu", "poweron", "reset"]:
                for b in [0, 1, 2, 5, 50, 150, 298, 598]:
                    for corr in [0.0, 100.0, 200.0]:
                        extra = GBP_RESET_EXTRA_S if anchor == "reset" else None
                        sc.append({"game": game, "platformKey": plat, "methodology": mid_of(game, plat), "bin": b, "anchor": anchor, "correctionMs": corr,
                                   "beeps": 4, "spacingS": 1.0, "resetExtraS": extra, **attempt(schedule, game, plat, b, anchor, corr, 4, 1.0, extra)})
    sc.append({"game": "gold", "platformKey": "gbp", "methodology": mid_of("gold", "gbp"), "bin": 100, "anchor": "menu", "correctionMs": 150.0, "beeps": 0, "spacingS": 1.0, "resetExtraS": None,
               **attempt(schedule, "gold", "gbp", 100, "menu", 150.0, 0, 1.0, None)})
    sc.append({"game": "gold", "platformKey": "gbp", "methodology": mid_of("gold", "gbp"), "bin": 100, "anchor": "menu", "correctionMs": 150.0, "beeps": 4, "spacingS": 0.0, "resetExtraS": None,
               **attempt(schedule, "gold", "gbp", 100, "menu", 150.0, 4, 0.0, None)})
    sc.append({"game": "gold", "platformKey": "gbp", "methodology": mid_of("gold", "gbp"), "bin": 100, "anchor": "reset", "correctionMs": 100.0, "beeps": 4, "spacingS": 1.0, "resetExtraS": None,
               **attempt(schedule, "gold", "gbp", 100, "reset", 100.0, 4, 1.0, None)})
    sc.append({"game": "gold", "platformKey": "gbp", "methodology": mid_of("gold", "gbp"), "bin": 30, "anchor": "poweron", "correctionMs": 100.0, "beeps": 3, "spacingS": 0.5, "resetExtraS": None,
               **attempt(schedule, "gold", "gbp", 30, "poweron", 100.0, 3, 0.5, None)})
    sc.append({"game": "crystal", "platformKey": "gbc", "methodology": mid_of("crystal", "gbc"), "bin": 30, "anchor": "reset", "correctionMs": 100.0, "beeps": 4, "spacingS": 1.0, "resetExtraS": 2.0,
               **attempt(schedule, "crystal", "gbc", 30, "reset", 100.0, 4, 1.0, 2.0)})
    out["schedules"] = sc

    # calibration: implied corrections from bin hits, and the sample record
    cal = []
    for game in GAMES:
        for used, hit, aimed in [(200.0, 100, 100), (200.0, 101, 100), (200.0, 99, 100), (100.0, 1, 0), (100.0, 0, 1), (150.0, 115, 100), (150.0, 116, 100), (250.0, 598, 597), (0.0, 0, 598)]:
            diff = aim_offset(game, hit) - aim_offset(game, aimed)
            cal.append({"game": game, "correctionUsedMs": used, "hitBin": hit, "aimedBin": aimed, "impliedMs": implied_correction(game, used, hit, aimed),
                        "errorFrames": diff, "outlier": abs(diff) > OUTLIER_FRAMES})
    out["calibration"] = cal

    # sampleFromHit: typed IDs after an aimed bin -> the candidate and the sample record
    sh = []
    for game in GAMES:
        for plat in PLATFORM_KEYS[game]:
            for _ in range(6):
                state = rng.choice(TWO_STATE if game != "crystal" else ["days0"])
                aimed = rng.randrange(20, BIN_COUNT - 20)
                hit = aimed + rng.choice([-2, -1, 0, 0, 1, 2])
                t, l, s, _ = ids("%s/%s/%s" % (game, plat, state))[hit]
                used = 200.0
                inv = invert(game, t, lid=l, plat=plat, states=TWO_STATE if game != "crystal" else None)
                cands = inv["candidates"]
                near = min(cands, key=lambda c: (abs(c["bin"] - aimed), c["bin"])) if cands else None
                sh.append({"game": game, "platformKey": plat, "state": state, "typedTid": t, "typedLid": l, "aimedBin": aimed, "correctionUsedMs": used,
                           "candidateBins": [c["bin"] for c in cands], "nearestBin": near["bin"] if near else None,
                           "sample": None if near is None else {"tid": t, "lid": l, "aimed_bin": aimed, "hit_bin": near["bin"], "aimed": aim_offset(game, aimed), "hit": aim_offset(game, near["bin"]),
                                                                "correction_used_ms": used, "implied_ms": implied_correction(game, used, near["bin"], aimed),
                                                                "state": "=".join(sorted({m[1] for m in near["members"]})), "methodology": mid_of(game, plat)}})
    out["sampleFromHit"] = sh

    # verify: a moderator's measured menu-to-press time against the typed IDs
    vf = []
    for game in GAMES:
        for plat in PLATFORM_KEYS[game]:
            for _ in range(5):
                b = rng.randrange(BIN_COUNT)
                t, l, s, _ = ids("%s/%s/days0" % (game, plat))[b]
                v_true = aim_offset(game, b) - VISIBLE_LAG
                measured = v_true / FPS + rng.choice([-0.05, 0.0, 0.02, 0.2, 1.0])
                inv = invert(game, t, lid=l, plat=plat, states=["days0"])
                pred_offset = measured * FPS + VISIBLE_LAG
                pred_bin = bin_of(game, int(round(pred_offset)))
                bins_ = [c["bin"] for c in inv["candidates"]]
                nearest = min(bins_, key=lambda x: (abs(x - (pred_bin if pred_bin is not None else -1000)), x)) if bins_ else None
                diff = None if nearest is None or pred_bin is None else nearest - pred_bin
                vf.append({"game": game, "platformKey": plat, "state": "days0", "tid": t, "lid": l, "measuredS": measured, "predictedOffset": pred_offset, "predictedBin": pred_bin,
                           "bins": bins_, "nearest": nearest, "differenceBins": diff, "inTable": bool(bins_), "consistent": diff is not None and abs(diff) <= 1})
    out["verify"] = vf

    n = sum(len(v) for v in out.values() if isinstance(v, list))
    out["caseCount"] = n
    json.dump(out, sys.stdout, indent=0, sort_keys=False)
    sys.stdout.write("\n")
    sys.stderr.write("gen2 reference: %d cases (%d tables, %d lookups, %d inversion cases, %d schedules)\n"
                     % (n, len(tl), len(lk), len(cases), len(sc)))


if __name__ == "__main__":
    main()
