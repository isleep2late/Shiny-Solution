#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 reference.py > vectors.json
node test.cjs vectors.json
node test-data.cjs
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  dotnet run --project ../app/Tests -c Release -- --emit-gen4-vectors gen4-vectors.json
  node test-gen4.cjs gen4-vectors.json
  dotnet run --project ../app/Tests -c Release -- --check-timer-vectors timer-vectors.json
  dotnet run --project ../app/Tests -c Release -- --emit-timer-parity timer-parity.json 200
  node test-timers.cjs timer-vectors.json timer-parity.json
  dotnet run --project ../app/Tests -c Release -- --gen5 gen5-vectors.json
  dotnet run --project ../app/Tests -c Release -- --emit-gen5-random gen5-random.json
  node test-gen5.cjs gen5-vectors.json gen5-random.json
  dotnet run --project ../app/Tests -c Release -- --generators generators-vectors.json generators-cross.json
  node test-generators.cjs generators-vectors.json generators-cross.json

  # Gen 4 seed-to-time / reversal: JS and C# answer the same 310 random inputs (300 plus 10 hour-byte-carry cases, tests/seedtime4-cross.cjs) and
  # must agree; a tampered answer file is shown to fail so the comparison is known to bite.
  cross_in=$(mktemp --suffix=.json); cross_out=$(mktemp --suffix=.json)
  node seedtime4-cross.cjs inputs "$cross_in" 300
  dotnet run --project ../app/Tests -c Release --no-build -- --seedtime4-cross "$cross_in" "$cross_out"
  node seedtime4-cross.cjs compare "$cross_in" "$cross_out"
  node -e '
const fs = require("fs");
const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
a.ivs[0] = a.ivs[0].length ? a.ivs[0].slice(1) : [1];
a.mtSecond[3] ^= 1;
fs.writeFileSync(process.argv[2], JSON.stringify(a));
' "$cross_out" "$cross_out.bad"
  if node seedtime4-cross.cjs compare "$cross_in" "$cross_out.bad" > "$cross_out.log" 2>&1; then
    echo "negative control (tampered C# seedtime4 answers): DID NOT FAIL"
    rm -f "$cross_in" "$cross_out" "$cross_out.bad" "$cross_out.log"
    exit 1
  else
    echo "negative control (tampered C# seedtime4 answers): FAILED as required ->"
    grep -E '^FAIL|mismatch' "$cross_out.log" | head -3 | sed 's/^/      /'
  fi
  rm -f "$cross_in" "$cross_out" "$cross_out.bad" "$cross_out.log"
else
  echo "dotnet not found; skipping gen4 parity vectors, the JS/C# timer cross-check, the C# gen5 checks, the JS/C# generator cross-check and the seedtime4 cross-check"
  node test-timers.cjs timer-vectors.json
  node test-gen5.cjs gen5-vectors.json gen5-random.json
  node test-generators.cjs generators-vectors.json
fi

