// Checks core/timers.js against (1) tests/timer-vectors.json, whose expected values were produced
// by EonTimer's own TypeScript (main @ ad10886) and the literal assertions of its Python unit
// tests, and (2) tests/timer-parity.json, 200 random parameter sets evaluated by the C# port
// (app/Core/Timers.cs) — every number must match bit-for-bit. Also measures how far the legacy
// gen4.js timer (still what the webapp uses) sits from EonTimer's rounding, and runs a negative
// control that corrupts one vector and proves the checker notices.
//
//   node tests/test-timers.cjs [timer-vectors.json] [timer-parity.json]
const fs = require("fs");
const path = require("path");
const T = require(path.join(__dirname, "..", "core", "timers.js"));
const gen4 = require(path.join(__dirname, "..", "core", "gen4.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "timer-vectors.json");
const parityPath = process.argv[3] || null;

let failures = 0;

function decode(v) {
  if (v === "Infinity") return Infinity;
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = decode(v[k]);
    return o;
  }
  return v;
}

function same(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return same(ka, kb) && ka.every((k) => same(a[k], b[k]));
  }
  return a === b;
}

function fmt(v) {
  return JSON.stringify(v, (k, x) => (x === Infinity ? "Infinity" : x));
}

function call(fn, s, a) {
  switch (fn) {
    case "roundHalfToEven": return T.roundHalfToEven(a[0]);
    case "toDelays": return T.toDelays(s, a[0]);
    case "toMilliseconds": return T.toMilliseconds(s, a[0]);
    case "calibrateToDelays": return T.calibrateToDelays(s, a[0]);
    case "calibrateToMilliseconds": return T.calibrateToMilliseconds(s, a[0]);
    case "createCalibration": return T.createCalibration(s, a[0], a[1]);
    case "toMinimumLength": return T.toMinimumLength(a[0], a[1]);
    case "minutesBeforeTarget": return T.minutesBeforeTarget(a[0]);
    case "framePhases": return T.framePhases(s, a[0], a[1], a[2]);
    case "calibrateFrame": return T.calibrateFrame(s, a[0], a[1]);
    case "variableFramePhases": return T.variableFramePhases(a[0]);
    case "secondPhases": return T.secondPhases(a[0], a[1], a[2]);
    case "calibrateSecond": return T.calibrateSecond(a[0], a[1]);
    case "delayPhases": return T.delayPhases(s, a[0], a[1], a[2]);
    case "calibrateDelay": return T.calibrateDelay(s, a[0], a[1]);
    case "entralinkPhases": return T.entralinkPhases(s, a[0], a[1], a[2], a[3]);
    case "enhancedEntralinkPhases": return T.enhancedEntralinkPhases(s, a[0], a[1], a[2], a[3], a[4], a[5]);
    case "calibrateEntralinkAdvances": return T.calibrateEntralinkAdvances(a[0], a[1]);
    case "gen3Phases": return T.gen3Phases(s, a[0]);
    case "calibrateGen3": return T.calibrateGen3(s, a[0], a[1]);
    case "gen4Phases": return T.gen4Phases(s, a[0]);
    case "gen4MinutesBefore": return T.gen4MinutesBefore(s, a[0]);
    case "calibrateGen4": return T.calibrateGen4(s, a[0], a[1]);
    case "gen5Phases": return T.gen5Phases(s, a[0]);
    case "gen5MinutesBefore": return T.gen5MinutesBefore(s, a[0]);
    case "calibrateGen5": return T.calibrateGen5(s, a[0], a[1]);
    case "customPhases": return T.customPhases(s, a[0]);
    case "calibrateCustomPhase": return T.calibrateCustomPhase(s, a[0], a[1]);
    default: throw new Error("unknown fn " + fn);
  }
}

function checkVector(v, quiet) {
  const actual = call(v.fn, v.settings, decode(v.args));
  const expected = decode(v.expect);
  if (!same(actual, expected)) {
    if (!quiet) console.error(`FAIL ${v.id} (${v.fn})\n  source   ${v.source}\n  expected ${fmt(expected)}\n  actual   ${fmt(actual)}`);
    return false;
  }
  return true;
}

// ---- 1. EonTimer vectors ----
const doc = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const perFn = {};
let vectorFailures = 0;
for (const v of doc.vectors) {
  perFn[v.fn] = (perFn[v.fn] || 0) + 1;
  if (!checkVector(v, false)) vectorFailures++;
}
failures += vectorFailures;
console.log(`timer vectors: ${doc.vectors.length} checked, ${vectorFailures} failed (${Object.keys(perFn).length} functions; ${doc.vectors.filter((v) => v.id.startsWith("py-")).length} transcribed from EonTimer's Python unit tests)`);

