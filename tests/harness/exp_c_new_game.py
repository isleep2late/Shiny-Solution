"""Experiment C: automate boot -> title -> NEW GAME -> Birch speech ->
player shrink -> CB2_NewGame, where InitPlayerTrainerId() runs:

    write_word_to_mem((Random() << 16) | Random(), gSaveBlock2.playerTrainerId);

Reads TID (u16 @ 0x02024EA4+0x0A) and SID (u16 @ 0x02024EA4+0x0C) once
written, then locates the pair in the LCRNG stream of the observed boot
seed: two CONSECUTIVE outputs top16(s_N), top16(s_N+1).  Reports N, the
frame the write landed on, and the press-to-call delta measured against
the DECISIVE A press (found by binary-searching the input cutoff frame:
the earliest cutoff for which TID still gets generated).

Input strategy (blind but deterministic under fixed RTC):
  * mash START until the MUGS cracktro boots the game (gRngValue != 0)
  * then mash A (3 on / 3 off); additionally press START for 3 frames
    every 120 frames -- harmless in dialogue, and on the naming keyboard
    it jumps the cursor to OK so the next A confirms the (partial) name.
    (Path taken: BOY, name "A".)
Gender menu default is BOY, confirm default is YES, so A-mash passes both.

Usage:
  cd tests/harness && ./venv/bin/python exp_c_new_game.py [--shots] [--no-delta]
"""
import datetime
import sys

from common import (ADDR_RNG_VALUE, ADDR_TID, ADDR_SID, lcrng_next, make_core,
                    read_u16, read_u32, screenshot, seed_from_rtc, top16)

RTC_DT = datetime.datetime(2026, 8, 21, 10, 30, 0)
MAX_FRAMES = 30000
MAX_STEP = 100000          # per-frame advance search cap
SHOTS = "--shots" in sys.argv
DO_DELTA = "--no-delta" not in sys.argv


def run(input_cutoff=None, max_frames=MAX_FRAMES, collect=False,
        with_video=False, settle=120):
    """One deterministic run.  Input is scripted purely by frame number;
    no keys at all are delivered from frame `input_cutoff` on.
    Returns dict with trace/tid data."""
    core, img = make_core(rtc_datetime=RTC_DT, with_video=with_video)
    booted = False
    frames = []
    tid_frame = None
    a_edges = []
    done_at = None
    tid = sid = None

    for f in range(max_frames):
        keys = 0
        if input_cutoff is None or f < input_cutoff:
            if not booted:
                if f % 30 < 3:
                    keys = 1 << core.KEY_START
            else:
                if f % 120 in (60, 61, 62):
                    keys = 1 << core.KEY_START
                elif f % 6 < 3:
                    keys = 1 << core.KEY_A
                    if f % 6 == 0:
                        a_edges.append(f)
        core.set_keys(raw=keys)
        core.run_frame()
        v = read_u32(core, ADDR_RNG_VALUE)
        if v and not booted:
            booted = True
        t = read_u16(core, ADDR_TID)
        s = read_u16(core, ADDR_SID)
        if collect:
            frames.append((f, v))
        if (t or s) and tid_frame is None:
            tid_frame, tid, sid = f, t, s
            done_at = f + settle
        if SHOTS and with_video and f % 300 == 299:
            screenshot(img, f"shot_{f:05d}.png")
        if done_at is not None and f >= done_at:
            break

    stable = tid_frame is not None and (read_u16(core, ADDR_TID) == tid
                                        and read_u16(core, ADDR_SID) == sid)
    return {"frames": frames, "tid_frame": tid_frame, "tid": tid, "sid": sid,
            "stable": stable, "a_edges": a_edges}


