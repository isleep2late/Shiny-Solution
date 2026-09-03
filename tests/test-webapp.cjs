// Webapp smoke test for the Gen 1 Trainer ID tab: (1) the mobile bundle (build-mobile-bundle.mjs)
// carries the tab, the engine, the tab module and the embedded data; (2) the tab's pure module
// (webapp/gen1tid-ui.js) loaded in node agrees with the engine and with RNG Solution's numbers.
// usage: node test-webapp.cjs [bundle.ts]   (the bundle is built into a temp file when not given)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
let failures = 0, checks = 0;
function assert(label, cond, detail) {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 40) console.error("FAIL " + label + (detail === undefined ? "" : "\n  " + JSON.stringify(detail)));
  }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

const DATA = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen1-tid.json"), "utf8"));
const SIDDATA = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen3-sid.json"), "utf8"));

// ---- 1. the bundle -------------------------------------------------------------------------
let bundlePath = process.argv[2];
let tmpDir = null;
if (!bundlePath) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiny-webapp-"));
  bundlePath = path.join(tmpDir, "bundle.ts");
  execFileSync(process.execPath, [path.join(root, "webapp", "build-mobile-bundle.mjs"), bundlePath], { stdio: "pipe" });
}
const ts = fs.readFileSync(bundlePath, "utf8");
assert("bundle exports shinySolutionHtml", ts.startsWith("export const shinySolutionHtml = "));
const html = JSON.parse(ts.slice(ts.indexOf("=") + 1).trim().replace(/;$/, ""));
assert("bundle has the Gen 1 TID tab button", html.includes('data-tab="g1tid"'));
assert("bundle has the tab section", html.includes('id="tab-g1tid"'));
assert("bundle has the full-screen flash element", html.includes('id="g1-flash"'));
assert("bundle has the Secret ID card", html.includes('id="sid-card"'));
assert("bundle embeds gen1tid.js", html.includes("root.ShinyGen1Tid = factory(root.ShinyCore)"));
assert("bundle embeds the tab module", html.includes("root.ShinyGen1TidUi = api"));
assert("bundle embeds the Gen 1 data as a global", html.includes("window.ShinyGen1Data = {"));
assert("bundle embeds the Gen 3 SID data as a global", html.includes("window.ShinyGen3SidData = {"));
for (const id of Object.keys(DATA.methodologies)) assert("bundle embeds methodology " + id, html.includes('"' + id + '"'));
for (const id of Object.keys(SIDDATA.methodologies)) assert("bundle embeds SID methodology " + id, html.includes('"' + id + '"'));
const redTable = DATA.methodologies["red/gba/hold-start-v1"].table_data.tids_hex;
assert("bundle embeds the red GBA table verbatim", html.includes(redTable));
assert("bundle embeds the DMG table verbatim", html.includes(DATA.methodologies["red/dmg/hold-start-v1"].table_data.tids_hex));
assert("bundle embeds the Emerald model", html.includes('"k_fixed": 1645'));
assert("no unresolved script tag", !html.includes("<script src="));
{
  const start = html.indexOf("window.ShinyGen1Data = ");
  const stop = html.indexOf("</script>", start);
  assert("no </ inside the inlined data script", start > 0 && stop > start && !html.slice(start, stop).includes("</"));
}
assert("the existing tabs are still there", ["g3timer", "g3check", "g4", "g12", "about"].every((t) => html.includes('data-tab="' + t + '"')));
assert("the Gen 3 timer's Space handler is scoped to its tab", html.includes('document.getElementById("tab-g3timer").classList.contains("active")'));
assert("the self-test keeps storage in memory", html.includes('root.location.search.indexOf("g1selftest") !== -1);') && html.includes("if (MEMORY_ONLY) return;"));
// the RUN / PRACTICE-HUNT wall in the bundle: the switch and the banner above every tab, mode.js before the tabs' scripts, and no hunt code
assert("bundle embeds mode.js", html.includes("root.ShinyMode = api"));
assert("mode.js comes before app.js and the tab module", html.indexOf("root.ShinyMode = api") < html.indexOf("var MODE = window.ShinyMode") && html.indexOf("root.ShinyMode = api") < html.indexOf("root.ShinyGen1TidUi = api"));
assert("bundle has the mode banner outside the tab sections", html.includes('<div id="mode-banner" hidden>') && html.indexOf('id="mode-banner"') < html.indexOf("<main>"));
assert("bundle carries the banner text", html.includes("PRACTICE / HUNT mode - tools that read the capture are enabled; not for submitted runs"));
assert("bundle has the explicit switch", html.includes('<input id="mode-practice" type="checkbox">'));
assert("bundle references no script under hunt/", !/<script[^>]*\ssrc="([^"]*\/)?hunt\//.test(html));
const sentinelSrc = fs.readFileSync(path.join(root, "webapp", "hunt", "sentinel.js"), "utf8");
const sentinel = (sentinelSrc.match(/SHINY_HUNT_SENTINEL = "([^"]+)"/) || [])[1];
assert("hunt/sentinel.js defines the sentinel", !!sentinel);
assert("bundle carries no hunt code (the sentinel is absent)", !!sentinel && !html.includes(sentinel));
assert("bundle is not marked as a hunt build", !html.includes("SHINY_HUNT_BUNDLED"));
assert("the static page loads nothing under hunt/ (no src or href into it)", !/(src|href)="([^"]*\/)?hunt\//.test(fs.readFileSync(path.join(root, "webapp", "index.html"), "utf8")));

