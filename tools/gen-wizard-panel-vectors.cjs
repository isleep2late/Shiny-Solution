// Emits tests/wizard-panel-vectors.json: what the web app's wanted-IVs wizard tab (webapp/wizard-ui.js over
// core/generators.js, core/seedtime4.js, core/timers.js and core/data/{species,encounters,statics}-gen{3,4}.json)
// computes for its three self-test scenarios (the Ruby Groudon Method 4 static with its typed outcome and the
// flawless Emerald Treecko limit; the Emerald Route 111 wild slot; the design's gate seed 7B0448D1 with the
// coin-flip identification and the calibrated delay 500 -> 503, and the Route 222 Magnet Pull wild seed) and for
// 20 random wanted-IV searches (every game, both kinds, both consoles, the leads, ranges and exact IVs, shiny with
// typed IDs): the seed models and their texts, the catalogue and the tables, the search lines, the hit / row lists,
// the result cards, the procedures, the typed outcomes and the store split by mode and seed model, plus the number
// formats JavaScript prints. The desktop panel's pure part (app/App/WizardSupport.cs) is checked against this file
// by app/Tests/WizardPanelChecks.cs, so the two heads agree number for number and line for line. Deterministic:
// a fixed PRNG picks the random inputs and every sample's 'when' is fixed, so a re-emit is byte-identical.
// usage: node tools/gen-wizard-panel-vectors.cjs [out.json]   (stdout when no path is given)
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyMode = require(path.join(root, "webapp", "mode.js"));
globalThis.ShinyGen4 = require(path.join(root, "core", "gen4.js"));
globalThis.ShinySeedTime4 = require(path.join(root, "core", "seedtime4.js"));
globalThis.ShinyGenerators = require(path.join(root, "core", "generators.js"));
globalThis.ShinyTimers = require(path.join(root, "core", "timers.js"));
const W = require(path.join(root, "webapp", "wizard-ui.js"));
const core = globalThis.ShinyCore, MODE = globalThis.ShinyMode, ST = globalThis.ShinySeedTime4, T = globalThis.ShinyTimers, gen4 = globalThis.ShinyGen4, G = globalThis.ShinyGenerators;
const loadGen = (g) => ({
  species: JSON.parse(fs.readFileSync(path.join(root, "core", "data", "species-gen" + g + ".json"), "utf8")),
  encounters: JSON.parse(fs.readFileSync(path.join(root, "core", "data", "encounters-gen" + g + ".json"), "utf8")),
  statics: JSON.parse(fs.readFileSync(path.join(root, "core", "data", "statics-gen" + g + ".json"), "utf8"))
});
W.setData(3, loadGen(3)); W.setData(4, loadGen(4));
const WHEN = "2026-09-03 00:00:00";
const IV = W.IV_KEYS;
const hex8 = W.hex8, two = (n) => (n < 10 ? "0" : "") + n, f1 = (x) => (Math.round(x * 10) / 10).toFixed(1), plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const ivObj = (a) => ({ hp: a[0], atk: a[1], def: a[2], spa: a[3], spd: a[4], spe: a[5] });

