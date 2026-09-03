// The RUN / PRACTICE-HUNT wall in the web app's Gen 1 TID tab, over tests/mode-wall-fixture.json:
// the correction in force in RUN mode is the mean of the RUN samples only, the practice sample is
// listed as ignored with the mode note, and the other way round in PRACTICE / HUNT mode; a record
// made in PRACTICE / HUNT is stamped "practice" and lands under the practice store key, which RUN
// never reads. A record whose mode this head does not know is in force in neither mode and breaks
// nothing (the note names it as unknown), and the remembered reset adjustment and the Secret ID pins
// follow the mode the same way. usage: node test-mode-wall.cjs <fixture.json> [gen1tid-ui.js] [mode.js]
// (run-tests.sh runs it on the committed fixture, then on a corrupted copy that must fail).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const fixturePath = process.argv[2];
if (!fixturePath) { console.error("usage: node test-mode-wall.cjs <fixture.json> [gen1tid-ui.js] [mode.js]"); process.exit(2); }
const uiPath = process.argv[3] || path.join(root, "webapp", "gen1tid-ui.js");
const modePath = process.argv[4] || path.join(root, "webapp", "mode.js");

let failures = 0, checks = 0;
function assert(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error("FAIL " + label + (detail === undefined ? "" : "\n  " + JSON.stringify(detail))); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const DATA = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen1-tid.json"), "utf8"));
globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(root, "core", "gen1tid.js"));
globalThis.ShinyGen1Data = DATA;
globalThis.ShinyGen3SidData = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen3-sid.json"), "utf8"));
const M = require(modePath);
globalThis.ShinyMode = M;
const U = require(uiPath);
const G = globalThis.ShinyGen1Tid;

const plat = U.resolve(DATA, "red", fx.platform, fx.methodology, null);
assert("fixture methodology resolves", plat.methodologyId === fx.methodology, plat.methodologyId);

// 1. the same store read in each mode: only that mode's samples are in force, the others are named as ignored
for (const mode of [M.RUN, M.PRACTICE]) {
  const exp = fx.expected[mode];
  const cal = JSON.parse(JSON.stringify(fx.store));
  const inForce = U.samplesFor(cal, fx.platform, fx.anchor, fx.methodology, mode);
  assert(`${M.label(mode)}: ${exp.n} sample(s) in force`, inForce.length === exp.n, inForce.map((s) => s.mode));
  assert(`${M.label(mode)}: every sample in force was made in this mode`, inForce.every((s) => M.effectiveMode(s) === mode));
  const corr = U.correctionInForce(cal, plat, fx.anchor, mode);
  assert(`${M.label(mode)}: correction in force ${exp.correction_ms} ms`, near(corr, exp.correction_ms), corr);
  const ign = U.ignoredSamples(cal, fx.platform, fx.anchor, fx.methodology, mode);
  assert(`${M.label(mode)}: ${exp.ignored_by_mode} sample(s) ignored for their mode`, ign.mode.length === exp.ignored_by_mode, ign.mode.map((s) => s.mode));
  const lines = U.ignoredSampleLines(cal, plat, fx.anchor, mode).join("\n");
  assert(`${M.label(mode)}: the ignore note says so`, lines.includes(exp.note_contains), lines);
  assert(`${M.label(mode)}: the note says samples are never mixed across modes`, lines.includes("never mixed across modes"), lines);
  const stats = U.statsLines(inForce, plat, fx.anchor, mode).join("\n");
  assert(`${M.label(mode)}: the stats header names the mode`, stats.includes("(methodology " + fx.methodology + ", " + M.label(mode) + " mode)"), stats.split("\n")[0]);
}