def main():
    r = run(collect=True, with_video=SHOTS)
    if r["tid_frame"] is None:
        print(f"FAILED to reach TID generation within {MAX_FRAMES} frames")
        return
    tid, sid, tid_frame = r["tid"], r["sid"], r["tid_frame"]
    print(f"TID/SID first nonzero at frame {tid_frame}: TID={tid} "
          f"({tid:#06x}) SID={sid} ({sid:#06x}) stable={r['stable']}")

    # ---- model verification ----------------------------------------------
    seed_model = seed_from_rtc(RTC_DT)
    print(f"boot seed (model, fixed RTC {RTC_DT}): {seed_model:#06x}")

    seed = None
    reseed_frame = None
    prev = 0
    for f, v in r["frames"]:
        if prev != v:
            s, k = prev, None
            for i in range(1, 50):
                s = lcrng_next(s)
                if s == v:
                    k = i
                    break
            if k is None and v < 0x10000:
                reseed_frame = f
                seed = v
                print(f"observed SeedRng({v:#06x}) at frame {f} "
                      f"(model match: {v == seed_model})")
                break
        prev = v

    # search the stream for SID/TID as consecutive outputs, both orders
    s = seed
    stream = [s]
    for _ in range(200000):
        s = lcrng_next(s)
        stream.append(s)
    hit = None
    for n in range(len(stream) - 1):
        a, b = top16(stream[n]), top16(stream[n + 1])
        if a == sid and b == tid:
            hit = (n, "first=SID, second=TID")
            break
        if a == tid and b == sid:
            hit = (n, "first=TID, second=SID")
            break
    if hit is None:
        print("!! SID/TID pair NOT found in 200000 advances of the seed")
        return
    n, order = hit
    print(f"pair found at advances {n}/{n + 1} of seed {seed:#06x} [{order}]")
    print(f"  advance {n}: state {stream[n]:#010x} -> {top16(stream[n]):#06x}")
    print(f"  advance {n + 1}: state {stream[n + 1]:#010x} -> "
          f"{top16(stream[n + 1]):#06x}")

    # cumulative advances per frame; find the frame that consumed N+1
    prev_v = seed
    total = 0
    frame_of_advance = {}
    cum = {}
    for f, v in r["frames"]:
        if reseed_frame is None or f < reseed_frame:
            continue
        if v != prev_v:
            s, k = prev_v, None
            for i in range(1, MAX_STEP + 1):
                s = lcrng_next(s)
                if s == v:
                    k = i
                    break
            if k is None:
                print(f"  !! untracked jump at frame {f}")
                k = 0
            for j in range(1, k + 1):
                frame_of_advance[total + j] = f
            total += k
            prev_v = v
        cum[f] = total
    gen_frame = frame_of_advance.get(n + 1)
    print(f"advances N={n}, N+1={n + 1} were consumed during frame "
          f"{frame_of_advance.get(n)}/{gen_frame} "
          f"(TID RAM write first seen at frame {tid_frame})")
    print(f"cumulative advances at end of frame {gen_frame}: {cum.get(gen_frame)}")

    # advance-per-frame histogram across the whole run (context for (a))
    from collections import Counter
    hist = Counter()
    prev_c = 0
    for f in sorted(cum):
        hist[cum[f] - prev_c] += 1
        prev_c = cum[f]
    print(f"advances-per-frame histogram (post-seed, {len(cum)} frames): "
          f"{dict(sorted(hist.items()))}")
    prev_c = 0
    outliers = []
    for f in sorted(cum):
        k = cum[f] - prev_c
        if k not in (0, 1):
            outliers.append((f, k))
        prev_c = cum[f]
    print(f"non-1-advance frames (frame, advances): {outliers}")

    if not DO_DELTA:
        return

    # ---- decisive press: binary search the input cutoff -------------------
    print("binary-searching minimal input cutoff that still generates TID...")
    limit = tid_frame + 900
    lo, hi = reseed_frame, tid_frame + 6   # lo fails, hi succeeds (mash run did)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        rr = run(input_cutoff=mid, max_frames=limit, settle=10)
        ok = rr["tid_frame"] is not None
        print(f"  cutoff {mid}: {'TID at frame ' + str(rr['tid_frame']) if ok else 'no TID'}")
        if ok:
            hi = mid
        else:
            lo = mid
    rr = run(input_cutoff=hi, max_frames=limit, settle=10)
    decisive = [e for e in rr["a_edges"] if e < hi]
    decisive = decisive[-1] if decisive else None
    print(f"minimal cutoff: {hi} (all input dropped from frame {hi} on)")
    print(f"decisive (last effective) A press edge: frame {decisive}")
    print(f"TID generated at frame {rr['tid_frame']} in cutoff run "
          f"(TID={rr['tid']:#06x} SID={rr['sid']:#06x}, "
          f"same as mash run: {(rr['tid'], rr['sid']) == (tid, sid)})")
    print(f"press-to-call delta: {rr['tid_frame'] - decisive} frames "
          f"(A pressed frame {decisive} -> Random()+Random() for TID/SID "
          f"consumed in frame {rr['tid_frame']})")
    print(f"cumulative advances at end of decisive-press frame {decisive}: "
          f"{cum.get(decisive)}; advance delta press->SID call: "
          f"{n - cum.get(decisive)}")


if __name__ == "__main__":
    main()
