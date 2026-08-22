"""Experiment A: boot Ruby, trace gRngValue (0x03004818) for ~1200 frames.

Verifies:
  * every state transition is k applications of
      s' = (1103515245*s + 24691) mod 2^32   (k searched up to MAX_STEP)
  * the SeedRngWithRtc reseed event: the one transition that is NOT an
    LCRNG step; the new value is the 16-bit boot seed.
  * boot seed == XOR-fold of pokeruby's RtcGetMinuteCount, computed BOTH
    from a Python model of the RTC datetime AND from the S3511 registers
    the game actually latched (read out of mGBA's cart-hardware state).
  * advances-per-frame profile across cracktro/copyright/intro/title.

Runs twice: once with mGBA's default live RTC (host clock), once with a
fixed RTC datetime (deterministic).

Usage:
  cd tests/harness && ./venv/bin/python exp_a_rng_trace.py
"""
import datetime
import time
from collections import Counter

from common import (ADDR_RNG_VALUE, lcrng_next, make_core, read_u32,
                    decode_latched_rtc, seed_from_rtc, rtc_minute_count)

FRAMES = 1200
MAX_STEP = 5000  # max LCRNG steps searched between consecutive frames


def trace(rtc_dt, label):
    print("=" * 72)
    print(f"run: {label}")
    core, _ = make_core(rtc_datetime=rtc_dt)
    host_before = datetime.datetime.now()

    # The MUGS cracktro idles until it accepts a keypress (it ignores
    # input for the first few dozen frames).  Mash START (3 frames on /
    # 27 off) until gRngValue leaves 0 (game booted + seeded), then
    # release all keys so the intro/title advance profile is unpolluted.
    values = []          # gRngValue observed after each frame
    booted_at = None
    for f in range(FRAMES):
        if booted_at is None and f % 30 < 3:
            core.set_keys(core.KEY_START)
        else:
            core.clear_keys()
        core.run_frame()
        v = read_u32(core, ADDR_RNG_VALUE)
        if v != 0 and booted_at is None:
            booted_at = f
        values.append(v)
    host_after = datetime.datetime.now()
    print(f"gRngValue first nonzero at frame: {booted_at}")

    # --- analyse -----------------------------------------------------------
    profile = Counter()
    per_frame = []       # (frame, steps or None)
    reseeds = []         # (frame, old, new)
    prev = 0             # RAM starts zeroed
    for f, v in enumerate(values):
        if v == prev:
            profile[0] += 1
            per_frame.append((f, 0))
            continue
        s, k = prev, None
        for i in range(1, MAX_STEP + 1):
            s = lcrng_next(s)
            if s == v:
                k = i
                break
        if k is None:
            reseeds.append((f, prev, v))
            per_frame.append((f, None))
        else:
            profile[k] += 1
            per_frame.append((f, k))
        prev = v

    print(f"frames traced: {FRAMES}")
    print(f"LCRNG-inconsistent transitions (reseed events): "
          f"{[(f, hex(o), hex(n)) for f, o, n in reseeds]}")
    print("advances-per-frame profile (steps: frame-count):")
    for k in sorted(profile):
        print(f"  {k}: {profile[k]}")
    # where do multi/zero-advance frames sit?
    zero_runs = [f for f, k in per_frame if k == 0]
    multi = [(f, k) for f, k in per_frame if k not in (0, 1, None)]
    print(f"frames with 0 advances: {len(zero_runs)} "
          f"(first 10: {zero_runs[:10]} ... last 5: {zero_runs[-5:]})")
    print(f"frames with >1 advances: {multi[:40]}")

    if reseeds:
        f, old, seed = reseeds[-1]
        print(f"boot seed (SeedRngWithRtc): {seed:#06x} ({seed}) "
              f"applied at emu frame {f}")
        latched = decode_latched_rtc(core)
        print(f"S3511 latched registers (last game latch): {latched}")
        ldt = datetime.datetime(2000 + latched["year"], latched["month"],
                                latched["day"], latched["hour"],
                                latched["minute"], latched["second"])
        exp_latched = seed_from_rtc(ldt)
        print(f"  latched RTC datetime: {ldt}  minuteCount="
              f"{rtc_minute_count(ldt)}  XOR-fold={exp_latched:#06x}")
        print(f"  seed == fold(latched RTC)? {seed == exp_latched}")
        if rtc_dt is not None:
            exp_fixed = seed_from_rtc(rtc_dt)
            print(f"  fixed RTC {rtc_dt} -> expected fold {exp_fixed:#06x} "
                  f"match={seed == exp_fixed}")
        else:
            for dt in (host_before, host_after):
                print(f"  host {dt} -> fold {seed_from_rtc(dt):#06x} "
                      f"match={seed == seed_from_rtc(dt)}")
    else:
        print("no reseed event observed (gRngValue never left the "
              "0-seeded LCRNG orbit)")

    # sanity: fully verify chain AFTER the reseed with explicit math
    if reseeds:
        rf = reseeds[-1][0]
        s = values[rf]
        bad = 0
        for f in range(rf + 1, FRAMES):
            v = values[f]
            steps = 0
            t = s
            while t != v and steps <= MAX_STEP:
                t = lcrng_next(t)
                steps += 1
            if t != v:
                bad += 1
                print(f"  !! frame {f}: {v:#010x} unreachable from "
                      f"{s:#010x} within {MAX_STEP} steps")
            s = v
        print(f"post-seed chain check: {FRAMES - rf - 1} frame transitions, "
              f"{bad} violations -> "
              f"{'LCRNG MODEL VERIFIED' if bad == 0 else 'MODEL VIOLATED'}")
    return values, reseeds


if __name__ == "__main__":
    trace(None, "live host RTC (mGBA default)")
    trace(datetime.datetime(2026, 8, 21, 10, 30, 0),
          "fixed RTC 2026-08-21 10:30:00")
