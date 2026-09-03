// core/gen1tid.js against the vectors emitted by RNG Solution's Python (tests/emit_vectors.py):
// every function of the Gen 1 Trainer ID cue model, the reset metronome, verify, the Gen 3
// typed-TID -> SID model and the press-jitter model. Integers and strings must match exactly;
// floats to 1e-9 (relative above |1|); "NaN" / "Infinity" sentinels must be reproduced; a
// case recorded as {"error": ...} must throw the error class the Python's maps to (ERROR_NAMES).
// A null "sets" in a vector means the game's own target sets (the engine has no default).
const fs = require("fs");
const path = require("path");
const G = require(path.join(__dirname, "..", "core", "gen1tid.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "gen1tid-vectors.json");
const V = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "core", "data", "gen1-tid.json"), "utf8"));
const SID = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "core", "data", "gen3-sid.json"), "utf8"));

let failures = 0;
let checks = 0;
const TOL = 1e-9;

function mismatch(label, e, a) {
  failures++;
  if (failures <= 40) console.error(`FAIL ${label}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`);
}

function same(e, a, label) {
  if (e === "NaN") return typeof a === "number" && Number.isNaN(a);
  if (e === "Infinity") return a === Infinity;
  if (e === "-Infinity") return a === -Infinity;
  if (e === null || e === undefined) return a === null || a === undefined;
  if (typeof e === "number") {
    if (typeof a !== "number" || Number.isNaN(a)) return false;
    if (Number.isInteger(e) && Number.isInteger(a)) return e === a;
    return Math.abs(a - e) <= TOL * Math.max(1, Math.abs(e));
  }
  if (typeof e === "string" || typeof e === "boolean") return e === a;
  if (Array.isArray(e)) {
    if (!Array.isArray(a) || a.length !== e.length) return false;
    for (let i = 0; i < e.length; i++) if (!same(e[i], a[i], label)) return false;
    return true;
  }
  if (typeof e === "object") {
    if (!a || typeof a !== "object") return false;
    const ek = Object.keys(e).sort();
    const ak = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    if (ek.join(",") !== ak.join(",")) return false;
    for (const k of ek) if (!same(e[k], a[k], label)) return false;
    return true;
  }
  return false;
}

function check(label, expected, actual) {
  checks++;
  if (!same(expected, actual, label)) mismatch(label, expected, actual);
}

// Python exception -> the JS error name the engine must throw (a TypeError from a bug is not a refusal).
const ERROR_NAMES = { ValueError: "ValueError", TargetSetError: "ValueError", KeyError: "ValueError", OutlierSample: "OutlierSample", DuplicateSample: "DuplicateSample" };

// A case with {error} must throw the mapped error class; one with {result} must return it.
function checkCase(label, c, fn) {
  checks++;
  let got, threw = null;
  try { got = fn(); } catch (e) { threw = e; }
  if ("error" in c) {
    const want = ERROR_NAMES[c.error];
    if (!want) mismatch(label, { error: c.error }, "no JS error class is mapped for this Python exception");
    else if (!threw) mismatch(label, { error: c.error }, got);
    else if (threw.name !== want) mismatch(label, { error: c.error, name: want }, `threw ${threw.name}: ${threw.message}`);
  } else if (threw) {
    mismatch(label, c.result, `threw ${threw.name}: ${threw.message}`);
  } else if (!same(c.result, got, label)) {
    mismatch(label, c.result, got);
  }
}

const tables = {};
for (const id of Object.keys(DATA.methodologies)) tables[id] = G.tableFor(DATA, id);
const sets = (game, keys) => G.targetSetsFor(DATA, game, keys === null || keys === undefined ? null : keys);

// ---- constants -----------------------------------------------------------------
{
  const c = V.constants;
  check("FPS", c.fps, G.FPS);
  check("FRAME_MS", c.frameMs, G.FRAME_MS);
  check("MENU_TO_TABLE_FRAMES", c.menuToTableFrames, G.MENU_TO_TABLE_FRAMES);
  check("OUTLIER_FRAMES", c.outlierFrames, G.OUTLIER_FRAMES);
  check("COUNT_IN_CLEAR_S", c.countInClearS, G.COUNT_IN_CLEAR_S);
  check("ANCHORS", c.anchors, G.ANCHORS);
  check("tones", c.tones, { countIn: G.COUNT_IN_TONE, aCue: G.A_CUE_TONE, resetBeat: G.RESET_BEAT_TONE, aBeat: G.A_BEAT_TONE, hold: G.HOLD_TONE, menuMark: G.MENU_MARK_TONE });
  check("VERDICT_TEXT", c.verdictText, G.VERDICT_TEXT);
  check("reset extra", c.resetExtraS, G.resetAnchorExtraSeconds(DATA.reset_models["gbp-fade"]));
  check("data settle", 80, DATA.menu_to_table_frames);
}

