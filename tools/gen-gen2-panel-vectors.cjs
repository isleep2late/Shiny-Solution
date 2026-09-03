// Emits tests/gen2tid-panel-vectors.json: what the web app's Gen 2 TID tab (webapp/gen2tid-ui.js over
// core/gen2tid.js and core/data/gen2-tid.json) computes for 20 target inputs (game, console, methodology,
// RTC state, anchor, bin, correction, count-in), the typed outcome each one inverts to, the bin guards and
// the RUN / PRACTICE-HUNT store split. The desktop panel's pure part (app/App/Gen2TidSupport.cs) is checked
// against this file by app/Tests/Gen2TidPanelChecks.cs, so the two heads agree number for number and line
// for line. Deterministic: no timestamps (every sample's 'when' is fixed), so a re-emit is byte-identical.
// usage: node tools/gen-gen2-panel-vectors.cjs [out.json]   (stdout when no path is given)
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(root, "core", "gen1tid.js"));
globalThis.ShinyGen1Data = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen1-tid.json"), "utf8"));
globalThis.ShinyGen3SidData = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen3-sid.json"), "utf8"));
globalThis.ShinyMode = require(path.join(root, "webapp", "mode.js"));
globalThis.ShinyGen1TidUi = require(path.join(root, "webapp", "gen1tid-ui.js"));
globalThis.ShinyGen2Tid = require(path.join(root, "core", "gen2tid.js"));
globalThis.ShinyGen2TidData = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen2-tid.json"), "utf8"));
const G2 = globalThis.ShinyGen2Tid, DATA = globalThis.ShinyGen2TidData, DATA1 = globalThis.ShinyGen1Data, MODE = globalThis.ShinyMode;
const U2 = require(path.join(root, "webapp", "gen2tid-ui.js"));
const WHEN = "2026-09-03 00:00:00";

// 20 target inputs: every game, every console, both DMG methodologies, recurring and first-boot-only RTC states,
// the three anchors, bins from 0 to 598, corrections from -30 to 350 ms, count-ins of 0-6 beeps, and one input
// whose A cue would fall before the anchor (an error in both heads). deltaBins is the typed outcome's distance
// from the aim: inside the 15-bin guard, on its edge (15), just outside (16 / -16), and one that leaves the table.
const inputs = [
  { game: "gold", platform: "gse", state: "days0", anchor: "menu", bin: 300, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: 2 },
  { game: "gold", platform: "gse", state: "days0", anchor: "reset", bin: 300, correctionMs: 100, beeps: 4, spacingS: 1.0, deltaBins: 0 },
  { game: "gold", platform: "gbp", state: "days512", anchor: "menu", bin: 598, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: -3 },
  { game: "gold", platform: "gba", state: "days0", anchor: "poweron", bin: 120, correctionMs: 100, beeps: 3, spacingS: 0.5, deltaBins: 15 },
  { game: "gold", platform: "gbc", state: "days200", anchor: "menu", bin: 392, correctionMs: 250, beeps: 2, spacingS: 1.0, deltaBins: 16 },
  { game: "gold", platform: "dmg", methodology: "gold/dmg/hold-start-v1", state: "days0", anchor: "poweron", bin: 45, correctionMs: 100, beeps: 4, spacingS: 1.0, deltaBins: -16 },
  { game: "gold", platform: "dmg", methodology: "gold/dmg/late-start-v1", state: "days0", anchor: "menu", bin: 300, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: 1 },
  { game: "gold", platform: "gse", state: "halt-days200", anchor: "menu", bin: 392, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: 0 },
  { game: "gold", platform: "gbc", state: "days1000", anchor: "poweron", bin: 10, correctionMs: 100, beeps: 6, spacingS: 0.5, deltaBins: -1 },
  { game: "silver", platform: "gse", state: "halt-days260", anchor: "menu", bin: 457, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: 0 },
  { game: "silver", platform: "gbc", state: "days0", anchor: "poweron", bin: 300, correctionMs: 100, beeps: 4, spacingS: 1.0, deltaBins: 4 },
  { game: "silver", platform: "dmg", methodology: "silver/dmg/late-start-v1", state: "days512", anchor: "menu", bin: 250, correctionMs: 150, beeps: 4, spacingS: 1.0, deltaBins: -2 },
  { game: "silver", platform: "gba", state: "days450", anchor: "menu", bin: 2, correctionMs: 30, beeps: 4, spacingS: 1.0, deltaBins: 3 },
  { game: "silver", platform: "gbp", state: "days0", anchor: "menu", bin: 599, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: 0 },
  { game: "silver", platform: "gse", state: "days0", anchor: "reset", bin: 0, correctionMs: -30, beeps: 0, spacingS: 1.0, deltaBins: 5 },
  { game: "crystal", platform: "gse", state: "days0", anchor: "menu", bin: 300, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: -5 },
  { game: "crystal", platform: "gbc", state: "days0", anchor: "poweron", bin: 598, correctionMs: 350, beeps: 5, spacingS: 2.0, deltaBins: -20 },
  { game: "crystal", platform: "gbp", state: "days0", anchor: "menu", bin: 1, correctionMs: 50, beeps: 4, spacingS: 1.0, deltaBins: 0 },
  { game: "crystal", platform: "gse", state: "days0", anchor: "reset", bin: 400, correctionMs: 100, beeps: 1, spacingS: 3.0, deltaBins: 400 },
  { game: "gold", platform: "gse", state: "days0", anchor: "menu", bin: 0, correctionMs: 200, beeps: 4, spacingS: 1.0, deltaBins: 0 }
];