# Negative control: a corrupted Gen 5 vector (one TID row bumped by 1, one LCRNG64 step moved by 1) must FAIL, and is
# shown failing. (test-timers.cjs and TimerChecks.cs carry their own corrupted-vector control and print it.)
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
v.ids[0].rows[0].tid += 1;
v.lcrng64.next[0].forward = String(BigInt(v.lcrng64.next[0].forward) + 1n);
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' gen5-vectors.json "$corrupted"
if node test-gen5.cjs "$corrupted" gen5-random.json > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen5 vectors): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen5 vectors): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: a corrupted generator vector (one PokeFinder PID bumped by 1, one IV bit flipped) must FAIL, and is
# shown failing. (test-generators.cjs' own GEN_TEST_NEGATIVE=1 corrupts in memory; this corrupts the file it is given.)
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const s = v.static3[0].results[0], w = v.wild3[0].results[0];
if (typeof s.pid !== "number" || !Array.isArray(w.ivs)) { console.error("negative control setup: static3[0].results[0].pid or wild3[0].results[0].ivs is missing"); process.exit(1); }
s.pid = (s.pid + 1) % 4294967296;
w.ivs[0] ^= 1;
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' generators-vectors.json "$corrupted"
if node test-generators.cjs "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted generator vectors): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted generator vectors): FAILED as required ->"
  grep -E '^FAIL|failed' "$corrupted.out" | head -3 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: generators.js delegates its reversal to seedtime4.js; with the delegate tampered (one seed dropped
# from each reversal, one hour bumped in each reachability answer) the wrapper-vs-seedtime4 cross-check must FAIL, and
# is shown failing.
tampered_out=$(mktemp --suffix=.out)
if GEN_TEST_NEGATIVE=delegate node test-generators.cjs generators-vectors.json > "$tampered_out" 2>&1; then
  echo "negative control (tampered seedtime4 delegate): DID NOT FAIL"
  rm -f "$tampered_out"
  exit 1
else
  echo "negative control (tampered seedtime4 delegate): FAILED as required ->"
  grep -E '^FAIL|failed' "$tampered_out" | head -3 | sed 's/^/      /'
fi
rm -f "$tampered_out"

# Gen 4 seed-to-time and reversal (core/seedtime4.js) against tests/seedtime4-vectors.json: PokeFinder's
# seed-to-time / ID / LCRNG-reversal test data bit for bit, the design's two gate seeds (7B0448D1 -> frame 0,
# 7B0459CB -> frame 3) run forward and found by the search, 500 IV and 200 PID round trips (soundness and the
# generating seed present), roamer routes from the decomp tables, and the advance planner.
node test-seedtime4.cjs seedtime4-vectors.json

# Negative control: a corrupted vector (one PokeFinder delay, one reversal seed, one coin-flip letter, one
# roamer route) must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
v.seedToTimes[0].results[2].delay += 1;
v.lcrngReverse.ivs[0].expected[1] ^= 1;
const row = v.calibrate[0].rows[0]; row.sequence = (row.sequence[0] === "H" ? "T" : "H") + row.sequence.slice(1);
v.roamer[0].expected.skips += 1;
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' seedtime4-vectors.json "$corrupted"
if node test-seedtime4.cjs "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted seedtime4 vectors): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted seedtime4 vectors): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -5 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Gen 1 Trainer ID / Gen 3 Secret ID / press-jitter engine against the vectors emitted by RNG Solution's
# Python (tests/emit_vectors.py there; the committed copy is gen1tid-vectors.json).
node test-gen1tid.cjs gen1tid-vectors.json

# Negative control: a corrupted vector (one table TID bumped by 1, one P(hit) moved by 1e-6, one error case
# renamed to another exception class) must FAIL, and is shown failing, so a passing suite means the checks can bite.
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
v.tables[0].samples[3][1] += 1;
v.jitter.hitProbability[9].p += 1e-6;
if (v.parseTid[6].error !== "ValueError") { console.error("negative control setup: parseTid[6] is not the ValueError case"); process.exit(1); }
v.parseTid[6].error = "OutlierSample";
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' gen1tid-vectors.json "$corrupted"
if node test-gen1tid.cjs "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen1tid vectors): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen1tid vectors): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -4 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# The RUN / PRACTICE-HUNT wall in the webapp's Gen 1 TID tab (tests/test-mode-wall.cjs over mode-wall-fixture.json):
# RUN's correction is the mean of the RUN samples only, the practice sample is listed as ignored, a practice record
# is stamped and lands under the practice store key, which RUN never reads.
node test-mode-wall.cjs mode-wall-fixture.json

# Negative control: the practice sample restamped 'run' (a practice-derived value labelled as a run's) must FAIL the
# RUN checks, and is shown failing: the wall rests on the stamp and the store split, and the check sees it.
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const s = v.store["gse/menu"].samples;
if (s[2].mode !== "practice") { console.error("negative control setup: sample 2 is not the practice sample"); process.exit(1); }
s[2].mode = "run";
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' mode-wall-fixture.json "$corrupted"
if node test-mode-wall.cjs "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (a practice sample used in RUN mode): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (a practice sample used in RUN mode): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -4 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Gen 2 Trainer ID / Lucky ID engine (core/gen2tid.js over core/data/gen2-tid.json) against tests/gen2tid-vectors.json, emitted by
# tests/gen2_reference.py from the derivation folder's CSVs read directly. When that folder is present the vectors are re-emitted
# and must be byte-identical to the committed file; the generated data must also be byte-reproducible.
GEN2_SRC="${GEN2_TID_SRC:-$HOME/Desktop/Red-WR-Practice/gen2-tid}"
if [ -f "$GEN2_SRC/gold-gbp.csv" ]; then
  python3 gen2_reference.py "$GEN2_SRC" 2>/dev/null | cmp - gen2tid-vectors.json && echo "gen2 vectors re-emitted from the CSVs: byte-identical"
  # regenerated into a temp file (the generator's optional output path), never over the committed file
  regen=$(mktemp --suffix=.json)
  python3 ../tools/gen-gen2-data.py "$GEN2_SRC" "$regen" > /dev/null
  cmp "$regen" ../core/data/gen2-tid.json && echo "gen2-tid.json regenerated from the CSVs: byte-identical to the committed file"
  rm -f "$regen"
else
  echo "gen2 derivation folder not found; checking the committed vectors only"
fi
node test-gen2tid.cjs gen2tid-vectors.json

# Negative control: a corrupted vector (one lookup TID bumped by 1, one schedule's A time moved by 1e-6 s) must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
v.lookups[5].tid += 1;
v.schedules.find((s) => "result" in s).result.tA += 1e-6;
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' gen2tid-vectors.json "$corrupted"
if node test-gen2tid.cjs "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen2tid vectors): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen2tid vectors): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# The PRACTICE / HUNT head (webapp/hunt/hunt-panel.js): its Gen 1 menu-box pipeline over the shared fixtures must equal
# RNG Solution's, frame for frame and event for event (tests/fixtures/hunt/gen1-parity.json, emitted by RNG Solution's
# tests/fixtures/hunt/emit_parity.py; the PNG poll gen1-gba-hd-menu/ and the real GBA HD timeline gba-timeline.csv).
node test-hunt.cjs fixtures/hunt/gen1-parity.json fixtures/hunt

# Negative control: the vector with one timeline attempt's close moved by a sample (raw +2 frames) and the PNG prediction's
# offset bumped must FAIL, and is shown failing: the parity check sees a frame's difference.
corrupted=$(mktemp --suffix=.json)
node -e '
const fs = require("fs");
const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const a = v.timeline.sessions[1].attempts[0];
a.close += 0.0335; a.raw += 2.0;
v.png.predictions[0].offset += 1;
fs.writeFileSync(process.argv[2], JSON.stringify(v));
' fixtures/hunt/gen1-parity.json "$corrupted"
if node test-hunt.cjs "$corrupted" fixtures/hunt > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted hunt parity vector): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted hunt parity vector): FAILED as required ->"
  grep -E '^FAIL' "$corrupted.out" | head -3 | cut -c1-160 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: the Practice & Hunt window's main-process side (webapp/hunt/electron-main.js) with its mode check cut out
# (every mode read as PRACTICE / HUNT) must FAIL test-hunt.cjs's window section, and is shown failing: the window would open
# and the menu item stay enabled while the main window is in RUN.
cutout=$(mktemp --suffix=.js)
sed 's/function isPractice(mode) { return mode === PRACTICE; }/function isPractice(mode) { return true; }/' ../webapp/hunt/electron-main.js > "$cutout"
grep -q "return true; }" "$cutout" || { echo "the mode check was not found in electron-main.js to cut out"; exit 1; }
if node test-hunt.cjs fixtures/hunt/gen1-parity.json fixtures/hunt "$cutout" > "$cutout.out" 2>&1; then
  echo "negative control (hunt window without its mode check): DID NOT FAIL"
  rm -f "$cutout" "$cutout.out"
  exit 1