// ---- tables: the JSON tables against the CSV-derived facts ------------------------
for (const t of V.tables) {
  const tab = tables[t.methodology];
  const m = DATA.methodologies[t.methodology];
  const entries = G.tableEntries(tab);
  check(`table ${t.methodology} rows`, t.rows, entries.length);
  check(`table ${t.methodology} range`, [t.offsetMin, t.offsetMax], [entries[0][0], entries[entries.length - 1][0]]);
  check(`table ${t.methodology} distinct`, t.distinct, new Set(entries.map((e) => e[1])).size);
  let sum = 0;
  for (const [o, tid] of entries) sum += (o + 1) * tid;
  check(`table ${t.methodology} checksum`, t.checksum, sum % 4294967296);
  check(`table ${t.methodology} timing`, [t.holdLoFrame, t.holdHiFrame, t.menuFrame, t.visibleLagFrames],
    [m.timing.hold_lo_frame, m.timing.hold_hi_frame, m.timing.menu_frame, m.timing.visible_lag_frames]);
  check(`table ${t.methodology} verified targets`, t.verifiedTargets, m.timing.verified_targets);
  check(`table ${t.methodology} family`, t.family, m.console_id);
  check(`table ${t.methodology} anchors`, t.anchors, m.anchors);
  check(`table ${t.methodology} file`, t.tableFile, m.table_data.file);
  check(`table ${t.methodology} default sets`, t.defaultTargetSets, G.targetSetsFor(DATA, t.game).map((s) => s.key));
  const byTid = new Map();
  for (const [o, tid] of entries) { if (!byTid.has(tid)) byTid.set(tid, []); byTid.get(tid).push(o); }
  const coll = [...byTid.entries()].filter((e) => e[1].length > 1).sort((a, b) => a[0] - b[0]).map((e) => ({ tid: e[0], offsets: e[1] }));
  check(`table ${t.methodology} collisions`, t.collisions, coll);
  check(`table ${t.methodology} route-valid`, t.routeValid, G.routeValidTargets(tab, G.targetSetsFor(DATA, t.game)));
  for (const key of Object.keys(t.routeValidPerSet)) {
    check(`table ${t.methodology} route-valid under ${key}`, t.routeValidPerSet[key], G.routeValidTargets(tab, G.targetSetsFor(DATA, t.game, [key])));
  }
  check(`table ${t.methodology} traps`, t.traps, entries.filter((e) => G.verdict(e[1], G.targetSetsFor(DATA, t.game)) === "40!"));
  check(`table ${t.methodology} samples`, t.samples, t.samples.map((s) => [s[0], tab[s[0]]]));
}

// ---- cue arithmetic ---------------------------------------------------------------
for (const c of V.targetSeconds) {
  check(`targetSeconds ${c.offset}`, [c.seconds, c.pressFrame, c.cueDelayAt200, c.cueDelayAtMinus50],
    [G.targetSeconds(c.offset), G.pressFrameFromMenu(c.offset), G.cueDelaySeconds(c.offset, 200.0), G.cueDelaySeconds(c.offset, -50.0)]);
}
for (const c of V.conversions) {
  check(`conversions ${c.frames}`, [c.seconds, c.ms, c.framesBackFromSeconds, c.framesBackFromMs],
    [G.framesToSeconds(c.frames), G.framesToMs(c.frames), G.secondsToFrames(G.framesToSeconds(c.frames)), G.msToFrames(G.framesToMs(c.frames))]);
}
for (const c of V.menuSchedule) {
  checkCase(`menuSchedule ${c.offset}/${c.correctionMs}/${c.beeps}/${c.spacingS}`, c, () => G.menuSchedule(c.offset, c.correctionMs, c.beeps, c.spacingS));
  checkCase(`schedule(menu) ${c.offset}/${c.correctionMs}`, c, () => G.schedule("menu", c.offset, c.correctionMs, { beeps: c.beeps, spacingS: c.spacingS }));
}
for (const c of V.poweronSchedule) {
  const timing = G.timingFor(DATA, c.methodology);
  checkCase(`schedule ${c.anchor} ${c.methodology} ${c.offset}/${c.correctionMs}/${c.beeps}/${c.spacingS}`, c,
    () => G.schedule(c.anchor, c.offset, c.correctionMs, { family: timing, beeps: c.beeps, spacingS: c.spacingS, resetExtraS: c.resetExtraS }));
  if (c.anchor === "reset" && c.resetExtraS !== null) {
    checkCase(`schedule reset via model ${c.methodology} ${c.offset}/${c.correctionMs}`, c,
      () => G.schedule(c.anchor, c.offset, c.correctionMs, { family: timing, beeps: c.beeps, spacingS: c.spacingS, resetModel: DATA.reset_models["gbp-fade"] }));
  }
  // With the methodology record the engine itself refuses an anchor the methodology does not list (the DMG
  // methodologies have no reset anchor), so the reset delay can always come from the model.
  checkCase(`schedule ${c.anchor} under methodology ${c.methodology} ${c.offset}/${c.correctionMs}/${c.beeps}/${c.spacingS}`, c,
    () => G.schedule(c.anchor, c.offset, c.correctionMs, { family: timing, methodology: DATA.methodologies[c.methodology], beeps: c.beeps, spacingS: c.spacingS,
      resetModel: DATA.reset_models["gbp-fade"] }));
}
for (const c of V.resetAnchorExtra) checkCase(`resetAnchorExtra ${c.model}`, c, () => G.resetAnchorExtraSeconds(DATA.reset_models[c.model]));

