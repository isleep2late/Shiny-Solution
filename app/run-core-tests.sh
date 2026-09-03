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

# The desktop Gen 2 TID panel's pure part (app/App/Gen2TidSupport.cs, compiled into the test project) against
# tests/gen2tid-panel-vectors.json, emitted from the web app's Gen 2 TID tab by tools/gen-gen2-panel-vectors.cjs: 20 target
# inputs (the schedule's every cue, the schedule and protocol text, the typed outcome), the bin guards and the mode split.
dotnet run --project app/Tests -c Release --no-build -- --gen2tid-panel tests/gen2tid-panel-vectors.json

# Negative control: a corrupted copy (one A cue moved by 1e-6 s, one outcome's hit bin bumped, the RUN correction with the
# practice sample averaged in) must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/gen2tid-panel-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
c = next(x for x in v["cases"] if "schedule" in x)
c["schedule"]["tA"] += 1e-6
c["outcome"]["hitBin"] += 1
g = v["guards"]
s = g["store"]["gse/menu"]["samples"]
assert s[-1]["mode"] == "practice", "negative control setup: the last guard sample is not the practice one"
imp = [x["implied_ms"] for x in s]
g["runCorrection"] = sum(imp) / len(imp)
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen2tid-panel "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted gen2tid panel vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted gen2tid panel vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -4 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# The desktop wizard panel's pure part (app/App/WizardSupport.cs, compiled into the test project) against
# tests/wizard-panel-vectors.json, emitted from the web app's wizard tab by tools/gen-wizard-panel-vectors.cjs: the three
# self-test scenarios (Groudon Method 4 at frame 3 with the typed outcome, the flawless Emerald limit, Route 111 at frame 7,
# the gate seed 7B0448D1 at frame 0 with the coin flips and 500 -> 503, Route 222 Magnet Pull) and 20 random wanted-IV
# searches: the hit / row lists, the cards, the procedures, the search lines, the store split, JavaScript's number formats.
dotnet run --project app/Tests -c Release --no-build -- --wizard-panel tests/wizard-panel-vectors.json

# Negative control: a corrupted copy (one Gen 3 hit's PID bumped, one Gen 4 row's delay bumped, one feasibility line's number
# changed, the RUN value in force replaced by the practice sample's) must FAIL, and is shown failing.
corrupted=$(mktemp --suffix=.json)
python3 - tests/wizard-panel-vectors.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
s = v["scenarios"]
h = s["groudon"]["hits"][0].split("|"); h[1] = "%08X" % ((int(h[1], 16) + 1) & 0xFFFFFFFF); s["groudon"]["hits"][0] = "|".join(h)
r = s["gate"]["rows"][0].split("|"); r[3] = str(int(r[3]) + 1); s["gate"]["rows"][0] = "|".join(r)
assert s["flawless"]["lines"][2].startswith("Feasibility: about 0.000140"), "negative control setup: the flawless feasibility line changed"
s["flawless"]["lines"][2] = s["flawless"]["lines"][2].replace("0.000140", "0.000141", 1)
st = v["store"]
assert st["practice"]["value"]["calibratedDelay"] == 560, "negative control setup: the practice value is not 560"
st["run"]["value"] = dict(st["practice"]["value"])
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --wizard-panel "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (corrupted wizard panel vectors, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (corrupted wizard panel vectors, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -5 | sed 's/^/      /'
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: the citation registry with the Ruby RTC entry removed (the file given in place of the embedded copy)
# must FAIL the same check, and is shown failing: the procedure's seed footnote then says NOT IN THE REGISTRY and no
# longer matches the web tab's line.
corrupted=$(mktemp --suffix=.json)
python3 - core/data/citations.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
before = len(v["entries"])
v["entries"] = [e for e in v["entries"] if e["cite"] != "pokeruby/src/rtc.c:13,134-140"]
assert len(v["entries"]) == before - 1, "negative control setup: the Ruby RTC entry is not in the registry"
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --wizard-panel tests/wizard-panel-vectors.json "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (citation registry without the Ruby RTC line, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (citation registry without the Ruby RTC line, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /' | cut -c1-260
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: the citation registry without the Gen 1 hold-START line (the pokered title loop, the first footnote of
# every Gen 1 protocol) given to the Gen 1 checks must FAIL, and is shown failing: the panel then prints NOT IN THE REGISTRY
# for that footnote and the pinned line no longer matches.
corrupted=$(mktemp --suffix=.json)
python3 - core/data/citations.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
before = len(v["entries"])
v["entries"] = [e for e in v["entries"] if e["cite"] != "pokered/engine/movie/title.asm:227-239,266"]
assert len(v["entries"]) == before - 1, "negative control setup: the Gen 1 hold-START entry is not in the registry"
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen1tid tests/gen1tid-vectors.json . "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (citation registry without the Gen 1 hold-START line, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (citation registry without the Gen 1 hold-START line, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /' | cut -c1-260
fi
rm -f "$corrupted" "$corrupted.out"

# Negative control: the registry without the Gen 2 4-frame poll line (pokegold's MainMenuJoypadLoop) given to the Gen 2 panel
# check must FAIL, and is shown failing: the panel's protocol then prints NOT IN THE REGISTRY and no longer matches the web tab's.
corrupted=$(mktemp --suffix=.json)
python3 - core/data/citations.json "$corrupted" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
before = len(v["entries"])
v["entries"] = [e for e in v["entries"] if e["cite"] != "pokegold/engine/menus/main_menu.asm:142-152"]
assert len(v["entries"]) == before - 1, "negative control setup: the Gen 2 poll entry is not in the registry"
json.dump(v, open(sys.argv[2], "w"))
PY
if dotnet run --project app/Tests -c Release --no-build -- --gen2tid-panel tests/gen2tid-panel-vectors.json "$corrupted" > "$corrupted.out" 2>&1; then
  echo "negative control (citation registry without the Gen 2 poll line, C#): DID NOT FAIL"
  rm -f "$corrupted" "$corrupted.out"
  exit 1
else
  echo "negative control (citation registry without the Gen 2 poll line, C#): FAILED as required ->"
  grep -E '^FAIL|failure' "$corrupted.out" | head -3 | sed 's/^/      /' | cut -c1-260
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