// 2. a record made in PRACTICE / HUNT is stamped, kept under the practice key, and never read by RUN
{
  const KEY_RUN = U.calStoreKey(M.RUN), KEY_PRACTICE = U.calStoreKey(M.PRACTICE);
  assert("the two modes have different store keys", KEY_RUN !== KEY_PRACTICE && KEY_PRACTICE.endsWith(".practice"), [KEY_RUN, KEY_PRACTICE]);
  assert("the RUN key is the store the tab always used", KEY_RUN === "shinySolution.gen1tid.calibration");
  const calP = U.loadCalibration(M.PRACTICE);
  assert("the practice store starts empty here", Object.keys(calP).length === 0);
  const o = U.recordOutcome(calP, plat, fx.anchor, 358, 200, plat.table[364], { attempt: "p-new", mode: M.PRACTICE, when: "2026-09-03 12:00:00" });
  assert("practice record added", o.added && o.hit === 364, o);
  const stored = U.allSamples(calP, fx.platform, fx.anchor);
  assert("practice record stamped mode: practice", stored.length === 1 && stored[0].mode === M.PRACTICE, stored);
  assert("practice outcome text names the mode", o.lines.join("\n").includes("Mode: PRACTICE / HUNT"), o.lines);
  U.saveCalibration(calP, M.PRACTICE);
  assert("saving the practice store leaves the RUN store empty", Object.keys(U.loadCalibration(M.RUN)).length === 0, U.loadCalibration(M.RUN));
  assert("the practice store reads back with the record", U.allSamples(U.loadCalibration(M.PRACTICE), fx.platform, fx.anchor).length === 1);
  // the same record forced into the RUN store is still not in force there
  const calR = U.loadCalibration(M.RUN);
  calR[U.calKey(fx.platform, fx.anchor)] = { samples: stored.slice() };
  assert("a practice record inside the RUN store is not in force", U.samplesFor(calR, fx.platform, fx.anchor, fx.methodology, M.RUN).length === 0);
  assert("... and the default correction stays", near(U.correctionInForce(calR, plat, fx.anchor, M.RUN), plat.defaults.correction_ms[fx.anchor]));
  assert("... with the note", U.ignoredSampleLines(calR, plat, fx.anchor, M.RUN).join("\n").includes("recorded in PRACTICE / HUNT mode, not RUN"));
  // drop-last and clear stay inside the mode
  const calBoth = JSON.parse(JSON.stringify(fx.store));
  const d = U.dropLastSample(calBoth, plat, fx.anchor, M.RUN);
  assert("drop last in RUN drops the newest RUN sample, not the practice one", d && d.attempt === "r2" && U.allSamples(calBoth, fx.platform, fx.anchor).some((s) => s.attempt === "p1"), d);
  const c = U.clearSamples(calBoth, plat, fx.anchor, false, M.RUN);
  assert("clear in RUN keeps the practice sample", c.removed.length === 1 && c.kept.length === 1 && c.kept[0].mode === M.PRACTICE, c);
  // a record must say which mode it was made in
  let threw = false;
  try { U.recordOutcome({}, plat, fx.anchor, 358, 200, plat.table[360], { attempt: "x" }); } catch (e) { threw = /mode must be/.test(e.message); }
  assert("recordOutcome without a mode is refused", threw);
  threw = false;
  try { U.samplesFor({}, fx.platform, fx.anchor, fx.methodology, "hunt"); } catch (e) { threw = /mode must be/.test(e.message); }
  assert("an unknown mode is refused", threw);
}

// 3. the switch itself: RUN by default, explicit on, explicit off; legacy records count as RUN
{
  assert("RUN is the default", M.get() === M.RUN);
  assert("the mode setting has its own key", M.KEY === "shinySolution.mode");
  M.set(M.PRACTICE);
  assert("PRACTICE / HUNT after an explicit set", M.get() === M.PRACTICE && M.isPractice());
  M.set(M.RUN);
  assert("back to RUN", M.get() === M.RUN);
  assert("a record without a mode is a RUN record", M.effectiveMode({}) === M.RUN && M.effectiveMode({ mode: null }) === M.RUN);
  assert("a practice record is not", M.effectiveMode({ mode: "practice" }) === M.PRACTICE);
  assert("the banner text", M.BANNER === "PRACTICE / HUNT mode - tools that read the capture are enabled; not for submitted runs");
}