// ---- Trainer IDs and target sets -------------------------------------------------
for (const c of V.parseTid) checkCase(`parseTid ${JSON.stringify(c.text)}`, c, () => G.parseTid(c.text));
for (const c of V.formatTid) check(`formatTid ${c.tid}`, c.text, G.formatTid(c.tid));
{
  const ts = V.targetSets;
  for (const key of Object.keys(ts.describe)) {
    const set = key === "<default sled>" ? G.SLED_40XX : G.makeTargetSet(key, DATA.target_sets[key]);
    check(`describe ${key}`, ts.describe[key], G.setDescribe(set));
  }
  for (const c of ts.verdicts) {
    const s = sets(c.game, c.sets);
    const label = `verdict ${c.game} ${JSON.stringify(c.sets)} $${c.tid.toString(16)}`;
    check(label, [c.verdict, c.text, c.accepting], [G.verdict(c.tid, s), G.verdictText(c.tid, s), G.setsAccepting(c.tid, s).map((x) => x.key)]);
    if (c.perSet) {
      const got = {};
      for (const x of s) got[x.key] = { accepts: G.setAccepts(x, c.tid), trap: G.setTrap(x, c.tid) };
      check(label + " per set", c.perSet, got);
    }
  }
  for (const g of Object.keys(ts.defaultSets)) check(`default sets ${g}`, ts.defaultSets[g], G.targetSetsFor(DATA, g).map((s) => s.key));
  for (const c of ts.errors) checkCase(`targetSetsFor ${c.game} ${JSON.stringify(c.keys)}`, c, () => G.targetSetsFor(DATA, c.game, c.keys));
}
for (const c of V.invert) {
  if (c.methodology) {
    const offsets = G.invert(tables[c.methodology], c.tid);
    check(`invert ${c.methodology} $${c.tid.toString(16)}`, c.offsets, offsets);
    for (const n of c.nearest) check(`nearest ${c.methodology} $${c.tid.toString(16)} guess ${n.guess}`, n.offset, G.nearestOffset(offsets, n.guess));
  } else {
    for (const n of c.nearestOnly) check(`nearestOffset ${JSON.stringify(n.offsets)} ${n.guess}`, n.offset, G.nearestOffset(n.offsets, n.guess));
  }
}

// ---- calibration ---------------------------------------------------------------
for (const c of V.impliedCorrection) {
  check(`implied ${c.usedMs}/${c.hit}/${c.aimed}`, [c.errorFrames, c.isOutlier, c.impliedMs],
    [G.errorFrames(c.hit, c.aimed), G.isOutlier(c.hit, c.aimed), G.impliedCorrection(c.usedMs, c.hit, c.aimed)]);
}
{
  const S = V.samples;
  for (const c of S.make) {
    const a = c.args;
    check(`makeSample ${a.tid}/${a.hitOffset}`, c.sample, G.makeSample(a.tid, a.aimedOffset, a.hitOffset, a.correctionUsedMs,
      { attempt: a.attempt, note: a.note, player: a.player, methodology: a.methodology }));
  }
  S.add.forEach((c, i) => {
    check(`isDuplicate #${i}`, c.isDuplicate, G.isDuplicate(c.samples, c.sample));
    check(`isOutlier #${i}`, c.isOutlier, G.isOutlier(c.sample.hit, c.sample.aimed));
    checkCase(`addSample #${i} force=${c.force}`, c, () => G.addSample(c.samples, c.sample, c.force));
    if ("error" in c) {
      let name = null;
      try { G.addSample(c.samples, c.sample, c.force); } catch (e) { name = e.name; }
      check(`addSample #${i} error class`, c.error, name);
    }
  });
  for (const c of S.meanCorrection) check(`meanCorrection n=${c.samples.length} default ${c.defaultMs}`, c.ms, G.meanCorrection(c.samples, c.defaultMs));
  S.split.forEach((c, i) => {
    const r = G.splitByMethodology(c.samples, c.methodology);
    check(`splitByMethodology #${i}`, { kept: c.kept, rest: c.rest }, { kept: r.kept, rest: r.rest });
  });
  S.dropLast.forEach((c, i) => check(`dropLast #${i}`, { rest: c.rest, dropped: c.dropped }, G.dropLast(c.samples)));
  S.dropLastUnder.forEach((c, i) => check(`dropLastUnder #${i}`, { rest: c.rest, dropped: c.dropped }, G.dropLastUnder(c.samples, c.methodology)));
  S.players.forEach((c, i) => check(`samplePlayers #${i}`, c.players, G.samplePlayers(c.samples)));
}