// ---- 2. the pure module in node ---------------------------------------------------------------
globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(root, "core", "gen1tid.js"));
globalThis.ShinyGen1Data = DATA;
globalThis.ShinyGen3SidData = SIDDATA;
globalThis.ShinyMode = require(path.join(root, "webapp", "mode.js"));
const G = globalThis.ShinyGen1Tid;
const U = require(path.join(root, "webapp", "gen1tid-ui.js"));
const RUN = globalThis.ShinyMode.RUN, PRACTICE = globalThis.ShinyMode.PRACTICE;

// data resolution: every supported game on every platform that offers it, like tables.get_platform
for (const game of U.supportedGames(DATA)) {
  for (const p of U.platformsFor(DATA, game)) {
    const plat = U.resolve(DATA, game, p.key, null, null);
    assert(`resolve ${game}/${p.key} names the game`, plat.methodologyId.split("/")[0] === game, plat.methodologyId);
    assert(`resolve ${game}/${p.key} family matches`, DATA.methodologies[plat.methodologyId].console_id === plat.familyKey);
    assert(`resolve ${game}/${p.key} menu anchor`, plat.anchors.indexOf("menu") !== -1);
    assert(`resolve ${game}/${p.key} table rows`, plat.maxOffset === 2399 && G.tableEntries(plat.table).length === 2400);
  }
}
assert("yellow has no route-valid target", G.routeValidTargets(U.resolve(DATA, "yellow", "gse").table, U.resolve(DATA, "yellow", "gse").targetSets).length === 0);
assert("blue dmg route-valid offsets", JSON.stringify(G.routeValidTargets(U.resolve(DATA, "blue", "dmg").table, U.resolve(DATA, "blue", "dmg").targetSets).map((e) => e[0])) === "[994,1513,2105]");
assert("non-red status comes from the methodology", U.resolve(DATA, "blue", "gba-hd").status === "emulator-derived, no hardware sample yet");
assert("psr-64c2 accepts nothing in red gse", G.routeValidTargets(U.resolve(DATA, "red", "gse", null, ["psr-64c2"]).table, U.resolve(DATA, "red", "gse", null, ["psr-64c2"]).targetSets).length === 0);

const plat = U.resolve(DATA, "red", "gse", null, null);
assert("gse anchors", JSON.stringify(plat.anchors) === '["menu","reset"]');
assert("route-valid red gse", JSON.stringify(G.routeValidTargets(plat.table, plat.targetSets).map((e) => e[0])) === "[358,743,1131,1448,1640]");

