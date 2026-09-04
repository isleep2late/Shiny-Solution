#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ---- cross-repo guards that cannot run are LOUD ------------------------------------------------
# A guard that degrades to a silent pass is not a guard: that is how a retraction made in RNG
# Solution reached neither of this repository's heads while every run stayed green. Every guard
# that cannot run records itself here, the run ends on a summary line that names it, and the suite
# FAILS unless the run explicitly accepts an incomplete one with SHINY_ALLOW_DEGRADED_GUARDS=1.
DEGRADED_LOG=$(mktemp)
trap 'rm -f "$DEGRADED_LOG"' EXIT
guard_degraded() {   # $1 = the guard, $2 = why it could not run
  echo "GUARD DEGRADED: $1 DID NOT RUN -> $2"
  printf '  - %s: %s\n' "$1" "$2" >> "$DEGRADED_LOG"
}
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
  # Round 6 finding F: a plain echo left DEGRADED_LOG empty, so the final banner still printed
  # "ALL TESTS PASSED, ALL NEGATIVE CONTROLS FAILED AS REQUIRED, ALL CROSS-REPO GUARDS RAN" with the
  # whole C# half never run. A skip that the summary cannot see is a silent over-claim.
  guard_degraded "the C# half (gen4 parity vectors, the JS/C# timer, generator and seedtime4 cross-checks, the C# gen5 checks)" \
    "dotnet not found: the desktop head's engines were NOT compared with the JavaScript ones"
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

# tests/gen1tid-vectors.json is RNG Solution's own emission, so like every other oracle-derived artifact here it is
# re-emitted and byte-compared whenever its oracle is present (read-only: the emitter writes to stdout and nothing
# else, and PYTHONDONTWRITEBYTECODE keeps even a .pyc out of that checkout). The one line that may legitimately
# differ is line 2, the "source" provenance stamp, which names RNG Solution's HEAD and drifts as that repo moves;
# every other byte must match, and both files' line 2 must still be that emitter's stamp.
RNG_SRC="${RNG_SOLUTION_SRC:-$HOME/AI/Games/RNG-Solution}"
if [ -f "$RNG_SRC/tests/emit_vectors.py" ]; then
  reemit=$(mktemp --suffix=.json)
  ( cd "$RNG_SRC" && PYTHONDONTWRITEBYTECODE=1 python3 tests/emit_vectors.py ) > "$reemit"
  stamp='^"source": "emitted by RNG Solution tests/emit_vectors\.py \(rngsolution/timeline\.py, gen3\.py, jitter\.py at [^)]*\); '
  for f in gen1tid-vectors.json "$reemit"; do
    sed -n '2p' "$f" | grep -qE "$stamp" || {
      echo "gen1tid vectors: line 2 of $f is not the emitter's source stamp, so the ignored line is not the stamp"
      sed -n '2p' "$f" | cut -c1-150 | sed 's/^/      /'
      rm -f "$reemit"; exit 1; }
  done
  sed '2d' "$reemit" > "$reemit.re"; sed '2d' gen1tid-vectors.json > "$reemit.have"
  if cmp -s "$reemit.re" "$reemit.have"; then
    echo "gen1tid vectors re-emitted from RNG Solution: byte-identical apart from the source stamp (committed $(sed -n '2p' gen1tid-vectors.json | sed 's/.*jitter\.py at \([^)]*\)).*/\1/'), re-emitted $(sed -n '2p' "$reemit" | sed 's/.*jitter\.py at \([^)]*\)).*/\1/'))"
  else
    echo "gen1tid vectors re-emitted from RNG Solution: DIFFERS from the committed file outside the source stamp ->"
    diff "$reemit.have" "$reemit.re" | cut -c1-200 | head -6 | sed 's/^/      /'
    rm -f "$reemit" "$reemit.re" "$reemit.have"
    exit 1
  fi
  rm -f "$reemit" "$reemit.re" "$reemit.have"
else
  guard_degraded "cross-repo guard A (tests/gen1tid-vectors.json re-emitted from RNG Solution and byte-compared)" \
    "no RNG Solution checkout at $RNG_SRC (set RNG_SOLUTION_SRC); the committed copy was used and NOT checked against its oracle"
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

# The desktop Gen 2 TID panel is pinned to the web tab through tests/gen2tid-panel-vectors.json (what webapp/gen2tid-ui.js
# computes for 20 target inputs; app/run-core-tests.sh checks Gen2TidSupport.cs against it). A re-emit from the tab's
# functions must be byte-identical to the committed file, so the file always says what the tab says now.
node ../tools/gen-gen2-panel-vectors.cjs | cmp - gen2tid-panel-vectors.json && echo "gen2tid panel vectors re-emitted from the web tab: byte-identical"

# The decomp citation registry core/data/citations.json is generated from docs/FACTS.md by tools/gen-citations.py, each entry
# read in the pret checkout; when that checkout is present the registry is regenerated into a temp file and must be
# byte-identical to the committed one, so the committed registry always says what FACTS.md and pret say now.
if [ -d "$HOME/AI/pret/pokeemerald" ]; then
  regen=$(mktemp --suffix=.json)
  python3 ../tools/gen-citations.py "$regen" > /dev/null 2>&1 || { echo "gen-citations.py failed"; rm -f "$regen"; exit 1; }
  if cmp "$regen" ../core/data/citations.json; then
    echo "citation registry regenerated from docs/FACTS.md and pret: byte-identical ($(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).entries.length)' "$regen") entries)"
  else
    echo "FAIL: core/data/citations.json is not what tools/gen-citations.py generates from docs/FACTS.md and pret now"; rm -f "$regen"; exit 1
  fi
  rm -f "$regen"
  # Negative control: a copy of FACTS.md citing a line past the end of pokeruby/src/rtc.c must make the generator FAIL, and
  # is shown failing: a citation the checkout cannot read never lands in the registry silently.
  facts_bad=$(mktemp --suffix=.md)
  sed 's#pokeruby/src/rtc.c:13,134-140#pokeruby/src/rtc.c:13,134-999999#' ../docs/FACTS.md > "$facts_bad"
  grep -q 'pokeruby/src/rtc.c:13,134-999999' "$facts_bad" || { echo "negative control setup: the Ruby RTC citation was not found in FACTS.md"; exit 1; }
  if python3 ../tools/gen-citations.py --facts "$facts_bad" "$facts_bad.json" > "$facts_bad.out" 2>&1; then
    echo "negative control (FACTS.md citing a line past the end of the file): DID NOT FAIL"
    rm -f "$facts_bad" "$facts_bad.json" "$facts_bad.out"
    exit 1
  else
    echo "negative control (FACTS.md citing a line past the end of the file): FAILED as required ->"
    grep -E 'past the end' "$facts_bad.out" | head -2 | sed 's/^/      /'
  fi
  rm -f "$facts_bad" "$facts_bad.json" "$facts_bad.out"
  # Negative control: a copy of FACTS.md whose Ruby RTC citation starts on a blank line of pokeruby/src/rtc.c (line 12, beside
  # sRtcDummy at 13) must make the generator FAIL, and is shown failing: a range that points beside the routine it names
  # never lands in the registry silently.
  facts_bad=$(mktemp --suffix=.md)
  sed 's#pokeruby/src/rtc.c:13,134-140#pokeruby/src/rtc.c:12,134-140#' ../docs/FACTS.md > "$facts_bad"
  grep -q 'pokeruby/src/rtc.c:12,134-140' "$facts_bad" || { echo "negative control setup: the Ruby RTC citation was not found in FACTS.md"; exit 1; }
  if python3 ../tools/gen-citations.py --facts "$facts_bad" "$facts_bad.json" > "$facts_bad.out" 2>&1; then
    echo "negative control (FACTS.md citing a range that starts on a blank line): DID NOT FAIL"
    rm -f "$facts_bad" "$facts_bad.json" "$facts_bad.out"
    exit 1
  else
    echo "negative control (FACTS.md citing a range that starts on a blank line): FAILED as required ->"
    grep -E 'is blank' "$facts_bad.out" | head -2 | sed 's/^/      /'
  fi
  rm -f "$facts_bad" "$facts_bad.json" "$facts_bad.out"
else
  # Round 6 finding F. This branch skipped the citation regeneration AND its two negative controls
  # (the citation that no longer matches its source, and the range starting on a blank line), and the
  # summary saw none of it: with HOME pointed elsewhere the suite printed "ALL TESTS PASSED, ALL
  # NEGATIVE CONTROLS FAILED AS REQUIRED, ALL CROSS-REPO GUARDS RAN" and exited 0 with the citation
  # half never run.
  guard_degraded "the citation registry (core/data/citations.json regenerated from docs/FACTS.md, with its two negative controls)" \
    "no pret checkout at ~/AI/pret: the committed citations.json was used as-is and was NOT re-derived, and neither control ran"
fi

# ---- the $40xx rule: the three checks that keep the 1-in-712 mistake from coming back ---------------
# On the Any% save-corruption route only the Trainer ID's HIGH byte reaches the jump pointer (swap 1
# destroys the low byte before swap 2 copies ($D358, TID-high) into $D36E/$D36F), so the set is kind
# "highbyte" and every $40xx in a Red/Blue table is route-valid. The bank-$1D sled window
# ($00-$38 / $3A-$5C) is real but constrains that POINTER's low byte, not the ID's. The controls below
# put the old window back on the Trainer ID and require the tooling to reject it.
# (Caveat carried with the rule: it is emulator-measured only - PyBoy for the runs, gambatte-core for
# the tables - and unconfirmed on a cartridge; Blue's relaxation is inferred from Red, never swept.)
#
# Each control requires the SPECIFIC refusal - the exact exit status and the lines the refusing path
# prints - and each is then shown NOT accepting an unrelated breakage of the same run. Counting any
# non-zero exit as proof does not work here: the correct, unmutated gen1-tid.json under a root whose
# gen3-sid.json is simply missing exits 1 from the JS head (an ENOENT stack trace), 134 from the C#
# head (an unhandled FileNotFoundException) and 1 from the generator (a traceback over a deleted
# table), none of which says anything about the $40xx rule.

