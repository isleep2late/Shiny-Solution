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

# SeedTime4.cs (Gen 4 seed-to-time, calibrate rows, advance planner, PKHeX-semantics LCRNG reversal, the
# reachability search) against the same vectors the JS suite checks (tests/seedtime4-vectors.json).
dotnet run --project app/Tests -c Release --no-build -- --seedtime4 tests/seedtime4-vectors.json

# Negative control: a corrupted vector (one PokeFinder delay, one reversal seed, one coin-flip letter, one
# roamer route) must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/seedtime4-vectors.json "$corrupted" <<'PY2'
import json, sys
v = json.load(open(sys.argv[1]))
v["seedToTimes"][0]["results"][2]["delay"] += 1
v["lcrngReverse"]["ivs"][0]["expected"][1] ^= 1
row = v["calibrate"][0]["rows"][0]; row["sequence"] = ("T" if row["sequence"][0] == "H" else "H") + row["sequence"][1:]
v["roamer"][0]["expected"]["skips"] += 1
json.dump(v, open(sys.argv[2], "w"))
PY2
if dotnet run --project app/Tests -c Release --no-build -- --seedtime4 "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted seedtime4 vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted seedtime4 vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -5 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"
