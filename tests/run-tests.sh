#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 reference.py > vectors.json
node test.cjs vectors.json
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  dotnet run --project ../app/Tests -c Release -- --emit-gen4-vectors gen4-vectors.json
  node test-gen4.cjs gen4-vectors.json
else
  echo "dotnet not found; skipping gen4 parity vectors"
fi

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

# The webapp's Gen 1 Trainer ID tab: the mobile bundle must carry the tab, the engine and the embedded data, and the
# tab's pure module must agree with the engine and RNG Solution's numbers (tests/test-webapp.cjs, which builds the bundle).
bundle=$(mktemp --suffix=.ts)
node ../webapp/build-mobile-bundle.mjs "$bundle" > /dev/null
node test-webapp.cjs "$bundle"

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

# The tab in a real browser (headless Chrome, when installed): its self-test drives the DOM through the tab's own
# handlers (targets, protocol, an outcome recorded and persisted, Blue / DMG, the metronome, the Secret ID listing).
if command -v google-chrome >/dev/null 2>&1; then
  bash ../webapp/sync-core.sh
  dom=$(timeout 120 google-chrome --headless=new --disable-gpu --no-sandbox --virtual-time-budget=4000 \
        --dump-dom "file://$(cd ../webapp && pwd)/index.html?g1selftest" 2>/dev/null | grep -o '<pre id="g1-selftest">.*</pre>' | sed 's/<[^>]*>//g')
  printf '%s' "$dom" | node -e '
const html = require("fs").readFileSync(0, "utf8");
const r = JSON.parse(html.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "\x27"));
const checks = [
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
  ["firered SID rows", r.sidRows === 3]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL browser: " + label); }
if (r.error) { bad++; console.error("FAIL browser: " + r.error); }
console.log("browser self-test: " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s"));
process.exit(bad ? 1 : 0);
'
else
  echo "google-chrome not found; skipping the browser self-test"
fi
