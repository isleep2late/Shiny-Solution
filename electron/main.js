const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

let mainWindow = null;

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
  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  // PRACTICE / HUNT builds only: 'build.sh --with-hunt' stages webapp/hunt/, and its electron-main.js owns that
  // side's menu and window (opened only while the main window's mode is PRACTICE / HUNT). A plain build has no
  // such file, and nothing here names a window, a menu or a capture source.
  const huntMain = path.join(__dirname, "webapp", "hunt", "electron-main.js");
  if (fs.existsSync(huntMain)) {
    require(huntMain).install({ BrowserWindow, Menu, dialog, ipcMain }, {
      huntDir: path.dirname(huntMain),
      fixturesDir: path.join(__dirname, "..", "tests", "fixtures", "hunt"),
      mainWindow: () => mainWindow
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
