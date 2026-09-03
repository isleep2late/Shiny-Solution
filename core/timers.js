// Timer models ported from EonTimer (MIT, https://github.com/DasAmpharos/EonTimer, main @ ad10886;
// its MIT notice is reproduced in THIRD_PARTY_NOTICES.md at the repo root).
// Every constant and formula cites the EonTimer file:line it was read from; see docs/FACTS.md
// "Timer models". The arithmetic is kept in EonTimer's operation order so that this file,
// app/Core/Timers.cs and EonTimer itself agree bit-for-bit (tests/timer-vectors.json).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rng.js"), require("./gen4.js"));
  else root.ShinyTimers = factory(root.ShinyCore, root.ShinyGen4);
})(typeof self !== "undefined" ? self : this, function (core, gen4) {
  // Console frame rates (EonTimer src/utils/constants.ts:23-29). GBA and NDS slot-1 are the
  // constants rng.js / gen4.js already own; slot-2 (a GBA cart in a DS) is EonTimer-only.
  var GBA_FPS = core.GBA_FPS;            // 16777216 / 280896, constants.ts:23
  var NDS_SLOT1_FPS = gen4.NDS_FPS;      // 59.8261, constants.ts:24
  var NDS_SLOT2_FPS = 59.6555;           // constants.ts:25
  var CONSOLES = {
    GBA: GBA_FPS,
    NDS_SLOT1: NDS_SLOT1_FPS,
    NDS_SLOT2: NDS_SLOT2_FPS,
    DSI: NDS_SLOT1_FPS,                  // calibrator.ts:44-47: DSI and 3DS use the slot-1 rate
    "3DS": NDS_SLOT1_FPS
  };
  var CONSOLE_NAMES = ["GBA", "NDS_SLOT1", "NDS_SLOT2", "DSI", "3DS", "CUSTOM"];

  var MINIMUM_LENGTH_MS = 14000;         // constants.ts:4
  var MINUTE_MS = 60000;                 // constants.ts:8, :19
  var SECOND_OFFSET_MS = 200;            // secondTimer.ts:8 (the "+200 ms" term)
  var SECOND_HIT_HALF_MS = 500;          // secondTimer.ts:13,15
  var CLOSE_THRESHOLD_MS = 167;          // delayTimer.ts:5
  var UPDATE_FACTOR = 1.0;               // delayTimer.ts:6
  var CLOSE_UPDATE_FACTOR = 0.75;        // delayTimer.ts:7
  var ENTRALINK_PHASE1_MS = 250;         // entralinkTimer.ts:14
  var ENTRALINK_FRAME_RATE = 0.837148929; // entralinkTimer.ts:4 (advances per second in the Entralink)
  var EPSILON = Math.pow(2, -52);        // Number.EPSILON, calibrator.ts:29

  // EonTimer's opening values (src/store/index.ts:121-154).
  var DEFAULTS = {
    settings: { console: "NDS_SLOT1", customFps: 60.0, precisionCalibration: false, minimumLengthMs: MINIMUM_LENGTH_MS },
    gen3: { mode: "STANDARD", preTimer: 5000, targetFrame: 1000, calibration: 0 },
    gen4: { targetDelay: 600, targetSecond: 50, calibratedDelay: 500, calibratedSecond: 14 },
    gen5: { mode: "STANDARD", calibration: -95, frameCalibration: 0, entralinkCalibration: 256, targetDelay: 1200, targetSecond: 50, targetAdvances: 100 }
  };
  // Community starting calibrations for Gen 5 (EMPIRICAL). -95 is EonTimer's own default
  // (store/index.ts:134); -424 for 3DS is a community figure that does NOT appear anywhere in
  // EonTimer's source and is carried from the RNG guide design doc unverified.
  var GEN5_COMMUNITY_CALIBRATION = { DS: -95, "3DS": -424 };

  var GEN3_MODES = ["STANDARD", "VARIABLE_TARGET"];                       // types.ts:20-23
  var GEN5_MODES = ["STANDARD", "C_GEAR", "ENTRALINK", "ENTRALINK_PLUS"]; // types.ts:12-17
  var CUSTOM_UNITS = ["ms", "advances", "hex"];                           // types.ts:47-51

  // calibrator.ts:15-36 — "Match the desktop timer's C# Math.Round(decimal) midpoint-to-even
  // behavior", with an epsilon so values a rounding error away from .5 still count as ties.
  function roundHalfToEven(value) {
    if (!isFinite(value)) return Math.round(value);
    var lower = Math.floor(value);
    var upper = Math.ceil(value);
    if (lower === upper) return lower;
    var lowerDistance = value - lower;
    var upperDistance = upper - value;
    var epsilon = EPSILON * Math.max(1, Math.abs(value));
    if (Math.abs(lowerDistance - upperDistance) <= epsilon) {
      return Math.abs(lower) % 2 === 0 ? lower : upper;
    }
    return lowerDistance < upperDistance ? lower : upper;
  }

  function settingsOf(s) {
    var o = s || {};
    return {
      console: o.console === undefined || o.console === null ? DEFAULTS.settings.console : o.console,
      customFps: o.customFps === undefined || o.customFps === null ? DEFAULTS.settings.customFps : o.customFps,
      precisionCalibration: !!o.precisionCalibration,
      minimumLengthMs: o.minimumLengthMs === undefined || o.minimumLengthMs === null ? MINIMUM_LENGTH_MS : o.minimumLengthMs
    };
  }

  // calibrator.ts:38-57
  function fps(settings) {
    var s = settingsOf(settings);
    if (s.console === "CUSTOM") {
      if (s.customFps === 0) throw new Error("Custom framerate must be greater than 0");
      return s.customFps;
    }
    // Own-property lookup: prototype names ("constructor", "toString") are unknown consoles and
    // take EonTimer's default branch (calibrator.ts:54-55) instead of reading Object.prototype.
    return Object.prototype.hasOwnProperty.call(CONSOLES, s.console) ? CONSOLES[s.console] : NDS_SLOT1_FPS;
  }

  function msPerFrame(settings) {
    return 1000 / fps(settings);
  }

  function toDelays(settings, milliseconds) {                 // calibrator.ts:59-61
    return roundHalfToEven(milliseconds / msPerFrame(settings));
  }

  function toMilliseconds(settings, delays) {                 // calibrator.ts:63-65
    return roundHalfToEven(msPerFrame(settings) * delays);
  }

  function calibrateToDelays(settings, milliseconds) {        // calibrator.ts:67-71
    return settingsOf(settings).precisionCalibration ? roundHalfToEven(milliseconds) : toDelays(settings, milliseconds);
  }

  function calibrateToMilliseconds(settings, delays) {        // calibrator.ts:73-75
    return settingsOf(settings).precisionCalibration ? delays : toMilliseconds(settings, delays);
  }

  function createCalibration(settings, delays, seconds) {     // calibrator.ts:77-83
    return toMilliseconds(settings, delays - toDelays(settings, seconds * 1000));
  }

  function toMinimumLength(value, minimumLength) {            // constants.ts:6-11
    var min = minimumLength === undefined || minimumLength === null ? MINIMUM_LENGTH_MS : minimumLength;
    while (value < min) value += MINUTE_MS;
    return value;
  }

  function minutesBeforeTarget(phases) {                      // constants.ts:13-20
    var total = 0;
    for (var i = 0; i < phases.length; i++) {
      if (phases[i] === Infinity) continue;
      total += phases[i];
    }
    return Math.floor(total / MINUTE_MS);
  }

  // ---- Frame timer (Gen 3 Standard / Variable Target), frameTimer.ts ----
  function framePhase(settings, targetFrame, calibration) {   // frameTimer.ts:13-19
    return toMilliseconds(settings, targetFrame) + calibration;
  }

  function framePhases(settings, preTimer, targetFrame, calibration) { // frameTimer.ts:4-11
    return [preTimer, framePhase(settings, targetFrame, calibration)];
  }

  function calibrateFrame(settings, targetFrame, frameHit) {  // frameTimer.ts:21-27
    return toMilliseconds(settings, targetFrame - frameHit);
  }

  function variableFramePhases(preTimer) {                    // frameTimer.ts:29-31
    return [preTimer, Infinity];
  }

  // ---- Second timer (Gen 5 Standard), secondTimer.ts ----
  function secondPhases(targetSecond, calibration, minimumLength) { // secondTimer.ts:3-9
    return [toMinimumLength(targetSecond * 1000 + calibration + SECOND_OFFSET_MS, minimumLength)];
  }

  function calibrateSecond(targetSecond, secondHit) {         // secondTimer.ts:11-18
    if (secondHit < targetSecond) return (targetSecond - secondHit) * 1000 - SECOND_HIT_HALF_MS;
    if (secondHit > targetSecond) return (targetSecond - secondHit) * 1000 + SECOND_HIT_HALF_MS;
    return 0;
  }

  // ---- Delay timer (Gen 4, Gen 5 C-Gear), delayTimer.ts ----
  function delayPhases(settings, targetDelay, targetSecond, calibration) { // delayTimer.ts:9-22
    var min = settingsOf(settings).minimumLengthMs;
    var phase1 = toMinimumLength(secondPhases(targetSecond, calibration, min)[0] - toMilliseconds(settings, targetDelay), min);
    var phase2 = toMilliseconds(settings, targetDelay) - calibration;
    return [phase1, phase2];
  }

  function calibrateDelay(settings, targetDelay, delayHit) {  // delayTimer.ts:24-34
    var delta = toMilliseconds(settings, delayHit) - toMilliseconds(settings, targetDelay);
    if (Math.abs(delta) <= CLOSE_THRESHOLD_MS) return CLOSE_UPDATE_FACTOR * delta;
    return UPDATE_FACTOR * delta;
  }

  // ---- Entralink timers (Gen 5), entralinkTimer.ts ----
  function entralinkPhases(settings, targetDelay, targetSecond, calibration, entralinkCalibration) { // :6-17
    var durations = delayPhases(settings, targetDelay, targetSecond, calibration);
    durations[0] += ENTRALINK_PHASE1_MS;
    durations[1] -= entralinkCalibration;
    return durations;
  }

  function calibrateEntralinkDelay(settings, targetDelay, delayHit) { // :19-25
    return calibrateDelay(settings, targetDelay, delayHit);
  }

  function enhancedEntralinkPhases(settings, targetDelay, targetSecond, targetAdvances, calibration, entralinkCalibration, frameCalibration) { // :27-45
    var phases = entralinkPhases(settings, targetDelay, targetSecond, calibration, entralinkCalibration);
    phases.push((targetAdvances / ENTRALINK_FRAME_RATE) * 1000 + frameCalibration);
    return phases;
  }

  function calibrateEntralinkAdvances(targetAdvances, advancesHit) { // :47-49
    return ((targetAdvances - advancesHit) / ENTRALINK_FRAME_RATE) * 1000;
  }

  // ---- Gen 3 model, gen3Timer.ts ----
  function gen3Phases(settings, model) {                      // gen3Timer.ts:17-24
    switch (model.mode) {
      case "STANDARD": return framePhases(settings, model.preTimer, model.targetFrame, model.calibration);
      case "VARIABLE_TARGET": return variableFramePhases(model.preTimer);
      default: throw new Error("Unsupported Gen3 mode: " + model.mode);
    }
  }

  function calibrateGen3(settings, model, frameHit) {         // gen3Timer.ts:26-32 -> offset added to calibration
    return calibrateFrame(settings, model.targetFrame, frameHit);
  }

  function gen3Calibrated(settings, model, frameHit) {        // Gen3Panel.tsx:68-73
    var next = {};
    for (var k in model) next[k] = model[k];
    next.calibration = model.calibration + calibrateGen3(settings, model, frameHit);
    return next;
  }

  // ---- Gen 4 model, gen4Timer.ts ----
  function gen4Calibration(settings, model) {                 // gen4Timer.ts:12-14
    return createCalibration(settings, model.calibratedDelay, model.calibratedSecond);
  }

  function gen4Phases(settings, model) {                      // gen4Timer.ts:16-23
    return delayPhases(settings, model.targetDelay, model.targetSecond, gen4Calibration(settings, model));
  }

  function gen4MinutesBefore(settings, model) {               // gen4Timer.ts:25-29 (calibration held at 0)
    return minutesBeforeTarget(delayPhases(settings, model.targetDelay, model.targetSecond, 0));
  }

  function calibrateGen4(settings, model, delayHit) {         // gen4Timer.ts:31-40 -> delta in delays, added to calibratedDelay
    if (delayHit > 0) return toDelays(settings, calibrateDelay(settings, model.targetDelay, delayHit));
    return 0;
  }

  function gen4Calibrated(settings, model, delayHit) {        // Gen4Panel.tsx:45-50
    var next = {};
    for (var k in model) next[k] = model[k];
    next.calibratedDelay = model.calibratedDelay + calibrateGen4(settings, model, delayHit);
    return next;
  }

  // ---- Gen 5 model, gen5Timer.ts ----
  function gen5Phases(settings, model) {                      // gen5Timer.ts:23-51
    var calibration = calibrateToMilliseconds(settings, model.calibration);
    var entralinkCalibration = calibrateToMilliseconds(settings, model.entralinkCalibration);
    switch (model.mode) {
      case "STANDARD": return secondPhases(model.targetSecond, calibration, settingsOf(settings).minimumLengthMs);
      case "C_GEAR": return delayPhases(settings, model.targetDelay, model.targetSecond, calibration);
      case "ENTRALINK": return entralinkPhases(settings, model.targetDelay, model.targetSecond, calibration, entralinkCalibration);
      case "ENTRALINK_PLUS": return enhancedEntralinkPhases(settings, model.targetDelay, model.targetSecond, model.targetAdvances, calibration, entralinkCalibration, model.frameCalibration);
      default: throw new Error("Unsupported Gen5 mode: " + model.mode);
    }
  }

  function gen5MinutesBefore(settings, model) {               // gen5Timer.ts:53-72 (calibrations held at 0)
    switch (model.mode) {
      case "STANDARD": return minutesBeforeTarget(secondPhases(model.targetSecond, 0, settingsOf(settings).minimumLengthMs));
      case "C_GEAR": return minutesBeforeTarget(delayPhases(settings, model.targetDelay, model.targetSecond, 0));
      case "ENTRALINK":
      case "ENTRALINK_PLUS": return minutesBeforeTarget(entralinkPhases(settings, model.targetDelay, model.targetSecond, 0, 0));
      default: return 0;
    }
  }

  function hasHit(v) {
    return v !== null && v !== undefined;
  }

  // gen5Timer.ts:86-138 -> deltas added to calibration / entralinkCalibration / frameCalibration
  function calibrateGen5(settings, model, hits) {
    var h = hits || {};
    var calibrationDelta = 0;
    var entralinkCalibrationDelta = 0;
    var frameCalibrationDelta = 0;
    switch (model.mode) {
      case "STANDARD":
        if (hasHit(h.secondHit)) calibrationDelta = calibrateToDelays(settings, calibrateSecond(model.targetSecond, h.secondHit));
        break;
      case "C_GEAR":
        if (hasHit(h.delayHit)) calibrationDelta = calibrateToDelays(settings, calibrateDelay(settings, model.targetDelay, h.delayHit));
        break;
      case "ENTRALINK":
      case "ENTRALINK_PLUS":
        if (hasHit(h.secondHit) && h.secondHit !== model.targetSecond) {
          calibrationDelta = calibrateToDelays(settings, calibrateSecond(model.targetSecond, h.secondHit));
        }
        if (hasHit(h.delayHit) && h.delayHit !== model.targetDelay) {
          entralinkCalibrationDelta = calibrateToDelays(settings, calibrateEntralinkDelay(settings, model.targetDelay, h.delayHit));
        }
        if (model.mode === "ENTRALINK_PLUS" && hasHit(h.advancesHit) && h.advancesHit !== model.targetAdvances) {
          frameCalibrationDelta = calibrateEntralinkAdvances(model.targetAdvances, h.advancesHit);
        }
        break;
    }
    return { calibrationDelta: calibrationDelta, entralinkCalibrationDelta: entralinkCalibrationDelta, frameCalibrationDelta: frameCalibrationDelta };
  }

  function gen5Calibrated(settings, model, hits) {            // Gen5Panel.tsx:63-74
    var r = calibrateGen5(settings, model, hits);
    var next = {};
    for (var k in model) next[k] = model[k];
    next.calibration = model.calibration + r.calibrationDelta;
    next.entralinkCalibration = model.entralinkCalibration + r.entralinkCalibrationDelta;
    next.frameCalibration = model.frameCalibration + r.frameCalibrationDelta;
    return next;
  }

  // ---- Custom timer, customTimer.ts ----
  function customPhases(settings, phases) {                   // customTimer.ts:10-18
    var out = [];
    for (var i = 0; i < phases.length; i++) {
      var p = phases[i];
      var value = p.target;
      if (p.unit === "advances" || p.unit === "hex") value = toMilliseconds(settings, value);
      out.push(value + p.calibration);
    }
    return out;
  }

  function calibrateCustomPhase(settings, phase, hit) {       // customTimer.ts:20-29 -> delta added to phase.calibration
    if (phase.unit !== "ms") return toMilliseconds(settings, phase.target - hit);
    return phase.target - hit;
  }

  function customPhaseCalibrated(settings, phase, hit) {      // CustomPanel.tsx:104-110
    return { unit: phase.unit, target: phase.target, calibration: phase.calibration + calibrateCustomPhase(settings, phase, hit) };
  }

  return {
    GBA_FPS: GBA_FPS,
    NDS_SLOT1_FPS: NDS_SLOT1_FPS,
    NDS_SLOT2_FPS: NDS_SLOT2_FPS,
    CONSOLES: CONSOLES,
    CONSOLE_NAMES: CONSOLE_NAMES,
    MINIMUM_LENGTH_MS: MINIMUM_LENGTH_MS,
    MINUTE_MS: MINUTE_MS,
    SECOND_OFFSET_MS: SECOND_OFFSET_MS,
    SECOND_HIT_HALF_MS: SECOND_HIT_HALF_MS,
    CLOSE_THRESHOLD_MS: CLOSE_THRESHOLD_MS,
    UPDATE_FACTOR: UPDATE_FACTOR,
    CLOSE_UPDATE_FACTOR: CLOSE_UPDATE_FACTOR,
    ENTRALINK_PHASE1_MS: ENTRALINK_PHASE1_MS,
    ENTRALINK_FRAME_RATE: ENTRALINK_FRAME_RATE,
    DEFAULTS: DEFAULTS,
    GEN5_COMMUNITY_CALIBRATION: GEN5_COMMUNITY_CALIBRATION,
    GEN3_MODES: GEN3_MODES,
    GEN5_MODES: GEN5_MODES,
    CUSTOM_UNITS: CUSTOM_UNITS,
    roundHalfToEven: roundHalfToEven,
    settingsOf: settingsOf,
    fps: fps,
    msPerFrame: msPerFrame,
    toDelays: toDelays,
    toMilliseconds: toMilliseconds,
    calibrateToDelays: calibrateToDelays,
    calibrateToMilliseconds: calibrateToMilliseconds,
    createCalibration: createCalibration,
    toMinimumLength: toMinimumLength,
    minutesBeforeTarget: minutesBeforeTarget,
    framePhase: framePhase,
    framePhases: framePhases,
    calibrateFrame: calibrateFrame,
    variableFramePhases: variableFramePhases,
    secondPhases: secondPhases,
    calibrateSecond: calibrateSecond,
    delayPhases: delayPhases,
    calibrateDelay: calibrateDelay,
    entralinkPhases: entralinkPhases,
    calibrateEntralinkDelay: calibrateEntralinkDelay,
    enhancedEntralinkPhases: enhancedEntralinkPhases,
    calibrateEntralinkAdvances: calibrateEntralinkAdvances,
    gen3Phases: gen3Phases,
    calibrateGen3: calibrateGen3,
    gen3Calibrated: gen3Calibrated,
    gen4Calibration: gen4Calibration,
    gen4Phases: gen4Phases,
    gen4MinutesBefore: gen4MinutesBefore,
    calibrateGen4: calibrateGen4,
    gen4Calibrated: gen4Calibrated,
    gen5Phases: gen5Phases,
    gen5MinutesBefore: gen5MinutesBefore,
    calibrateGen5: calibrateGen5,
    gen5Calibrated: gen5Calibrated,
    customPhases: customPhases,
    calibrateCustomPhase: calibrateCustomPhase,
    customPhaseCalibrated: customPhaseCalibrated
  };
});