else
  echo "negative control (hunt window without its mode check): FAILED as required ->"
  grep -E '^FAIL' "$cutout.out" | head -3 | cut -c1-160 | sed 's/^/      /'
fi
rm -f "$cutout" "$cutout.out"

# The webapp's Gen 1 Trainer ID tab: the mobile bundle must carry the tab, the engine and the embedded data, and the
# tab's pure module must agree with the engine and RNG Solution's numbers (tests/test-webapp.cjs, which builds the bundle).
bundle=$(mktemp --suffix=.ts)
node ../webapp/build-mobile-bundle.mjs "$bundle" > /dev/null
node test-webapp.cjs "$bundle"

# The wall in the bundle: webapp/hunt/ (capture-watching code) never ships without --with-hunt. The sentinel string
# in webapp/hunt/sentinel.js must be absent from the plain bundle and present in a --with-hunt one; the absence check
# is then run against the --with-hunt bundle and shown failing, as is test-webapp.cjs (its "no hunt code" assert).
sentinel=$(node -e 'const m = require("fs").readFileSync(process.argv[1], "utf8").match(/SHINY_HUNT_SENTINEL = "([^"]+)"/); if (!m) { console.error("no sentinel string in webapp/hunt/sentinel.js"); process.exit(1); } console.log(m[1]);' ../webapp/hunt/sentinel.js)
no_hunt_code() { if grep -qF -- "$sentinel" "$1"; then echo "FAIL: $2 carries webapp/hunt/ code (sentinel $sentinel found)"; return 1; fi; echo "$2: no hunt code (sentinel absent)"; }
no_hunt_code "$bundle" "the plain mobile bundle" || exit 1
hunt_bundle=$(mktemp --suffix=.ts)
node ../webapp/build-mobile-bundle.mjs --with-hunt "$hunt_bundle" > /dev/null 2>&1
if grep -qF -- "$sentinel" "$hunt_bundle" && grep -qF "SHINY_HUNT_BUNDLED" "$hunt_bundle" && grep -qF "root.ShinyHunt = api" "$hunt_bundle"; then
  echo "positive control (--with-hunt): the sentinel and the hunt panel ARE in the bundle and it is marked as a hunt build"
else
  echo "positive control (--with-hunt): the sentinel is NOT in the bundle: --with-hunt does not bundle webapp/hunt/"
  exit 1
fi
if no_hunt_code "$hunt_bundle" "the --with-hunt bundle" > "$hunt_bundle.out" 2>&1; then
  echo "negative control (bundle with the sentinel): DID NOT FAIL"
  exit 1
else
  echo "negative control (bundle with the sentinel): FAILED as required -> $(head -1 "$hunt_bundle.out")"
fi
if node test-webapp.cjs "$hunt_bundle" > "$hunt_bundle.out" 2>&1; then
  echo "negative control (test-webapp.cjs on the bundle with the sentinel): DID NOT FAIL"
  exit 1
else
  echo "negative control (test-webapp.cjs on the bundle with the sentinel): FAILED as required ->"
  grep -E '^FAIL|failure' "$hunt_bundle.out" | head -3 | sed 's/^/      /'
fi
rm -f "$hunt_bundle" "$hunt_bundle.out"

# The builders refuse a page that asks for webapp/hunt/, and a stage or bundle that leaks its text: on a copy of the
# tree (webapp/, core/, electron/build.sh) whose index.html references hunt/sentinel.js, both builders must refuse
# without --with-hunt and build with it; with the reference removed but the sentinel pasted into app.js, both must
# refuse again. The real tree's plain electron stage must carry no hunt/ directory and no sentinel.
tree=$(mktemp -d)
mkdir -p "$tree/electron"
cp -r ../core "$tree/core"
cp -r ../webapp "$tree/webapp"
cp ../electron/build.sh "$tree/electron/build.sh"
python3 - "$tree/webapp/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = '<script src="mode.js"></script>'
assert s.count(old) == 1, "refusal setup: mode.js script tag not found once"
open(p, "w").write(s.replace(old, old + '\n<script src="hunt/sentinel.js"></script>'))
PY
if node "$tree/webapp/build-mobile-bundle.mjs" "$tree/out.ts" > "$tree/mobile.log" 2>&1; then
  echo "refusal (mobile bundle, page references hunt/): DID NOT REFUSE"; exit 1
else
  echo "refusal (mobile bundle, page references hunt/): refused as required -> $(grep -m1 refusing "$tree/mobile.log")"
fi
node "$tree/webapp/build-mobile-bundle.mjs" --with-hunt "$tree/out.ts" > /dev/null 2>&1 && grep -qF -- "$sentinel" "$tree/out.ts" \
  && echo "refusal (mobile bundle, page references hunt/, --with-hunt): built, sentinel present" || { echo "mobile bundle --with-hunt on the referencing page: did not build with the sentinel"; exit 1; }
if bash "$tree/electron/build.sh" --stage-only > "$tree/electron.log" 2>&1; then
  echo "refusal (electron stage, page references hunt/): DID NOT REFUSE"; exit 1
else
  echo "refusal (electron stage, page references hunt/): refused as required -> $(grep -m1 refusing "$tree/electron.log")"
