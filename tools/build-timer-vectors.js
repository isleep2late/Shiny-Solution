#!/usr/bin/env node
// Builds tests/timer-vectors.json by running EonTimer's OWN compiled TypeScript, so every
// expected value in the file is EonTimer's answer, not this repository's.
//
//   node tools/build-timer-vectors.js <eontimer-dist> [out.json]
//
//   <eontimer-dist>  a directory holding EonTimer's src/timers and src/utils compiled to CommonJS
//                    (<eontimer-dist>/timers/*.js, <eontimer-dist>/utils/*.js); recipe below
//   out.json         defaults to tests/timer-vectors.json of this repository
//
// Reproduction (what produced the committed file):
//   git clone https://github.com/DasAmpharos/EonTimer /tmp/EonTimer
//   git -C /tmp/EonTimer checkout ad10886d83bc455ad208c82925610c642d9e8864      # main, 2026-04-20
//   mkdir -p /tmp/eontimer-run/src
//   cp -r /tmp/EonTimer/src/timers /tmp/EonTimer/src/utils /tmp/eontimer-run/src/
//     (those two folders import only each other; no Vue, store or UI code is needed)
//   cat > /tmp/eontimer-run/tsconfig.json <<'EOF'
//   { "compilerOptions": { "target": "ES2020", "module": "CommonJS", "outDir": "dist", "strict": false, "esModuleInterop": true, "skipLibCheck": true, "types": [] }, "include": ["src/**/*.ts"] }
//   EOF
//   (cd /tmp/eontimer-run && npx -y -p typescript@5.9.3 tsc -p tsconfig.json)   # writes dist/timers, dist/utils
//   node tools/build-timer-vectors.js /tmp/eontimer-run/dist
//   git diff --exit-code -- tests/timer-vectors.json                            # empty: byte-identical
//
// Byte-identity holds under node v18.19.1: the provenance header embeds process.version, so a
// different node prints a different header line while every vector stays the same (compare the
// "vectors" array if cmp differs only there).
//
// The 47 vectors whose ids start with "py-" are transcribed from the literal assertions of
// EonTimer's Python unit tests (branch 3.x-python @ 13d15f72b1476e459bf7ad8c38c6f7abfc9193c9,
// test/timers/*.py; each vector cites its lines). Each is ALSO evaluated by the compiled
// TypeScript: every Python/TS disagreement is printed and counted, the count is written into
// the provenance header (0 in the committed file) and makes this script exit 1, so a py-
// vector's "expect" is always the TS result with the Python literal as a second witness.
// The other 422 vectors are EonTimer's per-console default settings (src/store/index.ts:121-154),
// custom frame rates, the unknown-console default branch, the minimum-length variants, the
// half-to-even rounding edges and the per-function pieces; every id cites the TS lines it runs.
const fs = require("fs");
const path = require("path");
const DIST = process.argv[2];
if (!DIST) { console.error("usage: node tools/build-timer-vectors.js <eontimer-dist> [out.json]"); process.exit(2); }
const dist = (p) => require(path.resolve(DIST, p));
const C = dist("timers/calibrator.js");
const K = dist("utils/constants.js");
const T = dist("utils/types.js");
const F = dist("timers/frameTimer.js");
const S = dist("timers/secondTimer.js");
const D = dist("timers/delayTimer.js");
const E = dist("timers/entralinkTimer.js");
const G3 = dist("timers/gen3Timer.js");
const G4 = dist("timers/gen4Timer.js");
const G5 = dist("timers/gen5Timer.js");
const CU = dist("timers/customTimer.js");

const CONSOLE_MAP = { GBA: T.Console.GBA, NDS_SLOT1: T.Console.NDS_SLOT1, NDS_SLOT2: T.Console.NDS_SLOT2, DSI: T.Console.DSI, "3DS": T.Console.THREE_DS, CUSTOM: T.Console.CUSTOM };
const G3MODE = { STANDARD: T.Gen3Mode.STANDARD, VARIABLE_TARGET: T.Gen3Mode.VARIABLE_TARGET };
const G5MODE = { STANDARD: T.Gen5Mode.STANDARD, C_GEAR: T.Gen5Mode.C_GEAR, ENTRALINK: T.Gen5Mode.ENTRALINK, ENTRALINK_PLUS: T.Gen5Mode.ENTRALINK_PLUS };
const UNIT = { ms: T.CustomUnit.MILLISECONDS, advances: T.CustomUnit.ADVANCES, hex: T.CustomUnit.HEX };

