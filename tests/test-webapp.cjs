// Webapp smoke test for the Gen 1 and Gen 2 Trainer ID tabs: (1) the mobile bundle (build-mobile-bundle.mjs)
// carries the tabs, the engines, the tab modules and the embedded data; (2) the tabs' pure modules
// (webapp/gen1tid-ui.js, webapp/gen2tid-ui.js) loaded in node agree with the engines, with RNG
// Solution's numbers and with the Gen 2 derivation's (docs/FACTS.md).
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
assert("bundle embeds timers.js", html.includes("root.ShinyTimers = factory(root.ShinyCore, root.ShinyGen4)"));
assert("bundle embeds gen5.js", html.includes("root.ShinyGen5 = factory(root.ShinyGen4)"));
assert("bundle embeds seedtime4.js", html.includes("root.ShinySeedTime4 = factory(root.ShinyCore, root.ShinyGen4)"));
assert("bundle embeds generators.js", html.includes("root.ShinyGenerators = factory(root.ShinyCore, root.ShinyGen4, root.ShinySeedTime4)"));
assert("bundle embeds gen2tid.js", html.includes("root.ShinyGen2Tid = factory(root.ShinyGen1Tid)"));
assert("bundle embeds the tab module", html.includes("root.ShinyGen1TidUi = api"));
assert("bundle embeds the Gen 1 data as a global", html.includes("window.ShinyGen1Data = {"));
assert("bundle embeds the Gen 3 SID data as a global", html.includes("window.ShinyGen3SidData = {"));
assert("bundle embeds the Gen 2 TID data as a global", html.includes("window.ShinyGen2TidData = {"));
const GEN2DATA = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen2-tid.json"), "utf8"));
for (const id of Object.keys(GEN2DATA.methodologies)) assert("bundle embeds Gen 2 methodology " + id, html.includes('"' + id + '"'));
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
U.addPin(pins, em.id, 45231, shinyPid, true, "control", RUN);
const pinned = U.sidListing(em, "Pokemon Emerald", 45231, 1, "mid", null, 5470, 5490, U.pinsFor(pins, em.id, 45231, RUN), [], [], null, null);
assert("a shiny pin keeps the true k", pinned.kept.length === 1 && pinned.single && pinned.single.k === 5478);
const contra = U.sidListing(em, "Pokemon Emerald", 45231, 1, "mid", null, 5470, 5490, [{ pid: shinyPid, shiny: false }], [], [], null, null);
assert("a contradicting pin drops the true k", !contra.kept.some((c) => c.k === 5478));
let threw = false;
try { U.addPin(pins, em.id, 45231, shinyPid, false, "", RUN); } catch (e) { threw = true; }
assert("a pin cannot be flipped", threw);
assert("emerald default k range", JSON.stringify(U.sidDefaultKRange(U.sidModelFor(em, "mid", null), 1, "mid")) === "[1645,2845]");
const fr = U.sidMethodologyFor(SIDDATA, "firered");
assert("firered preset path", G.kFixed(U.sidModelFor(fr, "mid", "rival-preset"), 1, "mid") === 1781 && G.kFixed(U.sidModelFor(fr, "mid", "rival-newname"), 1, "mid") === 1868);
threw = false;
try { U.sidModelFor(em, "turbo", null); } catch (e) { threw = true; }
assert("an unmeasured text speed is refused", threw);

// ---- 3. the Gen 2 Trainer ID / Lucky ID tab (webapp/gen2tid-ui.js over core/gen2tid.js) -------------
assert("bundle has the Gen 2 TID tab button", html.includes('data-tab="g2tid"'));
assert("bundle has the Gen 2 tab section", html.includes('id="tab-g2tid"'));
assert("bundle embeds the Gen 2 tab module", html.includes("root.ShinyGen2TidUi = api"));
assert("the Gen 2 tab module comes after the engine, mode.js and the Gen 1 tab module",
  html.indexOf("root.ShinyGen2Tid = factory(root.ShinyGen1Tid)") < html.indexOf("root.ShinyGen2TidUi = api") &&
  html.indexOf("root.ShinyMode = api") < html.indexOf("root.ShinyGen2TidUi = api") && html.indexOf("root.ShinyGen1TidUi = api") < html.indexOf("root.ShinyGen2TidUi = api"));