// ---- reset metronome -----------------------------------------------------------
for (const c of V.resetInterval) {
  const model = c.modelSpec || DATA.reset_models[c.model];
  checkCase(`resetInterval ${c.model}/${c.path} fade=${c.fadeFrames} adj=${c.adjustFrames}`, c, () => G.resetInterval(model, c.path, c.fadeFrames, c.adjustFrames));
}
for (const c of V.resetSchedule) {
  checkCase(`resetSchedule ${c.intervalMs}/${c.order}/${c.pairs}/${c.cadenceS}/${c.leadS}`, c, () => G.resetSchedule(c.intervalMs, c.order, c.pairs, c.cadenceS, c.leadS));
}

// ---- verify ----------------------------------------------------------------------
for (const c of V.verify) {
  check(`verify ${c.methodology} $${c.tid.toString(16)} ${c.menuToPressS} tol ${c.toleranceFrames} lag ${c.visibleLagFrames}`, c.result,
    G.verify(tables[c.methodology], c.tid, c.menuToPressS, c.toleranceFrames, c.visibleLagFrames, sets(DATA.methodologies[c.methodology].game_key, c.sets)));
}

// ---- Gen 3 Secret ID -----------------------------------------------------------
{
  const s = V.sid;
  check("lcrng constants", [s.constants.mult, s.constants.add, s.constants.gbaFps], [1103515245, 24691, G.GBA_FPS]);
  check("text speeds", s.constants.textSpeeds, G.TEXT_SPEEDS);
  for (const c of s.sidAt) check(`sidAt ${c.tid}/${c.k}`, [c.sid, c.tsv], [G.sidAt(c.tid, c.k), G.tsv(c.tid, G.sidAt(c.tid, c.k))]);
  for (const c of s.jumps) {
    if ("error" in c) checkCase(`lcrngJump ${c.x}/${c.n}`, c, () => G.lcrngJump(c.x, c.n));
    else check(`lcrngJump ${c.x}/${c.n}`, [c.state, c.hi16], [G.lcrngJump(c.x, c.n), G.hi16(G.lcrngJump(c.x, c.n))]);
  }
  for (const c of s.candidates) check(`sidCandidates ${c.tid} ${c.kMin}-${c.kMax}`, c.candidates, G.sidCandidates(c.tid, c.kMin, c.kMax));
  for (const c of s.candidateErrors) checkCase(`sidCandidates error ${c.tid} ${c.kMin}-${c.kMax}`, c, () => G.sidCandidates(c.tid, c.kMin, c.kMax));
  for (const c of s.kForSid) check(`kForSid ${c.tid}/${c.sid}/${c.kMax}`, c.ks, G.kForSid(c.tid, c.sid, c.kMax));
  for (const c of s.shiny) {
    check(`shiny ${c.tid}/${c.sid}/${c.pid}`, [c.shinyXor, c.isShiny, c.tsv, c.psv],
      [G.shinyXor(c.tid, c.sid, c.pid), G.isShiny(c.tid, c.sid, c.pid), G.tsv(c.tid, c.sid), G.psv(c.pid)]);
  }
  for (const c of s.shinySidsForPid) check(`shinySidsForPid ${c.tid}/${c.pid}`, c.sids, G.shinySidsForPid(c.tid, c.pid));
  for (const c of s.filter) {
    const cands = G.sidCandidates(c.tid, c.kMin, c.kMax);
    const r = G.filterCandidates(cands, c.tid, c.shinyPids, c.nonshinyPids, c.tsv);
    check(`filterCandidates ${JSON.stringify([c.shinyPids, c.nonshinyPids, c.tsv])}`, { kept: c.kept, dropped: c.dropped },
      { kept: r.kept.map((x) => x.k), dropped: r.dropped });
    if (c.shinyPids.length === 1 && !c.nonshinyPids.length && c.tsv === null) {
      check("filterByPid shiny", c.kept, G.filterByPid(cands, c.tid, c.shinyPids[0], true).kept.map((x) => x.k));
    }
    if (c.nonshinyPids.length === 1 && !c.shinyPids.length && c.tsv === null) {
      check("filterByPid not shiny", c.kept, G.filterByPid(cands, c.tid, c.nonshinyPids[0], false).kept.map((x) => x.k));
    }
  }
  for (const c of s.parsePid) checkCase(`parsePid ${JSON.stringify(c.text)}`, c, () => G.parsePid(c.text));
  const modelOf = (game) => SID.methodologies[`${game}/gba/typed-tid-sid-v1`].model;
  for (const c of s.models) {
    if (c.variantNames) {
      check(`variantNames ${c.game}`, [c.variantNames, c.defaultVariant], [G.variantNames(modelOf(c.game)), modelOf(c.game).default_variant]);
      continue;
    }
    if ("error" in c) { checkCase(`variant ${c.game}/${c.variant}`, c, () => G.variant(modelOf(c.game), c.variant)); continue; }
    const m = G.variant(modelOf(c.game), c.variant);
    check(`variant ${c.game}/${c.variant}`, [c.resolvedVariant, c.okToSeed, c.kDefaultSpan, c.stages], [m.variant, m.ok_to_seed, m.k_default_span, m.stages]);
    check(`sidModel ${c.game}/${c.variant}`, m, G.sidModel(SID, `${c.game}/gba/typed-tid-sid-v1`, c.variant));
    for (const r of c.rows) {
      const label = `${c.game}/${c.variant} ${r.speed} L${r.nameLength}`;
      if ("error" in r) { checkCase(`stagePressToPress ${label}`, r, () => G.stagePressToPress(m, r.nameLength, r.speed)); continue; }
      check(`stagePressToPress ${label}`, r.stagePressToPress, G.stagePressToPress(m, r.nameLength, r.speed));
      check(`kFixed ${label}`, r.kFixed, G.kFixed(m, r.nameLength, r.speed));
      check(`cueBeeps30 ${label}`, r.cueBeeps30, G.cueBeeps(m, r.nameLength, r.speed, 30));
      check(`cueBeeps0 ${label}`, r.cueBeeps0, G.cueBeeps(m, r.nameLength, r.speed, 0));
      check(`kWindowForCue ${label}`, r.window, G.kWindowForCue(m, r.nameLength, r.speed, 30, 6, 20));
      check(`cueWindow ${label}`, { kExpected: r.window.kExpected, kMin: r.window.kMin, kMax: r.window.kMax },
        G.cueWindow(r.kFixed, m.stages.length, 30, 6, 20));
    }
  }
  for (const c of s.measured) {
    const m = G.sidModel(SID, c.methodology, c.variant);
    check(`measured ${c.methodology}/${c.variant} ${c.speed} L${c.nameLength}`, [c.kFixed, c.kFixedComputed, c.sidAt, c.sid],
      [G.kFixed(m, c.nameLength, c.speed), G.kFixed(m, c.nameLength, c.speed), G.sidAt(c.seed, c.kFixed), G.sidAt(c.seed, c.kFixed)]);
  }
  for (const c of s.cueWindow) {
    check(`cueWindow ${c.kFixed}/${c.presses}/${c.marginFrames}`, { kExpected: c.kExpected, kMin: c.kMin, kMax: c.kMax },
      G.cueWindow(c.kFixed, c.presses, c.marginFrames, c.earlyFrames, c.lateFrames));
  }
  for (const c of s.framesToSeconds) check(`gbaFramesToSeconds ${c.frames}`, c.seconds, G.gbaFramesToSeconds(c.frames));
}

