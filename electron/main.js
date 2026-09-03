const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

// The PRACTICE / HUNT side of the wall: webapp/hunt/ is staged only by 'build.sh --with-hunt'. When it is
// there, a "Practice & Hunt" menu opens webapp/hunt/hunt.html in its own window with the hunt bridge
// (preload.js) and the frame sources registered in this process (electron-source.js). A plain build has
// no hunt directory, no menu item and none of this code path.
const HUNT_DIR = path.join(__dirname, "webapp", "hunt");
const HUNT_PAGE = path.join(HUNT_DIR, "hunt.html");
const HUNT_SOURCE = path.join(HUNT_DIR, "electron-source.js");
const HUNT_FIXTURES = path.join(__dirname, "..", "tests", "fixtures", "hunt");
const withHunt = fs.existsSync(HUNT_PAGE) && fs.existsSync(HUNT_SOURCE);

function createHuntWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 760,
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(HUNT_DIR, "preload.js") }
  });
  win.loadFile(HUNT_PAGE);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadFile(path.join(__dirname, "webapp", "index.html"));
}

app.whenReady().then(() => {
  if (withHunt) {
    require(HUNT_SOURCE).register(ipcMain, HUNT_FIXTURES);
    const menu = Menu.buildFromTemplate([
      { role: "fileMenu" },
      { label: "Practice & Hunt", submenu: [{ label: "Open the Practice & Hunt window (reads the capture; never for a submitted run)", click: createHuntWindow }] }
    ]);
    Menu.setApplicationMenu(menu);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