function S_(console, customFps, precision, minLen) {
  return { console: console, customFps: customFps === undefined ? 60 : customFps, precisionCalibration: !!precision, minimumLengthMs: minLen === undefined ? 14000 : minLen };
}
function eon(s) {
  // Own-property lookup: a name CONSOLE_MAP does not own (incl. Object.prototype keys such as
  // "constructor") is passed through as-is so EonTimer's switch takes its default branch.
  const c = Object.prototype.hasOwnProperty.call(CONSOLE_MAP, s.console) ? CONSOLE_MAP[s.console] : s.console;
  return { console: c, customFramerate: s.customFps, precisionCalibration: s.precisionCalibration, minimumLength: s.minimumLengthMs };
}
function enc(v) {
  if (v === Infinity) return "Infinity";
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return o; }
  return v;
}
const vectors = [];
let mismatches = 0;
function add(id, source, fn, settings, args, expect, pyExpect) {
  if (pyExpect !== undefined && JSON.stringify(enc(expect)) !== JSON.stringify(enc(pyExpect))) {
    mismatches++;
    console.error("PYTHON/TS MISMATCH", id, "ts=", JSON.stringify(enc(expect)), "py=", JSON.stringify(enc(pyExpect)));
  }
  vectors.push({ id, source, fn, settings, args: enc(args), expect: enc(expect) });
}
const TS = "EonTimer main ad10886 ";
const PY = "EonTimer 3.x-python 13d15f7 ";

// Dispatcher over EonTimer's own functions using MY api names/arg order.
function run(fn, s, args) {
  const e = s ? eon(s) : null;
  switch (fn) {
    case "toDelays": return C.toDelays(e, args[0]);
    case "toMilliseconds": return C.toMilliseconds(e, args[0]);
    case "calibrateToDelays": return C.calibrateToDelays(e, args[0]);
    case "calibrateToMilliseconds": return C.calibrateToMilliseconds(e, args[0]);
    case "createCalibration": return C.createCalibration(e, args[0], args[1]);
    case "toMinimumLength": return K.toMinimumLength(args[0], args[1]);
    case "minutesBeforeTarget": return K.getMinutesBeforeTarget(args[0].map(x => x === "Infinity" ? Infinity : x));
    case "framePhases": return F.createFramePhases(e, args[0], args[1], args[2]);
    case "calibrateFrame": return F.calibrateFrame(e, args[0], args[1]);
    case "variableFramePhases": return F.createVariableFramePhases(args[0]);
    case "secondPhases": return S.createSecondPhases(args[0], args[1], args[2]);
    case "calibrateSecond": return S.calibrateSecond(args[0], args[1]);
    case "delayPhases": return D.createDelayPhases(e, args[0], args[1], args[2]);
    case "calibrateDelay": return D.calibrateDelay(e, args[0], args[1]);
    case "entralinkPhases": return E.createEntralinkPhases(e, args[0], args[1], args[2], args[3]);
    case "enhancedEntralinkPhases": return E.createEnhancedEntralinkPhases(e, args[0], args[1], args[2], args[3], args[4], args[5]);
    case "calibrateEntralinkAdvances": return E.calibrateEntralinkAdvances(args[0], args[1]);
    case "gen3Phases": return G3.createGen3Phases(e, Object.assign({}, args[0], { mode: G3MODE[args[0].mode] }));
    case "calibrateGen3": return G3.calibrateGen3(e, Object.assign({}, args[0], { mode: G3MODE[args[0].mode] }), args[1]);
    case "gen4Phases": return G4.createGen4Phases(e, args[0]);
    case "gen4MinutesBefore": return G4.getGen4MinutesBeforeTarget(e, args[0]);
    case "calibrateGen4": return G4.calibrateGen4(e, args[0], args[1]);
    case "gen5Phases": return G5.createGen5Phases(e, Object.assign({}, args[0], { mode: G5MODE[args[0].mode] }));
    case "gen5MinutesBefore": return G5.getGen5MinutesBeforeTarget(e, Object.assign({}, args[0], { mode: G5MODE[args[0].mode] }));
    case "calibrateGen5": return G5.calibrateGen5(e, Object.assign({}, args[0], { mode: G5MODE[args[0].mode] }), args[1]);
    case "customPhases": return CU.createCustomPhases(e, args[0].map(p => ({ unit: UNIT[p.unit], target: p.target, calibration: p.calibration })));
    case "calibrateCustomPhase": return CU.calibrateCustomPhase(e, { unit: UNIT[args[0].unit], target: args[0].target, calibration: args[0].calibration }, args[1]);
    default: throw new Error("unknown fn " + fn);
  }
}
function V(id, source, fn, settings, args, pyExpect) { add(id, source, fn, settings, args, run(fn, settings, args), pyExpect); }