// ---- one line per hit / row, the shape both heads build ----------------------------------------------
function monText(m) {
  return [m.frame, hex8(m.pid), m.ivArray.join("/"), m.nature, m.gender, m.shiny ? 1 : 0, m.level, m.stats.join("/"), m.callsUsed,
    m.encounterSlot === undefined ? -1 : m.encounterSlot, m.abilitySlot, m.hiddenPowerType, m.hiddenPowerPower].join("|");
}
function rowText(r) {
  return [hex8(r.seed), r.frame, r.year + "-" + two(r.month) + "-" + two(r.day) + " " + two(r.hour) + ":" + two(r.minute) + ":" + two(r.second), r.delay, r.delayDistance, hex8(r.origin), monText(r.mon)].join("|");
}
function slotText(s) { return s.species.dex + ":" + s.minLevel + "-" + s.maxLevel + ":" + s.form; }
function cardCtx(cfg, seed, timeText) {
  return { gen: W.GAMES[cfg.game].gen, species: cfg.kind === "static" ? cfg.species : null, hasIds: cfg.wanted.tid !== null && cfg.wanted.tid !== undefined && cfg.wanted.sid !== null && cfg.wanted.sid !== undefined, tid: cfg.wanted.tid, sid: cfg.wanted.sid, seed: seed, model: W.modelOf(cfg.game), timeText: timeText };
}
// the tab's setup text (refreshSetup) reproduced line for line
function modelLines(game, consoleKey) {
  const model = W.modelOf(game);
  const lines = ["Seed model: " + model.id, "  " + model.text];
  if (model.typed) lines.push("  " + model.typed);
  lines.push("  Validation status: " + model.status + ".");
  lines.push("  Console rate: " + W.fpsOf(consoleKey).toFixed(4) + " fps (core/timers.js, EonTimer's constants); a frame is " + (1000 / W.fpsOf(consoleKey)).toFixed(4) + " ms.");
  lines.push("  " + W.NO_HARDWARE);
  return lines;
}
// the tab's recordGen3 / recordGen4 outcome text reproduced line for line, and the sample it stores
function recordGen3(store, cfg, target, timerModel, got, mode, attempt) {
  const out = [];
  let sample = null;
  try {
    if (!got.ivs && !got.stats && got.nature === null) throw new Error("type the nature and the IVs (or the six stats) you got");
    const r = W.gen3IdentifyHit(cfg, target.frame, got, 3000);
    if (!r.hit) throw new Error("nothing within " + 3000 + " frames of the target matches what you typed: check the values, or the seed model is not in force (a different seed, a different input path)");
    const settings = { console: cfg.console };
    const before = timerModel.calibration;
    const next = T.gen3Calibrated(settings, timerModel, r.hit.frame);
    sample = { model: W.modelOf(cfg.game).id, target: target.frame, hit: r.hit.frame, before: { calibration: before, preTimer: timerModel.preTimer }, after: { calibration: next.calibration, preTimer: next.preTimer }, candidates: r.candidates, attempt: attempt, when: WHEN };
    W.addSample(store, cfg.game, cfg.console, sample, mode);
    const d3 = r.hit.frame - target.frame;
    out.push("You hit frame " + r.hit.frame + ", aimed " + target.frame + ": " + (d3 === 0 ? "on the frame" : Math.abs(d3) + " frame" + (Math.abs(d3) === 1 ? "" : "s") + " " + (d3 > 0 ? "late" : "early") + " (" + f1(W.frameToMs(d3, cfg.console)) + " ms)") + "; " + plural(r.candidates, "candidate") + " matched within +-" + r.window + " frames" + (r.candidates > 1 ? ", the nearest taken: type the stats too to settle it" : "") + ".");
    out.push("Calibration " + f1(before) + " ms -> " + f1(next.calibration) + " ms (core/timers.js calibrateGen3, frame delta x " + (1000 / W.fpsOf(cfg.console)).toFixed(4) + " ms); recorded under " + W.modelOf(cfg.game).id + " [" + MODE.label(mode) + " mode].");
  } catch (e) { out.push("not recorded: " + e.message); }
  return { lines: out, sample: sample };
}
function recordGen4(store, cfg, target, timerModel, typed, delayRange, secondRange, roam, mode, attempt) {
  const out = [];
  let sample = null;
  try {
    const t = { year: target.year, month: target.month, day: target.day, hour: target.hour, minute: target.minute, second: target.second, delay: target.delay, seed: target.seed };
    const r = W.gen4IdentifyHit(cfg.game, t, typed, Math.min(2000, Math.max(1, delayRange)), Math.min(30, Math.max(0, secondRange)), { roamers: roam, elmWays: 3 });
    if (r.error) throw new Error(r.error);
    if (!r.matches.length) throw new Error("no delay within +-" + delayRange + " and second +-" + secondRange + " of the target produces " + r.typed + " (" + r.rows + " rows checked): widen the ranges, or the clock was set to another minute");
    const m = r.matches[0];
    const settings = { console: cfg.console };
    const before = timerModel.calibratedDelay;
    const next = T.gen4Calibrated(settings, timerModel, m.delay);
    sample = { model: W.modelOf(cfg.game).id, target: target.delay, hit: m.delay, secondOffset: m.secondOffset, typed: r.typed, before: { calibratedDelay: before, calibratedSecond: timerModel.calibratedSecond }, after: { calibratedDelay: next.calibratedDelay, calibratedSecond: next.calibratedSecond }, candidates: r.matches.length, attempt: attempt, when: WHEN };
    W.addSample(store, cfg.game, cfg.console, sample, mode);
    const d4 = m.delay - target.delay;
    out.push("You hit delay " + m.delay + " (seed " + hex8(m.seed) + ", second " + (m.secondOffset >= 0 ? "+" : "") + m.secondOffset + "), aimed " + target.delay + ": " + (d4 === 0 && m.secondOffset === 0 ? "on the target" : Math.abs(d4) + " delay" + (Math.abs(d4) === 1 ? "" : "s") + " " + (d4 > 0 ? "late" : "early") + " (" + f1(T.toMilliseconds({ console: cfg.console }, Math.abs(d4))) + " ms)") + "; " + plural(r.matches.length, "row") + " of " + r.rows + " match " + r.typed + (r.matches.length > 1 ? " (the nearest taken: type more flips / calls to settle it)" : "") + ".");
    out.push("Calibrated delay " + before + " -> " + next.calibratedDelay + " (core/timers.js calibrateGen4: the delta x 0.75 within 167 ms, else x 1.0, rounded half to even); recorded under " + W.modelOf(cfg.game).id + " [" + MODE.label(mode) + " mode].");
    if (m.delay === target.delay && m.secondOffset === 0) out.push("The seed is hit: advance to frame " + target.frame + " with the plan in the procedure, then trigger the encounter.");
  } catch (e) { out.push("not recorded: " + e.message); }
  return { lines: out, sample: sample };
}
function calRows(game, target, delayRange, roam) {
  const out = [];
  const fam = W.GAMES[game].family === "dppt" ? "DPPt" : "HGSS";
  const t = { year: target.year, month: target.month, day: target.day, hour: target.hour, minute: target.minute, second: target.second, delay: target.delay };
  const rows = ST.calibrateRows(target.seed, Math.min(50, Math.max(1, delayRange)), 0, fam, { target: t, roamers: roam, elmWays: 3 });
  out.push("Neighbouring delays at the target second (seed, delay, " + (fam === "DPPt" ? "coin flips" : "Elm calls") + "; core/seedtime4.js calibrateRows):");
  rows.forEach(function (r) { out.push("  " + hex8(r.seed) + "  delay " + r.delay + (r.delayOffset === 0 ? " <- target" : "") + "  " + r.sequence.slice(0, 40)); });
  return out;
}

