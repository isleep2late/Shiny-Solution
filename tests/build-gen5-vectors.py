#!/usr/bin/env python3
"""Build tests/gen5-vectors.json from PokeFinder's own test suite and the RNGWriteups example.

Sources (every vector states its own `source`):
  (a) PokeFinder (Admiral-Fish, GPL-3.0, https://github.com/Admiral-Fish/PokeFinder), the
      checkout given as argv[1] (default /tmp/PokeFinder; commit recorded in the output):
      Test/RNG/lcrng64.json, Test/RNG/sha1.json, Test/Gen5/id5.json,
      Test/Gen5/profilesearcher5.json, plus the nazo table parsed out of Core/Gen5/Nazos.cpp
      and the keypress subtraction table of Core/Gen5/Keypresses.cpp.
  (b) Admiral-Fish's RNGWriteups, "Gen 5/Initial Seeding.md" (master, fetched 2026-09-03):
      the worked example whose final seed is 0xb082b4a755192171, with its 16 message words
      and h0/h1, and the keypress table. Copied by hand below.
  (c) Independent oracles computed here, in Python, from the writeup's formulas only:
      date words (weekday from datetime, Sunday = 0) and time words.

Nothing in this file runs the ported engines: the expected values come from PokeFinder's
JSON, PokeFinder's C++ source text, the writeup, or Python's datetime. 64-bit values are
written as decimal strings because JSON numbers lose precision above 2^53 in JavaScript.
"""
import datetime
import json
import os
import re
import subprocess
import sys

POKEFINDER = sys.argv[1] if len(sys.argv) > 1 else "/tmp/PokeFinder"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen5-vectors.json")

GAME_NAMES = {"Black": "black", "White": "white", "Black2": "black2", "White2": "white2"}
DS_NAMES = {"DS": "ds", "DSi": "dsi", "DS3": "3ds"}


def load(rel):
    with open(os.path.join(POKEFINDER, rel), encoding="utf-8") as f:
        return json.load(f)


def s64(v):
    return str(int(v))


