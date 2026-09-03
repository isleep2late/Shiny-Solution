// The Gen 2 Trainer ID / Lucky ID tab (TARGET mode: game -> console -> methodology -> RTC state ->
// target bin -> anchor -> protocol -> cue -> "What did you get?"), over core/gen2tid.js and
// core/data/gen2-tid.json, modelled on the Gen 1 tab (gen1tid-ui.js) and sharing its code where
// that tab exposes it: the cue player (one AudioContext, one pre-rendered buffer per schedule, the
// full-screen flash), the sample-exact renderer, the calibration store helpers over a methodology
// and a mode, the runner's timing text. The Gen 2 model differs where the engine does: the target is
// a 4-frame poll bin (0-598) relative to the VISIBLE menu box, three IDs per bin (TID, Lucky ID and
// Crystal's Secret ID), a Gold/Silver RTC state that selects the table, and calibration whose hit
// and aim are bin centres (the outlier guard is the engine's isOutlierBins, the duplicate guard is
// gen1tid's isDuplicate over the Gen 2 store; gen1tid's addSample is not used: its outlier guard
// checks whole-frame offsets and would refuse bin-centre samples).
//
// Every output names the methodology id and its validity conditions, and the tab says plainly that
// no hardware sample exists for any Gen 2 configuration and that the published Gold/Silver route
// IDs need their community scripts. Run mode is human input only: the anchor is your button press,
// the outcome is the Trainer ID (and Lucky ID) you type; nothing reads the game.
//
// The pure part is exported as ShinyGen2TidUi so tests can load it in node; the DOM part mounts only
// when the page has the tab.
(function (root) {
  var G = root.ShinyGen2Tid;
  var G1 = root.ShinyGen1Tid;
  var DATA = root.ShinyGen2TidData;
  var DATA1 = root.ShinyGen1Data;                                // the reset models (GSE's gbp-fade) live in the Gen 1 data
  var MODE = root.ShinyMode;                                     // webapp/mode.js: the RUN / PRACTICE-HUNT wall's switch
  var U1 = root.ShinyGen1TidUi;                                  // webapp/gen1tid-ui.js: the shared text, store and player code
  if (!MODE) throw new Error("webapp/mode.js (ShinyMode) must load before gen2tid-ui.js");
  if (!U1) throw new Error("webapp/gen1tid-ui.js (ShinyGen1TidUi) must load before gen2tid-ui.js");
  var STORE_KEY_CAL = "shinySolution.gen2tid.calibration";      // RUN mode: {"<platform>/<anchor>": {"samples": [...]}}; PRACTICE / HUNT: + ".practice" (calStoreKey)
  var METHODOLOGY_SENTENCE = U1.METHODOLOGY_SENTENCE;
  var RULES_LINE = "Run mode uses only your own input: you press the anchor button and type the Trainer ID (and the Lucky ID) you saw. Nothing reads the screen, the emulator or the console.";
  var NO_HARDWARE_LINE = "No hardware sample exists for any Gen 2 configuration: every table is emulator-derived (pokemon-speedrunning/gambatte-core with the real boot ROMs, community-script cross-validated on GBP). On a console the first attempts are a transfer test; on GSE / gambatte-speedrun in GBP mode the numbers are exact.";
  var DEFAULT_GAME = "gold";
  var DEFAULT_PLATFORM = "gse";
  var FPS = G.FPS;

  function isNil(x) { return x === null || x === undefined; }
  function f(x, d, plus) { return G1.pyFixed(x, d, plus); }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function fmtSf(seconds) { return U1.fmtSf(seconds); }
  function fmtMs(ms) { return U1.fmtMs(ms); }
  function hex4(n) { return G.hex(n, 4); }
  function fmtId(v) { return v + " ($" + hex4(v) + ")"; }
  function fmtLid(v) { return ("00000" + v).slice(-5) + " ($" + hex4(v) + ")"; }
  function framesToS(frames) { return frames / FPS; }
  function nowStamp() {
    var d = new Date();
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
  }

  // ---- storage (localStorage in a browser, memory elsewhere) ---------------------------
  // Under ?g2selftest (and under the Gen 1 tab's ?g1selftest, which shares the page) storage is
  // memory-only, so a self-test's recorded sample never lands in a visitor's real calibration.
  var mem = {};
  var MEMORY_ONLY = !!(root.location && typeof root.location.search === "string" &&
    (root.location.search.indexOf("g2selftest") !== -1 || root.location.search.indexOf("g1selftest") !== -1));
  function storageGet(key) {
    if (!MEMORY_ONLY) { try { if (root.localStorage) return root.localStorage.getItem(key); } catch (e) { /* private mode */ } }
    return isNil(mem[key]) ? null : mem[key];
  }
  function storageSet(key, value) {
    mem[key] = value;
    if (MEMORY_ONLY) return;
    try { if (root.localStorage) root.localStorage.setItem(key, value); } catch (e) { /* quota / private mode */ }
  }
  function loadJson(key, fallback) {
    var s = storageGet(key);
    if (!s) return fallback;
    try { var v = JSON.parse(s); return v && typeof v === "object" ? v : fallback; } catch (e) { return fallback; }
  }
  function saveJson(key, obj) { storageSet(key, JSON.stringify(obj)); }

  // ---- data resolution ------------------------------------------------------------------
  function supportedGames(data) {
    return Object.keys(data.games).filter(function (k) { return data.games[k].status === "supported"; });
  }
  // The methodologies a console offers under one game: the game's methodologies whose console family is
  // the console's; the default is the one on the console's own platform key (a DMG offers hold-start and
  // late-start, GSE / GBP / GBA the gbp table, a Game Boy Color the gbc table).
  function platformMethodologies(data, platformKey, gameKey) {
    var spec = data.platforms[platformKey];
    if (!spec) throw new Error("unknown platform " + platformKey);
    var g = data.games[gameKey] || {};
    var ids = (g.methodologies || []).filter(function (m) { return (data.methodologies[m] || {}).console_id === spec.family; });
    var def = null;
    ids.forEach(function (m) { if (def === null && data.methodologies[m].platform_key === spec.platform_key) def = m; });
    return { def: def || (ids.length ? ids[0] : null), ids: ids };
  }
  function platformsFor(data, gameKey) {
    return Object.keys(data.platforms).map(function (k) {
      var pm = platformMethodologies(data, k, gameKey);
      return { key: k, spec: data.platforms[k], def: pm.def, ids: pm.ids };
    }).filter(function (p) { return p.def; });
  }
  // The RTC states a game's tables come in: Gold / Silver the ten running and ten halted states, Crystal one.
  function stateOptions(data, gameKey) {
    var g = data.games[gameKey];
    if (!g.rtc_dependent) return [{ value: "days0", text: "days0: any clock (Crystal is immune to the RTC: one table)", reachable: true, family: "running" }];
    return G.stateIds(data, gameKey).map(function (st) {
      var info = data.rtc.states[st];
      return { value: st, text: st + ": " + info.label + (info.reachable_after_first_boot ? "" : "   [first boot only]"), reachable: !!info.reachable_after_first_boot, family: info.family };
    });
  }
  function stateLabel(data, gameKey, state) {
    if (!data.games[gameKey].rtc_dependent) return "days0 (any clock: Crystal is immune to the RTC)";
    var info = data.rtc.states[state];
    return state + " (" + info.label + (info.reachable_after_first_boot ? "; recurs boot after boot" : "; first boot only") + ")";
  }
  // The reachability rule, from the data: bracket and halted-clock states are first-boot only, after the
  // first boot only days0 and days512 remain; Crystal has one table.
  function reachabilityLines(data, gameKey) {
    var g = data.games[gameKey];
    if (!g.rtc_dependent) return ["RTC state: " + g.name + " is immune to the cartridge clock (" + data.rtc.crystal.split(";")[0] + "): one table per methodology, shown as state days0."];
    var prior = data.rtc.families.running.two_state_prior;
    var lines = ["RTC state (" + g.name + "): the MBC3 clock's day counter and halt bit select the table. Only " + prior.join(" and ") +
      " recur boot after boot: after the first boot no other state remains."];
    lines.push("  A 140-511-day bracket (" + data.rtc.families.running.states.filter(function (s) { return prior.indexOf(s) === -1; }).join(", ") + ") lasts ONE boot: " + data.rtc.states.days200.why + ".");
    lines.push("  A halted clock (" + data.rtc.families.halted.states.join(", ") + ") is a cartridge whose clock was halted and has not been booted since: " + data.rtc.states["halt-days0"].why.split(", so")[0] + ".");
    lines.push("  So a prediction in a bracket or halted state is first-boot only, and a typed outcome from a later boot is inverted under the two-state prior (" + prior.join(", ") + ").");
    lines.push("  " + data.rtc.on_cart);
    lines.push("  Dead battery: " + data.rtc.dead_battery);
    return lines;
  }
  // The published route IDs of a game: community-script target sets, not produced by the single-tap methodologies in days0.
  function scriptsLine(data, gameKey) {
    var g = data.games[gameKey], scripted = [];
    (g.target_sets || []).forEach(function (k) {
      var s = data.target_sets[k];
      if (s && s.protocol === "community-script") scripted.push(G.setDescribe(G.makeTargetSet(k, s)));
    });
    if (!scripted.length) return "No published route ID is defined for " + g.name + ".";
    return "The published route IDs for " + g.name + " (" + scripted.join("; ") + ") are NOT produced by this single-tap methodology in RTC state days0: they need their community multi-step scripts (target sets of protocol community-script), which are not tabulated here. " +
      "Where a single tap gives one of them in some other RTC state, the row below says so and names the state, which is first-boot only.";
  }

  function resolve(data, gameKey, platformKey, methodologyId, state, targetSetKeys, data1) {
    var spec = data.platforms[platformKey];
    if (!spec) throw new Error("unknown platform " + platformKey);
    var g = data.games[gameKey];
    if (!g || g.status !== "supported") throw new Error("no runnable methodology for " + gameKey);
    var pm = platformMethodologies(data, platformKey, gameKey);
    var mid = methodologyId || pm.def;
    if (!mid) throw new Error("no methodology is available on " + platformKey + " for " + gameKey);
    if (pm.ids.indexOf(mid) === -1) throw new Error("methodology " + mid + " is not available on " + platformKey + " for " + gameKey);
    var m = data.methodologies[mid];
    var states = G.stateIds(data, gameKey);
    var st = state || data.defaults.state;
    if (states.indexOf(st) === -1) {
      if (g.rtc_dependent) throw new Error("no RTC state " + st + " for " + gameKey);
      st = "days0";
    }
    var table = G.tableFor(data, gameKey, m.platform_key, st);
    var anchors = (spec.anchors || [G.ANCHOR_MENU]).filter(function (a) { return m.anchors.indexOf(a) !== -1; });
    if (!anchors.length) anchors = [G.ANCHOR_MENU];
    var d1 = data1 || DATA1;
    var resetModel = spec.reset && d1 && d1.reset_models ? d1.reset_models[spec.reset] : null;
    return {
      data: data, key: platformKey, name: spec.name, spec: spec, gameKey: gameKey, gameName: g.name || gameKey, game: g,
      familyKey: spec.family, family: data.families[spec.family], methodology: m, methodologyId: mid, methodologyIds: pm.ids,
      platformKey: m.platform_key, timing: m.timing, rule: table.rule, state: st, stateInfo: g.rtc_dependent ? data.rtc.states[st] : null,
      states: states, rtcDependent: !!g.rtc_dependent, reachable: G.reachable(data, gameKey, st), table: table,
      anchors: anchors, anchorNames: data.anchor_names || {}, status: spec.status || "", validation: spec.validation || "",
      resetKey: spec.reset || null, resetNote: spec.reset_note || "", resetModel: resetModel, defaults: data.defaults,
      targetSets: G.targetSetsFor(data, gameKey, targetSetKeys && targetSetKeys.length ? targetSetKeys : null),
      hasLid: g.ids.indexOf("lid") !== -1, hasSid: g.ids.indexOf("sid") !== -1,
      visibleMenuS: framesToS(m.timing.visible_menu_frame)
    };
  }
  function targetSetKeys(plat) { return plat.targetSets.map(function (s) { return s.key; }); }
  function otherTargetSetKeys(plat) {
    var inForce = targetSetKeys(plat);
    return (plat.game.target_sets || []).filter(function (k) { return inForce.indexOf(k) === -1; });
  }
  // The scope a typed outcome is inverted in: the chosen state when it is a first-boot-only one, else the
  // two-state prior (the engine's default), and Crystal's one table.
  function outcomeState(plat) {
    if (!plat.rtcDependent) return null;
    return G.TWO_STATE_PRIOR.indexOf(plat.state) === -1 ? plat.state : null;
  }
  function outcomeScopeText(plat) {
    var s = outcomeState(plat);
    if (!plat.rtcDependent) return "the one Crystal table";
    return s === null ? "the two-state prior (" + G.TWO_STATE_PRIOR.join(", ") + ")" : "RTC state " + s + " (first boot only)";
  }
  // verify scopes to the chosen first-boot-only state, else (the engine's rule) to every RTC state of the platform
  function verifyScopeText(plat) {
    var s = outcomeState(plat);
    if (!plat.rtcDependent) return "the one Crystal table";
    return s === null ? "every RTC state of platform " + plat.platformKey : "RTC state " + s + " (first boot only)";
  }

  // ---- bins and their text --------------------------------------------------------------------
  function binInfo(plat, b) {
    var r = G.lookup(DATA_OF(plat), plat.gameKey, plat.platformKey, plat.state, b);
    r.aimV = r.aim - G.VISIBLE_MENU_LAG_FRAMES;
    r.aimS = framesToS(r.aimV);
    r.afterPowerOnS = plat.visibleMenuS + r.aimS;
    return r;
  }
  // the data a plat was resolved from (resolve records it; tests pass their own)
  function DATA_OF(plat) { return plat.data || DATA; }
  function idsText(plat, r) {
    var s = "TID " + fmtId(r.tid);
    if (plat.hasLid && !isNil(r.lid)) s += ", Lucky ID " + fmtLid(r.lid);
    if (plat.hasSid && !isNil(r.sid)) s += ", Secret ID " + fmtId(r.sid);
    return s;
  }
  function setTag(plat, tid, lid, sid) { return G.setsAccepting(tid, lid, sid, plat.targetSets).map(function (s) { return s.key; }).join(", "); }
  function describeBin(plat, b) {
    var r = binInfo(plat, b);
    var tag = setTag(plat, r.tid, r.lid, r.sid);
    return "bin " + b + " (A down " + r.visible[0] + ".." + r.visible[1] + " frames after the visible menu box, aim " + f(r.aimV, 1) + " = " + fmtSf(r.aimS) + ") -> " + idsText(plat, r) +
      (tag ? "   route target (" + tag + "; the published protocol for it is a community script, not this single tap)" : "") +
      (plat.reachable ? "" : "   [RTC state " + plat.state + ": first boot only]") + "   methodology " + plat.methodologyId;
  }

  function methodologyLines(plat, conditions, indent) {
    indent = isNil(indent) ? "  " : indent;
    var m = plat.methodology;
    var lines = [indent + "Methodology: " + plat.methodologyId + "   (" + (m.name || "") + "; v" + m.version + ", " + m.date + ")",
      indent + "status: " + m.status + "; " + plat.name + ": " + plat.status,
      indent + METHODOLOGY_SENTENCE];
    if (conditions) {
      lines.push(indent + "Valid only if:");
      (m.validity || []).forEach(function (c) { lines.push(indent + "  - " + c); });
    }
    return lines;
  }
  // Every methodology of a game, with its protocol text and validity conditions verbatim from the data.
  function allMethodologyLines(data, gameKey) {
    var g = data.games[gameKey], lines = ["All methodologies for " + g.name + " (protocol and validity conditions verbatim from the data):"];
    (g.methodologies || []).forEach(function (id) {
      var m = data.methodologies[id];
      lines.push("", "Methodology: " + id + "   (" + (m.name || "") + "; v" + m.version + ", " + m.date + ")",
        "  console: " + m.console_name, "  status: " + m.status, "  predicts: " + m.predicts, "  anchors: " + m.anchors.join(", "),
        "  " + METHODOLOGY_SENTENCE, "  Protocol: " + m.protocol, "  Landmark: " + m.landmark, "  Valid only if:");
      (m.validity || []).forEach(function (c) { lines.push("    - " + c); });
    });
    return lines;
  }
  function targetSetLines(plat) {
    var data = DATA_OF(plat);
    if (!plat.targetSets.length) return ["Target sets: none in force for " + plat.gameName + " (any bin can still be aimed at)"];
    var lines = ["Target sets in force: " + targetSetKeys(plat).join(", ")];
    plat.targetSets.forEach(function (x) {
      lines.push("  - " + x.name + " [" + G.setDescribe(x) + "]", "      protocol: " + (x.protocol || "single-tap") + (x.route ? "; route: " + x.route : ""));
      if (x.provenance) lines.push("      provenance: " + x.provenance);
      if (x.note) lines.push("      note: " + x.note);
      var hits = x.singlePressHits || [];
      lines.push("      single-press hits over every RTC state of its games: " + (hits.length ? hits.map(function (h) {
        return h.table + " bin " + h.bin + " (TID $" + h.tid + ", LID $" + h.lid + (h.reachable_after_first_boot ? ")" : ", first boot only)");
      }).join("; ") : "none"));
    });
    var others = otherTargetSetKeys(plat);
    if (others.length) lines.push("  also defined for " + plat.gameName + ", not in force: " + others.join(", "));
    lines.push(scriptsLine(data, plat.gameKey));
    return lines;
  }
  // The bins that give a member of a set in force: in the chosen state, and in every state of the platform.
  function targetRows(plat) {
    var data = DATA_OF(plat);
    var inState = G.targets(data, plat.gameKey, plat.platformKey, plat.state, plat.targetSets);
    var all = G.targetsAllStates(data, plat.gameKey, plat.platformKey, plat.targetSets).filter(function (h) { return h.state !== plat.state; });
    return { inState: inState, otherStates: all };
  }

  // ---- protocol text -------------------------------------------------------------------------
  function resetActionName(plat) { return plat.key === "gse" ? "Ctrl+R (hard reset)" : "the console's RESET"; }
  function tapText() { return "tap A ONCE for " + G.TAP_FRAMES[0] + "-" + G.TAP_FRAMES[1] + " frames (" + f(G.TAP_MS[0], 0) + "-" + f(G.TAP_MS[1], 0) + " ms), then press NOTHING for " + f(G.ROLL_SETTLE_S, 2) + " s (until the New Game roll is over)"; }
  function protocolLines(plat, anchor, b, sched, correctionMs, beeps, spacing) {
    var r = binInfo(plat, b), m = plat.methodology, t = plat.timing;
    var holdLo = framesToS(t.hold_lo_frame), holdHi = framesToS(t.hold_hi_frame);
    var lines = [
      "PROTOCOL  (" + plat.gameName + " on " + plat.name + ", target bin " + b + " -> " + idsText(plat, r) + ")",
      "    Methodology: " + plat.methodologyId + "   (" + (m.name || "") + "; v" + m.version + ", " + m.date + ")",
      "    status: " + m.status,
      "    " + METHODOLOGY_SENTENCE + " The steps below ARE the methodology: any other input pattern",
      "    (a longer tap, START still down at the roll, a second press, a CONTINUE menu, a community script) gives",
      "    a different, deterministic result that this table does not cover.",
      "    NOTE: " + NO_HARDWARE_LINE,
      "    NOTE (" + plat.name + "): " + plat.validation,
      "    RTC state: " + stateLabel(DATA_OF(plat), plat.gameKey, plat.state) + (plat.reachable ? "" : ". This is a FIRST-BOOT-ONLY state: the next boot of the same cartridge is days0 or days512."),
      ""
    ];
    lines.push(
      " 1. Clear the save data: on the title screen hold UP + B + SELECT, confirm, then power fully OFF. The menu must",
      "    show NEW GAME with no CONTINUE (a CONTINUE menu makes the attempt invalid), and the Lucky ID column applies",
      "    only to the FIRST New Game after the clear.");
    if (plat.key === "gse") lines.push("    On GSE: keep a ROM copy with no .sav beside it, or NEW GAME silently becomes CONTINUE.");
    if (anchor === G.ANCHOR_MENU) {
      lines.push(
        " 2. " + (plat.key === "gse" ? "Power on (Ctrl+R hard reset on GSE)" : "Power on") + ". " + m.landmark,
        "    Hold window: START down between " + f(holdLo, 2) + " s and " + f(holdHi, 2) + " s after the boot starts (frames " + t.hold_lo_frame + "-" + t.hold_hi_frame + "); anywhere inside it gives the same menu frame.",
        " 3. Keep START held until the NEW GAME / OPTION menu box appears (visible on frame " + t.visible_menu_frame + ", " + f(plat.visibleMenuS, 2) + " s after the boot starts).",
        "    The INSTANT you see the box, press the ANCHOR button (or Space) and release START.",
        " 4. You will hear " + beeps + " short beeps " + f(spacing, 1) + " s apart, then one long high beep (the screen flashes with each).",
        "    On the long high beep " + tapText() + ".",
        "    Target: bin " + b + " = A down " + r.visible[0] + ".." + r.visible[1] + " frames after the visible menu box (aim " + f(r.aimV, 1) + " = " + fmtSf(r.aimS) + ").",
        "    The beep is " + fmtMs(correctionMs) + " early to cover your reaction to the menu plus the audio delay (the correction; calibration tunes it).");
    } else {
      if (anchor === G.ANCHOR_RESET) lines.push(" 2. Press the ANCHOR button (or Space) at the SAME instant you press " + resetActionName(plat) + " (" + f(sched.holdLo, 3) + " s of fade and stall are added to every time below).");
      else lines.push(" 2. Press the ANCHOR button (or Space) at the SAME instant you flip the power on" + (plat.key === "gba" ? " (INFERRED on a handheld GBA: the power-on-to-boot delay is not measured; prefer the menu anchor until a sample settles it)" : "") + ".");
      lines.push(
        " 3. Two low beeps mark the START-hold window (" + f(sched.holdLo, 2) + " s and " + f((sched.holdLo + sched.holdHi) / 2.0, 2) + " s after your anchor): HOLD START on the first low beep and keep holding.",
        "    " + m.landmark,
        " 4. A double blip at " + f(sched.menu, 2) + " s marks when the NEW GAME / OPTION menu box should appear (visible on frame " + t.visible_menu_frame + " of the boot): release START as it appears.",
        "    If the box appears far from the blip, START was held outside the window: the attempt is no good, reset and try again.",
        " 5. Then " + (beeps - sched.droppedCountIn) + " short beeps " + f(spacing, 1) + " s apart and one long high beep. On the long high beep " + tapText() + ".",
        "    Target: bin " + b + " = A down " + r.visible[0] + ".." + r.visible[1] + " frames after the visible menu box (aim " + f(r.aimV, 1) + ") = " + fmtSf(sched.menu + r.aimS) + " after your anchor.",
        "    The beep is " + fmtMs(correctionMs) + " early for the audio delay (this anchor's correction).");
      if (sched.droppedCountIn) lines.push("    (" + plural(sched.droppedCountIn, "count-in beep") + " left out: they would have sounded before the menu.)");
    }
    lines.push(" 6. Afterwards type the Trainer ID you got below (the Trainer Card, or a Pokemon's status screen IDNo)" +
      (plat.hasLid ? " and, once you have seen it, the Lucky ID (the Radio Tower lottery screen; first New Game after the clear only)." : "."),
      "    Each answer sharpens the correction; a typed Lucky ID also settles which bin and state you hit.");
    return lines;
  }
  function scheduleLines(sched, b, correctionMs, plat) {
    var r = binInfo(plat, b);
    var lines = ["SCHEDULE (seconds after your anchor):", "  Methodology: " + plat.methodologyId + "   RTC state: " + plat.state];
    if (sched.anchor !== G.ANCHOR_MENU) {
      lines.push("  hold START window   " + f(sched.holdLo, 3) + " - " + f(sched.holdHi, 3) + " s   (low beeps at the start and the middle)");
      lines.push("  menu box visible    " + f(sched.menu, 3) + " s   (double blip: release START)");
    }
    if (sched.countInTimes.length) lines.push("  count-in beeps      " + sched.countInTimes.map(function (t) { return f(t, 3); }).join(", "));
    lines.push("  A cue (long beep)   " + f(sched.tA, 3) + " s   = aim " + f(r.aimV, 1) + " frames after the visible menu (" + fmtSf(r.aimS) + ")" +
      (sched.anchor === G.ANCHOR_MENU ? "" : ", from your anchor") + " minus correction " + fmtMs(correctionMs));
    lines.push("  A window (bin " + b + ") " + f(sched.aWindow[0], 3) + " - " + f(sched.aWindow[1], 3) + " s   (A down inside it, before the correction)");
    lines.push("  tap " + f(sched.tapMs[0], 0) + "-" + f(sched.tapMs[1], 0) + " ms, then nothing for " + f(sched.rollSettleS, 2) + " s");
    return lines;
  }
  function buildSchedule(plat, anchor, b, correctionMs, beeps, spacing) {
    var opts = { anchor: anchor, beeps: beeps, spacingS: spacing };
    if (anchor === G.ANCHOR_RESET) {
      if (!plat.resetModel) throw new Error("no reset model for " + plat.key + " (the reset anchor needs the console's fade and stall)");
      opts.resetExtraS = G1.resetAnchorExtraSeconds(plat.resetModel);
    }
    return G.scheduleGen2(DATA_OF(plat), plat.methodologyId, b, correctionMs, opts);
  }

  // ---- calibration records (the Gen 1 store helpers over a Gen 2 store) -------------------------
  // Every record carries the mode it was made in and each mode has its own store; inside a store a
  // record under another methodology or made in the other mode is left out and named (the Gen 1 tab's
  // helpers do that split; they read plat.key, plat.methodologyId and plat.defaults.correction_ms).
  function calStoreKey(mode) { return MODE.storeKey(STORE_KEY_CAL, mode); }
  function loadCalibration(mode) { return loadJson(calStoreKey(mode), {}); }
  function saveCalibration(cal, mode) { saveJson(calStoreKey(mode), cal); }
  var calKey = U1.calKey, allSamples = U1.allSamples, samplesFor = U1.samplesFor, ignoredSamples = U1.ignoredSamples;
  var correctionInForce = U1.correctionInForce, ignoredSampleLines = U1.ignoredSampleLines, dropLastSample = U1.dropLastSample, clearSamples = U1.clearSamples;

  // The outcome of one attempt: the typed IDs inverted on the platform in the outcome scope, the candidate
  // nearest the aim, the implied correction, and (unless refused by the bin outlier guard or the duplicate
  // guard) the sample recorded.
  function recordOutcome(cal, plat, anchor, aimedBin, correctionUsed, tid, lid, opts) {
    var o = opts || {};
    var mode = MODE.checkMode(o.mode);
    var data = DATA_OF(plat);
    lid = isNil(lid) ? null : lid;
    var out = { tid: tid, lid: lid, aimedBin: aimedBin, lines: [], added: false, refused: null, hitBin: null, implied: null, candidates: [], elsewhere: [] };
    out.lines.push("You got TID " + fmtId(tid) + (lid === null ? "" : " with Lucky ID " + fmtLid(lid)) + ": " + G.verdictText(tid, lid, null, plat.targetSets) + ".");
    var sh = G.sampleFromHit(data, plat.gameKey, plat.platformKey, outcomeState(plat), tid, lid, aimedBin, correctionUsed, { attempt: o.attempt || null, player: o.player || "webaudio" });
    out.candidates = sh.candidates;
    if (!sh.sample) {
      out.lines.push("  Those IDs are in no " + plat.name + " table in scope (" + outcomeScopeText(plat) + "), so nothing can be learned from this attempt.",
        "  Usual causes: START held outside the window, the save was not cleared (CONTINUE menu), a tap longer than 8 frames",
        "  or START still down at the roll, another console family, or the press was later than bin " + (G.BIN_COUNT - 1) + ".");
      var broad = G.invert(data, plat.gameKey, tid, { lid: lid, platformKey: plat.platformKey });
      out.elsewhere = broad.candidates;
      if (broad.candidates.length) {
        out.lines.push("  They ARE produced on this platform in another RTC state: " + broad.candidates.map(function (c) {
          return c.table + " bin " + c.bin + (c.reachableAfterFirstBoot ? "" : " (first boot only)");
        }).join("; ") + ". That is a different table (the clock, not your timing), so the correction is unchanged; pick that state above if it is this cartridge's.");
      } else out.lines.push("  Correction unchanged.");
      out.lines.push("  Methodology: " + plat.methodologyId + " (nothing recorded under it from this attempt).");
      return out;
    }
    var hit = sh.nearestBin;
    out.hitBin = hit;
    if (sh.candidates.length > 1) {
      out.lines.push("  (" + sh.candidates.map(function (c) { return c.table + " bin " + c.bin; }).join(", ") + " all give these IDs; using bin " + hit + ", the one nearest your aim)");
    }
    var err = G.errorFramesBins(plat.rule, hit, aimedBin);
    var hitRange = G.offsetsForBin(hit, plat.rule);
    if (err === 0) out.lines.push("  You hit bin " + hit + " exactly (aimed " + aimedBin + "; state " + sh.sample.state + ").");
    else out.lines.push("  You hit bin " + hit + " (A down " + (hitRange[0] - G.VISIBLE_MENU_LAG_FRAMES) + ".." + (hitRange[1] - G.VISIBLE_MENU_LAG_FRAMES) + " frames after the visible menu), aimed " + aimedBin + ": " +
      f(Math.abs(err), 1) + " frames " + (err > 0 ? "late" : "early") + " (" + f(Math.abs(G1.framesToMs(err)), 1) + " ms; state " + sh.sample.state + ").");
    out.implied = sh.sample.implied_ms;
    out.lines.push("  This attempt implies a correction of " + f(out.implied, 1) + " ms (used " + f(correctionUsed, 1) + " ms).");
    var sample = sh.sample;
    sample.when = o.when || nowStamp();
    sample.mode = mode;
    sample.player = o.player || "webaudio";
    var key = calKey(plat.key, anchor);
    var stored = allSamples(cal, plat.key, anchor);
    if (!o.force && G.isOutlierBins(plat.rule, hit, aimedBin)) {
      out.refused = "outlier";
      out.lines.push("  That is more than " + G.OUTLIER_FRAMES + " frames (" + (G.OUTLIER_FRAMES / G.POLL_PERIOD_FRAMES) + " bins, " + f(G1.framesToSeconds(G.OUTLIER_FRAMES), 1) + " s) from the aim: NOT added to the calibration (" + anchor + " anchor).",
        "  Usual causes: START held outside the window (the table does not apply to that attempt), a mistyped ID, or the ID",
        "  of a different attempt. If it really was this attempt, tick 'force' and record again.",
        "  Methodology: " + plat.methodologyId + " (nothing recorded under it from this attempt).");
      return out;
    }
    if (!o.force && G1.isDuplicate(stored, sample)) {
      out.refused = "duplicate";
      out.lines.push("  Looks like the same attempt entered twice (same Trainer ID and the same aim): not added (" + anchor + " anchor).",
        "  Tick 'force' if it really was a new attempt.",
        "  Methodology: " + plat.methodologyId + " (nothing recorded under it from this attempt).");
      return out;
    }
    cal[key] = { samples: stored.concat([sample]) };
    out.added = true;
    var n = samplesFor(cal, plat.key, anchor, plat.methodologyId, mode).length;
    out.newCorrection = correctionInForce(cal, plat, anchor, mode);
    out.lines.push("  Correction updated to " + f(out.newCorrection, 1) + " ms (" + plural(n, "sample") + ", " + anchor + " anchor).",
      "  Methodology: " + plat.methodologyId + " (recorded with the sample; only samples under it are averaged).",
      "  Mode: " + MODE.label(mode) + " (recorded with the sample; only samples made in this mode are averaged, from this mode's own store).");
    out.lines = out.lines.concat(ignoredSampleLines(cal, plat, anchor, mode).map(function (l) { return "  " + l; }));
    return out;
  }
  function sampleLine(x) {
    return "  " + (x.when || "") + "  aimed bin " + x.aimed_bin + "  hit bin " + x.hit_bin + "  used " + f(x.correction_used_ms, 1) + " ms  implied " + f(x.implied_ms, 1) + " ms  TID " + fmtId(x.tid) +
      (isNil(x.lid) ? "" : "  LID " + fmtLid(x.lid)) + (x.state ? "  state " + x.state : "");
  }
  function hasSpread(st) { return st.n >= 2 && st.sdMs === st.sdMs; }
  var hitSummary = U1.hitSummary;
  function statsLines(samples, plat, anchor, mode) {
    var st = G1.anchorStats(samples);
    var def = plat.defaults.correction_ms[anchor];
    var lines = [plat.name + " / " + anchor + " anchor  (methodology " + plat.methodologyId + (isNil(mode) ? "" : ", " + MODE.label(mode) + " mode") + ")"];
    if (st.n === 0) {
      lines.push("  n 0: no calibrated attempts; correction " + fmtMs(def) + " (default)");
      lines.push("  recommendation: cue an attempt and type the Trainer ID you got; 2 give a spread, 3+ a drift check.");
      return lines;
    }
    lines.push("  n " + st.n + "   mean " + f(st.meanMs, 1) + " ms (the correction in force)   sd " +
      (hasSpread(st) ? f(st.sdMs, 1) + " ms (" + f(G1.msToFrames(st.sdMs), 2) + " frames)" : "n/a (1 sample)") +
      "   robust sd (MAD x 1.4826) " + (hasSpread(st) ? f(st.robustSdMs, 1) + " ms" : "n/a") + "   range " + f(st.minMs, 1) + ".." + f(st.maxMs, 1) + " ms");
    var dr = G1.drift(st.valuesMs);
    if (hasSpread(st)) {
      var h = G1.hitProbabilityHeadline(st.sdMs, st.n);
      lines.push("  P(hit) about " + U1.fmtPct(h.p) + " (" + U1.pRangeText(st.sdMs, st.n, h.centred) + ") -> about " + U1.fmtAttempts(h.p) + " attempts per hit   (the frame-level figure: the bin is 4 frames wide, so landing inside it is easier than this)");
    }
    if (dr.flag) lines.push("  drift: RECALIBRATE / SETUP CHANGED (" + dr.strength + "): " + dr.reason + (dr.welchT === null ? "" : "; Welch t " + f(dr.welchT, 2)));
    else if (dr.strength === "weak") lines.push("  drift: none flagged, a shift inside the scatter (" + dr.reason + ")");
    else lines.push("  drift: none (" + dr.reason + (dr.welchT === null ? "" : "; Welch t " + f(dr.welchT, 2)) + ")");
    var rec = G1.recommendation(st, dr, G1.FRAME_MS, null, false);
    lines.push("  recommendation [" + rec[0] + "]: " + rec[1]);
    samples.forEach(function (x) { lines.push(sampleLine(x)); });
    return lines;
  }

  // ---- the invert panel: typed IDs -> candidate states and bins, with the ambiguity statistics -----
  // scope: {family: "all"|"running"|"halted"|"prior", state: null|<id>}
  function invertScopeOpts(plat, scope, lid) {
    var s = scope || {};
    var opts = { platformKey: plat.platformKey };
    if (!isNil(lid)) opts.lid = lid;
    if (s.state) opts.states = [s.state];
    else if (s.family === "prior") opts.states = G.TWO_STATE_PRIOR.slice();
    else if (s.family && s.family !== "all") opts.family = s.family;
    return opts;
  }
  function invertScopeText(plat, scope) {
    var s = scope || {};
    if (!plat.rtcDependent) return "the one Crystal table on platform " + plat.platformKey;
    if (s.state) return "RTC state " + s.state + " on platform " + plat.platformKey;
    if (s.family === "prior") return "the two-state prior (" + G.TWO_STATE_PRIOR.join(", ") + ") on platform " + plat.platformKey;
    if (s.family === "running") return "the ten running-clock states on platform " + plat.platformKey;
    if (s.family === "halted") return "the ten halted-clock states on platform " + plat.platformKey + " (a cartridge halted and not booted since: first boot only)";
    return "every RTC state on platform " + plat.platformKey;
  }
  function invertLines(plat, tid, lid, scope) {
    var data = DATA_OF(plat);
    lid = isNil(lid) ? null : lid;
    var opts = invertScopeOpts(plat, scope, lid);
    var inv = G.invert(data, plat.gameKey, tid, opts);
    var lines = ["TID " + fmtId(tid) + (lid === null ? "" : " + Lucky ID " + fmtLid(lid)) + " on " + plat.name + " (" + plat.gameName + "), scope: " + invertScopeText(plat, scope) + ": " + G.verdictText(tid, lid, null, plat.targetSets)];
    lines = lines.concat(methodologyLines(plat, false));
    if (!inv.candidates.length) {
      lines.push("  no candidate: these IDs are absent from every table in scope. Wrong platform (SGB, 3DS Virtual Console, a header-renamed ROM),",
        "  a dead-battery clock state, or a violated protocol (a longer tap, START down at the roll, a CONTINUE menu): ask for a second boot.");
    } else {
      inv.candidates.forEach(function (c) {
        var vis = [c.offsets[0] - G.VISIBLE_MENU_LAG_FRAMES, c.offsets[1] - G.VISIBLE_MENU_LAG_FRAMES];
        lines.push("  " + c.table + " bin " + c.bin + ": A down " + vis[0] + ".." + vis[1] + " frames after the visible menu box (" + fmtSf(framesToS((vis[0] + vis[1]) / 2.0)) + ") -> TID " + fmtId(c.tid) +
          (plat.hasLid ? ", LID " + fmtLid(c.lid) : "") + (plat.hasSid && !isNil(c.sid) ? ", SID " + fmtId(c.sid) : "") + "; " + c.family + " clock" +
          (c.members.length > 1 ? "; the same table as " + c.members.slice(1).map(function (m) { return m[0] + "/" + m[1]; }).join(", ") : "") +
          (c.reachableAfterFirstBoot ? "" : "   [first boot only]"));
      });
      if (inv.candidates.length === 1) lines.push("  one candidate: the bin and the state are settled.");
      else if (inv.resolved) lines.push("  " + inv.candidates.length + " candidates; the two-state prior (" + G.TWO_STATE_PRIOR.join(", ") + ") picks " + inv.resolved.table + " bin " + inv.resolved.bin + " for a cartridge booted before.");
      else lines.push("  AMBIGUOUS: " + inv.candidates.length + " candidates" + (inv.preferred.length ? ", " + inv.preferred.length + " of them under the two-state prior" : ", none under the two-state prior") +
        (lid === null && plat.hasLid ? "; the Lucky ID (Radio Tower lottery screen) settles it" : "") + ".");
    }
    var ambOpts = invertScopeOpts(plat, scope, null);
    var amb = G.ambiguity(data, plat.gameKey, ambOpts);
    lines.push("Ambiguity over this scope (" + plural(amb.tables, "distinct table") + ", " + amb.entries + " (table, bin) entries): " + amb.distinctTids + " distinct TIDs, " + amb.ambiguousTids +
      " with more than one candidate (" + amb.ambiguousEntries + " entries" + (amb.entries ? " = " + f(100.0 * amb.ambiguousEntries / amb.entries, 1) + " %" : "") + ", max " + amb.maxCandidates + "), " +
      amb.pairCollisions + " (TID, LID) pair collision" + (amb.pairCollisions === 1 ? "" : "s") + (amb.pairCollisions ? " (" + amb.pairCollisionList.join(", ") + (amb.pairCollisions > amb.pairCollisionList.length ? ", ..." : "") + ")" : "") + ".");
    return { inversion: inv, ambiguity: amb, lines: lines };
  }

  // ---- verify (moderators; human-measured input) ------------------------------------------------
  function verifyLines(plat, tid, lid, menuToPressS) {
    var data = DATA_OF(plat);
    lid = isNil(lid) ? null : lid;
    var r = G.verify(data, plat.gameKey, plat.platformKey, tid, lid, menuToPressS, { state: outcomeState(plat) });
    var lines = ["TID " + fmtId(tid) + (lid === null ? "" : " + Lucky ID " + fmtLid(lid)) + " on " + plat.name + " (" + plat.gameName + "): " + G.verdictText(tid, lid, null, plat.targetSets)];
    lines = lines.concat(methodologyLines(plat, true));
    lines.push("  measured VISIBLE menu box -> A press: " + f(menuToPressS, 3) + " s = offset " + f(r.predictedOffset, 1) + " (" + f(menuToPressS, 3) + " s x " + f(FPS, 4) + " fps + " + G.VISIBLE_MENU_LAG_FRAMES + ") -> bin " + (r.predictedBin === null ? "none (outside the table)" : r.predictedBin) + "; scope " + verifyScopeText(plat));
    if (!r.inTable) {
      lines.push("  these IDs are produced by NO bin in scope on this platform: INCONSISTENT with the tables");
      return { consistent: false, result: r, lines: lines };
    }
    lines.push("  the tables produce them at bin" + (r.bins.length > 1 ? "s " : " ") + r.bins.join(", "));
    lines.push("  nearest bin " + r.nearest + " is " + (r.differenceBins === null ? "n/a" : r.differenceBins + " bin" + (Math.abs(r.differenceBins) === 1 ? "" : "s")) + " from the measurement (tolerance +-1 bin): " + (r.consistent ? "CONSISTENT" : "INCONSISTENT"));
    lines.push("  (no press-to-visible lag is known for Gen 2: no hardware sample exists; measure the press itself, from the button overlay or a hand cam)",
      "  (this checks timing against the tables only, and only under the methodology above; it says nothing else about the run)");
    return { consistent: r.consistent, result: r, lines: lines };
  }

  var api = {
    RULES_LINE: RULES_LINE, METHODOLOGY_SENTENCE: METHODOLOGY_SENTENCE, NO_HARDWARE_LINE: NO_HARDWARE_LINE, STORE_KEY_CAL: STORE_KEY_CAL,
    DEFAULT_GAME: DEFAULT_GAME, DEFAULT_PLATFORM: DEFAULT_PLATFORM,
    fmtId: fmtId, fmtLid: fmtLid, hex4: hex4,
    supportedGames: supportedGames, platformMethodologies: platformMethodologies, platformsFor: platformsFor, stateOptions: stateOptions, stateLabel: stateLabel,
    reachabilityLines: reachabilityLines, scriptsLine: scriptsLine, resolve: resolve, targetSetKeys: targetSetKeys, otherTargetSetKeys: otherTargetSetKeys,
    outcomeState: outcomeState, outcomeScopeText: outcomeScopeText, verifyScopeText: verifyScopeText, binInfo: binInfo, idsText: idsText, setTag: setTag, describeBin: describeBin,
    methodologyLines: methodologyLines, allMethodologyLines: allMethodologyLines, targetSetLines: targetSetLines, targetRows: targetRows,
    protocolLines: protocolLines, scheduleLines: scheduleLines, buildSchedule: buildSchedule,
    calKey: calKey, calStoreKey: calStoreKey, loadCalibration: loadCalibration, saveCalibration: saveCalibration, allSamples: allSamples, samplesFor: samplesFor,
    ignoredSamples: ignoredSamples, correctionInForce: correctionInForce, ignoredSampleLines: ignoredSampleLines, recordOutcome: recordOutcome,
    dropLastSample: dropLastSample, clearSamples: clearSamples, sampleLine: sampleLine, hitSummary: hitSummary, statsLines: statsLines,
    invertScopeOpts: invertScopeOpts, invertLines: invertLines, verifyLines: verifyLines,
    _storage: { get: storageGet, set: storageSet }
  };
  root.ShinyGen2TidUi = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  // ======================= the DOM part =======================
  if (typeof document === "undefined" || !document.getElementById("tab-g2tid") || !G || !DATA) return;
  var CUE = U1.cuePlayer;                                       // the Gen 1 tab's player: one AudioContext and flash element for the page
  if (!CUE) throw new Error("gen1tid-ui.js must expose its cue player (cuePlayer) for the Gen 2 tab");

  function $(id) { return document.getElementById(id); }
  function setText(id, lines) { $(id).textContent = Array.isArray(lines) ? lines.join("\n") : lines; }
  function option(sel, value, text, selected) {
    var o = document.createElement("option");
    o.value = value; o.textContent = text; if (selected) o.selected = true;
    sel.appendChild(o);
  }
  function fill(sel, items, current) {
    sel.innerHTML = "";
    items.forEach(function (it) { option(sel, it.value, it.text, it.value === current); });
    if (current && sel.value !== current) sel.value = items.length ? items[0].value : "";
  }
  function numOr(id, fallback) { var v = parseFloat($(id).value); return isNaN(v) ? fallback : v; }
  function parseIdField(id, what) {
    var text = $(id).value;
    if (!text.trim()) return null;
    try { return G1.parseTid(text); } catch (e) { throw new Error("not a " + what + " (" + e.message + ")"); }
  }

  // -- state
  var st = { plat: null, bin: null, anchor: G.ANCHOR_MENU, sched: null, correction: null, attempt: null };
  var mode = MODE.get();
  var cal = loadCalibration(mode);
  MODE.subscribe(function (m) {
    // the other mode's store, never merged: the correction, the stats and the notes are re-read from it
    mode = m;
    cal = loadCalibration(m);
    $("g2-correction")._manual = false;
    if (st.plat) { refreshAnchor(); refreshStats(); }
  });

  function currentTargetSetKeys() {
    var keys = [];
    document.querySelectorAll("#g2-targetsets input[type=checkbox]").forEach(function (cb) { if (cb.checked) keys.push(cb.value); });
    return keys;
  }
  function refreshPlatform(keepTarget) {
    var game = $("g2-game").value;
    var plats = platformsFor(DATA, game);
    fill($("g2-platform"), plats.map(function (p) { return { value: p.key, text: p.spec.name + "   [" + p.spec.status + "]" }; }), $("g2-platform").value || DEFAULT_PLATFORM);
    var pk = $("g2-platform").value;
    var pm = platformMethodologies(DATA, pk, game);
    fill($("g2-methodology"), pm.ids.map(function (id) { return { value: id, text: id + ": " + (DATA.methodologies[id].name || "") }; }), $("g2-methodology").value || pm.def);
    $("g2-methodology-row").style.display = pm.ids.length > 1 ? "" : "none";
    var states = stateOptions(DATA, game);
    fill($("g2-state"), states.map(function (s) { return { value: s.value, text: s.text }; }), $("g2-state").value || DATA.defaults.state);
    $("g2-state").disabled = states.length === 1;
    // target sets: the game's sets, the defaults ticked
    var g = DATA.games[game];
    var box = $("g2-targetsets");
    var wanted = currentTargetSetKeys();
    box.innerHTML = "";
    (g.target_sets || []).forEach(function (k) {
      var lab = document.createElement("label");
      lab.className = "check";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = k;
      cb.checked = wanted.length && box._game === game ? wanted.indexOf(k) !== -1 : (g.default_target_sets || g.target_sets || []).indexOf(k) !== -1;
      cb.addEventListener("change", function () { refreshPlatform(true); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + k));
      box.appendChild(lab);
    });
    box._game = game;
    try {
      st.plat = resolve(DATA, game, pk, $("g2-methodology").value, $("g2-state").value, currentTargetSetKeys());
    } catch (e) {
      setText("g2-status", "cannot resolve: " + e.message);
      return;
    }
    var plat = st.plat;
    var t = plat.timing;
    setText("g2-status", [plat.gameName + " on " + plat.name + " [" + plat.status + "]: " + plat.methodology.landmark,
      "Hold window frames " + t.hold_lo_frame + "-" + t.hold_hi_frame + " (" + f(framesToS(t.hold_lo_frame), 2) + "-" + f(framesToS(t.hold_hi_frame), 2) + " s after the boot starts); the NEW GAME / OPTION box is visible on frame " +
        t.visible_menu_frame + " (" + f(plat.visibleMenuS, 2) + " s); the first poll accepts an A down up to " + (t.first_poll_frame - t.visible_menu_frame) + " frames after it, then one poll every " + t.poll_period_frames + " frames: " + G.BIN_COUNT + " bins.",
      "Methodology " + plat.methodologyId + ": " + plat.methodology.status + ". " + plat.validation,
      "RTC state " + stateLabel(DATA, game, plat.state) + ".",
      NO_HARDWARE_LINE,
      scriptsLine(DATA, game)].concat(reachabilityLines(DATA, game)));
    setText("g2-methodology-text", methodologyLines(plat, true, "").concat([""], targetSetLines(plat), [""], allMethodologyLines(DATA, game)));
    // targets: the bins that give a member of a set in force, in this state and in the platform's other states
    var rows = targetRows(plat);
    var html = "<tr><th>RTC state</th><th>bin</th><th>A after the visible menu</th><th>after the boot starts</th><th>TID</th><th>Lucky ID</th><th>set</th><th>reachable</th></tr>";
    function row(h, state, other) {
      var aimV = (h.offsets[0] + h.offsets[1]) / 2.0 - G.VISIBLE_MENU_LAG_FRAMES;
      return '<tr class="pick" data-bin="' + h.bin + '" data-state="' + state + '"><td>' + state + (other ? " (other state)" : "") + "</td><td>" + h.bin + "</td><td>" + fmtSf(framesToS(aimV)) + "</td><td>" +
        fmtSf(plat.visibleMenuS + framesToS(aimV)) + "</td><td class=mono>" + fmtId(h.tid) + "</td><td class=mono>" + (plat.hasLid ? fmtLid(h.lid) : "") + "</td><td>" + h.sets.join(", ") + "</td><td>" +
        (h.reachableAfterFirstBoot ? "recurs boot after boot" : "first boot only") + "</td></tr>";
    }
    rows.inState.forEach(function (h) { html += row(h, plat.state, false); });
    if (!rows.inState.length) html += "<tr><td colspan=8>none in RTC state " + plat.state + " (bins 0-" + (G.BIN_COUNT - 1) + "): no single tap in this table produces an accepted ID. " + scriptsLine(DATA, game) + " Type a Trainer ID or a bin instead.</td></tr>";
    rows.otherStates.forEach(function (h) { html += row(h, h.state, true); });
    $("g2-targets-table").innerHTML = "<table>" + html + "</table>";
    $("g2-targets-table").querySelectorAll("tr.pick").forEach(function (tr) {
      tr.addEventListener("click", function () { setTargetIn(tr.dataset.state, Number(tr.dataset.bin)); });
    });
    setText("g2-table-note", "Table: " + plat.table.key + (plat.table.carrier !== plat.table.key ? " (the same data as " + plat.table.carrier + ")" : "") + ", " + G.BIN_COUNT + " bins, methodology " + plat.methodologyId + ", RTC state " +
      plat.state + (plat.reachable ? "" : " (first boot only)") + ". " + NO_HARDWARE_LINE);
    // anchors
    fill($("g2-anchor"), plat.anchors.map(function (a) { return { value: a, text: a + ": " + (plat.anchorNames[a] || a) }; }), plat.anchors.indexOf(st.anchor) !== -1 ? st.anchor : plat.anchors[0]);
    st.anchor = $("g2-anchor").value;
    if (!keepTarget || st.bin === null) st.bin = null;
    if (st.bin !== null) setTarget(st.bin);
    refreshAnchor();
    refreshStats();
    refreshInvertScope();
  }
  function setTargetIn(state, b) {
    if (st.plat && state !== st.plat.state && !$("g2-state").disabled) {
      $("g2-state").value = state;
      st.bin = b;
      refreshPlatform(true);
      return;
    }
    setTarget(b);
  }
  function setTarget(b) {
    st.bin = b;
    setText("g2-target-info", "Target: " + describeBin(st.plat, b));
    refreshAnchor();
  }
  function refreshAnchor() {
    var plat = st.plat;
    st.anchor = $("g2-anchor").value || plat.anchors[0];
    var samples = samplesFor(cal, plat.key, st.anchor, plat.methodologyId, mode);
    var inForce = correctionInForce(cal, plat, st.anchor, mode);
    if (!$("g2-correction")._manual) $("g2-correction").value = f(inForce, 1);
    st.correction = numOr("g2-correction", inForce);
    var ignored = ignoredSampleLines(cal, plat, st.anchor, mode);
    setText("g2-correction-note", ($("g2-correction")._manual ? "Correction: " + fmtMs(st.correction) + " (typed for this session; in force " + fmtMs(inForce) + ")" :
      "Correction in force: " + fmtMs(inForce) + " (" + (samples.length === 0 ? "default, no calibration yet" : "mean of " + plural(samples.length, "calibrated attempt")) + ", " + MODE.label(mode) + " mode's store)") +
      (ignored.length ? "\n" + ignored.join("\n") : ""));
    st.sched = null;
    if (st.bin === null) {
      setText("g2-protocol", "Pick a target first (a row above, a typed Trainer ID, or a bin).");
      setText("g2-schedule", "");
      $("g2-anchor-btn").disabled = true;
      return;
    }
    var beeps = Math.max(0, Math.round(numOr("g2-beeps", plat.defaults.count_in_beeps)));
    var spacing = numOr("g2-spacing", plat.defaults.count_in_spacing_s);
    try {
      st.sched = buildSchedule(plat, st.anchor, st.bin, st.correction, beeps, spacing);
    } catch (e) {
      setText("g2-protocol", "cannot build the cue: " + e.message + ". If the correction is the problem, clear the samples or type another correction.");
      setText("g2-schedule", "");
      $("g2-anchor-btn").disabled = true;
      return;
    }
    setText("g2-protocol", protocolLines(plat, st.anchor, st.bin, st.sched, st.correction, beeps, spacing));
    setText("g2-schedule", scheduleLines(st.sched, st.bin, st.correction, plat));
    setText("g2-phit", hitSummary(samples, st.anchor, plat.methodologyId).line);
    $("g2-anchor-btn").disabled = false;
    $("g2-display").textContent = "A at " + f(st.sched.tA, 3) + " s after the anchor";
    try { CUE.prepare(st.sched); } catch (e) { /* no AudioContext until a gesture: rendered on the click */ }
  }
  function anchorNow() {
    if (!st.sched || CUE.running()) return;
    st.attempt = nowStamp() + "/" + f(performance.now() / 1000.0, 3);
    CUE.play(st.sched, $("g2-display"), $("g2-cue-log"), function () {
      var r = binInfo(st.plat, st.bin);
      $("g2-cue-log").textContent += "Done. Target was bin " + st.bin + " -> " + idsText(st.plat, r) + " under " + st.plat.methodologyId + " (RTC state " + st.plat.state + "). Type the Trainer ID you got below.\n";
      $("g2-got").focus();
    });
  }
  function record() {
    if (!st.plat || st.bin === null) { setText("g2-outcome", "Load a target and play a cue first."); return; }
    var tid, lid;
    try { tid = parseIdField("g2-got", "Trainer ID"); lid = parseIdField("g2-got-lid", "Lucky ID"); } catch (e) { setText("g2-outcome", e.message); return; }
    if (tid === null) { setText("g2-outcome", "type the Trainer ID you got"); return; }
    var r = recordOutcome(cal, st.plat, st.anchor, st.bin, st.correction, tid, lid, { force: $("g2-force").checked, attempt: st.attempt, mode: mode });
    if (r.added) { saveCalibration(cal, mode); $("g2-force").checked = false; $("g2-correction")._manual = false; }
    setText("g2-outcome", r.lines);
    refreshAnchor();
    refreshStats();
  }
  function refreshStats() {
    var plat = st.plat;
    setText("g2-stats", statsLines(samplesFor(cal, plat.key, st.anchor, plat.methodologyId, mode), plat, st.anchor, mode));
  }
  function findBins() {
    var plat = st.plat, tid, lid;
    try { tid = parseIdField("g2-tid", "Trainer ID"); lid = parseIdField("g2-lid", "Lucky ID"); } catch (e) { setText("g2-find-out", e.message); return; }
    if (tid === null) { setText("g2-find-out", "type the Trainer ID you want"); return; }
    var inState = invertLines(plat, tid, lid, { state: plat.state });
    var lines = inState.lines.slice(0, -1);        // the ambiguity line belongs to the invert panel
    var cands = inState.inversion.candidates.slice();
    if (!cands.length && plat.rtcDependent) {
      var all = G.invert(DATA, plat.gameKey, tid, { lid: lid, platformKey: plat.platformKey });
      if (all.candidates.length) {
        lines.push("  In other RTC states of this platform: " + all.candidates.map(function (c) { return c.table + " bin " + c.bin + (c.reachableAfterFirstBoot ? "" : " (first boot only)"); }).join("; "));
        cands = all.candidates;
      }
    }
    setText("g2-find-out", lines);
    var holder = $("g2-find-buttons");
    holder.innerHTML = "";
    cands.forEach(function (c) {
      var stName = G.splitKey(c.table).state;
      var b = document.createElement("button");
      b.className = "secondary";
      b.textContent = "aim at bin " + c.bin + (stName === plat.state ? "" : " in state " + stName);
      b.addEventListener("click", function () { setTargetIn(stName, c.bin); });
      holder.appendChild(b);
      holder.appendChild(document.createTextNode(" "));
    });
  }
  function refreshInvertScope() {
    var plat = st.plat;
    var sel = $("g2-invert-scope");
    var items = plat.rtcDependent ? [
      { value: "prior", text: "the two-state prior (days0, days512): a cartridge booted before" },
      { value: "all", text: "every RTC state (first boot of a cartridge)" },
      { value: "running", text: "the ten running-clock states" },
      { value: "halted", text: "the ten halted-clock states" },
      { value: "state", text: "the chosen RTC state only (" + plat.state + ")" }
    ] : [{ value: "all", text: "the one Crystal table" }];
    fill(sel, items, sel.value || "prior");
  }
  function invertNow() {
    var plat = st.plat, tid, lid;
    try { tid = parseIdField("g2-invert-tid", "Trainer ID"); lid = parseIdField("g2-invert-lid", "Lucky ID"); } catch (e) { setText("g2-invert-out", e.message); return; }
    if (tid === null) { setText("g2-invert-out", "type the Trainer ID to invert"); return; }
    var v = $("g2-invert-scope").value;
    var scope = v === "state" ? { state: plat.state } : { family: v };
    var r = invertLines(plat, tid, lid, scope);
    setText("g2-invert-out", r.lines);
    var holder = $("g2-invert-buttons");
    holder.innerHTML = "";
    r.inversion.candidates.forEach(function (c) {
      var stName = G.splitKey(c.table).state;
      var b = document.createElement("button");
      b.className = "secondary";
      b.textContent = "aim at bin " + c.bin + (stName === plat.state ? "" : " in state " + stName);
      b.addEventListener("click", function () { setTargetIn(stName, c.bin); });
      holder.appendChild(b);
      holder.appendChild(document.createTextNode(" "));
    });
  }
  function verifyNow() {
    var plat = st.plat, tid, lid;
    try { tid = parseIdField("g2-verify-tid", "Trainer ID"); lid = parseIdField("g2-verify-lid", "Lucky ID"); } catch (e) { setText("g2-verify-out", e.message); return; }
    if (tid === null) { setText("g2-verify-out", "type the Trainer ID in the run"); return; }
    var s = numOr("g2-verify-s", NaN);
    if (!isFinite(s)) { setText("g2-verify-out", "give the seconds from the visible menu box to the press, measured from the video"); return; }
    setText("g2-verify-out", verifyLines(plat, tid, lid, s).lines);
  }

  // -- wiring
  fill($("g2-game"), supportedGames(DATA).map(function (k) { return { value: k, text: DATA.games[k].name }; }), DEFAULT_GAME);
  $("g2-game").addEventListener("change", function () { $("g2-platform").value = ""; $("g2-methodology").value = ""; $("g2-state").value = ""; refreshPlatform(false); });
  $("g2-platform").addEventListener("change", function () { $("g2-methodology").value = ""; refreshPlatform(false); });
  $("g2-methodology").addEventListener("change", function () { refreshPlatform(true); });
  $("g2-state").addEventListener("change", function () { refreshPlatform(true); });
  $("g2-find").addEventListener("click", findBins);
  $("g2-use-bin").addEventListener("click", function () {
    var b = Math.round(numOr("g2-bin", -1));
    if (!st.plat || !(b >= 0 && b < G.BIN_COUNT)) { setText("g2-find-out", "bins run 0-" + (G.BIN_COUNT - 1)); return; }
    setTarget(b);
  });
  $("g2-anchor").addEventListener("change", function () { $("g2-correction")._manual = false; refreshAnchor(); refreshStats(); });
  $("g2-correction").addEventListener("change", function () { $("g2-correction")._manual = true; refreshAnchor(); });
  $("g2-correction-reset").addEventListener("click", function () { $("g2-correction")._manual = false; refreshAnchor(); });
  ["g2-beeps", "g2-spacing"].forEach(function (id) { $(id).addEventListener("change", refreshAnchor); });
  $("g2-anchor-btn").addEventListener("click", anchorNow);
  $("g2-cancel").addEventListener("click", function () { CUE.stop("cancel"); });
  $("g2-record").addEventListener("click", record);
  ["g2-got", "g2-got-lid"].forEach(function (id) { $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") record(); }); });
  $("g2-drop-last").addEventListener("click", function () {
    var d = dropLastSample(cal, st.plat, st.anchor, mode);
    saveCalibration(cal, mode);
    setText("g2-outcome", d ? "dropped the newest sample: aimed bin " + d.aimed_bin + ", hit bin " + d.hit_bin + ", TID " + fmtId(d.tid) + " (under " + st.plat.methodologyId + ", " + MODE.label(mode) + " mode)" :
      "no samples under " + st.plat.methodologyId + " in " + MODE.label(mode) + " mode for " + st.plat.key + "/" + st.anchor);
    $("g2-correction")._manual = false;
    refreshAnchor(); refreshStats();
  });
  $("g2-clear").addEventListener("click", function () {
    var r = clearSamples(cal, st.plat, st.anchor, false, mode);
    saveCalibration(cal, mode);
    setText("g2-outcome", "cleared calibration for " + st.plat.key + "/" + st.anchor + " under " + st.plat.methodologyId + " (" + MODE.label(mode) + " mode): " + plural(r.removed.length, "sample") + " removed" +
      (r.kept.length ? "; " + plural(r.kept.length, "sample") + " under other methodologies or modes kept, untouched" : ""));
    $("g2-correction")._manual = false;
    refreshAnchor(); refreshStats();
  });
  $("g2-invert").addEventListener("click", invertNow);
  $("g2-invert-tid").addEventListener("keydown", function (e) { if (e.key === "Enter") invertNow(); });
  $("g2-verify").addEventListener("click", verifyNow);
  // the AudioContext is resumed on the first gesture in the tab, before the anchor click
  var tabEl = document.getElementById("tab-g2tid");
  tabEl.addEventListener("pointerdown", CUE.warmAudio, true);
  var tabBtn = document.querySelector("button[data-tab=g2tid]");
  if (tabBtn) tabBtn.addEventListener("pointerdown", CUE.warmAudio);
  document.addEventListener("keydown", function () { if (tabEl.classList.contains("active")) CUE.warmAudio(); }, true);
  $("g2-anchor-btn").addEventListener("mousedown", CUE.warmAudio);
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    if (!tabEl.classList.contains("active")) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    if (CUE.running()) { CUE.stop("cancel"); return; }
    anchorNow();
  });
  setText("g2-rules", RULES_LINE + " " + NO_HARDWARE_LINE);
  refreshPlatform(false);

  // ?g2selftest: drive the tab through its own handlers (no audio) and write a summary the
  // headless-browser check in tests/run-tests.sh reads back from the DOM.
  if (root.location && root.location.search.indexOf("g2selftest") !== -1) {
    var report = {};
    try {
      report.game = $("g2-game").value; report.platform = $("g2-platform").value; report.methodology = st.plat.methodologyId; report.state = st.plat.state;
      report.statusNamesNoHardware = $("g2-status").textContent.indexOf("No hardware sample exists for any Gen 2 configuration") !== -1;
      report.statusNamesScripts = $("g2-status").textContent.indexOf("need their community multi-step scripts") !== -1;
      report.statusNamesReachability = $("g2-status").textContent.indexOf("Only days0 and days512 recur boot after boot") !== -1;
      report.methodologiesListed = ($("g2-methodology-text").textContent.match(/^  Protocol: /gm) || []).length;
      report.protocolVerbatim = $("g2-methodology-text").textContent.indexOf("Protocol: " + DATA.methodologies["gold/gbp/hold-start-v1"].protocol) !== -1;
      report.validityVerbatim = DATA.methodologies["gold/gbp/hold-start-v1"].validity.every(function (c) { return $("g2-methodology-text").textContent.indexOf("- " + c) !== -1; });
      report.stateOptions = $("g2-state").options.length;
      report.targetsInDays0 = $("g2-targets-table").querySelectorAll('tr.pick[data-state="days0"]').length;
      report.targetsOtherStates = Array.prototype.map.call($("g2-targets-table").querySelectorAll("tr.pick"), function (tr) { return tr.dataset.state + ":" + tr.dataset.bin; });
      setTarget(300);
      report.targetInfo = $("g2-target-info").textContent;
      report.protocolHasMethodology = $("g2-protocol").textContent.indexOf("Methodology: gold/gbp/hold-start-v1") !== -1;
      report.protocolHasNoHardware = $("g2-protocol").textContent.indexOf("NOTE: No hardware sample exists") !== -1;
      report.scheduleA = ($("g2-schedule").textContent.match(/A cue \(long beep\)\s+([0-9.]+) s/) || [])[1];
      report.anchorEnabled = !$("g2-anchor-btn").disabled;
      $("g2-got").value = String(G.lookup(DATA, "gold", "gbp", "days0", 302).tid); $("g2-got-lid").value = "";
      record();
      report.outcome = $("g2-outcome").textContent.split("\n")[1];
      report.correctionAfter = $("g2-correction").value;
      report.stored = JSON.parse(storageGet(STORE_KEY_CAL) || "{}");
      // the bin outlier guard (16 bins = 64 frames) and the duplicate guard
      $("g2-got").value = String(G.lookup(DATA, "gold", "gbp", "days0", 316).tid);
      record();
      report.outlierRefused = $("g2-outcome").textContent.indexOf("more than 60 frames (15 bins") !== -1 && report.stored["gse/menu"].samples.length === 1;
      $("g2-got").value = String(G.lookup(DATA, "gold", "gbp", "days0", 302).tid);
      record();
      report.duplicateRefused = $("g2-outcome").textContent.indexOf("same attempt entered twice") !== -1;
      // an outcome from a first-boot-only state teaches nothing about the correction, and says where it IS produced
      $("g2-got").value = "$6F53"; $("g2-got-lid").value = "$03E9";
      record();
      report.elsewhereOutcome = $("g2-outcome").textContent;
      $("g2-got-lid").value = "";
      // the invert panel: the published Lucky ID pair's single-press neighbour, first boot only
      $("g2-invert-tid").value = "$6F53"; $("g2-invert-lid").value = "$03E9"; $("g2-invert-scope").value = "all";
      invertNow();
      report.invertOut = $("g2-invert-out").textContent;
      report.invertButtons = $("g2-invert-buttons").querySelectorAll("button").length;
      // the reset anchor on GSE adds the fade and stall
      $("g2-anchor").value = "reset"; $("g2-anchor").dispatchEvent(new Event("change"));
      report.resetHold = ($("g2-schedule").textContent.match(/hold START window\s+([0-9.]+)/) || [])[1];
      report.resetMenu = ($("g2-schedule").textContent.match(/menu box visible\s+([0-9.]+)/) || [])[1];
      $("g2-anchor").value = "menu"; $("g2-anchor").dispatchEvent(new Event("change"));
      // Silver on GSE in a halted-clock state: the 55785 single-press hit, first boot only
      $("g2-game").value = "silver"; $("g2-game").dispatchEvent(new Event("change"));
      $("g2-state").value = "halt-days260"; $("g2-state").dispatchEvent(new Event("change"));
      report.silverHaltTargets = Array.prototype.map.call($("g2-targets-table").querySelectorAll('tr.pick[data-state="halt-days260"]'), function (tr) { return tr.dataset.bin + ":" + tr.cells[4].textContent + ":" + tr.cells[7].textContent; });
      report.silverHaltProtocolFirstBoot = (setTarget(457), $("g2-protocol").textContent.indexOf("FIRST-BOOT-ONLY state") !== -1);
      // a DMG offers hold-start and late-start; Crystal has one state, a Game Boy Color the menu and power-on anchors
      $("g2-platform").value = "dmg"; $("g2-platform").dispatchEvent(new Event("change"));
      report.dmgMethodologies = Array.prototype.map.call($("g2-methodology").options, function (o) { return o.value; });
      $("g2-game").value = "crystal"; $("g2-game").dispatchEvent(new Event("change"));
      $("g2-platform").value = "gbc"; $("g2-platform").dispatchEvent(new Event("change"));
      report.crystalStates = $("g2-state").options.length;
      report.crystalAnchors = Array.prototype.map.call($("g2-anchor").options, function (o) { return o.value; });
      setTarget(300);
      report.crystalTarget = $("g2-target-info").textContent;
      // back to Gold on GSE: one Space on this tab anchors the Gen 2 cue (the Gen 1 tab's handler stays quiet)
      $("g2-game").value = "gold"; $("g2-game").dispatchEvent(new Event("change"));
      $("g2-platform").value = "gse"; $("g2-platform").dispatchEvent(new Event("change"));
      var navBtn = document.querySelector("button[data-tab=g2tid]");
      if (navBtn) navBtn.click();
      report.g2TabActive = tabEl.classList.contains("active");
      setTarget(300);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
      report.spaceAnchoredGen2 = $("g2-cue-log").textContent.indexOf("anchor at") === 0;
      report.cueLogNamesMode = /^anchor at \d\d:\d\d:\d\d  \[RUN mode\]\n/.test($("g2-cue-log").textContent);
      report.gen1CueLogQuiet = $("g1-cue-log").textContent === "";
      CUE.stop("cancel");
      // verify: the bin-300 TID at its own time is consistent, 2 s later it is not
      $("g2-verify-tid").value = String(G.lookup(DATA, "gold", "gbp", "days0", 300).tid); $("g2-verify-lid").value = "";
      $("g2-verify-s").value = "20.13"; verifyNow();
      report.verifyConsistent = $("g2-verify-out").textContent.indexOf("CONSISTENT") !== -1 && $("g2-verify-out").textContent.indexOf("INCONSISTENT") === -1;
      $("g2-verify-s").value = "22.13"; verifyNow();
      report.verifyInconsistent = $("g2-verify-out").textContent.indexOf("INCONSISTENT") !== -1;
      // the RUN / PRACTICE-HUNT wall: a sample recorded in PRACTICE / HUNT lands in the practice store, stamped,
      // the RUN store is untouched, and back in RUN the practice sample is not in force
      report.modeDefault = MODE.get();
      report.correctionInRunBefore = $("g2-correction").value;
      var runStoreBefore = storageGet(STORE_KEY_CAL);
      $("mode-practice").checked = true; $("mode-practice").dispatchEvent(new Event("change"));
      report.modeAfterToggle = MODE.get();
      report.correctionInPracticeBefore = $("g2-correction").value;
      $("g2-got").value = String(G.lookup(DATA, "gold", "gbp", "days0", 304).tid); $("g2-got-lid").value = "";
      record();
      report.practiceOutcome = $("g2-outcome").textContent.split("\n")[1];
      report.practiceStored = JSON.parse(storageGet(calStoreKey(MODE.PRACTICE)) || "{}");
      report.runStoreUnchangedByPractice = storageGet(STORE_KEY_CAL) === runStoreBefore;
      report.correctionInPractice = $("g2-correction").value;
      $("mode-practice").checked = false; $("mode-practice").dispatchEvent(new Event("change"));
      report.modeBack = MODE.get();
      report.correctionBackInRun = $("g2-correction").value;
      // a practice sample planted in the RUN store, and one of a mode this head does not know: never in force, named
      var calSnapshot = JSON.stringify(cal);
      var practiceSample = report.practiceStored["gse/menu"].samples[0];
      cal["gse/menu"].samples.push(practiceSample);
      cal["gse/menu"].samples.push(Object.assign({}, practiceSample, { mode: "hunt", attempt: "h1" }));
      refreshAnchor();
      report.runNoteAboutPractice = $("g2-correction-note").textContent.indexOf("recorded in \"hunt\" (unknown mode), PRACTICE / HUNT mode, not RUN") !== -1;
      report.correctionWithPlanted = $("g2-correction").value;
      report.samplesInForceWithPlanted = samplesFor(cal, "gse", "menu", st.plat.methodologyId, MODE.RUN).length;
      cal = JSON.parse(calSnapshot);
      storageSet(STORE_KEY_CAL, calSnapshot);
      refreshAnchor(); refreshStats();
      // nothing the self-test did reached the real localStorage
      var real = {};
      try { [STORE_KEY_CAL, calStoreKey(MODE.PRACTICE), MODE.KEY].forEach(function (k) { real[k] = root.localStorage ? root.localStorage.getItem(k) : null; }); } catch (e) { real.error = String(e); }
      report.realStorage = real;
      var el = document.createElement("pre");
      el.id = "g2-selftest";
      el.textContent = JSON.stringify(report);
      document.body.appendChild(el);
    } catch (e) {
      var bad = document.createElement("pre");
      bad.id = "g2-selftest";
      bad.textContent = JSON.stringify({ error: String(e && e.stack || e) });
      document.body.appendChild(bad);
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