// ---- one configuration from its input block (the desktop check builds its WizardCfg from the same block) -----------
function cfgFromInput(input) {
  const g = W.GAMES[input.game];
  const cfg = { game: input.game, console: input.console, kind: input.kind, options: { tanoby: false } };
  if (input.kind === "static") {
    const e = W.staticEntries(input.game).find(function (x) { return x.id === input.staticId; });
    cfg.species = e.species; cfg.level = e.level; cfg.buggedRoamer = e.buggedRoamer; cfg.shinyMode = e.shinyMode; cfg.staticMethod = e.method; cfg.staticLabel = e.label;
    cfg.method = g.gen === 3 ? input.method : e.method;
  } else {
    const t = W.wildTables(input.game).find(function (x) { return x.index === input.tableIndex; });
    const sl = W.slotsFor(input.game, t.index, input.encounter, { time: input.time });
    cfg.slots = sl.slots; cfg.rate = sl.rate; cfg.encounter = input.encounter; cfg.tableName = t.name; cfg.options = { tanoby: !!sl.tanoby };
    cfg.method = g.gen === 3 ? input.method : g.method;
  }
  cfg.lead = W.makeLead(input.leadKey, input.leadNature, input.leadGender, input.leadLevel);
  const w = input.wanted;
  cfg.wanted = { ivMin: ivObj(w.ivMin), ivMax: ivObj(w.ivMax), nature: w.nature, gender: w.gender, ability: w.ability, shiny: w.shiny, tid: w.tid, sid: w.sid, species: w.species };
  if (g.gen === 3) {
    cfg.seed = input.seed === null ? null : parseInt(input.seed, 16) >>> 0;
    cfg.maxFrame = Math.round(Math.min(240, Math.max(0.1, input.minutes)) * 60 * W.fpsOf(input.console));
    cfg.limit = 20;
  } else {
    Object.assign(cfg, { maxFrame: input.maxFrame, yearMin: input.yearMin, yearMax: input.yearMax, delayMin: input.delayMin, delayMax: input.delayMax, targetDelay: input.targetDelay, limit: 30 });
  }
  return cfg;
}
function timerModelOf(input) {
  return W.GAMES[input.game].gen === 3
    ? { mode: "STANDARD", preTimer: input.preTimer, targetFrame: 0, calibration: input.calibration }
    : { targetDelay: 600, targetSecond: 50, calibratedDelay: input.calibratedDelay, calibratedSecond: input.calibratedSecond };
}
function wantedOf(mn, mx, nature, gender, ability, shiny, tid, sid, species) {
  return { ivMin: mn, ivMax: mx, nature: nature, gender: gender, ability: ability, shiny: shiny, tid: tid, sid: sid, species: species };
}

// ---- the search of one input and everything the tab shows for its first hit / row -------------------------
function gen3Case(input) {
  const cfg = cfgFromInput(input);
  const timerModel = timerModelOf(input);
  const r = W.searchGen3(cfg);
  const out = { input: input, lines: W.gen3SearchLines(r, cfg), hits: r.hits.map(monText), maxFrame: r.maxFrame, limit: r.limit,
    feasibility: { ivPer100k: r.feasibility.ivPer100k, ivExact: r.feasibility.ivExact, wordsA: r.feasibility.wordsA, wordsB: r.feasibility.wordsB, odds: r.feasibility.odds, parts: r.feasibility.parts, per100k: r.feasibility.per100k, expectedFrames: r.feasibility.expectedFrames === Infinity ? "Infinity" : r.feasibility.expectedFrames },
    exactFirst: r.exactFirst ? { states: r.exactFirst.states, frame: r.exactFirst.first ? r.exactFirst.first.frame : -1, pid: r.exactFirst.first ? hex8(r.exactFirst.first.pid) : null, state: r.exactFirst.first ? hex8(r.exactFirst.first.state) : null } : null };
  if (r.hits.length) {
    const m = r.hits[0];
    const timeText = core.fmtMs(W.frameToMs(m.frame, cfg.console)) + " after the seed";
    out.card = W.cardLines(m, cardCtx(cfg, cfg.seed, timeText));
    const tm = Object.assign({}, timerModel, { targetFrame: m.frame });
    out.procedure = W.gen3Procedure(cfg, m, tm);
    out.phases = T.gen3Phases({ console: cfg.console }, tm);
    const id = W.gen3IdentifyHit(cfg, m.frame, { nature: m.nature, ivs: ivObj(m.ivArray) }, 3000);
    out.identify = { frame: id.hit ? id.hit.frame : -1, candidates: id.candidates };
  }
  return out;
}
function gen4Case(input) {
  const cfg = cfgFromInput(input);
  const timerModel = timerModelOf(input);
  const r = W.searchGen4(cfg);
  if (r.error) return { input: input, error: r.error, count: r.count, lines: W.gen4SearchLines(r, cfg) };
  const out = { input: input, lines: W.gen4SearchLines(r, cfg), rows: r.rows.map(rowText), combos: r.combos, origins: r.origins, candidates: r.candidates, verified: r.verified, maxFrame: r.maxFrame,
    feasibility: { ivPer100k: r.feasibility.ivPer100k, ivExact: r.feasibility.ivExact, per100k: r.feasibility.per100k, parts: r.feasibility.parts } };
  if (r.rows.length) {
    const row = r.rows[0];
    const timeText = row.year + "-" + two(row.month) + "-" + two(row.day) + " " + two(row.hour) + ":" + two(row.minute) + ":" + two(row.second) + " delay " + row.delay;
    out.card = W.cardLines(row.mon, cardCtx(cfg, row.seed, timeText));
    const tm = Object.assign({}, timerModel, { targetDelay: row.delay, targetSecond: row.second });
    const plan = Object.assign(ST.planAdvances(input.current, row.frame, { partyCount: input.party, tools: W.GAMES[cfg.game].family === "dppt" ? ["walk128", "journal", "chatot"] : ["walk128", "elmCall", "chatot"] }), { current: input.current, partyCount: input.party });
    out.procedure = W.gen4Procedure(cfg, row, tm, plan);
    out.phases = T.gen4Phases({ console: cfg.console }, tm);
    out.minutesBefore = T.gen4MinutesBefore({ console: cfg.console }, tm);
  }
  return out;
}