fi
bash "$tree/electron/build.sh" --stage-only --with-hunt > /dev/null 2>&1 && [ -f "$tree/electron/webapp/hunt/sentinel.js" ] && [ -f "$tree/electron/webapp/hunt/hunt.html" ] \
  && [ -f "$tree/electron/webapp/hunt/hunt-panel.js" ] && [ -f "$tree/electron/webapp/hunt/preload.js" ] && [ -f "$tree/electron/webapp/hunt/electron-source.js" ] \
  && [ -f "$tree/electron/webapp/hunt/electron-main.js" ] \
  && echo "refusal (electron stage, --with-hunt): staged, webapp/hunt/{sentinel.js,hunt.html,hunt-panel.js,preload.js,electron-source.js,electron-main.js} present" || { echo "electron --stage-only --with-hunt: hunt/ not staged"; exit 1; }
cp ../webapp/index.html "$tree/webapp/index.html"
cat ../webapp/hunt/sentinel.js >> "$tree/webapp/app.js"
if node "$tree/webapp/build-mobile-bundle.mjs" "$tree/out.ts" > "$tree/mobile.log" 2>&1; then
  echo "refusal (mobile bundle, hunt text pasted into app.js): DID NOT REFUSE"; exit 1
else
  echo "refusal (mobile bundle, hunt text pasted into app.js): refused as required -> $(grep -m1 refusing "$tree/mobile.log")"
fi
if bash "$tree/electron/build.sh" --stage-only > "$tree/electron.log" 2>&1; then
  echo "refusal (electron stage, sentinel pasted into app.js): DID NOT REFUSE"; exit 1
else
  echo "refusal (electron stage, sentinel pasted into app.js): refused as required -> $(grep -m1 refusing "$tree/electron.log")"
fi
# ... and a hunt file that carries no sentinel line at all, its text pasted into gen1tid-ui.js: both builders compare the
# whole text of every file under webapp/hunt/ with the staged files, so the marker is not what the leak check rests on.
cp ../webapp/app.js "$tree/webapp/app.js"
printf '// a hunt file without the sentinel line, for the leak check\nwindow.SHINY_HUNT_WATCHER = function () { return "reads the capture frame by frame"; };\n' > "$tree/webapp/hunt/watcher.js"
cat "$tree/webapp/hunt/watcher.js" >> "$tree/webapp/gen1tid-ui.js"
if node "$tree/webapp/build-mobile-bundle.mjs" "$tree/out.ts" > "$tree/mobile.log" 2>&1; then
  echo "refusal (mobile bundle, a hunt file without the sentinel pasted into gen1tid-ui.js): DID NOT REFUSE"; exit 1
else
  echo "refusal (mobile bundle, a hunt file without the sentinel pasted into gen1tid-ui.js): refused as required -> $(grep -m1 refusing "$tree/mobile.log")"
fi
if bash "$tree/electron/build.sh" --stage-only > "$tree/electron.log" 2>&1; then
  echo "refusal (electron stage, a hunt file without the sentinel pasted into gen1tid-ui.js): DID NOT REFUSE"; exit 1
else
  echo "refusal (electron stage, a hunt file without the sentinel pasted into gen1tid-ui.js): refused as required -> $(grep -m1 refusing "$tree/electron.log")"
fi
rm -rf "$tree"
bash ../electron/build.sh --stage-only > /dev/null
if [ -e ../electron/webapp/hunt ] || grep -rqF -- "$sentinel" ../electron/webapp; then
  echo "FAIL: the plain electron stage carries webapp/hunt/"; exit 1
fi
# ... and what ships outside the stage in every build names no hunt window, menu or capture source, and pulls no package for one:
# main.js only requires webapp/hunt/electron-main.js when the stage has it, and 'ws' is installed by build.sh --with-hunt alone.
if grep -qE 'Practice & Hunt|createHuntWindow|electron-source|preload|hunt\.html|GetSourceScreenshot|obs-websocket|"ws"' ../electron/main.js || grep -q '"ws"' ../electron/package.json; then
  echo "FAIL: electron/main.js or package.json carries the hunt window code path or its package"; exit 1
fi
echo "the plain electron stage: no hunt/ directory, no sentinel; main.js names no hunt window and package.json no ws; mode.js staged: $([ -f ../electron/webapp/mode.js ] && echo yes || { echo no; exit 1; }); gen2tid-ui.js staged: $([ -f ../electron/webapp/gen2tid-ui.js ] && echo yes || { echo no; exit 1; })"

# Negative control: a bundle whose gen2tid.js UMD line is renamed (the engine no longer registers as ShinyGen2Tid) must FAIL,
# and is shown failing, so the carry of core/gen2tid.js into the bundle is a checked fact.
node -e '
const fs = require("fs");
const ts = fs.readFileSync(process.argv[1], "utf8");
const needle = "root.ShinyGen2Tid = factory(root.ShinyGen1Tid)";
if (!ts.includes(needle)) { console.error("negative control setup: the gen2tid.js UMD line was not found in the bundle"); process.exit(1); }
fs.writeFileSync(process.argv[2], ts.split(needle).join("root.ShinyGen2Gone = factory(root.ShinyGen1Tid)"));
' "$bundle" "$bundle.g2"
if node test-webapp.cjs "$bundle.g2" > "$bundle.out" 2>&1; then
  echo "negative control (bundle with gen2tid.js renamed): DID NOT FAIL"
  rm -f "$bundle" "$bundle.g2" "$bundle.out"
  exit 1
else
  echo "negative control (bundle with gen2tid.js renamed): FAILED as required ->"
  grep -E '^FAIL|failure' "$bundle.out" | head -3 | sed 's/^/      /'
fi
rm -f "$bundle.g2" "$bundle.out"

