#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$PATH"
python3 tests/reference.py > tests/vectors.json
dotnet run --project app/Tests -c Release -- tests/vectors.json

# Gen1Tid.cs (Gen 1 Trainer ID cue model, reset metronome, verify, Gen 3 typed-TID -> SID, press jitter)
# against the same vectors the JS suite checks (tests/gen1tid-vectors.json, emitted by RNG Solution's Python).
dotnet run --project app/Tests -c Release --no-build -- --gen1tid tests/gen1tid-vectors.json .

# Negative control: a corrupted vector (a table TID, a P(hit), and an error case renamed to another exception
# class) must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/gen1tid-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
v["tables"][0]["samples"][3][1] += 1
v["jitter"]["hitProbability"][9]["p"] += 1e-6
assert v["parseTid"][6]["error"] == "ValueError", "negative control setup: parseTid[6] is not the ValueError case"
v["parseTid"][6]["error"] = "OutlierSample"
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen1tid "$corrupted" . > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen1tid vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen1tid vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -4 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# The RUN / PRACTICE-HUNT wall's pure part (Core Modes over the calibration maths, the composition the Gen 1 TID
# panel performs) on tests/mode-wall-fixture.json: RUN's correction is the mean of the RUN samples only.
dotnet run --project app/Tests -c Release --no-build -- --mode-wall tests/mode-wall-fixture.json

# Negative control: the practice sample restamped 'run' (a practice-derived value labelled as a run's) must FAIL
# the RUN checks, and is shown failing: the wall rests on the stamp and the store split, and the check sees it.
corrupted=$(mktemp --suffix=.json)
python3 - tests/mode-wall-fixture.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
s = v["store"]["gse/menu"]["samples"]
assert s[2]["mode"] == "practice", "negative control setup: sample 2 is not the practice sample"
s[2]["mode"] = "run"
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --mode-wall "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (a practice sample used in RUN mode, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (a practice sample used in RUN mode, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -4 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"