const out = {
  source: "webapp/wizard-ui.js over core/generators.js, core/seedtime4.js, core/timers.js and core/data/{species,encounters,statics}-gen{3,4}.json, emitted by tools/gen-wizard-panel-vectors.cjs; app/App/WizardSupport.cs is checked against it by app/Tests/WizardPanelChecks.cs",
  when: WHEN
};

// ---- the number formats JavaScript prints (toFixed, toPrecision, Math.round, Number#toString) --------------------
{
  const values = [0, 1, -1, 0.5, 1.5, 2.5, -2.5, 0.125, 0.375, 1.005, 12.5, 99.95, 100000, 123456.789, 1e21, 1e-7, 0.00000123, 1.23e-7, 274312.5, 16.742725372314453, 59.727500915527344, 59.8261, 6 / 4294967296 * 100000, 100000 / 3, 1 / 3, 2 / 3, 1e16, 12345678901234567890, 0.1 + 0.2, 503, 500, 1000 / 59.8261, -12.3, 0.04, 0.35, 35, 7.5e-5, 4.7e-8];
  out.jsFormat = values.map(function (v) {
    return { v: String(v), fixed1: v.toFixed(1), fixed4: v.toFixed(4), prec3: v.toPrecision(3), prec4: v.toPrecision(4), round: String(Math.round(v)), num: String(v), f1: f1(v) };
  });
  out.fmtMs = [0, 0.4, 0.5, 1, 999.5, 1000, 274312.5, 3600000, 215019 * 1000 / (16777216 / 280896), 7 * 1000 / 59.8261].map(function (ms) { return { ms: ms, text: core.fmtMs(ms) }; });
}

// ---- games, consoles, seed models, the setup text ------------------------------------------------------------
out.games = W.GAME_ORDER.map(function (k) { const g = W.GAMES[k]; return { key: k, name: g.name, gen: g.gen, family: g.family, method: g.method || null, model: g.model, consoles: W.consolesFor(k).map(function (c) { return c.key; }) }; });
out.consoles = Object.keys(W.CONSOLES).map(function (k) { return { key: k, gen: W.CONSOLES[k].gen, name: W.CONSOLES[k].name, fps: W.fpsOf(k), frame1000ms: W.frameToMs(1000, k) }; });
out.models = Object.keys(W.SEED_MODELS).map(function (k) { const m = W.SEED_MODELS[k]; return { id: m.id, kind: m.kind, seed: m.seed === undefined || m.seed === null ? null : m.seed, text: m.text, typed: m.typed || null, status: m.status }; });
out.modelLines = [];
W.GAME_ORDER.forEach(function (g) { W.consolesFor(g).forEach(function (c) { out.modelLines.push({ game: g, console: c.key, lines: modelLines(g, c.key) }); }); });
out.texts = { noHardware: W.NO_HARDWARE, cuteCharm: W.GEN4_CUTE_CHARM_NOTE, storeKey: W.STORE_KEY, kindNames: W.KIND_NAMES };

// ---- the catalogue and the tables ------------------------------------------------------------------------
out.statics = {};
out.tables = {};
out.leads = {};
W.GAME_ORDER.forEach(function (g) {
  out.statics[g] = W.staticEntries(g).map(function (e) { return [e.id, e.label, e.method, e.shinyMode, e.buggedRoamer ? 1 : 0, e.refused || "", e.level, e.species.dex, e.provenance || "", e.levelVerified ? 1 : 0].join("|"); });
  out.tables[g] = W.wildTables(g).map(function (t) { return [t.index, t.name, t.kinds.join(","), t.tanoby ? 1 : 0].join("|"); });
  out.leads[g] = { static: W.leadOptions(g, "static").map(function (l) { return l.key + "|" + l.name; }), wild: W.leadOptions(g, "wild").map(function (l) { return l.key + "|" + l.name; }) };
});
out.slots = [];
[["emerald", 6, "grass", null], ["emerald", 6, "old_rod", null], ["emerald", 6, "rock_smash", null], ["firered", null, "grass", null], ["ruby", 6, "surf", null],
  ["platinum", 170, "grass", "morning"], ["platinum", 170, "grass", "day"], ["platinum", 170, "grass", "night"], ["heartgold", null, "grass", "morning"], ["heartgold", null, "grass", "day"], ["heartgold", null, "grass", "night"],
  ["diamond", null, "surf", null], ["soulsilver", null, "super_rod", null], ["heartgold", null, "rock_smash", null], ["leafgreen", null, "super_rod", null]].forEach(function (q) {
  const game = q[0], kind = q[2], time = q[3];
  let index = q[1];
  const tables = W.wildTables(game);
  if (index === null) {
    const t = game === "firered" ? tables.find(function (x) { return x.tanoby; }) : tables.find(function (x) { return x.kinds.indexOf(kind) !== -1; });
    index = t.index;
  }
  const sl = W.slotsFor(game, index, kind, { time: time });
  const groups = W.speciesInSlots(sl.slots);
  out.slots.push({ game: game, index: index, kind: kind, time: time, rate: sl.rate, note: sl.note, tanoby: sl.tanoby, slots: sl.slots.map(slotText),
    groups: groups.map(function (s) { return s.species.dex + ":" + s.slots.join(",") + ":" + s.levels.join("/") + ":" + f1(100 * W.speciesShare(game, kind, sl.slots, s.species.dex)); }) });
});
out.slotErrors = [];
try { W.slotsFor("heartgold", 0, "grass", {}); } catch (e) { out.slotErrors.push(e.message); }
try { W.slotsFor("platinum", 0, "grass", {}); } catch (e) { out.slotErrors.push(e.message); }

