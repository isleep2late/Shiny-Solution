"""Shared helpers for the Gen 3 RNG verification harness.

Drives Pokemon Ruby (AXVE 1.0) headlessly under libmgba via the
hanzi/libmgba-py bindings (installed into tests/harness/venv).

IMPORTANT ROM NOTE: the file at ROM_PATH is NOT a clean dump.  It is a
scene release with a "MUGS PROUDLY PRESENTS" cracktro prepended
(file CRC32 C865BF1D; clean AXVE rev0 is F0815EE7).  The header is
intact (game code AXVE @0xAC, version 0x00 @0xBC) and the game code
itself behaves like Ruby v1.0.  The cracktro idles forever until a key
is pressed; every script mashes START until gRngValue != 0, so the real
game boots around frame 58-88 depending on the mash phase (each script
is individually deterministic).
"""
import datetime

import mgba.core
import mgba.image
import mgba.log
import mgba.vfs
from mgba._pylib import ffi

ROM_PATH = "/home/gyarados/AI/Games/Pokemon/Pokemon Untouched ROMs/Ruby.gba"

# Ruby v1.0 symbol addresses
ADDR_RNG_VALUE = 0x03004818        # gRngValue (u32, IWRAM)
ADDR_SAVEBLOCK2 = 0x02024EA4       # gSaveBlock2 (EWRAM)
ADDR_TID = ADDR_SAVEBLOCK2 + 0x0A  # playerTrainerId[0..1] = TID (u16)
ADDR_SID = ADDR_SAVEBLOCK2 + 0x0C  # playerTrainerId[2..3] = SID (u16)

# GBA LCRNG (same constants as glibc multiplier, Gen 3 increment)
MULT = 1103515245  # 0x41C64E6D
INC = 24691        # 0x00006073
MASK = 0xFFFFFFFF


def lcrng_next(s):
    return (MULT * s + INC) & MASK


def lcrng_distance(a, b, max_steps=100000):
    """Number of LCRNG steps from state a to state b, or None."""
    s = a
    for i in range(max_steps + 1):
        if s == b:
            return i
        s = lcrng_next(s)
    return None


def top16(s):
    return (s >> 16) & 0xFFFF


def make_core(rtc_datetime=None, with_video=False):
    """Load the ROM into a fresh core.  If rtc_datetime is given the
    emulated RTC is frozen at that (local) datetime; otherwise mGBA
    serves live host time.  Returns (core, image_or_None)."""
    mgba.log.silence()
    core = mgba.core.load_path(ROM_PATH)
    if core is None:
        raise RuntimeError("could not load ROM: " + ROM_PATH)
    img = None
    if with_video:
        w, h = core.desired_video_dimensions()
        img = mgba.image.Image(w, h)
        core.set_video_buffer(img)
    if rtc_datetime is not None:
        core.rtc.use_fixed(rtc_datetime)
    core.reset()
    return core, img


def screenshot(img, path):
    img.to_pil().convert("RGB").save(path)


def raw_gba(core):
    """Cast to struct GBA* for GPIO/RTC-chip introspection."""
    return ffi.cast("struct GBA*", core._core.board)


def read_u32(core, addr):
    return core.memory.u32[addr]


def read_u16(core, addr):
    return core.memory.u16[addr]


# ---- pokeruby RTC -> seed model -------------------------------------------
# Exact replica of pokeruby (Ruby v1.0, BUGFIX_BERRY *not* defined):
#   * ConvertDateToDayCount loops `for (i = year - 1; i > 0; i--)` -- the
#     berry glitch: the year 2000 contributes no days.
#   * `dayCount += day;`  (NOT day - 1)
#   * RtcGetMinuteCount = 1440*dayCount + 60*rtc->hour + rtc->minute where
#     hour/minute are the RAW BCD register bytes (no ConvertBcdToBinary!).
#   * SeedRngWithRtc: seed = (mc >> 16) ^ (mc & 0xFFFF)

DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def is_leap(year_offset):  # year_offset = full year - 2000
    y = year_offset
    return (y % 4 == 0 and y % 100 != 0) or y % 400 == 0


def to_bcd(v):
    return ((v // 10) << 4) | (v % 10)


def rtc_day_count(year_offset, month, day):
    """pokeruby ConvertDateToDayCount, berry glitch included."""
    days = 0
    for i in range(year_offset - 1, 0, -1):   # skips i == 0 (year 2000)
        days += 366 if is_leap(i) else 365
    for m in range(month - 1):
        days += DAYS_IN_MONTH[m]
    if month > 2 and is_leap(year_offset):
        days += 1
    days += day                                # NOT day - 1
    return days


def rtc_minute_count(dt):
    """pokeruby RtcGetMinuteCount: hour/minute enter as raw BCD."""
    days = rtc_day_count(dt.year - 2000, dt.month, dt.day)
    return (24 * 60) * days + 60 * to_bcd(dt.hour) + to_bcd(dt.minute)


def seed_from_rtc(dt):
    """pokeruby SeedRngWithRtc: XOR-fold of the minute count."""
    mc = rtc_minute_count(dt)
    return ((mc >> 16) ^ (mc & 0xFFFF)) & 0xFFFF


def decode_latched_rtc(core):
    """Read the S3511 registers last latched by the game out of mGBA's
    GBA cartridge hardware state.  Returns a dict of BCD-decoded fields,
    or None if nothing latched yet."""
    gba = raw_gba(core)
    t = gba.memory.hw.rtc.time
    raw = [t[i] & 0xFF for i in range(7)]

    def bcd(v):
        return (v >> 4) * 10 + (v & 0x0F)

    return {
        "raw": raw,
        "year": bcd(raw[0]),
        "month": bcd(raw[1] & 0x1F),
        "day": bcd(raw[2] & 0x3F),
        "weekday": bcd(raw[3] & 0x07),
        "hour": bcd(raw[4] & 0x3F),
        "minute": bcd(raw[5] & 0x7F),
        "second": bcd(raw[6] & 0x7F),
    }


# ---- input scripting -------------------------------------------------------

class InputScript:
    """frame -> key bitmask, from a list of (start, end_exclusive, keyname)."""

    def __init__(self, segments):
        self.segments = segments

    def keys_at(self, frame, core):
        keys = 0
        for start, end, key in self.segments:
            if start <= frame < end:
                keys |= 1 << getattr(core, "KEY_" + key)
        return keys


def run_frames(core, n, key_fn=None, per_frame=None):
    """Step n frames.  key_fn(frame)->raw key bitmask; per_frame(frame)
    called after each frame."""
    for _ in range(n):
        f = core.frame_counter
        if key_fn is not None:
            core.set_keys(raw=key_fn(f))
        core.run_frame()
        if per_frame is not None:
            per_frame(core.frame_counter)