// 4. a record whose mode this head does not know (a typo, an empty string, a value a later hunt head writes):
//    in force in neither mode, and the tab still renders: the note names it as unknown instead of throwing
function attempt(fn) { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } }
for (const bad of ["hunt", ""]) {
  const shown = JSON.stringify(bad) + " (unknown mode)";
  const key = U.calKey(fx.platform, fx.anchor);
  const d = attempt(() => M.describeMode({ mode: bad }));
  assert(`mode ${shown}: describeMode names it without throwing`, d.ok && d.value === shown, d);
  const cal = JSON.parse(JSON.stringify(fx.store));
  cal[key].samples.push(Object.assign({}, fx.store[key].samples[2], { mode: bad, attempt: "x1" }));
  for (const mode of [M.RUN, M.PRACTICE]) {
    const exp = fx.expected[mode];
    assert(`mode ${shown}: in force in neither mode (${M.label(mode)} keeps ${exp.n})`, U.samplesFor(cal, fx.platform, fx.anchor, fx.methodology, mode).length === exp.n);
    const lines = attempt(() => U.ignoredSampleLines(cal, plat, fx.anchor, mode));
    assert(`mode ${shown}: ignoredSampleLines returns in ${M.label(mode)}`, lines.ok, lines.error);
    assert(`mode ${shown}: the ${M.label(mode)} note names the record as unknown`, lines.ok && lines.value.join("\n").includes(shown), lines.value);
    assert(`mode ${shown}: statsLines still renders in ${M.label(mode)}`, attempt(() => U.statsLines(U.samplesFor(cal, fx.platform, fx.anchor, fx.methodology, mode), plat, fx.anchor, mode).length).ok);
  }
  const o = attempt(() => U.recordOutcome(cal, plat, fx.anchor, 358, 200, plat.table[362], { attempt: "n", mode: M.RUN }));
  assert(`mode ${shown}: recordOutcome in RUN still returns`, o.ok, o.error);
  assert(`mode ${shown}: ... and adds the sample`, o.ok && o.value.added === true && o.value.hit === 362, o.value);
}

