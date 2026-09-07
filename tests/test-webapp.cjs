// Webapp smoke test for the Gen 1 and Gen 2 Trainer ID tabs and the wizard tab: (1) the mobile bundle
// (build-mobile-bundle.mjs) carries the tabs, the engines, the tab modules and the embedded data (and states
// that the wizard's tables are not in it); (2) the tabs' pure modules (webapp/gen1tid-ui.js, webapp/gen2tid-ui.js,
// webapp/wizard-ui.js) loaded in node agree with the engines, with RNG Solution's numbers, with the Gen 2
// derivation's (docs/FACTS.md) and with the generator and seed-to-time vectors.
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
// the offline copy: the static page registers sw.js over http/https only, the bundle never (the element is stripped and
// the status line told), the manifest and icon links are gone from the bundle, and both carry the error hook's element
{
  const page = fs.readFileSync(path.join(root, "webapp", "index.html"), "utf8");
  assert("the static page links the manifest and sets the theme colour", page.includes('<link rel="manifest" href="manifest.webmanifest">') && page.includes('<meta name="theme-color" content="#101418">'));
  assert("the static page registers sw.js only over http or https", page.includes('if (!/^https?:$/.test(location.protocol)) return say(') && page.indexOf('/^https?:$/.test(location.protocol)') < page.indexOf('navigator.serviceWorker.register("sw.js")'));
  assert("the static page and sw.js carry the same build stamp", (page.match(/window\.SHINY_BUILD = "([0-9a-f]{12})"/) || [])[1] === (fs.readFileSync(path.join(root, "webapp", "sw.js"), "utf8").match(/^const BUILD = "([0-9a-f]{12})";/m) || [])[1]);
  assert("bundle registers no service worker", !/serviceWorker\.register\(/.test(html) && !html.includes('id="sw-register"'));
  assert("bundle says why the offline copy is not registered", html.includes('window.SHINY_NO_SERVICE_WORKER = "the mobile bundle is one HTML string'));
  assert("bundle writes that reason into the status line (the page's own writer left with the stripped element)", html.includes('el.textContent = "offline copy: not registered: " + window.SHINY_NO_SERVICE_WORKER + " (build " + window.SHINY_BUILD + ")"') && html.indexOf('id="sw-status"') < html.indexOf('el.textContent = "offline copy: not registered: "'));
  assert("bundle links no manifest or icon", !/<link rel="(manifest|icon|apple-touch-icon)"/.test(html));
  assert("bundle keeps the status line and the error hook's element", html.includes('id="sw-status"') && html.includes('id="page-errors"') && html.includes('window.addEventListener("error", function (e)'));
}

// ---- 2. the pure module in node ---------------------------------------------------------------
globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(root, "core", "gen1tid.js"));
globalThis.ShinyGen1Data = DATA;
globalThis.ShinyGen3SidData = SIDDATA;
globalThis.ShinyMode = require(path.join(root, "webapp", "mode.js"));
globalThis.ShinyCitations = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "citations.json"), "utf8"));
const FN = require(path.join(root, "webapp", "footnotes.js"));
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
assert("blue dmg route-valid offsets", JSON.stringify(G.routeValidTargets(U.resolve(DATA, "blue", "dmg").table, U.resolve(DATA, "blue", "dmg").targetSets).map((e) => e[0])) === "[658,994,1003,1028,1513,1810,2105,2248,2304]");
assert("non-red status comes from the methodology", U.resolve(DATA, "blue", "gba-hd").status === "emulator-derived, no hardware sample yet");
assert("psr-64c2 accepts nothing in red gse", G.routeValidTargets(U.resolve(DATA, "red", "gse", null, ["psr-64c2"]).table, U.resolve(DATA, "red", "gse", null, ["psr-64c2"]).targetSets).length === 0);

const plat = U.resolve(DATA, "red", "gse", null, null);
assert("gse anchors", JSON.stringify(plat.anchors) === '["menu","reset"]');
assert("route-valid red gse", JSON.stringify(G.routeValidTargets(plat.table, plat.targetSets).map((e) => e[0])) === "[358,743,1131,1448,1640,1647,1785]");

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
assert("reset protocol carries the GBP note (the platform's validation text from gen1-tid.json)", rproto.includes("NOTE: " + gbpReset.validation) && gbpReset.validation.includes("3 of 3"));
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