# refusal_is <output file> <status> <required status> <required grep -E pattern>...
# True only when the run failed exactly the way the refusing path fails; refusal_why says which part
# matched or which part did not.
refusal_why=""
refusal_is() {
  local out="$1" got="$2" want="$3"; shift 3
  if [ "$got" != "$want" ]; then
    refusal_why="exit status $got, wanted $want"
    return 1
  fi
  local pat
  for pat in "$@"; do
    if ! grep -qE -- "$pat" "$out"; then
      refusal_why="exit status $got but the output has no line matching /$pat/"
      return 1
    fi
  done
  refusal_why="exit status $got and all $# required line(s)"
  return 0
}

# run_capture <output file> <command...>: runs it, records RUN_STATUS, and does not trip set -e.
RUN_STATUS=0
run_capture() {
  local out="$1"; shift
  RUN_STATUS=0
  "$@" > "$out" 2>&1 || RUN_STATUS=$?
}

# The mutation both data-file controls plant: hi40-corruption back to kind 'sled' over the bank-$1D
# low-byte window, i.e. the 1-in-712 rule.
plant_sled=$(mktemp --suffix=.py)
cat > "$plant_sled" <<'PY_SLED'
import json, sys
d = json.load(open(sys.argv[1]))
s = d["target_sets"]["hi40-corruption"]
assert s["kind"] == "highbyte", "negative control setup: hi40-corruption is not kind 'highbyte' any more"
s["kind"] = "sled"
s["lo_ranges"] = [["00", "38"], ["3A", "5C"]]
json.dump(d, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
PY_SLED

# make_root <dir> windowed|nogen3|truncated - a temp repo root holding core/data, never the committed one.
#   windowed:  gen3-sid.json copied, gen1-tid.json with the low-byte window planted (the real mutation)
#   nogen3:    the CORRECT gen1-tid.json and no gen3-sid.json at all (an unrelated breakage)
#   truncated: gen3-sid.json copied, gen1-tid.json cut to its first 400 bytes (a second unrelated
#              breakage, used below to record what the C# head's sha1 pin cannot distinguish)
make_root() {
  mkdir -p "$1/core/data"
  case "$2" in
    windowed)  cp ../core/data/gen3-sid.json "$1/core/data/"
               python3 "$plant_sled" ../core/data/gen1-tid.json "$1/core/data/gen1-tid.json" ;;
    nogen3)    cp ../core/data/gen1-tid.json "$1/core/data/" ;;
    truncated) cp ../core/data/gen3-sid.json "$1/core/data/"
               head -c 400 ../core/data/gen1-tid.json > "$1/core/data/gen1-tid.json" ;;
  esac
}

# Negative control (a): core/data/gen1-tid.json with hi40-corruption reverted to kind 'sled' with the
# low-byte window must FAIL test-gen1tid.cjs with the four Red/Blue tables losing their $40xx offsets
# and the set describing itself with a low-byte window, and is shown failing. The mutated copy goes in
# a temp repo root (test-gen1tid.cjs's optional second argument), never over the committed file.
gen1_refusal=(
  '^FAIL table red/dmg/hold-start-v1 every \$40xx is route-valid$'
  '^FAIL table blue/dmg/hold-start-v1 route-valid under hi40-corruption$'
  '^FAIL describe hi40-corruption$'
  '^  actual   "hi40-corruption: high byte \$40, low byte \$00-\$38 or \$3A-\$5C"$'
  '^[0-9]+ failure\(s\) in [0-9]+ checks$'
)
badroot=$(mktemp -d); make_root "$badroot" windowed
run_capture "$badroot/out" node test-gen1tid.cjs gen1tid-vectors.json "$badroot"
if refusal_is "$badroot/out" "$RUN_STATUS" 1 "${gen1_refusal[@]}"; then
  echo "negative control (the \$40xx set windowed back onto the Trainer ID's low byte): FAILED as required ($refusal_why) ->"
  grep -E '^FAIL|failure' "$badroot/out" | head -4 | sed 's/^/      /'
else
  echo "negative control (the \$40xx set windowed back onto the Trainer ID's low byte): DID NOT REFUSE AS REQUIRED ($refusal_why)"
  head -5 "$badroot/out" | sed 's/^/      /'
  rm -rf "$badroot"
  exit 1
fi
rm -rf "$badroot"
# and the control must not accept an unrelated breakage of the same run: the correct gen1-tid.json
# under a root with no gen3-sid.json exits non-zero too, which is all the control used to ask for.
okroot=$(mktemp -d); make_root "$okroot" nogen3
run_capture "$okroot/out" node test-gen1tid.cjs gen1tid-vectors.json "$okroot"
if refusal_is "$okroot/out" "$RUN_STATUS" 1 "${gen1_refusal[@]}"; then
  echo "  control self-check: the unmutated data file with gen3-sid.json missing was ACCEPTED as the \$40xx refusal - the control passes for the wrong reason"
  rm -rf "$okroot"
  exit 1
else
  echo "  control self-check: an unrelated breakage (correct gen1-tid.json, no gen3-sid.json) is not accepted -> $refusal_why"
  grep -m1 -E 'Error|FAIL' "$okroot/out" | cut -c1-150 | sed 's/^/      /'
fi
rm -rf "$okroot"

# The C# head's EMBEDDED-RESOURCE PIN. This is NOT a $40xx check and must not be read as one. The C# head
# carries gen1-tid.json as an embedded resource and never parses the repo file at all - it only sha1-compares
# the two - so the windowed copy cannot reach its engine, and the pin reports the same single failure for ANY
# edit to core/data/gen1-tid.json: the $40xx mutation, a reworded note and a truncation are indistinguishable
# to it. What this control establishes is therefore exactly that, and only that: a hand-edited data file is
# never used by the C# head silently. (The C# engine's own "every $40xx is route-valid" assertion runs against
# the EMBEDDED data, in app/run-core-tests.sh; the rule itself is covered by negative control (a) above, on
# the JS head, which does parse the file.)
# Two self-checks bound the claim. A root with no gen3-sid.json exits 134, not 1, so a bare non-zero exit is
# not accepted in the pin's place. And a gen1-tid.json truncated to its first 400 bytes - a breakage with
# nothing to do with the $40xx rule - is REQUIRED to trip the pin identically, which puts the limitation above
# in the suite's output instead of leaving it to be assumed.
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  cs_refusal=(
    '^FAIL embedded gen1-tid\.json is byte-identical to the repo file$'
    '^1 failure\(s\) in [0-9]+ gen1tid checks$'
  )
  badroot=$(mktemp -d); make_root "$badroot" windowed
  run_capture "$badroot/out" dotnet run --project ../app/Tests -c Release -- --gen1tid gen1tid-vectors.json "$badroot"
  if refusal_is "$badroot/out" "$RUN_STATUS" 1 "${cs_refusal[@]}"; then
    echo "embedded-resource pin (an edited core/data/gen1-tid.json under the repo root; here the windowed one): REFUSED as required ($refusal_why) ->"
    grep -E '^FAIL|failure' "$badroot/out" | head -4 | sed 's/^/      /'
  else
    echo "embedded-resource pin (an edited core/data/gen1-tid.json under the repo root; here the windowed one): DID NOT REFUSE AS REQUIRED ($refusal_why)"
    head -5 "$badroot/out" | sed 's/^/      /'
    rm -rf "$badroot"
    exit 1
  fi
  rm -rf "$badroot"
  okroot=$(mktemp -d); make_root "$okroot" nogen3
  run_capture "$okroot/out" dotnet run --project ../app/Tests -c Release -- --gen1tid gen1tid-vectors.json "$okroot"
  if refusal_is "$okroot/out" "$RUN_STATUS" 1 "${cs_refusal[@]}"; then
    echo "  pin self-check: the unmutated data file with gen3-sid.json missing was ACCEPTED as the pin's refusal - the control passes for the wrong reason"
    rm -rf "$okroot"
    exit 1
  else
    echo "  pin self-check: a breakage that does not touch gen1-tid.json (no gen3-sid.json) is not accepted -> $refusal_why"
    grep -m1 -E 'Exception|FAIL' "$okroot/out" | cut -c1-150 | sed 's/^/      /'
  fi
  rm -rf "$okroot"

  # The limitation, recorded as a check rather than left implicit: an edit with nothing to do with the
  # $40xx rule - gen1-tid.json cut to its first 400 bytes - must trip the pin in exactly the same way,
  # because the C# head compares sha1s and never looks inside. If it ever stopped tripping, a broken data
  # file would be reaching that head silently, so this is required to REFUSE, not required to differ.
  cutroot=$(mktemp -d); make_root "$cutroot" truncated
  run_capture "$cutroot/out" dotnet run --project ../app/Tests -c Release -- --gen1tid gen1tid-vectors.json "$cutroot"
  if refusal_is "$cutroot/out" "$RUN_STATUS" 1 "${cs_refusal[@]}"; then
    echo "  pin self-check: an unrelated edit (gen1-tid.json truncated to 400 bytes) trips the pin IDENTICALLY -> the pin sees THAT the repo file changed, never WHAT changed"
    grep -m1 -E '^FAIL' "$cutroot/out" | cut -c1-150 | sed 's/^/      /'
  else
    echo "  pin self-check: gen1-tid.json truncated to 400 bytes did NOT trip the embedded-resource pin ($refusal_why) - a broken data file would reach the C# head silently"
    head -5 "$cutroot/out" | sed 's/^/      /'
    rm -rf "$cutroot"
    exit 1
  fi
  rm -rf "$cutroot"