# Negative control: a bundle whose seedtime4.js UMD line is renamed (the engine no longer registers as ShinySeedTime4) must
# FAIL, and is shown failing, so the carry of core/seedtime4.js into the bundle is a checked fact.
node -e '
const fs = require("fs");
const ts = fs.readFileSync(process.argv[1], "utf8");
const needle = "root.ShinySeedTime4 = factory(root.ShinyCore, root.ShinyGen4)";
if (!ts.includes(needle)) { console.error("negative control setup: the seedtime4.js UMD line was not found in the bundle"); process.exit(1); }
fs.writeFileSync(process.argv[2], ts.split(needle).join("root.ShinySeedTimeGone = factory(root.ShinyCore, root.ShinyGen4)"));
' "$bundle" "$bundle.s4"
if node test-webapp.cjs "$bundle.s4" > "$bundle.out" 2>&1; then
  echo "negative control (bundle with seedtime4.js renamed): DID NOT FAIL"
  rm -f "$bundle" "$bundle.s4" "$bundle.out"
  exit 1
else
  echo "negative control (bundle with seedtime4.js renamed): FAILED as required ->"
  grep -E '^FAIL|failure' "$bundle.out" | head -3 | sed 's/^/      /'
fi
rm -f "$bundle.s4" "$bundle.out"

# Negative control: a bundle whose Gen 2 tab module no longer registers as ShinyGen2TidUi (its export line renamed) must FAIL,
# and is shown failing, so the carry of webapp/gen2tid-ui.js into the bundle is a checked fact.
node -e '
const fs = require("fs");
const ts = fs.readFileSync(process.argv[1], "utf8");
const needle = "root.ShinyGen2TidUi = api";
if (!ts.includes(needle)) { console.error("negative control setup: the Gen 2 tab module export line was not found in the bundle"); process.exit(1); }
fs.writeFileSync(process.argv[2], ts.split(needle).join("root.ShinyGen2TidGone = api"));
' "$bundle" "$bundle.g2ui"
if node test-webapp.cjs "$bundle.g2ui" > "$bundle.out" 2>&1; then
  echo "negative control (bundle with the Gen 2 tab module renamed): DID NOT FAIL"
  rm -f "$bundle" "$bundle.g2ui" "$bundle.out"
  exit 1
else
  echo "negative control (bundle with the Gen 2 tab module renamed): FAILED as required ->"
  grep -E '^FAIL|failure' "$bundle.out" | head -3 | sed 's/^/      /'
fi
rm -f "$bundle.g2ui" "$bundle.out"

# Negative control: a bundle without the tab's button (the string deleted) must FAIL, and is shown failing.
node -e '
const fs = require("fs");
const ts = fs.readFileSync(process.argv[1], "utf8");
const needle = JSON.stringify("data-tab=\"g1tid\"").slice(1, -1);
if (!ts.includes(needle)) { console.error("negative control setup: the tab button was not found in the bundle"); process.exit(1); }
fs.writeFileSync(process.argv[2], ts.split(needle).join(JSON.stringify("data-tab=\"gone\"").slice(1, -1)));
' "$bundle" "$bundle.cut"
if node test-webapp.cjs "$bundle.cut" > "$bundle.out" 2>&1; then
  echo "negative control (bundle without the Gen 1 TID tab): DID NOT FAIL"
  rm -f "$bundle" "$bundle.cut" "$bundle.out"
  exit 1
else
  echo "negative control (bundle without the Gen 1 TID tab): FAILED as required ->"
  grep -E '^FAIL|failure' "$bundle.out" | head -3 | sed 's/^/      /'
fi
rm -f "$bundle" "$bundle.cut" "$bundle.out"

# The tabs in a real browser (headless Chrome, when installed): the Gen 1 TID tab's self-test drives the DOM through the
# tab's own handlers (targets, protocol, an outcome recorded and persisted, Blue / DMG, the metronome, the Secret ID
# listing, the mode switch with the reset adjustment and the pins, records of the other mode planted in the RUN stores),
# then the Gen 2 TID tab's self-test does the same for its tab (below).
if command -v google-chrome >/dev/null 2>&1; then
  bash ../webapp/sync-core.sh
  # One browser profile for three loads: a probe page seeds the origin's localStorage with a visitor's stand-in
  # calibration and pins, the self-test runs in the same profile (its own recorded sample must stay in memory), and
  # the probe reads the storage back: the seeded values must come back untouched and nothing else may have appeared.
  # The page also reports what it sees in the real storage, which proves the probe and the page share the origin.
  profile=$(mktemp -d)
  probe=$(mktemp --suffix=.html)
  cat > "$probe" <<'PROBE'
<html><body><pre id="ls"></pre><script>
if (location.search === "?seed") {
  localStorage.setItem("shinySolution.gen1tid.calibration", "{\"visitor\":true}");
  localStorage.setItem("shinySolution.gen1tid.sidPins", "{\"visitor\":true}");
}
var o = {}; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o[k] = localStorage.getItem(k); }
document.getElementById("ls").textContent = JSON.stringify(o);
</script></body></html>
PROBE
  chrome_dom() { timeout 120 google-chrome --headless=new --disable-gpu --user-data-dir="$profile" --virtual-time-budget="$1" --dump-dom "$2" 2>/dev/null; }
  chrome_dom 1000 "file://$probe?seed" | grep -o '<pre id="ls">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.seeded"
  chrome_dom 5000 "file://$(cd ../webapp && pwd)/index.html?g1selftest" | grep -o '<pre id="g1-selftest">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.dom"
  # the Gen 2 TID tab's self-test (?g2selftest) in the same profile: its stores and the mode stay in memory too, so the
  # after-probe below covers both tabs
  chrome_dom 8000 "file://$(cd ../webapp && pwd)/index.html?g2selftest" | grep -o '<pre id="g2-selftest">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.dom2"
  chrome_dom 1000 "file://$probe" | grep -o '<pre id="ls">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.after"
  rm -rf "$profile" "$probe"
  node -e '
