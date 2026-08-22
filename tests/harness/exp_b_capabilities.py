"""Experiment B: document + demonstrate the control surface of the
hanzi/libmgba-py bindings that matters for RNG work.

  1. RTC control (mCore rtc source override):
       core.rtc.use_real_time()                      - host clock (default)
       core.rtc.use_real_time_with_offset(seconds)
       core.rtc.use_fixed(datetime)                  - frozen clock
       core.rtc.use_simulated_time(datetime)         - ticks at emulated speed
       core.rtc.advance_time(milliseconds)
     Demonstrated by seeding the game under two fixed datetimes and
     checking the boot seed changes accordingly.

  2. GPIO / RTC-chip introspection: ffi.cast("struct GBA*",
     core._core.board).memory.hw exposes .devices (HW_RTC=0x1),
     .direction/.pinState/.readWrite, and .rtc.time[7] = the raw S3511
     BCD registers last latched by the game.

  3. Savestates: core.save_state() -> bytes; core.load_state(VFile).
     Demonstrated by a save/run/load/run determinism round-trip on the
     gRngValue trace.

Usage:
  cd tests/harness && ./venv/bin/python exp_b_capabilities.py
"""
import datetime

import mgba.vfs

from common import (ADDR_RNG_VALUE, decode_latched_rtc, make_core, raw_gba,
                    read_u32, run_frames, seed_from_rtc)


def boot(core, frames=200):
    trace = []

    def keys(f):
        return (1 << core.KEY_START) if (f % 30 < 3 and not trace) else 0

    seen = []

    def per_frame(_):
        v = read_u32(core, ADDR_RNG_VALUE)
        if v and not trace:
            trace.append(v)
        seen.append(v)

    run_frames(core, frames, key_fn=keys, per_frame=per_frame)
    return seen


def main():
    # --- 1: RTC override drives the boot seed ------------------------------
    for dt in (datetime.datetime(2026, 8, 21, 10, 30, 0),
               datetime.datetime(2004, 1, 1, 0, 0, 0)):
        core, _ = make_core(rtc_datetime=dt)
        boot(core, 100)
        latched = decode_latched_rtc(core)
        # find seed: state at reseed is 16-bit; easiest independent check
        # here is the model prediction vs the latched registers
        print(f"fixed RTC {dt}: latched by game -> "
              f"{latched['year']:02d}-{latched['month']:02d}-"
              f"{latched['day']:02d} {latched['hour']:02d}:"
              f"{latched['minute']:02d}:{latched['second']:02d}, "
              f"model seed {seed_from_rtc(dt):#06x}")

    # --- 2: GPIO/RTC chip state -------------------------------------------
    core, _ = make_core(rtc_datetime=datetime.datetime(2026, 8, 21, 10, 30))
    boot(core, 100)
    gba = raw_gba(core)
    hw = gba.memory.hw
    print(f"GPIO: devices={hw.devices:#x} (bit0=HW_RTC) "
          f"direction={hw.direction} pinState={hw.pinState} "
          f"readWrite={hw.readWrite}")
    print(f"S3511 latched raw: {decode_latched_rtc(core)['raw']}")

    # --- 3: savestate round-trip determinism ------------------------------
    core, _ = make_core(rtc_datetime=datetime.datetime(2026, 8, 21, 10, 30))
    boot(core, 200)
    state = core.save_state()
    print(f"savestate: {len(state)} bytes at frame {core.frame_counter}")

    t1 = []
    run_frames(core, 100, per_frame=lambda f: t1.append(
        read_u32(core, ADDR_RNG_VALUE)))

    vf = mgba.vfs.VFile.fromEmpty()
    vf.write(state, len(state))
    vf.seek(0, 0)
    ok = core.load_state(vf)
    print(f"load_state ok={bool(ok)} frame_counter={core.frame_counter}")

    t2 = []
    run_frames(core, 100, per_frame=lambda f: t2.append(
        read_u32(core, ADDR_RNG_VALUE)))

    print(f"rng trace after save == after load? {t1 == t2} "
          f"(first/last: {t1[0]:#010x}/{t1[-1]:#010x})")


if __name__ == "__main__":
    main()