// ---- jitter --------------------------------------------------------------------
{
  const J = V.jitter;
  check("jitter constants", J.constants, { madToSd: G.MAD_TO_SD, minAnchorSdMs: G.MIN_ANCHOR_SD_MS, driftTail: G.DRIFT_TAIL,
    driftThresholdMs: G.DRIFT_THRESHOLD_MS, welchStrongT: G.WELCH_STRONG_T, sdIntervalConf: G.SD_INTERVAL_CONF, smallN: G.SMALL_N });
  for (const c of J.descriptive) {
    check(`descriptive ${JSON.stringify(c.values)}`, [c.mean, c.variance, c.sd, c.median, c.mad, c.robustSd],
      [G.mean(c.values), G.variance(c.values), G.sd(c.values), G.median(c.values), G.mad(c.values), G.robustSd(c.values)]);
  }
  for (const c of J.anchorStats) check(`anchorStats n=${c.samples.length}`, c.stats, G.anchorStats(c.samples));
  for (const c of J.hitProbability) check(`hitProbability ${c.sdMs}/${c.frameMs}/${c.biasMs}`, c.p, G.hitProbability(c.sdMs, c.frameMs, c.biasMs));
  for (const c of J.hitProbabilityErrors) checkCase(`hitProbability error ${c.sdMs}/${c.frameMs}`, c, () => G.hitProbability(c.sdMs, c.frameMs, c.biasMs));
  for (const c of J.hitProbabilityQuantised) {
    check(`hitProbabilityQuantised ${c.sdMs}/${c.biasMs}/${c.phase}`, c.p, G.hitProbabilityQuantised(c.sdMs, c.frameMs, c.biasMs, c.phase));
  }
  for (const c of J.hitProbabilityQuantisedErrors) {
    checkCase(`hitProbabilityQuantised error ${c.sdMs}/${c.phase}`, c, () => G.hitProbabilityQuantised(c.sdMs, c.frameMs, c.biasMs, c.phase));
  }
  for (const c of J.chi2Cdf) check(`chi2Cdf ${c.x}/${c.k}`, c.cdf, G.chi2Cdf(c.x, c.k));
  for (const c of J.chi2CdfErrors) checkCase(`chi2Cdf error ${c.x}/${c.k}`, c, () => G.chi2Cdf(c.x, c.k));
  for (const c of J.chi2Quantile) check(`chi2Quantile ${c.p}/${c.k}`, c.q, G.chi2Quantile(c.p, c.k));
  for (const c of J.chi2QuantileErrors) checkCase(`chi2Quantile error ${c.p}/${c.k}`, c, () => G.chi2Quantile(c.p, c.k));
  for (const c of J.sdInterval) {
    const sd = c.sdMs === "NaN" ? NaN : c.sdMs;
    check(`sdInterval ${c.sdMs}/${c.n}/${c.conf}`, { lo: c.lo, hi: c.hi }, G.sdInterval(sd, c.n, c.conf));
  }
  for (const c of J.hitProbabilityRange) check(`hitProbabilityRange ${c.sdMs}/${c.n}/${c.centred}`, c.range, G.hitProbabilityRange(c.sdMs, c.n, G.FRAME_MS, 0.90, c.centred));
  for (const c of J.headline) check(`headline ${c.sdMs}/${c.n}`, { p: c.p, centred: c.centred }, G.hitProbabilityHeadline(c.sdMs, c.n));
  for (const c of J.expectedAttempts) check(`expectedAttempts ${c.p}`, c.attempts, G.expectedAttempts(c.p));
  for (const c of J.sdForProbability) checkCase(`sdForProbability ${c.p}/${c.biasMs}`, c, () => G.sdForProbability(c.p, c.frameMs, c.biasMs));
  for (const c of J.welchT) check(`welchT ${JSON.stringify([c.a, c.b])}`, c.t, G.welchT(c.a, c.b));
  for (const c of J.drift) {
    check(`drift ${JSON.stringify(c.values)} tail ${c.tailN} thr ${c.thresholdMs} head ${c.minHead} t ${c.strongT}`, c.result,
      G.drift(c.values, { tailN: c.tailN, thresholdMs: c.thresholdMs, minHead: c.minHead, strongT: c.strongT }));
  }
  for (const c of J.fuse) checkCase(`fuse ${JSON.stringify(c.estimates)}`, c, () => G.fuse(c.estimates));
  for (const c of J.splitAnchorSd) check(`splitAnchorSd ${c.totalSdMs}/${c.pressSdMs}/${c.minAnchorSdMs}`, c.sd, G.splitAnchorSd(c.totalSdMs, c.pressSdMs, c.minAnchorSdMs));
  for (const c of J.fuseCues) checkCase(`fuseCues ${JSON.stringify(c.cues)} press ${c.pressSdMs}`, c, () => G.fuseCues(c.cues, c.pressSdMs));
  for (const c of J.anchorCueTime) {
    const cueT = G.anchorCueTime(c.enterT, c.delayS, c.correctionMs);
    check(`anchorCueTime ${c.enterT}/${c.delayS}/${c.correctionMs}`, [c.cueT, c.usedFor, c.usedForMinus8ms],
      [cueT, G.correctionUsedFor(c.delayS, c.enterT, cueT), G.correctionUsedFor(c.delayS, c.enterT, cueT - 0.008)]);
  }
  for (const c of J.recommendation) {
    const st = G.anchorStats(c.values.map((v) => ({ implied_ms: v })));
    check(`recommendation ${JSON.stringify(c.values)} press ${c.pressSdMs} robust ${c.robust}`, [c.code, c.text],
      G.recommendation(st, G.drift(c.values), G.FRAME_MS, c.pressSdMs, c.robust));
  }
}

