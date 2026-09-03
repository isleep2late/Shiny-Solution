#!/usr/bin/env bash
# Stages the web app into electron/webapp and builds the Linux packages.
#   bash build.sh [--with-hunt] [--stage-only]
# The wall: webapp/hunt/ (capture-watching code, PRACTICE / HUNT only) is never staged unless
# --with-hunt is passed explicitly; without it, a page that references a script under hunt/ is
# refused, and a stage that turns out to carry the hunt sentinel is refused too. --stage-only
# stops after staging (tests/run-tests.sh uses it to check both ways; the build-desktop workflow
# uses it before electron-builder). The published builds are made without --with-hunt.
set -euo pipefail
cd "$(dirname "$0")"
with_hunt=0
stage_only=0
for a in "$@"; do
  case "$a" in
    --with-hunt) with_hunt=1 ;;
    --stage-only) stage_only=1 ;;
    *) echo "usage: build.sh [--with-hunt] [--stage-only]" >&2; exit 2 ;;
  esac
done
src=../webapp
refuse() {
  echo "refusing to stage the desktop app: $1" >&2
  echo "  webapp/hunt/ is PRACTICE / HUNT code (it reads the capture) and never ships in a desktop build; pass --with-hunt for a practice build, never for a published one (webapp/hunt/README.md)." >&2
  exit 1
}
if [ "$with_hunt" = 0 ] && grep -Eq '<script[^>]*src="([^"]*/)?hunt/' "$src/index.html"; then
  refuse "$src/index.html references a script under webapp/hunt/ and --with-hunt was not passed"
fi
rm -rf webapp
mkdir -p webapp/data
bash "$src/sync-core.sh"
cp "$src/index.html" "$src/app.css" "$src/mode.js" "$src/app.js" "$src/downloads.js" "$src/gen1tid-ui.js" \
   "$src/rng.js" "$src/gen4.js" "$src/gen12.js" "$src/gen1tid.js" "$src/gen1-data.js" webapp/
cp "$src/data/gen1-tid.json" "$src/data/gen3-sid.json" webapp/data/
if [ "$with_hunt" = 1 ]; then
  cp -r "$src/hunt" webapp/hunt
  echo "--with-hunt: webapp/hunt/ staged (a PRACTICE / HUNT build, not for publishing)"
else
  sentinel=$(sed -n 's/.*SHINY_HUNT_SENTINEL = "\([^"]*\)".*/\1/p' "$src/hunt/sentinel.js")
  [ -n "$sentinel" ] || refuse "no sentinel string in $src/hunt/sentinel.js (the leak check needs it)"
  if grep -rqF -- "$sentinel" webapp/; then
    refuse "the staged files carry the hunt sentinel ($(grep -rlF -- "$sentinel" webapp/ | tr '\n' ' ')) without --with-hunt"
  fi
fi
if [ "$stage_only" = 1 ]; then
  echo "staged into electron/webapp (--stage-only)"
  exit 0
fi
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --linux