assert("the Gen 1 tab module exposes its cue player to the Gen 2 tab", html.includes("api.cuePlayer = { prepare: prepare, play: play, stop: stop, warmAudio: warmAudio"));
assert("the Gen 2 tab states that no hardware sample exists", html.includes("No hardware sample exists for any Gen 2 configuration"));
assert("the Gen 2 self-test keeps storage in memory", html.includes('root.location.search.indexOf("g2selftest") !== -1') && html.includes("if (MEMORY_ONLY) return;"));
assert("mode.js keeps the mode in memory under both self-tests", html.includes('root.location.search.indexOf("g2selftest") !== -1));') && html.includes('root.location.search.indexOf("g1selftest") !== -1 ||'));
assert("bundle embeds the Gen 2 Gold GBP table verbatim", html.includes(GEN2DATA.methodologies["gold/gbp/hold-start-v1"].table_data.tids_hex));
globalThis.ShinyGen2Tid = require(path.join(root, "core", "gen2tid.js"));
globalThis.ShinyGen2TidData = GEN2DATA;
const G2 = globalThis.ShinyGen2Tid;
const U2 = require(path.join(root, "webapp", "gen2tid-ui.js"));
const FPS2 = G2.FPS, LAG = G2.VISIBLE_MENU_LAG_FRAMES;
assert("the Gen 2 tab exports its no-hardware statement", U2.NO_HARDWARE_LINE.startsWith("No hardware sample exists for any Gen 2 configuration"));
assert("the Gen 2 store is its own key", U2.STORE_KEY_CAL === "shinySolution.gen2tid.calibration" && U2.calStoreKey(RUN) === U2.STORE_KEY_CAL && U2.calStoreKey(PRACTICE) === U2.STORE_KEY_CAL + ".practice");
// data resolution: every supported game on every console that offers it, in every RTC state
for (const game of U2.supportedGames(GEN2DATA)) {
  const states = U2.stateOptions(GEN2DATA, game);
  assert(`${game} state count`, states.length === (GEN2DATA.games[game].rtc_dependent ? 20 : 1), states.length);
  for (const p of U2.platformsFor(GEN2DATA, game)) {
    for (const mid of p.ids) {
      for (const so of states) {
        const plat = U2.resolve(GEN2DATA, game, p.key, mid, so.value, null, DATA);
        assert(`resolve ${game}/${p.key}/${mid}/${so.value} names the game`, plat.methodologyId.split("/")[0] === game && plat.methodologyId === mid);
        assert(`resolve ${game}/${p.key}/${mid} family matches`, GEN2DATA.methodologies[mid].console_id === plat.familyKey && plat.platformKey === GEN2DATA.methodologies[mid].platform_key);
        assert(`resolve ${game}/${p.key}/${mid} menu anchor`, plat.anchors.indexOf("menu") !== -1 && plat.anchors.every((a) => GEN2DATA.methodologies[mid].anchors.includes(a) && GEN2DATA.platforms[p.key].anchors.includes(a)));
        assert(`resolve ${game}/${p.key}/${mid}/${so.value} table`, plat.table.table.tids.length === G2.BIN_COUNT && plat.state === so.value);
        assert(`resolve ${game}/${p.key}/${mid}/${so.value} reachability`, plat.reachable === so.reachable && plat.reachable === G2.reachable(GEN2DATA, game, so.value));
        assert(`resolve ${game}/${p.key}/${mid} ids`, plat.hasLid === true && plat.hasSid === (game === "crystal"));
        const ml = U2.methodologyLines(plat, true).join("\n");
        assert(`methodology lines for ${mid} carry every validity condition verbatim`, GEN2DATA.methodologies[mid].validity.every((c) => ml.includes("- " + c)) && ml.includes("Methodology: " + mid) && ml.includes(U2.METHODOLOGY_SENTENCE));
        const db = U2.describeBin(plat, 300);
        assert(`describeBin ${game}/${mid}/${so.value} names the methodology and the first-boot flag`, db.includes("methodology " + mid) && db.includes("[RTC state " + so.value + ": first boot only]") === !so.reachable);
      }
    }
  }
  const all = U2.allMethodologyLines(GEN2DATA, game).join("\n");
  for (const id of GEN2DATA.games[game].methodologies) {
    const m = GEN2DATA.methodologies[id];
    assert(`every methodology of ${game} is listed with its protocol and validity verbatim: ${id}`, all.includes("Methodology: " + id) && all.includes("Protocol: " + m.protocol) && m.validity.every((c) => all.includes("- " + c)));
  }
}
assert("a DMG offers hold-start and late-start for Gold and Silver, nothing for Crystal",
  JSON.stringify(U2.platformMethodologies(GEN2DATA, "dmg", "gold").ids) === '["gold/dmg/hold-start-v1","gold/dmg/late-start-v1"]' &&
  JSON.stringify(U2.platformMethodologies(GEN2DATA, "dmg", "silver").ids) === '["silver/dmg/hold-start-v1","silver/dmg/late-start-v1"]' && U2.platformMethodologies(GEN2DATA, "dmg", "crystal").ids.length === 0);
