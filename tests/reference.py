import json

MULT = 1103515245
ADD = 24691
MOD = 1 << 32

NATURES = [
    "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
    "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive",
    "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky",
]


def step(s):
    return (MULT * s + ADD) % MOD


def hi(s):
    return s >> 16


def advance(s, n):
    if n < 100000:
        for _ in range(n):
            s = step(s)
        return s
    an = pow(MULT, n, (MULT - 1) * MOD)
    geo = ((an - 1) // (MULT - 1)) % MOD
    return (pow(MULT, n, MOD) * s + ADD * geo) % MOD


def method1(s):
    s1 = step(s)
    s2 = step(s1)
    s3 = step(s2)
    s4 = step(s3)
    pid = (hi(s2) << 16) | hi(s1)
    w1, w2 = hi(s3), hi(s4)
    return {
        "pid": pid,
        "nature": pid % 25,
        "natureName": NATURES[pid % 25],
        "genderValue": pid & 255,
        "ivs": {
            "hp": w1 & 31,
            "atk": (w1 >> 5) & 31,
            "def": (w1 >> 10) & 31,
            "spe": w2 & 31,
            "spa": (w2 >> 5) & 31,
            "spd": (w2 >> 10) & 31,
        },
    }


def is_shiny(pid, tid, sid):
    return (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8


def tid_pair_at(seed, adv):
    s = advance(seed, adv)
    s1 = step(s)
    s2 = step(s1)
    return {"advance": adv, "sid": hi(s1), "tid": hi(s2)}


def main():
    seeds = [0x5A0, 0, 1, 0xDEADBEEF]
    sequences = {}
    for seed in seeds:
        s = seed
        seq = []
        for _ in range(12):
            s = step(s)
            seq.append(s)
        sequences[str(seed)] = seq

    jumps = []
    for n in [0, 1, 2, 10, 1000, 123456, (1 << 31) + 5]:
        jumps.append({"seed": 0x5A0, "n": n, "state": advance(0x5A0, n)})

    method1_vectors = []
    for adv in [0, 1, 5, 100, 5000]:
        s = advance(0x5A0, adv)
        entry = method1(s)
        entry["advance"] = adv
        method1_vectors.append(entry)

    tid_vectors = [tid_pair_at(0x5A0, a) for a in [0, 250, 500, 999, 4321]]

    anchor = tid_pair_at(0x5A0, 700)
    tid, sid = anchor["tid"], anchor["sid"]
    shiny_hits = []
    s = advance(0x5A0, 701)
    i = 701
    while len(shiny_hits) < 3 and i <= 3000000:
        s1 = step(s)
        s2 = step(s1)
        pid = (hi(s2) << 16) | hi(s1)
        if is_shiny(pid, tid, sid):
            entry = method1(s)
            entry["advance"] = i
            shiny_hits.append(entry)
        s = s1
        i += 1

    print(json.dumps({
        "sequences": sequences,
        "jumps": jumps,
        "method1": method1_vectors,
        "tidPairs": tid_vectors,
        "shinyAnchor": anchor,
        "shinyHits": shiny_hits,
    }))


if __name__ == "__main__":
    main()