// the footnotes (webapp/footnotes.js over core/data/citations.json): the protocol lists its sources after the steps, the pokered
// title-loop line under its FACTS.md section and the table under the console's status word (the same lines app/Tests/Gen1TidChecks.cs
// pins on the panel); the target line, the schedule and verify carry the block's numbers; the GBA HD and the DMG print
// HARDWARE-VALIDATED n, Yellow its pokeyellow lines and EMPIRICAL; the registry without the hold-START line (the negative
// control) is reported as NOT IN THE REGISTRY and, restored, is clean
const protoLines = U.protocolLines(plat, "menu", 358, sched, 200, 4, 1.0);
assert("Gen 1 protocol lists five footnotes after the steps under the header with the status note", protoLines.filter((l) => /^  \[\^\d+\] /.test(l)).length === 5 && protoLines.indexOf(FN.HEADER + FN.STATUS_NOTE) > protoLines.findIndex((l) => l.startsWith(" 6. ")));
assert("Gen 1 hold-START footnote is the pokered title-loop line under its FACTS.md section", protoLines.includes("  [^1] pokered/engine/movie/title.asm:227-239,266 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): the title screen waits on CheckForUserInterruption (one JoypadLowSensitivity poll per frame; START or A ends it), then the cry and the fade play before MainMenu, so START held anywhere in the window is read on the first poll and the NEW GAME menu opens on one fixed frame"));
assert("Gen 1 table footnote under EMULATOR-EXACT on GSE", protoLines.includes("  [^2] EMULATOR-EXACT (no decomp line; the table's derivation on pokemon-speedrunning/gambatte-core with START held inside the window, docs/FACTS.md Gen 1 Trainer ID (hold-START methodologies, RNG Solution)): hold START on any frame 1300-1475 and the NEW GAME menu opens on frame 1553; the A press frame is the menu frame + 80 + the offset (the table's definition), one Trainer ID per offset under red/gba/hold-start-v1; GSE or gambatte-speedrun in GBP mode with the GBC BIOS: emulator-exact"));
assert("Gen 1 menu, roll and stir footnotes are registry lines", protoLines.some((l) => l.startsWith("  [^3] pokered/engine/menus/main_menu.asm:64-68,85-86 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): the NEW GAME menu waits in HandleMenuInput")) && protoLines.some((l) => l.startsWith("  [^4] pokered/engine/movie/oak_speech/init_player_data.asm:1-10 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): InitPlayerData2")) && protoLines.some((l) => l.startsWith("  [^5] pokered/engine/math/random.asm:1-13 (docs/FACTS.md: Gen 1/2 (Game Boy) / The RNG): Random_ is the only RNG")));
assert("Gen 1 roll footnote names the Trainer ID section (the registry files the pokered line first under the DV roll), and a section the registry does not file the line under is NOT IN THE REGISTRY", FN.footnoteText(4, { cite: "pokered/engine/movie/oak_speech/init_player_data.asm:1-10", claim: "x" }).endsWith(" (docs/FACTS.md: Gen 1/2 (Game Boy) / Where DVs are rolled): x") && U.procedureProblems(["  " + FN.footnoteText(4, { cite: "pokered/engine/movie/oak_speech/init_player_data.asm:1-10", section: "Gen 1/2 (Game Boy) / The RNG", claim: "x" })]).length === 1);
assert("Gen 1 steps marked", protoLines.some((l) => l.startsWith(" 3. ") && l.endsWith(" [^1] [^2]")) && protoLines.some((l) => l.startsWith(" 4. ") && l.endsWith(" [^2] [^3]")) && protoLines.includes("    Press A ON the long high beep. That is the only frame-exact action. [^4] [^5] [^2]") && protoLines.includes("    Each answer sharpens the correction. [^2]"));
assert("Gen 1 no footnote outside the registry", U.procedureProblems(protoLines).length === 0);
assert("Gen 1 power-on protocol marks its steps too", pproto.includes(" [^1] [^2]\n") && /Press A ON the long high beep\. \[\^4\] \[\^5\] \[\^2\]\n/.test(pproto) && pproto.includes("\n  [^2] HARDWARE-VALIDATED 5 of 6 (no decomp line; ") && pproto.includes("hold START on any frame 1450-1640 and the NEW GAME menu opens on frame 1701"));
// The derivation tag is a claim about evidence: Red's three cold boots are part of the original tidderive sweep, whose logs
// are in neither repository, so Red's verified targets carry the qualified tag and Blue's, whose three boots ship as
// tests/fixtures/blue-*-triple.csv in RNG Solution, carry the flat one. Not a blanket downgrade.
assert("Gen 1 target line marked", U.describeTarget(plat, 358).endsWith(" [3x cold-boot verified off-repository: no derivation fixture here] [^2] [^4]"));
{
  const blueGse = U.resolve(DATA, "blue", "gse", null, null), blueDmg = U.resolve(DATA, "blue", "dmg", null, null);
  assert("Gen 1 Red's verified targets carry the off-repository qualifier on both families, never the flat tag",
    [358, 743, 1131].every((o) => U.derivationTag(plat, o) === U.VERIFIED_OFF_REPO_TAG) &&
    [517, 878].every((o) => U.derivationTag(dmg, o) === U.VERIFIED_OFF_REPO_TAG) &&
    !U.verifiedEvidenceInRepo(plat) && !U.verifiedEvidenceInRepo(dmg));
  assert("Gen 1 Blue's verified targets keep the flat tag (its three boots are a fixture in RNG Solution)",
    U.derivationTag(blueGse, 675) === U.VERIFIED_TAG && U.derivationTag(blueDmg, 658) === U.VERIFIED_TAG &&
    U.verifiedEvidenceInRepo(blueGse) && U.verifiedEvidenceInRepo(blueDmg));
  assert("Gen 1 a route-valid offset outside the verified list is still one derivation, and a non-route-valid offset is untagged",
    U.derivationTag(plat, 1448) === U.ONE_DERIVATION_TAG && U.derivationTag(dmg, 2359) === U.ONE_DERIVATION_TAG && U.derivationTag(plat, 359) === "");
  assert("Gen 1 the methodology panel says where the three derivations are",
    U.methodologyLines(plat, true, "").includes("Verification: offsets 358, 743, 1131 [3x cold-boot verified off-repository: no derivation fixture here]") &&
    U.methodologyLines(plat, true, "").some((l) => l.startsWith("  Evidence (RNG Solution): the three cold boots are part of the original tidderive extended sweep, whose logs are not in this repository")) &&
    U.methodologyLines(blueDmg, true, "").includes("Verification: offsets 658, 994, 1003, 1028, 1513, 1810, 2105, 2248, 2304 [3x cold-boot verified]"));
}
assert("Gen 1 schedule A cue marked", sl.endsWith(" [^2]"));
const vl = U.verifyLines(gbp, 16387, 7.333, false, 3, null).lines;
assert("Gen 1 verify carries the table and roll footnotes and lists those two", vl.includes("  the table produces it at offset 358 [^2] [^4]") && vl.some((l) => l.startsWith("  [^2] " + U.statusWord(gbp) + " (no decomp line; ") && l.endsWith("GameCube Game Boy Player: " + gbp.status)) && vl.some((l) => l.startsWith("  [^4] pokered/engine/movie/oak_speech/init_player_data.asm:1-10 (docs/FACTS.md: ")) && vl.filter((l) => /^  \[\^/.test(l)).length === 2);
assert("Gen 1 status words: GSE exact, GBA HD 5 of 5, DMG 5 of 6, Game Boy Player 3 of 3, Yellow EMPIRICAL", U.statusWord(plat) === "EMULATOR-EXACT" && U.statusWord(U.resolve(DATA, "red", "gba-hd")) === "HARDWARE-VALIDATED 5 of 5" && U.statusWord(dmg) === "HARDWARE-VALIDATED 5 of 6" && U.statusWord(gbp) === "HARDWARE-VALIDATED 3 of 3" && U.statusWord(U.resolve(DATA, "yellow", "gba-hd")) === "EMPIRICAL" && U.statusWord(U.resolve(DATA, "blue", "gse")) === "EMPIRICAL");
{
  const yellow = U.resolve(DATA, "yellow", "gba-hd");
  const yProto = U.protocolLines(yellow, "menu", 358, U.buildSchedule(yellow, "menu", 358, 200, 4, 1.0), 200, 4, 1.0);
  assert("Yellow cites pokeyellow and prints EMPIRICAL", yProto.some((l) => l.startsWith("  [^1] pokeyellow/engine/movie/title.asm:166-175 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from): Yellow's title loop")) && yProto.some((l) => l.startsWith("  [^2] EMPIRICAL (no decomp line; ")) && yProto.some((l) => l.startsWith("  [^3] pokeyellow/engine/menus/main_menu.asm:63-66,84 (docs/FACTS.md: ")) && yProto.some((l) => l.startsWith("  [^4] pokeyellow/engine/movie/oak_speech/init_player_data.asm:1-10 (docs/FACTS.md: ")) && yProto.some((l) => l.startsWith("  [^5] pokeyellow/engine/math/random.asm:1-13 (docs/FACTS.md: ")) && U.procedureProblems(yProto).length === 0);
  const full = globalThis.ShinyCitations;
  FN.setCitations({ entries: full.entries.filter((e) => e.cite !== "pokered/engine/movie/title.asm:227-239,266") });
  const problems = U.procedureProblems(U.protocolLines(plat, "menu", 358, sched, 200, 4, 1.0));
  assert("negative control: the registry without the Gen 1 hold-START line is reported (one problem naming the line)", problems.length === 1 && problems[0].startsWith("  [^1] pokered/engine/movie/title.asm:227-239,266 NOT IN THE REGISTRY (core/data/citations.json carries no such line of docs/FACTS.md): "), problems);
  FN.setCitations(full);
  assert("the registry restored: no Gen 1 problem", U.procedureProblems(U.protocolLines(plat, "menu", 358, sched, 200, 4, 1.0)).length === 0);
}

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
assert("mode.js keeps the mode in memory under all three self-tests", html.includes('root.location.search.indexOf("wizselftest") !== -1));') && html.includes('root.location.search.indexOf("g1selftest") !== -1 ||') && html.includes('root.location.search.indexOf("g2selftest") !== -1 ||'));
// the wizard tab (webapp/wizard-ui.js) in the bundle: the tab, the module, the page's shared countdown, and the stated
// absence of its tables (the bundle inlines no species, encounter or static JSON: docs/DATA.md)
assert("bundle has the wizard tab button", html.includes('data-tab="wizard"'));
assert("bundle has the wizard section", html.includes('id="tab-wizard"'));
assert("bundle embeds the wizard module", html.includes("root.ShinyWizardUi = api"));
assert("app.js shares its countdown with the wizard", html.includes("window.ShinyCountdown = Countdown;"));
assert("the bundle tells the wizard it carries no tables", html.includes('window.SHINY_WIZARD_NO_DATA = "the mobile bundle inlines no species, encounter or static tables"') && html.indexOf("SHINY_WIZARD_NO_DATA = ") < html.indexOf("root.ShinyWizardUi = api"));
assert("the bundle inlines no wizard tables", !html.includes("window.ShinyWizardData3") && !html.includes("window.ShinyWizardData4") && !html.includes('"species_count": 386'));
assert("the wizard self-test keeps storage in memory", html.includes('root.location.search.indexOf("wizselftest") !== -1);') && html.includes("if (MEMORY_ONLY) return;\n    try { if (root.localStorage) root.localStorage.setItem(key, value); }"));
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
// the footnotes: Gold on GSE lists ten sources after the steps (the pokegold 4-frame poll and title lines, the roll under
// EMULATOR-EXACT, the wPlayerID roll, the VBlank stir, the held-input rule, StartClock, FixDays, StartRTC, the Lucky ID roll);
// every protocol the panel vectors pin carries its block with the console's status word and no problem; Crystal cites
// pokecrystal's title, immunity and Secret ID lines; the registry without the poll line is reported and restored is clean
{
  const g2plat = U2.resolve(GEN2DATA, "gold", "gse", null, "days0", null, DATA);
  const g2sched = U2.buildSchedule(g2plat, "menu", 300, 200, 4, 1.0);
  const g2proto = U2.protocolLines(g2plat, "menu", 300, g2sched, 200, 4, 1.0);
  assert("Gen 2 protocol lists ten footnotes after the steps under the header with the status note", g2proto.filter((l) => /^  \[\^\d+\] /.test(l)).length === 10 && g2proto.indexOf(FN.HEADER + FN.STATUS_NOTE) > g2proto.findIndex((l) => l.startsWith(" 6. ")));
  assert("Gen 2 poll footnote is the pokegold main-menu line under its FACTS.md section", g2proto.includes("  [^2] pokegold/engine/menus/main_menu.asm:142-152 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 2 Trainer ID / Lucky ID / The boot path with START held, and the 4-frame poll): MainMenuJoypadLoop goes through SetUpMenu, which disables the joypad filter, so _ScrollingMenuJoypad returns after one poll and the loop comes back through WaitBGMap: the menu reads the pad once every 4 frames, and the target is the 4-frame bin the A tap lands in, not a frame"));
  assert("Gen 2 roll footnote under EMULATOR-EXACT on GSE with the 13-frame roll", g2proto.includes("  [^3] EMULATOR-EXACT (no decomp line; the tables' derivation on pokemon-speedrunning/gambatte-core, docs/FACTS.md Gen 2 Trainer ID / Lucky ID (hold-START single-tap methodologies)): hold START on any frame 0-355 and the menu box is visible on frame 450; the roll is 13 frames after the accepting poll (Crystal 14, Gold and Silver 13) and constant inside a bin, 599 bins of 4 frames per table under gold/gbp/hold-start-v1; GSE or gambatte-speedrun in GBP mode with the GBC BIOS: emulator-exact"));
  assert("Gen 2 ID roll, stir, RTC and Lucky ID footnotes are registry lines", g2proto.some((l) => l.startsWith("  [^4] pokegold/engine/menus/intro_menu.asm:1-7,28-49 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 2 Trainer ID / Lucky ID / Where the IDs come from): NewGame -> _ResetWRAM writes wPlayerID right after the WRAM clear: hRandomSub on one frame is the high byte")) && g2proto.some((l) => l.startsWith("  [^5] pokegold/home/vblank.asm:68-79 (docs/FACTS.md: ")) && g2proto.some((l) => l.startsWith("  [^7] pokegold/engine/rtc/rtc.asm:91-101,103-115 (docs/FACTS.md: Gen 1/2 (Game Boy) / Gen 2 Trainer ID / Lucky ID / RTC dependence of Gold/Silver): StartClock runs before the LCD is switched on")) && g2proto.some((l) => l.startsWith("  [^8] pokegold/home/time.asm:61-120,205-250 (docs/FACTS.md: ")) && g2proto.some((l) => l.startsWith("  [^9] pokegold/engine/rtc/rtc.asm:13-22 (docs/FACTS.md: ") && l.includes("StartRTC, run at the end of StartClock on every boot, clears the RTC halt bit")) && g2proto.some((l) => l.startsWith("  [^10] pokegold/engine/menus/intro_menu.asm:225-248 (docs/FACTS.md: ") && l.includes("LoadOrRegenerateLuckyIDNumber")));
  assert("Gen 2 steps marked", g2proto.some((l) => l.startsWith("    RTC state: ") && l.endsWith(" [^7] [^8] [^9]")) && g2proto.includes("    only to the FIRST New Game after the clear. [^10]") && g2proto.some((l) => l.startsWith("    Hold window: ") && l.endsWith(" [^1] [^3]")) && g2proto.some((l) => l.startsWith(" 3. Keep START held") && l.endsWith(" [^3]")) && g2proto.some((l) => l.startsWith("    On the long high beep tap A ONCE") && l.endsWith(" [^2] [^6]")) && g2proto.some((l) => l.startsWith("    Target: bin 300 ") && l.endsWith(" [^2] [^4] [^5]")) && g2proto.some((l) => l.startsWith("    Each answer sharpens") && l.endsWith(" [^4] [^10]")));
  assert("Gen 2 no footnote outside the registry", U2.procedureProblems(g2proto).length === 0);
  assert("Gen 2 target line, schedule and verify carry the block's numbers", U2.describeBin(g2plat, 300).endsWith("methodology gold/gbp/hold-start-v1 [^2] [^4]") && U2.scheduleLines(g2sched, 300, 200, g2plat).slice(-2).join("\n") === "  A window (bin 300) 20.108 - 20.175 s   (A down inside it, before the correction) [^2] [^3]\n  tap 67-134 ms, then nothing for 0.35 s [^6]" && (() => { const v = U2.verifyLines(g2plat, G2.lookup(GEN2DATA, "gold", "gbp", "days0", 300).tid, null, 20.13).lines; return v.some((l) => l.startsWith("  the tables produce them at bin 300 [^2] [^4]")) && v.some((l) => l.includes("-> bin 300; scope") && l.endsWith(" [^2] [^3]")) && v.filter((l) => /^  \[\^/.test(l)).length === 3; })());
  assert("Gen 2 invert lines carry the poll, ID roll and halt footnotes on a first-boot-only candidate", (() => { const v = U2.invertLines(g2plat, 0x6F53, 0x03E9, { family: "all" }).lines; return v.some((l) => l.includes("halt-days200 bin 392:") && l.endsWith("[first boot only] [^2] [^4] [^9]")) && v.filter((l) => /^  \[\^/.test(l)).length === 3; })());
  const crystal = U2.resolve(GEN2DATA, "crystal", "gbc", null, "days0", null, DATA);
  const cProto = U2.protocolLines(crystal, "poweron", 300, U2.buildSchedule(crystal, "poweron", 300, 100, 4, 1.0), 100, 4, 1.0);
  assert("Crystal cites pokecrystal's title, poll, immunity and Secret ID lines and prints EMPIRICAL with the 14-frame roll", cProto.some((l) => l.startsWith("  [^1] pokecrystal/engine/menus/intro_menu.asm:1138-1200 (docs/FACTS.md: ")) && cProto.some((l) => l.startsWith("  [^2] pokecrystal/engine/menus/main_menu.asm:240-252 (docs/FACTS.md: ")) && cProto.some((l) => l.startsWith("  [^3] EMPIRICAL (no decomp line; ") && l.includes("hold START on any frame 0-407 and the menu box is visible on frame 526; the roll is 14 frames after the accepting poll") && l.endsWith("Game Boy Color: no hardware sample")) && cProto.some((l) => l.startsWith("  [^7] pokecrystal/home/init.asm:131,143,155-159 (docs/FACTS.md: ") && l.includes("Crystal switches the LCD on before StartClock")) && cProto.some((l) => l.startsWith("  [^9] pokecrystal/engine/menus/intro_menu.asm:130-134 (docs/FACTS.md: ") && l.includes("wSecretID")) && cProto.some((l) => l.startsWith("    RTC state: ") && l.endsWith(" [^7]")) && cProto.some((l) => l.startsWith("    Target: bin 300 ") && l.endsWith(" [^2] [^4] [^9] [^5]")) && U2.procedureProblems(cProto).length === 0 && U2.statusWord(crystal) === "EMPIRICAL");
  assert("Crystal's target line carries the Secret ID footnote", U2.describeBin(crystal, 300).endsWith("methodology crystal/gbc/hold-start-v1 [^2] [^4] [^9]"));
  const g2vectors = JSON.parse(fs.readFileSync(path.join(root, "tests", "gen2tid-panel-vectors.json"), "utf8"));
  const g2cases = g2vectors.cases.filter((c) => Array.isArray(c.protocolLines));
  assert("every Gen 2 protocol the panel vectors pin lists at least eight footnotes under the header with its console's status word", g2cases.length >= 18 && g2cases.every((c) => c.protocolLines.includes(FN.HEADER + FN.STATUS_NOTE) && c.protocolLines.filter((l) => /^  \[\^\d+\] /.test(l)).length >= 8 && c.protocolLines.some((l) => l.startsWith("  [^3] " + (c.input.platform === "gse" ? "EMULATOR-EXACT" : "EMPIRICAL") + " (no decomp line; the tables' derivation"))));
  assert("no pinned Gen 2 protocol has a footnote outside the registry", g2cases.every((c) => U2.procedureProblems(c.protocolLines).length === 0));
  assert("every pinned Gen 2 target line carries the poll and ID-roll footnotes", g2cases.every((c) => / \[\^2\] \[\^4\]( \[\^9\])?$/.test(c.describeBin)));
  const full2 = globalThis.ShinyCitations;
  FN.setCitations({ entries: full2.entries.filter((e) => e.cite !== "pokegold/engine/menus/main_menu.asm:142-152") });
  const problems2 = U2.procedureProblems(U2.protocolLines(g2plat, "menu", 300, g2sched, 200, 4, 1.0));
  assert("negative control: the registry without the Gen 2 poll line is reported (one problem naming the line)", problems2.length === 1 && problems2[0].startsWith("  [^2] pokegold/engine/menus/main_menu.asm:142-152 NOT IN THE REGISTRY (core/data/citations.json carries no such line of docs/FACTS.md): "), problems2);
  FN.setCitations(full2);
  assert("the registry restored: no Gen 2 problem", U2.procedureProblems(U2.protocolLines(g2plat, "menu", 300, g2sched, 200, 4, 1.0)).length === 0);
}
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

// ---- 4. the wizard's pure module in node (webapp/wizard-ui.js over core/data/*.json) ----------------------
// Three end-to-end scenarios with known answers from tests/generators-vectors.json and tests/seedtime4-vectors.json,
// plus the honest limits, the procedures, the typed-outcome calibration and the mode wall.
globalThis.ShinyGen4 = require(path.join(root, "core", "gen4.js"));
globalThis.ShinySeedTime4 = require(path.join(root, "core", "seedtime4.js"));
globalThis.ShinyGenerators = require(path.join(root, "core", "generators.js"));
globalThis.ShinyTimers = require(path.join(root, "core", "timers.js"));
const W = require(path.join(root, "webapp", "wizard-ui.js"));
const GV = JSON.parse(fs.readFileSync(path.join(root, "tests", "generators-vectors.json"), "utf8"));
const SV = JSON.parse(fs.readFileSync(path.join(root, "tests", "seedtime4-vectors.json"), "utf8"));
const loadGen = (g) => ({ species: JSON.parse(fs.readFileSync(path.join(root, "core", "data", "species-gen" + g + ".json"), "utf8")), encounters: JSON.parse(fs.readFileSync(path.join(root, "core", "data", "encounters-gen" + g + ".json"), "utf8")), statics: JSON.parse(fs.readFileSync(path.join(root, "core", "data", "statics-gen" + g + ".json"), "utf8")) });
let wthrew = null;
try { W.staticEntries("emerald"); } catch (e) { wthrew = e.message; }
assert("the wizard refuses to resolve before its tables are loaded", /not loaded/.test(wthrew || ""));
W.setData(3, loadGen(3)); W.setData(4, loadGen(4));
// the decomp citation registry (core/data/citations.json, tools/gen-citations.py from docs/FACTS.md): every decomp
// source the procedures cite is an entry, every entry names a pret line the generator read, and the same file rides
// in the bundle as window.ShinyCitations
const registry = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "citations.json"), "utf8"));
W.setCitations(registry);
{
  const byCite = {};
  registry.entries.forEach((e) => { byCite[e.cite] = e; });
  assert("the registry is generated from docs/FACTS.md by tools/gen-citations.py", registry.source === "docs/FACTS.md" && registry.generator === "tools/gen-citations.py" && registry.entries.length > 100);
  assert("every registry entry names its repository, path, lines, FACTS.md section and line, and the pret line's text", registry.entries.every((e) => e.cite === e.repo + "/" + e.path + ":" + e.lines && /^(pokeruby|pokeemerald|pokefirered|pokediamond|pokeplatinum|pokeheartgold|pokered|pokeyellow|pokecrystal|pokegold)$/.test(e.repo) && typeof e.section === "string" && e.section.length > 0 && Number.isInteger(e.facts_line) && typeof e.first_line === "string"));
  assert("every registry entry lists the FACTS.md sections that cite it, the first being its section, and none starts on a blank line or a brace", registry.entries.every((e) => Array.isArray(e.sections) && e.sections.length >= 1 && e.sections[0] === e.section && !["", "{", "}", "};"].includes(e.first_line)));
  assert("the registry entries are sorted by citation and unique", registry.entries.every((e, i) => i === 0 || registry.entries[i - 1].cite < e.cite));
  for (const key of Object.keys(W.SOURCES)) {
    const src = W.SOURCES[key];
    if (src.synth) assert("source " + key + " is SYNTHESISED with the model or convention it rests on", /docs\/FACTS\.md/.test(src.synth) && src.claim.length > 10);
    else assert("source " + key + " cites a registry entry: " + src.cite, !!byCite[src.cite]);
  }
  assert("the bundle carries the registry as window.ShinyCitations", html.includes("window.ShinyCitations = {") && html.includes(JSON.stringify(registry.entries[0].cite)));
  assert("the static page's gen1-data.js carries the registry", fs.existsSync(path.join(root, "webapp", "gen1-data.js")) ? fs.readFileSync(path.join(root, "webapp", "gen1-data.js"), "utf8").includes("window.ShinyCitations = {") : true);
}
assert("ten games in the design's order", W.GAME_ORDER.join(",") === "ruby,sapphire,emerald,firered,leafgreen,diamond,pearl,platinum,heartgold,soulsilver");
for (const g of W.GAME_ORDER) {
  const model = W.modelOf(g);
  assert(`${g} names a seed model with a validation status that says no hardware session`, /EMPIRICAL \/ model output: no (hardware|DS) session/.test(model.status));
  assert(`${g} lists static entries and wild tables`, W.staticEntries(g).length > 0 && W.wildTables(g).length > 0);
  assert(`${g} offers consoles of its generation`, W.consolesFor(g).every((c) => c.gen === W.GAMES[g].gen) && W.consolesFor(g).length === 2);
}
assert("the fixed seeds: RS 0x5A0, Emerald 0, FRLG typed", W.modelOf("ruby").seed === 0x5a0 && W.modelOf("emerald").seed === 0 && W.modelOf("firered").kind === "typed" && W.modelOf("firered").seed === null);
assert("frames to time at the console rate", near(W.frameToMs(215019, "GBA"), 215019 * 1000 / (16777216 / 280896)) && near(W.fpsOf("NDS_SLOT1"), 59.8261) && near(W.fpsOf("NDS_SLOT2"), 59.6555));
const ivObj = (a) => ({ hp: a[0], atk: a[1], def: a[2], spa: a[3], spd: a[4], spe: a[5] });
// A: static3[0] "Ruby Groudon Method 4" (seed 0 typed, since the dead-battery model is 0x5A0): advance 3 -> its PID and IVs
const groudonVec = GV.static3.find((c) => c.name === "Ruby Groudon Method 4");
const groudon = W.staticEntries("ruby").find((e) => e.id === "ruby/legend/groudon");
assert("Groudon resolves as a Ruby static at L45", !!groudon && groudon.level === 45 && groudon.species.dex === 383 && !groudon.refused);
const cfgA = { game: "ruby", console: "GBA", seed: groudonVec.seed, kind: "static", method: "M4", species: groudon.species, level: groudon.level, wanted: { ivMin: ivObj(groudonVec.results[3].ivs), ivMax: ivObj(groudonVec.results[3].ivs), tid: GV.meta.tid, sid: GV.meta.sid }, maxFrame: 215019, limit: 20 };
const rA = W.searchGen3(cfgA);
assert("A: the Groudon vector's frame 3 is the one hit in an hour", rA.hits.length === 1 && rA.hits[0].frame === 3 && rA.hits[0].pid === groudonVec.results[3].pid && JSON.stringify(rA.hits[0].ivArray) === JSON.stringify(groudonVec.results[3].ivs) && JSON.stringify(rA.hits[0].stats) === JSON.stringify(groudonVec.results[3].stats));
assert("A: the exact-cycle first frame agrees", rA.exactFirst && rA.exactFirst.first.frame === 3 && rA.exactFirst.first.pid === groudonVec.results[3].pid);
assert("A: the search lines name the seed model and its status", W.gen3SearchLines(rA, cfgA).join("\n").includes("Seed model: rs/gba/boot-seed-v0 (defined and emulator-verified") && W.gen3SearchLines(rA, cfgA).join("\n").includes("no hardware session"));
const cardA = W.cardLines(rA.hits[0], { gen: 3, species: groudon.species, hasIds: true, tid: GV.meta.tid, sid: GV.meta.sid, seed: 0, model: W.modelOf("ruby"), timeText: "" }).join("\n");
assert("A: the result card", cardA.includes("Groudon L45  PID 8E4231B0  nature Bashful  gender none  ability DROUGHT (slot 1)") && cardA.includes("IVs 12/22/24/30/25/27") && cardA.includes("stats at L45 150/149/141/108/97/98") && cardA.includes("shiny: no for TID 12345 / SID 54321") && cardA.includes("seed model rs/gba/boot-seed-v0"));
const procA = W.gen3Procedure(Object.assign({ staticLabel: groudon.label }, cfgA), rA.hits[0], { mode: "STANDARD", preTimer: 5000, targetFrame: 3, calibration: 0 }).join("\n");
assert("A: the procedure is numbered under the seed model and says no hardware session", /^1\. /m.test(procA) && /^6\. /m.test(procA) && procA.startsWith("Procedure (rs/gba/boot-seed-v0; EMPIRICAL / model output: no hardware session"));
// the footnotes: steps 1-5 marked in order, the sources block after the steps, the Ruby seed line with its FACTS.md
// section and the pret line it names, the timer model SYNTHESISED, no problem
assert("A: steps 1-5 carry footnote markers before the seed model label, step 6 none", [1, 2, 3, 4, 5].every((n) => new RegExp("^" + n + "\\. .* \\[\\^" + n + "\\] \\[rs/gba/boot-seed-v0\\]$", "m").test(procA)) && /^6\. [^\[]*\[rs\/gba\/boot-seed-v0\]$/m.test(procA));
assert("A: the sources block follows the steps", /\n6\. .*\nSources: decomp lines from docs\/FACTS\.md through the registry core\/data\/citations\.json; SYNTHESISED marks a source with no decomp line\.\n  \[\^1\] /.test(procA));
assert("A: the seed footnote is the registry's Ruby RTC line under its FACTS.md section", procA.includes("\n  [^2] pokeruby/src/rtc.c:13,134-140 (docs/FACTS.md: Gen 3 (Game Boy Advance) / When each game seeds): with a dead battery the RTC reports its power-failure flag"));
assert("A: the idle advance footnote is pokeruby's VBlank Random()", procA.includes("\n  [^3] pokeruby/src/main.c:328 (docs/FACTS.md: Gen 3 (Game Boy Advance) / The idle advance): Random() runs once in every VBlank"));
assert("A: the timer and calibration footnotes are SYNTHESISED, naming EonTimer", procA.includes("\n  [^4] SYNTHESISED (no decomp line; EonTimer's frame model, docs/FACTS.md Timer models): ") && procA.includes("\n  [^5] SYNTHESISED (no decomp line; EonTimer's frame calibration, docs/FACTS.md Timer models): "));
assert("A: no footnote is outside the registry", W.procedureProblems(procA).length === 0);
// the negative control, in memory: the registry without the Ruby RTC line makes that footnote NOT IN THE REGISTRY and
// procedureProblems names it; with no registry at all every decomp footnote says so; the registry restored, none
{
  W.setCitations({ entries: registry.entries.filter((e) => e.cite !== "pokeruby/src/rtc.c:13,134-140") });
  const cut = W.gen3Procedure(Object.assign({ staticLabel: groudon.label }, cfgA), rA.hits[0], { mode: "STANDARD", preTimer: 5000, targetFrame: 3, calibration: 0 });
  const problems = W.procedureProblems(cut);
  assert("negative control: a registry without the Ruby RTC line is reported (one problem naming the line)", problems.length === 1 && problems[0].startsWith("  [^2] pokeruby/src/rtc.c:13,134-140 NOT IN THE REGISTRY (core/data/citations.json carries no such line of docs/FACTS.md): "), problems);
  assert("negative control: the other footnotes still resolve", cut.some((l) => l.startsWith("  [^3] pokeruby/src/main.c:328 (docs/FACTS.md: ")));
  W.setCitations(null);
  const none = W.gen3Procedure(Object.assign({ staticLabel: groudon.label }, cfgA), rA.hits[0], { mode: "STANDARD", preTimer: 5000, targetFrame: 3, calibration: 0 });
  assert("negative control: with no registry loaded every decomp footnote says so and the SYNTHESISED ones stand", W.procedureProblems(none).length === 3 && none.every((l) => !/^  \[\^\d+\] pokeruby/.test(l) || l.includes(" NOT IN THE REGISTRY (no citation registry is loaded): ")) && none.filter((l) => l.startsWith("  [^") && l.includes("SYNTHESISED")).length === 2);
  W.setCitations(registry);
  assert("the registry restored, the procedure has no problem again", W.procedureProblems(W.gen3Procedure(Object.assign({ staticLabel: groudon.label }, cfgA), rA.hits[0], { mode: "STANDARD", preTimer: 5000, targetFrame: 3, calibration: 0 })).length === 0);
}
const idA = W.gen3IdentifyHit(cfgA, 3, { nature: 18, ivs: ivObj(groudonVec.results[3].ivs) }, 3000);
assert("A: the typed outcome inverts to frame 3", idA.hit && idA.hit.frame === 3 && idA.candidates === 1);
assert("A: the typed stats invert to frame 3 too", W.gen3IdentifyHit(cfgA, 3, { nature: 18, stats: ivObj(groudonVec.results[3].stats) }, 3000).hit.frame === 3);
// B: wild3[0] "Emerald Route 111 Grass" (seed 1C71C71C typed): advance 7's species, nature and IVs -> frame 7, its PID and slot
const wildVec = GV.wild3.find((c) => c.name === "Emerald Route 111 Grass");
const slB = W.slotsFor("emerald", wildVec.location, "grass", {});
assert("B: the Route 111 table resolves to the vector's slots", slB.rate === wildVec.rate && slB.slots.length === 12 && slB.slots.every((s, i) => s.species.dex === wildVec.slots[i].species.dex && s.minLevel === wildVec.slots[i].minLevel && s.maxLevel === wildVec.slots[i].maxLevel));
const vB = wildVec.results[7];
const cfgB = { game: "emerald", console: "GBA", seed: wildVec.seed, kind: "wild", method: "M1", slots: slB.slots, rate: slB.rate, encounter: "grass", lead: null, options: {}, wanted: { ivMin: ivObj(vB.ivs), ivMax: ivObj(vB.ivs), nature: vB.nature, species: vB.specie, tid: GV.meta.tid, sid: GV.meta.sid }, maxFrame: 215019, limit: 20 };
const rB = W.searchGen3(cfgB);
assert("B: the wild vector's frame 7 is the one hit", rB.hits.length === 1 && rB.hits[0].frame === 7 && rB.hits[0].pid === vB.pid && rB.hits[0].encounterSlot === vB.encounterSlot && rB.hits[0].level === vB.level);
assert("B: the feasibility names the slot share", W.gen3SearchLines(rB, cfgB).join("\n").includes("slot share 35.0 %") && near(W.speciesShare("emerald", "grass", slB.slots, 328), 0.35));
// the honest limit: a flawless Treecko from Emerald's seed 0 has no frame in an hour; the first is 176,562,488 (34.2 days, design 5.3)
const treecko = W.staticEntries("emerald").find((e) => e.id === "rse/starter/treecko");
const cfgF = { game: "emerald", console: "GBA", seed: 0, kind: "static", method: "M1", species: treecko.species, level: 5, wanted: { ivMin: ivObj([31, 31, 31, 31, 31, 31]), ivMax: ivObj([31, 31, 31, 31, 31, 31]) }, maxFrame: 215019, limit: 20 };
const rF = W.searchGen3(cfgF);
const linesF = W.gen3SearchLines(rF, cfgF).join("\n");
assert("flawless Emerald: no hit in an hour, the limit stated", rF.hits.length === 0 && linesF.includes("No matching frame within the first 215019 frames (60:00.000): the honest limit of this seed model is stated, not promised away."));
assert("flawless Emerald: 6 states, first frame 176562488 = 34.2 days", rF.exactFirst.states === SV.collisions[0].count && rF.exactFirst.first.frame === 176562488 && linesF.includes("frame 176562488 from this seed = 34.2 days"));
assert("flawless Emerald: the feasibility is the exact count", rF.feasibility.ivExact && near(rF.feasibility.ivPer100k, 6 / 4294967296 * 100000));
// refusals: a shiny target without IDs, an IV range out of order, FRLG without a seed
let msg = "";
try { W.buildFilter({ ivMin: {}, ivMax: {}, shiny: true }); } catch (e) { msg = e.message; }
assert("a shiny target needs the IDs typed", /Trainer ID and Secret ID typed/.test(msg));
try { W.buildFilter({ ivMin: { hp: 5 }, ivMax: { hp: 4 } }); } catch (e) { msg = e.message; }
assert("an IV range out of order is refused", /HP IV range/.test(msg));
try { W.searchGen3({ game: "firered", console: "GBA", seed: null, kind: "static", species: treecko.species, level: 5, wanted: { ivMin: {}, ivMax: {} }, maxFrame: 10 }); } catch (e) { msg = e.message; }
assert("FRLG without a typed seed is stated unavailable", /no seed: FireRed \/ LeafGreen seed the RNG from a Timer1 count/.test(msg));
assert("eggs and the fixed-PID Pichu are listed as refused with the reason", W.staticEntries("emerald").some((e) => e.id === "rse/egg/wynaut" && /an egg/.test(e.refused)) && W.staticEntries("heartgold").some((e) => e.id === "hgss/gift/pichu-spiky-eared" && /not RNG-manipulable/.test(e.refused)));
// the gift eggs the catalogue files under their event are eggs all the same: refused by their id / creation chain, not offered as Method 1 statics
assert("the Surfing Pichu egg (Emerald) and the Manaphy egg (every Gen 4 game) are refused as eggs", /an egg/.test(W.staticEntries("emerald").find((e) => e.id === "e/event/pichu-egg").refused || "") && ["diamond", "pearl", "platinum", "heartgold", "soulsilver"].every((g) => /an egg/.test(W.staticEntries(g).find((e) => e.id === "gen4/event/manaphy-egg").refused || "")));
assert("no offered static names an egg in its id or its creation chain", W.GAME_ORDER.every((g) => W.staticEntries(g).every((e) => e.refused || !(/egg/i.test(e.id) || /\begg\b/i.test(e.entry.creation || "")))));
assert("the Gen 4 egg refusal states the Gen 4 creation, the Gen 3 one the split PID", /one MT output at the trigger/.test(W.staticEntries("platinum").find((e) => e.id === "pt/egg/togepi").refused) && /split between the trigger and the pickup/.test(W.staticEntries("firered").find((e) => e.id === "frlg/egg/togepi").refused));
assert("Gen 4 statics resolve their method from the creation chain", W.staticEntries("platinum").find((e) => e.id === "dppt/legend/uxie").method === "J" && W.staticEntries("heartgold").find((e) => e.id === "hg/legend/lugia").method === "K" && W.staticEntries("heartgold").find((e) => e.id === "hg/legend/lugia").level === 70 && W.staticEntries("diamond").find((e) => e.id === "dp/starter/turtwig").method === "M1" && W.staticEntries("diamond").find((e) => e.id === "d/legend/dialga").method === "J" && W.staticEntries("heartgold").find((e) => e.id === "hgss/static/gyarados").shinyMode === "always");
assert("RS / FRLG roamers carry the IV bug, Emerald's do not", W.staticEntries("ruby").find((e) => e.category === "roamer").buggedRoamer === true && W.staticEntries("emerald").find((e) => e.category === "roamer").buggedRoamer === false);
// C: the design's gate seed (seedtime4-vectors gate[0]): flawless Method 1 -> 7B0448D1 at frame 0, hour 4, delay 18641 in 2000
const gate = SV.gate[0];
const turtwig = W.staticEntries("platinum").find((e) => e.id === "pt/starter/turtwig");
const cfgC = { game: "platinum", console: "NDS_SLOT1", kind: "static", staticMethod: "M1", species: turtwig.species, level: 5, shinyMode: "random", wanted: { ivMin: gate.ivs, ivMax: gate.ivs }, maxFrame: 100, yearMin: 2000, yearMax: 2000, delayMin: 0, delayMax: 65535, targetDelay: gate.delayIn2000, limit: 30 };
const rC = W.searchGen4(cfgC);
const gateRow = rC.rows.find((r) => r.seed === gate.seed && r.frame === gate.frame);
assert("C: the gate seed is found at frame 0 with hour 4 and delay 18641", !!gateRow && gateRow.hour === gate.hour && gateRow.delay === gate.delayIn2000 && gateRow.year === 2000 && gateRow.month === 1 && gateRow.day === 5 && gateRow.minute === 59 && gateRow.second === 59);
assert("C: the gate row is the nearest to the target delay", rC.rows[0].seed === gate.seed && rC.rows[0].frame === 0 && rC.rows[0].delayDistance === 0);
assert("C: the gate mon is the flawless Modest Turtwig 685011A9 (USAGE's seed-to-time example)", gateRow.mon.pid === 0x685011a9 && gateRow.mon.natureName === "Modest" && gateRow.mon.ivArray.join("/") === "31/31/31/31/31/31" && gateRow.mon.level === 5);
assert("C: origins match the flawless state count and every candidate is verified", rC.origins === SV.collisions[0].count && rC.verified === rC.candidates && rC.candidates === 68);
assert("C: the search lines name the seed model and the DS gate", W.gen4SearchLines(rC, cfgC).join("\n").includes("Seed model: dppt/nds/seed-to-time-v0") && W.gen4SearchLines(rC, cfgC).join("\n").includes("no DS session has landed a seed chosen by this tool"));
const tmC = { targetDelay: gateRow.delay, targetSecond: gateRow.second, calibratedDelay: 500, calibratedSecond: 14 };
const planC = Object.assign(globalThis.ShinySeedTime4.planAdvances(10, 137, { partyCount: 3, tools: ["walk128", "journal", "chatot"] }), { current: 10, partyCount: 3 });
const procC = W.gen4Procedure(Object.assign({ staticLabel: turtwig.label }, cfgC), gateRow, tmC, planC).join("\n");
assert("C: the Gen 4 procedure sets the clock, the timer phases, the coin flips and the advance plan", procC.includes("2. DS clock: set 2000-01-05 04:59 and confirm it 5 minutes before the target minute") && procC.includes("target second 59, target delay 18641 -> seed 7B0448D1 (dppt/nds/seed-to-time-v0)") && procC.includes("open the Poketch coin toss") && procC.includes("42 x walk128 (+3 each, STRUCTURAL), 1 x chatot (+1 each, STRUCTURAL) from frame 10"));
assert("C: the Gen 4 footnotes cite Platinum's seed formula, Method 1, the coin toss, the 128-step cycle and Chatot, with the timer and calibration SYNTHESISED", procC.includes("\n  [^1] pokeplatinum/src/pokemon.c:412,452-470 (docs/FACTS.md: ") && procC.includes("\n  [^2] pokeplatinum/src/main.c:306-315 (docs/FACTS.md: Gen 4 (Nintendo DS) / The seed): seed = ((month*day + minute + second) << 24)") && procC.includes("\n  [^3] SYNTHESISED (no decomp line; EonTimer's delay model, ") && procC.includes("\n  [^4] pokeplatinum/src/applications/poketch/coin_toss/main.c:158 (docs/FACTS.md: Gen 4 (Nintendo DS) / Seed verification): ") && procC.includes("\n  [^5] SYNTHESISED (no decomp line; EonTimer's delay calibration, ") && procC.includes("\n  [^6] pokeplatinum/src/overlay005/field_control.c:759-760,871 (docs/FACTS.md: ") && procC.includes("\n  [^7] pokeplatinum/src/sound_chatot.c:80 (docs/FACTS.md: "));
assert("C: step 5 marks the advance tools in the plan's order and step 4 the coin toss then the calibration", /^5\. Advance to frame .* \[\^6\] \[\^7\] \[dppt\/nds\/seed-to-time-v0\]$/m.test(procC) && /^4\. Verify the seed: .* \[\^4\] \[\^5\] \[dppt\/nds\/seed-to-time-v0\]$/m.test(procC));
assert("C: no footnote is outside the registry", W.procedureProblems(procC).length === 0);
// every procedure the panel vectors pin (the scenarios and the 20 random searches) has its sources block and no problem
{
  const vectors = JSON.parse(fs.readFileSync(path.join(root, "tests", "wizard-panel-vectors.json"), "utf8"));
  const cases = Object.values(vectors.scenarios).concat(vectors.random).filter((c) => c && Array.isArray(c.procedure));
  assert("the panel vectors carry procedures with footnotes", cases.length >= 10 && cases.every((c) => c.procedure.some((l) => l.startsWith("Sources: decomp lines from docs/FACTS.md")) && c.procedure.filter((l) => /^  \[\^\d+\] /.test(l)).length >= 4));
  assert("no pinned procedure has a footnote outside the registry", cases.every((c) => W.procedureProblems(c.procedure).length === 0));
  assert("every pinned procedure marks its numbered steps in order of first use", cases.every((c) => { const marks = c.procedure.join("\n").match(/\[\^(\d+)\]/g).map((m) => parseInt(m.slice(2, -1), 10)); let max = 0; return marks.slice(0, marks.length / 2).every((n) => { if (n > max + 1) return false; max = Math.max(max, n); return true; }); }));
}
assert("C: the timer phases are EonTimer's delay model", JSON.stringify(globalThis.ShinyTimers.gen4Phases({ console: "NDS_SLOT1" }, tmC)) === JSON.stringify(globalThis.ShinyTimers.delayPhases({ console: "NDS_SLOT1" }, 18641, 59, globalThis.ShinyTimers.createCalibration({ console: "NDS_SLOT1" }, 500, 14))));
// the typed coin flips identify the delay hit: the target's own flips -> 18641; the neighbour 7B0448D5's -> 18645, calibrated delay 500 -> 503
const targetC = { year: 2000, month: 1, day: 5, hour: 4, minute: 59, second: 59, delay: 18641, seed: gate.seed };
const idC = W.gen4IdentifyHit("platinum", targetC, globalThis.ShinyGen4.coinFlips(gate.seed, 12), 100, 1, {});
assert("C: the target's flips identify delay 18641 alone", idC.matches.length === 1 && idC.matches[0].delay === 18641 && idC.matches[0].secondOffset === 0 && idC.rows === 603);
const idC2 = W.gen4IdentifyHit("platinum", targetC, "T, T, T, H, T, H, H, H, T, H, H, T", 100, 1, {});
assert("C: a neighbour's flips (with separators) identify delay 18645", idC2.matches.length === 1 && idC2.matches[0].delay === 18645 && idC2.typed === "TTTHTHHHTHHT");
assert("C: the calibrated delay moves 500 -> 503 (4 x 0.75, half to even)", globalThis.ShinyTimers.gen4Calibrated({ console: "NDS_SLOT1" }, tmC, 18645).calibratedDelay === 503);
assert("C: too few flips are refused", /at least 5 coin flips/.test(W.gen4IdentifyHit("platinum", targetC, "HTH", 10, 0, {}).error || ""));
assert("C: HGSS reads Elm calls", W.gen4IdentifyHit("heartgold", targetC, "EKEKE", 10, 0, {}).family === "HGSS");
assert("C: the combination cap is stated", /narrow the ranges to at most 4096 combinations/.test(W.searchGen4(Object.assign({}, cfgC, { wanted: { ivMin: ivObj([0, 0, 0, 0, 0, 0]), ivMax: ivObj([31, 31, 31, 31, 31, 31]) } })).error || ""));
// D: wild4[3] "Route 222 Grass Magnet Pull" (seed 5D1745D0, hour byte 23: reachable): advance 0's species and IVs -> that seed at frame 0
const w4 = GV.wild4.find((c) => c.name === "Route 222 Grass Magnet Pull");
const slD = W.slotsFor("platinum", w4.location, "grass", { time: "morning" });
assert("D: Route 222's morning table is the vector's", slD.rate === w4.rate && slD.slots.every((s, i) => s.species.dex === w4.slots[i].species.dex && s.maxLevel === w4.slots[i].maxLevel));
const vD = w4.results[0];
const cfgD = { game: "platinum", console: "NDS_SLOT1", kind: "wild", slots: slD.slots, rate: slD.rate, encounter: "grass", lead: w4.lead, options: {}, wanted: { ivMin: ivObj(vD.ivs), ivMax: ivObj(vD.ivs), species: vD.specie, tid: GV.meta.tid, sid: GV.meta.sid }, maxFrame: 50, yearMin: 2000, yearMax: 2099, delayMin: 0, delayMax: 65535, targetDelay: 600, limit: 30 };
const rD = W.searchGen4(cfgD);
const rowD = rD.rows.find((r) => r.seed === w4.seed && r.frame === 0);
assert("D: the Magnet Pull vector's seed is reached at frame 0 with its PID, slot and level", !!rowD && rowD.mon.pid === vD.pid && rowD.mon.encounterSlot === vD.encounterSlot && rowD.mon.level === vD.level && JSON.stringify(rowD.mon.ivArray) === JSON.stringify(vD.ivs));
assert("D: the wild candidates were verified by the wild generator, not assumed", rD.verified < rD.candidates && rD.verified >= 1);
// a forced-shiny static (the Lake of Rage Gyarados, shiny always: the creation spends 17 calls, the back-step looks 15 calls
// before the IV words): a (seed, frame) pair the static generator makes is found again from its IVs alone
const gyarados = W.staticEntries("heartgold").find((e) => e.id === "hgss/static/gyarados");
const cfgG = { game: "heartgold", console: "NDS_SLOT1", kind: "static", staticMethod: "M1", species: gyarados.species, level: gyarados.level, shinyMode: "always", wanted: { tid: GV.meta.tid, sid: GV.meta.sid }, maxFrame: 50, yearMin: 2000, yearMax: 2099, delayMin: 0, delayMax: 65535, targetDelay: 600, limit: 30 };
[[0x7b0448d1, 3], [0x5d1745d0, 7]].forEach(([seed, frame]) => {
  const made = W.gen4Run(seed, cfgG, {}, frame, 1)[0];
  const rG = W.searchGen4(Object.assign({}, cfgG, { wanted: { ivMin: ivObj(made.ivArray), ivMax: ivObj(made.ivArray), tid: GV.meta.tid, sid: GV.meta.sid } }));
  const rowG = rG.rows.find((r) => r.seed === seed && r.frame === frame);
  assert(`forced-shiny Gyarados: seed ${W.hex8(seed)} frame ${frame} is found again from its IVs, shiny, 17 calls, every candidate verified`, made.shiny && made.callsUsed === 17 && !!rowG && rowG.mon.pid === made.pid && rowG.mon.shiny && rG.verified === rG.candidates && rG.verified > 0);
});
assert("D: Cute Charm is not offered for Gen 4 wild and the note says why", !W.leadOptions("platinum", "wild").some((l) => l.key === "CUTE_CHARM") && /arithmetic/.test(W.GEN4_CUTE_CHARM_NOTE) && W.leadOptions("emerald", "wild").some((l) => l.key === "CUTE_CHARM") && W.leadOptions("ruby", "wild").length === 1);
const hgLand = W.wildTables("heartgold").find((t) => t.kinds.includes("grass"));
assert("HGSS land tables pick the species by time of day (Route 29: Hoothoot at night)", hgLand.name.startsWith("Route 29") && W.slotsFor("heartgold", hgLand.index, "grass", { time: "night" }).slots[0].species.dex === 163 && W.slotsFor("heartgold", hgLand.index, "grass", { time: "day" }).slots[0].species.dex === 16);
assert("a table without the kind is refused", (() => { try { W.slotsFor("heartgold", 0, "grass", {}); return false; } catch (e) { return /no land table/.test(e.message); } })());
// the store and the mode wall: a sample carries the mode and the seed model; another mode's or model's sample is never in force
const store = {};
W.addSample(store, "platinum", "NDS_SLOT1", { model: "dppt/nds/seed-to-time-v0", target: 18641, hit: 18645, before: { calibratedDelay: 500, calibratedSecond: 14 }, after: { calibratedDelay: 503, calibratedSecond: 14 }, when: "t" }, RUN);
let force = W.inForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0");
assert("the RUN sample is in force in RUN", force.value.calibratedDelay === 503 && force.samples.length === 1 && store["platinum/NDS_SLOT1"].samples[0].mode === RUN);
store["platinum/NDS_SLOT1"].samples.push({ model: "dppt/nds/seed-to-time-v0", target: 18641, hit: 18700, before: { calibratedDelay: 503, calibratedSecond: 14 }, after: { calibratedDelay: 560, calibratedSecond: 14 }, when: "p", mode: PRACTICE });
store["platinum/NDS_SLOT1"].samples.push({ model: "other/model", target: 1, hit: 1, before: { calibratedDelay: 0, calibratedSecond: 0 }, after: { calibratedDelay: 999, calibratedSecond: 0 }, when: "m", mode: RUN });
force = W.inForce(store, "platinum", "NDS_SLOT1", RUN, "dppt/nds/seed-to-time-v0");
assert("a practice sample and another model's sample are left out in RUN and named", force.value.calibratedDelay === 503 && force.ignored.length === 2 && W.ignoredLines(force.ignored, RUN, "dppt/nds/seed-to-time-v0").join("\n").includes("recorded in PRACTICE / HUNT mode, not RUN") && W.ignoredLines(force.ignored, RUN, "dppt/nds/seed-to-time-v0").join("\n").includes("recorded under other/model"));
assert("the practice sample is the one in force in PRACTICE", W.inForce(store, "platinum", "NDS_SLOT1", PRACTICE, "dppt/nds/seed-to-time-v0").value.calibratedDelay === 560);
assert("the wizard's stores are separate keys per mode", globalThis.ShinyMode.storeKey(W.STORE_KEY, RUN) !== globalThis.ShinyMode.storeKey(W.STORE_KEY, PRACTICE) && W.STORE_KEY === "shinySolution.wizard.calibration");
assert("the Gen 3 default calibration is 0 ms with a 5 s pre-timer", W.inForce({}, "ruby", "GBA", RUN, "rs/gba/boot-seed-v0").value.calibration === 0 && W.inForce({}, "ruby", "GBA", RUN, "rs/gba/boot-seed-v0").value.preTimer === 5000);

if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`webapp smoke: ${checks} checks, ${failures} failure${failures === 1 ? "" : "s"}`);
process.exit(failures ? 1 : 0);