assert("the anchors a console offers", JSON.stringify(U2.resolve(GEN2DATA, "gold", "gse").anchors) === '["menu","reset"]' && JSON.stringify(U2.resolve(GEN2DATA, "gold", "gbp").anchors) === '["menu"]' &&
  JSON.stringify(U2.resolve(GEN2DATA, "gold", "gba").anchors) === '["menu","poweron"]' && JSON.stringify(U2.resolve(GEN2DATA, "crystal", "gbc").anchors) === '["menu","poweron"]');
assert("the reachability rule names the two recurring states", U2.reachabilityLines(GEN2DATA, "gold").join("\n").includes("Only days0 and days512 recur boot after boot") && U2.reachabilityLines(GEN2DATA, "crystal").join("\n").includes("immune"));
assert("the scripts line names the published IDs as community scripts", U2.scriptsLine(GEN2DATA, "gold").includes("need their community multi-step scripts") && U2.scriptsLine(GEN2DATA, "gold").includes("$25E9") && U2.scriptsLine(GEN2DATA, "crystal").includes("$26FB"));

// the schedule and its text (USAGE's worked example: Gold on GSE, bin 300, A at 19.933 s after the visible menu)
const g2plat = U2.resolve(GEN2DATA, "gold", "gse", null, null, null, DATA);
const g2info = U2.binInfo(g2plat, 300);
assert("bin 300 of gold/gbp/days0", g2info.tid === 0x4F62 && g2info.lid === 0xEE7C && JSON.stringify(g2info.visible) === "[1201,1204]" && g2info.aimV === 1202.5);
const g2sched = U2.buildSchedule(g2plat, "menu", 300, 200, 4, 1.0);
assert("Gen 2 menu schedule A cue", near(g2sched.tA, 1202.5 / FPS2 - 0.2) && near(g2sched.tA, 19.933, 5e-4));
assert("Gen 2 menu schedule count-in", g2sched.countInTimes.length === 4 && near(g2sched.countInTimes[0], g2sched.tA - 4));
const g2proto = U2.protocolLines(g2plat, "menu", 300, g2sched, 200, 4, 1.0).join("\n");
assert("Gen 2 protocol names the methodology and the contract", g2proto.includes("Methodology: gold/gbp/hold-start-v1") && g2proto.includes(U2.METHODOLOGY_SENTENCE));
assert("Gen 2 protocol states the hardware status", g2proto.includes("NOTE: No hardware sample exists for any Gen 2 configuration"));
assert("Gen 2 protocol states the target bin as a window after the visible menu", g2proto.includes("Target: bin 300 = A down 1201..1204 frames after the visible menu box (aim 1202.5 = 20.133 s (1202.5 frames))"));
assert("Gen 2 protocol states the tap rule", g2proto.includes("tap A ONCE for 4-8 frames (67-134 ms), then press NOTHING for 0.35 s"));
assert("Gen 2 protocol states the hold window and the visible menu frame", g2proto.includes("frames 0-355") && g2proto.includes("visible on frame 450, 7.53 s after the boot starts"));
assert("Gen 2 protocol names the RTC state", g2proto.includes("RTC state: days0 (0-139 days, no carry; recurs boot after boot)"));
assert("Gen 2 protocol is for the web anchor", !/\bENTER\b/.test(g2proto) && g2proto.includes("ANCHOR button"));
const g2reset = U2.buildSchedule(g2plat, "reset", 300, 100, 4, 1.0);
const g2extra = G.resetAnchorExtraSeconds(DATA.reset_models["gbp-fade"]);
assert("Gen 2 reset anchor adds GSE's fade and stall", near(g2reset.holdLo, g2extra) && near(g2reset.menu, 450 / FPS2 + g2extra) && near(g2reset.tA, g2reset.menu + 1202.5 / FPS2 - 0.1));
assert("Gen 2 reset protocol names Ctrl+R", U2.protocolLines(g2plat, "reset", 300, g2reset, 100, 4, 1.0).join("\n").includes("Ctrl+R (hard reset)"));
const g2gbc = U2.resolve(GEN2DATA, "silver", "gbc", null, null, null, DATA);
const g2pow = U2.buildSchedule(g2gbc, "poweron", 300, 100, 4, 1.0);
assert("Gen 2 power-on protocol marks the hold window and the menu", U2.protocolLines(g2gbc, "poweron", 300, g2pow, 100, 4, 1.0).join("\n").includes("Two low beeps mark the START-hold window (0.00 s and 2.97 s after your anchor)") && near(g2pow.menu, 452 / FPS2));
const g2late = U2.resolve(GEN2DATA, "gold", "dmg", "gold/dmg/late-start-v1", null, null, DATA);
assert("Gen 2 late-start hold window", U2.protocolLines(g2late, "menu", 300, U2.buildSchedule(g2late, "menu", 300, 200, 4, 1.0), 200, 4, 1.0).join("\n").includes("Hold window: START down between 5.83 s and 9.12 s after the boot starts (frames 348-545)"));
assert("Gen 2 schedule lines", U2.scheduleLines(g2sched, 300, 200, g2plat).join("\n").includes("A cue (long beep)   19.933 s"));
const g2r = U.renderCues(g2sched.cues, 44100);
assert("Gen 2 cues render on exact samples through the shared renderer", g2r.onsets.A === Math.round(g2sched.tA * 44100) && g2r.samples[g2r.onsets.A - 1] === 0 && g2r.samples[g2r.onsets.A] !== 0);
const crystal = U2.resolve(GEN2DATA, "crystal", "gse", null, null, null, DATA);
assert("Crystal bin 300 carries the Secret ID and one state", U2.binInfo(crystal, 300).sid === 0xE0CB && U2.describeBin(crystal, 300).includes("Secret ID") && crystal.states.length === 1 && crystal.reachable);

