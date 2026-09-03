(function () {
  var core = window.ShinyCore;
  var gen4 = window.ShinyGen4;
  var gen12 = window.ShinyGen12;
  var SEED = core.DEAD_BATTERY_SEED_RS;
  var MODE = window.ShinyMode;                 // webapp/mode.js: RUN by default, PRACTICE / HUNT explicit

  function $(id) {
    return document.getElementById(id);
  }

  // The Gen 3 timer's correction per kind ("tid" | "starter") and the Gen 4 calibrated delay are
  // kept under the mode in force (mode.js storeKey: RUN keys unchanged, PRACTICE / HUNT keys end
  // in ".practice"), so a value learned in PRACTICE / HUNT is never the one a run uses.
  function calKey(kind) {
    return MODE.storeKey("shinySolution.cal." + kind, MODE.get());
  }
  var G4_CALD_KEY = "shinySolution.g4.cald";
  function g4CaldKey() { return MODE.storeKey(G4_CALD_KEY, MODE.get()); }
  function modeTag() { return " [" + MODE.label(MODE.get()) + " mode]"; }

  function getCal(kind) {
    var v = parseFloat(localStorage.getItem(calKey(kind)));
    return isNaN(v) ? 0 : v;
  }

  function setCal(kind, v) {
    localStorage.setItem(calKey(kind), String(v));
  }

  function fillNatures(sel, withAny) {
    core.NATURES.forEach(function (n, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = n;
      sel.appendChild(o);
    });
  }

  function switchTab(name) {
    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.id === "tab-" + name);
    });
  }

  function renderTable(container, headers, rows, onPick) {
    var html = "<table><tr>";
    headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
    html += "</tr>";
    rows.forEach(function (r, i) {
      html += '<tr class="pick" data-i="' + i + '">';
      r.cells.forEach(function (c) { html += "<td>" + c + "</td>"; });
      html += "</tr>";
    });
    html += "</table>";
    container.innerHTML = html;
    container.querySelectorAll("tr.pick").forEach(function (tr) {
      tr.addEventListener("click", function () {
        container.querySelectorAll("tr").forEach(function (x) { x.classList.remove("selected"); });
        tr.classList.add("selected");
        if (onPick) onPick(rows[Number(tr.dataset.i)]);
      });
    });
  }

  function ivText(ivs) {
    return ivs.hp + "/" + ivs.atk + "/" + ivs.def + "/" + ivs.spa + "/" + ivs.spd + "/" + ivs.spe;
  }

  var audio = null;

  function ensureAudio() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    return audio;
  }

  function beepAt(ctx, atSeconds, freq, durMs, nodes) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.4, atSeconds);
    gain.gain.setValueAtTime(0, atSeconds + durMs / 1000);
    osc.start(atSeconds);
    osc.stop(atSeconds + durMs / 1000 + 0.05);
    nodes.push(osc);
  }

  function Countdown(displayEl, phaseEl) {
    this.display = displayEl;
    this.phaseEl = phaseEl;
    this.running = false;
    this.nodes = [];
    this.raf = 0;
    this.phases = [];
  }

  Countdown.prototype.start = function (phases) {
    if (this.running) return;
    var self = this;
    this.phases = phases;
    this.running = true;
    this.t0 = performance.now();
    var ctx = ensureAudio();
    Promise.resolve(ctx.state === "suspended" ? ctx.resume() : null).then(function () {
      if (!self.running) return;
      var elapsed = performance.now() - self.t0;
      var base = ctx.currentTime + 0.02;
      var acc = 0;
      for (var p = 0; p < phases.length; p++) {
        acc += phases[p];
        var isLast = p === phases.length - 1;
        if (isLast) {
          for (var s = 5; s >= 1; s--) {
            var t = base + (acc - elapsed - s * 1000) / 1000;
            if (t > base) beepAt(ctx, t, 880, 70, self.nodes);
          }
        }
        var end = base + (acc - elapsed) / 1000;
        beepAt(ctx, Math.max(end, base), isLast ? 1320 : 1100, isLast ? 280 : 180, self.nodes);
      }
    });
    this.tick();
  };

  Countdown.prototype.tick = function () {
    var self = this;
    var elapsed = performance.now() - this.t0;
    var acc = 0;
    for (var p = 0; p < this.phases.length; p++) {
      acc += this.phases[p];
      if (elapsed < acc) {
        this.display.textContent = core.fmtMs(acc - elapsed);
        if (this.phaseEl) this.phaseEl.textContent = this.phases.length > 1 ? "phase " + (p + 1) + " of " + this.phases.length : "";
        this.display.classList.toggle("soon", acc - elapsed < 5500 && p === this.phases.length - 1);
        this.raf = requestAnimationFrame(function () { self.tick(); });
        return;
      }
    }
    this.display.textContent = "00:00.000";
    this.display.classList.remove("soon");
    this.running = false;
  };

  Countdown.prototype.cancel = function (idleText) {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.nodes.forEach(function (n) {
      try { n.stop(); } catch (e) {}
    });
    this.nodes = [];
    this.display.classList.remove("soon");
    if (idleText !== undefined) this.display.textContent = idleText;
  };

  var g3state = { mode: null, target: null };
  var g3timer = null;

  function g3TotalMs(mode, advance) {
    return core.advancesToMs(advance) + getCal(mode);
  }

  function loadG3Target(mode, target, info) {
    g3state.mode = mode;
    g3state.target = target;
    if (g3timer) g3timer.cancel(core.fmtMs(g3TotalMs(mode, target.advance)));
    var panel = $("g3-timer-panel");
    panel.classList.remove("hidden");
    $("g3-info").textContent = info + "  |  press at " + core.fmtMs(g3TotalMs(mode, target.advance)) + " after power-on";
    $("g3-display").textContent = core.fmtMs(g3TotalMs(mode, target.advance));
    $("g3-cal-value").textContent = Math.round(getCal(mode));
  }

  function searchTidTargets() {
    var target = Number($("tid-target").value);
    var minutes = Number($("tid-minutes").value);
    var hits = core.searchTid(SEED, 0, target, { maxAdvance: core.msToAdvances(minutes * 60000), limit: 12 });
    if (!hits.length) {
      $("tid-results").innerHTML = "<p class='result'>No hit for TID " + target + " within " + minutes + " minutes.</p>";
      return;
    }
    renderTable($("tid-results"), ["Press at", "TID", "SID", "Advance"], hits.map(function (h) {
      return { data: h, cells: [core.fmtMs(g3TotalMs("tid", h.advance)), h.tid, h.sid, h.advance] };
    }), function (row) {
      loadG3Target("tid", row.data, "TID " + row.data.tid + " / SID " + row.data.sid);
    });
  }

  function searchStarterTargets() {
    var tid = Number($("st-tid").value);
    var sid = Number($("st-sid").value);
    if ($("st-tid").value === "" || $("st-sid").value === "") {
      $("st-results").innerHTML = "<p class='result'>Enter your TID and SID first (run the TID flow once to learn the SID).</p>";
      return;
    }
    var natureVal = $("st-nature").value;
    var startAdv = core.msToAdvances(Number($("st-min-minutes").value) * 60000);
    var maxAdv = startAdv + core.msToAdvances(Number($("st-minutes").value) * 60000);
    var hits = core.searchStarter(core.jump(SEED, startAdv), startAdv, tid, sid, {
      maxAdvance: maxAdv,
      limit: 12,
      nature: natureVal === "" ? null : Number(natureVal),
      gender: $("st-gender").value || null,
      genderThreshold: 31,
      minIv: Number($("st-miniv").value)
    });
    if (!hits.length) {
      $("st-results").innerHTML = "<p class='result'>No match in that window — relax the filters.</p>";
      return;
    }
    renderTable($("st-results"), ["Press at", "Nature", "Gender", "IVs", "PID", "Advance"], hits.map(function (h) {
      return {
        data: h,
        cells: [core.fmtMs(g3TotalMs("starter", h.advance)), h.natureName, core.genderChar(h.genderValue, 31),
          ivText(h.ivs), "<span class='mono'>" + ("0000000" + h.pid.toString(16).toUpperCase()).slice(-8) + "</span>", h.advance]
      };
    }), function (row) {
      loadG3Target("starter", row.data, row.data.natureName + " " + core.genderChar(row.data.genderValue, 31) + " " + ivText(row.data.ivs));
    });
  }

  function calibrateTid() {
    if (!g3state.target || g3state.mode !== "tid") {
      $("tid-cal-result").textContent = "Pick a target and run an attempt first.";
      return;
    }
    var raw = $("tid-got").value;
    var got = Number(raw);
    if (raw === "" || isNaN(got) || got < 0 || got > 65535) {
      $("tid-cal-result").textContent = "Enter the TID you actually got (0-65535).";
      return;
    }
    var center = g3state.target.advance;
    var from = Math.max(0, center - 6000);
    var candidates = core.findByTid(core.jump(SEED, from), from, got, null, center + 6000);
    var hit = core.nearestAdvance(candidates, center);
    if (!hit) {
      $("tid-cal-result").textContent = "TID " + got + " not found within ±6000 advances of the target.";
      return;
    }
    var drift = hit.advance - center;
    setCal("tid", getCal("tid") - core.advancesToMs(drift));
    $("tid-cal-result").textContent = "Landed at advance " + hit.advance + " (" + (drift >= 0 ? "+" : "") + drift +
      " frames). Timer corrected. That save's SID is " + hit.sid + "." + modeTag();
    searchTidTargets();
    loadG3Target("tid", g3state.target, "TID " + g3state.target.tid + " / SID " + g3state.target.sid);
  }

  function calibrateStarter() {
    if (!g3state.target || g3state.mode !== "starter") {
      $("st-cal-result").textContent = "Pick a target and run an attempt first.";
      return;
    }
    var nature = Number($("st-got-nature").value);
    var gender = $("st-got-gender").value;
    var statKeys = ["hp", "atk", "def", "spa", "spd", "spe"];
    var given = {};
    var haveStats = false;
    statKeys.forEach(function (k) {
      var v = $("st-got-" + k).value;
      if (v !== "") {
        given[k] = Number(v);
        haveStats = true;
      }
    });
    var center = g3state.target.advance;
    var from = Math.max(0, center - 3000);
    var candidates = core.findByMon(core.jump(SEED, from), from, center + 3000, nature, gender, 31);
    var filtered = candidates;
    if (haveStats) {
      var base = core.STARTERS_RS[$("st-species").value];
      filtered = candidates.filter(function (c) {
        var stats = core.statsAtLevel(base, c.ivs, 5, c.nature);
        return statKeys.every(function (k) {
          return given[k] === undefined || stats[k] === given[k];
        });
      });
    }
    var hit = core.nearestAdvance(filtered, center);
    if (!hit) {
      $("st-cal-result").textContent = haveStats
        ? "Nothing nearby matches that nature/gender/stat combination."
        : "No " + core.NATURES[nature] + " " + gender + " within ±3000 advances.";
      return;
    }
    var drift = hit.advance - center;
    setCal("starter", getCal("starter") - core.advancesToMs(drift));
    var note = haveStats ? filtered.length + " stat-consistent candidate(s)." :
      "WARNING: " + candidates.length + " candidates on nature/gender alone — enter the six stats for a reliable fix.";
    $("st-cal-result").textContent = "Match at advance " + hit.advance + " (" + (drift >= 0 ? "+" : "") + drift + " frames). " + note + modeTag();
    searchStarterTargets();
  }

  function checkPid() {
    var pid = parseInt($("ck-pid").value, 16) >>> 0;
    if (isNaN(pid)) {
      $("ck-result").textContent = "Enter the PID as hex.";
      return;
    }
    var tid = Number($("ck-tid").value);
    var sid = Number($("ck-sid").value);
    var shiny = core.isShiny(pid, tid, sid);
    $("ck-result").textContent = "PID " + ("0000000" + pid.toString(16).toUpperCase()).slice(-8) +
      ": nature " + core.NATURES[pid % 25] + ", gender value " + (pid & 255) +
      " — " + (shiny ? "SHINY for TID " + tid + " / SID " + sid + "!" : "not shiny for TID " + tid + " / SID " + sid + ".");
  }

  function runMethod1() {
    var seed = parseInt($("m1-seed").value, 16) >>> 0;
    if (isNaN(seed)) {
      $("m1-results").innerHTML = "<p class='result'>Enter the seed as hex.</p>";
      return;
    }
    var adv = Number($("m1-adv").value);
    var count = Math.min(50, Number($("m1-count").value));
    var rows = [];
    var s = core.jump(seed, adv);
    for (var i = 0; i < count; i++) {
      var mon = core.method1(s);
      rows.push({ cells: [adv + i, ("0000000" + mon.pid.toString(16).toUpperCase()).slice(-8), mon.natureName, core.genderChar(mon.genderValue, 31), ivText(mon.ivs)] });
      s = core.next(s);
    }
    renderTable($("m1-results"), ["Advance", "PID", "Nature", "Gender", "IVs"], rows, null);
  }

  function g4DateParts(id) {
    var v = $(id).value;
    var m = v.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)(?::(\d+))?/);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0) };
  }

  function g4Calc() {
    var d = g4DateParts("g4-date");
    if (!d) return;
    var seed = gen4.seed(d.y, d.mo, d.d, d.h, d.mi, d.s, Number($("g4-delay").value));
    var ids = gen4.tidSid(seed);
    $("g4-calc-out").textContent = "seed " + ("0000000" + seed.toString(16).toUpperCase()).slice(-8) +
      "  |  TID " + ids.tid + " / SID " + ids.sid +
      "  |  coin flips " + gen4.coinFlips(seed, 10) +
      "  |  Elm " + gen4.elmCalls(seed, 10, Number($("g4-skips").value));
  }

  var g4state = { second: -1, delay: 0, seed: 0 };
  var g4timer = null;

  function g4TidSearch() {
    var d = g4DateParts("g4-tdate");
    if (!d) return;
    var hits = gen4.searchTid(Number($("g4-tid").value), d.y, d.mo, d.d, d.h, d.mi,
      Number($("g4-dmin").value), Number($("g4-dmax").value), 20);
    if (!hits.length) {
      $("g4-tid-results").innerHTML = "<p class='result'>No seed in that window yields the target TID — widen the delay range.</p>";
      return;
    }
    renderTable($("g4-tid-results"), ["Second", "Delay", "Seed", "TID", "SID"], hits.map(function (h) {
      return { data: h, cells: [h.second, h.delay, ("0000000" + h.seed.toString(16).toUpperCase()).slice(-8), h.tid, h.sid] };
    }), function (row) {
      var h = row.data;
      g4state.second = h.second;
      g4state.delay = h.delay;
      g4state.seed = h.seed;
      $("g4-shseed").value = ("0000000" + h.seed.toString(16).toUpperCase()).slice(-8);
      $("g4-shtid").value = h.tid;
      $("g4-shsid").value = h.sid;
      $("g4-target-info").textContent = "target: boot second " + h.second + ", delay " + h.delay +
        ", seed " + ("0000000" + h.seed.toString(16).toUpperCase()).slice(-8) + " (TID " + h.tid + " / SID " + h.sid + ")";
      var mb = gen4.minutesBefore(h.delay, h.second);
      $("g4-clock-note").textContent = "Set the DS clock " + mb + " minute(s) BEFORE the target minute — the countdown spans that long, so the A press lands inside the target minute.";
      g4Idle();
    });
  }

  function g4ShinySearch() {
    var seed = parseInt($("g4-shseed").value, 16) >>> 0;
    if (isNaN(seed)) {
      $("g4-sh-results").innerHTML = "<p class='result'>Enter a hex seed (or load a TID target).</p>";
      return;
    }
    var natureVal = $("g4-shnature").value;
    var hits = gen4.searchShinyFromSeed(seed, Number($("g4-shtid").value), Number($("g4-shsid").value),
      Number($("g4-shmin").value), Number($("g4-shmax").value),
      { nature: natureVal === "" ? null : Number(natureVal), gender: null, minIv: 0 }, 15);
    if (!hits.length) {
      $("g4-sh-results").innerHTML = "<p class='result'>No shiny in that advance range.</p>";
      return;
    }
    renderTable($("g4-sh-results"), ["Advance", "PID", "Nature", "Gender", "IVs"], hits.map(function (m) {
      return { cells: [m.advance, ("0000000" + m.pid.toString(16).toUpperCase()).slice(-8), m.natureName, core.genderChar(m.genderValue, 31), ivText(m.ivs)] };
    }), null);
  }

  function g4Phases() {
    return gen4.timerPhases(g4state.delay, g4state.second, Number($("g4-cald").value), Number($("g4-cals").value));
  }

  function g4Idle() {
    if (g4state.second < 0) return;
    var p = g4Phases();
    $("g4-phase").textContent = "phase 1: " + core.fmtMs(p.phase1Ms) + "   phase 2: " + core.fmtMs(p.phase2Ms);
    $("g4-display").textContent = core.fmtMs(p.phase1Ms + p.phase2Ms);
  }

  function g4Start() {
    if (g4state.second < 0 || (g4timer && g4timer.running)) return;
    var p = g4Phases();
    if (p.phase2Ms <= 0) {
      $("g4-phase").textContent = "phase 2 is not positive — check the calibration values";
      return;
    }
    g4timer.start([p.phase1Ms, p.phase2Ms]);
  }

  function g4Calibrate() {
    if (g4state.second < 0) {
      $("g4-cal-result").textContent = "load a target first";
      return;
    }
    var hit = Number($("g4-hit").value);
    var next = gen4.calibrate(Number($("g4-cald").value), g4state.delay, hit);
    $("g4-cald").value = Math.round(next * 10) / 10;
    localStorage.setItem(g4CaldKey(), String(next));
    $("g4-cal-result").textContent = "calibrated delay is now " + (Math.round(next * 10) / 10) + modeTag();
    g4Idle();
  }

  function g4Match() {
    if (g4state.second < 0) {
      $("g4-match-result").textContent = "load a TID target first so the search has a center";
      return;
    }
    var d = g4DateParts("g4-tdate");
    var width = Number($("g4-fwidth").value);
    var lo = Math.max(0, g4state.delay - width);
    var hi = Math.min(65535, g4state.delay + width);
    var hits = gen4.matchCoinFlips($("g4-flips").value, d.y, d.mo, d.d, d.h, d.mi,
      g4state.second, Number($("g4-frad").value), lo, hi, 10);
    if (!hits.length) {
      $("g4-match-result").textContent = "no candidate seed matches those flips in the window";
      return;
    }
    var best = hits.slice().sort(function (a, b) {
      return Math.abs(a.delay - g4state.delay) - Math.abs(b.delay - g4state.delay);
    })[0];
    $("g4-hit").value = best.delay;
    $("g4-match-result").textContent = hits.length + " candidate(s); nearest: second " + best.second +
      ", delay " + best.delay + ". Hit delay filled in — click Calibrate from hit.";
  }

  function dvCheck() {
    var atk = Number($("dv-atk").value), def = Number($("dv-def").value);
    var spe = Number($("dv-spe").value), spc = Number($("dv-spc").value);
    var shiny = gen12.isShinyDvs(atk, def, spe, spc);
    $("dv-result").textContent = "DVs " + atk + "/" + def + "/" + spe + "/" + spc +
      " (word " + ("000" + gen12.pack(atk, def, spe, spc).toString(16).toUpperCase()).slice(-4) + "): " +
      (shiny ? "SHINY in Gen 2 (and shiny-when-traded from Gen 1)." : "not shiny.");
  }

  function injectG3Timer() {
    var panel = document.createElement("div");
    panel.className = "card hidden";
    panel.id = "g3-timer-panel";
    panel.innerHTML = '<h2>Timer — click Start at the exact instant you power on; press A on the long beep</h2>' +
      '<p id="g3-info"></p><div id="g3-display" class="bigtime">--:--.---</div>' +
      '<div class="row"><button id="g3-start">Start at power-on (Space)</button>' +
      '<button id="g3-cancel">Cancel</button>' +
      '<span>calibration: <span id="g3-cal-value">0</span> ms</span>' +
      '<button id="g3-cal-reset">reset</button></div>';
    var anchor = $("tid-results").parentElement;
    anchor.parentElement.insertBefore(panel, anchor.nextSibling);
    g3timer = new Countdown($("g3-display"), null);
    $("g3-start").addEventListener("click", function () {
      if (!g3state.target || g3timer.running) return;
      var total = g3TotalMs(g3state.mode, g3state.target.advance);
      if (total <= 0) {
        $("g3-info").textContent = "Target time is not in the future — reset the calibration.";
        return;
      }
      g3timer.start([total]);
    });
    $("g3-cancel").addEventListener("click", function () {
      if (g3state.target) g3timer.cancel(core.fmtMs(g3TotalMs(g3state.mode, g3state.target.advance)));
    });
    $("g3-cal-reset").addEventListener("click", function () {
      if (!g3state.mode) return;
      setCal(g3state.mode, 0);
      $("g3-cal-value").textContent = "0";
      if (g3state.mode === "tid") searchTidTargets();
      else searchStarterTargets();
      loadG3Target(g3state.mode, g3state.target, $("g3-info").textContent.split("  |")[0]);
    });
    document.addEventListener("keydown", function (e) {
      if (e.code === "Space" && g3state.target && document.activeElement.tagName !== "INPUT" &&
          document.getElementById("tab-g3timer").classList.contains("active")) {
        e.preventDefault();
        if (g3timer.running) g3timer.cancel(core.fmtMs(g3TotalMs(g3state.mode, g3state.target.advance)));
        else $("g3-start").click();
      }
    });
  }

  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.dataset.tab); });
  });
  fillNatures($("st-nature"));
  fillNatures($("st-got-nature"));
  fillNatures($("g4-shnature"));
  injectG3Timer();
  $("tid-search").addEventListener("click", searchTidTargets);
  $("st-search").addEventListener("click", searchStarterTargets);
  $("tid-calibrate").addEventListener("click", calibrateTid);
  $("st-calibrate").addEventListener("click", calibrateStarter);
  $("ck-check").addEventListener("click", checkPid);
  $("m1-run").addEventListener("click", runMethod1);
  $("g4-calc").addEventListener("click", g4Calc);
  $("g4-tid-search").addEventListener("click", g4TidSearch);
  $("g4-sh-search").addEventListener("click", g4ShinySearch);
  $("g4-start").addEventListener("click", g4Start);
  $("g4-cancel").addEventListener("click", function () { g4Idle(); if (g4timer) g4timer.cancel(); g4Idle(); });
  $("g4-calibrate").addEventListener("click", g4Calibrate);
  $("g4-match").addEventListener("click", g4Match);
  $("dv-check").addEventListener("click", dvCheck);
  g4timer = new Countdown($("g4-display"), $("g4-phase"));
  function loadG4Cald() {
    var savedCald = parseFloat(localStorage.getItem(g4CaldKey()));
    $("g4-cald").value = isNaN(savedCald) ? 500 : Math.round(savedCald * 10) / 10;
  }
  loadG4Cald();
  // a mode change swaps every store: the Gen 3 correction and the Gen 4 delay are re-read from the mode's own
  MODE.subscribe(function () {
    loadG4Cald();
    $("g4-cal-result").textContent = "";
    if (g3state.target) {
      if (g3state.mode === "tid") searchTidTargets(); else searchStarterTargets();
      loadG3Target(g3state.mode, g3state.target, $("g3-info").textContent.split("  |")[0]);
    }
  });
  if (window.SHINY_SOLUTION_DOWNLOADS) {
    $("dl-win").href = window.SHINY_SOLUTION_DOWNLOADS.win;
    $("dl-linux").href = window.SHINY_SOLUTION_DOWNLOADS.linux;
    $("dl-mac").href = window.SHINY_SOLUTION_DOWNLOADS.mac;
  }
  if (window.SHINY_SOLUTION_VERSION) {
    $("about-version").textContent = "version " + window.SHINY_SOLUTION_VERSION;
  }
})();