// the schedule and its text
const sched = U.buildSchedule(plat, "menu", 358, 200, 4, 1.0);
assert("menu schedule A cue", near(sched.tA, G.targetSeconds(358) - 0.2));
assert("menu schedule count-in", sched.countInTimes.length === 4 && near(sched.countInTimes[0], sched.tA - 4));
const proto = U.protocolLines(plat, "menu", 358, sched, 200, 4, 1.0).join("\n");
assert("protocol names the methodology", proto.includes("Methodology: red/gba/hold-start-v1"));
assert("protocol carries the contract sentence", proto.includes(U.METHODOLOGY_SENTENCE));
assert("protocol states the target time", proto.includes("Target: A at 7.333 s (438 frames) after the menu"));
assert("protocol states the hold window", proto.includes("Between 21.77 s and 24.70 s after the boot starts (frames 1300-1475)"));
assert("protocol states the menu frame", proto.includes("opens at 26.00 s (frame 1553)"));
assert("protocol is for the web anchor, not the terminal", !/\bENTER\b/.test(proto) && proto.includes("ANCHOR button"));
const gbpReset = U.resolve(DATA, "red", "gbp", null, null);
const rsched = U.buildSchedule(gbpReset, "reset", 358, 100, 4, 1.0);
assert("reset anchor adds the fade and stall", near(rsched.menu, G.framesToSeconds(1553) + G.resetAnchorExtraSeconds(DATA.reset_models["gbp-fade"])));
const rproto = U.protocolLines(gbpReset, "reset", 358, rsched, 100, 4, 1.0).join("\n");
assert("reset protocol names the GameCube RESET button", rproto.includes("the GameCube RESET button"));
assert("reset protocol carries the GBP note", rproto.includes("NOTE: NOT yet validated on a GameCube"));
const dmg = U.resolve(DATA, "red", "dmg", null, null);
const psched = U.buildSchedule(dmg, "poweron", 517, 100, 4, 1.0);
const pproto = U.protocolLines(dmg, "poweron", 517, psched, 100, 4, 1.0).join("\n");
assert("power-on protocol marks the hold window", pproto.includes("Two low beeps mark the START-hold window (24.28 s and 25.87 s after your anchor)"));
assert("power-on protocol counts the dropped beeps", psched.droppedCountIn === 0 && pproto.includes("Then 4 short beeps"));
const sl = U.scheduleLines(sched, 358, 200, plat).join("\n");
assert("schedule lines", sl.includes("A cue (long beep)   7.133 s"));

// rendering: every tone starts on its exact sample, silence just before it
const r = U.renderCues(sched.cues, 44100);
assert("render onset A", r.onsets.A === Math.round(sched.tA * 44100));
assert("render onset count-4", r.onsets["count-4"] === Math.round((sched.tA - 4) * 44100));
assert("render is silent one sample before the A onset", r.samples[r.onsets.A - 1] === 0);
assert("render sounds at the A onset", r.samples[r.onsets.A] !== 0);
assert("render length covers the last tone plus the tail", r.length === Math.round(sched.tA * 44100) + Math.round(0.150 * 44100) + Math.floor(0.25 * 44100) + 1);
assert("render peak within amplitude", Math.max(...Array.from(r.samples.subarray(r.onsets.A, r.onsets.A + 200))) <= 0.5 + 1e-9);
const m = U.resetPlan(plat, "route", 0, null, null, 15, 2.0);
const rr = U.renderCues(m.schedule.cues, 48000);
assert("metronome onsets are one interval apart", rr.onsets["A-1"] - rr.onsets["RESET-1"] === Math.round((1.0 + m.intervalMs / 1000) * 48000) - Math.round(1.0 * 48000));

