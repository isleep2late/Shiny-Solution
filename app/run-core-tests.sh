#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$PATH"
python3 tests/reference.py > tests/vectors.json
dotnet run --project app/Tests -c Release -- tests/vectors.json
dotnet run --project app/Tests -c Release -- --check-timer-vectors tests/timer-vectors.json
dotnet run --project app/Tests -c Release -- --gen5 tests/gen5-vectors.json
dotnet run --project app/Tests -c Release -- --generators tests/generators-vectors.json

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

# Negative control: a corrupted Gen 5 vector (one TID row bumped by 1, one LCRNG64 step moved by 1) must FAIL, and is
# shown failing. (--check-timer-vectors carries its own corrupted-vector control and prints it.)
corrupted=$(mktemp --suffix=.json)
python3 - tests/gen5-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
v["ids"][0]["rows"][0]["tid"] += 1
v["lcrng64"]["next"][0]["forward"] = str(int(v["lcrng64"]["next"][0]["forward"]) + 1)
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen5 "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen5 vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen5 vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: a corrupted generator vector (one PokeFinder PID bumped by 1, one IV bit flipped) must FAIL, and is
# shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/generators-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
s = v["static3"][0]["results"][0]; w = v["wild3"][0]["results"][0]
assert isinstance(s["pid"], int) and isinstance(w["ivs"], list), "negative control setup: static3[0].results[0].pid or wild3[0].results[0].ivs is missing"
s["pid"] = (s["pid"] + 1) % 2**32
w["ivs"][0] ^= 1
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --generators "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted generator vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted generator vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failed' "$corrupted.out" | head -3 | sed 's/^/      /'
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

# Gen2Tid.cs (Gen 2 Trainer ID / Lucky ID: bins, lookups across the RTC states, inversion, targets, schedules, calibration,
# verify) against tests/gen2tid-vectors.json (emitted by tests/gen2_reference.py from the derivation CSVs).
dotnet run --project app/Tests -c Release --no-build -- --gen2tid tests/gen2tid-vectors.json .

# Negative control: a corrupted vector must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/gen2tid-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
v["lookups"][5]["tid"] += 1
s = next(x for x in v["schedules"] if "result" in x)
s["result"]["tA"] += 1e-6
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen2tid "$corrupted" . > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen2tid vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen2tid vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"