// ---- the filter refusals ------------------------------------------------------------------------------
out.refusals = [];
function refusal(label, fn) { let msg = ""; try { fn(); } catch (e) { msg = e.message; } out.refusals.push({ label: label, message: msg }); }
refusal("shiny without IDs", function () { W.buildFilter({ ivMin: {}, ivMax: {}, shiny: true }); });
refusal("IV range out of order", function () { W.buildFilter({ ivMin: { hp: 5 }, ivMax: { hp: 4 } }); });
refusal("IV above 31", function () { W.buildFilter({ ivMin: {}, ivMax: { spe: 32 } }); });
const treecko = W.staticEntries("emerald").find(function (e) { return e.id === "rse/starter/treecko"; });
refusal("FRLG without a seed", function () { W.searchGen3({ game: "firered", console: "GBA", seed: null, kind: "static", species: treecko.species, level: 5, wanted: { ivMin: {}, ivMax: {} }, maxFrame: 10 }); });
refusal("Gen 4 combination cap", function () {
  const turtwig = W.staticEntries("platinum").find(function (e) { return e.id === "pt/starter/turtwig"; });
  const r = W.searchGen4({ game: "platinum", console: "NDS_SLOT1", kind: "static", staticMethod: "M1", species: turtwig.species, level: 5, shinyMode: "random", wanted: { ivMin: ivObj([0, 0, 0, 0, 0, 0]), ivMax: ivObj([31, 31, 31, 31, 31, 31]) }, maxFrame: 100, yearMin: 2000, yearMax: 2000, delayMin: 0, delayMax: 65535, targetDelay: 600, limit: 30 });
  throw new Error(r.error);
});
refusal("Gen 4 J cap", function () {
  const uxie = W.staticEntries("platinum").find(function (e) { return e.id === "dppt/legend/uxie"; });
  const r = W.searchGen4({ game: "platinum", console: "NDS_SLOT1", kind: "static", staticMethod: uxie.method, species: uxie.species, level: uxie.level, shinyMode: "random", wanted: { ivMin: ivObj([28, 28, 28, 28, 28, 28]), ivMax: ivObj([31, 31, 31, 31, 31, 31]) }, maxFrame: 100, yearMin: 2000, yearMax: 2000, delayMin: 0, delayMax: 65535, targetDelay: 600, limit: 30 });
  throw new Error(r.error);
});
refusal("too few flips", function () { const r = W.gen4IdentifyHit("platinum", { year: 2000, month: 1, day: 5, hour: 4, minute: 59, second: 59, delay: 18641, seed: 0x7b0448d1 }, "HTH", 10, 0, {}); throw new Error(r.error); });

