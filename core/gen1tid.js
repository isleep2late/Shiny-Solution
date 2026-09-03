// Gen 1 Trainer ID cue arithmetic (Red / Blue / Yellow hold-START methodologies), the
// save-corruption reset metronome, the moderator verify, the Gen 3 Emerald / FireRed /
// LeafGreen "typed Trainer ID -> Secret ID" model, and the runner's press-jitter model.
// A port of RNG Solution's rngsolution/timeline.py, gen3.py and jitter.py; the Python is
// the oracle (tests/gen1tid-vectors.json, emitted by RNG Solution tests/emit_vectors.py).
// Pure functions: no I/O, no DOM. Data (tables, families, reset models, target sets, SID
// models) is passed in from core/data/gen1-tid.json and core/data/gen3-sid.json.
// Every number that reaches the arithmetic is checked at the boundary (checkNumber / checkInt):
// a form field hands over strings, and 80 + "358" is "80358", not a press frame. Numeric strings
// are converted; anything else (NaN, infinities, booleans, BigInts, objects, blanks) is refused
// with a ValueError. Target sets are never defaulted: every verdict takes the sets in force
// for the game (targetSetsFor(data, game)).
// Calibration sample records keep their snake_case keys: they are the on-disk config
// format shared by every head.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rng.js"));
  else root.ShinyGen1Tid = factory(root.ShinyCore);
})(typeof self !== "undefined" ? self : this, function (core) {
  // ---- Game Boy timing -----------------------------------------------------------
  var FPS = 4194304.0 / 70224.0;            // 59.7275 frames per second
  var FRAME_MS = 1000.0 / FPS;              // 16.7427 ms
  var MENU_TO_TABLE_FRAMES = 80;            // A press frame = menu + 80 + offset (the settle)

  var COUNT_IN_TONE = [880.0, 60.0];
  var A_CUE_TONE = [1320.0, 150.0];
  var RESET_BEAT_TONE = [440.0, 50.0];
  var A_BEAT_TONE = [1320.0, 50.0];
  var HOLD_TONE = [660.0, 80.0];
  var MENU_MARK_TONE = [990.0, 40.0];

  var ANCHOR_MENU = "menu";
  var ANCHOR_POWERON = "poweron";
  var ANCHOR_RESET = "reset";
  var ANCHORS = [ANCHOR_MENU, ANCHOR_POWERON, ANCHOR_RESET];

  var OUTLIER_FRAMES = 60;                  // an in-table hit further than this from the aim teaches nothing
  var COUNT_IN_CLEAR_S = 0.5;               // power-on / reset anchors: no count-in beep before menu + this

  function isNil(x) { return x === null || x === undefined; }
  function fail(msg) { var e = new Error(msg); e.name = "ValueError"; throw e; }

  function describeValue(x) {
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (x === null) return "null";
    if (x === undefined) return "undefined";
    if (typeof x === "object") return Array.isArray(x) ? "an array" : "an object";
    return "" + x;
  }
  // A real number (NaN allowed: a statistic of fewer than two samples is NaN and must propagate).
  function checkReal(x, what) {
    var v = x;
    if (typeof v === "string" && v.trim() !== "") {
      v = Number(v);
      if (v !== v) fail(what + " must be a number (got " + describeValue(x) + ")");
    }
    if (typeof v !== "number") fail(what + " must be a number (got " + describeValue(x) + ")");
    return v;
  }
  // A finite number.
  function checkNumber(x, what) {
    var v = checkReal(x, what);
    if (v !== v || v === Infinity || v === -Infinity) fail(what + " must be a finite number (got " + describeValue(x) + ")");
    return v;
  }
  // A whole number, optionally bounded (inclusive).
  function checkInt(x, what, lo, hi) {
    var v = checkNumber(x, what);
    if (Math.floor(v) !== v) fail(what + " must be a whole number (got " + v + ")");
    if (!isNil(lo) && v < lo) fail(what + " must be " + lo + " or more (got " + v + ")");
    if (!isNil(hi) && v > hi) fail(what + " must be at most " + hi + " (got " + v + ")");
    return v;
  }
  function checkTid(tid) { return checkInt(tid, "a Trainer ID", 0, 0xFFFF); }
  function checkSid(sid) { return checkInt(sid, "a Secret ID", 0, 0xFFFF); }
  function checkPid(pid) { return checkInt(pid, "a PID", 0, 0xFFFFFFFF); }
  function checkOffset(offset) { return checkInt(offset, "a table offset", 0); }

  // Python's "%.Nf": correctly rounded from the exact binary value, ties to even. JS toFixed
  // rounds exact ties towards +infinity, so exact ties (a value with .25 / .75 style fractions
  // that is representable) are detected and re-rounded.
  function pyFixed(x, digits, plus) {
    if (x !== x) return "nan";
    if (x === Infinity) return plus ? "+inf" : "inf";
    if (x === -Infinity) return "-inf";
    var scale = Math.pow(10, digits);
    var y = x * scale;
    var fl = Math.floor(y);
    var s;
    if (y - fl === 0.5 && (2 * fl + 1) % Math.pow(5, digits) === 0) {
      var n = fl % 2 === 0 ? fl : fl + 1;          // half to even
      s = (n / scale).toFixed(digits);
      if (n === 0 && x < 0) s = "-" + s;           // Python keeps the sign of a negative that rounds to zero
    } else {
      s = x.toFixed(digits);
    }
    if (plus && x >= 0 && s.charAt(0) !== "-") s = "+" + s;
    return s;
  }
  function hex(n, width) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < width) s = "0" + s;
    return s;
  }

  function framesToSeconds(frames) { return frames / FPS; }
  function secondsToFrames(seconds) { return seconds * FPS; }
  function framesToMs(frames) { return frames * FRAME_MS; }
  function msToFrames(ms) { return ms / FRAME_MS; }

  // ---- Cues ----------------------------------------------------------------------
  function cue(t, freq, ms, label, kind) {
    return { t: Number(t), freq: Number(freq), ms: Number(ms), label: label, kind: kind };
  }

  function makeSchedule(anchor, cues, tA, holdLo, holdHi, menu, droppedCountIn) {
    var sorted = cues.slice().sort(function (a, b) { return a.t - b.t; });   // stable (node 12+)
    var s = {
      anchor: anchor,
      cues: sorted,
      tA: tA,
      holdLo: isNil(holdLo) ? null : holdLo,
      holdHi: isNil(holdHi) ? null : holdHi,
      menu: isNil(menu) ? null : menu,
      droppedCountIn: droppedCountIn || 0
    };
    s.countInTimes = countInTimes(s);
    s.duration = duration(s);
    return s;
  }
  function countInTimes(s) {
    var out = [];
    for (var i = 0; i < s.cues.length; i++) if (s.cues[i].kind === "count") out.push(s.cues[i].t);
    return out;
  }
  function duration(s) {
    var best = 0.0;
    if (!s.cues.length) return 0.0;
    for (var i = 0; i < s.cues.length; i++) {
      var d = s.cues[i].t + s.cues[i].ms / 1000.0;
      if (i === 0 || d > best) best = d;
    }
    return best;
  }

  function targetSeconds(offset) { return framesToSeconds(MENU_TO_TABLE_FRAMES + checkOffset(offset)); }
  function pressFrameFromMenu(offset) { return MENU_TO_TABLE_FRAMES + checkOffset(offset); }
  function cueDelaySeconds(offset, correctionMs) { return targetSeconds(offset) - checkNumber(correctionMs, "the correction (ms)") / 1000.0; }

  function countInCues(tA, beeps, spacingS, notBefore) {
    if (isNil(notBefore)) notBefore = 0.0;
    spacingS = checkNumber(spacingS, "the count-in spacing (s)");
    beeps = checkInt(beeps, "the count-in beeps");
    if (!(spacingS > 0)) fail("count-in spacing must be positive (got " + spacingS + " s)");
    if (beeps < 0) fail("count-in beeps must be 0 or more");
    var cues = [], dropped = 0;
    for (var k = beeps; k > 0; k--) {
      var t = tA - k * spacingS;
      if (t < notBefore) { dropped++; continue; }
      cues.push(cue(t, COUNT_IN_TONE[0], COUNT_IN_TONE[1], "count-" + k, "count"));
    }
    return { cues: cues, dropped: dropped };
  }

  function menuSchedule(offset, correctionMs, beeps, spacingS) {
    if (isNil(beeps)) beeps = 4;
    if (isNil(spacingS)) spacingS = 1.0;
    var tA = cueDelaySeconds(offset, correctionMs);
    if (tA <= 0) fail("the A cue would be due before the anchor (offset " + offset + ", correction " + correctionMs + " ms)");
    var ci = countInCues(tA, beeps, spacingS);
    var cues = ci.cues.slice();
    cues.push(cue(tA, A_CUE_TONE[0], A_CUE_TONE[1], "A", "A"));
    return makeSchedule(ANCHOR_MENU, cues, tA, null, null, null, ci.dropped);
  }

  // family: {hold_lo_frame, hold_hi_frame, menu_frame} (a methodology's "timing" block)
  function poweronSchedule(family, offset, correctionMs, beeps, spacingS, extraS, anchor) {
    if (isNil(beeps)) beeps = 4;
    if (isNil(spacingS)) spacingS = 1.0;
    if (isNil(extraS)) extraS = 0.0;
    if (isNil(anchor)) anchor = ANCHOR_POWERON;
    if (!family || typeof family !== "object") fail("the " + anchor + " anchor needs the family's boot timing");
    offset = checkOffset(offset);
    correctionMs = checkNumber(correctionMs, "the correction (ms)");
    extraS = checkNumber(extraS, "the reset delay (s)");
    var holdLo = framesToSeconds(checkNumber(family.hold_lo_frame, "hold_lo_frame")) + extraS;
    var holdHi = framesToSeconds(checkNumber(family.hold_hi_frame, "hold_hi_frame")) + extraS;
    var menu = framesToSeconds(checkNumber(family.menu_frame, "menu_frame")) + extraS;
    var tA = menu + targetSeconds(offset) - correctionMs / 1000.0;
    if (tA <= menu) fail("the A cue would be due before the menu (offset " + offset + ", correction " + correctionMs + " ms)");
    var cues = [
      cue(holdLo, HOLD_TONE[0], HOLD_TONE[1], "hold-start", "hold"),
      cue((holdLo + holdHi) / 2.0, HOLD_TONE[0], HOLD_TONE[1], "hold-centre", "hold"),
      cue(menu, MENU_MARK_TONE[0], MENU_MARK_TONE[1], "menu", "menu"),
      cue(menu + 0.08, MENU_MARK_TONE[0], MENU_MARK_TONE[1], "menu-2", "menu")
    ];
    var ci = countInCues(tA, beeps, spacingS, menu + COUNT_IN_CLEAR_S);
    cues = cues.concat(ci.cues);
    cues.push(cue(tA, A_CUE_TONE[0], A_CUE_TONE[1], "A", "A"));
    return makeSchedule(anchor, cues, tA, holdLo, holdHi, menu, ci.dropped);
  }

  function resetAnchorExtraSeconds(resetModel) {
    if (!("fade_lo_frames" in resetModel)) fail("this reset model has no fade, so there is no reset anchor");
    var fadeMean = (resetModel.fade_lo_frames + resetModel.fade_hi_frames) / 2.0;
    return framesToSeconds(fadeMean + resetModel.stall_frames);
  }

  // schedule(anchor, offset, correctionMs, options): options.family (the timing block; needed
  // for the power-on and reset anchors), options.beeps, options.spacingS, options.resetExtraS
  // (or options.resetModel, from which it is computed), options.methodology (the gen1-tid.json
  // record: an anchor it does not list is refused, as RNG Solution's cue --anchor refuses it).
  function schedule(anchor, offset, correctionMs, options) {
    var o = options || {};
    var beeps = isNil(o.beeps) ? 4 : o.beeps;
    var spacing = isNil(o.spacingS) ? 1.0 : o.spacingS;
    if (o.methodology) {
      var allowed = o.methodology.anchors || [];
      if (allowed.indexOf(anchor) === -1) {
        fail("this methodology has no " + JSON.stringify(anchor) + " anchor (its anchors: " + allowed.join(", ") + ")");
      }
    }
    if (anchor === ANCHOR_MENU) return menuSchedule(offset, correctionMs, beeps, spacing);
    if (anchor === ANCHOR_POWERON) {
      if (!o.family) fail("the power-on anchor needs the family's boot timing");
      return poweronSchedule(o.family, offset, correctionMs, beeps, spacing, 0.0, ANCHOR_POWERON);
    }
    if (anchor === ANCHOR_RESET) {
      var extra = o.resetExtraS;
      if (isNil(extra) && o.resetModel) extra = resetAnchorExtraSeconds(o.resetModel);
      if (isNil(extra)) fail("the reset anchor needs the console's reset delay (fade + stall)");
      if (!o.family) fail("the reset anchor needs the family's boot timing");
      return poweronSchedule(o.family, offset, correctionMs, beeps, spacing, extra, ANCHOR_RESET);
    }
    fail("unknown anchor " + JSON.stringify(anchor));
  }

  // ---- Trainer IDs ---------------------------------------------------------------
  function parseDigits(s, base) {
    var re = base === 16 ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/;
    if (!re.test(s)) fail("invalid literal " + JSON.stringify(s));
    return parseInt(s, base);
  }

  function parseTid(text) {
    var s = ("" + text).trim().replace(/ /g, "");
    if (!s) fail("empty");
    var v;
    if (s.charAt(0) === "$") v = parseDigits(s.slice(1), 16);
    else if (s.slice(0, 2).toLowerCase() === "0x") v = parseDigits(s.slice(2), 16);
    else if (s.charAt(s.length - 1).toLowerCase() === "h") v = parseDigits(s.slice(0, -1), 16);
    else v = parseDigits(s, 10);
    if (!(v >= 0 && v <= 0xFFFF)) fail("a Trainer ID is 0..65535");
    return v;
  }

  function formatTid(tid) { tid = checkTid(tid); return tid + " ($" + hex(tid, 4) + ")"; }

  // A named acceptance set of Trainer IDs (platforms.json / gen1-tid.json "target_sets").
  function makeTargetSet(key, spec) {
    var ts = {
      key: key,
      name: isNil(spec.name) ? key : spec.name,
      kind: isNil(spec.kind) ? "list" : spec.kind,
      games: (spec.games || []).slice(),
      provenance: spec.provenance || "",
      route: spec.route || "",
      tids: [],
      hi: null,
      loRanges: []
    };
    if (ts.kind === "list") {
      ts.tids = (spec.tids || []).map(function (t) { return parseInt("" + t, 16); }).sort(function (a, b) { return a - b; });
    } else if (ts.kind === "sled") {
      ts.hi = parseInt("" + spec.hi, 16);
      ts.loRanges = (spec.lo_ranges || []).map(function (r) { return [parseInt("" + r[0], 16), parseInt("" + r[1], 16)]; });
    } else {
      fail("target set " + key + ": unknown kind " + JSON.stringify(ts.kind));
    }
    return ts;
  }
  function setAccepts(ts, tid) {
    tid = checkTid(tid);
    if (ts.kind === "list") return ts.tids.indexOf(tid) !== -1;
    if ((tid >> 8) !== ts.hi) return false;
    var lo = tid & 0xFF;
    for (var i = 0; i < ts.loRanges.length; i++) if (ts.loRanges[i][0] <= lo && lo <= ts.loRanges[i][1]) return true;
    return false;
  }
  function setTrap(ts, tid) { tid = checkTid(tid); return ts.kind === "sled" && (tid >> 8) === ts.hi && !setAccepts(ts, tid); }
  function setDescribe(ts) {
    if (ts.kind === "list") {
      return ts.key + ": " + ts.tids.map(function (t) { return "$" + hex(t, 4) + " (" + t + ")"; }).join(", ");
    }
    return ts.key + ": high byte $" + hex(ts.hi, 2) + ", low byte " +
      ts.loRanges.map(function (r) { return "$" + hex(r[0], 2) + "-$" + hex(r[1], 2); }).join(" or ");
  }

  // The owner's $40xx sled as a set object (Red and Blue list it; Yellow does not). It is NOT a
  // default: a verdict with no sets is an error, so a $40xx Trainer ID on Yellow, where no set
  // accepts it, is "no" and never "RUN".
  var SLED_40XX = makeTargetSet("sled-40xx", { kind: "sled", hi: "40", lo_ranges: [["00", "38"], ["3A", "5C"]],
    name: "$40xx bank-$1D sled (Red / Blue Any% save corruption)" });

  function requireSets(sets) {
    if (isNil(sets)) fail("target sets are required: pass targetSetsFor(data, game)");
    if (!Array.isArray(sets)) fail("target sets must be an array of target set objects (got " + describeValue(sets) + ")");
    return sets.slice();
  }
  function setsAccepting(tid, sets) { return requireSets(sets).filter(function (s) { return setAccepts(s, tid); }); }

  function verdict(tid, sets) {
    var all = requireSets(sets);
    tid = checkTid(tid);
    if (all.some(function (s) { return setAccepts(s, tid); })) return "RUN";
    if (all.some(function (s) { return setTrap(s, tid); })) return "40!";
    return "no";
  }

  var VERDICT_TEXT = {
    "RUN": "route-valid for Any% save corruption",
    "40!": "$40 high byte but the low byte overshoots the sled: the route hard-locks",
    "no": "not route-valid (the route needs $4000-$4038 or $403A-$405C)"
  };

  function verdictText(tid, sets) {
    var v = verdict(tid, sets);
    if (v === "RUN") {
      return "route-valid for Any% save corruption (target set " + setsAccepting(tid, sets).map(function (s) { return s.key; }).join(", ") + ")";
    }
    if (v === "40!" && (tid & 0xFF) === 0x39) return "$4039 is the one hole inside the sled (excluded by the route rule): not usable";
    if (v === "no") return "not route-valid (accepted by none of: " + sets.map(function (s) { return s.key; }).join(", ") + ")";
    return VERDICT_TEXT[v];
  }

  // Tables are arrays indexed by offset (from gen1-tid.json table_data) or {offset: tid} objects.
  function tableEntries(table) {
    var out = [];
    if (Array.isArray(table)) {
      for (var i = 0; i < table.length; i++) if (!isNil(table[i])) out.push([i, table[i]]);
    } else {
      Object.keys(table).forEach(function (k) { out.push([Number(k), table[k]]); });
      out.sort(function (a, b) { return a[0] - b[0]; });
    }
    return out;
  }
  function decodeTable(tableData) {
    if (!tableData || typeof tableData.tids_hex !== "string") fail("table_data needs a tids_hex string");
    var s = tableData.tids_hex, out = [];
    var offsetMin = isNil(tableData.offset_min) ? 0 : checkInt(tableData.offset_min, "offset_min", 0);
    for (var i = 0; i < offsetMin; i++) out.push(null);
    for (var j = 0; j + 4 <= s.length; j += 4) out.push(parseInt(s.substr(j, 4), 16));
    return out;
  }

  function routeValidTargets(table, sets) {
    var all = requireSets(sets);
    return tableEntries(table).filter(function (e) { return verdict(e[1], all) === "RUN"; });
  }

  function invert(table, tid) {
    tid = checkTid(tid);
    return tableEntries(table).filter(function (e) { return e[1] === tid; }).map(function (e) { return e[0]; });
  }

  function nearestOffset(offsets, guess) {
    if (!offsets || !offsets.length) return null;
    guess = checkNumber(guess, "the guessed offset");
    var best = null;
    for (var i = 0; i < offsets.length; i++) {
      var o = offsets[i];
      if (best === null || Math.abs(o - guess) < Math.abs(best - guess) || (Math.abs(o - guess) === Math.abs(best - guess) && o < best)) best = o;
    }
    return best;
  }

  // ---- Calibration ---------------------------------------------------------------
  function errorFrames(hitOffset, aimedOffset) { return checkOffset(hitOffset) - checkOffset(aimedOffset); }
  function isOutlier(hitOffset, aimedOffset) { return Math.abs(errorFrames(hitOffset, aimedOffset)) > OUTLIER_FRAMES; }
  function impliedCorrection(correctionUsedMs, hitOffset, aimedOffset) {
    return checkNumber(correctionUsedMs, "the correction used (ms)") + framesToMs(errorFrames(hitOffset, aimedOffset));
  }

  // opts: attempt (a tag unique to one cue playback), note, player, methodology
  function makeSample(tid, aimedOffset, hitOffset, correctionUsedMs, opts) {
    var o = opts || {};
    return {
      tid: checkTid(tid),
      aimed: checkOffset(aimedOffset),
      hit: checkOffset(hitOffset),
      correction_used_ms: checkNumber(correctionUsedMs, "the correction used (ms)"),
      implied_ms: impliedCorrection(correctionUsedMs, hitOffset, aimedOffset),
      attempt: isNil(o.attempt) ? null : o.attempt,
      note: isNil(o.note) ? "" : o.note,
      player: isNil(o.player) ? null : o.player,
      methodology: isNil(o.methodology) ? null : o.methodology
    };
  }

  function meth(s) { return isNil(s.methodology) ? null : s.methodology; }

  function splitByMethodology(samples, methodology) {
    var m = isNil(methodology) ? null : methodology;
    return {
      kept: samples.filter(function (s) { return meth(s) === m; }),
      rest: samples.filter(function (s) { return meth(s) !== m; })
    };
  }

  function isDuplicate(samples, sample) {
    var same = samples.filter(function (s) { return meth(s) === meth(sample); });
    if (!same.length) return false;
    var last = same[same.length - 1];
    if (last.tid !== sample.tid || last.aimed !== sample.aimed) return false;
    if (last.attempt && sample.attempt && last.attempt !== sample.attempt) return false;
    return true;
  }

  function guardError(name, msg) { var e = new Error(msg); e.name = name; return e; }

  function addSample(samples, sample, force) {
    if (!force && isOutlier(sample.hit, sample.aimed)) {
      throw guardError("OutlierSample", Math.abs(errorFrames(sample.hit, sample.aimed)) + " frames from the aim is more than " +
        OUTLIER_FRAMES + ": not an attempt to calibrate on");
    }
    if (!force && isDuplicate(samples, sample)) {
      throw guardError("DuplicateSample", "this Trainer ID was already entered for the same aim (same attempt twice?)");
    }
    return samples.concat([sample]);
  }

  function dropLast(samples) {
    if (!samples.length) return { rest: [], dropped: null };
    return { rest: samples.slice(0, -1), dropped: samples[samples.length - 1] };
  }

  function dropLastUnder(samples, methodology) {
    var m = isNil(methodology) ? null : methodology;
    for (var i = samples.length - 1; i >= 0; i--) {
      if (meth(samples[i]) === m) return { rest: samples.slice(0, i).concat(samples.slice(i + 1)), dropped: samples[i] };
    }
    return { rest: samples.slice(), dropped: null };
  }

  function mean(xs) {
    if (!xs.length) return NaN;
    var s = 0.0;
    for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  function meanCorrection(samples, defaultMs) {
    if (!samples.length) return checkNumber(defaultMs, "the default correction (ms)");
    return mean(samples.map(function (s) { return s.implied_ms; }));
  }

  function samplePlayers(samples) {
    var seen = {}, out = [];
    samples.forEach(function (s) {
      var p = isNil(s.player) ? null : s.player;
      var k = p === null ? " null" : "s:" + p;
      if (!seen[k]) { seen[k] = true; out.push(p); }
    });
    return out.sort(function (a, b) {
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
      return ("" + a) < ("" + b) ? -1 : ("" + a) > ("" + b) ? 1 : 0;
    });
  }

  // ---- Save-corruption reset -----------------------------------------------------
  function resetInterval(model, path, fadeFrames, adjustFrames) {
    if (isNil(path)) path = "route";
    if (isNil(adjustFrames)) adjustFrames = 0.0;
    adjustFrames = checkNumber(adjustFrames, "the adjust (frames)");
    if (!isNil(fadeFrames)) fadeFrames = checkNumber(fadeFrames, "the fade (frames)");
    var p = model.paths[path];
    if (!p) fail("no reset path " + JSON.stringify(path));
    var c1Max = p.c1_max_frames, p1Min = p.p1_min_frames, c1Mean = p.c1_mean_frames, p1Mean = p.p1_mean_frames;
    var r = isNil(p.pad_read_frames) ? 0.177 : p.pad_read_frames;
    var rMin = isNil(p.pad_read_min_frames) ? r : p.pad_read_min_frames;
    var rMax = isNil(p.pad_read_max_frames) ? r : p.pad_read_max_frames;
    var lo, hi, mlo, mhi, physLo, physHi, consLo, consHi;
    if ("fade_lo_frames" in model) {
      var fLo = model.fade_lo_frames, fHi = model.fade_hi_frames;
      if (!isNil(fadeFrames)) {
        var half = (fHi - fLo) / 2.0;
        fLo = fadeFrames - half; fHi = fadeFrames + half;
      }
      var fMean = (fLo + fHi) / 2.0;
      lo = fHi - p1Min; hi = fLo - c1Max;
      mlo = fMean - p1Mean; mhi = fMean - c1Mean;
      physLo = lo + r; physHi = hi - 1.0 + r;
      consLo = lo + rMax; consHi = hi - 1.0 + rMin;
    } else {
      lo = c1Max; hi = p1Min;
      mlo = c1Mean; mhi = p1Mean;
      physLo = c1Max + 1.0 - r; physHi = p1Min - r;
      consLo = c1Max + 1.0 - rMin; consHi = p1Min - rMax;
    }
    var a = adjustFrames;
    var out = {
      order: model.order.slice(),
      boundaryLoFrames: lo + a, boundaryHiFrames: hi + a,
      meanLoFrames: mlo + a, meanHiFrames: mhi + a,
      physLoFrames: physLo + a, physHiFrames: physHi + a,
      consLoFrames: consLo + a, consHiFrames: consHi + a
    };
    out.boundaryCentreFrames = (out.boundaryLoFrames + out.boundaryHiFrames) / 2.0;
    out.centreFrames = (out.physLoFrames + out.physHiFrames) / 2.0;
    out.centreMs = framesToMs(out.centreFrames);
    out.boundaryCentreMs = framesToMs(out.boundaryCentreFrames);
    out.boundaryLoMs = framesToMs(out.boundaryLoFrames);
    out.boundaryHiMs = framesToMs(out.boundaryHiFrames);
    out.meanLoMs = framesToMs(out.meanLoFrames);
    out.meanHiMs = framesToMs(out.meanHiFrames);
    out.physLoMs = framesToMs(out.physLoFrames);
    out.physHiMs = framesToMs(out.physHiFrames);
    out.consLoMs = framesToMs(out.consLoFrames);
    out.consHiMs = framesToMs(out.consHiFrames);
    return out;
  }

  function resetSchedule(intervalMs, order, pairs, cadenceS, leadS) {
    if (isNil(pairs)) pairs = 15;
    if (isNil(cadenceS)) cadenceS = 2.0;
    if (isNil(leadS)) leadS = 1.0;
    intervalMs = checkNumber(intervalMs, "the interval (ms)");
    pairs = checkInt(pairs, "pairs");
    cadenceS = checkNumber(cadenceS, "the cadence (s)");
    leadS = checkNumber(leadS, "the lead-in (s)");
    if (!Array.isArray(order) || order.length !== 2 || typeof order[0] !== "string" || typeof order[1] !== "string" || !order[0] || !order[1]) {
      fail("order must be the reset's two actions in order (for example [\"RESET\", \"A\"])");
    }
    if (pairs < 1) fail("pairs must be 1 or more");
    if (intervalMs <= 0) fail("the interval must be positive");
    if (cadenceS * 1000.0 < intervalMs + 100.0) fail("cadence (" + cadenceS + " s) must be at least the interval (" + intervalMs + " ms) plus 100 ms");
    var firstTone = order[0] === "RESET" ? RESET_BEAT_TONE : A_BEAT_TONE;
    var secondTone = order[1] === "A" ? A_BEAT_TONE : RESET_BEAT_TONE;
    var firstKind = order[0] === "RESET" ? "reset" : "abeat";
    var secondKind = order[1] === "A" ? "abeat" : "power";
    var cues = [];
    for (var j = 0; j < pairs; j++) {
      var t0 = leadS + j * cadenceS;
      cues.push(cue(t0, firstTone[0], firstTone[1], order[0] + "-" + (j + 1), firstKind));
      cues.push(cue(t0 + intervalMs / 1000.0, secondTone[0], secondTone[1], order[1] + "-" + (j + 1), secondKind));
    }
    return makeSchedule("metronome", cues, null, null, null, null, 0);
  }

  // ---- Verification (moderators; human-measured input) ---------------------------
  function verify(table, tid, menuToPressS, toleranceFrames, visibleLagFrames, sets) {
    if (isNil(toleranceFrames)) toleranceFrames = 3;
    if (isNil(visibleLagFrames)) visibleLagFrames = 0.0;
    var all = requireSets(sets);
    tid = checkTid(tid);
    menuToPressS = checkNumber(menuToPressS, "the menu-to-press time (s)");
    toleranceFrames = checkNumber(toleranceFrames, "the tolerance (frames)");
    if (toleranceFrames < 0) fail("the tolerance cannot be negative");
    visibleLagFrames = checkNumber(visibleLagFrames, "the visible lag (frames)");
    var predicted = secondsToFrames(menuToPressS) - visibleLagFrames - MENU_TO_TABLE_FRAMES;
    var offsets = invert(table, tid);
    var best = nearestOffset(offsets, predicted);
    var diff = best === null ? null : best - predicted;
    return {
      predictedOffset: predicted,
      offsets: offsets,
      nearest: best,
      differenceFrames: diff,
      consistent: best !== null && Math.abs(diff) <= toleranceFrames,
      inTable: offsets.length > 0,
      verdict: verdict(tid, all),
      visibleLagFrames: visibleLagFrames
    };
  }

  // ---- Gen 3 Emerald / FireRed / LeafGreen: the Secret ID from a typed Trainer ID ----
  var GBA_FPS = core.GBA_FPS;
  var TEXT_SPEEDS = ["slow", "mid", "fast"];

  function checkState(x) { return checkInt(x, "an LCRNG state", 0, 0xFFFFFFFF); }
  function lcrngNext(x) { return core.next(checkState(x) >>> 0); }
  function lcrngJump(x, n) {
    x = checkState(x);
    n = checkInt(n, "advances");
    if (n < 0) fail("advances must be 0 or more");
    return core.jump(x >>> 0, n);
  }
  function hi16(x) { return (x >>> 16) & 0xFFFF; }
  function tsv(tid, sid) { return ((checkTid(tid) ^ checkSid(sid)) & 0xFFFF) >>> 3; }
  function psv(pid) { pid = checkPid(pid); return (((pid >>> 16) ^ (pid & 0xFFFF)) & 0xFFFF) >>> 3; }
  function shinyXor(tid, sid, pid) { pid = checkPid(pid); return (checkTid(tid) ^ checkSid(sid) ^ (pid >>> 16) ^ (pid & 0xFFFF)) & 0xFFFF; }
  function isShiny(tid, sid, pid) { return shinyXor(tid, sid, pid) < 8; }
  function shinySidsForPid(tid, pid) {
    tid = checkTid(tid); pid = checkPid(pid);
    var base = (tid ^ (pid >>> 16) ^ (pid & 0xFFFF)) & 0xFFFF, out = [];
    for (var x = 0; x < 8; x++) out.push(base ^ x);
    return out.sort(function (a, b) { return a - b; });
  }

  function sidAt(tid, k) { return hi16(lcrngJump(checkTid(tid), checkInt(k, "k (VBlanks after the seed)", 0) + 1)); }

  function sidCandidates(tid, kMin, kMax) {
    tid = checkTid(tid);
    kMin = checkInt(kMin, "k_min"); kMax = checkInt(kMax, "k_max");
    if (kMin < 0 || kMax < kMin) fail("need 0 <= k_min <= k_max (got " + kMin + ", " + kMax + ")");
    var out = [], x = lcrngJump(tid, kMin);
    for (var k = kMin; k <= kMax; k++) {
      x = lcrngNext(x);
      var sid = hi16(x);
      out.push({ k: k, sid: sid, tsv: tsv(tid, sid) });
    }
    return out;
  }

  function kForSid(tid, sid, kMax) {
    if (isNil(kMax)) kMax = 200000;
    tid = checkTid(tid); sid = checkSid(sid); kMax = checkInt(kMax, "k_max", 0);
    var out = [], x = tid;
    for (var k = 0; k <= kMax; k++) {
      x = lcrngNext(x);
      if (hi16(x) === sid) out.push(k);
    }
    return out;
  }

  function filterCandidates(cands, tid, shinyPids, nonshinyPids, tsvValue) {
    tid = checkTid(tid);
    shinyPids = (shinyPids || []).map(function (p) { return checkPid(p); });
    nonshinyPids = (nonshinyPids || []).map(function (p) { return checkPid(p); });
    if (!isNil(tsvValue)) tsvValue = checkInt(tsvValue, "a TSV", 0, 8191);
    var kept = [], why = {};
    cands.forEach(function (c) {
      var reason = null, i;
      for (i = 0; i < shinyPids.length; i++) {
        if (!isShiny(tid, c.sid, shinyPids[i])) { reason = "PID " + hex(shinyPids[i], 8) + " would not be shiny under SID " + c.sid; break; }
      }
      if (reason === null) {
        for (i = 0; i < nonshinyPids.length; i++) {
          if (isShiny(tid, c.sid, nonshinyPids[i])) { reason = "PID " + hex(nonshinyPids[i], 8) + " would be shiny under SID " + c.sid; break; }
        }
      }
      if (reason === null && !isNil(tsvValue) && c.tsv !== tsvValue) reason = "TSV " + c.tsv + " is not " + tsvValue;
      if (reason === null) kept.push(c); else why[c.k] = reason;
    });
    return { kept: kept, dropped: why };
  }

  // One pin at a time: a PID seen shiny (shiny = true) or not shiny (false) under this Trainer ID.
  function filterByPid(candidates, tid, pid, shiny) {
    return shiny ? filterCandidates(candidates, tid, [pid], [], null) : filterCandidates(candidates, tid, [], [pid], null);
  }

  function parsePid(text) {
    var s = ("" + text).trim().replace(/ /g, "");
    if (!s) fail("empty");
    var v;
    if (s.charAt(0) === "$") v = parseDigits(s.slice(1), 16);
    else if (s.slice(0, 2).toLowerCase() === "0x") v = parseDigits(s.slice(2), 16);
    else if (s.charAt(s.length - 1).toLowerCase() === "h") v = parseDigits(s.slice(0, -1), 16);
    else v = parseDigits(s, 10);
    if (!(v >= 0 && v <= 0xFFFFFFFF)) fail("a PID is 0..4294967295 (8 hex digits)");
    return v;
  }

  // The fixed frame model (gen3-sid.json methodologies[id].model): variants are input paths.
  function variantNames(model) { return Object.keys(model.variants || {}); }

  function variant(model, name) {
    var variants = model.variants;
    if (!variants || !Object.keys(variants).length) {
      var flat = {};
      Object.keys(model).forEach(function (k) { flat[k] = model[k]; });
      return flat;
    }
    name = name || model.default_variant || Object.keys(variants)[0];
    if (!(name in variants)) fail("no input path " + JSON.stringify(name) + " (choose from " + Object.keys(variants).join(", ") + ")");
    var out = {};
    Object.keys(model).forEach(function (k) { if (k !== "variants") out[k] = model[k]; });
    Object.keys(variants[name]).forEach(function (k) { out[k] = variants[name][k]; });
    out.variant = name;
    return out;
  }

  function stagePressToPress(model, nameLength, textSpeed) {
    if (isNil(textSpeed)) textSpeed = "mid";
    var m = model.text_speed[textSpeed];
    if (!m) fail("no text speed " + JSON.stringify(textSpeed));
    var measured = {}, lengths = [];
    Object.keys(m.name_lengths).forEach(function (k) { measured[Number(k)] = m.name_lengths[k].press_to_press; lengths.push(Number(k)); });
    if (nameLength in measured) {
      return model.stages.map(function (name, i) { return [name, measured[nameLength][i]]; });
    }
    var lo = Math.min.apply(null, lengths), hi = Math.max.apply(null, lengths);
    if (!(lo <= nameLength && nameLength <= hi)) fail("name length " + nameLength + " is outside the measured range " + lo + "-" + hi);
    return model.stages.map(function (name, i) {
      var d = measured[lo][i] + (nameLength - lo) * (measured[hi][i] - measured[lo][i]) / (hi - lo);
      if (Math.abs(d - Math.round(d)) > 1e-9) fail("name length " + nameLength + " gives a non-integer count for " + name);
      return [name, Math.round(d)];
    });
  }

  function kFixed(model, nameLength, textSpeed) {
    if (isNil(textSpeed)) textSpeed = "mid";
    var m = model.text_speed[textSpeed];
    var sum = 0;
    stagePressToPress(model, nameLength, textSpeed).forEach(function (e) { sum += e[1]; });
    return sum + m.last_press_to_sid;
  }

  function cueBeeps(model, nameLength, textSpeed, marginFrames) {
    var t = model.ok_to_seed, out = [];
    stagePressToPress(model, nameLength, textSpeed).forEach(function (e) {
      t += e[1] + marginFrames;
      out.push([e[0], t]);
    });
    return out;
  }

  function kWindowForCue(model, nameLength, textSpeed, marginFrames, earlyFrames, lateFrames) {
    var beeps = cueBeeps(model, nameLength, textSpeed, marginFrames);
    var kExp = kFixed(model, nameLength, textSpeed) + beeps.length * marginFrames;
    return { kExpected: kExp, kMin: kExp - earlyFrames, kMax: kExp + lateFrames, beeps: beeps };
  }

  // The window arithmetic alone: every press cued marginFrames late, only the last press's
  // own error enters k. earlyFrames / lateFrames default to the tool's -6 / +20.
  function cueWindow(kFixedValue, presses, marginFrames, earlyFrames, lateFrames) {
    if (isNil(earlyFrames)) earlyFrames = 6;
    if (isNil(lateFrames)) lateFrames = 20;
    earlyFrames = checkNumber(earlyFrames, "the early allowance (frames)");
    lateFrames = checkNumber(lateFrames, "the late allowance (frames)");
    var kExp = checkInt(kFixedValue, "k_fixed", 0) + checkInt(presses, "presses", 0) * checkNumber(marginFrames, "the margin (frames)");
    return { kExpected: kExp, kMin: kExp - earlyFrames, kMax: kExp + lateFrames };
  }

  function gbaFramesToSeconds(frames) { return checkNumber(frames, "frames") / GBA_FPS; }

  // ---- The runner's press jitter (rngsolution/jitter.py) -------------------------
  var MAD_TO_SD = 1.482602218505602;
  var MIN_ANCHOR_SD_MS = 4.0;
  var DRIFT_TAIL = 3;
  var DRIFT_THRESHOLD_MS = FRAME_MS;
  var WELCH_STRONG_T = 2.5;
  var SD_INTERVAL_CONF = 0.90;
  var SMALL_N = 5;

  function variance(xs) {
    var n = xs.length;
    if (n < 2) return NaN;
    var m = mean(xs), s = 0.0;
    for (var i = 0; i < n; i++) s += (xs[i] - m) * (xs[i] - m);
    return s / (n - 1);
  }
  function sd(xs) { var v = variance(xs); return v === v ? Math.sqrt(v) : v; }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    if (!n) return NaN;
    if (n % 2) return Number(s[(n - 1) / 2]);
    return (s[n / 2 - 1] + s[n / 2]) / 2.0;
  }
  function mad(xs) {
    if (xs.length < 2) return NaN;
    var m = median(xs);
    return median(xs.map(function (x) { return Math.abs(x - m); }));
  }
  function robustSd(xs) { var d = mad(xs); return d === d ? d * MAD_TO_SD : d; }

  function anchorStats(samples, key) {
    if (isNil(key)) key = "implied_ms";
    var xs = samples.map(function (s) { return Number(s[key]); });
    return {
      n: xs.length,
      meanMs: mean(xs),
      sdMs: sd(xs),
      robustSdMs: robustSd(xs),
      medianMs: median(xs),
      minMs: xs.length ? Math.min.apply(null, xs) : NaN,
      maxMs: xs.length ? Math.max.apply(null, xs) : NaN,
      valuesMs: xs
    };
  }

  // erf: fdlibm s_erf.c (the same algorithm and coefficients as the C library's), <1 ulp.
  var ERF = {
    erx: 8.45062911510467529297e-01, efx: 1.28379167095512586316e-01, efx8: 1.02703333676410069053e+00,
    pp: [1.28379167095512558561e-01, -3.25042107247001499370e-01, -2.84817495755985104766e-02, -5.77027029648944159157e-03, -2.37630166566501626084e-05],
    qq: [3.97917223959155352819e-01, 6.50222499887672944485e-02, 5.08130628187576562776e-03, 1.32494738004321644526e-04, -3.96022827877536812320e-06],
    pa: [-2.36211856075265944077e-03, 4.14856118683748331666e-01, -3.72207876035701323847e-01, 3.18346619901161753674e-01, -1.10894694282396677476e-01, 3.54783043256182359371e-02, -2.16637559486879084300e-03],
    qa: [1.06420880400844228286e-01, 5.40397917702171048937e-01, 7.18286544141962662868e-02, 1.26171219808761642112e-01, 1.36370839120290507362e-02, 1.19844998467991074170e-02],
    ra: [-9.86494403484714822705e-03, -6.93858572707181764372e-01, -1.05586262253232909814e+01, -6.23753324503260060396e+01, -1.62396669462573470355e+02, -1.84605092906711035994e+02, -8.12874355063065934246e+01, -9.81432934416914548592e+00],
    sa: [1.96512716674392571292e+01, 1.37657754143519042600e+02, 4.34565877475229228821e+02, 6.45387271733267880336e+02, 4.29008140027567833386e+02, 1.08635005541779435134e+02, 6.57024977031928170135e+00, -6.04244152148580987438e-02],
    rb: [-9.86494292470009928597e-03, -7.99283237680523006574e-01, -1.77579549177547519889e+01, -1.60636384855821916062e+02, -6.37566443368389627722e+02, -1.02509513161107724954e+03, -4.83519191608651397019e+02],
    sb: [3.03380607434824582924e+01, 3.25792512996573918826e+02, 1.53672958608443695994e+03, 3.19985821950859553908e+03, 2.55305040643316442583e+03, 4.74528541206955367215e+02, -2.24409524465858183362e+01]
  };
  var f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  var LITTLE = (function () { f64[0] = 1.0; return u32[1] === 0x3FF00000; })();
  function truncLow(x) { f64[0] = x; u32[LITTLE ? 0 : 1] = 0; return f64[0]; }
  function poly(c, z) { var r = c[c.length - 1]; for (var i = c.length - 2; i >= 0; i--) r = c[i] + z * r; return r; }
  function erf(x) {
    if (x !== x) return NaN;
    if (x === Infinity) return 1.0;
    if (x === -Infinity) return -1.0;
    var ax = Math.abs(x), z, r, s, P, Q;
    if (ax < 0.84375) {
      if (ax < 3.7252902984e-09) {
        if (ax < 2.848094538889218e-306) return 0.125 * (8.0 * x + ERF.efx8 * x);
        return x + ERF.efx * x;
      }
      z = x * x;
      r = poly(ERF.pp, z);
      s = 1.0 + z * poly(ERF.qq, z);
      return x + x * (r / s);
    }
    if (ax < 1.25) {
      s = ax - 1.0;
      P = poly(ERF.pa, s);
      Q = 1.0 + s * poly(ERF.qa, s);
      return x >= 0 ? ERF.erx + P / Q : -ERF.erx - P / Q;
    }
    if (ax >= 6.0) return x >= 0 ? 1.0 - 1e-300 : 1e-300 - 1.0;
    s = 1.0 / (ax * ax);
    var R, S;
    if (ax < 1.0 / 0.35) {
      R = poly(ERF.ra, s);
      S = 1.0 + s * poly(ERF.sa, s);
    } else {
      R = poly(ERF.rb, s);
      S = 1.0 + s * poly(ERF.sb, s);
    }
    z = truncLow(ax);
    r = Math.exp(-z * z - 0.5625) * Math.exp((z - ax) * (z + ax) + R / S);
    return x >= 0 ? 1.0 - r / ax : r / ax - 1.0;
  }

  // lgamma: Lanczos (g = 7, n = 9), about 1e-15 relative for z > 0.5, with the reflection below.
  var LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lgamma(1.0 - z);
    z -= 1.0;
    var x = LANCZOS[0];
    for (var i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2.0 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function phi(z) { return 0.5 * (1.0 + erf(z / Math.sqrt(2.0))); }
  function normalPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2.0 * Math.PI); }
  function bigPhiIntegral(z) { return z * phi(z) + normalPdf(z); }

  function hitProbability(sdMs, frameMs, biasMs) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    if (isNil(biasMs)) biasMs = 0.0;
    sdMs = checkReal(sdMs, "the standard deviation (ms)");
    frameMs = checkNumber(frameMs, "the frame length (ms)");
    biasMs = checkNumber(biasMs, "the bias (ms)");
    if (frameMs <= 0) fail("the frame length must be positive");
    if (sdMs < 0) fail("the standard deviation cannot be negative");
    var half = frameMs / 2.0;
    if (sdMs === 0) return (-half <= biasMs && biasMs < half) ? 1.0 : 0.0;
    return phi((half - biasMs) / sdMs) - phi((-half - biasMs) / sdMs);
  }

  function hitProbabilityQuantised(sdMs, frameMs, biasMs, phase) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    if (isNil(biasMs)) biasMs = 0.0;
    sdMs = checkReal(sdMs, "the standard deviation (ms)");
    frameMs = checkNumber(frameMs, "the frame length (ms)");
    biasMs = checkNumber(biasMs, "the bias (ms)");
    if (frameMs <= 0) fail("the frame length must be positive");
    if (sdMs < 0) fail("the standard deviation cannot be negative");
    if (!isNil(phase)) {
      if (!(0.0 <= phase && phase <= 1.0)) fail("phase is a fraction of a frame, 0..1");
      var lo = -phase * frameMs - biasMs, hi = (1.0 - phase) * frameMs - biasMs;
      if (sdMs === 0) return (lo <= 0 && 0 < hi) ? 1.0 : 0.0;
      return phi(hi / sdMs) - phi(lo / sdMs);
    }
    if (sdMs === 0) return Math.max(0.0, 1.0 - Math.abs(biasMs) / frameMs);
    var g = bigPhiIntegral;
    return (sdMs / frameMs) * (g((frameMs - biasMs) / sdMs) - 2.0 * g(-biasMs / sdMs) + g((-frameMs - biasMs) / sdMs));
  }

  function regularisedGammaP(a, x) {
    if (x <= 0) return 0.0;
    if (x < a + 1.0) {
      var term = 1.0 / a, total = 1.0 / a, ap = a;
      for (var i = 0; i < 500; i++) {
        ap += 1.0;
        term *= x / ap;
        total += term;
        if (Math.abs(term) < Math.abs(total) * 1e-15) break;
      }
      return total * Math.exp(-x + a * Math.log(x) - lgamma(a));
    }
    var tiny = 1e-300;
    var b = x + 1.0 - a, c = 1.0 / tiny, d = 1.0 / b, h = d;
    for (var j = 1; j < 500; j++) {
      var an = -j * (j - a);
      b += 2.0;
      d = an * d + b;
      if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1.0 / d;
      var delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1.0) < 1e-15) break;
    }
    return 1.0 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }

  function chi2Cdf(x, k) {
    x = checkReal(x, "x");
    k = checkInt(k, "degrees of freedom");
    if (k <= 0) fail("degrees of freedom must be positive");
    return regularisedGammaP(k / 2.0, x / 2.0);
  }

  function chi2Quantile(p, k) {
    p = checkReal(p, "p");
    k = checkInt(k, "degrees of freedom");
    if (k <= 0) fail("degrees of freedom must be positive");
    if (!(0 < p && p < 1)) fail("p must be in (0, 1)");
    var lo = 0.0, hi = Math.max(10.0, 4.0 * k);
    while (chi2Cdf(hi, k) < p) hi *= 2.0;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2.0;
      if (chi2Cdf(mid, k) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2.0;
  }

  function sdInterval(sdMs, n, conf) {
    if (isNil(conf)) conf = SD_INTERVAL_CONF;
    sdMs = checkReal(sdMs, "the standard deviation (ms)");
    n = checkInt(n, "n");
    conf = checkNumber(conf, "the confidence");
    if (n < 2 || sdMs !== sdMs) return { lo: NaN, hi: NaN };
    var k = n - 1;
    return {
      lo: sdMs * Math.sqrt(k / chi2Quantile((1.0 + conf) / 2.0, k)),
      hi: sdMs * Math.sqrt(k / chi2Quantile((1.0 - conf) / 2.0, k))
    };
  }

  function hitProbabilityRange(sdMs, n, frameMs, conf, centred) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    if (isNil(conf)) conf = SD_INTERVAL_CONF;
    if (isNil(centred)) centred = true;
    frameMs = checkNumber(frameMs, "the frame length (ms)");
    var iv = sdInterval(sdMs, n, conf);
    if (iv.lo !== iv.lo) return [NaN, NaN];
    var f = centred ? hitProbability : hitProbabilityQuantised;
    return [f(iv.hi, frameMs), f(iv.lo, frameMs)];
  }

  function hitProbabilityHeadline(sdMs, n, frameMs) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    n = checkInt(n, "n");
    if (n < SMALL_N) return { p: hitProbabilityQuantised(sdMs, frameMs), centred: false };
    return { p: hitProbability(sdMs, frameMs), centred: true };
  }

  function expectedAttempts(p) { p = checkReal(p, "P(hit)"); return p <= 0 ? Infinity : 1.0 / p; }

  function sdForProbability(p, frameMs, biasMs) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    if (isNil(biasMs)) biasMs = 0.0;
    p = checkReal(p, "p");
    if (!(0 < p && p <= 1)) fail("p must be in (0, 1]");
    if (hitProbability(0.0, frameMs, biasMs) <= p) return 0.0;
    var lo = 0.0, hi = frameMs;
    while (hitProbability(hi, frameMs, biasMs) > p) {
      hi *= 2.0;
      if (hi > 1e6) return Infinity;
    }
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2.0;
      if (hitProbability(mid, frameMs, biasMs) > p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2.0;
  }

  function welchT(a, b) {
    if (a.length < 2 || b.length < 2) return null;
    var se2 = variance(a) / a.length + variance(b) / b.length;
    if (se2 <= 0) return null;
    return (mean(a) - mean(b)) / Math.sqrt(se2);
  }

  function drift(values, opts) {
    var o = opts || {};
    var tailN = isNil(o.tailN) ? DRIFT_TAIL : o.tailN;
    var thresholdMs = isNil(o.thresholdMs) ? DRIFT_THRESHOLD_MS : o.thresholdMs;
    var minHead = isNil(o.minHead) ? DRIFT_TAIL : o.minHead;
    var strongT = isNil(o.strongT) ? WELCH_STRONG_T : o.strongT;
    var vals = values.map(Number), n = vals.length;
    var out = { flag: false, n: n, tailN: tailN, headN: Math.max(0, n - tailN), thresholdMs: thresholdMs, shiftMs: null, welchT: null,
      strength: null, headMeanMs: null, tailMeanMs: null, reason: "" };
    if (n < tailN + minHead) {
      out.reason = "too few samples (" + n + "; drift needs " + (tailN + minHead) + ")";
      return out;
    }
    var head = vals.slice(0, n - tailN), tail = vals.slice(n - tailN);
    var hm = mean(head), tm = mean(tail), t = welchT(tail, head);
    out.headN = head.length; out.headMeanMs = hm; out.tailMeanMs = tm; out.shiftMs = tm - hm; out.welchT = t;
    var shifted = Math.abs(tm - hm) >= thresholdMs;
    out.flag = shifted && (t === null || Math.abs(t) >= strongT);
    if (out.flag) {
      out.strength = "strong";
      out.reason = "the last " + tailN + " samples' mean is " + pyFixed(tm - hm, 1, true) + " ms from the earlier " + head.length +
        " (threshold " + pyFixed(thresholdMs, 1) + " ms)";
    } else if (shifted) {
      out.strength = "weak";
      out.reason = "the last " + tailN + " samples' mean is " + pyFixed(tm - hm, 1, true) + " ms from the earlier " + head.length +
        ", but within their scatter (Welch t " + pyFixed(t, 2) + ", below " + pyFixed(strongT, 1) + "): not flagged";
    } else {
      out.reason = "the last " + tailN + " samples' mean is " + pyFixed(tm - hm, 1, true) + " ms from the earlier " + head.length +
        ": within " + pyFixed(thresholdMs, 1) + " ms";
    }
    return out;
  }

  // estimates: [[value, variance], ...] -> {value, variance, weights}
  function fuse(estimates) {
    if (!estimates || !estimates.length) fail("nothing to fuse");
    estimates.forEach(function (e) { if (!(e[1] > 0)) fail("every variance must be positive (got " + e[1] + ")"); });
    var ws = estimates.map(function (e) { return 1.0 / e[1]; });
    var total = 0.0, i;
    for (i = 0; i < ws.length; i++) total += ws[i];
    var value = 0.0;
    for (i = 0; i < ws.length; i++) value += ws[i] * estimates[i][0];
    value /= total;
    return { value: value, variance: 1.0 / total, weights: ws.map(function (w) { return w / total; }) };
  }

  function splitAnchorSd(totalSdMs, pressSdMs, minAnchorSdMs) {
    if (isNil(minAnchorSdMs)) minAnchorSdMs = MIN_ANCHOR_SD_MS;
    var p = pressSdMs || 0.0;
    return Math.max(minAnchorSdMs, Math.sqrt(Math.max(0.0, totalSdMs * totalSdMs - p * p)));
  }

  // cues: [{anchor, timeS, sdMs}]
  function fuseCues(cues, pressSdMs, frameMs, minAnchorSdMs) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    if (isNil(minAnchorSdMs)) minAnchorSdMs = MIN_ANCHOR_SD_MS;
    if (!cues || cues.length < 2) fail("fusion needs at least two anchors");
    var p = pressSdMs || 0.0;
    var parts = cues.map(function (c) {
      var aSd = splitAnchorSd(c.sdMs, pressSdMs, minAnchorSdMs);
      return { anchor: c.anchor, timeS: Number(c.timeS), sdMs: Number(c.sdMs), anchorSdMs: aSd, variance: aSd * aSd };
    });
    var floored = parts.every(function (x) { return x.sdMs * x.sdMs - p * p <= minAnchorSdMs * minAnchorSdMs; });
    var best = parts[0];
    for (var i = 1; i < parts.length; i++) if (parts[i].sdMs < best.sdMs) best = parts[i];
    var fusedT, fusedVar, weights;
    if (floored) {
      fusedT = best.timeS;
      fusedVar = best.sdMs * best.sdMs - p * p;
      weights = parts.map(function (x) { return x === best ? 1.0 : 0.0; });
      fusedVar = Math.max(fusedVar, 0.0);
    } else {
      var f = fuse(parts.map(function (x) { return [x.timeS, x.variance]; }));
      fusedT = f.value; fusedVar = f.variance; weights = f.weights;
    }
    parts.forEach(function (x, j) { x.weight = weights[j]; });
    var fusedAnchorSd = Math.sqrt(fusedVar);
    var fusedTotalSd = floored ? best.sdMs : Math.sqrt(fusedVar + p * p);
    var pSingle = hitProbability(best.sdMs, frameMs), pFused = hitProbability(fusedTotalSd, frameMs);
    var assumption;
    if (floored) {
      assumption = "the press scatter (" + pyFixed(p, 1) + " ms, press trainer) is at least each anchor's whole spread, so the" +
        " ENTER parts are both at the " + pyFixed(minAnchorSdMs, 1) + " ms floor and the weights are uninformative: the cue comes" +
        " from the tighter anchor (" + best.anchor + ") alone; re-run 'train' or recalibrate before trusting a fusion";
    } else if (pressSdMs) {
      assumption = "the press scatter is " + pyFixed(p, 1) + " ms (press trainer), the rest of each anchor's spread is its ENTER";
    } else {
      assumption = "no press measurement: all of each anchor's spread is taken as its ENTER, so the fused sd is" +
        " an upper bound on the improvement ('train' measures the press)";
    }
    return {
      timeS: fusedT, sdMs: fusedTotalSd, anchorSdMs: fusedAnchorSd, pressSdMs: p, weights: weights, anchors: parts,
      bestSingle: best.anchor, bestSingleSdMs: best.sdMs, pSingle: pSingle, pFused: pFused,
      attemptsSingle: expectedAttempts(pSingle), attemptsFused: expectedAttempts(pFused), floored: floored, assumption: assumption
    };
  }

  function anchorCueTime(enterT, delayS, correctionMs) {
    return checkNumber(enterT, "the anchor time (s)") + checkNumber(delayS, "the cue delay (s)") - checkNumber(correctionMs, "the correction (ms)") / 1000.0;
  }
  function correctionUsedFor(delayS, enterT, cueT) {
    return (checkNumber(delayS, "the cue delay (s)") - (checkNumber(cueT, "the cue time (s)") - checkNumber(enterT, "the anchor time (s)"))) * 1000.0;
  }

  function recommendation(stats, driftResult, frameMs, pressSdMs, robust) {
    if (isNil(frameMs)) frameMs = FRAME_MS;
    var n = stats.n, s = robust ? stats.robustSdMs : stats.sdMs;
    if (n < 2 || s !== s) {
      return ["few", n + " sample" + (n === 1 ? "" : "s") + ": no spread yet. Calibrate 2 attempts for a first sd, 3 or more to trust it;" +
        " 'train' measures your press alone without a game."];
    }
    var p = hitProbability(s, frameMs);
    if (driftResult && driftResult.flag) {
      return ["setup", "RECALIBRATE / SETUP CHANGED (" + driftResult.strength + " drift): " + driftResult.reason + ". Something moved: the audio player, the" +
        " display or capture path, the console, or how you hold. Check the player is the one the" +
        " samples were taken with; drop the stale samples (calibrate --drop-last, or --clear) and" +
        " re-sample before trusting the correction."];
    }
    var weak = (driftResult && driftResult.strength === "weak")
      ? " (The last samples sit a frame from the earlier ones but within their scatter; keep an eye on it, it is not a drift call.)" : "";
    if (pressSdMs && pressSdMs >= 0.8 * s) {
      return ["press", "PRACTICE THE PRESS: your A press alone scatters " + pyFixed(pressSdMs, 1) + " ms (press trainer), most of the " +
        pyFixed(s, 1) + " ms spread here, so no correction can raise P(hit) above about " + pyFixed(100.0 * hitProbability(pressSdMs, frameMs), 0) +
        " %. 'train' sessions tighten it; the correction itself is fine."];
    }
    if (s > frameMs) {
      var need = sdForProbability(0.5, frameMs);
      return ["anchor", "the spread (" + pyFixed(s, 1) + " ms) is wider than a frame: P(hit) " + pyFixed(100.0 * p, 0) + " %. Run 'train' to measure the" +
        " press alone: a tight press means the ENTER is the spread (use the menu anchor, or both" +
        " anchors with --dual-anchor); a wide press means practice. sd " + pyFixed(need, 1) + " ms would give 50 %." + weak];
    }
    return ["tight", "tight: sd " + pyFixed(s, 1) + " ms is within a frame (P(hit) " + pyFixed(100.0 * p, 0) + " %). Keep calibrating; every sample" +
      " sharpens the mean, and drift will be flagged if the setup moves." + weak];
  }

  // ---- Data helpers (gen1-tid.json / gen3-sid.json) ------------------------------
  function methodology(data, id) {
    var m = data.methodologies[id];
    if (!m) fail("no methodology " + JSON.stringify(id) + " in the data");
    return m;
  }
  function tableFor(data, id) { return decodeTable(methodology(data, id).table_data); }
  function timingFor(data, id) { return methodology(data, id).timing; }
  function targetSetsFor(data, gameKey, keys) {
    var games = data.games || {};
    if (!Object.prototype.hasOwnProperty.call(games, gameKey)) fail("no game " + JSON.stringify(gameKey) + " in the data (choose from " + Object.keys(games).join(", ") + ")");
    var g = games[gameKey];
    var all = data.target_sets || {};
    var wanted = keys && keys.length ? keys.slice() : (g.default_target_sets || g.target_sets || []).slice();
    return wanted.map(function (k) {
      if (!(k in all)) fail("target set " + JSON.stringify(k) + " is not defined (choose from " + Object.keys(all).join(", ") + ")");
      if ((all[k].games || []).indexOf(gameKey) === -1) fail("target set " + JSON.stringify(k) + " is not defined for " + gameKey);
      return makeTargetSet(k, all[k]);
    });
  }
  function sidModel(data, id, variantName) { return variant(methodology(data, id).model, variantName); }

  return {
    FPS: FPS, FRAME_MS: FRAME_MS, MENU_TO_TABLE_FRAMES: MENU_TO_TABLE_FRAMES, OUTLIER_FRAMES: OUTLIER_FRAMES, COUNT_IN_CLEAR_S: COUNT_IN_CLEAR_S,
    COUNT_IN_TONE: COUNT_IN_TONE, A_CUE_TONE: A_CUE_TONE, RESET_BEAT_TONE: RESET_BEAT_TONE, A_BEAT_TONE: A_BEAT_TONE, HOLD_TONE: HOLD_TONE,
    MENU_MARK_TONE: MENU_MARK_TONE, ANCHOR_MENU: ANCHOR_MENU, ANCHOR_POWERON: ANCHOR_POWERON, ANCHOR_RESET: ANCHOR_RESET, ANCHORS: ANCHORS,
    VERDICT_TEXT: VERDICT_TEXT, SLED_40XX: SLED_40XX, GBA_FPS: GBA_FPS, TEXT_SPEEDS: TEXT_SPEEDS,
    MAD_TO_SD: MAD_TO_SD, MIN_ANCHOR_SD_MS: MIN_ANCHOR_SD_MS, DRIFT_TAIL: DRIFT_TAIL, DRIFT_THRESHOLD_MS: DRIFT_THRESHOLD_MS,
    WELCH_STRONG_T: WELCH_STRONG_T, SD_INTERVAL_CONF: SD_INTERVAL_CONF, SMALL_N: SMALL_N,
    checkReal: checkReal, checkNumber: checkNumber, checkInt: checkInt, checkTid: checkTid, checkSid: checkSid, checkPid: checkPid, checkOffset: checkOffset,
    framesToSeconds: framesToSeconds, secondsToFrames: secondsToFrames, framesToMs: framesToMs, msToFrames: msToFrames,
    targetSeconds: targetSeconds, pressFrameFromMenu: pressFrameFromMenu, cueDelaySeconds: cueDelaySeconds, countInCues: countInCues,
    menuSchedule: menuSchedule, poweronSchedule: poweronSchedule, resetAnchorExtraSeconds: resetAnchorExtraSeconds, schedule: schedule,
    parseTid: parseTid, formatTid: formatTid, makeTargetSet: makeTargetSet, setAccepts: setAccepts, setTrap: setTrap, setDescribe: setDescribe,
    setsAccepting: setsAccepting, verdict: verdict, verdictText: verdictText, routeValidTargets: routeValidTargets, invert: invert,
    nearestOffset: nearestOffset, decodeTable: decodeTable, tableEntries: tableEntries,
    errorFrames: errorFrames, isOutlier: isOutlier, impliedCorrection: impliedCorrection, makeSample: makeSample,
    splitByMethodology: splitByMethodology, isDuplicate: isDuplicate, addSample: addSample, dropLast: dropLast, dropLastUnder: dropLastUnder,
    meanCorrection: meanCorrection, samplePlayers: samplePlayers,
    resetInterval: resetInterval, resetIntervals: resetInterval, resetSchedule: resetSchedule, verify: verify,
    lcrngNext: lcrngNext, lcrngJump: lcrngJump, hi16: hi16, tsv: tsv, psv: psv, shinyXor: shinyXor, isShiny: isShiny, shinySidsForPid: shinySidsForPid,
    sidAt: sidAt, sidCandidates: sidCandidates, kForSid: kForSid, filterCandidates: filterCandidates, filterByPid: filterByPid, parsePid: parsePid,
    variantNames: variantNames, variant: variant, stagePressToPress: stagePressToPress, kFixed: kFixed, cueBeeps: cueBeeps,
    kWindowForCue: kWindowForCue, cueWindow: cueWindow, gbaFramesToSeconds: gbaFramesToSeconds,
    mean: mean, variance: variance, sd: sd, median: median, mad: mad, robustSd: robustSd, anchorStats: anchorStats, erf: erf, lgamma: lgamma,
    phi: phi, normalPdf: normalPdf, hitProbability: hitProbability, hitProbabilityQuantised: hitProbabilityQuantised, chi2Cdf: chi2Cdf,
    chi2Quantile: chi2Quantile, sdInterval: sdInterval, hitProbabilityRange: hitProbabilityRange, hitProbabilityHeadline: hitProbabilityHeadline,
    expectedAttempts: expectedAttempts, sdForProbability: sdForProbability, welchT: welchT, drift: drift, fuse: fuse, splitAnchorSd: splitAnchorSd,
    fuseCues: fuseCues, anchorCueTime: anchorCueTime, correctionUsedFor: correctionUsedFor, recommendation: recommendation, pyFixed: pyFixed,
    methodology: methodology, tableFor: tableFor, timingFor: timingFor, targetSetsFor: targetSetsFor, sidModel: sidModel
  };
});