// ---------- A. Transcribed from EonTimer's Python unit tests (fps=1000 -> 1 ms/frame) ----------
const P1000 = S_("CUSTOM", 1000);
[[1.25, 1], [1.5, 2], [1.75, 2], [2.5, 2], [3.5, 4], [1.0, 1], [2.0, 2], [3.0, 3]].forEach(([ms, exp], i) =>
  V("py-calibrator-toDelays-" + ms, PY + "test/timers/calibrator_test.py:" + (14 + i + (i >= 5 ? 1 : 0)), "toDelays", P1000, [ms], exp)); // :19 is the "whole frames" comment
[[1, 1], [2, 2], [3, 3]].forEach(([d, exp], i) => V("py-calibrator-toMs-1000fps-" + d, PY + "test/timers/calibrator_test.py:" + (26 + i), "toMilliseconds", P1000, [d], exp));
const P15 = S_("CUSTOM", 1000 / 1.5);
[[1, 2], [2, 3], [3, 4]].forEach(([d, exp], i) => V("py-calibrator-toMs-1.5ms-" + d, PY + "test/timers/calibrator_test.py:" + (31 + i), "toMilliseconds", P15, [d], exp));
const P500 = S_("CUSTOM", 500);
[[1, 2], [2, 4], [3, 6]].forEach(([d, exp], i) => V("py-calibrator-toMs-500fps-" + d, PY + "test/timers/calibrator_test.py:" + (36 + i), "toMilliseconds", P500, [d], exp));
V("py-frame-create", PY + "test/timers/frame_timer_test.py:16-17", "framePhases", P1000, [5000, 1000, 0], [5000, 1000]);
V("py-frame-calibrate-equal", PY + "test/timers/frame_timer_test.py:21-22", "calibrateFrame", P1000, [0, 0], 0);
V("py-frame-calibrate-early", PY + "test/timers/frame_timer_test.py:24-25", "calibrateFrame", P1000, [1000, 950], 50);
V("py-frame-calibrate-late", PY + "test/timers/frame_timer_test.py:27-28", "calibrateFrame", P1000, [1000, 1050], -50);
V("py-variable-frame-create", PY + "test/timers/frame_timer_test.py:37-38", "variableFramePhases", null, [5000], [5000, Infinity]);
V("py-second-create-below-min", PY + "test/timers/second_timer_test.py:12-13", "secondPhases", null, [1, 0, 14000], [61200]);
V("py-second-create-above-min", PY + "test/timers/second_timer_test.py:15-16", "secondPhases", null, [50, 0, 14000], [50200]);
V("py-second-calibrate-equal", PY + "test/timers/second_timer_test.py:20-21", "calibrateSecond", null, [1, 1], 0);
V("py-second-calibrate-early", PY + "test/timers/second_timer_test.py:23-24", "calibrateSecond", null, [1, 0], 500);
V("py-second-calibrate-late", PY + "test/timers/second_timer_test.py:26-27", "calibrateSecond", null, [1, 2], -500);
V("py-delay-create", PY + "test/timers/delay_timer_test.py:13-14", "delayPhases", P1000, [600, 50, 0], [49600, 600]);
V("py-delay-calibrate-equal", PY + "test/timers/delay_timer_test.py:17-18", "calibrateDelay", P1000, [0, 0], 0);
V("py-delay-calibrate-close", PY + "test/timers/delay_timer_test.py:20-21", "calibrateDelay", P1000, [0, 1], 0.75);
V("py-delay-calibrate-at-threshold", PY + "test/timers/delay_timer_test.py:23-24", "calibrateDelay", P1000, [0, 167], 125.25);
V("py-delay-calibrate-past-threshold", PY + "test/timers/delay_timer_test.py:26-27", "calibrateDelay", P1000, [0, 168], 168);
// entralink python test mocks delay phases as [0,0]; reproduce with a real delay timer whose phases are known and check the +250/-cal deltas.
V("py-entralink-create-shape", PY + "test/timers/entralink_timer_test.py:14-17 (mocked delay phases [0,0] -> [250,-400]; here real delay phases at fps 1000 then +250 / -400)", "entralinkPhases", P1000, [100, 200, 300, 400], [200000 + 300 + 200 - 100 + 250, 100 - 300 - 400]);
V("py-enhanced-entralink-third-phase", PY + "test/timers/entralink_timer_test.py:30-33 (third phase = 3/0.837148929*1000 + 6 = 3589.5917553924264)", "enhancedEntralinkPhases", P1000, [1, 2, 3, 4, 5, 6], [2000 + 4 + 200 - 1 + 60000 + 250, 1 - 4 - 5, 3589.5917553924264]);
V("py-enhanced-entralink-calibrate-equal", PY + "test/timers/entralink_timer_test.py:37-38", "calibrateEntralinkAdvances", null, [1, 1], 0);
V("py-enhanced-entralink-calibrate-over", PY + "test/timers/entralink_timer_test.py:40-41", "calibrateEntralinkAdvances", null, [1, 2], -1194.5305851308087);
V("py-enhanced-entralink-calibrate-under", PY + "test/timers/entralink_timer_test.py:43-44", "calibrateEntralinkAdvances", null, [1, 0], 1194.5305851308087);
V("py-gen3-standard", PY + "test/timers/gen3/timer_test.py:21-29", "gen3Phases", P1000, [{ mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 0 }], [5000, 1000]);
V("py-gen3-standard-cal50", PY + "test/timers/gen3/timer_test.py:31-39", "gen3Phases", P1000, [{ mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 50 }], [5000, 1050]);
V("py-gen3-variable", PY + "test/timers/gen3/timer_test.py:41-47", "gen3Phases", P1000, [{ mode: "VARIABLE_TARGET", preTimer: 5000, targetFrame: 1000, calibration: 0 }], [5000, Infinity]);
V("py-gen3-calibrate-early", PY + "test/timers/gen3/timer_test.py:56-62", "calibrateGen3", P1000, [{ mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 0 }, 950], 50);
V("py-gen3-calibrate-exact", PY + "test/timers/gen3/timer_test.py:65-71", "calibrateGen3", P1000, [{ mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 0 }, 1000], 0);
V("py-gen3-calibrate-late", PY + "test/timers/gen3/timer_test.py:74-80", "calibrateGen3", P1000, [{ mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 0 }, 1050], -50);
V("py-gen4-create-zero-cal", PY + "test/timers/gen4/timer_test.py:19-29 (phase 2 == 600)", "gen4Phases", P1000, [{ targetDelay: 600, targetSecond: 50, calibratedDelay: 0, calibratedSecond: 0 }], [49600, 600]);
V("py-gen4-calibrate-skips-zero-hit", PY + "test/timers/gen4/timer_test.py:55-60", "calibrateGen4", P1000, [{ targetDelay: 600, targetSecond: 50, calibratedDelay: 500, calibratedSecond: 14 }, 0], 0);
V("py-gen4-calibrate-exact-hit", PY + "test/timers/gen4/timer_test.py:63-69", "calibrateGen4", P1000, [{ targetDelay: 600, targetSecond: 50, calibratedDelay: 500, calibratedSecond: 14 }, 600], 0);
V("py-gen4-get-calibration-zero", PY + "test/timers/gen4/timer_test.py:73-79", "createCalibration", P1000, [0, 0], 0);