const fs = require("fs");
const un = (s) => s.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "\x27");
const readJson = (p) => { try { return JSON.parse(un(fs.readFileSync(p, "utf8"))); } catch (e) { return { error: "no report from " + p + ": " + e.message }; } };
const seeded = readJson(process.argv[1] + ".seeded"), r = readJson(process.argv[1] + ".dom"), after = readJson(process.argv[1] + ".after");
const VISITOR = JSON.stringify({ visitor: true });
const checks = [
  ["probe seeded the visitor stand-in storage", seeded["shinySolution.gen1tid.calibration"] === VISITOR && seeded["shinySolution.gen1tid.sidPins"] === VISITOR],
  ["the page shares the origin with the probe (it sees the seeded calibration)", !!r.realStorage && r.realStorage["shinySolution.gen1tid.calibration"] === VISITOR],
  ["the self-test left the visitor calibration untouched", after["shinySolution.gen1tid.calibration"] === VISITOR],
  ["the self-test left the visitor pins untouched", after["shinySolution.gen1tid.sidPins"] === VISITOR],
  ["the self-test wrote nothing else to the origin", Object.keys(after).sort().join(",") === "shinySolution.gen1tid.calibration,shinySolution.gen1tid.sidPins"],
  ["Gen 1 tab active for the Space test", r.g1TabActive === true],
  ["a Gen 3 target was loaded", r.g3TargetLoaded === true],
  ["Space anchored the Gen 1 cue", r.spaceAnchoredGen1 === true],
  ["Space did not start the Gen 3 timer", r.g3StartClicksOnSpace === 0],
  ["the cue log anchor line names the mode of the attempt", r.cueLogNamesMode === true],
  ["FireRed mid / NEW NAME / 7 letters cue window 2240-2266", r.sidCueWindow === "2240-2266"],
  ["the cue is dropped when the text speed changes", r.sidCueDroppedOnSpeedChange === true],
  ["the listing after the change does not use the old window", r.sidListingMentionsOldWindow === false],
  ["five route-valid targets on red/gse", r.targets === 5],
  ["protocol names the methodology", r.protocolHasMethodology === true],
  ["A cue at 7.133 s", r.scheduleA === "7.133"],
  ["anchor button enabled", r.anchorEnabled === true],
  ["outcome inverted to offset 360", /You hit offset 360, aimed 358: 2 frames late/.test(r.outcome || "")],
  ["correction moved to 233.5 ms", r.correctionAfter === "233.5"],
  ["sample persisted under gse/menu", !!(r.stored && r.stored["gse/menu"] && r.stored["gse/menu"].samples.length === 1)],
  ["blue/dmg targets", JSON.stringify(r.blueDmgTargets) === "[994,1513,2105]"],
  ["blue/dmg anchors", JSON.stringify(r.blueAnchors) === "[\"menu\",\"poweron\"]"],
  ["A then POWER OFF at 397.9 ms", /A first, then POWER OFF 397\.9 ms/.test(r.resetLine || "")],
  ["firered SID rows", r.sidRows === 3],
  // the RUN / PRACTICE-HUNT wall, driven through the switch on the page
  ["RUN is the default mode", r.modeDefault === "run"],
  ["the banner is hidden in RUN", r.bannerHiddenInRun === true],
  ["PRACTICE / HUNT turned on explicitly through the switch", r.modeAfterToggle === "practice"],
  ["the banner shows with the exact text", r.bannerShownInPractice === true],
  ["the banner sits outside every tab section", r.bannerOutsideTabs === true],
  ["the practice store starts empty (default correction 200.0)", r.correctionInPracticeBefore === "200.0"],
  ["the practice attempt inverted to offset 364", /You hit offset 364, aimed 358: 6 frames late/.test(r.practiceOutcome || "")],
  ["the practice sample is stamped and stored under the practice key", !!(r.practiceStored && r.practiceStored["gse/menu"] && r.practiceStored["gse/menu"].samples.length === 1 && r.practiceStored["gse/menu"].samples[0].mode === "practice")],
  ["the RUN store is untouched by the practice record", r.runStoreUnchangedByPractice === true],
  ["the practice correction is the practice sample alone (300.5)", r.correctionInPractice === "300.5"],
  ["back in RUN", r.modeBack === "run"],
  ["the banner is hidden again", r.bannerHiddenAgain === true],
  ["back in RUN the practice sample is not in force (233.5 again)", r.correctionBackInRun === "233.5" && r.correctionInRunBefore === "233.5"],
  ["the run store still holds only its own sample", !!(r.stored && r.stored["gse/menu"] && r.stored["gse/menu"].samples.length === 1 && r.stored["gse/menu"].samples[0].mode === "run")],
  // the remembered reset adjustment and the Secret ID pins follow the mode too
  ["the reset adjustment saved in PRACTICE / HUNT lands in the practice store, stamped", !!(r.practiceResetStored && r.practiceResetStored.gse && r.practiceResetStored.gse.frames === 2 && r.practiceResetStored.gse.mode === "practice")],
  ["... and its note names the practice store", /PRACTICE \/ HUNT mode.s store/.test(r.practiceResetNote || "")],
  ["the RUN reset store is untouched by it", r.runResetUnchangedByPractice === true],
  ["the pin made in PRACTICE / HUNT lands in the practice store, stamped", r.practicePinKeyPresent === true],
  ["... and its note names the practice store", /PRACTICE \/ HUNT mode.s store/.test(r.practicePinOut || "")],
  ["the RUN pin store is untouched by it", r.runPinsUnchangedByPractice === true],
  ["back in RUN the reset adjustment field shows the RUN value (0)", r.resetAdjustBackInRun === "0"],
  ["back in RUN the listing does not carry the practice pin", r.runListingHasPracticePin === false],
  // records of the other mode planted in the RUN stores, and one whose mode the page does not know
  ["a practice sample planted in the RUN store is named in the note", r.runNoteAboutPractice === true],
  ["a sample of a mode the page does not know is named as unknown, not thrown on", r.runNoteAboutUnknown === true],
  ["neither planted sample is in force (233.5 still)", r.correctionWithPlanted === "233.5"],
  ["recording an outcome with the planted samples present still works", /You hit offset 362, aimed 358: 4 frames late/.test(r.recordWithPlanted || "") && r.samplesInForceWithPlanted === 2],
  ["a practice reset adjustment planted in the RUN store is ignored and said so", r.resetPlantedIgnored === true],
  ["a practice pin planted in the RUN store is ignored and said so", r.pinPlantedIgnored === true],
  ["the self-test never wrote the mode or a practice store to the origin", !!r.realStorage && r.realStorage["shinySolution.mode"] === null && r.realStorage["shinySolution.gen1tid.calibration.practice"] === null &&
    r.realStorage["shinySolution.gen1tid.resetAdjust.practice"] === null && r.realStorage["shinySolution.gen1tid.sidPins.practice"] === null && r.realStorage["shinySolution.gen1tid.resetAdjust"] === null]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL browser: " + label); }
for (const x of [seeded, r, after]) if (x.error) { bad++; console.error("FAIL browser: " + x.error); }
console.log("browser self-test: " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s"));
fs.unlinkSync(process.argv[1] + ".seeded"); fs.unlinkSync(process.argv[1] + ".dom"); fs.unlinkSync(process.argv[1] + ".after");
process.exit(bad ? 1 : 0);
' "$profile"
  # The Gen 2 TID tab in the browser (webapp/gen2tid-ui.js): the same page, driven through the tab's own handlers under
  # ?g2selftest (the status and protocol text, the target rows across RTC states, an outcome recorded in bins with the
  # 15-bin outlier and duplicate guards, an outcome of another RTC state located, the invert panel, the reset anchor,
  # Silver's halted-clock hit, a DMG's two methodologies, Crystal's one state, Space scoped to the tab and the shared
  # player, verify, the mode wall with a planted practice sample); nothing written to the origin (the probe above).
  node -e '
const fs = require("fs");
const un = (s) => s.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "\x27");
let r; try { r = JSON.parse(un(fs.readFileSync(process.argv[1] + ".dom2", "utf8"))); } catch (e) { r = { error: "no report from the Gen 2 self-test: " + e.message }; }
const checks = [
  ["Gold on GSE, gold/gbp/hold-start-v1, days0 by default", r.game === "gold" && r.platform === "gse" && r.methodology === "gold/gbp/hold-start-v1" && r.state === "days0"],
  ["the status says no hardware sample exists for any Gen 2 configuration", r.statusNamesNoHardware === true],
  ["the status says the published route IDs need their community scripts", r.statusNamesScripts === true],
  ["the status states the reachability rule (only days0 and days512 recur)", r.statusNamesReachability === true],
  ["all four Gold methodologies listed with their protocol text and validity verbatim", r.methodologiesListed === 4 && r.protocolVerbatim === true && r.validityVerbatim === true],
  ["twenty RTC states offered for Gold", r.stateOptions === 20],
  ["no single-tap route target in days0; the LID 01001 hit shown from halt-days200 bin 392", r.targetsInDays0 === 0 && JSON.stringify(r.targetsOtherStates) === "[\"halt-days200:392\"]"],
  ["bin 300 described with its window, IDs and methodology", /^Target: bin 300 \(A down 1201\.\.1204 frames after the visible menu box, aim 1202\.5 = 20\.133 s .*TID 20322 \(\$4F62\), Lucky ID 61052 \(\$EE7C\).*methodology gold\/gbp\/hold-start-v1$/.test(r.targetInfo || "")],
  ["protocol names the methodology and the hardware status", r.protocolHasMethodology === true && r.protocolHasNoHardware === true],
  ["A cue at 19.933 s", r.scheduleA === "19.933"],
  ["anchor button enabled", r.anchorEnabled === true],
  ["outcome inverted to bin 302", /You hit bin 302 .*aimed 300: 8\.0 frames late/.test(r.outcome || "")],
  ["correction moved to 333.9 ms", r.correctionAfter === "333.9"],
  ["sample persisted under gse/menu with its bins, state, methodology and mode", !!(r.stored && r.stored["gse/menu"] && r.stored["gse/menu"].samples.length === 1 && r.stored["gse/menu"].samples[0].hit_bin === 302 && r.stored["gse/menu"].samples[0].state === "days0" && r.stored["gse/menu"].samples[0].methodology === "gold/gbp/hold-start-v1" && r.stored["gse/menu"].samples[0].mode === "run")],
  ["a 16-bin miss is refused by the bin outlier guard", r.outlierRefused === true],
  ["the same attempt twice is refused by the duplicate guard", r.duplicateRefused === true],
  ["IDs of another RTC state teach nothing and are located (halt-days200 bin 392, first boot only)", /another RTC state: gold\/gbp\/halt-days200 bin 392 \(first boot only\)/.test(r.elsewhereOutcome || "") && /nothing can be learned/.test(r.elsewhereOutcome || "")],
  ["the invert panel finds the candidate with the ambiguity statistics", /gold\/gbp\/halt-days200 bin 392: .*\[first boot only\]/.test(r.invertOut || "") && /769 with more than one candidate/.test(r.invertOut || "") && r.invertButtons === 1],
  ["the reset anchor on GSE adds the fade and stall (hold 2.175 s, menu 9.709 s)", r.resetHold === "2.175" && r.resetMenu === "9.709"],
  ["Silver on GSE in halt-days260: 55785 at bin 457, first boot only, said in the protocol", JSON.stringify(r.silverHaltTargets) === "[\"457:55785 ($D9E9):first boot only\"]" && r.silverHaltProtocolFirstBoot === true],
  ["a DMG offers hold-start and late-start", JSON.stringify(r.dmgMethodologies) === "[\"silver/dmg/hold-start-v1\",\"silver/dmg/late-start-v1\"]"],
  ["Crystal has one state and, on a Game Boy Color, the menu and power-on anchors", r.crystalStates === 1 && JSON.stringify(r.crystalAnchors) === "[\"menu\",\"poweron\"]"],
  ["Crystal bin 300 carries the Secret ID", /Secret ID 57547 \(\$E0CB\)/.test(r.crystalTarget || "")],
  ["Gen 2 tab active for the Space test", r.g2TabActive === true],
  ["Space anchored the Gen 2 cue through the shared player, the Gen 1 log quiet", r.spaceAnchoredGen2 === true && r.gen1CueLogQuiet === true],
  ["the cue log anchor line names the mode of the attempt", r.cueLogNamesMode === true],
  ["verify: consistent at the bin own time, inconsistent 2 s later", r.verifyConsistent === true && r.verifyInconsistent === true],
  ["RUN is the default mode", r.modeDefault === "run"],
  ["PRACTICE / HUNT turned on through the switch", r.modeAfterToggle === "practice"],
  ["the practice store starts empty (default correction 200.0)", r.correctionInPracticeBefore === "200.0"],
  ["the practice attempt inverted to bin 304", /You hit bin 304 .*aimed 300: 16\.0 frames late/.test(r.practiceOutcome || "")],
  ["the practice sample is stamped and stored under the practice key", !!(r.practiceStored && r.practiceStored["gse/menu"] && r.practiceStored["gse/menu"].samples.length === 1 && r.practiceStored["gse/menu"].samples[0].mode === "practice")],
  ["the RUN store is untouched by the practice record", r.runStoreUnchangedByPractice === true],
  ["the practice correction is the practice sample alone (467.9)", r.correctionInPractice === "467.9"],
  ["back in RUN the practice sample is not in force (333.9 again)", r.modeBack === "run" && r.correctionBackInRun === "333.9" && r.correctionInRunBefore === "333.9"],
  ["planted practice and unknown-mode samples in the RUN store are named and never in force", r.runNoteAboutPractice === true && r.correctionWithPlanted === "333.9" && r.samplesInForceWithPlanted === 1],
  ["the self-test never wrote the Gen 2 stores or the mode to the origin", !!r.realStorage && r.realStorage["shinySolution.gen2tid.calibration"] === null && r.realStorage["shinySolution.gen2tid.calibration.practice"] === null && r.realStorage["shinySolution.mode"] === null]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL browser (Gen 2): " + label); }
if (r.error) { bad++; console.error("FAIL browser (Gen 2): " + r.error); }
console.log("browser self-test (Gen 2 TID tab): " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s"));
fs.unlinkSync(process.argv[1] + ".dom2");
process.exit(bad ? 1 : 0);
' "$profile"
  # The Practice & Hunt page (webapp/hunt/hunt.html) in the same browser, straight from the source tree: it carries no
  # mode switch of its own; in RUN (a fresh profile) it says the mode is off and closes, showing no controls; once the
  # shared mode setting is PRACTICE / HUNT (seeded by a probe page on the same file:// origin, the way the main window's
  # switch sets it) the panel mounts under the practice store key.
  hprofile=$(mktemp -d)
  hprobe=$(mktemp --suffix=.html)
  printf '<html><body><script>if (location.search === "?practice") localStorage.setItem("shinySolution.mode", "practice");</script></body></html>' > "$hprobe"
  hpage="file://$(cd ../webapp && pwd)/hunt/hunt.html"
  chrome_h() { timeout 120 google-chrome --headless=new --disable-gpu --user-data-dir="$hprofile" --virtual-time-budget="$1" --dump-dom "$2" 2>/dev/null; }
  run_dom=$(chrome_h 1000 "$hpage")
  chrome_h 500 "file://$hprobe?practice" > /dev/null
  practice_dom=$(chrome_h 2000 "$hpage")
  rm -rf "$hprofile" "$hprobe"
  hbad=0
  echo "$run_dom" | grep -q 'id="mode-practice"' && { echo "FAIL hunt page: carries a mode switch of its own"; hbad=1; }
  echo "$run_dom" | grep -q 'id="mode-note">PRACTICE / HUNT mode is off: this window closes' || { echo "FAIL hunt page: in RUN it does not say the mode is off and close"; hbad=1; }
  echo "$run_dom" | grep -q '<main hidden' || { echo "FAIL hunt page: in RUN the panel is not hidden"; hbad=1; }
  echo "$run_dom" | grep -q "<button" && { echo "FAIL hunt page: in RUN it shows controls"; hbad=1; }
  echo "$practice_dom" | grep -q "calibration (practice store shinySolution.hunt.calibration.practice)" || { echo "FAIL hunt page: in PRACTICE / HUNT the panel did not mount under the practice key"; hbad=1; }
  echo "$practice_dom" | grep -q "<button" || { echo "FAIL hunt page: in PRACTICE / HUNT it shows no controls"; hbad=1; }
  echo "$practice_dom" | grep -q 'id="mode-note">PRACTICE / HUNT mode is off' && { echo "FAIL hunt page: in PRACTICE / HUNT it says the mode is off"; hbad=1; }
  echo "$practice_dom" | grep -q '<main hidden' && { echo "FAIL hunt page: in PRACTICE / HUNT the panel is hidden"; hbad=1; }
  [ $hbad = 0 ] || exit 1
  echo "hunt page in the browser: no switch of its own; RUN: off, closing, no controls; PRACTICE / HUNT: panel mounted under the practice key"
else
  echo "google-chrome not found; skipping the browser self-test"
fi
