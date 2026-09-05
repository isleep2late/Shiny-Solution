#!/bin/bash
# Reproducible install of the hanzi/libmgba-py bindings into
# tests/harness/venv, without Docker (the upstream build_ubuntu.sh
# needs mGBA's Docker images; we build natively instead).
#
# Verified on Ubuntu 24.04 / python3.12 / cmake 3.28.
# There is no PyPI package ("pip install mgba" has no distribution).
#
# Usage:  bash tests/harness/setup_libmgba.sh
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$HARNESS_DIR/venv"
WORK="${WORK:-/tmp}"

# 1. venv + build deps
[ -d "$VENV" ] || python3.12 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade -q pip cffi setuptools Pillow patchelf

# 2. libmgba 0.10.2 shared library, headless feature set
if [ ! -f "$WORK/mgba-src/build/libmgba.so.0.10.2" ]; then
  rm -rf "$WORK/mgba-src"
  git clone --depth 1 --branch 0.10.2 https://github.com/mgba-emu/mgba.git "$WORK/mgba-src"
  mkdir -p "$WORK/mgba-src/build"
  (cd "$WORK/mgba-src/build" && cmake .. -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED=ON -DBUILD_STATIC=OFF -DBUILD_QT=OFF -DBUILD_SDL=OFF \
      -DUSE_FFMPEG=OFF -DUSE_DISCORD_RPC=OFF -DUSE_SQLITE3=OFF \
      -DUSE_EDITLINE=OFF -DUSE_MINIZIP=OFF -DUSE_LIBZIP=OFF -DUSE_LZMA=OFF \
      -DUSE_EPOXY=OFF -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF -DBUILD_GL=OFF \
   && make -j"$(nproc)")
fi

# 3. hanzi/libmgba-py, patched for a native (non-Docker) build
if [ ! -d "$WORK/libmgba-py" ]; then
  git clone --depth 1 https://github.com/hanzi/libmgba-py "$WORK/libmgba-py"
fi
cd "$WORK/libmgba-py"

# 3a. _config.py hardcodes Docker paths on Linux; use env-var paths instead
cat > _config.py <<'EOF'
import os
import platform
from pathlib import Path

path_to_libmgba_py = Path(".").absolute()

if platform.system() in ("Windows", "Darwin"):
    path_to_mgba_root = Path("./mgba-src").absolute()
    path_to_mgba_build = Path("./mgba-src/build").absolute()
elif platform.system() == "Linux":
    # The /tmp defaults below are only the fallback when MGBA_ROOT / MGBA_BUILD are unset (this
    # script always sets them). They are a scratch build tree created on your own machine, they
    # are not committed in either repository, and they are not evidence for anything this
    # repository claims: they hold mGBA's own sources and build output.
    path_to_mgba_root = Path(os.environ.get("MGBA_ROOT", "/tmp/mgba-src")).absolute()
    path_to_mgba_build = Path(os.environ.get("MGBA_BUILD", "/tmp/mgba-src/build")).absolute()
else:
    raise RuntimeError("Unsupported platform: " + platform.system())
EOF

# 3b. the cffi cdef declares the EReaderScan* API, but those symbols are
# only compiled into libmgba when USE_FFMPEG=ON; stub them out.
cat > ereader_stubs.c <<'EOF'
/* Stubs for e-reader scanning functions that are only compiled into libmgba
 * when USE_FFMPEG is enabled. Never called by this harness. */
#include <stddef.h>
#include <stdbool.h>
struct EReaderScan;
struct EReaderScan* EReaderScanLoadImagePNG(const char* filename) { (void)filename; return NULL; }
struct EReaderScan* EReaderScanLoadImage(const void* p, unsigned w, unsigned h, unsigned s) { (void)p;(void)w;(void)h;(void)s; return NULL; }
struct EReaderScan* EReaderScanLoadImageA(const void* p, unsigned w, unsigned h, unsigned s) { (void)p;(void)w;(void)h;(void)s; return NULL; }
struct EReaderScan* EReaderScanLoadImage8(const void* p, unsigned w, unsigned h, unsigned s) { (void)p;(void)w;(void)h;(void)s; return NULL; }
void EReaderScanDestroy(struct EReaderScan* s) { (void)s; }
bool EReaderScanCard(struct EReaderScan* s) { (void)s; return false; }
void EReaderScanOutputBitmap(const struct EReaderScan* s, void* o, size_t st) { (void)s;(void)o;(void)st; }
bool EReaderScanSaveRaw(const struct EReaderScan* s, const char* f, bool strict) { (void)s;(void)f;(void)strict; return false; }
EOF
grep -q ereader_stubs.c _builder.py || \
  sed -i 's#path_to_libmgba_py / "sio.c",#path_to_libmgba_py / "sio.c",\n    path_to_libmgba_py / "ereader_stubs.c",#' _builder.py

# 4. build the cffi bindings with the venv python
rm -rf build
MGBA_ROOT="$WORK/mgba-src" MGBA_BUILD="$WORK/mgba-src/build" \
  "$VENV/bin/python" setup.py build --build-lib build/local

# 5. install into the venv, ship libmgba.so.0.10 inside the package,
#    point the extension's rpath at $ORIGIN so it self-resolves
SP="$VENV/lib/python3.12/site-packages"
rm -rf "$SP/mgba"
cp -r build/local/mgba "$SP/"
cp "$WORK/mgba-src/build/libmgba.so.0.10.2" "$SP/mgba/"
ln -sf libmgba.so.0.10.2 "$SP/mgba/libmgba.so.0.10"
"$VENV/bin/patchelf" --set-rpath '$ORIGIN' "$SP/mgba/_pylib.abi3.so"

# (cd away: the libmgba-py checkout contains an un-built mgba/ dir that
# would shadow the installed package)
cd "$HARNESS_DIR"
"$VENV/bin/python" -c "import mgba.core; print('mgba bindings OK')"