// ---- 2. Negative control: a corrupted copy of one vector must fail ----
{
  const original = doc.vectors.find((v) => v.fn === "gen4Phases" && v.id.indexOf("default-gen4-phases-NDS_SLOT1") === 0) || doc.vectors[0];
  const corrupted = JSON.parse(JSON.stringify(original));
  corrupted.id = original.id + " [CORRUPTED +1 ms on phase 1]";
  corrupted.expect = Array.isArray(corrupted.expect) ? [corrupted.expect[0] + 1].concat(corrupted.expect.slice(1)) : corrupted.expect + 1;
  const detected = !checkVector(corrupted, true);
  if (!detected) {
    failures++;
    console.error(`FAIL negative control: corrupted vector ${corrupted.id} was NOT detected`);
  } else {
    console.log(`negative control: corrupted vector "${corrupted.id}" correctly fails (expected ${fmt(decode(corrupted.expect))}, actual ${fmt(call(original.fn, original.settings, decode(original.args)))})`);
  }
}

// ---- 3. Invariants and constants ----
function check(label, actual, expected) {
  if (!same(actual, expected)) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${fmt(expected)}\n  actual   ${fmt(actual)}`);
  }
}
check("GBA fps is rng.js's constant", T.GBA_FPS, 16777216 / 280896);
check("NDS slot-1 fps is gen4.js's constant", T.NDS_SLOT1_FPS, 59.8261);
check("NDS slot-2 fps", T.NDS_SLOT2_FPS, 59.6555);
check("DSI and 3DS use the slot-1 rate", [T.CONSOLES.DSI, T.CONSOLES["3DS"]], [59.8261, 59.8261]);
check("custom fps 0 throws", (() => { try { T.msPerFrame({ console: "CUSTOM", customFps: 0 }); return false; } catch (e) { return true; } })(), true);
check("half-to-even ties", [0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5].map(T.roundHalfToEven), [0, 2, 2, 4, 0, -2, -2]);
check("gen3 calibrated model", T.gen3Calibrated({ console: "GBA" }, T.DEFAULTS.gen3, 990).calibration, T.calibrateFrame({ console: "GBA" }, 1000, 990));
check("gen4 calibrated model", T.gen4Calibrated({ console: "NDS_SLOT1" }, T.DEFAULTS.gen4, 610).calibratedDelay, 500 + T.calibrateGen4({ console: "NDS_SLOT1" }, T.DEFAULTS.gen4, 610));
{
  const m = Object.assign({}, T.DEFAULTS.gen5, { mode: "ENTRALINK_PLUS" });
  const r = T.calibrateGen5({}, m, { delayHit: 1190, secondHit: 49, advancesHit: 90 });
  const c = T.gen5Calibrated({}, m, { delayHit: 1190, secondHit: 49, advancesHit: 90 });
  check("gen5 calibrated model", [c.calibration, c.entralinkCalibration, c.frameCalibration], [m.calibration + r.calibrationDelta, m.entralinkCalibration + r.entralinkCalibrationDelta, m.frameCalibration + r.frameCalibrationDelta]);
}
check("custom phase calibrated", T.customPhaseCalibrated({ console: "GBA" }, { unit: "advances", target: 1000, calibration: 2 }, 990).calibration, 2 + T.toMilliseconds({ console: "GBA" }, 10));
check("undefined hits behave as null", T.calibrateGen5({}, T.DEFAULTS.gen5, {}), { calibrationDelta: 0, entralinkCalibrationDelta: 0, frameCalibrationDelta: 0 });

// ---- 4. Legacy gen4.js (what the webapp still runs) vs EonTimer's model ----
// gen4.js keeps every term unrounded; EonTimer rounds the calibrated second to whole frames and
// every ms conversion to whole ms (half-to-even). The gap is bounded by half a frame plus the
// two ms roundings (~9.4 ms at 59.8261 fps) except at a 14 s minimum-length rollover.
function legacyGap(models) {
  let maxP1 = 0, maxP2 = 0, maxCal = 0, rollovers = 0, calThresholdFlips = 0;
  for (const { model, delayHit } of models) {
    const legacy = gen4.timerPhases(model.targetDelay, model.targetSecond, model.calibratedDelay, model.calibratedSecond);
    const eon = T.gen4Phases({ console: "NDS_SLOT1" }, model);
    let d1 = Math.abs(legacy.phase1Ms - eon[0]);
    if (d1 > 10) { rollovers++; d1 = Math.abs(d1 - 60000); }
    maxP1 = Math.max(maxP1, d1);
    maxP2 = Math.max(maxP2, Math.abs(legacy.phase2Ms - eon[1]));
    if (delayHit > 0) {
      const legacyDelta = gen4.calibrate(model.calibratedDelay, model.targetDelay, delayHit) - model.calibratedDelay;
      const eonDelta = T.calibrateGen4({ console: "NDS_SLOT1" }, model, delayHit);
      const gap = Math.abs(legacyDelta - eonDelta);
      const msDelta = Math.abs(gen4.toMs(delayHit) - gen4.toMs(model.targetDelay));
      if (gap > 0.6 && Math.abs(msDelta - 167) <= 1.5) calThresholdFlips++;
      else maxCal = Math.max(maxCal, gap);
    }
  }
  return { maxP1, maxP2, maxCal, rollovers, calThresholdFlips };
}
const defaultsGap = legacyGap([{ model: T.DEFAULTS.gen4, delayHit: 610 }]);
check("legacy gen4.js vs EonTimer, defaults: within half a frame + 1 ms", defaultsGap.maxP1 <= 9.4 && defaultsGap.maxP2 <= 9.4, true);
console.log(`legacy gen4.js vs EonTimer (defaults 600/50/500/14): phase1 gap ${defaultsGap.maxP1.toFixed(3)} ms, phase2 gap ${defaultsGap.maxP2.toFixed(3)} ms`);

// ---- 5. C# parity on random parameter sets ----
if (parityPath && fs.existsSync(parityPath)) {
  const parity = JSON.parse(fs.readFileSync(parityPath, "utf8"));
  let parityFailures = 0;
  let compared = 0;
  const gen4Models = [];
  for (const c of parity.cases) {
    const s = c.settings;
    const results = {
      gen3Phases: T.gen3Phases(s, c.gen3.model),
      gen3Phase: T.framePhase(s, c.gen3.model.targetFrame, c.gen3.model.calibration),
      gen3Calibrate: T.calibrateGen3(s, c.gen3.model, c.gen3.frameHit),
      gen3Calibrated: T.gen3Calibrated(s, c.gen3.model, c.gen3.frameHit),
      gen4Phases: T.gen4Phases(s, c.gen4.model),
      gen4MinutesBefore: T.gen4MinutesBefore(s, c.gen4.model),
      gen4Calibrate: T.calibrateGen4(s, c.gen4.model, c.gen4.delayHit),
      gen4Calibrated: T.gen4Calibrated(s, c.gen4.model, c.gen4.delayHit),
      gen5Phases: T.gen5Phases(s, c.gen5.model),
      gen5MinutesBefore: T.gen5MinutesBefore(s, c.gen5.model),
      gen5Calibrate: T.calibrateGen5(s, c.gen5.model, c.gen5.hits),
      gen5Calibrated: T.gen5Calibrated(s, c.gen5.model, c.gen5.hits),
      customPhases: T.customPhases(s, c.custom.phases),
      customCalibrate: c.custom.phases.map((p, i) => T.calibrateCustomPhase(s, p, c.custom.hits[i])),
      customCalibrated: c.custom.phases.map((p, i) => T.customPhaseCalibrated(s, p, c.custom.hits[i]))
    };
    for (const k of Object.keys(results)) {
      compared++;
      const expected = decode(c.results[k]);
      if (!same(results[k], expected)) {
        parityFailures++;
        if (parityFailures <= 10) console.error(`FAIL parity case ${c.index} ${k}\n  settings ${fmt(s)}\n  C#       ${fmt(expected)}\n  JS       ${fmt(results[k])}`);
      }
    }
    if (s.console === "NDS_SLOT1") gen4Models.push({ model: c.gen4.model, delayHit: c.gen4.delayHit });
  }
  failures += parityFailures;
  console.log(`JS vs C# parity: ${parity.cases.length} random parameter sets (seed ${parity.seed}), ${compared} results compared, ${parityFailures} mismatches`);
  const g = legacyGap(gen4Models);
  console.log(`legacy gen4.js vs EonTimer over ${gen4Models.length} random NDS sets: max phase1 gap ${g.maxP1.toFixed(3)} ms (${g.rollovers} at a 14 s rollover), max phase2 gap ${g.maxP2.toFixed(3)} ms, max calibrate gap ${g.maxCal.toFixed(3)} delays (${g.calThresholdFlips} near the 167 ms threshold)`);
  check("legacy gen4.js vs EonTimer stays within half a frame + 1 ms", g.maxP1 <= 9.4 && g.maxP2 <= 9.4, true);
} else {
  console.log("no timer-parity.json given; skipping the JS vs C# cross-check");
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("all timer checks passed");