// ---- the scenarios --------------------------------------------------------------------------------------
const RUN = MODE.RUN, PRACTICE = MODE.PRACTICE;
const scenarios = {};
{
  // A: Ruby Groudon Method 4 from the typed seed 0 (static3[0]): frame 3, its card, procedure and typed outcome
  const groudon = W.staticEntries("ruby").find(function (e) { return e.id === "ruby/legend/groudon"; });
  const inA = { game: "ruby", console: "GBA", kind: "static", staticId: "ruby/legend/groudon", method: "M4", leadKey: "", leadNature: 0, leadGender: "M", leadLevel: 50,
    wanted: wantedOf([12, 22, 24, 30, 25, 27], [12, 22, 24, 30, 25, 27], null, null, null, false, 12345, 54321, null), seed: "00000000", minutes: 60, calibration: 0, preTimer: 5000 };
  const cfgA = cfgFromInput(inA);
  const tmA = { mode: "STANDARD", preTimer: 5000, targetFrame: 3, calibration: 0 };
  const store = {};
  const a = gen3Case(inA);
  a.entry = { label: groudon.label, level: groudon.level, dex: groudon.species.dex, method: groudon.method };
  const target = W.searchGen3(cfgA).hits[0];
  a.identifyStats = (function () { const r = W.gen3IdentifyHit(cfgA, 3, { nature: 18, stats: ivObj(target.stats) }, 3000); return { frame: r.hit ? r.hit.frame : -1, candidates: r.candidates }; })();
  a.identifyNatureOnly = (function () { const r = W.gen3IdentifyHit(cfgA, 3, { nature: 18 }, 3000); return { frame: r.hit ? r.hit.frame : -1, candidates: r.candidates }; })();
  a.record = recordGen3(store, cfgA, target, tmA, { nature: 18, ivs: ivObj([12, 22, 24, 30, 25, 27]) }, RUN, "started at 00:00:00  [RUN mode]  rs/gba/boot-seed-v0");
  a.recordWrong = recordGen3(store, cfgA, target, tmA, { nature: 3, ivs: ivObj([0, 0, 0, 0, 0, 0]) }, RUN, "");
  a.recordEmpty = recordGen3(store, cfgA, target, tmA, { nature: null }, RUN, "");
  a.recordLate = recordGen3(store, cfgA, target, { mode: "STANDARD", preTimer: 5000, targetFrame: 3, calibration: 33.4 }, { nature: null, stats: ivObj(W.searchGen3(Object.assign({}, cfgA, { wanted: Object.assign({}, cfgA.wanted, { ivMin: {}, ivMax: {} }), maxFrame: 40 })).hits[8].stats) }, PRACTICE, "");
  a.store = store;
  a.inForce = (function () { const f = W.inForce(store, "ruby", "GBA", RUN, "rs/gba/boot-seed-v0"); return { value: f.value, samples: f.samples.length, ignored: f.ignored.length, lines: W.ignoredLines(f.ignored, RUN, "rs/gba/boot-seed-v0") }; })();
  a.inForcePractice = (function () { const f = W.inForce(store, "ruby", "GBA", PRACTICE, "rs/gba/boot-seed-v0"); return { value: f.value, samples: f.samples.length, ignored: f.ignored.length, lines: W.ignoredLines(f.ignored, PRACTICE, "rs/gba/boot-seed-v0") }; })();
  scenarios.groudon = a;
  // the honest limit: a flawless Treecko from Emerald's seed 0 has no frame in an hour; the first is 176,562,488
  scenarios.flawless = gen3Case({ game: "emerald", console: "GBA", kind: "static", staticId: "rse/starter/treecko", method: "M1", leadKey: "", leadNature: 0, leadGender: "M", leadLevel: 50,
    wanted: wantedOf([31, 31, 31, 31, 31, 31], [31, 31, 31, 31, 31, 31], null, null, null, false, null, null, null), seed: "00000000", minutes: 60, calibration: 0, preTimer: 5000 });
  scenarios.flawless.entry = { label: treecko.label };
}
{
  // B: Emerald Route 111 grass from the typed seed 1C71C71C (wild3[0]): advance 7's species, nature and IVs -> frame 7
  const sl = W.slotsFor("emerald", 6, "grass", {});
  const vec = G.gen3Wild(0x1c71c71c, { game: "emerald", method: "M1", encounter: "grass", slots: sl.slots, rate: sl.rate, lead: null, options: {}, tid: 12345, sid: 54321, frameStart: 7, frameCount: 1 })[0];
  const inB = { game: "emerald", console: "GBA", kind: "wild", tableIndex: 6, encounter: "grass", time: null, dex: vec.species, method: "M1", leadKey: "", leadNature: 0, leadGender: "M", leadLevel: 50,
    wanted: wantedOf(vec.ivArray, vec.ivArray, vec.nature, null, null, false, 12345, 54321, vec.species), seed: "1C71C71C", minutes: 60, calibration: -12.3, preTimer: 5000 };
  const b = gen3Case(inB);
  b.vector = { pid: hex8(vec.pid), slot: vec.encounterSlot, level: vec.level };
  b.share = W.speciesShare("emerald", "grass", sl.slots, vec.species);
  scenarios.route111 = b;
}
{
  // C: the design's gate seed 7B0448D1 -> frame 0 for a flawless Method 1 static (Platinum Turtwig), the coin flips, 500 -> 503
  const inC = { game: "platinum", console: "NDS_SLOT1", kind: "static", staticId: "pt/starter/turtwig", method: "M1", leadKey: "", leadNature: 0, leadGender: "M", leadLevel: 50,
    wanted: wantedOf([31, 31, 31, 31, 31, 31], [31, 31, 31, 31, 31, 31], null, null, null, false, null, null, null), maxFrame: 100, yearMin: 2000, yearMax: 2000, delayMin: 0, delayMax: 65535, targetDelay: 18641, current: 10, party: 3, calibratedDelay: 500, calibratedSecond: 14 };
  const cfgC = cfgFromInput(inC);
  const tmC = { targetDelay: 18641, targetSecond: 59, calibratedDelay: 500, calibratedSecond: 14 };
  const c = gen4Case(inC);
  const r = W.searchGen4(cfgC);
  const gate = r.rows.find(function (x) { return x.seed === 0x7b0448d1 && x.frame === 0; });
  c.gateIndex = r.rows.indexOf(gate);
  const store = {};
  c.flips = gen4.coinFlips(0x7b0448d1, 12);
  c.record = recordGen4(store, cfgC, gate, tmC, c.flips, 100, 1, null, RUN, "started at 00:00:00  [RUN mode]  dppt/nds/seed-to-time-v0");
  c.neighbourFlips = gen4.coinFlips(0x7b0448d5, 12);
  c.recordNeighbour = recordGen4(store, cfgC, gate, tmC, "T, T, T, H, T, H, H, H, T, H, H, T", 100, 1, null, RUN, "");
  c.recordNoMatch = recordGen4(store, cfgC, gate, tmC, "HHHHHHHHHHHHHHHHHHHH", 2, 0, null, RUN, "");
  c.recordShort = recordGen4(store, cfgC, gate, tmC, "HTH", 100, 1, null, RUN, "");
  c.recordPractice = recordGen4(store, cfgC, gate, { targetDelay: 18641, targetSecond: 59, calibratedDelay: 503, calibratedSecond: 14 }, gen4.coinFlips(0x7b0448d1 - 200, 14), 300, 1, null, PRACTICE, "");
  c.store = store;
  c.inForce = (function () { const f = W.inForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0"); return { value: f.value, samples: f.samples.length, ignored: f.ignored.length, lines: W.ignoredLines(f.ignored, RUN, "dppt/nds/seed-to-time-v0") }; })();
  c.calRows = calRows("platinum", gate, 3, null);
  c.identify = (function () { const t = { year: gate.year, month: gate.month, day: gate.day, hour: gate.hour, minute: gate.minute, second: gate.second, delay: gate.delay, seed: gate.seed }; const id = W.gen4IdentifyHit("platinum", t, c.flips, 100, 1, {}); return { matches: id.matches.map(function (m) { return hex8(m.seed) + "|" + m.delay + "|" + m.delayOffset + "|" + m.secondOffset; }), rows: id.rows, typed: id.typed, family: id.family }; })();
  c.hgssIdentify = (function () { const id = W.gen4IdentifyHit("heartgold", { year: 2000, month: 1, day: 5, hour: 4, minute: 59, second: 59, delay: 18641, seed: 0x7b0448d1 }, "EKEKE", 10, 0, { roamers: { raikou: true, entei: false, lati: false } }); return { matches: id.matches.map(function (m) { return hex8(m.seed) + "|" + m.delay + "|" + m.delayOffset + "|" + m.secondOffset; }), rows: id.rows, typed: id.typed, family: id.family }; })();
  c.hgssCalRows = calRows("heartgold", { year: 2000, month: 1, day: 5, hour: 4, minute: 59, second: 59, delay: 18641, seed: 0x7b0448d1 }, 2, { raikou: true, entei: true, lati: false });
  scenarios.gate = c;
}
{
  // D: Platinum Route 222 grass with a Magnet Pull lead (wild4[3]): seed 5D1745D0 at frame 0 (Luxio, slot 7)
  const sl = W.slotsFor("platinum", 170, "grass", { time: "morning" });
  const inD = { game: "platinum", console: "NDS_SLOT1", kind: "wild", tableIndex: 170, encounter: "grass", time: "morning", dex: sl.slots[7].species.dex, method: "J", leadKey: "MAGNET_PULL", leadNature: 0, leadGender: "M", leadLevel: 50,
    wanted: wantedOf([18, 30, 14, 17, 17, 14], [18, 30, 14, 17, 17, 14], null, null, null, false, 12345, 54321, sl.slots[7].species.dex), maxFrame: 50, yearMin: 2000, yearMax: 2099, delayMin: 0, delayMax: 65535, targetDelay: 600, current: 0, party: 1, calibratedDelay: 500, calibratedSecond: 14 };
  const d = gen4Case(inD);
  const r = W.searchGen4(cfgFromInput(inD));
  d.wild4Row = r.rows.findIndex(function (x) { return x.seed === 0x5d1745d0 && x.frame === 0; });
  scenarios.route222 = d;
}
out.scenarios = scenarios;

// ---- the store and the mode wall ----------------------------------------------------------------------
{
  const store = {};
  W.addSample(store, "platinum", "NDS_SLOT1", { model: "dppt/nds/seed-to-time-v0", target: 18641, hit: 18645, before: { calibratedDelay: 500, calibratedSecond: 14 }, after: { calibratedDelay: 503, calibratedSecond: 14 }, when: "t" }, RUN);
  const f1s = W.inForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0");
  store["platinum/NDS_SLOT1"].samples.push({ model: "dppt/nds/seed-to-time-v0", target: 18641, hit: 18700, before: { calibratedDelay: 503, calibratedSecond: 14 }, after: { calibratedDelay: 560, calibratedSecond: 14 }, when: "p", mode: PRACTICE });
  store["platinum/NDS_SLOT1"].samples.push({ model: "other/model", target: 1, hit: 1, before: { calibratedDelay: 0, calibratedSecond: 0 }, after: { calibratedDelay: 999, calibratedSecond: 0 }, when: "m", mode: RUN });
  store["platinum/NDS_SLOT1"].samples.push({ model: "dppt/nds/seed-to-time-v0", target: 2, hit: 2, before: { calibratedDelay: 0, calibratedSecond: 0 }, after: { calibratedDelay: 777, calibratedSecond: 0 }, when: "u", mode: "hunt" });
  store["platinum/NDS_SLOT1"].samples.push({ model: "dppt/nds/seed-to-time-v0", target: 3, hit: 3, before: { calibratedDelay: 0, calibratedSecond: 0 }, after: { calibratedDelay: 888, calibratedSecond: 0 }, when: "n" });
  const fRun = W.inForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0");
  const fPractice = W.inForce(store, "platinum", "NDS_SLOT1", PRACTICE, "dppt/nds/seed-to-time-v0");
  const fOther = W.inForce(store, "platinum", "NDS_SLOT1", RUN, "other/model");
  const g3 = W.inForce(store, "ruby", "GBA", RUN, "rs/gba/boot-seed-v0");
  out.store = {
    store: store, firstRun: { value: f1s.value, samples: f1s.samples.length, ignored: f1s.ignored.length },
    run: { value: fRun.value, samples: fRun.samples.length, ignored: fRun.ignored.length, lines: W.ignoredLines(fRun.ignored, RUN, "dppt/nds/seed-to-time-v0") },
    practice: { value: fPractice.value, samples: fPractice.samples.length, ignored: fPractice.ignored.length, lines: W.ignoredLines(fPractice.ignored, PRACTICE, "dppt/nds/seed-to-time-v0") },
    other: { value: fOther.value, samples: fOther.samples.length, ignored: fOther.ignored.length, lines: W.ignoredLines(fOther.ignored, RUN, "other/model") },
    gen3Default: { value: g3.value, samples: g3.samples.length, ignored: g3.ignored.length },
    storeKeys: { run: MODE.storeKey(W.STORE_KEY, RUN), practice: MODE.storeKey(W.STORE_KEY, PRACTICE) }
  };
}

// ---- 20 random wanted-IV searches -------------------------------------------------------------------------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260903);
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
out.random = [];
const GAME_SEQ = ["ruby", "emerald", "platinum", "heartgold", "sapphire", "firered", "diamond", "soulsilver", "emerald", "leafgreen", "pearl", "heartgold", "emerald", "ruby", "platinum", "soulsilver", "firered", "diamond", "emerald", "platinum"];
for (let n = 0; n < 20; n++) {
  const game = GAME_SEQ[n];
  const g = W.GAMES[game];
  const consoleKey = W.consolesFor(game)[ri(0, 1)].key;
  const kind = n % 2 === 0 ? "static" : "wild";
  const input = { game: game, console: consoleKey, kind: kind };
  let species = null;
  if (kind === "static") {
    const e = pick(W.staticEntries(game).filter(function (x) { return !x.refused; }));
    input.staticId = e.id;
    input.method = g.gen === 3 ? pick(["M1", "M2", "M4"]) : e.method;
    species = e.species;
    const leads = g.gen === 4 && e.method !== "M1" ? W.leadOptions(game, "static") : [W.leadOptions(game, "static")[0]];
    input.leadKey = pick(leads).key;
  } else {
    const t = pick(W.wildTables(game));
    const enc = pick(t.kinds);
    const time = g.gen === 4 && enc === "grass" ? pick(["morning", "day", "night"]) : null;
    const sl = W.slotsFor(game, t.index, enc, { time: time });
    species = pick(W.speciesInSlots(sl.slots)).species;
    input.tableIndex = t.index; input.encounter = enc; input.time = time; input.dex = species.dex;
    input.method = g.gen === 3 ? pick(["M1", "M2", "M4"]) : g.method;
    input.leadKey = pick(W.leadOptions(game, "wild")).key;
  }
  input.leadNature = ri(0, 24); input.leadGender = pick(["M", "F"]); input.leadLevel = ri(2, 60);
  // the wanted outcome: Gen 3 mixes exact stats, lower bounds and open ranges; Gen 4 stays under the combination cap
  const mn = [], mx = [];
  for (let i = 0; i < 6; i++) {
    const roll = rnd();
    if (g.gen === 4) {
      if (roll < 0.8) { const v = ri(0, 31); mn.push(v); mx.push(v); } else { const v = ri(0, 29); mn.push(v); mx.push(Math.min(31, v + ri(1, 2))); }
    } else if (roll < 0.2) { const v = ri(0, 31); mn.push(v); mx.push(v); }
    else if (roll < 0.55) { mn.push(ri(0, 20)); mx.push(31); }
    else { mn.push(0); mx.push(31); }
  }
  const genderFixed = !species || species.gender_ratio === 0 || species.gender_ratio === 254 || species.gender_ratio === 255;
  const hasAbility2 = !!(species && species.ability_ids && species.ability_ids[1]);
  const nature = rnd() < 0.5 ? null : ri(0, 24);
  const gender = genderFixed || rnd() < 0.6 ? null : pick(["M", "F"]);
  const ability = !hasAbility2 || rnd() < 0.7 ? null : ri(0, 1);
  const shiny = rnd() < 0.15;
  let tid = null, sid = null;
  if (rnd() < 0.75 || shiny) { tid = ri(0, 65535); sid = ri(0, 65535); }
  input.wanted = wantedOf(mn, mx, nature, gender, ability, shiny, tid, sid, kind === "wild" ? species.dex : null);
  if (g.gen === 3) {
    const model = W.modelOf(game);
    input.seed = hex8(model.kind === "fixed" ? (rnd() < 0.7 ? model.seed : ri(0, 0xffff) * 65536 + ri(0, 0xffff)) : ri(0, 0xffff) * 65536 + ri(0, 0xffff));
    input.minutes = pick([1, 5, 15, 30, 60, 60]);
    input.calibration = pick([0, -12.3, 33.4, 16.742725372314453]);
    input.preTimer = pick([5000, 3000, 8000]);
    out.random.push(Object.assign({ n: n }, gen3Case(input)));
  } else {
    input.maxFrame = kind === "static" && input.method === "M1" ? pick([100, 500, 2000]) : pick([50, 100, 300]);
    input.yearMin = pick([2000, 2000, 2010, 2026]); input.yearMax = pick([input.yearMin, 2099, Math.min(2099, input.yearMin + 5)]);
    input.delayMin = pick([0, 0, 500]); input.delayMax = pick([65535, 65535, 5000, 20000]);
    if (input.delayMax < input.delayMin) input.delayMax = 65535;
    input.targetDelay = pick([600, 600, 1500, 18641]);
    input.current = ri(0, 20); input.party = ri(1, 6);
    input.calibratedDelay = pick([500, 503, 480]); input.calibratedSecond = pick([14, 14, 15]);
    out.random.push(Object.assign({ n: n }, gen4Case(input)));
  }
}

const text = JSON.stringify(out, null, 1) + "\n";
if (process.argv[2]) fs.writeFileSync(process.argv[2], text); else process.stdout.write(text);