// targets: the bins that give a member of a set in force, in the chosen state and in the platform's other states
const g2rows = U2.targetRows(g2plat);
assert("no single-tap route target in gold/gbp/days0; the LID 01001 hit is a halted-clock first boot", g2rows.inState.length === 0 && g2rows.otherStates.length === 1 && g2rows.otherStates[0].state === "halt-days200" && g2rows.otherStates[0].bin === 392 && !g2rows.otherStates[0].reachableAfterFirstBoot);
const silverHalt = U2.resolve(GEN2DATA, "silver", "gse", null, "halt-days260", null, DATA);
const shRows = U2.targetRows(silverHalt);
assert("silver/gbp/halt-days260 gives 55785 at bin 457, first boot only", shRows.inState.length === 1 && shRows.inState[0].bin === 457 && shRows.inState[0].tid === 0xD9E9 && !shRows.inState[0].reachableAfterFirstBoot && !silverHalt.reachable);
assert("the first-boot-only state is named in the protocol", U2.protocolLines(silverHalt, "menu", 457, U2.buildSchedule(silverHalt, "menu", 457, 200, 4, 1.0), 200, 4, 1.0).join("\n").includes("This is a FIRST-BOOT-ONLY state"));
assert("target set lines name the single-press hits and the community scripts", U2.targetSetLines(g2plat).join("\n").includes("silver/gbp/halt-days260 bin 457 (TID $D9E9, LID $7805, first boot only)") && U2.targetSetLines(g2plat).join("\n").includes("protocol: community-script"));

