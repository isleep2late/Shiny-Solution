(function () {
  var core = window.ShinyCore;
  var SEED = core.DEAD_BATTERY_SEED_RS;

  var state = {
    mode: null,
    target: null,
    running: false,
    t0: 0,
    raf: 0,
    audio: null,
    beepNodes: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  function calKey(mode) {
    return "shinySolution.cal." + mode;
  }

  function getCal(mode) {
    var v = parseFloat(localStorage.getItem(calKey(mode)));
    return isNaN(v) ? 0 : v;
  }

  function setCal(mode, v) {
    localStorage.setItem(calKey(mode), String(v));
    if (state.mode === mode) $("cal-value").textContent = Math.round(v);
  }

  function fillNatures() {
    core.NATURES.forEach(function (n, i) {
      var o1 = document.createElement("option");
      o1.value = String(i);
      o1.textContent = n;
      $("st-nature").appendChild(o1);
      var o2 = o1.cloneNode(true);
      $("st-got-nature").appendChild(o2);
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

  function targetTimeMs(mode, advance) {
    return core.advancesToMs(advance) + getCal(mode);
  }

  function loadTarget(mode, target, title, info) {
    state.mode = mode;
    state.target = target;
    state.title = title;
    state.info = info;
    cancelTimer();
    $("timer-panel").classList.remove("hidden");
    $("timer-title").textContent = title;
    $("timer-info").textContent = info + "  |  press at " + core.fmtMs(targetTimeMs(mode, target.advance)) + " after power-on";
    $("timer-display").textContent = core.fmtMs(targetTimeMs(mode, target.advance));
    $("cal-value").textContent = Math.round(getCal(mode));
    $("timer-panel").scrollIntoView({ behavior: "smooth" });
  }

  function beep(atSeconds, freq, durMs) {
    var ctx = state.audio;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.4, atSeconds);
    gain.gain.setValueAtTime(0, atSeconds + durMs / 1000);
    osc.start(atSeconds);
    osc.stop(atSeconds + durMs / 1000 + 0.05);
    state.beepNodes.push(osc);
  }

  function startTimer() {
    if (!state.target || state.running) return;
    var totalMs = targetTimeMs(state.mode, state.target.advance);
    if (totalMs <= 0) {
      $("timer-info").textContent = "Target time is not in the future — pick a later target or reset the calibration offset.";
      return;
    }
    state.running = true;
    state.t0 = performance.now();
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = state.audio;
    Promise.resolve(ctx.state === "suspended" ? ctx.resume() : null).then(function () {
      if (!state.running) return;
      var elapsed = performance.now() - state.t0;
      var base = ctx.currentTime + 0.02;
      for (var s = 5; s >= 1; s--) {
        var t = base + (totalMs - elapsed - s * 1000) / 1000;
        if (t > base) beep(t, 880, 70);
      }
      var fin = base + (totalMs - elapsed) / 1000;
      beep(Math.max(fin, base), 1320, 280);
    });
    tick();
  }

  function tick() {
    var totalMs = targetTimeMs(state.mode, state.target.advance);
    var left = totalMs - (performance.now() - state.t0);
    var d = $("timer-display");
    if (left <= 0) {
      d.textContent = "00:00.000";
      d.classList.remove("soon");
      d.classList.add("go");
      state.running = false;
      return;
    }
    d.textContent = core.fmtMs(left);
    d.classList.toggle("soon", left < 5500);
    d.classList.remove("go");
    state.raf = requestAnimationFrame(tick);
  }

  function cancelTimer() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    state.beepNodes.forEach(function (n) {
      try { n.stop(); } catch (e) {}
    });
    state.beepNodes = [];
    var d = $("timer-display");
    d.classList.remove("soon", "go");
    if (state.target) d.textContent = core.fmtMs(targetTimeMs(state.mode, state.target.advance));
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
        onPick(rows[Number(tr.dataset.i)]);
      });
    });
  }

  function ivText(ivs) {
    return ivs.hp + "/" + ivs.atk + "/" + ivs.def + "/" + ivs.spa + "/" + ivs.spd + "/" + ivs.spe;
  }

  function searchTidTargets() {
    var target = Number($("tid-target").value);
    var minutes = Number($("tid-minutes").value);
    var maxAdv = core.msToAdvances(minutes * 60000);
    var hits = core.searchTid(SEED, 0, target, { maxAdvance: maxAdv, limit: 12 });
    if (!hits.length) {
      $("tid-results").innerHTML = "<p class='result'>No hit for TID " + target + " within " + minutes + " minutes. Widen the window.</p>";
      return;
    }
    var rows = hits.map(function (h) {
      return {
        data: h,
        cells: [core.fmtMs(targetTimeMs("tid", h.advance)), h.tid, h.sid, h.advance]
      };
    });
    renderTable($("tid-results"), ["Press at", "TID", "SID", "Advance"], rows, function (row) {
      loadTarget("tid", row.data, "TID Manip", "TID " + row.data.tid + " / SID " + row.data.sid);
    });
  }

  function searchStarterTargets() {
    var tid = Number($("st-tid").value);
    var sid = Number($("st-sid").value);
    if (isNaN(tid) || $("st-tid").value === "" || isNaN(sid) || $("st-sid").value === "") {
      $("st-results").innerHTML = "<p class='result'>Enter your TID and SID first. No SID? Run the TID Manip flow once, or read it out of your save with PKHaX.</p>";
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
      $("st-results").innerHTML = "<p class='result'>No match in that window. Relax the filters or widen the window.</p>";
      return;
    }
    var rows = hits.map(function (h) {
      return {
        data: h,
        cells: [
          core.fmtMs(targetTimeMs("starter", h.advance)),
          h.natureName,
          core.genderChar(h.genderValue, 31),
          ivText(h.ivs),
          "<span class='mono'>" + ("0000000" + h.pid.toString(16).toUpperCase()).slice(-8) + "</span>",
          h.advance
        ]
      };
    });
    renderTable($("st-results"), ["Press at", "Nature", "Gender", "IVs", "PID", "Advance"], rows, function (row) {
      loadTarget("starter", row.data, "Shiny Starter", row.data.natureName + " " + core.genderChar(row.data.genderValue, 31) + " " + ivText(row.data.ivs));
    });
  }

  function refreshTarget() {
    if (state.mode && state.target) loadTarget(state.mode, state.target, state.title, state.info);
  }

  function refreshTables(mode) {
    if (mode === "tid" && $("tid-results").querySelector("table")) searchTidTargets();
    if (mode === "starter" && $("st-results").querySelector("table")) searchStarterTargets();
  }

  function calibrateTid() {
    if (!state.target || state.mode !== "tid") {
      $("tid-cal-result").textContent = "Pick a target and run an attempt first.";
      return;
    }
    var raw = $("tid-got").value;
    var got = Number(raw);
    if (raw === "" || isNaN(got) || got < 0 || got > 65535) {
      $("tid-cal-result").textContent = "Enter the TID you actually got (0-65535) first.";
      return;
    }
    var center = state.target.advance;
    var radius = 6000;
    var candidates = core.findByTid(core.jump(SEED, Math.max(0, center - radius)), Math.max(0, center - radius), got, null, center + radius);
    var hit = core.nearestAdvance(candidates, center);
    if (!hit) {
      $("tid-cal-result").textContent = "TID " + got + " not found within ±" + radius + " advances of the target. Check the entry or restart the attempt.";
      return;
    }
    var driftAdv = hit.advance - center;
    setCal("tid", getCal("tid") - core.advancesToMs(driftAdv));
    $("tid-cal-result").textContent = "You landed at advance " + hit.advance + " (" + (driftAdv >= 0 ? "+" : "") + driftAdv +
      " frames). Timer corrected. That save's SID is " + hit.sid + " — if you keep it, use TID " + got + " / SID " + hit.sid + " in the Shiny Starter tab.";
    refreshTables("tid");
    refreshTarget();
  }

  function calibrateStarter() {
    if (!state.target || state.mode !== "starter") {
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
    var center = state.target.advance;
    var radius = 3000;
    var from = Math.max(0, center - radius);
    var candidates = core.findByMon(core.jump(SEED, from), from, center + radius, nature, gender, 31);
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
        ? "Nothing within ±" + radius + " advances matches that nature/gender/stat combination. Double-check the stats against the summary screen."
        : "No " + core.NATURES[nature] + " " + gender + " within ±" + radius + " advances. Double-check the entry.";
      return;
    }
    var driftAdv = hit.advance - center;
    setCal("starter", getCal("starter") - core.advancesToMs(driftAdv));
    var note = haveStats
      ? filtered.length + " stat-consistent candidate(s) in window."
      : "WARNING: " + candidates.length + " candidate(s) matched on nature/gender alone — enter the six summary-screen stats for a reliable fix.";
    $("st-cal-result").textContent = "Match at advance " + hit.advance + " (" + (driftAdv >= 0 ? "+" : "") + driftAdv +
      " frames). " + note + " Timer corrected — same target, try again.";
    refreshTables("starter");
    refreshTarget();
  }

  function loadCustom() {
    var adv = Number($("cu-advance").value);
    if (!adv || adv < 1) return;
    loadTarget("custom", { advance: adv }, "Custom Target", "advance " + adv);
  }

  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.dataset.tab); });
  });
  $("tid-search").addEventListener("click", searchTidTargets);
  $("st-search").addEventListener("click", searchStarterTargets);
  $("tid-calibrate").addEventListener("click", calibrateTid);
  $("st-calibrate").addEventListener("click", calibrateStarter);
  $("cu-load").addEventListener("click", loadCustom);
  $("timer-start").addEventListener("click", startTimer);
  $("timer-cancel").addEventListener("click", cancelTimer);
  $("cal-reset").addEventListener("click", function () {
    if (state.mode) {
      setCal(state.mode, 0);
      refreshTables(state.mode);
      refreshTarget();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && state.target && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      if (state.running) cancelTimer();
      else startTimer();
    }
  });

  fillNatures();
})();
