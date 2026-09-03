// The hunt window's frame sources, in the Electron MAIN process (electron/main.js requires this file only
// when webapp/hunt/ was staged with --with-hunt). Two sources:
//   * a PNG-sequence replay (tests/fixtures/hunt/<name>/frames.csv + frame-NNNNNN.png): frames with their
//     recorded timestamps, the same fixture RNG Solution's tests and the parity vector use;
//   * obs-websocket v5 GetSourceScreenshot of the capture input, polled through the 'ws' package (an
//     optional dependency). It is opened only when the renderer passes confirmLive: true from its dialog,
//     and NO test ever opens it.
// Guarded so the file is inert in a browser bundle.
(function () {
  if (typeof module !== "object" || !module.exports || typeof require !== "function") return;
  var fs = require("fs"), path = require("path"), crypto = require("crypto");
  var sources = {}, nextId = 1;

  function listReplays(fixturesDir) {
    if (!fs.existsSync(fixturesDir)) return [];
    return fs.readdirSync(fixturesDir).map(function (n) { return path.join(fixturesDir, n); })
      .filter(function (p) { return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "frames.csv")); });
  }
  function openReplay(dir) {
    var lines = fs.readFileSync(path.join(dir, "frames.csv"), "utf8").split(/\r?\n/).filter(function (l) { return l.trim(); });
    var header = lines[0].split(",");
    var entries = lines.slice(1).map(function (l) {
      var p = l.split(","), extras = {};
      for (var j = 2; j < header.length; j++) extras[header[j]] = Number(p[j]);
      return { index: parseInt(p[0], 10), t: Number(p[1]), extras: extras };
    });
    var id = nextId++;
    sources[id] = { kind: "replay", dir: dir, entries: entries, pos: 0 };
    return id;
  }
  function nextFrame(id) {
    var s = sources[id];
    if (!s) throw new Error("no such source " + id);
    if (s.kind === "replay") {
      if (s.pos >= s.entries.length) return null;
      var e = s.entries[s.pos++];
      var png = fs.readFileSync(path.join(s.dir, "frame-" + String(e.index).padStart(6, "0") + ".png"));
      return { index: e.index, t: e.t, extras: e.extras, png: png.toString("base64") };
    }
    return s.next();
  }
  function closeSource(id) {
    var s = sources[id];
    if (s && s.close) s.close();
    delete sources[id];
    return true;
  }

  // obs-websocket v5, the same handshake as RNG Solution's sampler.obs_connect
  function openObs(opts) {
    var o = opts || {};
    if (o.confirmLive !== true) throw new Error("refusing to connect to OBS: the renderer did not confirm a live practice session");
    var WebSocket;
    try { WebSocket = require("ws"); } catch (e) { throw new Error("the 'ws' package is not installed (npm install ws in electron/): the OBS source needs it"); }
    var host = o.host || "127.0.0.1", port = o.port || 4455, password = o.password || "", source = o.source || "Video Capture Device (V4L2)";
    var width = o.width || 320, height = o.height || 180;
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket("ws://" + host + ":" + port, { maxPayload: 64 * 1024 * 1024 });
      var pending = {}, identified = false, rid = 0;
      ws.on("message", function (data) {
        var msg = JSON.parse(data.toString());
        if (msg.op === 0) {
          var ident = { rpcVersion: 1 };
          var auth = msg.d && msg.d.authentication;
          if (auth) {
            var secret = crypto.createHash("sha256").update(password + auth.salt).digest("base64");
            ident.authentication = crypto.createHash("sha256").update(secret + auth.challenge).digest("base64");
          }
          ws.send(JSON.stringify({ op: 1, d: ident }));
        } else if (msg.op === 2 && !identified) {
          identified = true;
          var id = nextId++;
          sources[id] = { kind: "obs", ws: ws, index: 0, close: function () { ws.close(); },
            next: function () {
              var s = sources[id];
              return new Promise(function (res, rej) {
                var r = "p" + (rid++);
                pending[r] = function (d) {
                  if (!d.requestStatus || !d.requestStatus.result) return rej(new Error("OBS GetSourceScreenshot failed: " + (d.requestStatus && d.requestStatus.comment)));
                  var t = Number(process.hrtime.bigint()) / 1e9;
                  res({ index: s.index++, t: t, extras: {}, png: d.responseData.imageData.split(",", 2)[1] });
                };
                ws.send(JSON.stringify({ op: 6, d: { requestType: "GetSourceScreenshot", requestId: r,
                  requestData: { sourceName: source, imageFormat: "png", imageWidth: width, imageHeight: height } } }));
              });
            } };
          resolve(id);
        } else if (msg.op === 7 && pending[msg.d.requestId]) {
          var fn = pending[msg.d.requestId]; delete pending[msg.d.requestId]; fn(msg.d);
        }
      });
      ws.on("error", reject);
    });
  }

  function register(ipcMain, fixturesDir) {
    ipcMain.handle("hunt:list-replays", function () { return listReplays(fixturesDir); });
    ipcMain.handle("hunt:open-replay", function (_e, dir) { return openReplay(dir); });
    ipcMain.handle("hunt:next-frame", function (_e, id) { return nextFrame(id); });
    ipcMain.handle("hunt:open-obs", function (_e, opts) { return openObs(opts); });
    ipcMain.handle("hunt:close", function (_e, id) { return closeSource(id); });
  }
  module.exports = { register: register, listReplays: listReplays, openReplay: openReplay, nextFrame: nextFrame, openObs: openObs, closeSource: closeSource };
})();