// ---------- B. EonTimer default-settings examples (store/index.ts:121-154) per console ----------
const CONSOLES = ["GBA", "NDS_SLOT1", "NDS_SLOT2", "DSI", "3DS"];
const DEF3 = { mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 0 };
const DEF4 = { targetDelay: 600, targetSecond: 50, calibratedDelay: 500, calibratedSecond: 14 };
const DEF5 = { mode: "STANDARD", calibration: -95, frameCalibration: 0, entralinkCalibration: 256, targetDelay: 1200, targetSecond: 50, targetAdvances: 100 };
const STORE = TS + "src/store/index.ts:121-154 defaults, evaluated by ";
for (const c of CONSOLES) {
  const s = S_(c);
  V("default-gen3-standard-" + c, STORE + "src/timers/gen3Timer.ts:17-24 + frameTimer.ts:4-19", "gen3Phases", s, [DEF3]);
  V("default-gen3-variable-" + c, STORE + "src/timers/gen3Timer.ts:21-22 + frameTimer.ts:29-31", "gen3Phases", s, [Object.assign({}, DEF3, { mode: "VARIABLE_TARGET" })]);
  for (const hit of [1000, 990, 1010, 900, 1100, 0]) V("default-gen3-calibrate-hit" + hit + "-" + c, STORE + "src/timers/gen3Timer.ts:26-32 + frameTimer.ts:21-27", "calibrateGen3", s, [DEF3, hit]);
  V("default-gen4-phases-" + c, STORE + "src/timers/gen4Timer.ts:16-23 + delayTimer.ts:9-22 + calibrator.ts:77-83", "gen4Phases", s, [DEF4]);
  V("default-gen4-minutes-" + c, STORE + "src/timers/gen4Timer.ts:25-29 + utils/constants.ts:13-20", "gen4MinutesBefore", s, [DEF4]);
  for (const hit of [600, 599, 601, 590, 610, 500, 700, 0]) V("default-gen4-calibrate-hit" + hit + "-" + c, STORE + "src/timers/gen4Timer.ts:31-40 + delayTimer.ts:24-34", "calibrateGen4", s, [DEF4, hit]);
  for (const mode of ["STANDARD", "C_GEAR", "ENTRALINK", "ENTRALINK_PLUS"]) {
    const m = Object.assign({}, DEF5, { mode });
    V("default-gen5-" + mode + "-phases-" + c, STORE + "src/timers/gen5Timer.ts:23-51", "gen5Phases", s, [m]);
    V("default-gen5-" + mode + "-minutes-" + c, STORE + "src/timers/gen5Timer.ts:53-72", "gen5MinutesBefore", s, [m]);
    for (const hits of [{ delayHit: 1200, secondHit: 50, advancesHit: 100 }, { delayHit: 1190, secondHit: 49, advancesHit: 90 }, { delayHit: 1300, secondHit: 51, advancesHit: 110 }, { delayHit: null, secondHit: 48, advancesHit: null }, { delayHit: 1210, secondHit: null, advancesHit: null }]) {
      V("default-gen5-" + mode + "-calibrate-d" + hits.delayHit + "-s" + hits.secondHit + "-a" + hits.advancesHit + "-" + c, STORE + "src/timers/gen5Timer.ts:86-138", "calibrateGen5", s, [m, hits]);
    }
    const sp = S_(c, 60, true);
    V("default-gen5-" + mode + "-phases-precision-" + c, STORE + "src/timers/gen5Timer.ts:23-25 + calibrator.ts:73-75 (precisionCalibration=true)", "gen5Phases", sp, [m]);
    V("default-gen5-" + mode + "-calibrate-precision-" + c, STORE + "src/timers/gen5Timer.ts:86-138 + calibrator.ts:67-71 (precisionCalibration=true)", "calibrateGen5", sp, [m, { delayHit: 1190, secondHit: 49, advancesHit: 90 }]);
  }
  const custom = [{ unit: "ms", target: 5000, calibration: 0 }, { unit: "advances", target: 1000, calibration: 10.5 }, { unit: "hex", target: 0x1234, calibration: -3 }];
  V("custom-phases-" + c, TS + "src/timers/customTimer.ts:10-18", "customPhases", s, [custom]);
  custom.forEach((p, i) => V("custom-calibrate-" + p.unit + "-" + c, TS + "src/timers/customTimer.ts:20-29", "calibrateCustomPhase", s, [p, p.target - 7]));
}
// custom console at 60 fps and 59.7275 (Python/C++ GBA value) and Switch NSO FRLG 119.445 (design doc)
for (const fps of [60, 59.7275, 119.445]) {
  const s = S_("CUSTOM", fps);
  V("custom-fps" + fps + "-gen3", TS + "src/timers/calibrator.ts:48-53 (Console.CUSTOM: 1000/customFramerate)", "gen3Phases", s, [DEF3]);
  V("custom-fps" + fps + "-toMs-1000", TS + "src/timers/calibrator.ts:48-53,63-65", "toMilliseconds", s, [1000]);
  V("custom-fps" + fps + "-toDelays-16742.7", TS + "src/timers/calibrator.ts:48-53,59-61", "toDelays", s, [16742.7]);
}
// unknown console name -> EonTimer's default branch (calibrator.ts:54-55). "constructor" is also a
// key Object.prototype owns, so a port that looks consoles up with plain property access reads
// Object.prototype.constructor (NaN ms/frame) instead of falling back to slot-1.
const UNKNOWN = S_("constructor");
V("unknown-console-constructor-toMs-1000", TS + "src/timers/calibrator.ts:54-55 (default branch: name outside the Console enum; 'constructor' is also an Object.prototype key) + :63-65", "toMilliseconds", UNKNOWN, [1000]);
V("unknown-console-constructor-toDelays-16715", TS + "src/timers/calibrator.ts:54-55 default branch + :59-61", "toDelays", UNKNOWN, [16715]);
V("unknown-console-constructor-gen4-phases", TS + "src/timers/calibrator.ts:54-55 default branch via gen4Timer.ts:16-23", "gen4Phases", UNKNOWN, [DEF4]);
// minimum length variants (Add configurable minimum phase length #189)
for (const ml of [10000, 14000, 20000, 60000]) {
  V("minlen" + ml + "-second-phase", TS + "src/timers/secondTimer.ts:3-9 + utils/constants.ts:6-11 (minimumLength " + ml + ")", "secondPhases", null, [5, -95, ml]);
  V("minlen" + ml + "-gen4", TS + "src/timers/delayTimer.ts:15-19 (settings.minimumLength " + ml + ")", "gen4Phases", S_("NDS_SLOT1", 60, false, ml), [DEF4]);
  V("minlen" + ml + "-gen5-standard", TS + "src/timers/gen5Timer.ts:29", "gen5Phases", S_("NDS_SLOT1", 60, false, ml), [Object.assign({}, DEF5, { targetSecond: 5 })]);
}
[[13999, 14000], [14000, 14000], [0, 14000], [-70000, 14000], [61200, 14000], [5, 20000]].forEach(([v, m]) => V("toMinimumLength-" + v + "-" + m, TS + "src/utils/constants.ts:6-11", "toMinimumLength", null, [v, m]));
[[[50200]], [[59999, 1]], [[60000]], [[5000, Infinity]], [[120000, 5000, 3589.59]], [[]]].forEach(([ph], i) => V("minutesBeforeTarget-" + i, TS + "src/utils/constants.ts:13-20", "minutesBeforeTarget", null, [enc(ph)]));