def commit():
    try:
        return subprocess.check_output(["git", "-C", POKEFINDER, "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def lcrng64_vectors():
    d = load("Test/RNG/lcrng64.json")
    out = {"next": [], "advance": [], "jump": []}
    for e in d["next"]:
        out["next"].append({"name": e["name"], "seed": s64(e["seed"]), "forward": s64(e["results"][0]), "reverse": s64(e["results"][1]),
                            "source": "Test/RNG/lcrng64.json#next (BWRNG, BWRNGR)"})
    for e in d["advance"]:
        out["advance"].append({"name": e["name"], "seed": s64(e["seed"]), "advances": e["advances"], "forward": s64(e["results"][0]),
                               "reverse": s64(e["results"][1]), "source": "Test/RNG/lcrng64.json#advance"})
    for e in d["jump"]:
        out["jump"].append({"name": e["name"], "seed": s64(e["seed"]), "advances": e["advances"], "forward": s64(e["results"][0]),
                            "reverse": s64(e["results"][1]), "source": "Test/RNG/lcrng64.json#jump"})
    return out


def sha1_vectors():
    d = load("Test/RNG/sha1.json")
    out = []
    # SHA1Test::hash uses DateTime() = Date(2451545) 2000-01-01, Time(0); hashTime uses
    # Time(12, 0, 0) (Test/RNG/SHA1Test.cpp:52-63 and :81-92). Both use the first keypress
    # combination of the profile, which for keypresses [true, false x 8] is "None".
    for section, (h, mi, s) in (("hash", (0, 0, 0)), ("hashTime", (12, 0, 0))):
        for i, e in enumerate(d[section]):
            out.append({
                "name": e["name"] + (" 12:00:00" if section == "hashTime" else " 00:00:00"),
                "game": GAME_NAMES[e["version"]], "language": e["language"].lower(), "dsType": DS_NAMES[e["dsType"]],
                "mac": e["mac"], "vframe": e["vFrame"], "gxstat": e["gxStat"], "timer0": e["timer0"], "vcount": e["vCount"],
                "year": 2000, "month": 1, "day": 1, "hour": h, "minute": mi, "second": s,
                "keypressCounts": e["keypresses"], "skipLR": e["skipLR"], "buttons": 0,
                "seed": s64(e["seed"]),
                "source": "Test/RNG/sha1.json#%s[%d] with Test/RNG/SHA1Test.cpp date/time" % (section, i),
            })
    return out


def id_vectors():
    d = load("Test/Gen5/id5.json")
    out = []
    for i, e in enumerate(d["generate"]):
        # IDGenerator5Test::generate: IDGenerator5(0, 9, 0, false, false, profile, empty filter).
        out.append({
            "name": e["name"], "seed": s64(e["seed"]), "game": GAME_NAMES[e["version"]], "initialAdvances": 0, "maxAdvances": 9,
            "rows": [{"advances": r["advances"], "tid": r["tid"], "sid": r["sid"], "tsv": r["tsv"]} for r in e["results"]],
            "source": "Test/Gen5/id5.json#generate[%d] (Test/Gen5/IDGenerator5Test.cpp)" % i,
        })
    return out


def profile_common(e):
    # Date(jd) and Time(seconds) as in ProfileSearcher5Test.cpp.
    jd = e["date"]
    a = jd + 32044
    b = (4 * a + 3) // 146097
    c = a - (146097 * b) // 4
    d = (4 * c + 3) // 1461
    ee = c - (1461 * d) // 4
    m = (5 * ee + 2) // 153
    year = 100 * b + d - 4800 + m // 10
    month = m + 3 - 12 * (m // 10)
    day = ee - (153 * m + 2) // 5 + 1
    t = e["time"]
    assert e["buttons"] == "None"
    return {
        "name": e["name"], "game": GAME_NAMES[e["version"]], "language": e["language"].lower(), "dsType": DS_NAMES[e["dsType"]],
        "mac": e["mac"], "buttons": 0, "year": year, "month": month, "day": day, "hour": t // 3600, "minute": (t // 60) % 60,
        "minSecond": e["minSeconds"], "maxSecond": e["maxSeconds"], "minVCount": e["minVCount"], "maxVCount": e["maxVCount"],
        "minTimer0": e["minTimer0"], "maxTimer0": e["maxTimer0"], "minGxStat": e["minGxStat"], "maxGxStat": e["maxGxStat"],
        "minVFrame": e["minVFrame"], "maxVFrame": e["maxVFrame"],
    }


def profile_vectors():
    d = load("Test/Gen5/profilesearcher5.json")
    ivs, needles, seeds = [], [], []
    for i, e in enumerate(d["ivs"]):
        v = profile_common(e)
        v.update({"minIvs": e["minIVs"], "maxIvs": e["maxIVs"], "result": s64(e["result"]),
                  "source": "Test/Gen5/profilesearcher5.json#ivs[%d]" % i})
        ivs.append(v)
    for i, e in enumerate(d["needle"]):
        v = profile_common(e)
        v.update({"needles": e["needles"], "unovaLink": e["unovaLink"], "memoryLink": e["memoryLink"], "result": s64(e["result"]),
                  "source": "Test/Gen5/profilesearcher5.json#needle[%d]" % i})
        needles.append(v)
    for i, e in enumerate(d["seed"]):
        v = profile_common(e)
        v.update({"seed": s64(e["seed"]), "result": s64(e["seed"]), "source": "Test/Gen5/profilesearcher5.json#seed[%d]" % i})
        seeds.append(v)
    return ivs, needles, seeds


def bswap(x):
    return int.from_bytes((x & 0xffffffff).to_bytes(4, "little"), "big")


def nazo_vectors():
    """Parse the constexpr table out of Nazos.cpp and evaluate computeNazoBW / computeNazoBW2 here."""
    with open(os.path.join(POKEFINDER, "Core/Gen5/Nazos.cpp"), encoding="utf-8") as f:
        src = f.read()
    m1 = re.search(r"offset1 = (0x[0-9a-f]+);\s*constexpr u32 offset2 = offset1 \+ (0x[0-9a-f]+);", src)
    m2 = re.search(r"constexpr u32 offset = (0x[0-9a-f]+);", src)
    off1, off2, off = int(m1.group(1), 16), int(m1.group(1), 16) + int(m1.group(2), 16), int(m2.group(1), 16)
    out = []
    pat = re.compile(r"constexpr std::array<u32, 5> (\w+)\s*=\s*computeNazo(BW2?)\(([^)]*)\);")
    for name, kind, args in pat.findall(src):
        vals = [int(x.strip(), 16) for x in args.split(",")]
        lang = re.match(r"[a-z]+", name).group(0)
        rest = name[len(lang):]
        dsi = rest.endswith("DSi")
        game = rest[:-3] if dsi else rest
        if kind == "BW":
            n = vals[0]
            words = [bswap(n), bswap(n + off1), bswap(n + off1), bswap(n + off2), bswap(n + off2)]
        else:
            n, n0, n1 = vals
            words = [bswap(n0), bswap(n1), bswap(n), bswap(n + off), bswap(n + off)]
        for ds in (["dsi", "3ds"] if dsi else ["ds"]):
            out.append({"game": GAME_NAMES[game], "language": lang, "dsType": ds, "words": words,
                        "source": "Core/Gen5/Nazos.cpp constexpr %s (parsed), computeNazo%s evaluated here" % (name, kind)})
    assert len(out) == 7 * 4 * 3, len(out)
    return out


WRITEUP_KEYS = [("R", 0x10000), ("L", 0x20000), ("X", 0x40000), ("Y", 0x80000), ("A", 0x1000000), ("B", 0x2000000),
                ("Select", 0x4000000), ("Start", 0x8000000), ("Right", 0x10000000), ("Left", 0x20000000),
                ("Up", 0x40000000), ("Down", 0x80000000)]


def keypress_vectors():
    out = [{"buttons": "None", "mask": 0, "value": 0xff2f0000, "source": "RNGWriteups Initial Seeding.md keypress base"}]
    for i, (name, sub) in enumerate(WRITEUP_KEYS):
        out.append({"buttons": name, "mask": 1 << i, "value": 0xff2f0000 - sub, "source": "RNGWriteups Initial Seeding.md keypress table"})
    for names in (["A", "B"], ["Up", "Left", "Start"], ["L", "R", "X", "Y"], ["A", "B", "X", "Y", "Select", "Start", "Right", "Up"]):
        mask, value = 0, 0xff2f0000
        idx = sorted([k for k, _ in WRITEUP_KEYS].index(n) for n in names)  # label in Buttons.hpp bit order
        for i in idx:
            mask |= 1 << i
            value -= WRITEUP_KEYS[i][1]
        out.append({"buttons": "+".join(WRITEUP_KEYS[i][0] for i in idx), "mask": mask, "value": value,
                    "source": "RNGWriteups keypress table, summed here"})
    return out


def bcd(v):
    return ((v // 10) << 4) | (v % 10)


def date_vectors():
    out = []
    for y, m, d in ((2000, 1, 1), (2000, 2, 29), (2003, 12, 31), (2011, 3, 6), (2012, 10, 7), (2024, 2, 29), (2050, 7, 4), (2099, 12, 31)):
        weekday = datetime.date(y, m, d).isoweekday() % 7  # Sunday = 0, matching the writeup's worked example
        out.append({"year": y, "month": m, "day": d, "word": (bcd(y % 100) << 24) | (bcd(m) << 16) | (bcd(d) << 8) | weekday,
                    "source": "RNGWriteups message[8] formula with Python datetime weekday (Sunday = 0)"})
    return out


def time_vectors():
    out = []
    for h, mi, s in ((0, 0, 0), (11, 59, 59), (12, 0, 0), (13, 5, 9), (23, 59, 59)):
        for ds in ("ds", "dsi", "3ds"):
            hour = bcd(h) + (0x40 if h >= 12 and ds != "3ds" else 0)
            out.append({"hour": h, "minute": mi, "second": s, "dsType": ds, "word": (hour << 24) | (bcd(mi) << 16) | (bcd(s) << 8),
                        "source": "RNGWriteups message[9] formula evaluated here"})
    return out


WRITEUP = {
    "source": "Admiral-Fish/RNGWriteups master, Gen 5/Initial Seeding.md, section Example (fetched 2026-09-03)",
    "input": {"game": "white", "language": "english", "dsType": "ds", "timer0": 0x621, "vcount": 0x2f, "mac": 0x9BF123456,
              "softReset": False, "vframe": 0x5, "gxstat": 0x6, "year": 2000, "month": 1, "day": 1, "hour": 0, "minute": 0,
              "second": 0, "buttons": 0},
    "message": ["0xd0602102", "0xcc612102", "0xcc612102", "0x18622102", "0x18622102", "0x21062f00", "0x00003456", "0x0509bf14",
                "0x00010106", "0x00000000", "0x00000000", "0x00000000", "0xff2f0000", "0x80000000", "0x00000000", "0x000001a0"],
    "h0": "0x16a4a8f6",
    "h1": "0x9a2bb383",
    "rawSeed": "0x83b32b9af6a8a416",
    "seed": "0xb082b4a755192171",
    "note": "Same inputs as PokeFinder's Test/RNG/sha1.json#hash[1] (White 1): 0xb082b4a755192171 = 12718926928427950449.",
}


def main():
    ivs, needles, seeds = profile_vectors()
    vectors = {
        "provenance": {
            "generated_by": "tests/build-gen5-vectors.py",
            "pokefinder": {"repo": "https://github.com/Admiral-Fish/PokeFinder", "author": "Admiral-Fish", "license": "GPL-3.0",
                           "commit": commit(),
                           "files": ["Test/RNG/lcrng64.json", "Test/RNG/sha1.json", "Test/Gen5/id5.json",
                                     "Test/Gen5/profilesearcher5.json", "Core/Gen5/Nazos.cpp", "Core/Gen5/Keypresses.cpp"]},
            "rngwriteups": {"repo": "https://github.com/Admiral-Fish/RNGWriteups", "file": "Gen 5/Initial Seeding.md", "branch": "master"},
            "u64_encoding": "decimal or 0x-prefixed strings; JSON numbers are only used below 2^53",
        },
        "lcrng64": lcrng64_vectors(),
        "sha1": sha1_vectors(),
        "writeup": WRITEUP,
        "ids": id_vectors(),
        "profileIvs": ivs,
        "profileNeedles": needles,
        "profileSeed": seeds,
        "nazoWords": nazo_vectors(),
        "keypress": keypress_vectors(),
        "dateWords": date_vectors(),
        "timeWords": time_vectors(),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(vectors, f, indent=1)
        f.write("\n")
    counts = {k: (len(v) if isinstance(v, list) else sum(len(x) for x in v.values()) if k == "lcrng64" else 1)
              for k, v in vectors.items() if k != "provenance"}
    print("wrote %s: %s (total %d)" % (OUT, counts, sum(counts.values())))


if __name__ == "__main__":
    main()