function sched(s) {
  return {
    anchor: s.anchor, tA: s.tA, holdLo: s.holdLo === undefined ? null : s.holdLo, holdHi: s.holdHi === undefined ? null : s.holdHi,
    menu: s.menu === undefined ? null : s.menu, droppedCountIn: s.droppedCountIn, countInTimes: s.countInTimes, duration: s.duration,
    cues: s.cues.map(function (c) { return { t: c.t, freq: c.freq, ms: c.ms, label: c.label, kind: c.kind }; }),
    bin: s.bin, aimOffset: s.aimOffset, aimV: s.aimV, aWindow: s.aWindow, tapMs: s.tapMs, rollSettleS: s.rollSettleS, methodology: s.methodology
  };
}
function outcome(o) {
  return { added: o.added, refused: o.refused, hitBin: o.hitBin, implied: o.implied, newCorrection: o.newCorrection === undefined ? null : o.newCorrection,
    candidateBins: o.candidates.map(function (c) { return c.bin; }), elsewhere: o.elsewhere.map(function (c) { return c.table + "/" + c.bin; }), lines: o.lines };
}

const cases = inputs.map(function (inp) {
  const c = { input: inp };
  let plat;
  try {
    plat = U2.resolve(DATA, inp.game, inp.platform, inp.methodology || null, inp.state, null, DATA1);
  } catch (e) { c.resolveError = e.message; return c; }
  c.methodologyId = plat.methodologyId;
  c.reachable = plat.reachable;
  c.outcomeState = U2.outcomeState(plat);
  try {
    const info = U2.binInfo(plat, inp.bin);
    c.binInfo = { tid: info.tid, lid: info.lid, sid: info.sid === undefined ? null : info.sid, offsets: info.offsets, visible: info.visible, aim: info.aim, aimV: info.aimV, aimS: info.aimS, afterPowerOnS: info.afterPowerOnS };
    c.describeBin = U2.describeBin(plat, inp.bin);
  } catch (e) { c.binError = e.message; return c; }
  try {
    const s = U2.buildSchedule(plat, inp.anchor, inp.bin, inp.correctionMs, inp.beeps, inp.spacingS);
    c.schedule = sched(s);
    c.scheduleLines = U2.scheduleLines(s, inp.bin, inp.correctionMs, plat);
    c.protocolLines = U2.protocolLines(plat, inp.anchor, inp.bin, s, inp.correctionMs, inp.beeps, inp.spacingS);
  } catch (e) { c.scheduleError = e.message; return c; }
  // the typed outcome: the Trainer ID of the bin deltaBins away in the chosen state (or, past the table's end, a
  // Trainer ID that no bin of the platform produces), recorded in RUN mode into an empty store
  const hitBin = inp.bin + inp.deltaBins;
  let tid;
  if (hitBin >= 0 && hitBin < G2.BIN_COUNT) tid = G2.lookup(DATA, plat.gameKey, plat.platformKey, plat.state, hitBin).tid;
  else {
    tid = 0;
    while (G2.invert(DATA, plat.gameKey, tid, { platformKey: plat.platformKey }).candidates.length) tid++;
  }
  c.typedTid = tid;
  const cal = {};
  const o = U2.recordOutcome(cal, plat, inp.anchor, inp.bin, inp.correctionMs, tid, null, { attempt: "a1", when: WHEN, player: "winforms", mode: MODE.RUN });
  c.outcome = outcome(o);
  c.store = cal;
  return c;
});