// ---------- C. Rounding edge cases (half-to-even with epsilon, calibrator.ts:16-36) ----------
const RHE = TS + "src/timers/calibrator.ts:16-36 roundHalfToEven via toDelays at 1000 fps (1 ms/frame)";
[0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, 0.49999999999999994, 0.5000000000000001, 2.4999999999999996, 1e15 + 0.5, -1e15 - 0.5, 0, 7, -7, 123456.5, 123457.5].forEach(x =>
  V("rhe-toDelays-" + x, RHE, "toDelays", P1000, [x]));
// NDS half-way frames: ms = k * msPerFrame exactly at .5 delays
const NDS = S_("NDS_SLOT1");
[0.5, 1.5, 2.5, 100.5, 599.5, 600.5].forEach(k => V("rhe-nds-toDelays-" + k + "delays", TS + "src/timers/calibrator.ts:59-61 (ms = " + k + " * 1000/59.8261)", "toDelays", NDS, [k * (1000 / 59.8261)]));
[1, 2, 3, 59, 60, 600, 1200, 5000, 65535, 100000].forEach(d => V("nds-toMs-" + d, TS + "src/timers/calibrator.ts:63-65", "toMilliseconds", NDS, [d]));
[1, 2, 3, 59, 60, 600, 1000, 65535, 100000].forEach(d => V("gba-toMs-" + d, TS + "src/timers/calibrator.ts:63-65 + utils/constants.ts:23,27", "toMilliseconds", S_("GBA"), [d]));
[1, 60, 600, 1200].forEach(d => V("slot2-toMs-" + d, TS + "src/timers/calibrator.ts:63-65 + utils/constants.ts:25,29", "toMilliseconds", S_("NDS_SLOT2"), [d]));
[[500, 14], [0, 0], [600, 50], [-300, 20], [512, 15], [1200, 50]].forEach(([d, s]) => V("createCalibration-" + d + "-" + s, TS + "src/timers/calibrator.ts:77-83", "createCalibration", NDS, [d, s]));
[[-95], [256], [0], [-424], [12.5]].forEach(([d]) => { V("calToMs-" + d, TS + "src/timers/calibrator.ts:73-75", "calibrateToMilliseconds", NDS, [d]); V("calToMs-precision-" + d, TS + "src/timers/calibrator.ts:73-75", "calibrateToMilliseconds", S_("NDS_SLOT1", 60, true), [d]); });
[[-1588], [4279], [0.5], [8.357556317393245], [-500]].forEach(([ms]) => { V("calToDelays-" + ms, TS + "src/timers/calibrator.ts:67-71", "calibrateToDelays", NDS, [ms]); V("calToDelays-precision-" + ms, TS + "src/timers/calibrator.ts:67-71", "calibrateToDelays", S_("NDS_SLOT1", 60, true), [ms]); });
// delay-hit correction rule around the 167 ms threshold at NDS rates (delta in ms after rounding)
[[600, 610], [600, 590], [600, 609], [600, 611], [600, 0], [1200, 1200], [1200, 1300]].forEach(([t, h]) => V("nds-calibrateDelay-" + t + "-" + h, TS + "src/timers/delayTimer.ts:5-7,24-34", "calibrateDelay", NDS, [t, h]));
// second-hit rule
[[50, 49], [50, 51], [50, 50], [50, 40], [0, 59]].forEach(([t, h]) => V("calibrateSecond-" + t + "-" + h, TS + "src/timers/secondTimer.ts:11-18", "calibrateSecond", null, [t, h]));
// entralink pieces
V("entralink-defaults-nds", TS + "src/timers/entralinkTimer.ts:6-17", "entralinkPhases", NDS, [1200, 50, -1588, 4279]);
V("enhanced-entralink-defaults-nds", TS + "src/timers/entralinkTimer.ts:4,27-45", "enhancedEntralinkPhases", NDS, [1200, 50, 100, -1588, 4279, 0]);
[[100, 90], [100, 110], [100, 100], [0, 1]].forEach(([t, h]) => V("calibrateEntralinkAdvances-" + t + "-" + h, TS + "src/timers/entralinkTimer.ts:47-49", "calibrateEntralinkAdvances", null, [t, h]));
// frame timer at GBA with fractional calibration (FloatInput) and large frames
[[5000, 1000, 0], [5000, 1000, 12.5], [0, 0, 0], [3000, 74, -8], [5000, 35880, 0], [5000, 176562488, 0]].forEach(([p, f, c]) => V("gba-framePhases-" + p + "-" + f + "-" + c, TS + "src/timers/frameTimer.ts:4-19", "framePhases", S_("GBA"), [p, f, c]));

