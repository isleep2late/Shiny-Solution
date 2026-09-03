// The hunt window's preload (Electron, contextIsolation): the renderer gets window.huntBridge and nothing
// else. Staged only with --with-hunt (electron/build.sh). Guarded so the file is inert if it is ever
// concatenated into a browser bundle by a --with-hunt mobile build.
if (typeof require === "function" && typeof process !== "undefined" && process.versions && process.versions.electron) {
  var electron = require("electron");
  electron.contextBridge.exposeInMainWorld("huntBridge", {
    listReplays: function () { return electron.ipcRenderer.invoke("hunt:list-replays"); },
    openReplay: function (dir) { return electron.ipcRenderer.invoke("hunt:open-replay", dir); },
    nextFrame: function (id) { return electron.ipcRenderer.invoke("hunt:next-frame", id); },
    openObs: function (opts) { return electron.ipcRenderer.invoke("hunt:open-obs", opts); },
    close: function (id) { return electron.ipcRenderer.invoke("hunt:close", id); }
  });
}
