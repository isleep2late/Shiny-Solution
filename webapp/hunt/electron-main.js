// The Practice & Hunt window and its menu, in the Electron MAIN process. Staged only by 'electron/build.sh
// --with-hunt' like everything under webapp/hunt/: a plain build has no such file, so electron/main.js (which
// requires it only when it exists) carries no menu item, no window and no capture source. The window opens
// only while the MAIN window's mode is PRACTICE / HUNT (the one persisted setting every head shares, read from
// its page's localStorage through webapp/mode.js's key); the menu item is disabled otherwise and refuses with
// a dialog if it is clicked anyway, and a hunt window still open when the mode goes back to RUN is closed
// from here (the page closes itself too; this side does not rely on it). The hunt window has no switch of
// its own. Guarded so the file is inert in a browser bundle.
(function () {
  if (typeof module !== "object" || !module.exports || typeof require !== "function") return;
  var path = require("path");

  var PRACTICE = "practice";
  var MODE_KEY = "shinySolution.mode";          // webapp/mode.js: absent or anything but "practice" means RUN
  var READ_MODE = "(function () { try { return localStorage.getItem(" + JSON.stringify(MODE_KEY) + "); } catch (e) { return null; } })()";
  var POLL_MS = 1000;
  var ITEM_ID = "hunt-open";
  var ITEM_LABEL = "Open the Practice & Hunt window (reads the capture; never for a submitted run)";
  var REFUSAL = "PRACTICE / HUNT mode is off. Turn it on with the switch above the tabs in the main window first: this window reads the capture and is never for a submitted run.";

  function isPractice(mode) { return mode === PRACTICE; }

  // The mode as the main window's page holds it; null (no main window, page not loaded, storage refused) is RUN.
  function readMode(mainWindow) {
    if (!mainWindow || (mainWindow.isDestroyed && mainWindow.isDestroyed())) return Promise.resolve(null);
    var p;
    try { p = mainWindow.webContents.executeJavaScript(READ_MODE, true); } catch (e) { return Promise.resolve(null); }
    return Promise.resolve(p).then(function (m) { return typeof m === "string" ? m : null; }, function () { return null; });
  }

  // electron: { BrowserWindow, Menu, dialog, ipcMain }; opts: { huntDir, fixturesDir, mainWindow: function () -> BrowserWindow | null }
  function install(electron, opts) {
    var BrowserWindow = electron.BrowserWindow, Menu = electron.Menu, dialog = electron.dialog;
    var huntDir = opts.huntDir;
    require(path.join(huntDir, "electron-source.js")).register(electron.ipcMain, opts.fixturesDir);
    var huntWindows = [];
    var menu = Menu.buildFromTemplate([
      { role: "fileMenu" },
      { label: "Practice & Hunt", submenu: [{ id: ITEM_ID, label: ITEM_LABEL, enabled: false, click: function () { open(); } }] }
    ]);
    Menu.setApplicationMenu(menu);

    function setEnabled(on) {
      var item = menu.getMenuItemById ? menu.getMenuItemById(ITEM_ID) : null;
      if (item) item.enabled = on;
    }

    function open() {
      return readMode(opts.mainWindow()).then(function (mode) {
        if (!isPractice(mode)) {
          setEnabled(false);
          if (dialog && dialog.showMessageBox) dialog.showMessageBox({ type: "info", title: "Practice & Hunt", message: REFUSAL });
          return null;
        }
        var win = new BrowserWindow({
          width: 900,
          height: 760,
          backgroundColor: "#101418",
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, preload: path.join(huntDir, "preload.js") }
        });
        win.loadFile(path.join(huntDir, "hunt.html"));
        huntWindows.push(win);
        if (win.on) win.on("closed", function () { huntWindows = huntWindows.filter(function (w) { return w !== win; }); });
        return win;
      });
    }

    // Once a second: the menu item follows the main window's mode, and every hunt window is closed once it is RUN.
    function tick() {
      return readMode(opts.mainWindow()).then(function (mode) {
        var on = isPractice(mode);
        setEnabled(on);
        if (!on && huntWindows.length) {
          var open_ = huntWindows.slice();
          huntWindows = [];
          open_.forEach(function (w) { try { w.close(); } catch (e) { /* already gone */ } });
        }
        return on;
      });
    }
    var timer = setInterval(tick, POLL_MS);
    if (timer && timer.unref) timer.unref();
    tick();
    return { open: open, tick: tick, windows: function () { return huntWindows.slice(); }, stop: function () { clearInterval(timer); } };
  }

  module.exports = { install: install, readMode: readMode, isPractice: isPractice, PRACTICE: PRACTICE, MODE_KEY: MODE_KEY,
                     ITEM_ID: ITEM_ID, ITEM_LABEL: ITEM_LABEL, REFUSAL: REFUSAL, POLL_MS: POLL_MS };
})();