const out = { provenance: {
  eontimer_main: "https://github.com/DasAmpharos/EonTimer main @ ad10886d83bc455ad208c82925610c642d9e8864 (2026-04-20); every 'expect' below was computed by running that commit's src/timers/*.ts + src/utils/constants.ts compiled with tsc 5.9.3 under node " + process.version,
  eontimer_python: "https://github.com/DasAmpharos/EonTimer 3.x-python @ 13d15f72b1476e459bf7ad8c38c6f7abfc9193c9 (2026-03-29) test/timers/*.py literal assertions, ids prefixed 'py-'; each was also checked against the main-branch TS result (" + mismatches + " mismatches)",
  encoding: "Infinity is encoded as the string \"Infinity\". settings = {console: GBA|NDS_SLOT1|NDS_SLOT2|DSI|3DS|CUSTOM (any other name = EonTimer's default branch), customFps, precisionCalibration, minimumLengthMs}; null settings = function takes none. count = vectors.length, asserted by tests/test-timers.cjs and app/Tests/TimerChecks.cs.",
  readme_note: "EonTimer's README (all branches) has no numeric worked examples; the 'default-*' vectors use the values each mode opens with (src/store/index.ts:121-154), which is the closest thing to a README example."
}, count: vectors.length, vectors };

const outPath = process.argv[3] || path.join(__dirname, "..", "tests", "timer-vectors.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 0).replace(/\{"id"/g, '\n{"id"') + "\n");
console.log("vectors:", vectors.length, "python/ts mismatches:", mismatches, "->", outPath);
process.exit(mismatches ? 1 : 0);