// ---- API boundary (JS only: the Python and C# are typed at the CLI / compiler) --------------
// What a form field or a careless caller can hand the engine must be refused with a ValueError,
// never computed: 80 + "358" is "80358". Numeric strings are converted like Number().
{
  const red = G.targetSetsFor(DATA, "red");
  const tab = tables["red/gba/hold-start-v1"];
  const refuses = (label, fn) => {
    checks++;
    let e = null;
    try { fn(); } catch (x) { e = x; }
    if (!e || e.name !== "ValueError") mismatch(label, "throws ValueError", e ? `threw ${e.name}: ${e.message}` : "no throw");
  };
  check("numeric string offset and correction are converted", G.schedule("menu", 358, 200).tA, G.schedule("menu", "358", "200").tA);
  check("numeric string implied correction", 233.48541259765625, G.impliedCorrection("200", "360", "358"));
  check("numeric string sd", G.hitProbability(5), G.hitProbability("5"));
  check("numeric string Trainer ID verdict", "RUN", G.verdict("16387", red));
  check("numeric string sidAt", 19578, G.sidAt("45231", "0"));
  check("no sets in force means nothing is route-valid", "no", G.verdict(0x4003, []));
  check("Yellow has no set accepting $4027", "no", G.verdict(0x4027, G.targetSetsFor(DATA, "yellow")));
  check("Yellow route-valid targets under its sets", [], G.routeValidTargets(tables["yellow/gba/hold-start-v1"], G.targetSetsFor(DATA, "yellow")));
  for (const bad of ["", " ", "abc", "$4003", NaN, Infinity, -Infinity, null, undefined, true, {}, [], 358n, 358.5, -1]) {
    refuses(`schedule offset ${typeof bad === "bigint" ? bad + "n" : JSON.stringify(bad) ?? String(bad)}`, () => G.schedule("menu", bad, 200));
  }
  for (const bad of ["", "abc", NaN, Infinity, null, undefined, true, 200n]) {
    refuses(`schedule correction ${typeof bad === "bigint" ? bad + "n" : JSON.stringify(bad) ?? String(bad)}`, () => G.schedule("menu", 358, bad));
  }
  refuses("schedule beeps 2.5", () => G.schedule("menu", 358, 200, { beeps: 2.5 }));
  refuses("schedule beeps 'x'", () => G.schedule("menu", 358, 200, { beeps: "x" }));
  refuses("schedule spacing 'x'", () => G.schedule("menu", 358, 200, { spacingS: "x" }));
  refuses("schedule spacing NaN", () => G.schedule("menu", 358, 200, { spacingS: NaN }));
  refuses("poweron offset '358x'", () => G.schedule("poweron", "358x", 200, { family: G.timingFor(DATA, "red/gba/hold-start-v1") }));
  refuses("poweron family missing", () => G.schedule("poweron", 358, 200, {}));
  refuses("reset extra 'x'", () => G.schedule("reset", 358, 200, { family: G.timingFor(DATA, "red/gba/hold-start-v1"), resetExtraS: "x" }));
  refuses("reset on a methodology without the anchor", () => G.schedule("reset", 358, 100, { family: G.timingFor(DATA, "red/dmg/hold-start-v1"),
    methodology: DATA.methodologies["red/dmg/hold-start-v1"], resetModel: DATA.reset_models["gbp-fade"] }));
  refuses("targetSeconds NaN", () => G.targetSeconds(NaN));
  refuses("targetSeconds 358.5", () => G.targetSeconds(358.5));
  refuses("verdict without sets", () => G.verdict(0x4003));
  refuses("verdict with null sets", () => G.verdict(0x4003, null));
  refuses("verdict with a non-array", () => G.verdict(0x4003, red[0]));
  refuses("verdict 16387.7", () => G.verdict(16387.7, red));
  refuses("verdict 65536", () => G.verdict(65536, red));
  refuses("verdict -1", () => G.verdict(-1, red));
  refuses("verdictText without sets", () => G.verdictText(0x4003));
  refuses("setsAccepting without sets", () => G.setsAccepting(0x4003));
  refuses("routeValidTargets without sets", () => G.routeValidTargets(tab));
  refuses("verify without sets", () => G.verify(tab, 0x4003, 7.35));
  refuses("verify tid 70000", () => G.verify(tab, 70000, 7.35, 3, 0, red));
  refuses("verify seconds 'x'", () => G.verify(tab, 0x4003, "x", 3, 0, red));
  refuses("verify seconds NaN", () => G.verify(tab, 0x4003, NaN, 3, 0, red));
  refuses("verify negative tolerance", () => G.verify(tab, 0x4003, 7.35, -1, 0, red));
  refuses("invert 65536", () => G.invert(tab, 65536));
  refuses("formatTid 65536", () => G.formatTid(65536));
  refuses("impliedCorrection 'abc'", () => G.impliedCorrection("abc", 360, 358));
  refuses("impliedCorrection hit 360.5", () => G.impliedCorrection(200, 360.5, 358));
  refuses("impliedCorrection hit -1", () => G.impliedCorrection(200, -1, 358));
  refuses("makeSample tid 70000", () => G.makeSample(70000, 358, 358, 200));
  refuses("makeSample correction NaN", () => G.makeSample(0x4003, 358, 358, NaN));
  refuses("meanCorrection default 'x'", () => G.meanCorrection([], "x"));
  refuses("meanCorrection default undefined", () => G.meanCorrection([]));
  refuses("resetSchedule empty order", () => G.resetSchedule(200, [], 1));
  refuses("resetSchedule one action", () => G.resetSchedule(200, ["RESET"], 1));
  refuses("resetSchedule order not strings", () => G.resetSchedule(200, [1, 2], 1));
  refuses("resetSchedule interval 'abc'", () => G.resetSchedule("abc", ["RESET", "A"], 1));
  refuses("resetSchedule pairs 1.5", () => G.resetSchedule(200, ["RESET", "A"], 1.5));
  refuses("resetSchedule cadence NaN", () => G.resetSchedule(200, ["RESET", "A"], 1, NaN));
  refuses("resetInterval adjust 'x'", () => G.resetInterval(DATA.reset_models["gbp-fade"], "route", null, "x"));
  refuses("hitProbability 'abc'", () => G.hitProbability("abc"));
  refuses("hitProbability true", () => G.hitProbability(true));
  refuses("hitProbability frame NaN", () => G.hitProbability(5, NaN));
  refuses("hitProbabilityQuantised bias 'x'", () => G.hitProbabilityQuantised(5, G.FRAME_MS, "x"));
  refuses("chi2Cdf k 2.5", () => G.chi2Cdf(1, 2.5));
  refuses("chi2Quantile k 0", () => G.chi2Quantile(0.5, 0));
  refuses("sdInterval n 'x'", () => G.sdInterval(20, "x"));
  refuses("expectedAttempts 'x'", () => G.expectedAttempts("x"));
  refuses("anchorCueTime NaN", () => G.anchorCueTime(NaN, 33, 100));
  refuses("sidAt 65536", () => G.sidAt(65536, 0));
  refuses("sidAt -1", () => G.sidAt(-1, 0));
  refuses("sidAt k -1", () => G.sidAt(0x4003, -1));
  refuses("sidAt k 1.5", () => G.sidAt(0x4003, 1.5));
  refuses("sidCandidates kMax 'x'", () => G.sidCandidates(0x4003, 0, "x"));
  refuses("kForSid sid 65536", () => G.kForSid(0x4003, 65536, 10));
  refuses("tsv sid 70000", () => G.tsv(0x4003, 70000));
  refuses("psv 2^32", () => G.psv(4294967296));
  refuses("shinyXor pid -1", () => G.shinyXor(0x4003, 0, -1));
  refuses("lcrngJump state 2^32", () => G.lcrngJump(4294967296, 1));
  refuses("lcrngJump advances 1.5", () => G.lcrngJump(1, 1.5));
  refuses("filterCandidates pid 2^32", () => G.filterCandidates(G.sidCandidates(0x4003, 0, 2), 0x4003, [4294967296], [], null));
  refuses("filterCandidates tsv 8192", () => G.filterCandidates(G.sidCandidates(0x4003, 0, 2), 0x4003, [], [], 8192));
  refuses("cueWindow 'a'", () => G.cueWindow("a", 9, 30));
  refuses("cueWindow presses 1.5", () => G.cueWindow(1693, 1.5, 30));
  refuses("gbaFramesToSeconds 'x'", () => G.gbaFramesToSeconds("x"));
  refuses("targetSetsFor unknown game", () => G.targetSetsFor(DATA, "gold"));
  refuses("decodeTable without tids_hex", () => G.decodeTable({}));
  check("sdInterval keeps NaN for n < 2", { lo: "NaN", hi: "NaN" }, G.sdInterval(NaN, 1));
  check("hitProbability propagates a NaN sd", true, Number.isNaN(G.hitProbability(NaN)));
}

if (failures > 0) {
  console.error(`${failures} failure(s) in ${checks} checks`);
  process.exit(1);
}
console.log(`all gen1tid parity checks passed (${checks} checks)`);