fi

# Negative control (b): tools/gen-gen1-data.py's refusal (check_target_sets). Both runs are fully
# isolated - the script is copied into a temp tree, so its ROOT / OUT_DIR are that tree and nothing can
# be written over the committed core/data. First the positive half, so the refusal is not passing for
# the wrong reason: over the real registry the script must SUCCEED and reproduce both committed files
# byte for byte. Then the same registry with the Trainer ID set windowed back must exit 1 printing
# check_target_sets' own sentence and write nothing - and a registry that is merely missing a table
# file, which also exits non-zero and also writes nothing, must not be accepted in its place.
RNG_SRC="${RNG_SOLUTION_SRC:-$HOME/AI/Games/RNG-Solution}"
if [ -f "$RNG_SRC/rngsolution/data/red/platforms.json" ]; then
  gen_refusal=(
    "target set 'hi40-corruption' is kind 'sled' with a restricted low byte"
    "constrains the jump POINTER's low byte, not the Trainer ID's"
  )
  gendir=$(mktemp -d)
  mkdir -p "$gendir/tools" "$gendir/rng/rngsolution"
  cp ../tools/gen-gen1-data.py "$gendir/tools/"
  cp -r "$RNG_SRC/rngsolution/data" "$gendir/rng/rngsolution/data"
  python3 "$gendir/tools/gen-gen1-data.py" "$gendir/rng" > /dev/null
  # The script must have written both files. They are byte-compared with the committed copies only when the
  # registry it just read is the one those copies record in inputs_sha1: RNG Solution is a separate repository
  # with its own HEAD, so when its registry has moved the two sha1s are named and the comparison is not claimed
  # (a `cmp` in an && list prints "differ" and returns non-zero without failing the suite, which is not a check).
  for f in gen1-tid.json gen3-sid.json; do
    [ -s "$gendir/core/data/$f" ] || { echo "gen-gen1-data.py over the real registry wrote no $f"; rm -rf "$gendir"; exit 1; }
  done
  reg_sha=$(python3 -c 'import hashlib,sys;print(hashlib.sha1(open(sys.argv[1],"rb").read()).hexdigest())' "$gendir/rng/rngsolution/data/red/platforms.json")
  rec_sha=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["inputs_sha1"]["platforms.json"])' ../core/data/gen1-tid.json)
  if [ "$reg_sha" = "$rec_sha" ]; then
    for f in gen1-tid.json gen3-sid.json; do
      cmp "$gendir/core/data/$f" "../core/data/$f" || { echo "$f regenerated from RNG Solution's registry DIFFERS from the committed file"; rm -rf "$gendir"; exit 1; }
      echo "$f regenerated from RNG Solution's registry: byte-identical to the committed file"
    done
  else
    guard_degraded "cross-repo guard B (core/data/*.json byte-compared with a regeneration from RNG Solution's registry)" \
      "RNG Solution's registry has moved since core/data/*.json were generated (rngsolution/data/red/platforms.json is $reg_sha, the committed files record $rec_sha); the regeneration ran and wrote both files, but nothing was byte-compared. Re-run tools/gen-gen1-data.py"
  fi
  rm -rf "$gendir/core"

  # the unrelated breakage first, on a copy of the same registry: Red's DMG table deleted
  cutdir=$(mktemp -d)
  mkdir -p "$cutdir/tools" "$cutdir/rng/rngsolution"
  cp ../tools/gen-gen1-data.py "$cutdir/tools/"
  cp -r "$gendir/rng/rngsolution/data" "$cutdir/rng/rngsolution/data"
  rm -f "$cutdir/rng/rngsolution/data/red/dmg.csv"
  run_capture "$cutdir/out" python3 "$cutdir/tools/gen-gen1-data.py" "$cutdir/rng"
  if refusal_is "$cutdir/out" "$RUN_STATUS" 1 "${gen_refusal[@]}"; then
    echo "  control self-check: a registry merely missing red/dmg.csv was ACCEPTED as the \$40xx refusal - the control passes for the wrong reason"
    rm -rf "$cutdir" "$gendir"
    exit 1
  else
    echo "  control self-check: an unrelated breakage (registry without red/dmg.csv) is not accepted -> $refusal_why"
    grep -m1 -E 'Error|error' "$cutdir/out" | cut -c1-150 | sed 's/^/      /'
  fi
  rm -rf "$cutdir"

  python3 - "$gendir/rng/rngsolution/data/red/platforms.json" <<'PY_REG'
import json, sys
d = json.load(open(sys.argv[1]))
s = d["target_sets"]["hi40-corruption"]
assert s["kind"] == "highbyte", "negative control setup: hi40-corruption is not kind 'highbyte' any more"
s["kind"] = "sled"
s["lo_ranges"] = [["00", "38"], ["3A", "5C"]]
json.dump(d, open(sys.argv[1], "w"), indent=1, ensure_ascii=False)
PY_REG
  run_capture "$gendir/out" python3 "$gendir/tools/gen-gen1-data.py" "$gendir/rng"
  if refusal_is "$gendir/out" "$RUN_STATUS" 1 "${gen_refusal[@]}"; then
    echo "negative control (gen-gen1-data.py over a registry that windows the Trainer ID's low byte): REFUSED as required ($refusal_why) ->"
    head -2 "$gendir/out" | fold -w 150 | sed 's/^/      /'
    if [ -e "$gendir/core" ]; then
      echo "      but it wrote files: $(ls -R "$gendir/core")"
      rm -rf "$gendir"
      exit 1
    fi
    echo "      and wrote nothing"
  else
    echo "negative control (gen-gen1-data.py over a registry that windows the Trainer ID's low byte): DID NOT REFUSE AS REQUIRED ($refusal_why)"
    head -5 "$gendir/out" | sed 's/^/      /'
    rm -rf "$gendir"
    exit 1
  fi
  rm -rf "$gendir"
else
  guard_degraded "cross-repo guard B (core/data/*.json byte-compared with a regeneration from RNG Solution's registry)" \
    "no RNG Solution checkout at $RNG_SRC (set RNG_SOLUTION_SRC); tools/gen-gen1-data.py was not exercised at all"
fi
rm -f "$plant_sled"

# ---- guard C: the verification claims of BOTH heads --------------------------------------------
# "[3x cold-boot verified]" is a claim about evidence, so the repository that prints it must be able
# to show the three derivations. RNG Solution enforces that on its own CLI (tests/test_games.py
# VerificationClaims); this is the same rule over THIS repository's two heads, run on the real
# rendered lines of each: the web tab's module loaded in node, and the desktop head's own emission
# (app/Tests --emit-gen1-claims over app/App/Gen1TidSupport.cs). It fails if either head prints the
# flat claim for an offset whose evidence is not a fixture that ships, if the two heads disagree,
# or (with an RNG Solution checkout) if a named fixture has no agreeing row for a verified target.
claims_rng=()
if [ -f "$RNG_SRC/rngsolution/data/red/platforms.json" ]; then claims_rng=(--rng "$RNG_SRC"); fi
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  claims=$(mktemp --suffix=.json)
  dotnet run --project ../app/Tests -c Release -- --emit-gen1-claims "$claims" - ../core/data/citations.json
  set +e
  node check-verification-claims.cjs --cs "$claims" "${claims_rng[@]}"
  claims_status=$?
  set -e
  case "$claims_status" in
    0) : ;;
    3) guard_degraded "cross-repo guard C (the verification-claims guard's fixture half)" \
         "no RNG Solution checkout at $RNG_SRC (set RNG_SOLUTION_SRC); the flat claims were checked for in-repo evidence but the fixture ROWS behind them were not read" ;;
    *) echo "verification claims guard FAILED"; rm -f "$claims"; exit 1 ;;
  esac

  # Negative control (a): the web tab's head, in a copy, computing the tag from the verified-target
  # list alone again (the defect this guard exists for) must FAIL, and is shown failing. The decision
  # lives in core/gen1tid.js since 2026-09-04 - one implementation for the web tab, the desktop head
  # and the WEBSITE, which had reimplemented it and reimplemented this bug with it - so the plant goes
  # into a copy of the engine and the guard is pointed at it with --core.
  ctam=$(mktemp -d)
  cp -r ../core "$ctam/core"
  python3 - "$ctam/core/gen1tid.js" <<'PY_JS'
import sys
p = sys.argv[1]
s = open(p).read()
old = """    if ((plat.verifiedTargets || []).indexOf(offset) === -1) return ONE_DERIVATION_TAG;
    return verifiedTag(plat);"""