// calibration: the outcome flow with the bin guards (the engine's isOutlierBins plus gen1tid's isDuplicate over the Gen 2 store)
const tidAt = (b) => G2.lookup(GEN2DATA, "gold", "gbp", "days0", b).tid;
const g2cal = {};
let o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, tidAt(302), null, { attempt: "a1", when: "2026-09-03 00:00:00", mode: RUN });
assert("Gen 2 outcome inverts to the hit bin", o2.hitBin === 302 && o2.added && near(o2.implied, 200 + 8 * G.FRAME_MS));
assert("Gen 2 outcome text", o2.lines.join("\n").includes("You hit bin 302 (A down 1209..1212 frames after the visible menu), aimed 300: 8.0 frames late (133.9 ms; state days0)."));
assert("Gen 2 correction in force after one sample", near(U2.correctionInForce(g2cal, g2plat, "menu", RUN), 200 + 8 * G.FRAME_MS));
const g2s0 = U2.allSamples(g2cal, "gse", "menu")[0];
assert("the stored Gen 2 sample carries the mode, the methodology, the state and the bins", g2s0.mode === RUN && g2s0.methodology === "gold/gbp/hold-start-v1" && g2s0.state === "days0" && g2s0.aimed_bin === 300 && g2s0.hit_bin === 302 && g2s0.aimed === 1206.5 && g2s0.hit === 1214.5);
let g2threw = null;
try { G.addSample([], g2s0, false); } catch (e) { g2threw = e.name; }
assert("gen1tid's addSample refuses bin-centre offsets (so it is not the Gen 2 guard)", g2threw === "ValueError");
o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, tidAt(302), null, { attempt: "a1", mode: RUN });
assert("Gen 2 duplicate refused", !o2.added && o2.refused === "duplicate");
o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, tidAt(316), null, { attempt: "a2", mode: RUN });
assert("Gen 2 outlier refused at 16 bins (64 frames)", !o2.added && o2.refused === "outlier" && o2.lines.join("\n").includes("more than 60 frames (15 bins"));
o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, tidAt(315), null, { attempt: "a3", mode: RUN });
assert("Gen 2 sample at 15 bins (60 frames) accepted", o2.added && o2.hitBin === 315);
o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, tidAt(316), null, { attempt: "a2", force: true, mode: RUN });
assert("Gen 2 outlier added when forced", o2.added);
o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, 0x6F53, 0x03E9, { attempt: "a4", mode: RUN });
assert("IDs of another RTC state teach nothing and are located", !o2.added && o2.hitBin === null && o2.elsewhere.length === 1 && o2.elsewhere[0].table === "gold/gbp/halt-days200" && o2.elsewhere[0].bin === 392 && o2.lines.join("\n").includes("another RTC state: gold/gbp/halt-days200 bin 392 (first boot only)"));
o2 = U2.recordOutcome(g2cal, g2plat, "menu", 300, 200, 1, null, { attempt: "a5", mode: RUN });
assert("an ID absent from every table teaches nothing", !o2.added && o2.elsewhere.length === 0 && o2.lines.join("\n").includes("Correction unchanged"));
assert("stored Gen 2 samples carry the methodology", U2.allSamples(g2cal, "gse", "menu").every((s) => s.methodology === "gold/gbp/hold-start-v1") && U2.allSamples(g2cal, "gse", "menu").length === 3);
g2cal["gse/menu"].samples.push({ tid: 1, aimed_bin: 300, hit_bin: 300, aimed: 1206.5, hit: 1206.5, correction_used_ms: 200, implied_ms: 200, attempt: "x", methodology: "gold/dmg/late-start-v1", mode: RUN });
assert("foreign-methodology Gen 2 samples are ignored", U2.samplesFor(g2cal, "gse", "menu", g2plat.methodologyId, RUN).length === 3 && U2.ignoredSampleLines(g2cal, g2plat, "menu", RUN)[0].includes("recorded under gold/dmg/late-start-v1"));
g2cal["gse/menu"].samples.push({ tid: 2, aimed_bin: 300, hit_bin: 304, aimed: 1206.5, hit: 1222.5, correction_used_ms: 200, implied_ms: 467.9, attempt: "p", methodology: g2plat.methodologyId, mode: PRACTICE });
assert("a practice Gen 2 sample is not in force in RUN", U2.samplesFor(g2cal, "gse", "menu", g2plat.methodologyId, RUN).length === 3 && U2.ignoredSampleLines(g2cal, g2plat, "menu", RUN).some((l) => l.includes("recorded in PRACTICE / HUNT mode, not RUN")));
assert("the practice Gen 2 sample is in force in PRACTICE", U2.samplesFor(g2cal, "gse", "menu", g2plat.methodologyId, PRACTICE).length === 1 && near(U2.correctionInForce(g2cal, g2plat, "menu", PRACTICE), 467.9));
const d2 = U2.dropLastSample(g2cal, g2plat, "menu", RUN);
assert("Gen 2 drop last stays inside the methodology and the mode", d2 && d2.hit_bin === 316 && U2.allSamples(g2cal, "gse", "menu").length === 4);
const cl2 = U2.clearSamples(g2cal, g2plat, "menu", false, RUN);
assert("Gen 2 clear keeps the other methodology's and the other mode's samples", cl2.removed.length === 2 && cl2.kept.length === 2);
const three2 = [180, 200, 220].map((v) => ({ tid: 1, aimed_bin: 300, hit_bin: 300, aimed: 1206.5, hit: 1206.5, correction_used_ms: 200, implied_ms: v, methodology: g2plat.methodologyId, when: "", state: "days0" }));
assert("Gen 2 P(hit) text through the shared summary", U2.hitSummary(three2, "menu", g2plat.methodologyId).line.includes("P(hit) with your current sd: about 32 %"));
const stats2 = U2.statsLines(three2, g2plat, "menu", RUN).join("\n");
assert("Gen 2 stats block", stats2.includes("n 3   mean 200.0 ms") && stats2.includes("aimed bin 300  hit bin 300") && stats2.includes("recommendation ["));

