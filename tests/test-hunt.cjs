// The PRACTICE / HUNT head's Gen 1 menu-box pipeline (webapp/hunt/hunt-panel.js) against RNG Solution's
// parity vector (tests/fixtures/hunt/gen1-parity.json, emitted by its tests/fixtures/hunt/emit_parity.py):
//   1. the PNG-sequence fixture gen1-gba-hd-menu/: every frame's extracted features, the events, the attempt
//      and the prediction (lag 9) must equal the Python's;
//   2. the real GBA HD timeline gba-timeline.csv: per session, the attempts (open, close, raw, hold verdict),
//      the overlay's hold events, the guard's verdict and the predictions (lag 18.28) must equal the Python's.
// usage: node test-hunt.cjs [gen1-parity.json] [fixtures dir]
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vectorPath = process.argv[2] || path.join(__dirname, "fixtures", "hunt", "gen1-parity.json");
const fixtures = process.argv[3] || path.join(__dirname, "fixtures", "hunt");

let failures = 0, checks = 0;
function assert(label, cond, detail) {
  checks++;
  if (!cond) { failures++; if (failures <= 40) console.error("FAIL " + label + (detail === undefined ? "" : "\n  " + JSON.stringify(detail))); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(root, "core", "gen1tid.js"));
const DATA = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen1-tid.json"), "utf8"));
globalThis.ShinyGen1Data = DATA;
const H = require(path.join(root, "webapp", "hunt", "hunt-panel.js"));
const G = globalThis.ShinyGen1Tid;
const V = JSON.parse(fs.readFileSync(vectorPath, "utf8"));

// the constants the two implementations must share
for (const [k, v] of Object.entries(V.constants)) assert("constant " + k, near(H[k], v, 1e-9), { js: H[k], py: v });
assert("methodology", V.methodology === "red/gba/hold-start-v1");
const table = G.decodeTable(DATA.methodologies[V.methodology].table_data);
const sets = (DATA.games.red.target_sets || []).map((k) => G.makeTargetSet(k, DATA.target_sets[k]));
const timing = V.timing;
for (const k of ["hold_lo_frame", "hold_hi_frame", "menu_frame"]) assert("timing " + k, H.TIMING["gba-hd"][k] === timing[k]);

// ---- 1. the PNG poll ----------------------------------------------------------------------
{
  const P = V.png;
  const prof = H.PROFILES[P.detector];
  for (const k of ["menu_box", "below", "button"]) assert("profile " + k, JSON.stringify(prof[k]) === JSON.stringify(P.profile[k]), { js: prof[k], py: P.profile[k] });
  for (const k of ["threshold", "dark_lo", "dark_hi", "below_max"]) assert("profile " + k, prof[k] === P.profile[k]);
  const r = H.replayPngSequence(path.join(fixtures, P.fixture), P.detector, V.methodology, timing, table, P.lag_frames, sets);
  assert("png: frame count", r.features.length === P.features.length, { js: r.features.length, py: P.features.length });
  let featBad = 0;
  for (let i = 0; i < Math.min(r.features.length, P.features.length); i++) {
    const a = r.features[i], b = P.features[i];
    if (!(a.index === b[0] && near(a.t, b[1]) && near(a.dark, b[2]) && near(a.below, b[3]) && near(a.lit, b[4]))) { featBad++; if (featBad <= 3) console.error("  frame " + i + " js " + JSON.stringify(a) + " py " + JSON.stringify(b)); }
  }
  assert("png: every frame's features equal the Python's (dark, below, lit)", featBad === 0, { mismatched: featBad });
  assert("png: guard interval", near(r.guard.intervalFrames, P.guard_interval_frames, 1e-5), { js: r.guard.intervalFrames, py: P.guard_interval_frames });
  assert("png: guard not refused", r.guard.refused === null);
  assert("png: event kinds and times", r.events.length === P.events.length && r.events.every((e, i) => e.kind === P.events[i].kind && near(e.t, P.events[i].t)),
    { js: r.events.map((e) => [e.kind, e.t]), py: P.events.map((e) => [e.kind, e.t]) });
  assert("png: attempts", r.attempts.length === P.attempts.length && r.attempts.every((a, i) => near(a.open, P.attempts[i].open) && near(a.close, P.attempts[i].close) && near(a.raw, P.attempts[i].raw, 1e-4) && a.hold === P.attempts[i].hold),
    { js: r.attempts.map((a) => [a.open, a.close, a.raw, a.hold]), py: P.attempts });
  assert("png: predictions", r.predictions.length === P.predictions.length && r.predictions.every((p, i) => p.offset === P.predictions[i].offset && p.tid === P.predictions[i].tid && p.verdict === P.predictions[i].verdict),
    { js: r.predictions.map((p) => [p.offset, p.tid, p.verdict]), py: P.predictions });
  assert("png: the prediction names the methodology it assumes", r.predictions.length > 0 && r.predictions[0].assumes === "this prediction assumes methodology " + V.methodology);
  assert("png: every event and prediction is stamped with the practice mode", r.events.concat(r.predictions).every((e) => e.mode === "practice" && e.tool === "hunt-watch"));
  // the guard bites: the same rows at a third of the rate are refused (undersampled), and the same rows are
  // accepted with undersampledOk while the quantisation is carried on the events
  const rows = r.features.map((f) => ({ t: f.t * 3, dark: f.dark, below: f.below, lit: f.lit }));
  let threw = null;
  try { H.runRows(new H.Gen1MenuMachine(prof, V.methodology, timing, {}), rows, new H.RateGuard({})); } catch (e) { threw = e; }
  assert("png: a 42 Hz poll is refused by the guard", threw !== null && threw.name === "SampleRateError", threw && threw.message);
  const g2 = new H.RateGuard({ undersampledOk: true });
  const ev2 = H.runRows(new H.Gen1MenuMachine(prof, V.methodology, timing, {}), rows, g2);
  assert("png: with undersampledOk the guard reports the quantisation", g2.refused !== null && ev2.some((e) => e.kind === "attempt" && e.quantisation_frames > 1.0));
}

// ---- 2. the real GBA HD timeline -------------------------------------------------------------
{
  const TL = V.timeline;
  const text = fs.readFileSync(path.join(fixtures, TL.fixture), "utf8");
  const sessions = H.parseTimelineCsv(text);
  assert("timeline: session count", sessions.length === TL.sessions.length, { js: sessions.length, py: TL.sessions.length });
  const prof = H.PROFILES[TL.detector];
  for (const k of ["dark_lo", "dark_hi", "below_max"]) assert("timeline profile " + k, prof[k] === TL.thresholds[k]);
  const res = H.replayTimeline(sessions, TL.detector, V.methodology, timing, table, TL.lag_frames, sets, { undersampledOk: true, source: TL.fixture });
  for (let i = 0; i < Math.min(res.length, TL.sessions.length); i++) {
    const js = res[i], py = TL.sessions[i];
    assert("session " + i + ": row count", sessions[i].length === py.rows, { js: sessions[i].length, py: py.rows });
    assert("session " + i + ": guard refused (undersampled)", (js.guard.refused !== null) === py.guard_refused);
    assert("session " + i + ": guard interval", near(js.guard.intervalFrames, py.guard_interval_frames, 1e-5), { js: js.guard.intervalFrames, py: py.guard_interval_frames });
    const kinds = {};
    js.events.forEach((e) => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
    assert("session " + i + ": event kinds", JSON.stringify(kinds, Object.keys(kinds).sort()) === JSON.stringify(py.event_kinds, Object.keys(py.event_kinds).sort()), { js: kinds, py: py.event_kinds });
    const holds = js.events.filter((e) => e.kind === "hold-start" || e.kind === "hold-end").map((e) => [e.kind, e.t]);
    assert("session " + i + ": the overlay's hold events", holds.length === py.holds.length && holds.every((h, k) => h[0] === py.holds[k][0] && near(h[1], py.holds[k][1])), { js: holds, py: py.holds });
    assert("session " + i + ": attempts (open, close, raw, hold)", js.attempts.length === py.attempts.length && js.attempts.every((a, k) => near(a.open, py.attempts[k].open) && near(a.close, py.attempts[k].close) && near(a.raw, py.attempts[k].raw, 1e-4) && a.hold === py.attempts[k].hold),
      { js: js.attempts.map((a) => [a.open, a.close, a.raw, a.hold]), py: py.attempts });
    assert("session " + i + ": predictions under lag " + TL.lag_frames, js.predictions.length === py.predictions.length && js.predictions.every((p, k) => p.offset === py.predictions[k].offset && p.tid === py.predictions[k].tid && p.verdict === py.predictions[k].verdict),
      { js: js.predictions.map((p) => [p.offset, p.tid, p.verdict]), py: py.predictions });
    assert("session " + i + ": every prediction carries the undersampling warning", js.predictions.every((p) => /uncertain by about \+-2/.test(p.warning || "")));
  }
  // the offset-13 sample: session 0's attempt is the hardware-measured TID 45432
  assert("the offset-13 sample (TID 45432) is session 0's prediction", res[0].predictions.length === 1 && res[0].predictions[0].offset === 13 && res[0].predictions[0].tid === 45432);
  // negative twin: with lag 0 the same attempt reads offset 31 (gba-watch.py's earlier, uncalibrated blocks)
  const res0 = H.replayTimeline([sessions[0]], TL.detector, V.methodology, timing, table, 0.0, sets, { undersampledOk: true });
  assert("with lag 0 the offset-13 sample reads 31", res0[0].predictions[0].offset === 31);
}

// ---- 3. the calibration store: the practice key only ----------------------------------------
{
  const M = require(path.join(root, "webapp", "mode.js"));
  assert("the hunt store key is the practice namespace", H.calStoreKey(M) === "shinySolution.hunt.calibration.practice");
  assert("the hunt store key is never the RUN key", H.calStoreKey(M) !== H.STORE_KEY && M.storeKey(H.STORE_KEY, M.RUN) === H.STORE_KEY);
  const store = {};
  const s = H.learn(store, "gba", 174.83, 4037, table, V.methodology, "gba-hd/wholebox-v1");
  assert("learn: 4037 inverts to offset 201 with lag -26.17", s.true_offset === 201 && near(s.lag, -26.17, 1e-6) && s.mode === "practice");
  let refused = null;
  try { H.learn(store, "gba", 245.0, 40951, table, V.methodology, "gba-hd/wholebox-v1"); } catch (e) { refused = e.message; }
  assert("learn: a GameCube sample not in the table is refused", refused !== null && /not in this table/.test(refused));
  refused = null;
  try { H.learn(store, "gba", 114.9, 44452, table, V.methodology, "gba-hd/wholebox-v1"); } catch (e) { refused = e.message; }
  assert("learn: a -807-frame lag is refused", refused !== null && /beyond the 60-frame bound/.test(refused));
  assert("learn: the refused samples were not stored", store.gba.samples.length === 1);
  assert("lag scoped to the detector", near(H.lagFrames(store, "gba", V.methodology, "gba-hd/wholebox-v1"), -26.17, 1e-6) && H.lagFrames(store, "gba", V.methodology, "gba-hd/border-v1") === 0.0);
}

// ---- 4. the Practice & Hunt window (webapp/hunt/electron-main.js, the main-process side) with Electron stood in for:
//         opened only while the MAIN window's mode is PRACTICE / HUNT, the menu item disabled otherwise, a window still
//         open when the mode goes back to RUN closed; the page has no switch of its own; the plain build's main.js and
//         package.json name none of it. usage: a 4th argument replaces electron-main.js (the negative control).
async function windowChecks() {
  const huntDir = path.join(root, "webapp", "hunt");
  const W = require(process.argv[4] || path.join(huntDir, "electron-main.js"));
  let modeInMain = null, dialogs = 0;
  const windows = [];
  const mainWin = {
    isDestroyed: () => false,
    webContents: { executeJavaScript: (js) => { assert("the mode is read from the main window's page (localStorage, mode.js's key)", /localStorage\.getItem\("shinySolution\.mode"\)/.test(js)); return Promise.resolve(modeInMain); } }
  };
  let mainWindow = mainWin;
  function FakeBrowserWindow(o) { this.opts = o; this.loaded = null; this.closed = false; this.handlers = {}; windows.push(this); }
  FakeBrowserWindow.prototype.loadFile = function (p) { this.loaded = p; };
  FakeBrowserWindow.prototype.on = function (ev, fn) { this.handlers[ev] = fn; };
  FakeBrowserWindow.prototype.close = function () { this.closed = true; if (this.handlers.closed) this.handlers.closed(); };
  const fakeMenu = { items: [], getMenuItemById(id) { return this.items.find((i) => i.id === id) || null; } };
  const Menu = {
    buildFromTemplate: (t) => { fakeMenu.template = t; fakeMenu.items = []; for (const top of t) for (const it of (top.submenu || [])) fakeMenu.items.push(it); return fakeMenu; },
    setApplicationMenu: (m) => { Menu.applied = m; }
  };
  const handlers = {};
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
  const dialog = { showMessageBox: () => { dialogs++; return Promise.resolve({ response: 0 }); } };
  const ctl = W.install({ BrowserWindow: FakeBrowserWindow, Menu, dialog, ipcMain }, { huntDir, fixturesDir: fixtures, mainWindow: () => mainWindow });
  const item = fakeMenu.getMenuItemById(W.ITEM_ID);
  assert("the Practice & Hunt menu is installed with its one item", Menu.applied === fakeMenu && !!item && item.label === W.ITEM_LABEL && fakeMenu.template.some((t) => t.label === "Practice & Hunt"));
  assert("the frame sources are registered on the main process's ipc", ["hunt:list-replays", "hunt:open-replay", "hunt:next-frame", "hunt:open-obs", "hunt:close"].every((c) => typeof handlers[c] === "function"));
  assert("the replay source lists the shared PNG fixture", handlers["hunt:list-replays"]().some((p) => p.endsWith("gen1-gba-hd-menu")));
  // RUN (the default: no mode stored) and a mode the head does not know: the item is disabled and a click refuses
  for (const m of [null, "run", "hunt", ""]) {
    modeInMain = m;
    const on = await ctl.tick();
    const before = dialogs;
    const w = await ctl.open();
    assert("in mode " + JSON.stringify(m) + " the item is disabled, the click refuses with a dialog and opens nothing", on === false && item.enabled === false && w === null && dialogs === before + 1 && windows.length === 0);
  }
  // PRACTICE / HUNT: the item is enabled and the window opens on hunt.html with the hunt preload, isolated
  modeInMain = "practice";
  assert("in PRACTICE / HUNT the item is enabled", (await ctl.tick()) === true && item.enabled === true);
  const w = await ctl.open();
  assert("the window opens hunt.html with the hunt preload and context isolation", !!w && windows.length === 1 && w.loaded === path.join(huntDir, "hunt.html") &&
    w.opts.webPreferences.contextIsolation === true && w.opts.webPreferences.preload === path.join(huntDir, "preload.js") && ctl.windows().length === 1);
  // back to RUN in the main window: the open hunt window is closed from here and the item disabled again
  modeInMain = "run";
  await ctl.tick();
  assert("back in RUN the open hunt window is closed and the item disabled", w.closed === true && ctl.windows().length === 0 && item.enabled === false);
  // no main window at all (closed): refused
  mainWindow = null;
  modeInMain = "practice";
  assert("with no main window to ask, the click refuses", (await ctl.open()) === null && windows.length === 1);
  mainWindow = { isDestroyed: () => true, webContents: mainWin.webContents };
  assert("with the main window destroyed, the click refuses", (await ctl.open()) === null && windows.length === 1);
  ctl.stop();
  // the page: no switch of its own, and it closes itself in RUN
  const page = fs.readFileSync(path.join(huntDir, "hunt.html"), "utf8");
  assert("hunt.html carries no mode switch of its own", !/id="mode-practice"/.test(page) && !/<input/.test(page) && !/mode-toggle/.test(page));
  assert("hunt.html closes itself when the mode is RUN", /window\.close\(\)/.test(page) && /isPractice\(\)/.test(page) && /"storage"/.test(page));
  // every build's main.js and package.json: the hook only, no window, menu, source or package
  const mainjs = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  assert("electron/main.js only requires webapp/hunt/electron-main.js when it exists", /electron-main\.js/.test(mainjs) && /existsSync\(huntMain\)/.test(mainjs) &&
    !/Practice & Hunt|createHuntWindow|electron-source|preload|hunt\.html|GetSourceScreenshot|obs-websocket|"ws"/.test(mainjs));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "electron", "package.json"), "utf8"));
  assert("electron/package.json pulls no package for the hunt window (ws is installed by build.sh --with-hunt alone)", !JSON.stringify(pkg).includes('"ws"'));
}

windowChecks().catch((e) => { failures++; console.error("FAIL window checks threw: " + (e && e.stack || e)); }).then(() => {
  console.log("hunt parity: " + checks + " checks, " + failures + " failure" + (failures === 1 ? "" : "s") + " (" + path.basename(vectorPath) + ")");
  process.exit(failures ? 1 : 0);
});