new = """    return (plat.verifiedTargets || []).indexOf(offset) !== -1 ? VERIFIED_TAG : ONE_DERIVATION_TAG;"""
assert old in s, "negative control setup: derivationTag is not the evidence-driven form any more"
open(p, "w").write(s.replace(old, new, 1))
PY_JS
  if node check-verification-claims.cjs --cs "$claims" --core "$ctam/core" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
    echo "negative control (the web head printing the flat claim for Red again): DID NOT FAIL"
    rm -rf "$ctam"; rm -f "$claims"; exit 1
  else
    grep -q "the FLAT claim at offset 358 is backed by an in-repo fixture" "$ctam/out" || {
      echo "negative control (the web head printing the flat claim for Red again): failed for the wrong reason ->"
      head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; rm -f "$claims"; exit 1; }
    echo "negative control (the web head printing the flat claim for Red again): FAILED as required ->"
    grep -m2 "^FAIL" "$ctam/out" | cut -c1-160 | sed 's/^/      /'
  fi
  rm -rf "$ctam"

  # Negative control (b): the same defect in the DESKTOP head - a copy of app/ with DerivationTag
  # back on the verified-target list, compiled and re-emitted - must FAIL, and is shown failing.
  ctam=$(mktemp -d)
  mkdir -p "$ctam/core"
  cp -r ../app "$ctam/app"
  cp -r ../core/data "$ctam/core/data"
  rm -rf "$ctam/app/Tests/bin" "$ctam/app/Tests/obj" "$ctam/app/App/bin" "$ctam/app/App/obj" "$ctam/app/Core/bin" "$ctam/app/Core/obj"
  python3 - "$ctam/app/App/Gen1TidSupport.cs" <<'PY_CS'
import sys
p = sys.argv[1]
s = open(p).read()
old = """        if (!p.Timing.VerifiedTargets.Contains(offset)) return OneDerivationTag;
        return VerifiedTagFor(p);"""
new = """        return p.Timing.VerifiedTargets.Contains(offset) ? VerifiedTag : OneDerivationTag;"""
assert old in s, "negative control setup: DerivationTag is not the evidence-driven form any more"
open(p, "w").write(s.replace(old, new, 1))
PY_CS
  dotnet run --project "$ctam/app/Tests" -c Release -- --emit-gen1-claims "$ctam/claims.json" - ../core/data/citations.json > "$ctam/build" 2>&1 || {
    echo "negative control (the desktop head printing the flat claim for Red again): the tampered copy did not build ->"
    tail -5 "$ctam/build" | sed 's/^/      /'; rm -rf "$ctam"; rm -f "$claims"; exit 1; }
  if node check-verification-claims.cjs --cs "$ctam/claims.json" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
    echo "negative control (the desktop head printing the flat claim for Red again): DID NOT FAIL"
    rm -rf "$ctam"; rm -f "$claims"; exit 1
  else
    grep -q "csharp (app/App/Gen1TidSupport.cs) red/gse: the FLAT claim at offset 358 is backed by an in-repo fixture" "$ctam/out" || {
      echo "negative control (the desktop head printing the flat claim for Red again): failed for the wrong reason ->"
      head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; rm -f "$claims"; exit 1; }
    echo "negative control (the desktop head printing the flat claim for Red again): FAILED as required ->"
    grep -m2 "^FAIL verification claims: csharp" "$ctam/out" | cut -c1-160 | sed 's/^/      /'
  fi
  rm -rf "$ctam"
  rm -f "$claims"
else
  guard_degraded "cross-repo guard C (the verification-claims guard)" \
    "dotnet not found, so the desktop head could not be rendered and neither head's claims were checked"
fi

# ---- guard D: the claim SENTENCES, of both heads, of the data and of the docs -------------------
# Guard C is about the TAG. This is about the sentence beside it: a rendered unit of text that
# asserts a multi-boot derivation must name what ships from it, and a panel that prints a verified
# tag must print that platform's note and evidence too. tests/claim-phrases.json carries the rule
# and is byte-identical to RNG Solution's copy (the guard compares them when the checkout is there),
# so the two repositories cannot drift on what counts as qualified - which is how the round-1
# retraction failed to reach the sibling. RNG Solution runs the same rule on its own surfaces
# (tests/test_claims.py, controls C1-C5 there).
claims_cs=()
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  sent_cs=$(mktemp --suffix=.json)
  dotnet run --project ../app/Tests -c Release -- --emit-gen1-claims "$sent_cs" - ../core/data/citations.json > /dev/null
  claims_cs=(--cs "$sent_cs")
fi
set +e
node check-claim-sentences.cjs "${claims_cs[@]}" "${claims_rng[@]}"
sent_status=$?
set -e
case "$sent_status" in
  0) : ;;
  3) guard_degraded "cross-repo guard D (the claim-sentence guard)" \
       "dotnet or the RNG Solution checkout was missing, so the desktop head's sentences and/or the shared rule file were NOT judged" ;;
  *) echo "claim sentence guard FAILED"; exit 1 ;;
esac

# Negative control (a): the web head printing a verified tag with the note taken out from under it
# (rounds 2 and 3's defect: the tag reached the user, the sentence behind it did not) must FAIL.
ctam=$(mktemp -d)
cp -r ../webapp "$ctam/webapp"
python3 - "$ctam/webapp/gen1tid-ui.js" <<'PY_NOTE'
import sys
p = sys.argv[1]
s = open(p).read()
old = '    if (plat.verifiedNote) lines.push(indent + "  " + plat.verifiedNote);'
assert old in s, "negative control setup: verificationLines no longer prints the note"
open(p, "w").write(s.replace(old, "", 1))
PY_NOTE
if node check-claim-sentences.cjs "${claims_cs[@]}" --webapp "$ctam/webapp" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
  echo "negative control (the web head printing a verified tag with no note behind it): DID NOT FAIL"
  rm -rf "$ctam"; exit 1