// calibration: the outcome flow with the guards, like rngsolution/cli.py report_outcome
const cal = {};
let o = U.recordOutcome(cal, plat, "menu", 358, 200, plat.table[360], { attempt: "a1", when: "2026-09-03 00:00:00", mode: RUN });
assert("outcome inverts to the hit", o.hit === 360 && o.added && near(o.implied, 200 + 2 * G.FRAME_MS));
assert("outcome text", o.lines.join("\n").includes("You hit offset 360, aimed 358: 2 frames late (33.5 ms)."));
assert("correction in force after one sample", near(U.correctionInForce(cal, plat, "menu", RUN), 200 + 2 * G.FRAME_MS));
assert("the stored sample is stamped with the mode", U.allSamples(cal, "gse", "menu")[0].mode === RUN);
o = U.recordOutcome(cal, plat, "menu", 358, 200, plat.table[360], { attempt: "a1", mode: RUN });
assert("duplicate refused", !o.added && o.refused === "duplicate");
o = U.recordOutcome(cal, plat, "menu", 358, 200, plat.table[458], { attempt: "a2", mode: RUN });
assert("outlier refused", !o.added && o.refused === "outlier" && o.lines.join("\n").includes("more than 60 frames"));
o = U.recordOutcome(cal, plat, "menu", 358, 200, plat.table[458], { attempt: "a2", force: true, mode: RUN });
assert("outlier added when forced", o.added);
o = U.recordOutcome(cal, plat, "menu", 358, 233.5, 0xFFFF & (plat.table[358] ^ 0x1234), { attempt: "a3", mode: RUN });
assert("an out-of-table ID teaches nothing", !o.added && o.hit === null && o.lines.join("\n").includes("nothing can be learned from it"));
assert("stored samples carry the methodology", U.allSamples(cal, "gse", "menu").every((s) => s.methodology === "red/gba/hold-start-v1"));
cal["gse/menu"].samples.push({ tid: 1, aimed: 358, hit: 358, correction_used_ms: 200, implied_ms: 200, attempt: "x", note: "", player: "none", methodology: "red/gba/tap-start-v1" });
assert("foreign-methodology samples are ignored", U.samplesFor(cal, "gse", "menu", plat.methodologyId, RUN).length === 2 && U.ignoredSampleLines(cal, plat, "menu", RUN)[0].includes("recorded under red/gba/tap-start-v1"));
// the RUN / PRACTICE-HUNT wall: a practice-made sample in the RUN store is never in force there, and is said so
cal["gse/menu"].samples.push({ tid: 2, aimed: 358, hit: 380, correction_used_ms: 200, implied_ms: 568.3, attempt: "p", note: "", player: "hunt-watch", methodology: plat.methodologyId, mode: PRACTICE });
assert("a practice sample is not in force in RUN", U.samplesFor(cal, "gse", "menu", plat.methodologyId, RUN).length === 2 && near(U.correctionInForce(cal, plat, "menu", RUN), (233.4854 + 200 + 100 * G.FRAME_MS) / 2, 1e-3));
assert("RUN says the practice sample is ignored", U.ignoredSampleLines(cal, plat, "menu", RUN).some((l) => l.includes("recorded in PRACTICE / HUNT mode, not RUN")));
assert("the practice sample is the one in force in PRACTICE", U.samplesFor(cal, "gse", "menu", plat.methodologyId, PRACTICE).length === 1 && near(U.correctionInForce(cal, plat, "menu", PRACTICE), 568.3));
assert("the stores of the two modes are different keys", U.calStoreKey(RUN) !== U.calStoreKey(PRACTICE));
const d = U.dropLastSample(cal, plat, "menu", RUN);
assert("drop last stays inside the methodology and the mode", d && d.hit === 458 && U.allSamples(cal, "gse", "menu").length === 3);
const cl = U.clearSamples(cal, plat, "menu", false, RUN);
assert("clear keeps the other methodology's and the other mode's samples", cl.removed.length === 1 && cl.kept.length === 2 && cl.kept.some((s) => s.methodology === "red/gba/tap-start-v1") && cl.kept.some((s) => s.mode === PRACTICE));

// the runner's timing text (sd 20 ms -> 32 %, RNG Solution control 7)
const three = [180, 200, 220].map((v) => ({ tid: 1, aimed: 358, hit: 358, correction_used_ms: 200, implied_ms: v, methodology: plat.methodologyId, when: "" }));
const hs = U.hitSummary(three, "menu", plat.methodologyId);
assert("P(hit) sd 20 ms is about 32 %", hs.line.includes("P(hit) with your current sd: about 32 % (90 % range 8-49 %, n = 3: rough, aim not yet centred; menu anchor, sd 20.0 ms"), hs.line);
const stats = U.statsLines(three, plat, "menu").join("\n");
assert("stats block", stats.includes("n 3   mean 200.0 ms") && stats.includes("drift:") && stats.includes("recommendation ["));
const shifted = [200, 205, 198, 202, 230, 235, 228].map((v) => ({ tid: 1, aimed: 358, hit: 358, correction_used_ms: 200, implied_ms: v, methodology: plat.methodologyId, when: "" }));
assert("drift flagged on a shifted tail", U.statsLines(shifted, plat, "menu").join("\n").includes("RECALIBRATE / SETUP CHANGED (strong)"));
const stable = [200, 205, 198, 202, 201, 199, 203].map((v) => ({ tid: 1, aimed: 358, hit: 358, correction_used_ms: 200, implied_ms: v, methodology: plat.methodologyId, when: "" }));
assert("no drift on a stable series", !U.statsLines(stable, plat, "menu").join("\n").includes("RECALIBRATE"));

