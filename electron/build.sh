#!/usr/bin/env bash
# Stages the web app into electron/webapp and builds the Linux packages.
#   bash build.sh [--with-hunt] [--stage-only]
# The wall: webapp/hunt/ (capture-watching code, PRACTICE / HUNT only) is never staged unless
# --with-hunt is passed explicitly; without it, a page that references a script under hunt/ is
# refused, and a stage that turns out to carry the text of any file under hunt/ is refused too
# (the same whole-file comparison build-mobile-bundle.mjs makes; the sentinel is not what it rests on). --stage-only
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
cp "$src/index.html" "$src/app.css" "$src/mode.js" "$src/app.js" "$src/downloads.js" "$src/gen1tid-ui.js" "$src/gen2tid-ui.js" \
   "$src/rng.js" "$src/gen4.js" "$src/gen12.js" "$src/gen1tid.js" "$src/timers.js" "$src/gen5.js" "$src/seedtime4.js" "$src/generators.js" "$src/gen2tid.js" "$src/gen1-data.js" webapp/
cp "$src/data/gen1-tid.json" "$src/data/gen3-sid.json" "$src/data/gen2-tid.json" webapp/data/
if [ "$with_hunt" = 1 ]; then
  cp -r "$src/hunt" webapp/hunt
  echo "--with-hunt: webapp/hunt/ staged (a PRACTICE / HUNT build, not for publishing)"
else
  # nothing from webapp/hunt/ may be in the stage, whatever path it took: the text of every file under it
  # (20+ bytes once trimmed, as in build-mobile-bundle.mjs) is looked for in every staged file
  command -v node >/dev/null 2>&1 || refuse "node is needed for the webapp/hunt/ leak check"
  leak=$(node -e '
const fs = require("fs"), path = require("path");
const [huntDir, stage] = process.argv.slice(1);
function files(dir) { let out = []; for (const name of fs.readdirSync(dir).sort()) { const p = path.join(dir, name); out = fs.statSync(p).isDirectory() ? out.concat(files(p)) : out.concat([p]); } return out; }
const staged = files(stage).map((p) => [p, fs.readFileSync(p, "utf8")]);
for (const h of files(huntDir)) {
  const text = fs.readFileSync(h, "utf8").trim();
  if (text.length < 20) continue;
  for (const [p, s] of staged) if (s.includes(text)) { console.log("webapp/" + path.relative(path.dirname(huntDir), h) + " in " + p); process.exit(0); }
}
' "$src/hunt" webapp)
  [ -z "$leak" ] || refuse "the staged files carry the text of a webapp/hunt/ file ($leak) without --with-hunt"
fi
if [ "$stage_only" = 1 ]; then
  echo "staged into electron/webapp (--stage-only)"
  exit 0
fi
[ -d node_modules ] || npm install --no-audit --no-fund
if [ "$with_hunt" = 1 ]; then
  # the hunt window's OBS source (webapp/hunt/electron-source.js) needs the 'ws' package; it is not in package.json,
  # so a plain build never installs or ships it
  npm install --no-save --no-audit --no-fund ws
fi
npx electron-builder --linux
