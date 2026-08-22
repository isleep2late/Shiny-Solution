# Gen 3 RNG empirical verification harness

Drives Pokemon Ruby (AXVE) headlessly under **libmgba 0.10.2** via the
[hanzi/libmgba-py](https://github.com/hanzi/libmgba-py) cffi bindings
(the ones pokebot-gen3 uses) and ground-truths the RNG model against
the running game.

## Setup

```bash
bash tests/harness/setup_libmgba.sh
```

That script (verified end-to-end on this machine):
1. creates `tests/harness/venv` (python3.12) and installs
   `cffi setuptools Pillow patchelf`;
2. builds mGBA **0.10.2** as a shared lib (`cmake -DBUILD_SHARED=ON` +
   headless feature flags) in `/tmp/mgba-src/build`;
3. clones hanzi/libmgba-py, patches `_config.py` (upstream hardcodes
   Docker-container paths on Linux) and adds stubs for the 8
   `EReaderScan*` symbols that the cdef declares but libmgba only
   contains when `USE_FFMPEG=ON`;
4. builds the bindings with the venv python, copies the `mgba` package
   into site-packages together with `libmgba.so.0.10`, and patchelf's
   the extension rpath to `$ORIGIN`.

Notes: `pip install mgba` does not exist on PyPI. The prebuilt
libmgba-py release zips only target ubuntu-lunar / older pythons, so we
build from source. Do **not** run python from inside `/tmp/libmgba-py`
(its source `mgba/` dir shadows the installed package).

## ROM

`/home/gyarados/AI/Games/Pokemon/Pokemon Untouched ROMs/Ruby.gba`
(never copied into the repo).

* header game code @0xAC: `AXVE`, version byte @0xBC: `0x00` (v1.0),
  header checksum @0xBD: `0x41` — header is intact;
* **but the file is NOT a clean dump**: CRC32 `C865BF1D` (clean rev0 is
  `F0815EE7`), entry branch patched, and a "MUGS PROUDLY PRESENTS"
  cracktro runs before the game. The cracktro idles **forever** until a
  keypress; every script mashes START until `gRngValue != 0` to boot
  the real game (~frame 58-88 depending on the mash phase). The game
  code behaves as genuine Ruby v1.0 afterwards (berry-glitch seeding
  quirks reproduce exactly, see below).

## Experiments

All are run as:

```bash
cd tests/harness && ./venv/bin/python <script>
```

### `exp_a_rng_trace.py`

Boots, traces the u32 at `0x03004818` (gRngValue) for 1200 frames,
twice (live host RTC, then fixed RTC 2026-08-21 10:30:00). Verifies:

* every post-seed transition is `s' = (1103515245*s + 24691) mod 2^32`
  (k steps searched per frame) — **0 violations**;
* the single non-LCRNG jump is `SeedRngWithRtc` (~3 frames after boot;
  before it, state 0 advances once per frame);
* the 16-bit boot seed equals the XOR-fold
  `(mc>>16)^(mc&0xFFFF)` of pokeruby's `RtcGetMinuteCount()`, where the
  minute count must be modeled **with Ruby v1.0's real quirks**
  (see `common.py::seed_from_rtc`):
  - berry glitch: `ConvertDateToDayCount` skips year 2000
    (`for (i = year-1; i > 0; i--)`),
  - `dayCount += day` (not `day - 1`),
  - `RtcGetMinuteCount` adds `60*rtc->hour + rtc->minute` using the
    **raw BCD register bytes** (no BCD decode);
  the check is done both against a Python model of the RTC datetime and
  against the raw S3511 registers the game actually latched (read out of
  mGBA's cart-hardware state);
* advances-per-frame profile: pre-boot 0/frame, post-boot exactly
  1/frame through copyright/intro/title with a single 2-advance frame.

### `exp_b_capabilities.py`

Documents + demonstrates the control surface:

* RTC: `core.rtc.use_fixed(datetime)` / `use_real_time()` /
  `use_real_time_with_offset(s)` / `use_simulated_time(dt)` /
  `advance_time(ms)` (mCore rtc source override; changes the boot seed
  as predicted);
* GPIO/RTC-chip introspection:
  `ffi.cast("struct GBA*", core._core.board).memory.hw` exposes
  `.devices` (bit0 = HW_RTC, auto-enabled for AXVE), `.direction`,
  `.pinState`, `.readWrite`, and `.rtc.time[7]` = the S3511 BCD
  registers last latched by the game;
* savestates: `core.save_state() -> bytes` (397312 bytes),
  `core.load_state(mgba.vfs.VFile)`; a save/run/load/run round-trip
  reproduces the identical 100-frame gRngValue trace.

### `exp_c_new_game.py`

Fully automates boot -> title -> NEW GAME -> Birch speech (BOY, name
"A") -> `CB2_NewGame`, under fixed RTC 2026-08-21 10:30:00, watching
TID (`u16 @ 0x02024EAE`) and SID (`u16 @ 0x02024EB0`). Then verifies
`InitPlayerTrainerId`'s `(Random() << 16) | Random()` against the LCRNG
stream of the boot seed, and binary-searches the minimal input-cutoff
frame to isolate the decisive A press (press-to-call delta).

Options: `--shots` dumps a screenshot every 300 frames (`shot_*.png`,
gitignored), `--no-delta` skips the ~12 extra binary-search runs.

Reference results (deterministic for this script + this RTC datetime):

```
boot seed 0xc4bd (= model), SeedRng at frame 91
TID=0xaada SID=0x8edc, RAM write first seen frame 3224
SID = top16(advance 3135), TID = top16(advance 3136)  [consecutive; first=SID]
frame 3224 consumed 3 advances (1 background + the SID/TID pair)
decisive A press: frame 3150; press-to-call delta = 74 frames (75 advances)
advances-per-frame histogram: {0:1, 1:3250, 2:1, 3:1, 41:1}
```

### `common.py`

Shared helpers: ROM/core loading (`make_core`), memory peek, LCRNG
step/search, the exact pokeruby seed model, S3511 latch decoding,
screenshots, input scripting.