// the reset metronome (docs/FACTS.md: route 199.2 ms on GSE / GBP, 397.9 ms on a DMG)
assert("reset centre gse route", near(m.intervalMs, 199.17, 0.05), m.intervalMs);
assert("reset text", m.lines.join("\n").includes("RESET first, then A 199.2 ms"));
assert("reset centre dmg route", near(U.resetPlan(dmg, "route", 0, null, null, 15, 2.0).intervalMs, 397.9, 0.05));
assert("reset practice-save gse", near(U.resetPlan(plat, "practice-save", 0, null, null, 15, 2.0).intervalMs, 149.6, 0.05));
assert("reset order on a DMG", U.resetPlan(dmg, "route", 0, null, null, 15, 2.0).lines[1].includes("A first, then POWER OFF"));

// verify (RNG Solution control 3: $4003 at 9.0 s is inconsistent; at 7.333 s it is consistent)
const gbp = U.resolve(DATA, "red", "gbp", null, null);
assert("verify wrong timing is INCONSISTENT", !U.verifyLines(gbp, 16387, 9.0, false, 3, null).consistent);
assert("verify right timing is CONSISTENT", U.verifyLines(gbp, 16387, 7.333, false, 3, null).consistent);
assert("verify text names the offset", U.verifyLines(gbp, 16387, 7.333, false, 3, null).lines.join("\n").includes("the table produces it at offset 358"));

// the Secret ID branch (RNG Solution control S1: Emerald TID $B0AF -> SID $7F16 at k = 5478)
const em = U.sidMethodologyFor(SIDDATA, "emerald");
const cue = U.sidCue(em, 7, "fast", 30, 6, 20, null);
assert("sid cue window fast/7", cue.kExpected === 962 && cue.kMin === 956 && cue.kMax === 982 && cue.schedule.cues.length === 9);
assert("sid cue last press is the A tone", cue.schedule.cues[8].kind === "A" && cue.schedule.cues[7].kind === "count");
assert("sid cue protocol", U.sidCueProtocolLines(em, "Pokemon Emerald", 7, "fast", 30, cue).join("\n").includes("k in 956-982 (expected 962)"));
const list = U.sidListing(em, "Pokemon Emerald", 45231, 1, "mid", null, 5470, 5490, [], [], [], null, null);
assert("sid listing has 21 candidates", list.kept.length === 21);
assert("sid listing has the worked example", list.kept.some((c) => c.k === 5478 && c.sid === 0x7F16));
const shinyPid = (((0xB0AF ^ 0x7F16) << 16) | 0) >>> 0;
const pins = {};
U.addPin(pins, em.id, 45231, shinyPid, true, "control");
const pinned = U.sidListing(em, "Pokemon Emerald", 45231, 1, "mid", null, 5470, 5490, U.pinsFor(pins, em.id, 45231), [], [], null, null);
assert("a shiny pin keeps the true k", pinned.kept.length === 1 && pinned.single && pinned.single.k === 5478);
const contra = U.sidListing(em, "Pokemon Emerald", 45231, 1, "mid", null, 5470, 5490, [{ pid: shinyPid, shiny: false }], [], [], null, null);
assert("a contradicting pin drops the true k", !contra.kept.some((c) => c.k === 5478));
let threw = false;
try { U.addPin(pins, em.id, 45231, shinyPid, false, ""); } catch (e) { threw = true; }
assert("a pin cannot be flipped", threw);
assert("emerald default k range", JSON.stringify(U.sidDefaultKRange(U.sidModelFor(em, "mid", null), 1, "mid")) === "[1645,2845]");
const fr = U.sidMethodologyFor(SIDDATA, "firered");
assert("firered preset path", G.kFixed(U.sidModelFor(fr, "mid", "rival-preset"), 1, "mid") === 1781 && G.kFixed(U.sidModelFor(fr, "mid", "rival-newname"), 1, "mid") === 1868);
threw = false;
try { U.sidModelFor(em, "turbo", null); } catch (e) { threw = true; }
assert("an unmeasured text speed is refused", threw);

if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`webapp smoke: ${checks} checks, ${failures} failure${failures === 1 ? "" : "s"}`);
process.exit(failures ? 1 : 0);
