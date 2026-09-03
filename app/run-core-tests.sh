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

# Negative control: a corrupted vector must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/gen1tid-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
v["tables"][0]["samples"][3][1] += 1
v["jitter"]["hitProbability"][9]["p"] += 1e-6
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen1tid "$corrupted" . > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen1tid vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen1tid vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"
