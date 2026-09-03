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
else
  echo "dotnet not found; skipping gen4 parity vectors, the JS/C# timer cross-check, the C# gen5 checks and the JS/C# generator cross-check"
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
  chrome_dom() { timeout 120 google-chrome --headless=new --disable-gpu --no-sandbox --user-data-dir="$profile" --virtual-time-budget="$1" --dump-dom "$2" 2>/dev/null; }
  chrome_dom 1000 "file://$probe?seed" | grep -o '<pre id="ls">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.seeded"
  chrome_dom 5000 "file://$(cd ../webapp && pwd)/index.html?g1selftest" | grep -o '<pre id="g1-selftest">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.dom"
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
  ["firered SID rows", r.sidRows === 3]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL browser: " + label); }
for (const x of [seeded, r, after]) if (x.error) { bad++; console.error("FAIL browser: " + x.error); }
console.log("browser self-test: " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s"));
fs.unlinkSync(process.argv[1] + ".seeded"); fs.unlinkSync(process.argv[1] + ".dom"); fs.unlinkSync(process.argv[1] + ".after");
process.exit(bad ? 1 : 0);
' "$profile"
else
  echo "google-chrome not found; skipping the browser self-test"
fi
