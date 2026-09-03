// PRACTICE / HUNT ONLY: the capture-watching panel (RNG Solution's rngsolution/hunt, Gen 1 menu-box
// state machine, in JS). Lives under webapp/hunt/ and ships only in a --with-hunt build
// (webapp/hunt/README.md); index.html never references it. It runs only while PRACTICE / HUNT mode
// is on (webapp/mode.js), keeps its calibration under the practice store key, stamps every record
// with the mode, and names the methodology every prediction assumes.
//
// Pipeline (RNG Solution's design section 7.3): a frame source (a PNG-sequence replay with
// frames.csv timestamps, or obs-websocket screenshots through the Electron main process:
// electron-source.js) -> the extractor (the menu box's dark fraction and the screen below it,
// per console profile) -> the sample-rate guard -> the state machine -> the prediction from the
// table with the calibrated lag. The numbers here are RNG Solution's, checked against its parity
// vector (tests/test-hunt.cjs over tests/fixtures/hunt/gen1-parity.json).
(function (root) {
  var FPS = 4194304.0 / 70224.0;
  var MENU_TO_TABLE_FRAMES = 80;
  var MENU_MIN_HOLD = 0.60, MENU_MIN_SPAN = 1.0, ATTEMPT_COOLDOWN = 15.0, PRE_GAP_MIN = 10.0;
  var HOLD_LIT = 0.9, HOLD_LOOKBACK_S = 8.0, HOLD_SLACK_EARLY_S = 0.2, HOLD_SLACK_LATE_S = 0.8;
  var MIN_SAMPLES_PER_GAME_FRAME = 2.0, GUARD_WINDOW = 32;
  var MODE_STAMP = "practice";                 // this head's wall stamp (mode.js); RNG Solution's is "hunt"
  var TOOL = "hunt-watch";
  var STORE_KEY = "shinySolution.hunt.calibration";   // used ONLY through ShinyMode.storeKey(KEY, PRACTICE)

  // Per-console geometry and thresholds (RNG Solution rngsolution/hunt/extractors.py GEN1_PROFILES).
  var PROFILES = {
    "gba-hd/wholebox-v1": { console: "gba", platform: "gba-hd", size: [320, 180], menu_box: [80, 19, 200, 64], below: [80, 75, 240, 160],
      threshold: 128, dark_lo: 0.10, dark_hi: 0.60, below_max: 0.05, button: [10, 10, 30, 18],
      provenance: "MEASURED (tidpredict.py, GBA HD, 320x180 screenshots): the whole box reads 19.7 % dark with the menu up, the screen below 0.00, 0.14 in gameplay" },
    "gba-hd/border-v1": { console: "gba", platform: "gba-hd", size: [640, 360], menu_box: [165, 40, 395, 50], below: [160, 150, 480, 320],
      threshold: 128, dark_lo: 0.35, dark_hi: 0.85, below_max: 0.20, button: [20, 20, 60, 37],
      provenance: "MEASURED (gba-watch.py, 640x360 screenshots): the box's top border strip reads 59.5 % dark; gba-timeline.csv was recorded with it" }
  };
  var TIMING = { "gba-hd": { hold_lo_frame: 1300, hold_hi_frame: 1475, menu_frame: 1553 }, "dmg": { hold_lo_frame: 1450, hold_hi_frame: 1640, menu_frame: 1701 } };

  function round(x, n) { var k = Math.pow(10, n); return Math.round(x * k) / k; }
  function isNil(x) { return x === null || x === undefined; }

  // ---- the extractor ------------------------------------------------------------------------
  function darkFraction(gray, width, rect, threshold) {
    var x0 = rect[0], y0 = rect[1], x1 = rect[2], y1 = rect[3], n = 0, dark = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { n++; if (gray[y * width + x] < threshold) dark++; }
    return n ? dark / n : 0.0;
  }
  function litFraction(gray, width, rect) {
    var x0 = rect[0], y0 = rect[1], x1 = rect[2], y1 = rect[3], n = 0, lit = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { n++; if (gray[y * width + x] > 128) lit++; }
    return n ? lit / n : 0.0;
  }
  // gray: a Uint8Array (row-major, width x height) -> {dark, below[, lit]}
  function extractGen1(gray, width, height, profileId) {
    var p = PROFILES[profileId];
    if (!p) throw new Error("unknown detector " + profileId);
    if (width !== p.size[0] || height !== p.size[1]) throw new Error("detector " + profileId + " expects " + p.size[0] + "x" + p.size[1] + " frames, got " + width + "x" + height);
    var out = { dark: darkFraction(gray, width, p.menu_box, p.threshold), below: darkFraction(gray, width, p.below, p.threshold) };
    if (p.button) out.lit = litFraction(gray, width, p.button);
    return out;
  }

  // ---- the sample-rate guard --------------------------------------------------------------
  function SampleRateError(msg) { this.name = "SampleRateError"; this.message = msg; }
  SampleRateError.prototype = Object.create(Error.prototype);
  function RateGuard(opts) {
    var o = opts || {};
    this.gameFps = o.gameFps || FPS; this.minPerFrame = o.minPerFrame || MIN_SAMPLES_PER_GAME_FRAME; this.window = o.window || GUARD_WINDOW;
    this.undersampledOk = !!o.undersampledOk; this.times = []; this.intervalFrames = null; this.refused = null;
  }
  RateGuard.prototype.check = function (t) {
    this.times.push(t);
    if (this.times.length > this.window) this.times.shift();
    if (this.times.length < this.window) return this.intervalFrames;
    var gaps = [];
    for (var i = 1; i < this.times.length; i++) gaps.push(this.times[i] - this.times[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var median = gaps[Math.floor(gaps.length / 2)];
    this.intervalFrames = median * this.gameFps;
    if (this.intervalFrames > 1.0 / this.minPerFrame) {
      this.refused = "sampling at " + (1.0 / median).toFixed(1) + " samples/s = " + this.intervalFrames.toFixed(2) + " game frames per sample; the guard needs " +
        this.minPerFrame + " samples per game frame (" + (this.minPerFrame * this.gameFps).toFixed(1) + " samples/s). Each boundary is quantised to " +
        this.intervalFrames.toFixed(2) + " frames: predictions would be wrong by whole Trainer IDs";
      if (!this.undersampledOk) throw new SampleRateError(this.refused);
    }
    return this.intervalFrames;
  };

  // ---- the state machine (RNG Solution states.Gen1MenuMachine) ------------------------------
  function Gen1MenuMachine(thresholds, methodology, timing, opts) {
    var o = opts || {};
    this.lo = thresholds.dark_lo; this.hi = thresholds.dark_hi; this.belowMax = thresholds.below_max;
    this.methodology = methodology; this.timing = timing || null;
    this.game = o.game || "red"; this.detector = o.detector || ""; this.source = o.source || ""; this.holdCheck = o.holdCheck !== false;
    this.cand = null; this.openAt = null; this.lastBoxEnd = 0.0; this.lastReport = null;
    this.litPrev = null; this.holds = []; this.quant = null;
  }
  Gen1MenuMachine.prototype.event = function (kind, t, data) {
    var e = { kind: kind, t: round(t, 6), game: this.game, methodology: this.methodology, detector: this.detector, source: this.source, mode: MODE_STAMP, tool: TOOL };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) e[k] = data[k];
    return e;
  };
  Gen1MenuMachine.prototype.holdWindowS = function () {
    var tm = this.timing;
    if (!tm || isNil(tm.hold_lo_frame) || isNil(tm.hold_hi_frame) || isNil(tm.menu_frame)) return null;
    return [(tm.menu_frame - tm.hold_hi_frame) / FPS, (tm.menu_frame - tm.hold_lo_frame) / FPS];
  };
  Gen1MenuMachine.prototype.present = function (f) { return (this.lo < f.dark && f.dark < this.hi) && f.below < this.belowMax; };
  Gen1MenuMachine.prototype.holdEvents = function (t, f) {
    var out = [];
    if (isNil(f.lit)) return out;
    if (this.litPrev !== null) {
      if (f.lit > HOLD_LIT && this.litPrev <= HOLD_LIT) { this.holds.push([t, null]); out.push(this.event("hold-start", t, { lit: round(f.lit, 4) })); }
      else if (f.lit <= HOLD_LIT && this.litPrev > HOLD_LIT && this.holds.length && this.holds[this.holds.length - 1][1] === null) {
        this.holds[this.holds.length - 1][1] = t; out.push(this.event("hold-end", t, { lit: round(f.lit, 4) }));
      }
    }
    this.litPrev = f.lit;
    return out;
  };
  Gen1MenuMachine.prototype.holdVerdict = function (openAt) {
    var win = this.holdWindowS();
    if (!win || !this.holdCheck) return ["unchecked", null, "the methodology's hold window is not known to this machine"];
    var starts = this.holds.filter(function (h) { return h[0] < openAt; }).map(function (h) { return h[0]; });
    if (!starts.length) return ["unobserved", null, "no START hold seen before the menu (the source has no overlay, or it did not show it)"];
    var d = openAt - starts[starts.length - 1];
    if (d > HOLD_LOOKBACK_S) return ["unobserved", round(d, 3), "the last hold seen started " + d.toFixed(1) + " s before the menu, more than " + HOLD_LOOKBACK_S.toFixed(0) + " s: not the hold that opened it"];
    if (win[0] - HOLD_SLACK_EARLY_S <= d && d <= win[1] + HOLD_SLACK_LATE_S) return ["ok", round(d, 3), "hold started " + d.toFixed(2) + " s before the menu, inside " + win[0].toFixed(2) + "-" + win[1].toFixed(2) + " s"];
    return ["violated", round(d, 3), "hold started " + d.toFixed(2) + " s before the menu; under " + this.methodology + " the menu opens " + win[0].toFixed(2) + "-" + win[1].toFixed(2) +
      " s after a hold inside the window (+" + HOLD_SLACK_LATE_S.toFixed(1) + " s detection slack). Held outside the window, the menu follows the hold on a different frame and every table offset shifts"];
  };
  Gen1MenuMachine.prototype.feed = function (t, f) {
    var out = this.holdEvents(t, f);
    if (!isNil(f._interval_frames)) this.quant = round(f._interval_frames, 3);
    var present = this.present(f);
    if (present) {
      if (this.cand === null) this.cand = t;
      else if (this.openAt === null && this.cand !== Infinity && (t - this.cand) >= MENU_MIN_HOLD) {
        var gap = this.cand - this.lastBoxEnd;
        if (this.lastBoxEnd > 0 && gap < PRE_GAP_MIN) {
          out.push(this.event("notice", t, { what: "box-back-too-soon", gap_s: round(gap, 3), text: "box back after only " + gap.toFixed(0) + "s: save wipe or sub-menu, ignoring" }));
          this.cand = Infinity;
        } else {
          this.openAt = this.cand;
          out.push(this.event("menu-open", this.openAt, { dark: round(f.dark, 4), quantisation_frames: this.quant }));
        }
      }
    } else {
      if (this.cand !== null && this.cand !== Infinity) this.lastBoxEnd = t;
      if (this.openAt !== null) {
        var span = t - this.openAt;
        if (span >= MENU_MIN_SPAN && (this.lastReport === null || (t - this.lastReport) > ATTEMPT_COOLDOWN)) {
          this.lastReport = t;
          var v = this.holdVerdict(this.openAt);
          var raw = span * FPS - MENU_TO_TABLE_FRAMES;
          out.push(this.event("menu-close", t, { quantisation_frames: this.quant }));
          var att = this.event("attempt", t, { open: round(this.openAt, 6), close: round(t, 6), span: round(span, 6), raw: round(raw, 4), hold: v[0], hold_before_menu_s: v[1], hold_note: v[2], quantisation_frames: this.quant });
          if (v[0] === "violated") out.push(this.event("refusal", t, { reason: v[2], attempt: att }));
          else out.push(att);
        } else if (span < MENU_MIN_SPAN) {
          out.push(this.event("notice", t, { what: "box-too-brief", span_s: round(span, 3), text: "box gone after " + span.toFixed(2) + "s: too brief to be an attempt" }));
        } else {
          out.push(this.event("notice", t, { what: "inside-cooldown", span_s: round(span, 3), text: "box open " + span.toFixed(2) + "s but inside the " + ATTEMPT_COOLDOWN.toFixed(0) + " s cooldown after the last attempt: ignored" }));
        }
        this.openAt = null;
      }
      this.cand = null;
    }
    return out;
  };

  // rows: [{t, dark, below[, lit]}] -> every event, with the guard's quantisation on each row
  function runRows(machine, rows, guard) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var f = { dark: r.dark, below: r.below };
      if (!isNil(r.lit)) f.lit = r.lit;
      f._interval_frames = guard ? guard.check(r.t) : null;
      var ev = machine.feed(r.t, f);
      for (var j = 0; j < ev.length; j++) out.push(ev[j]);
    }
    return out;
  }

  // ---- prediction (the engine: the table with the calibrated lag) ----------------------------
  function assumes(methodology) { return "this prediction assumes methodology " + methodology; }
  function predictGen1(attempt, table, lagFrames, methodology, detector, sets) {
    var G = root.ShinyGen1Tid;
    var raw = attempt.raw;
    var off = Math.round(raw - lagFrames);
    var tid = table[off];
    var p = { kind: "prediction", t: attempt.t, methodology: methodology, detector: detector, mode: MODE_STAMP, tool: TOOL, assumes: assumes(methodology),
      lag_frames: round(lagFrames, 4), quantisation_frames: isNil(attempt.quantisation_frames) ? null : attempt.quantisation_frames, raw: round(raw, 4), offset: off,
      tid: isNil(tid) ? null : tid, in_table: !isNil(tid), hold: attempt.hold, hold_note: attempt.hold_note };
    if (!isNil(tid)) {
      p.verdict = G && sets ? G.verdict(tid, sets) : null;
      p.tid_text = G ? G.formatTid(tid) : String(tid);
      p.neighbours = {};
      if (!isNil(table[off - 1])) p.neighbours[String(off - 1)] = table[off - 1];
      if (!isNil(table[off + 1])) p.neighbours[String(off + 1)] = table[off + 1];
    } else {
      p.verdict = null;
      p.verdict_text = "outside the table: pressed too late, or the attempt broke the methodology";
    }
    if (!isNil(p.quantisation_frames) && p.quantisation_frames > 0.5) p.warning = "measured at " + p.quantisation_frames.toFixed(2) + " game frames per sample: the offset is uncertain by about +-" + Math.round(p.quantisation_frames);
    return p;
  }

  // ---- calibration in the PRACTICE namespace only ----------------------------------------------
  var LAG_MAX_FRAMES = 60.0;
  function calStoreKey(MODE) { return MODE.storeKey(STORE_KEY, MODE.PRACTICE); }
  function lagSamples(store, console_, methodology, detector) {
    var st = (store[console_] || {}).samples || [];
    var kept = st.filter(function (s) { return s.methodology === methodology && s.detector === detector; });
    var rest = st.filter(function (s) { return !(s.methodology === methodology && s.detector === detector); });
    return { kept: kept, rest: rest };
  }
  function lagFrames(store, console_, methodology, detector) {
    var k = lagSamples(store, console_, methodology, detector).kept;
    if (!k.length) return 0.0;
    var s = 0; for (var i = 0; i < k.length; i++) s += k[i].lag;
    return s / k.length;
  }
  // a typed true Trainer ID for an attempt: the inverted offset (nearest the estimate when the ID collides),
  // the implied lag; refuses an ID not in the table and a lag beyond LAG_MAX_FRAMES
  function learn(store, console_, raw, trueTid, table, methodology, detector) {
    var G = root.ShinyGen1Tid;
    var hits = G.invert(table, trueTid);
    if (!hits.length) throw new Error(G.formatTid(trueTid) + " is not in this table: wrong console, or the attempt broke the methodology; nothing to calibrate on");
    var lagNow = lagFrames(store, console_, methodology, detector);
    var trueOff = G.nearestOffset(hits, raw - lagNow);
    var lag = raw - trueOff;
    if (Math.abs(lag) > LAG_MAX_FRAMES) throw new Error("an implied lag of " + lag.toFixed(0) + " frames is beyond the " + LAG_MAX_FRAMES + "-frame bound: not a detection lag");
    var sample = { raw: raw, true_offset: trueOff, true_tid: trueTid, lag: lag, methodology: methodology, detector: detector, mode: MODE_STAMP, tool: TOOL, when: new Date().toISOString() };
    if (!store[console_]) store[console_] = { samples: [] };
    if (!store[console_].samples) store[console_].samples = [];
    store[console_].samples.push(sample);
    store[console_].lag_frames = lagFrames(store, console_, methodology, detector);
    return sample;
  }

  // ---- the timeline CSV (the practice kit's format: t,btn_lit,game_diff,menu_dark,below_dark; a header per session) ----
  function parseTimelineCsv(text) {
    var sessions = [], header = null, lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parts = line.split(",");
      if (parts[0] === "t") { header = parts; sessions.push([]); continue; }
      if (!header || parts.length !== header.length) continue;
      var vals = parts.map(Number);
      if (vals.some(function (v) { return isNaN(v); })) continue;
      var row = { t: vals[0] };
      for (var j = 1; j < header.length; j++) row[header[j]] = vals[j];
      if (!isNil(row.menu_dark)) row.dark = row.menu_dark;
      if (!isNil(row.below_dark)) row.below = row.below_dark;
      if (!isNil(row.btn_lit)) row.lit = row.btn_lit;
      sessions[sessions.length - 1].push(row);
    }
    return sessions;
  }

  // ---- PNG (8-bit gray or RGB, non-interlaced) for the node replay source; the browser uses a canvas ----
  function decodePngGray(buf) {
    var zlib = require("zlib");
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error("not a PNG");
    var pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, idat = [];
    while (pos + 8 <= buf.length) {
      var len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
      else if (type === "IDAT") idat.push(data);
      else if (type === "IEND") break;
      pos += 12 + len;
    }
    if (bitDepth !== 8 || interlace !== 0) throw new Error("only 8-bit non-interlaced PNGs are decoded here (got depth " + bitDepth + ", interlace " + interlace + ")");
    var channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new Error("unsupported PNG colour type " + colorType);
    var raw = zlib.inflateSync(Buffer.concat(idat));
    var stride = width * channels, out = new Uint8Array(width * height);
    var prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (var y = 0; y < height; y++) {
      var ft = raw[y * (stride + 1)], off = y * (stride + 1) + 1;
      for (var i = 0; i < stride; i++) {
        var x = raw[off + i], a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0, v;
        if (ft === 0) v = x; else if (ft === 1) v = x + a; else if (ft === 2) v = x + b; else if (ft === 3) v = x + ((a + b) >> 1);
        else if (ft === 4) { var pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)); }
        else throw new Error("bad PNG filter " + ft);
        cur[i] = v & 255;
      }
      for (var xx = 0; xx < width; xx++) {
        var base = xx * channels;
        out[y * width + xx] = channels >= 3 ? Math.round((cur[base] * 299 + cur[base + 1] * 587 + cur[base + 2] * 114) / 1000) : cur[base];
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return { width: width, height: height, gray: out };
  }

  // frames.csv ('index,t[,extras]') + frame-NNNNNN.png -> [{index, t, extras, png (Buffer)}] (node only)
  function readPngSequence(dir) {
    var fs = require("fs"), path = require("path");
    var lines = fs.readFileSync(path.join(dir, "frames.csv"), "utf8").split(/\r?\n/).filter(function (l) { return l.trim(); });
    var header = lines[0].split(",");
    if (header[0] !== "index" || header[1] !== "t") throw new Error(dir + "/frames.csv: the header must start 'index,t'");
    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var parts = lines[i].split(",");
      var extras = {};
      for (var j = 2; j < header.length; j++) extras[header[j]] = Number(parts[j]);
      var index = parseInt(parts[0], 10);
      out.push({ index: index, t: Number(parts[1]), extras: extras, file: path.join(dir, "frame-" + String(index).padStart(6, "0") + ".png") });
    }
    return out;
  }

  // the whole pipeline over a PNG sequence (node): features per frame, events, predictions
  function replayPngSequence(dir, profileId, methodology, timing, table, lag, sets, opts) {
    var fs = require("fs");
    var o = opts || {};
    var entries = readPngSequence(dir);
    var machine = new Gen1MenuMachine(PROFILES[profileId], methodology, timing, { detector: profileId, source: require("path").basename(dir), holdCheck: true });
    var guard = new RateGuard({ undersampledOk: !!o.undersampledOk });
    var features = [], events = [];
    for (var i = 0; i < entries.length; i++) {
      var img = decodePngGray(fs.readFileSync(entries[i].file));
      var f = extractGen1(img.gray, img.width, img.height, profileId);
      for (var k in entries[i].extras) if (Object.prototype.hasOwnProperty.call(entries[i].extras, k)) f[k] = entries[i].extras[k];
      features.push({ index: entries[i].index, t: entries[i].t, dark: f.dark, below: f.below, lit: isNil(f.lit) ? 0.0 : f.lit });
      f._interval_frames = guard.check(entries[i].t);
      var ev = machine.feed(entries[i].t, f);
      for (var j = 0; j < ev.length; j++) events.push(ev[j]);
    }
    var attempts = events.filter(function (e) { return e.kind === "attempt"; });
    return { features: features, events: events, attempts: attempts, guard: guard,
      predictions: attempts.map(function (a) { return predictGen1(a, table, lag, methodology, profileId, sets); }) };
  }

  // the pipeline over a parsed timeline (feature rows), one fresh machine per session
  function replayTimeline(sessions, profileId, methodology, timing, table, lag, sets, opts) {
    var o = opts || {};
    return sessions.map(function (rows) {
      var machine = new Gen1MenuMachine(PROFILES[profileId], methodology, timing, { detector: profileId, source: o.source || "timeline", holdCheck: true });
      var guard = new RateGuard({ undersampledOk: !!o.undersampledOk });
      var events = runRows(machine, rows, guard);
      var attempts = events.filter(function (e) { return e.kind === "attempt"; });
      return { events: events, attempts: attempts, guard: guard, predictions: attempts.map(function (a) { return predictGen1(a, table, lag, methodology, profileId, sets); }) };
    });
  }

  // ---- the panel (DOM) ------------------------------------------------------------------------
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (children || []).forEach(function (c) { e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function mount() {
    var host = document.getElementById("hunt-panel");
    if (!host) return false;
    var MODE = root.ShinyMode, DATA = root.ShinyGen1Data, G = root.ShinyGen1Tid;
    host.innerHTML = "";
    var banner = el("div", { "class": "hunt-banner", text: "PRACTICE / HUNT: this panel READS THE CAPTURE (screenshots or a recording) to time the menu and the press. Never in a submitted run." });
    var status = el("p", { "class": "result", id: "hunt-status" });
    var log = el("pre", { id: "hunt-log" });
    var methLine = el("p", { id: "hunt-methodology" });
    host.appendChild(banner); host.appendChild(methLine); host.appendChild(status); host.appendChild(log);
    function say(s) { log.textContent += s + "\n"; }
    var profileId = "gba-hd/wholebox-v1", game = "red", platformKey = "gba-hd", methodology = "red/gba/hold-start-v1";
    var timing = TIMING[platformKey];
    methLine.textContent = assumes(methodology) + " (hold START inside frames " + timing.hold_lo_frame + "-" + timing.hold_hi_frame + ", the menu opens on " + timing.menu_frame + "); detector " + profileId + ".";
    if (!MODE || !MODE.isPractice()) {
      status.textContent = "PRACTICE / HUNT mode is off: turn it on with the switch above to use this panel. Nothing here runs in RUN mode.";
      return true;
    }
    var meth = DATA && DATA.methodologies ? DATA.methodologies[methodology] : null;
    var table = meth && G ? G.decodeTable(meth.table_data) : {};
    var sets = DATA && G ? (DATA.games[game].target_sets || []).map(function (k) { return G.makeTargetSet(k, DATA.target_sets[k]); }) : null;
    var storeKey = calStoreKey(MODE);
    var store = {};
    try { store = JSON.parse(root.localStorage.getItem(storeKey) || "{}"); } catch (e) { store = {}; }
    var lag = lagFrames(store, "gba", methodology, profileId);
    status.textContent = "calibration (practice store " + storeKey + "): " + (lagSamples(store, "gba", methodology, profileId).kept.length ? lag.toFixed(2) + " frames" : "none yet; predictions are offset until you type a true Trainer ID");
    var bridge = root.huntBridge || null;
    var controls = el("div", { "class": "row" });
    var replayBtn = el("button", { text: "Replay a PNG sequence (tests/fixtures/hunt)" });
    var obsBtn = el("button", { text: "Watch OBS (obs-websocket screenshots)" });
    obsBtn.disabled = !bridge;
    controls.appendChild(replayBtn); controls.appendChild(obsBtn);
    host.insertBefore(controls, status);
    var last = null;
    function handle(events) {
      events.forEach(function (e) {
        if (e.kind === "menu-open") say("menu open (box " + (e.dark * 100).toFixed(0) + "% dark): press A when you like");
        else if (e.kind === "notice") say("(" + e.text + ")");
        else if (e.kind === "refusal") say("REFUSED under " + e.methodology + ": " + e.reason);
        else if (e.kind === "attempt") {
          var p = predictGen1(e, table, lag, methodology, profileId, sets);
          last = p;
          say("offset " + p.offset + (p.tid === null ? " outside the table" : " -> TRAINER ID " + p.tid_text + " [" + p.verdict + "]") + " (raw " + p.raw.toFixed(1) + ", lag " + p.lag_frames.toFixed(2) + ")" + (p.warning ? " WARNING " + p.warning : ""));
          say("  " + p.assumes + "; hold " + p.hold);
        }
      });
    }
    var machine = null, guard = null;
    function reset(sourceName) { machine = new Gen1MenuMachine(PROFILES[profileId], methodology, timing, { detector: profileId, source: sourceName, holdCheck: true }); guard = new RateGuard({ undersampledOk: false }); }
    function feedFrame(gray, width, height, t, extras) {
      var f = extractGen1(gray, width, height, profileId);
      if (extras) for (var k in extras) if (Object.prototype.hasOwnProperty.call(extras, k)) f[k] = extras[k];
      try { f._interval_frames = guard.check(t); } catch (err) { say("REFUSED: " + err.message); return false; }
      handle(machine.feed(t, f));
      return true;
    }
    function grayFromImage(img) {
      var c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      var ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      var d = ctx.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height);
      for (var i = 0; i < out.length; i++) out[i] = Math.round((d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000);
      return { gray: out, width: c.width, height: c.height };
    }
    replayBtn.addEventListener("click", function () {
      if (!bridge) { say("no replay bridge: this page is not running inside the --with-hunt Electron build"); return; }
      bridge.listReplays().then(function (dirs) {
        if (!dirs.length) { say("no PNG sequences found beside the app"); return; }
        var dir = dirs[0];
        say("replaying " + dir);
        reset(dir);
        return bridge.openReplay(dir).then(function (id) {
          function step() {
            return bridge.nextFrame(id).then(function (fr) {
              if (!fr) { say("end of replay"); return bridge.close(id); }
              var img = new Image();
              return new Promise(function (resolve) { img.onload = resolve; img.src = "data:image/png;base64," + fr.png; }).then(function () {
                var g = grayFromImage(img);
                if (feedFrame(g.gray, g.width, g.height, fr.t, fr.extras)) return step();
              });
            });
          }
          return step();
        });
      }).catch(function (err) { say("replay failed: " + err.message); });
    });
    obsBtn.addEventListener("click", function () {
      if (!bridge) return;
      say("connecting to OBS is done through the main process (ws) and only after you confirm in the dialog; not exercised by any test");
      bridge.openObs({ confirmLive: root.confirm("Connect to a LIVE OBS (practice only, never during a submitted run)?") }).then(function (id) {
        reset("obs");
        function step() { return bridge.nextFrame(id).then(function (fr) { if (!fr) return; var img = new Image(); return new Promise(function (r) { img.onload = r; img.src = "data:image/png;base64," + fr.png; }).then(function () { var g = grayFromImage(img); if (feedFrame(g.gray, g.width, g.height, fr.t, null)) return step(); }); }); }
        return step();
      }).catch(function (err) { say("OBS: " + err.message); });
    });
    var calRow = el("div", { "class": "row" });
    var tidIn = el("input", { type: "text", placeholder: "true Trainer ID of the last attempt" });
    var calBtn = el("button", { text: "Calibrate from this Trainer ID" });
    calRow.appendChild(tidIn); calRow.appendChild(calBtn);
    host.insertBefore(calRow, status);
    calBtn.addEventListener("click", function () {
      if (!last) { say("no attempt yet"); return; }
      try {
        var tid = G.parseTid(tidIn.value);
        var s = learn(store, "gba", last.raw, tid, table, methodology, profileId);
        lag = lagFrames(store, "gba", methodology, profileId);
        root.localStorage.setItem(storeKey, JSON.stringify(store));
        say("true offset " + s.true_offset + "; this attempt implies lag " + s.lag.toFixed(1) + " frames; mean now " + lag.toFixed(2) + " (saved under " + storeKey + ", mode " + s.mode + ")");
      } catch (err) { say(err.message); }
    });
    return true;
  }

  var api = {
    FPS: FPS, MENU_TO_TABLE_FRAMES: MENU_TO_TABLE_FRAMES, MENU_MIN_HOLD: MENU_MIN_HOLD, MENU_MIN_SPAN: MENU_MIN_SPAN, ATTEMPT_COOLDOWN: ATTEMPT_COOLDOWN,
    PRE_GAP_MIN: PRE_GAP_MIN, HOLD_LIT: HOLD_LIT, HOLD_LOOKBACK_S: HOLD_LOOKBACK_S, HOLD_SLACK_EARLY_S: HOLD_SLACK_EARLY_S, HOLD_SLACK_LATE_S: HOLD_SLACK_LATE_S,
    MIN_SAMPLES_PER_GAME_FRAME: MIN_SAMPLES_PER_GAME_FRAME, GUARD_WINDOW: GUARD_WINDOW, MODE_STAMP: MODE_STAMP, TOOL: TOOL, STORE_KEY: STORE_KEY,
    PROFILES: PROFILES, TIMING: TIMING, extractGen1: extractGen1, RateGuard: RateGuard, SampleRateError: SampleRateError,
    Gen1MenuMachine: Gen1MenuMachine, runRows: runRows, predictGen1: predictGen1, assumes: assumes,
    calStoreKey: calStoreKey, lagSamples: lagSamples, lagFrames: lagFrames, learn: learn,
    parseTimelineCsv: parseTimelineCsv, decodePngGray: decodePngGray, readPngSequence: readPngSequence,
    replayPngSequence: replayPngSequence, replayTimeline: replayTimeline, mount: mount
  };
  root.ShinyHunt = api;
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  }
})(typeof window !== "undefined" ? window : globalThis);