// the guards and the store split on the first input (Gold on GSE, bin 300, the USAGE example)
const guards = {};
{
  const inp = inputs[0];
  const plat = U2.resolve(DATA, inp.game, inp.platform, null, inp.state, null, DATA1);
  const tidAt = function (b) { return G2.lookup(DATA, plat.gameKey, plat.platformKey, plat.state, b).tid; };
  const cal = {};
  const first = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(302), null, { attempt: "a1", when: WHEN, player: "winforms", mode: MODE.RUN });
  const dup = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(302), null, { attempt: "a1", when: WHEN, player: "winforms", mode: MODE.RUN });
  const forced = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(302), null, { attempt: "a1", when: WHEN, player: "winforms", mode: MODE.RUN, force: true });
  const edge = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(315), null, { attempt: "a2", when: WHEN, player: "winforms", mode: MODE.RUN });
  const outlier = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(316), null, { attempt: "a3", when: WHEN, player: "winforms", mode: MODE.RUN });
  const outlierForced = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(316), null, { attempt: "a3", when: WHEN, player: "winforms", mode: MODE.RUN, force: true });
  const practice = U2.recordOutcome(cal, plat, "menu", 300, 200, tidAt(310), null, { attempt: "p1", when: WHEN, player: "winforms", mode: MODE.PRACTICE });
  guards.first = outcome(first); guards.duplicate = outcome(dup); guards.forced = outcome(forced); guards.edge = outcome(edge);
  guards.outlier = outcome(outlier); guards.outlierForced = outcome(outlierForced); guards.practiceIntoSameStore = outcome(practice);
  guards.store = JSON.parse(JSON.stringify(cal));          // before the drop and the clear below
  guards.runSamples = U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.RUN).length;
  guards.practiceSamples = U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.PRACTICE).length;
  guards.runCorrection = U2.correctionInForce(cal, plat, "menu", MODE.RUN);
  guards.practiceCorrection = U2.correctionInForce(cal, plat, "menu", MODE.PRACTICE);
  guards.runIgnoredLines = U2.ignoredSampleLines(cal, plat, "menu", MODE.RUN);
  guards.practiceIgnoredLines = U2.ignoredSampleLines(cal, plat, "menu", MODE.PRACTICE);
  guards.runStats = U2.statsLines(U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.RUN), plat, "menu", MODE.RUN);
  guards.hitSummary = U2.hitSummary(U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.RUN), "menu", plat.methodologyId).line;
  const dropped = U2.dropLastSample(cal, plat, "menu", MODE.RUN);
  guards.droppedHitBin = dropped ? dropped.hit_bin : null;
  guards.afterDrop = { run: U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.RUN).length, practice: U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.PRACTICE).length };
  const cleared = U2.clearSamples(cal, plat, "menu", false, MODE.RUN);
  guards.afterClear = { removed: cleared.removed.length, kept: cleared.kept.length, practice: U2.samplesFor(cal, plat.key, "menu", plat.methodologyId, MODE.PRACTICE).length };
  guards.storeKeys = { run: MODE.storeKey(U2.STORE_KEY_CAL, MODE.RUN), practice: MODE.storeKey(U2.STORE_KEY_CAL, MODE.PRACTICE) };
  // an outcome from a first-boot-only state teaches nothing about the correction and says where it is produced
  guards.elsewhere = outcome(U2.recordOutcome({}, plat, "menu", 300, 200, 0x6F53, 0x03E9, { attempt: "e1", when: WHEN, player: "winforms", mode: MODE.RUN }));
  // the invert panel and verify on the same platform
  guards.invertAll = U2.invertLines(plat, 0x6F53, 0x03E9, { family: "all" }).lines;
  guards.invertPrior = U2.invertLines(plat, tidAt(300), null, { family: "prior" }).lines;
  guards.verifyConsistent = U2.verifyLines(plat, tidAt(300), null, 20.13).lines;
  guards.verifyInconsistent = U2.verifyLines(plat, tidAt(300), null, 22.13).lines;
  guards.targetSetLines = U2.targetSetLines(plat);
  guards.reachabilityLines = U2.reachabilityLines(DATA, "gold");
  guards.methodologyLines = U2.methodologyLines(plat, true, "");
  guards.stateOptions = U2.stateOptions(DATA, "gold").map(function (s) { return s.value + "|" + s.text; });
}

const out = {
  source: "webapp/gen2tid-ui.js over core/gen2tid.js and core/data/gen2-tid.json, emitted by tools/gen-gen2-panel-vectors.cjs; app/App/Gen2TidSupport.cs is checked against it by app/Tests/Gen2TidPanelChecks.cs",
  when: WHEN, player: "winforms", cases: cases, guards: guards
};
const text = JSON.stringify(out, null, 1) + "\n";
if (process.argv[2]) fs.writeFileSync(process.argv[2], text); else process.stdout.write(text);