// 5. the remembered reset adjustment and the Secret ID pins follow the mode the same way: their own store keys,
//    every record stamped, a record of the other mode in a store never applied and named
{
  assert("the reset adjustment store key follows the mode", U.resetStoreKey(M.RUN) === "shinySolution.gen1tid.resetAdjust" && U.resetStoreKey(M.PRACTICE) === "shinySolution.gen1tid.resetAdjust.practice");
  assert("the pin store key follows the mode", U.pinStoreKey(M.RUN) === "shinySolution.gen1tid.sidPins" && U.pinStoreKey(M.PRACTICE) === "shinySolution.gen1tid.sidPins.practice");
  const adj = { gse: 1.5, dmg: { frames: 2, mode: "practice", when: "x" }, gbp: { frames: -1, mode: "hunt" } };
  assert("a bare-number adjustment (before modes) is a RUN record", JSON.stringify(U.resetAdjustFor(adj, "gse", M.RUN)) === JSON.stringify({ frames: 1.5, ignored: null }), U.resetAdjustFor(adj, "gse", M.RUN));
  assert("... and not a PRACTICE / HUNT one", U.resetAdjustFor(adj, "gse", M.PRACTICE).frames === 0 && U.resetAdjustFor(adj, "gse", M.PRACTICE).ignored !== null);
  const ra = U.resetAdjustFor(adj, "dmg", M.RUN);
  assert("a practice adjustment in the RUN store is not applied", ra.frames === 0 && !!ra.ignored && ra.ignored.frames === 2, ra);
  assert("... and the note says so", !!ra.ignored && U.resetAdjustIgnoredLine(ra.ignored, "dmg", M.RUN).includes("recorded in PRACTICE / HUNT mode, not RUN"));
  assert("a practice adjustment is applied in PRACTICE / HUNT", U.resetAdjustFor(adj, "dmg", M.PRACTICE).frames === 2 && U.resetAdjustFor(adj, "dmg", M.PRACTICE).ignored === null);
  assert("an adjustment of an unknown mode is applied in neither mode and named", U.resetAdjustFor(adj, "gbp", M.RUN).frames === 0 && U.resetAdjustFor(adj, "gbp", M.PRACTICE).frames === 0 &&
    U.resetAdjustIgnoredLine(adj.gbp, "gbp", M.RUN).includes("\"hunt\" (unknown mode)"));
  assert("no adjustment stored: 0, nothing ignored", JSON.stringify(U.resetAdjustFor(adj, "sp", M.RUN)) === JSON.stringify({ frames: 0, ignored: null }));
  const saved = U.setResetAdjust(adj, "gse", 3, M.PRACTICE);
  assert("a saved adjustment is stamped with the mode", saved.mode === M.PRACTICE && saved.frames === 3 && U.resetAdjustFor(adj, "gse", M.RUN).frames === 0, saved);
  U.saveResetAdjust({ gse: saved }, M.PRACTICE);
  assert("saving the practice adjustments leaves the RUN store empty", Object.keys(U.loadResetAdjust(M.RUN)).length === 0 && U.loadResetAdjust(M.PRACTICE).gse.frames === 3);
  let threw = false;
  try { U.setResetAdjust(adj, "gse", 1, "hunt"); } catch (e) { threw = /mode must be/.test(e.message); }
  assert("an adjustment must say its mode", threw);
  const pins = {};
  U.addPin(pins, "m", 9572, 0x12345678, false, "practice", M.PRACTICE);
  assert("a pin is stamped with the mode", U.allPins(pins, "m", 9572).length === 1 && U.allPins(pins, "m", 9572)[0].mode === M.PRACTICE, pins);
  assert("a practice pin in the store is not used in RUN", U.pinsFor(pins, "m", 9572, M.RUN).length === 0 && U.ignoredPins(pins, "m", 9572, M.RUN).length === 1);
  assert("... and is used in PRACTICE / HUNT", U.pinsFor(pins, "m", 9572, M.PRACTICE).length === 1 && U.ignoredPins(pins, "m", 9572, M.PRACTICE).length === 0);
  assert("... and the RUN listing names it", U.pinLines([], { id: "m" }, 9572, M.RUN, U.ignoredPins(pins, "m", 9572, M.RUN)).join("\n").includes("1 stored pin for m / Trainer ID 9572 ignored: recorded in PRACTICE / HUNT mode, not RUN"));
  const other = attempt(() => U.addPin(pins, "m", 9572, 0x12345678, true, "run", M.RUN));
  assert("the same PID pinned the other way in RUN does not collide with the practice pin", other.ok && U.allPins(pins, "m", 9572).length === 2 && U.pinsFor(pins, "m", 9572, M.RUN)[0].shiny === true, other);
  const c = U.clearPins(pins, "m", 9572, M.RUN);
  assert("clearing in RUN keeps the practice pin", c.removed.length === 1 && c.kept.length === 1 && U.allPins(pins, "m", 9572)[0].mode === M.PRACTICE, c);
  U.savePins(pins, M.PRACTICE);
  assert("saving the practice pins leaves the RUN store empty", Object.keys(U.loadPins(M.RUN)).length === 0 && U.allPins(U.loadPins(M.PRACTICE), "m", 9572).length === 1);
  threw = false;
  try { U.addPin(pins, "m", 1, 1, true, "", "hunt"); } catch (e) { threw = /mode must be/.test(e.message); }
  assert("a pin must say its mode", threw);
}

console.log(`mode wall: ${checks} checks, ${failures} failure${failures === 1 ? "" : "s"}`);
process.exit(failures ? 1 : 0);