// the invert panel with the ambiguity statistics (docs/FACTS.md Inversion: 14 Gold / 12 Silver ambiguous under the prior; 769 / 817 over all 18 GBP states)
const inv2 = U2.invertLines(g2plat, 0x6F53, 0x03E9, { family: "all" });
assert("invert finds the LID 01001 single-press neighbour, first boot only", inv2.inversion.candidates.length === 1 && inv2.inversion.candidates[0].table === "gold/gbp/halt-days200" && inv2.inversion.candidates[0].bin === 392 && inv2.lines.join("\n").includes("[first boot only]"));
assert("invert ambiguity over all 18 GBP states (Gold)", inv2.ambiguity.tables === 18 && inv2.ambiguity.ambiguousTids === 769 && inv2.ambiguity.maxCandidates === 5 && inv2.ambiguity.pairCollisions === 2);
const invPrior = U2.invertLines(g2plat, tidAt(300), null, { family: "prior" });
assert("invert under the two-state prior (Gold)", invPrior.inversion.candidates.length === 1 && invPrior.inversion.candidates[0].bin === 300 && invPrior.ambiguity.tables === 2 && invPrior.ambiguity.ambiguousTids === 14 && invPrior.ambiguity.pairCollisions === 0);
const silverPlat = U2.resolve(GEN2DATA, "silver", "gse", null, null, null, DATA);
assert("invert ambiguity (Silver)", U2.invertLines(silverPlat, 1, null, { family: "prior" }).ambiguity.ambiguousTids === 12 && U2.invertLines(silverPlat, 1, null, { family: "all" }).ambiguity.ambiguousTids === 817 && U2.invertLines(silverPlat, 1, null, { family: "all" }).ambiguity.maxCandidates === 4);
assert("invert with no candidate says so", U2.invertLines(g2plat, 1, null, { family: "all" }).lines.join("\n").includes("no candidate"));
assert("invert lines name the methodology", inv2.lines.join("\n").includes("Methodology: gold/gbp/hold-start-v1"));
assert("Crystal invert scope is one table", U2.invertLines(crystal, 1, null, { family: "all" }).ambiguity.tables === 1);

// verify (the visible menu box to the press): bin 300's TID at its own time is consistent, 2 s later it is not
assert("Gen 2 verify right timing is CONSISTENT", U2.verifyLines(g2plat, tidAt(300), null, 20.13).consistent);
assert("Gen 2 verify wrong timing is INCONSISTENT", !U2.verifyLines(g2plat, tidAt(300), null, 22.13).consistent);
const v2 = U2.verifyLines(g2plat, tidAt(300), null, 20.13).lines.join("\n");
assert("Gen 2 verify text names the bin, the methodology and the missing lag", v2.includes("the tables produce them at bin 300") && v2.includes("Methodology: gold/gbp/hold-start-v1") && v2.includes("no press-to-visible lag is known for Gen 2"));

if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`webapp smoke: ${checks} checks, ${failures} failure${failures === 1 ? "" : "s"}`);
process.exit(failures ? 1 : 0);