else
  grep -q "the panel prints a verified tag and the note behind it" "$ctam/out" || {
    echo "negative control (the web head printing a verified tag with no note behind it): failed for the wrong reason ->"
    head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  echo "negative control (the web head printing a verified tag with no note behind it): FAILED as required ->"
  grep -m2 "^FAIL claim sentence" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
fi
rm -rf "$ctam"

# Negative control (b): an unqualified sweep sentence planted at the TOP of the web head's
# methodology panel - far from the note at the bottom - must FAIL: the qualifier has to be near the
# claim, or a footer would excuse anything above it.
ctam=$(mktemp -d)
cp -r ../webapp "$ctam/webapp"
python3 - "$ctam/webapp/gen1tid-ui.js" <<'PY_PLANT'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'var lines = [indent + "Methodology: " + plat.methodologyId'
new = ('var lines = [indent + "Every offset of this table was re-derived byte-identically from three other cold boots.", '
       'indent + "Methodology: " + plat.methodologyId')
assert old in s, "negative control setup: methodologyLines has moved"
open(p, "w").write(s.replace(old, new, 1))
PY_PLANT
if node check-claim-sentences.cjs "${claims_cs[@]}" --webapp "$ctam/webapp" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
  echo "negative control (an unqualified sweep sentence in the web head's panel): DID NOT FAIL"
  rm -rf "$ctam"; exit 1
else
  grep -q "methodology panel | asserts" "$ctam/out" || {
    echo "negative control (an unqualified sweep sentence in the web head's panel): failed for the wrong reason ->"
    head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  echo "negative control (an unqualified sweep sentence in the web head's panel): FAILED as required ->"
  grep -m2 "^FAIL claim sentence" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
fi
rm -rf "$ctam"

# Negative control (c): the same sentence in the DESKTOP head - a copy of app/ with the plant in
# Gen1TidSupport.cs, compiled and re-emitted - must FAIL, and is shown failing. Without it this
# guard would only ever have judged the web head's strings.
if [ ${#claims_cs[@]} -gt 0 ]; then
  ctam=$(mktemp -d)
  mkdir -p "$ctam/core"
  cp -r ../app "$ctam/app"
  cp -r ../core/data "$ctam/core/data"
  rm -rf "$ctam/app/Tests/bin" "$ctam/app/Tests/obj" "$ctam/app/App/bin" "$ctam/app/App/obj" "$ctam/app/Core/bin" "$ctam/app/Core/obj"
  python3 - "$ctam/app/App/Gen1TidSupport.cs" <<'PY_CS_PLANT'
import sys
p = sys.argv[1]
s = open(p).read()
old = """        var lines = new List<string>
        {
            $"{indent}Methodology:"""
new = """        var lines = new List<string>
        {
            indent + "Every offset of this table was re-derived byte-identically from three other cold boots.",
            $"{indent}Methodology:"""
assert old in s, "negative control setup: MethodologyLines has moved"
open(p, "w").write(s.replace(old, new, 1))
PY_CS_PLANT
  dotnet run --project "$ctam/app/Tests" -c Release -- --emit-gen1-claims "$ctam/claims.json" - ../core/data/citations.json > "$ctam/build" 2>&1 || {
    echo "negative control (an unqualified sweep sentence in the desktop head): the tampered copy did not build ->"
    tail -5 "$ctam/build" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  if node check-claim-sentences.cjs --cs "$ctam/claims.json" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
    echo "negative control (an unqualified sweep sentence in the desktop head): DID NOT FAIL"
    rm -rf "$ctam"; exit 1
  else
    grep -q "csharp (app/App/Gen1TidSupport.cs).*methodology panel | asserts" "$ctam/out" || {
      echo "negative control (an unqualified sweep sentence in the desktop head): failed for the wrong reason ->"
      head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
    echo "negative control (an unqualified sweep sentence in the desktop head): FAILED as required ->"
    grep -m1 "^FAIL claim sentence: csharp" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
  fi
  rm -rf "$ctam"
fi

# Negative control (d): the data the WEBSITE renders verbatim - a copy of core/data/gen1-tid.json
# with a derivation field's "what SHIPS" clause taken out - must FAIL.
ctam=$(mktemp -d)
python3 - ../core/data/gen1-tid.json "$ctam/gen1-tid.json" <<'PY_DATA'
import json, sys
d = json.load(open(sys.argv[1]))
m = d["methodologies"]["blue/gba/hold-start-v1"]
i = m["derivation"].index(" - what SHIPS")
m["derivation"] = m["derivation"][:i]
json.dump(d, open(sys.argv[2], "w"), indent=1)
PY_DATA
if node check-claim-sentences.cjs "${claims_cs[@]}" --data "$ctam/gen1-tid.json" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
  echo "negative control (an unqualified derivation field in gen1-tid.json): DID NOT FAIL"
  rm -rf "$ctam"; exit 1
else
  grep -q "blue/gba/hold-start-v1.derivation" "$ctam/out" || {
    echo "negative control (an unqualified derivation field in gen1-tid.json): failed for the wrong reason ->"
    head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  echo "negative control (an unqualified derivation field in gen1-tid.json): FAILED as required ->"
  grep -m1 "blue/gba/hold-start-v1.derivation" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
fi
rm -rf "$ctam"

# Negative control (e): the prose. A copy of the repository's docs with one unqualified sentence
# appended to USAGE.md must FAIL.
ctam=$(mktemp -d)
mkdir -p "$ctam/docs"
cp ../README.md ../USAGE.md "$ctam/"
cp ../docs/FACTS.md ../docs/DATA.md "$ctam/docs/"
printf '\n\nEvery offset of every table was re-derived byte-identically from three other cold boots.\n' >> "$ctam/USAGE.md"
if node check-claim-sentences.cjs "${claims_cs[@]}" --docs-root "$ctam" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
  echo "negative control (an unqualified sentence in USAGE.md): DID NOT FAIL"
  rm -rf "$ctam"; exit 1
else
  grep -q "USAGE.md | block" "$ctam/out" || {
    echo "negative control (an unqualified sentence in USAGE.md): failed for the wrong reason ->"
    head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  echo "negative control (an unqualified sentence in USAGE.md): FAILED as required ->"
  grep -m1 "USAGE.md | block" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
fi
rm -rf "$ctam"

# Negative control (f): the rule itself drifting apart between the repositories - a sibling checkout
# whose claim-phrases.json has lost a claim pattern - must FAIL, because then one repository would
# accept a sentence the other rejects.
ctam=$(mktemp -d)
mkdir -p "$ctam/tests"
python3 - claim-phrases.json "$ctam/tests/claim-phrases.json" <<'PY_RULE'
import json, sys
d = json.load(open(sys.argv[1]))
d["claim_patterns"] = [p for p in d["claim_patterns"] if "byte-identically" not in p]
json.dump(d, open(sys.argv[2], "w"), indent=2)
PY_RULE
if node check-claim-sentences.cjs "${claims_cs[@]}" --rng "$ctam" > "$ctam/out" 2>&1; then
  echo "negative control (the shared claim rule drifting between the repositories): DID NOT FAIL"
  rm -rf "$ctam"; exit 1
else
  grep -q "byte-identical in both repositories" "$ctam/out" || {
    echo "negative control (the shared claim rule drifting between the repositories): failed for the wrong reason ->"
    head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  echo "negative control (the shared claim rule drifting between the repositories): FAILED as required ->"
  grep -m1 "byte-identical in both repositories" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
fi
rm -rf "$ctam"

# Negative control (g): THE CONTROL BOTH GUARDS WERE PROVEN BLIND TO. The fixtures are what both
# heads print as "Evidence (RNG Solution): tests/fixtures/<x>-triple.csv", and neither guard read
# them: an unqualified derivation sentence planted as line 2 of blue-gba-triple.csv passed unchanged.
if [ ${#claims_rng[@]} -gt 0 ]; then
  ctam=$(mktemp -d)
  mkdir -p "$ctam/tests" "$ctam/rngsolution/data/red"
  cp -r "$RNG_SRC/tests/fixtures" "$ctam/tests/fixtures"
  cp "$RNG_SRC/tests/claim-phrases.json" "$ctam/tests/claim-phrases.json"
  cp "$RNG_SRC/rngsolution/data/red/platforms.json" "$ctam/rngsolution/data/red/platforms.json"
  python3 - "$ctam/tests/fixtures/blue-gba-triple.csv" <<'PY_FX'
import io, sys
p = sys.argv[1]
lines = io.open(p, encoding="utf-8").read().split("\n")
lines.insert(1, "# every offset here was re-derived byte-identically from three independent cold boots")
io.open(p, "w", encoding="utf-8").write("\n".join(lines))
PY_FX
  if node check-claim-sentences.cjs "${claims_cs[@]}" --rng "$ctam" > "$ctam/out" 2>&1; then
    echo "negative control (an unqualified sentence in the evidence fixture both heads cite): DID NOT FAIL"
    rm -rf "$ctam"; exit 1
  else
    grep -q "blue-gba-triple.csv line 2" "$ctam/out" || {
      echo "negative control (an unqualified sentence in the evidence fixture both heads cite): failed for the wrong reason ->"
      head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
    echo "negative control (an unqualified sentence in the evidence fixture both heads cite): FAILED as required ->"
    grep -m1 "blue-gba-triple.csv line 2" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
  fi
  rm -rf "$ctam"
fi

# Negative control (h): the Gen 3 Secret ID panel citing an uncommitted scratch directory as one of
# its two independent harnesses - round 5 finding D, exactly as it was rendered. gen3-sid.json was
# not among the JSON this guard judged and 'two independent harnesses' was not a claim pattern.
ctam=$(mktemp -d)
python3 - ../core/data/gen3-sid.json "$ctam/gen3-sid.json" <<'PY_SID'
import io, sys
s = io.open(sys.argv[1], encoding="utf-8").read()
old = "tools/gen3-sid-savestate-harness with a savestate binary search"
assert old in s, "negative control setup: the savestate harness is not cited where it was"
io.open(sys.argv[2], "w", encoding="utf-8").write(s.replace(old, "/tmp/gen3sid with a savestate binary search"))
PY_SID
if node check-claim-sentences.cjs "${claims_cs[@]}" --gen3 "$ctam/gen3-sid.json" "${claims_rng[@]}" > "$ctam/out" 2>&1; then
  echo "negative control (the Gen 3 panel citing an uncommitted /tmp harness): DID NOT FAIL"
  rm -rf "$ctam"; exit 1
else
  grep -q "cites /tmp/gen3sid" "$ctam/out" || {
    echo "negative control (the Gen 3 panel citing an uncommitted /tmp harness): failed for the wrong reason ->"
    head -4 "$ctam/out" | sed 's/^/      /'; rm -rf "$ctam"; exit 1; }
  echo "negative control (the Gen 3 panel citing an uncommitted /tmp harness): FAILED as required ->"
  grep -m1 "cites /tmp/gen3sid" "$ctam/out" | cut -c1-165 | sed 's/^/      /'
fi
rm -rf "$ctam"
rm -f "${sent_cs:-}"

# The desktop wizard panel is pinned to the web tab through tests/wizard-panel-vectors.json (what webapp/wizard-ui.js computes
# for its self-test scenarios and 20 random wanted-IV searches; app/run-core-tests.sh checks WizardSupport.cs against it). A
# re-emit from the tab's module must be byte-identical to the committed file, so the file always says what the tab says now.
node ../tools/gen-wizard-panel-vectors.cjs | cmp - wizard-panel-vectors.json && echo "wizard panel vectors re-emitted from the web tab: byte-identical"

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
echo "the plain electron stage: no hunt/ directory, no sentinel; main.js names no hunt window and package.json no ws; mode.js staged: $([ -f ../electron/webapp/mode.js ] && echo yes || { echo no; exit 1; }); gen2tid-ui.js staged: $([ -f ../electron/webapp/gen2tid-ui.js ] && echo yes || { echo no; exit 1; }); wizard-ui.js and its lazily loaded tables staged: $([ -f ../electron/webapp/wizard-ui.js ] && [ -f ../electron/webapp/data/wizard-gen3.js ] && [ -f ../electron/webapp/data/wizard-gen4.js ] && grep -q '^window.ShinyWizardData3 = {' ../electron/webapp/data/wizard-gen3.js && grep -q '^window.ShinyWizardData4 = {' ../electron/webapp/data/wizard-gen4.js && echo yes || { echo no; exit 1; })"

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

# Negative control: a bundle whose wizard tab module no longer registers as ShinyWizardUi (its export line renamed) must
# FAIL, and is shown failing, so the carry of webapp/wizard-ui.js into the bundle is a checked fact.
node -e '
const fs = require("fs");
const ts = fs.readFileSync(process.argv[1], "utf8");
const needle = "root.ShinyWizardUi = api";
if (!ts.includes(needle)) { console.error("negative control setup: the wizard tab module export line was not found in the bundle"); process.exit(1); }
fs.writeFileSync(process.argv[2], ts.split(needle).join("root.ShinyWizardUiRenamed = api"));
' "$bundle" "$bundle.wz"
if node test-webapp.cjs "$bundle.wz" > "$bundle.out" 2>&1; then
  echo "negative control (bundle with the wizard tab module renamed): DID NOT FAIL"
  rm -f "$bundle" "$bundle.wz" "$bundle.out"
  exit 1
else
  echo "negative control (bundle with the wizard tab module renamed): FAILED as required ->"
  grep -E '^FAIL|failure' "$bundle.out" | head -3 | sed 's/^/      /'
fi
rm -f "$bundle.wz" "$bundle.out"

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

# The offline copy (webapp/sw.js) in a node sandbox with fake caches, fetch and clients (tests/test-sw.cjs): install
# precaches every file index.html loads, activate drops the caches of other builds, and with the network gone the shell,
# any navigation under the scope and a data file opened once are served from the caches; the build stamp in sw.js is the
# one in index.html and the one the shipped sources hash to now.
node test-sw.cjs

# Negative control: sw.js with its data route cut out (the wizard's tables no longer cached on first use) must FAIL, and
# is shown failing: the offline wizard rests on that route, and the check sees it gone.
nodata=$(mktemp --suffix=.js)
sed '/DATA ROUTE BEGIN/,/DATA ROUTE END/d' ../webapp/sw.js > "$nodata"
grep -q "DATA ROUTE" "$nodata" && { echo "negative control setup: the data route was not cut out of sw.js"; exit 1; }
grep -q "if (isDataFile(url))" "$nodata" && { echo "negative control setup: sw.js still routes data files"; exit 1; }
if node test-sw.cjs "$nodata" > "$nodata.out" 2>&1; then
  echo "negative control (sw.js without its data route): DID NOT FAIL"
  rm -f "$nodata" "$nodata.out"
  exit 1
else
  echo "negative control (sw.js without its data route): FAILED as required ->"
  grep -E '^FAIL|failure' "$nodata.out" | head -3 | sed 's/^/      /'
fi
rm -f "$nodata" "$nodata.out"

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
  # The Gen 1 tab's footnotes as the page renders them (webapp/footnotes.js over the registry in gen1-data.js): the protocol
  # lists its sources with the pokered title-loop line under its FACTS.md section and the table under the console's status
  # word, no footnote outside the registry; run on the genuine report here and, below, on a copy of the page whose registry
  # lacks the hold-START line, which must fail.
  g1_footnotes_ok() {
    node -e '
const fs = require("fs");
const un = (s) => s.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "\x27");
let r; try { r = JSON.parse(un(fs.readFileSync(process.argv[1], "utf8"))); } catch (e) { r = { error: "no report: " + e.message }; }
const checks = [
  ["the registry is loaded from the page and the protocol lists five footnotes after the steps, four step lines marked", r.registryLoaded === true && r.footnoteCount === 5 && r.footnoteSteps === 4],
  ["the hold-START footnote is the pokered title-loop line under its FACTS.md section", r.footnoteHoldStart === true],
  ["the table footnote is under EMULATOR-EXACT on GSE and the header carries the status note", r.footnoteStatusGse === true && r.footnoteHeaderStatus === true],
  ["no footnote outside the registry", r.footnoteProblems === 0],
  ["the target line and the schedule A cue carry the block numbers", r.targetInfoMarked === true && r.scheduleMarked === true],
  ["Red\x27s target line carries the off-repository qualifier and the methodology panel says where the derivations are", r.targetInfoMarked === true && r.methodologyVerification === true],
  ["the registry without the hold-START line is reported as NOT IN THE REGISTRY and restored is clean", Array.isArray(r.registryCutProblems) && r.registryCutProblems.length === 1 && /^  \[\^1\] pokered\/engine\/movie\/title\.asm:227-239,266 NOT IN THE REGISTRY \(core\/data\/citations\.json carries no such line of docs\/FACTS\.md\): /.test(r.registryCutProblems[0]) && r.registryRestoredProblems === 0],
  ["the GBA HD prints HARDWARE-VALIDATED 5 of 5, the DMG 5 of 6 with its window, Yellow its pokeyellow lines and EMPIRICAL", r.footnoteStatusGbaHd === true && r.footnoteStatusDmg === true && r.footnoteYellow === true]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL browser (Gen 1 footnotes): " + label); }
if (r.error) { bad++; console.error("FAIL browser (Gen 1 footnotes): " + r.error); }
console.log("browser self-test (Gen 1 TID footnotes): " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s"));
process.exit(bad ? 1 : 0);
' "$1"
  }
  g1_footnotes_ok "$profile.dom"
  # the Gen 2 TID tab's self-test (?g2selftest) in the same profile: its stores and the mode stay in memory too, so the
  # after-probe below covers both tabs
  chrome_dom 8000 "file://$(cd ../webapp && pwd)/index.html?g2selftest" | grep -o '<pre id="g2-selftest">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.dom2"
  # the wizard tab's self-test (?wizselftest) in the same profile: its tables load lazily from webapp/data/ over file://
  # (script elements written by sync-core.sh), its store and the mode stay in memory
  chrome_dom 30000 "file://$(cd ../webapp && pwd)/index.html?wizselftest" | grep -o '<pre id="wz-selftest">.*</pre>' | sed 's/<[^>]*>//g' > "$profile.dom3"
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
  ["seven route-valid targets on red/gse", r.targets === 7],
  ["protocol names the methodology", r.protocolHasMethodology === true],
  ["A cue at 7.133 s", r.scheduleA === "7.133"],
  ["anchor button enabled", r.anchorEnabled === true],
  ["outcome inverted to offset 360", /You hit offset 360, aimed 358: 2 frames late/.test(r.outcome || "")],
  ["correction moved to 233.5 ms", r.correctionAfter === "233.5"],
  ["sample persisted under gse/menu", !!(r.stored && r.stored["gse/menu"] && r.stored["gse/menu"].samples.length === 1)],
  ["blue/dmg targets", JSON.stringify(r.blueDmgTargets) === "[658,994,1003,1028,1513,1810,2105,2248,2304]"],
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
  ["bin 300 described with its window, IDs and methodology, the poll and ID-roll footnotes after it", /^Target: bin 300 \(A down 1201\.\.1204 frames after the visible menu box, aim 1202\.5 = 20\.133 s .*TID 20322 \(\$4F62\), Lucky ID 61052 \(\$EE7C\).*methodology gold\/gbp\/hold-start-v1 \[\^2\] \[\^4\]$/.test(r.targetInfo || "")],
  // the footnotes: ten sources listed after the steps, the pokegold 4-frame poll line under its FACTS.md section, the roll under
  // EMULATOR-EXACT, the RTC lines and the wPlayerID roll, the schedule marked, the registry without the poll line reported and
  // restored clean, the pokecrystal lines of Crystal and EMPIRICAL
  ["the registry is loaded from the page and the protocol lists ten footnotes after the steps, six step lines marked", r.registryLoaded === true && r.footnoteCount === 10 && r.footnoteSteps === 6],
  ["the 4-frame poll footnote is the pokegold main-menu line under its FACTS.md section, the roll under EMULATOR-EXACT, the header with the status note", r.footnotePoll === true && r.footnoteStatusGse === true && r.footnoteHeaderStatus === true],
  ["StartClock and StartRTC and the wPlayerID roll are registry lines, no footnote outside the registry", r.footnoteRtc === true && r.footnoteTidRoll === true && r.footnoteProblems === 0],
  ["the schedule A window and tap lines carry the block numbers", r.scheduleMarked === true],
  ["negative control: the registry without the 4-frame poll line is reported as NOT IN THE REGISTRY, and restored is clean", Array.isArray(r.registryCutProblems) && r.registryCutProblems.length === 1 && /^  \[\^2\] pokegold\/engine\/menus\/main_menu\.asm:142-152 NOT IN THE REGISTRY \(core\/data\/citations\.json carries no such line of docs\/FACTS\.md\): /.test(r.registryCutProblems[0]) && r.registryRestoredProblems === 0],
  ["Crystal on a Game Boy Color cites the pokecrystal title, immunity and Secret ID lines and prints EMPIRICAL with the 14-frame roll", r.crystalFootnotes === true],
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
  # The wizard tab in the browser (webapp/wizard-ui.js): the same page under ?wizselftest, its tables loaded lazily, driven
  # through the tab's own handlers: the Ruby Groudon Method 4 vector at frame 3 from the typed seed 0 with its card, procedure
  # and typed outcome; a flawless Treecko on Emerald's seed 0 with no hit in an hour and the exact first frame stated; the
  # Emerald Route 111 wild vector at frame 7; the design's gate seed 7B0448D1 at frame 0 for a flawless Turtwig with the
  # coin-flip calibration (the target's flips, then a neighbour's moving the calibrated delay 500 -> 503); the Route 222
  # Magnet Pull vector's seed 5D1745D0 at frame 0; the mode wall with a planted practice sample; nothing written to the origin.
  node -e '
const fs = require("fs");
const un = (s) => s.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "\x27");
let r; try { r = JSON.parse(un(fs.readFileSync(process.argv[1] + ".dom3", "utf8"))); } catch (e) { r = { error: "no report from the wizard self-test: " + e.message }; }
const checks = [
  ["the wizard tab is on the page and shares app.js countdown", r.tabPresent === true && r.countdownShared === true],
  ["Ruby resolves to rs/gba/boot-seed-v0, seed 0x5A0, status saying no hardware session", r.rubyModel === "rs/gba/boot-seed-v0" && r.rubyStatus === true && r.rubyFixedSeed === "000005A0"],
  ["A: the Groudon Method 4 vector is the one hit in an hour from the typed seed 0 (frame 3, PID 8E4231B0)", r.groudonRows === 1 && !!r.groudonFirst && r.groudonFirst.frame === 3 && r.groudonFirst.pid === 2386702768 && JSON.stringify(r.groudonFirst.ivs) === "[12,22,24,30,25,27]" && r.groudonExactFirst === 3],
  ["A: the result card names the mon, the IVs, the stats, the seed model and EMPIRICAL", /Groudon L45  PID 8E4231B0  nature Bashful/.test(r.groudonCard || "") && /IVs 12\/22\/24\/30\/25\/27/.test(r.groudonCard || "") && /stats at L45 150\/149\/141\/108\/97\/98/.test(r.groudonCard || "") && /seed model rs\/gba\/boot-seed-v0/.test(r.groudonCard || "") && /EMPIRICAL/.test(r.groudonCard || "")],
  ["A: the procedure is numbered under the seed model and the timer totals the pre-timer plus frame 3", /^Procedure \(rs\/gba\/boot-seed-v0; EMPIRICAL/.test(r.groudonProcedure || "") && /\n6\. /.test(r.groudonProcedure || "") && r.groudonTimerTotal === "00:05.050"],
  ["A: the procedure carries five footnotes, steps 1-5 marked, the registry loaded from the page", r.registryLoaded === true && r.footnoteCount === 5 && r.footnoteMarkers === 5],
  ["A: the seed footnote is the registry line with its FACTS.md section, the timer footnote SYNTHESISED, no problem", r.footnoteRegistryLine === true && r.footnoteSynthesised === true && r.footnoteProblems === 0],
  ["negative control: the registry without the Ruby RTC line is reported as NOT IN THE REGISTRY, and restored is clean", Array.isArray(r.registryCutProblems) && r.registryCutProblems.length === 1 && /^  \[\^2\] pokeruby\/src\/rtc\.c:13,134-140 NOT IN THE REGISTRY \(core\/data\/citations\.json carries no such line of docs\/FACTS\.md\): /.test(r.registryCutProblems[0]) && r.registryRestoredProblems === 0],
  ["A: the typed nature and IVs invert to frame 3 and the sample is stored under the model and mode", /^You hit frame 3, aimed 3: on the frame; 1 candidate/.test(r.groudonOutcome || "") && !!(r.groudonStored && r.groudonStored["ruby/GBA"] && r.groudonStored["ruby/GBA"].samples.length === 1 && r.groudonStored["ruby/GBA"].samples[0].model === "rs/gba/boot-seed-v0" && r.groudonStored["ruby/GBA"].samples[0].mode === "run")],
  ["Emerald seeds 0; a flawless Treecko has no frame in an hour and the exact first frame (34.2 days) is stated", r.emeraldSeed === "00000000" && r.flawlessRows === 0 && /No matching frame within the first 215019 frames \(60:00.000\)/.test(r.flawlessOut || "") && /frame 176562488 from this seed = 34.2 days/.test(r.flawlessOut || "")],
  ["B: the Route 111 wild vector at frame 7 (Trapinch, slot 1) with the slot share in the feasibility", r.wildRows === 1 && !!r.wildFirst && r.wildFirst.frame === 7 && r.wildFirst.pid === 1885610868 && r.wildFirst.slot === 1 && r.wildWanted.dex === 328 && r.wildOutHasShare === true && /Trapinch L20  PID 70642374/.test(r.wildCard || "")],
  ["Platinum resolves to dppt/nds/seed-to-time-v0 with the DS gate stated", r.platinumModel === "dppt/nds/seed-to-time-v0" && r.platinumStatus === true],
  ["C: the gate seed 7B0448D1 at frame 0, hour 4, delay 18641, 2000-01-05 04:59:59, Modest 685011A9 flawless", !!r.gateRow && r.gateRow.seed === "7B0448D1" && r.gateRow.frame === 0 && r.gateRow.hour === 4 && r.gateRow.delay === 18641 && r.gateRow.year === 2000 && r.gateRow.month === 1 && r.gateRow.day === 5 && r.gateRow.minute === 59 && r.gateRow.second === 59 && r.gateRow.pid === "685011A9" && r.gateRow.nature === "Modest" && JSON.stringify(r.gateRow.ivs) === "[31,31,31,31,31,31]"],
  ["C: the search lines count 6 origins -> 68 reachable seeds, all verified", /6 IV origin states after the PID filter -> 68 seeds a clock can produce within 100 frames \(hour byte 0-23\) -> 68 candidates confirmed/.test(r.gateOut || "")],
  ["C: the card and procedure name the clock setting, the model and the coin flips", /Turtwig L5  PID 685011A9  nature Modest/.test(r.gateCard || "") && /2\. DS clock: set 2000-01-05 04:59 and confirm it 5 minutes before/.test(r.gateProcedure || "") && /Poketch coin toss/.test(r.gateProcedure || "") && /dppt\/nds\/seed-to-time-v0/.test(r.gateProcedure || "")],
  ["C: the timer note gives the phases and the minutes before", /Phases: 00:41.964 then 05:17.236; set the clock 5 minutes before/.test(r.gateTimerNote || "")],
  ["C: the target seed own flips identify delay 18641 on the target and leave the calibrated delay", /You hit delay 18641 \(seed 7B0448D1, second \+0\), aimed 18641: on the target; 1 row of 603 match/.test(r.gateOutcome || "") && /Calibrated delay 500 -> 500/.test(r.gateOutcome || "") && /The seed is hit/.test(r.gateOutcome || "")],
  ["C: a neighbour delay flips move the calibrated delay 500 -> 503", /You hit delay 18645 \(seed 7B0448D5, second \+0\), aimed 18641: 4 delays late/.test(r.gateNeighbourOutcome || "") && /Calibrated delay 500 -> 503/.test(r.gateNeighbourOutcome || "") && r.caldAfter === "503"],
  ["D: the Route 222 Magnet Pull vector seed 5D1745D0 at frame 0 (Luxio slot 7 L40, PID 960698807)", r.wild4Slot7 === 404 && !!r.wild4Row && r.wild4Row.seed === "5D1745D0" && r.wild4Row.frame === 0 && r.wild4Row.pid === 960698807 && r.wild4Row.slot === 7 && r.wild4Row.level === 40 && /confirmed by the wild generator frame by frame/.test(r.wild4Out || "")],
  ["RUN is the default; PRACTICE / HUNT through the switch shows the banner and its own store", r.modeDefault === "run" && r.modeAfterToggle === "practice" && r.bannerShown === true && /PRACTICE \/ HUNT mode \(store shinySolution.wizard.calibration.practice\)/.test(r.timerNoteInPractice || "") && r.caldInPracticeBefore === "500"],
  ["the practice sample is stamped, stored under the practice key, and the RUN store is untouched", /You hit delay 18645/.test(r.practiceOutcome || "") && !!(r.practiceStored && r.practiceStored["platinum/NDS_SLOT1"] && r.practiceStored["platinum/NDS_SLOT1"].samples.length === 1 && r.practiceStored["platinum/NDS_SLOT1"].samples[0].mode === "practice") && r.runStoreUnchangedByPractice === true],
  ["back in RUN the RUN calibration is in force (503) and a planted practice sample is named, never in force", r.modeBack === "run" && r.caldBackInRun === "503" && r.runNoteAboutPractice === true && r.caldWithPlanted === "503"],
  ["the self-test never wrote the wizard stores or the mode to the origin", !!r.realStorage && r.realStorage["shinySolution.wizard.calibration"] === null && r.realStorage["shinySolution.wizard.calibration.practice"] === null && r.realStorage["shinySolution.mode"] === null]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL browser (wizard): " + label); }
if (r.error) { bad++; console.error("FAIL browser (wizard): " + r.error); }
console.log("browser self-test (wizard tab): " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s"));
fs.unlinkSync(process.argv[1] + ".dom3");
process.exit(bad ? 1 : 0);
' "$profile"
  # Negative control: the page served with a registry copy without the Gen 1 hold-START line (window.ShinyCitations in a copy's
  # gen1-data.js rewritten without that entry) must FAIL the Gen 1 footnote checks above, and is shown failing: the page then
  # prints NOT IN THE REGISTRY for that footnote, and the check reads the footnotes the page renders.
  cut=$(mktemp -d)
  cp -r ../webapp/. "$cut/webapp"
  node -e '
const fs = require("fs");
const p = process.argv[1];
const src = fs.readFileSync(p, "utf8");
const key = "window.ShinyCitations = ";
const at = src.indexOf(key);
if (at < 0) { console.error("negative control setup: gen1-data.js carries no window.ShinyCitations"); process.exit(1); }
const reg = JSON.parse(src.slice(at + key.length).replace(/;\n$/, ""));
const before = reg.entries.length;
reg.entries = reg.entries.filter((e) => e.cite !== "pokered/engine/movie/title.asm:227-239,266");
if (reg.entries.length !== before - 1) { console.error("negative control setup: the Gen 1 hold-START line is not in the registry"); process.exit(1); }
fs.writeFileSync(p, src.slice(0, at) + key + JSON.stringify(reg) + ";\n");
' "$cut/webapp/gen1-data.js"
  grep -q 'pokered/engine/movie/title.asm:227-239,266' "$cut/webapp/gen1-data.js" && { echo "negative control setup: the hold-START line is still in the copy"; exit 1; }
  cutprofile=$(mktemp -d)
  timeout 120 google-chrome --headless=new --disable-gpu --user-data-dir="$cutprofile" --virtual-time-budget=5000 --dump-dom "file://$cut/webapp/index.html?g1selftest" 2>/dev/null | grep -o '<pre id="g1-selftest">.*</pre>' | sed 's/<[^>]*>//g' > "$cut/dom"
  if g1_footnotes_ok "$cut/dom" > "$cut/out" 2>&1; then
    echo "negative control (the page with the registry without the Gen 1 hold-START line): DID NOT FAIL"
    rm -rf "$cut" "$cutprofile"
    exit 1
  else
    echo "negative control (the page with the registry without the Gen 1 hold-START line): FAILED as required ->"
    grep -E '^FAIL' "$cut/out" | head -3 | sed 's/^/      /'
  fi
  rm -rf "$cut" "$cutprofile"
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
  # The mobile bundle as the Hub app's WebView sees it: the bundle's HTML written to a file and loaded from file:// with an
  # Android WebView user agent at a phone's 360x780, no service worker registered and the status line saying why (the
  # reason the builder wrote, with the build stamp), the wizard tab saying its tables are not in this build, every tab's
  # button on the page and no uncaught error (the page's error hook writes them into #page-errors, hidden while empty).
  wv=$(mktemp -d)
  node ../webapp/build-mobile-bundle.mjs "$wv/bundle.ts" > /dev/null
  node -e '
const fs = require("fs");
const ts = fs.readFileSync(process.argv[1], "utf8");
const m = ts.match(/^export const shinySolutionHtml = ([\s\S]*);\n$/);
if (!m) { console.error("the bundle is not one exported HTML string"); process.exit(1); }
fs.writeFileSync(process.argv[2], JSON.parse(m[1]));
' "$wv/bundle.ts" "$wv/bundle.html"
  # the DOM goes to a file: under pipefail an echo of a 1.9 MB DOM into grep -q dies of SIGPIPE once grep has matched
  timeout 120 google-chrome --headless=new --disable-gpu --user-data-dir="$wv/profile" --window-size=360,780 \
    --user-agent="Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 wv" \
    --virtual-time-budget=5000 --dump-dom "file://$wv/bundle.html" > "$wv/dom.html" 2>/dev/null || true
  stamp=$(grep -o 'window.SHINY_BUILD = "[0-9a-f]*"' ../webapp/index.html | grep -o '[0-9a-f]\{12\}')
  wbad=0
  [ -s "$wv/dom.html" ] || { echo "FAIL WebView bundle: headless Chrome returned no DOM"; wbad=1; }
  grep -qF "<p id=\"sw-status\">offline copy: not registered: the mobile bundle is one HTML string for the Hub app, with no sw.js beside it (build $stamp)</p>" "$wv/dom.html" || { echo "FAIL WebView bundle: the status line does not say why the offline copy is not registered, with the build stamp"; wbad=1; }
  grep -q 'serviceWorker\.register(' "$wv/dom.html" && { echo "FAIL WebView bundle: a service worker registration is in the page"; wbad=1; }
  grep -qE '<pre id="page-errors" class="text" hidden(="")?></pre>' "$wv/dom.html" || { echo "FAIL WebView bundle: #page-errors is not empty and hidden"; grep -o '<pre id="page-errors"[^<]*' "$wv/dom.html" | head -3; wbad=1; }
  grep -q 'id="wz-status"[^>]*>this build carries no species, encounter or static tables (the mobile bundle inlines no species, encounter or static tables): the wizard needs the static page or the Electron app' "$wv/dom.html" || { echo "FAIL WebView bundle: the wizard tab does not say its tables are not in this build"; wbad=1; }
  for tab in g3timer g3check g4 g12 g1tid g2tid wizard about; do grep -q "data-tab=\"$tab\"" "$wv/dom.html" || { echo "FAIL WebView bundle: no button for tab $tab"; wbad=1; }; done
  rm -rf "$wv"
  [ $wbad = 0 ] || exit 1
  echo "mobile bundle in a WebView (360x780, Android UA): no worker, the status line names the reason and build $stamp, no page error, the wizard says its tables are not in this build, 8 tab buttons"
  # The phone layout at a true 360x780 (the static page in a 360 px iframe: headless Chrome opens no window that narrow):
  # the tab bar is one row that scrolls inside its own box (every button on one line, the bar under 60 px tall, its
  # scrollWidth wider than its box), the document is no wider than the viewport, and what follows the bar (the mode bar,
  # then the first card) starts within 60 px of the bar's top edge, and on the Gen 1 TID tab the reset metronome's Start
  # and the SID card's ANCHOR button (the two step controls outside the find / anchor rows) are 48 px tall in a sticky
  # row like every .row.primary; the numbers come from a probe appended to a copy of index.html and posted to the host page.
  ph=$(mktemp -d)
  cp -r ../webapp/. "$ph/webapp"
  node -e '
const fs = require("fs");
const p = process.argv[1];
const probe = "<script>\nwindow.addEventListener(\"load\", function () {\n  var r = function (el) { var b = el.getBoundingClientRect(); return { top: Math.round(b.top + window.scrollY), height: Math.round(b.height), width: Math.round(b.width) }; };\n  var tabs = document.getElementById(\"tabs\");\n  var out = { viewport: [window.innerWidth, window.innerHeight], docScrollWidth: document.documentElement.scrollWidth, tabs: r(tabs), tabsScrollWidth: tabs.scrollWidth, tabsClientWidth: tabs.clientWidth, buttonTops: Array.prototype.map.call(tabs.querySelectorAll(\"button\"), function (b) { return r(b).top; }), next: r(tabs.nextElementSibling), firstCard: r(document.querySelector(\".tab.active .card\")) };\n  tabs.querySelector(\"button[data-tab=g1tid]\").click();\n  out.controls = [\"g1-reset-start\", \"sid-cue-btn\"].map(function (id) { var el = document.getElementById(id); return { id: id, height: r(el).height, sticky: getComputedStyle(el.parentElement).position === \"sticky\" }; });\n  window.parent.postMessage(JSON.stringify(out), \"*\");\n});\n</script>\n</body>";
const src = fs.readFileSync(p, "utf8");
if (src.split("</body>").length !== 2) { console.error("phone layout setup: index.html has not exactly one </body>"); process.exit(1); }
fs.writeFileSync(p, src.replace("</body>", probe));
' "$ph/webapp/index.html"
  printf '%s' '<!doctype html><html><body style="margin:0"><iframe src="webapp/index.html" style="width:360px;height:780px;border:0"></iframe><pre id="measure"></pre><script>window.addEventListener("message", function (e) { document.getElementById("measure").textContent = String(e.data); });</script></body></html>' > "$ph/host.html"
  timeout 120 google-chrome --headless=new --disable-gpu --user-data-dir="$ph/profile" --window-size=500,900 --virtual-time-budget=4000 --dump-dom "file://$ph/host.html" 2>/dev/null | grep -o '<pre id="measure">.*</pre>' | sed 's/<[^>]*>//g' > "$ph/measure"
  node -e '
const fs = require("fs");
const un = (s) => s.replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
let m; try { m = JSON.parse(un(fs.readFileSync(process.argv[1], "utf8"))); } catch (e) { console.error("FAIL phone layout: no measurement: " + e.message); process.exit(1); }
const checks = [
  ["a true 360x780 viewport", m.viewport[0] === 360 && m.viewport[1] === 780],
  ["the document is no wider than the viewport", m.docScrollWidth <= 360],
  ["the tab bar is one row under 60 px", m.tabs.height < 60 && m.buttonTops.every((t) => t === m.buttonTops[0])],
  ["the tab bar scrolls inside its own box", m.tabsScrollWidth > m.tabsClientWidth && m.tabs.width <= 360],
  ["what follows the tab bar starts within 60 px of its top", m.next.top - m.tabs.top < 60],
  ["the Gen 1 reset metronome Start and the SID ANCHOR button are 48 px tall in a sticky row", Array.isArray(m.controls) && m.controls.length === 2 && m.controls.every((c) => c.height >= 48 && c.sticky)]
];
let bad = 0;
for (const [label, ok] of checks) if (!ok) { bad++; console.error("FAIL phone layout: " + label + " " + JSON.stringify(m)); }
console.log("phone layout at 360x780: " + checks.length + " checks, " + bad + " failure" + (bad === 1 ? "" : "s") + " (tab bar " + m.tabs.height + " px tall at " + m.tabs.top + " px, " + m.tabsScrollWidth + " px wide inside a " + m.tabsClientWidth + " px box, the mode bar " + (m.next.top - m.tabs.top) + " px and the first card " + (m.firstCard.top - m.tabs.top) + " px below its top, document " + m.docScrollWidth + " px wide)");
process.exit(bad ? 1 : 0);
' "$ph/measure"
  rm -rf "$ph"
else
  # Round 6 finding F: the browser self-test is the only check of the rendered page, and skipping it
  # quietly let the banner claim a complete run.
  guard_degraded "the browser self-test (the web head rendered in Chrome: tabs, panels, the phone layout)" \
    "google-chrome not found: nothing rendered the web head in a real browser"
fi

# ---- the summary: a run that could not run a guard says so, and does not pass quietly ----------
echo
if [ -s "$DEGRADED_LOG" ]; then
  n=$(wc -l < "$DEGRADED_LOG")
  echo "!!! $n GUARD(S) COULD NOT RUN IN THIS SUITE - IT DID NOT CHECK WHAT THEY CHECK !!!"
  cat "$DEGRADED_LOG"
  if [ "${SHINY_ALLOW_DEGRADED_GUARDS:-0}" = "1" ]; then
    echo "TESTS PASSED, NEGATIVE CONTROLS FAILED AS REQUIRED, BUT $n GUARD(S) DID NOT RUN (accepted: SHINY_ALLOW_DEGRADED_GUARDS=1)"
    exit 0
  fi
  echo "SUITE INCOMPLETE: $n guard(s) did not run. Fix the cause, or accept an unchecked run with SHINY_ALLOW_DEGRADED_GUARDS=1."
  exit 1
fi
# Round 6 finding F: this line used to be reachable with the whole C# half, the citation
# regeneration (and its two negative controls) or the browser self-test never run, because those
# three branches announced their skip with a plain echo that DEGRADED_LOG never saw.
echo "ALL TESTS PASSED, ALL NEGATIVE CONTROLS FAILED AS REQUIRED, EVERY GUARD IN THIS SUITE RAN"
