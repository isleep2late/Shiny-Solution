// The Gen 1 Trainer ID tab (TARGET mode: game -> console -> methodology -> target -> anchor ->
// protocol -> cue -> "What did you get?") and the Emerald / FireRed / LeafGreen Secret ID
// branch, over core/gen1tid.js and core/data/{gen1-tid,gen3-sid}.json. The wording follows
// RNG Solution's terminal front end (rngsolution/cli.py, sidcli.py): the protocol's steps ARE
// the methodology, run mode is human input only (the anchor is your button press, the outcome
// is the Trainer ID you type), and nothing reads the game.
//
// The pure part (data resolution, protocol text, schedule rendering, calibration records,
// statistics text) is exported as ShinyGen1TidUi so tests can load it in node; the DOM part
// mounts only when the page has the tab.
(function (root) {
  var G = root.ShinyGen1Tid;
  var DATA = root.ShinyGen1Data;
  var SID = root.ShinyGen3SidData;
  var MODE = root.ShinyMode;                                     // webapp/mode.js: the RUN / PRACTICE-HUNT wall's switch
  var FN = root.ShinyFootnotes;                                  // webapp/footnotes.js: the citation footnotes over core/data/citations.json
  if (!MODE) throw new Error("webapp/mode.js (ShinyMode) must load before gen1tid-ui.js");
  if (!FN) throw new Error("webapp/footnotes.js (ShinyFootnotes) must load before gen1tid-ui.js");
  var STORE_KEY_CAL = "shinySolution.gen1tid.calibration";      // RUN mode: {"<platform>/<anchor>": {"samples": [...]}} (RNG Solution's config.json shape)
  // PRACTICE / HUNT mode keeps its own store, STORE_KEY_CAL + ".practice" (calStoreKey): a mode never reads the other's.
  var STORE_KEY_PINS = "shinySolution.gen1tid.sidPins";         // {"<methodology>/<tid>": [{pid, shiny, note, when, mode}]}; PRACTICE / HUNT: + ".practice" (pinStoreKey)
  var STORE_KEY_RESET = "shinySolution.gen1tid.resetAdjust";    // {"<platform>": {frames, mode, when}} (a bare number: a RUN record from before modes); PRACTICE / HUNT: + ".practice" (resetStoreKey)
  var METHODOLOGY_SENTENCE = "Predictions are valid only under this methodology.";
  var RULES_LINE = "Run mode uses only your own input: you press the anchor button and type the Trainer ID you saw. Nothing reads the screen, the emulator or the console.";
  var ANY_PERCENT = "Any% save corruption";
  // The derivation tag is a claim about evidence, so it is computed from the evidence, not from the
  // list of verified targets (rngsolution/cli.py derivation_tag, rngsolution/tables.py
  // verified_evidence_in_repo). The flat claim is only printed when the three derivations are a
  // fixture shipped in RNG Solution; Red's three cold boots are part of the original tidderive
  // sweep, whose logs are in neither repository, so Red's verified targets get the qualified tag.
  // The DECISION itself now lives in the engine (core/gen1tid.js derivationTag), not here: this tab
  // is one of three heads that render it, and the third - the website's page.tsx - reimplemented it
  // from list membership and reimplemented the bug with it. tools/sync-shiny-core.sh copies the
  // engine to the website, so all three now call the same function.
  var FIXTURE_PREFIX = G.FIXTURE_PREFIX;
  var VERIFIED_TAG = G.VERIFIED_TAG;
  var VERIFIED_OFF_REPO_TAG = G.VERIFIED_OFF_REPO_TAG;
  var ONE_DERIVATION_TAG = G.ONE_DERIVATION_TAG;
  var SID_GAMES = ["emerald", "firered", "leafgreen"];
  var DEFAULT_GAME = "red";
  var LEAD_S = 0.02;          // the buffer is started this long after the anchor, with the same offset into the buffer
  var ATTACK_MS = 2.0, RELEASE_MS = 5.0, AMPLITUDE = 0.5;

  function isNil(x) { return x === null || x === undefined; }
  function f(x, d, plus) { return G.pyFixed(x, d, plus); }
  function fmtSf(seconds) {
    var frames = seconds * G.FPS;
    if (Math.abs(frames - Math.round(frames)) < 1e-6) return f(seconds, 3) + " s (" + Math.round(frames) + " frames)";
    return f(seconds, 3) + " s (" + f(frames, 1) + " frames)";
  }
  function fmtMs(ms) { return f(ms, 1) + " ms (" + f(G.msToFrames(ms), 2) + " frames)"; }
  function fmtPct(p) { return f(100.0 * p, 0) + " %"; }
  function fmtAttempts(p) { var a = G.expectedAttempts(p); return a === Infinity ? "inf" : f(a, 1); }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function hex4(n) { var s = (n >>> 0).toString(16).toUpperCase(); while (s.length < 4) s = "0" + s; return s; }
  function hex8(n) { var s = (n >>> 0).toString(16).toUpperCase(); while (s.length < 8) s = "0" + s; return s; }
  function nowStamp() {
    var d = new Date();
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
  }

  // ---- storage (localStorage in a browser, memory elsewhere) ---------------------------
  // Under ?g1selftest (tests/run-tests.sh drives the tab headless) storage is memory-only, so the
  // self-test's recorded sample never lands in a visitor's real calibration, pins or reset adjusts.
  var mem = {};
  var MEMORY_ONLY = !!(root.location && typeof root.location.search === "string" && root.location.search.indexOf("g1selftest") !== -1);
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

  // ---- data resolution (rngsolution/tables.py) -----------------------------------------
  function supportedGames(data) {
    return Object.keys(data.games).filter(function (k) { return data.games[k].status === "supported"; });
  }

  // (default methodology id, the ids offered) for a platform under one game: Red uses the
  // platform's own; another game offers its methodologies whose console_id is the platform's family.
  function platformMethodologies(data, platformKey, gameKey) {
    var spec = data.platforms[platformKey];
    var family = data.families[spec.family];
    gameKey = gameKey || DEFAULT_GAME;
    if (gameKey === DEFAULT_GAME) {
      var def = spec.methodology || family.methodology;
      var ids = (spec.methodologies || family.methodologies || []).slice();
      if (def && ids.indexOf(def) === -1) ids.unshift(def);
      return { def: def, ids: ids };
    }
    var g = data.games[gameKey] || {};
    var mids = (g.methodologies || []).filter(function (m) { return (data.methodologies[m] || {}).console_id === spec.family; });
    return { def: mids.length ? mids[0] : null, ids: mids };
  }

  function platformsFor(data, gameKey) {
    return Object.keys(data.platforms).map(function (k) {
      var pm = platformMethodologies(data, k, gameKey);
      return { key: k, spec: data.platforms[k], def: pm.def, ids: pm.ids };
    }).filter(function (p) { return p.def; });
  }

  function resolve(data, gameKey, platformKey, methodologyId, targetSetKeys) {
    var spec = data.platforms[platformKey];
    if (!spec) throw new Error("unknown platform " + platformKey);
    var g = data.games[gameKey];
    if (!g || g.status !== "supported") throw new Error("no runnable methodology for " + gameKey);
    var pm = platformMethodologies(data, platformKey, gameKey);
    var mid = methodologyId || pm.def;
    if (!mid || pm.ids.indexOf(mid) === -1) throw new Error("methodology " + mid + " is not available on " + platformKey + " for " + gameKey);
    var m = data.methodologies[mid];
    var family = data.families[spec.family];
    var status = spec.status || "", validation = spec.validation || "";
    if (gameKey !== DEFAULT_GAME) {
      status = m.status_short || "emulator-derived, no hardware sample yet";
      validation = m.validation || "";
    }
    // The derivation descriptor - the table, the sets in force, the re-derived offsets, the
    // EVIDENCE and its note - is built by the engine (round 6 finding A: every head that built it
    // itself could hard-wire the evidence while still calling derivationTag).
    var dp = G.derivationPlatform(data, gameKey, mid, targetSetKeys);
    var table = dp.table;
    var entries = G.tableEntries(table);
    return {
      key: platformKey, name: spec.name, gameKey: gameKey, gameName: g.name || gameKey, game: g,
      familyKey: spec.family, family: family, methodology: m, methodologyId: mid, methodologyIds: pm.ids,
      timing: m.timing, table: table, maxOffset: entries[entries.length - 1][0], distinct: m.table_data.distinct,
      tableFile: m.table_data.file, status: status, validation: validation,
      anchors: (spec.anchors || ["menu", "poweron"]).slice(), anchorNotes: spec.anchor_notes || {}, focusNote: spec.focus_note || "",
      resetKey: spec.reset, resetModel: data.reset_models[spec.reset], resetStatus: spec.reset_status || "",
      defaults: data.defaults, anchorNames: data.anchor_names || {},
      targetSets: dp.targetSets,
      visibleLagFrames: Number(m.timing.visible_lag_frames || 0), visibleLagNote: m.timing.visible_lag_note || "",
      // the methodology's own evidence and note, else the console family's - resolved by
      // G.derivationPlatform, which is the only place that decision is made
      verifiedTargets: dp.verifiedTargets, verifiedEvidence: dp.verifiedEvidence, verifiedNote: dp.verifiedNote
    };
  }

  function targetSetKeys(plat) { return plat.targetSets.map(function (s) { return s.key; }); }
  function otherTargetSetKeys(plat) {
    var inForce = targetSetKeys(plat);
    return (plat.game.target_sets || []).filter(function (k) { return inForce.indexOf(k) === -1; });
  }
  var verifiedEvidenceInRepo = G.verifiedEvidenceInRepo;
  var verifiedTag = G.verifiedTag;
  var derivationTag = G.derivationTag;
  // Say what the tag rests on, in the panel that prints it: the targets, the tag they get, the
  // methodology's note, and where the three derivations can be read (rngsolution/cli.py cmd_targets).
  function verificationLines(plat, indent) {
    indent = isNil(indent) ? "  " : indent;
    // A table with no route-valid target still has derivation evidence, and Yellow's note is the one
    // that says its sample is "every 50th offset; this table has no route-valid target to add". Returning
    // [] on an empty verified list left that corrected wording rendered by nobody.
    if (!plat.verifiedTargets.length && !plat.verifiedNote && !plat.verifiedEvidence) return [];
    var lines = [indent + "Verification: " + (plat.verifiedTargets.length
      ? "offsets " + plat.verifiedTargets.join(", ") + " " + verifiedTag(plat)
      : "no route-valid target in this table; the evidence for the table itself:")];
    if (plat.verifiedNote) lines.push(indent + "  " + plat.verifiedNote);
    // the fixtures the evidence names are RNG Solution's: it owns the derivations, this repository
    // only carries the generated tables, so say whose tests/fixtures/ a path is
    if (plat.verifiedEvidence) lines.push(indent + "  Evidence (RNG Solution): " + plat.verifiedEvidence);
    return lines;
  }
  function setTag(plat, tid) { return G.setsAccepting(tid, plat.targetSets).map(function (s) { return s.key; }).join(", "); }
  function describeTarget(plat, offset) {
    var tid = plat.table[offset];
    var v = G.verdict(tid, plat.targetSets);
    var tag = { "RUN": "route-valid (" + ANY_PERCENT + ": " + setTag(plat, tid) + ")", "no": "" }[v];
    var ver = derivationTag(plat, offset);
    return "offset " + offset + " -> " + G.formatTid(tid) + " : press A " + fmtSf(G.targetSeconds(offset)) + " after the menu" +
      (tag ? "   " + tag : "") + (ver ? " " + ver : "") + footnotesFor(plat).mark(["table", "tidRoll"]);
  }

  // ---- the sources the protocol, the target line, the schedule and verify rest on: footnotes [^n] over the citation
  // registry (webapp/footnotes.js), numbered in this fixed order so every line of the tab carries the Sources block's
  // numbers. The decomp lines are pokered's (Blue is pret's pokered built for Blue) or pokeyellow's; the table is a
  // measured source under the console's validation status word from gen1-tid.json (EMULATOR-EXACT on GSE,
  // HARDWARE-VALIDATED n where the console was sampled, EMPIRICAL otherwise) ----
  var SOURCE_ORDER = ["holdStart", "table", "menuInput", "tidRoll", "stir"];
  function statusWord(plat) {
    if (plat.status === "emulator-exact") return "EMULATOR-EXACT";
    var m = /(\d+ of \d+)/.exec(plat.validation || "");
    if (plat.status === "hardware-validated" && m) return "HARDWARE-VALIDATED " + m[1];
    return "EMPIRICAL";
  }
  function sourcesFor(plat) {
    var y = plat.gameKey === "yellow", repo = y ? "pokeyellow" : "pokered", t = plat.timing;
    return {
      holdStart: y
        ? { cite: "pokeyellow/engine/movie/title.asm:166-175", claim: "Yellow's title loop tests hJoyHeld for A or START by level on every frame, so START held anywhere in the window is read on the title's first frame and the NEW GAME menu opens on one fixed frame" }
        : { cite: "pokered/engine/movie/title.asm:227-239,266", claim: "the title screen waits on CheckForUserInterruption (one JoypadLowSensitivity poll per frame; START or A ends it), then the cry and the fade play before MainMenu, so START held anywhere in the window is read on the first poll and the NEW GAME menu opens on one fixed frame" },
      table: { measured: "the table's derivation on pokemon-speedrunning/gambatte-core with START held inside the window, docs/FACTS.md Gen 1 Trainer ID (hold-START methodologies, RNG Solution)", status: statusWord(plat),
        claim: "hold START on any frame " + t.hold_lo_frame + "-" + t.hold_hi_frame + " and the NEW GAME menu opens on frame " + t.menu_frame + "; the A press frame is the menu frame + 80 + the offset (the table's definition), one Trainer ID per offset under " + plat.methodologyId + "; " + plat.name + ": " + plat.status },
      menuInput: { cite: repo + "/engine/menus/main_menu.asm:" + (y ? "63-66,84" : "64-68,85-86"), claim: "the NEW GAME menu waits in HandleMenuInput with A, B and START watched; A on NEW GAME goes to StartNewGame, so the frame of that press is the one the offset counts" },
      tidRoll: { cite: repo + "/engine/movie/oak_speech/init_player_data.asm:1-10", section: "Gen 1/2 (Game Boy) / Gen 1 Trainer ID / Where the ID comes from", claim: "InitPlayerData2, first thing in the Oak speech, rolls the Trainer ID with two Random calls: hRandomSub is the high byte, hRandomAdd the low byte" },
      stir: { cite: repo + "/engine/math/random.asm:1-13", claim: "Random_ is the only RNG: hRandomAdd += rDIV and hRandomSub -= rDIV, called once per VBlank, so the Trainer ID is a function of the frame of the A press and of the DIV phase the hold-START boot fixes" }
    };
  }
  function footnotesFor(plat) { return FN.footnotes(sourcesFor(plat), SOURCE_ORDER); }

  function methodologyLines(plat, conditions, indent) {
    indent = isNil(indent) ? "  " : indent;
    var m = plat.methodology;
    var lines = [indent + "Methodology: " + plat.methodologyId + "   (" + (m.name || "") + "; v" + m.version + ", " + m.date + ")", indent + METHODOLOGY_SENTENCE];
    if (conditions) {
      lines.push(indent + "Valid only if:");
      (m.validity || []).forEach(function (c) { lines.push(indent + "  - " + c); });
      verificationLines(plat, indent).forEach(function (l) { lines.push(l); });
    }
    return lines;
  }
  function targetSetLines(plat) {
    if (!plat.targetSets.length) return ["Target sets: none for " + plat.gameName + " (no Trainer ID is route-valid; any ID can still be aimed at)"];
    var lines = ["Target sets in force: " + targetSetKeys(plat).join(", ")];
    plat.targetSets.forEach(function (x) {
      lines.push("  - " + x.name + " [" + G.setDescribe(x) + "]");
      if (x.provenance) lines.push("      provenance: " + x.provenance);
    });
    var others = otherTargetSetKeys(plat);
    if (others.length) lines.push("  also defined for " + plat.gameName + ", not in force: " + others.join(", "));
    return lines;
  }

  // ---- protocol text (rngsolution/cli.py protocol_lines) ----------------------------------
  function resetActionName(plat) { return plat.key === "gse" ? "Ctrl+R (hard reset)" : "the GameCube RESET button"; }
  function powerOnPhrase(plat) {
    var allowsReset = (plat.methodology.protocol || "").toLowerCase().indexOf("hard reset") !== -1;
    if (plat.key === "gse" && allowsReset) return "Power on (Ctrl+R hard reset on GSE)";
    if (plat.anchors.indexOf(G.ANCHOR_RESET) !== -1 && allowsReset) return "Power on (or hard reset)";
    return "Power on";
  }
  function webNote(text) {
    return text.replace(/press ENTER/g, "press the anchor button").replace(/your ENTER/g, "your anchor press")
      .replace(/ENTER/g, "the anchor key (Space)")
      .replace(/THIS terminal window/g, "THIS browser window").replace(/terminal window/g, "browser window");
  }

  function protocolLines(plat, anchor, offset, sched, correctionMs, beeps, spacing) {
    var holdLo = G.framesToSeconds(plat.timing.hold_lo_frame), holdHi = G.framesToSeconds(plat.timing.hold_hi_frame);
    var menu = G.framesToSeconds(plat.timing.menu_frame);
    var tid = plat.table[offset], m = plat.methodology;
    var fn = footnotesFor(plat);
    var lines = [
      "PROTOCOL  (" + plat.gameName + " on " + plat.name + ", target offset " + offset + " -> " + G.formatTid(tid) + ")",
      "    Methodology: " + plat.methodologyId + "   (" + (m.name || "") + "; v" + m.version + ", " + m.date + ")",
      "    " + METHODOLOGY_SENTENCE + " The steps below ARE the methodology: any other",
      "    input pattern (START earlier or later, a tap instead of a hold, an extra press) gives a",
      "    different, deterministic Trainer ID that this table does not cover.",
      ""
    ];
    if (plat.key === "gbp") lines.push("    NOTE: " + plat.validation, "");
    lines.push(
      " 1. Clear the save: on the title screen hold UP + SELECT + B, confirm YES, then power fully OFF.",
      "    (The clear must be on video for a submitted run. A CONTINUE option on the menu means the",
      "    attempt is invalid: the table assumes a fresh NEW GAME menu.)");
    if (plat.key === "gse") lines.push("    On GSE: keep a ROM copy with no .sav beside it, or NEW GAME silently becomes CONTINUE.");
    if (anchor === G.ANCHOR_MENU) {
      lines.push(
        " 2. " + powerOnPhrase(plat) + ". Touch nothing during the boot and intro.",
        " 3. Between " + f(holdLo, 2) + " s and " + f(holdHi, 2) + " s after the boot starts (frames " + plat.timing.hold_lo_frame + "-" + plat.timing.hold_hi_frame + "), HOLD START and keep holding." + fn.mark(["holdStart", "table"]),
        "    Anywhere inside that window gives the same result: this press is NOT timed.");
      if (m.landmark) lines.push("    Landmark: " + m.landmark);
      lines.push(
        " 4. The NEW GAME menu opens at " + f(menu, 2) + " s (frame " + plat.timing.menu_frame + "). The INSTANT you see it, press the ANCHOR button (or Space)." + fn.mark(["table", "menuInput"]),
        "    Release START whenever you like; release timing does not matter.",
        " 5. You will hear " + beeps + " short beeps " + f(spacing, 1) + " s apart, then one long high beep (the screen flashes with each).",
        "    Press A ON the long high beep. That is the only frame-exact action." + fn.mark(["tidRoll", "stir", "table"]),
        "    Target: A at " + fmtSf(G.targetSeconds(offset)) + " after the menu. The beep is " + fmtMs(correctionMs) + " early to cover your",
        "    reaction to the menu plus the audio delay (the correction; calibration tunes it).");
    } else {
      if (anchor === G.ANCHOR_RESET) lines.push(" 2. Press the ANCHOR button (or Space) at the SAME instant you press " + resetActionName(plat) + ".");
      else lines.push(" 2. Press the ANCHOR button (or Space) at the SAME instant you flip the power on.");
      var note = plat.anchorNotes[anchor] || "";
      if (note) lines.push("    " + webNote(note));
      lines.push(
        "    Touch nothing during the boot and intro.",
        " 3. Two low beeps mark the START-hold window (" + f(sched.holdLo, 2) + " s and " + f((sched.holdLo + sched.holdHi) / 2.0, 2) + " s after your anchor)." + fn.mark(["holdStart", "table"]),
        "    HOLD START on the first low beep and keep holding. Anywhere in " + f(sched.holdLo, 2) + "-" + f(sched.holdHi, 2) + " s is fine.",
        " 4. A double blip at " + f(sched.menu, 2) + " s marks when the NEW GAME menu should appear (frame " + plat.timing.menu_frame + " of the boot)." + fn.mark(["table", "menuInput"]),
        "    If the menu appears far from the blip, START was held outside the window: the",
        "    attempt is no good, reset and try again. Release START whenever.",
        " 5. Then " + (beeps - sched.droppedCountIn) + " short beeps " + f(spacing, 1) + " s apart and one long high beep. Press A ON the long high beep." + fn.mark(["tidRoll", "stir", "table"]),
        "    Target: A at " + fmtSf(G.targetSeconds(offset)) + " after the menu = " + fmtSf(sched.menu + G.targetSeconds(offset)) + " after your anchor.",
        "    The beep is " + fmtMs(correctionMs) + " early for the audio delay (this anchor's correction).");
      if (sched.droppedCountIn) lines.push("    (" + plural(sched.droppedCountIn, "count-in beep") + " left out: they would have sounded before the menu.)");
    }
    if (plat.focusNote) lines.push("", "    " + webNote(plat.focusNote));
    if (plat.targetSets.some(function (x) { return x.kind === "highbyte" || x.kind === "sled"; })) {
      lines.push(" 6. Afterwards, type the Trainer ID you got below (a Pokemon's status screen shows IDNo;",
        "    in the route, whether the corruption completes tells you the high byte was $40, which is the whole rule).");
    } else {
      lines.push(" 6. Afterwards, type the Trainer ID you got below (read it off the Trainer Card, or a",
        "    Pokemon's status screen shows IDNo).");
    }
    lines.push("    Each answer sharpens the correction." + fn.mark(["table"]));
    lines.push("");
    return lines.concat(fn.lines());
  }

  function scheduleLines(sched, offset, correctionMs, plat) {
    var lines = ["SCHEDULE (seconds after your anchor):"];
    if (plat) lines.push("  Methodology: " + plat.methodologyId);
    if (sched.anchor !== G.ANCHOR_MENU) {
      lines.push("  hold START window   " + f(sched.holdLo, 3) + " - " + f(sched.holdHi, 3) + " s   (low beeps at the start and the middle)");
      lines.push("  menu should appear  " + f(sched.menu, 3) + " s   (double blip)");
    }
    if (sched.countInTimes.length) lines.push("  count-in beeps      " + sched.countInTimes.map(function (t) { return f(t, 3); }).join(", "));
    lines.push("  A cue (long beep)   " + f(sched.tA, 3) + " s   = target " + fmtSf(G.targetSeconds(offset)) +
      (sched.anchor === G.ANCHOR_MENU ? " after the menu" : " after the menu, from your anchor") + " minus correction " + fmtMs(correctionMs) + (plat ? footnotesFor(plat).mark(["table"]) : ""));
    return lines;
  }

  function announceCue(c) {
    if (c.kind === "count") return "beep " + c.label.split("-").slice(1).join("-");
    if (c.kind === "A") return ">>> A <<<";
    if (c.kind === "hold") return c.label === "hold-start" ? "HOLD START now (keep holding)" : "still inside the hold window";
    if (c.kind === "menu") return c.label === "menu" ? "menu should appear NOW" : "";
    if (c.kind === "reset") return "RESET";
    if (c.kind === "abeat") return "A";
    if (c.kind === "power") return "POWER OFF";
    return c.label;
  }

  function buildSchedule(plat, anchor, offset, correctionMs, beeps, spacing) {
    var opts = { family: plat.timing, beeps: beeps, spacingS: spacing };
    if (anchor === G.ANCHOR_RESET) opts.resetExtraS = G.resetAnchorExtraSeconds(plat.resetModel);
    return G.schedule(anchor, offset, correctionMs, opts);
  }

  // ---- rendering: one buffer per schedule, every tone on an exact sample ------------------
  // The same synthesis as RNG Solution's audio.render (2 ms attack, 5 ms release, amplitude 0.5,
  // sin(w * (i + 1))), so the spacing between sounds cannot jitter once the buffer plays.
  function renderCues(cues, rate, tailS) {
    if (!cues || !cues.length) throw new Error("nothing to render");
    if (isNil(tailS)) tailS = 0.25;
    var end = 0, i, c;
    for (i = 0; i < cues.length; i++) {
      c = cues[i];
      end = Math.max(end, Math.round(c.t * rate) + Math.round(c.ms / 1000.0 * rate));
    }
    var total = end + Math.floor(tailS * rate) + 1;
    var buf = new Float32Array(total);
    var na = Math.max(1, Math.floor(ATTACK_MS / 1000.0 * rate)), nr = Math.max(1, Math.floor(RELEASE_MS / 1000.0 * rate));
    var onsets = {};
    for (i = 0; i < cues.length; i++) {
      c = cues[i];
      var s0 = Math.round(c.t * rate), n = Math.round(c.ms / 1000.0 * rate), w = 2.0 * Math.PI * c.freq / rate;
      for (var j = 0; j < n; j++) {
        var env = Math.min(1.0, (j + 1) / na) * Math.min(1.0, (n - j) / nr);
        var v = buf[s0 + j] + AMPLITUDE * env * Math.sin(w * (j + 1));
        buf[s0 + j] = Math.max(-1.0, Math.min(1.0, v));
      }
      onsets[c.label] = s0;
    }
    return { samples: buf, rate: rate, length: total, onsets: onsets };
  }

  // ---- calibration records (rngsolution/config.py over timeline.py) -------------------------
  // Every record carries the mode it was made in ("run" | "practice") and each mode has its own
  // store; inside a store, a record under another methodology or made in the other mode is left
  // out of the correction and named in a note (RNG Solution's per-methodology rule, applied to
  // modes too), so a practice-derived correction is never in force in a run.
  function calKey(platformKey, anchor) { return platformKey + "/" + anchor; }
  function calStoreKey(mode) { return MODE.storeKey(STORE_KEY_CAL, mode); }
  function loadCalibration(mode) { return loadJson(calStoreKey(mode), {}); }
  function saveCalibration(cal, mode) { saveJson(calStoreKey(mode), cal); }
  function allSamples(cal, platformKey, anchor) { return ((cal[calKey(platformKey, anchor)] || {}).samples || []).slice(); }
  function samplesFor(cal, platformKey, anchor, methodologyId, mode) {
    return MODE.splitByMode(G.splitByMethodology(allSamples(cal, platformKey, anchor), methodologyId).kept, mode).kept;
  }
  // {methodology: under another methodology, mode: under this methodology but made in the other mode}
  function ignoredSamples(cal, platformKey, anchor, methodologyId, mode) {
    var byMethodology = G.splitByMethodology(allSamples(cal, platformKey, anchor), methodologyId);
    var byMode = MODE.splitByMode(byMethodology.kept, mode);
    return { methodology: byMethodology.rest, mode: byMode.rest };
  }
  function correctionInForce(cal, plat, anchor, mode) {
    return G.meanCorrection(samplesFor(cal, plat.key, anchor, plat.methodologyId, mode), plat.defaults.correction_ms[anchor]);
  }
  function describeSampleMethodology(s) { return s.methodology || "no methodology (recorded before methodology ids existed)"; }
  function ignoredSampleLines(cal, plat, anchor, mode) {
    var ign = ignoredSamples(cal, plat.key, anchor, plat.methodologyId, mode);
    var lines = [];
    if (ign.methodology.length) {
      var others = {};
      ign.methodology.forEach(function (x) { others[describeSampleMethodology(x)] = true; });
      lines.push("NOTE: " + plural(ign.methodology.length, "stored sample") + " for " + plat.key + "/" + anchor + " ignored: recorded under " +
        Object.keys(others).sort().join(", ") + ", not " + plat.methodologyId + ". Samples are never mixed across methodologies.");
    }
    if (ign.mode.length) {
      var modes = {};
      ign.mode.forEach(function (x) { modes[MODE.describeMode(x)] = true; });   // a mode this head does not know is named, never thrown on
      lines.push("NOTE: " + plural(ign.mode.length, "stored sample") + " for " + plat.key + "/" + anchor + " ignored: recorded in " +
        Object.keys(modes).sort().join(", ") + " mode, not " + MODE.label(mode) + ". Samples are never mixed across modes: a practice-derived correction is never in force in a run.");
    }
    return lines;
  }

  // The outcome of one attempt: the typed Trainer ID inverted to the offset nearest the aim, the
  // implied correction, and (unless refused by the outlier / duplicate guard) the sample recorded.
  function recordOutcome(cal, plat, anchor, aimed, correctionUsed, tid, opts) {
    var o = opts || {};
    var mode = MODE.checkMode(o.mode);         // the record must say which mode it was made in
    var out = { tid: tid, aimed: aimed, offsets: G.invert(plat.table, tid), lines: [], added: false, refused: null, hit: null, implied: null };
    out.lines.push("You got " + G.formatTid(tid) + ": " + G.verdictText(tid, plat.targetSets) + ".");
    if (!out.offsets.length) {
      out.lines.push("  That Trainer ID is not in the " + plat.name + " table, so nothing can be learned from it.",
        "  Usual causes: START held outside the window, the save was not cleared (CONTINUE menu),",
        "  a different console family, or the press was later than the table's " + f(G.targetSeconds(plat.maxOffset), 1) + " s.",
        "  Correction unchanged.");
      return out;
    }
    var hit = G.nearestOffset(out.offsets, aimed);
    out.hit = hit;
    if (out.offsets.length > 1) out.lines.push("  (" + G.formatTid(tid) + " comes from offsets " + out.offsets.join(", ") + "; using " + hit + ", the one nearest your aim)");
    var err = G.errorFrames(hit, aimed);
    if (err === 0) out.lines.push("  You hit offset " + hit + " exactly (aimed " + aimed + ").");
    else out.lines.push("  You hit offset " + hit + ", aimed " + aimed + ": " + Math.abs(err) + " frames " + (err > 0 ? "late" : "early") + " (" + f(Math.abs(G.framesToMs(err)), 1) + " ms).");
    out.implied = G.impliedCorrection(correctionUsed, hit, aimed);
    out.lines.push("  This attempt implies a correction of " + f(out.implied, 1) + " ms (used " + f(correctionUsed, 1) + " ms).");
    var sample = G.makeSample(tid, aimed, hit, correctionUsed, { attempt: o.attempt || null, player: o.player || "webaudio", methodology: plat.methodologyId });
    sample.when = o.when || nowStamp();
    sample.mode = mode;
    var key = calKey(plat.key, anchor);
    var stored = allSamples(cal, plat.key, anchor);
    try {
      var kept = G.addSample(stored, sample, !!o.force);
      cal[key] = { samples: kept };
    } catch (e) {
      if (e.name === "OutlierSample") {
        out.refused = "outlier";
        out.lines.push("  That is more than " + G.OUTLIER_FRAMES + " frames (" + f(G.framesToSeconds(G.OUTLIER_FRAMES), 1) + " s) from the aim: NOT added to the calibration (" + anchor + " anchor).",
          "  Usual causes: START held outside the window (the table does not apply to that attempt),",
          "  a mistyped Trainer ID, or the ID of a different attempt. If it really was this attempt, tick 'force' and record again.");
        return out;
      }
      if (e.name === "DuplicateSample") {
        out.refused = "duplicate";
        out.lines.push("  Looks like the same attempt entered twice (same Trainer ID and the same aim): not added (" + anchor + " anchor).",
          "  Tick 'force' if it really was a new attempt.");
        return out;
      }
      throw e;
    }
    out.added = true;
    var n = samplesFor(cal, plat.key, anchor, plat.methodologyId, mode).length;
    out.newCorrection = correctionInForce(cal, plat, anchor, mode);
    out.lines.push("  Correction updated to " + f(out.newCorrection, 1) + " ms (" + plural(n, "sample") + ", " + anchor + " anchor).",
      "  Methodology: " + plat.methodologyId + " (recorded with the sample; only samples under it are averaged).",
      "  Mode: " + MODE.label(mode) + " (recorded with the sample; only samples made in this mode are averaged, from this mode's own store).");
    out.lines = out.lines.concat(ignoredSampleLines(cal, plat, anchor, mode).map(function (l) { return "  " + l; }));
    return out;
  }

  function inScope(s, plat, mode) { return s.methodology === plat.methodologyId && MODE.effectiveMode(s) === mode; }
  // the newest sample under this methodology made in this mode; others stay where they are
  function dropLastSample(cal, plat, anchor, mode) {
    MODE.checkMode(mode);
    var key = calKey(plat.key, anchor);
    var stored = allSamples(cal, plat.key, anchor);
    for (var i = stored.length - 1; i >= 0; i--) {
      if (inScope(stored[i], plat, mode)) {
        var dropped = stored[i];
        stored.splice(i, 1);
        cal[key] = { samples: stored };
        return dropped;
      }
    }
    return null;
  }
  function clearSamples(cal, plat, anchor, allMethodologies, mode) {
    MODE.checkMode(mode);
    var key = calKey(plat.key, anchor);
    var stored = allSamples(cal, plat.key, anchor);
    if (allMethodologies) { delete cal[key]; return { removed: stored, kept: [] }; }
    var removed = [], kept = [];
    stored.forEach(function (s) { (inScope(s, plat, mode) ? removed : kept).push(s); });
    if (kept.length) cal[key] = { samples: kept }; else delete cal[key];
    return { removed: removed, kept: kept };
  }
  function sampleLine(x) {
    return "  " + (x.when || "") + "  aimed " + x.aimed + "  hit " + x.hit + "  used " + f(x.correction_used_ms, 1) + " ms  implied " + f(x.implied_ms, 1) + " ms  " + G.formatTid(x.tid);
  }

  // ---- the runner's timing (rngsolution/cli.py hit_summary, stats_block) --------------------
  function hasSpread(st) { return st.n >= 2 && st.sdMs === st.sdMs; }
  function pRangeText(sd, n, centred) {
    var r = G.hitProbabilityRange(sd, n, G.FRAME_MS, G.SD_INTERVAL_CONF, centred);
    var tag = Math.round(100 * G.SD_INTERVAL_CONF) + " % range " + fmtPct(r[0]).replace(" %", "") + "-" + fmtPct(r[1]);
    if (n < G.SMALL_N) tag += ", n = " + n + ": rough, aim not yet centred";
    return tag;
  }
  function hitSummary(samples, anchor, methodologyId) {
    var st = G.anchorStats(samples);
    if (hasSpread(st)) {
      var h = G.hitProbabilityHeadline(st.sdMs, st.n);
      return { p: h.p, line: "P(hit) with your current sd: about " + fmtPct(h.p) + " (" + pRangeText(st.sdMs, st.n, h.centred) + "; " + anchor +
        " anchor, sd " + f(st.sdMs, 1) + " ms = " + f(G.msToFrames(st.sdMs), 2) + " frames over " + st.n + " attempts) -> about " + fmtAttempts(h.p) + " attempts per hit" };
    }
    return { p: null, line: "P(hit): no spread estimate yet. 2+ calibrated attempts on the " + anchor + " anchor under " + methodologyId + " give one." };
  }
  function statsLines(samples, plat, anchor, mode) {
    var st = G.anchorStats(samples);
    var def = plat.defaults.correction_ms[anchor];
    var lines = [plat.name + " / " + anchor + " anchor  (methodology " + plat.methodologyId + (isNil(mode) ? "" : ", " + MODE.label(mode) + " mode") + ")"];
    if (st.n === 0) {
      lines.push("  n 0: no calibrated attempts; correction " + fmtMs(def) + " (default)");
      lines.push("  recommendation: cue an attempt and type the Trainer ID you got; 2 give a spread, 3+ a drift check.");
      return lines;
    }
    lines.push("  n " + st.n + "   mean " + f(st.meanMs, 1) + " ms (the correction in force)   sd " +
      (hasSpread(st) ? f(st.sdMs, 1) + " ms (" + f(G.msToFrames(st.sdMs), 2) + " frames)" : "n/a (1 sample)") +
      "   robust sd (MAD x 1.4826) " + (hasSpread(st) ? f(st.robustSdMs, 1) + " ms" : "n/a") + "   range " + f(st.minMs, 1) + ".." + f(st.maxMs, 1) + " ms");
    var dr = G.drift(st.valuesMs);
    if (hasSpread(st)) {
      var h = G.hitProbabilityHeadline(st.sdMs, st.n);
      lines.push("  P(hit) about " + fmtPct(h.p) + " (" + pRangeText(st.sdMs, st.n, h.centred) + ") -> about " + fmtAttempts(h.p) + " attempts per hit   (aim centred in the frame: " +
        fmtPct(G.hitProbability(st.sdMs)) + "; not centred: " + fmtPct(G.hitProbabilityQuantised(st.sdMs)) + ")");
    }
    if (dr.flag) lines.push("  drift: RECALIBRATE / SETUP CHANGED (" + dr.strength + "): " + dr.reason + (dr.welchT === null ? "" : "; Welch t " + f(dr.welchT, 2)));
    else if (dr.strength === "weak") lines.push("  drift: none flagged, a shift inside the scatter (" + dr.reason + ")");
    else lines.push("  drift: none (" + dr.reason + (dr.welchT === null ? "" : "; Welch t " + f(dr.welchT, 2)) + ")");
    var rec = G.recommendation(st, dr, G.FRAME_MS, null, false);
    lines.push("  recommendation [" + rec[0] + "]: " + rec[1]);
    samples.forEach(function (x) { lines.push(sampleLine(x)); });
    return lines;
  }

  // ---- the save-corruption reset metronome (rngsolution/cli.py cmd_reset) --------------------
  // The remembered adjustment per console follows the mode like the calibration samples: each
  // mode has its own store (resetStoreKey), every record says which mode it was made in, and a
  // record of the other mode that turns up in a store is not applied and said so.
  function resetStoreKey(mode) { return MODE.storeKey(STORE_KEY_RESET, mode); }
  function loadResetAdjust(mode) { return loadJson(resetStoreKey(mode), {}); }
  function saveResetAdjust(adj, mode) { saveJson(resetStoreKey(mode), adj); }
  // the stored record for one console, normalised: a bare number is a RUN record from before modes existed
  function resetAdjustEntry(adj, platformKey) {
    var e = adj[platformKey];
    if (isNil(e)) return null;
    if (typeof e === "number") return { frames: e };
    return e && typeof e === "object" && typeof e.frames === "number" ? e : null;
  }
  // {frames: the adjustment in force (0 when none), ignored: the stored record of another mode, or null}
  function resetAdjustFor(adj, platformKey, mode) {
    MODE.checkMode(mode);
    var e = resetAdjustEntry(adj, platformKey);
    if (!e) return { frames: 0, ignored: null };
    return MODE.effectiveMode(e) === mode ? { frames: e.frames, ignored: null } : { frames: 0, ignored: e };
  }
  function setResetAdjust(adj, platformKey, frames, mode) {
    adj[platformKey] = { frames: frames, mode: MODE.checkMode(mode), when: nowStamp() };
    return adj[platformKey];
  }
  function resetAdjustIgnoredLine(entry, platformKey, mode) {
    return "NOTE: the remembered adjustment for " + platformKey + " (" + f(entry.frames, 2, true) + " frames) ignored: recorded in " + MODE.describeMode(entry) +
      " mode, not " + MODE.label(mode) + ". Adjustments are never mixed across modes: a practice-derived value is never in force in a run.";
  }
  function resetPlan(plat, preset, adjustFrames, fadeFrames, intervalOverride, pairs, cadence) {
    var ri = G.resetInterval(plat.resetModel, preset, isNil(fadeFrames) ? null : fadeFrames, adjustFrames || 0);
    var interval = isNil(intervalOverride) ? ri.centreMs : intervalOverride;
    var first = ri.order[0], second = ri.order[1];
    var lines = ["SAVE-CORRUPTION RESET on " + plat.name + ", " + preset + " path",
      "  Order: " + first + " first, then " + second + " " + fmtMs(interval) + " later.",
      "  Safe press-to-press window (any pad phase): " + f(ri.physLoMs, 1) + " - " + f(ri.physHiMs, 1) + " ms (" + f(ri.physLoFrames, 2) + " - " + f(ri.physHiFrames, 2) + " frames);",
      "    conservative (worst observed pad-read phase): " + f(ri.consLoMs, 1) + " - " + f(ri.consHiMs, 1) + " ms.",
      "  Model terms (from the A frame boundary): safe " + f(ri.boundaryLoMs, 1) + " - " + f(ri.boundaryHiMs, 1) + " ms, centre " + f(ri.boundaryCentreMs, 1) +
        " ms; mean timings " + f(ri.meanLoMs, 1) + " - " + f(ri.meanHiMs, 1) + " ms."];
    if (adjustFrames) lines.push("  Adjustment applied: " + f(adjustFrames, 2, true) + " frames (" + f(G.framesToMs(adjustFrames), 1, true) + " ms).");
    if (!isNil(fadeFrames)) lines.push("  Modelled fade overridden: " + f(fadeFrames, 2) + " frames.");
    if (!isNil(intervalOverride) && !(ri.physLoMs <= interval && interval <= ri.physHiMs)) lines.push("  WARNING: " + f(interval, 1) + " ms is outside the safe press-to-press window.");
    lines.push("", "About these numbers (" + plat.name + "): " + plat.resetStatus + ".");
    if (plat.resetKey === "gbp-fade") {
      lines.push("  The save-timing side (checksum at 21.39 frames after A, party data at 25.39) is measured in the emulator.",
        "  The Game Boy Player's RESET fade (35.16-36.16 frames) is gambatte-speedrun's community constant; on real",
        "  hardware it is unverified, and every frame it differs moves this interval by one frame (16.7 ms).",
        "  Calibrate from OUTCOMES, never from 'RESET -> screen black': in the model the picture is already black",
        "  for the last 65 ms before the reset. Try adjust +1 / -1 (frames) and note which intervals give the",
        "  255-Pokemon file on CONTINUE.");
    } else {
      lines.push("  The save timing (checksum at 21.39 frames after A, party data at 25.39) is measured in the emulator;",
        "  a power switch has no fade, so the cut must land inside that 67 ms. Unverified on hardware: try",
        "  adjust +1 / -1 (frames) and note which intervals give the 255-Pokemon file.");
    }
    lines.push("  The A press is only seen by the game at its next pad read (0.18 frames after a frame boundary), so the",
      "  window between your two PRESSES is narrower than the model's own: the numbers above are the press-to-press",
      "  ones. Aim for the centre; the edges are the limit, not a target.",
      "  PRACTICE-SAVE TRAP: saving over a file with the SAME Trainer ID (e.g. from a practice save) runs 3 frames",
      "  (50 ms) later than the real route's first save. Use the practice-save preset for that, route for real attempts.");
    if (plat.resetKey === "gbp-fade") lines.push("  At the 'Would you like to SAVE the game?' YES/NO box: press " + first + " on the low beat, A on the high beat.");
    else lines.push("  At the 'Would you like to SAVE the game?' YES/NO box: press A on the high beat, cut the power on the low beat.");
    var sched = G.resetSchedule(interval, ri.order, pairs || plat.defaults.reset_pairs, cadence || plat.defaults.reset_cadence_s, 1.0);
    lines.push("", "Metronome: " + sched.cues.length / 2 + " pairs, one every " + f(cadence || plat.defaults.reset_cadence_s, 1) + " s, first " + first + " beat 1.0 s after the anchor.");
    return { interval: ri, intervalMs: interval, schedule: sched, lines: lines };
  }

  // ---- verify (moderators; human-measured input) --------------------------------------------
  function verifyLines(plat, tid, menuToPressS, fromVisible, toleranceFrames, lagOverride) {
    var lag = isNil(lagOverride) ? plat.visibleLagFrames : lagOverride;
    var rPress = G.verify(plat.table, tid, menuToPressS, toleranceFrames, 0.0, plat.targetSets);
    var rVis = G.verify(plat.table, tid, menuToPressS, toleranceFrames, lag, plat.targetSets);
    var r = fromVisible ? rVis : rPress, other = fromVisible ? rPress : rVis;
    var fn = footnotesFor(plat);
    var lines = [G.formatTid(tid) + " on " + plat.name + " (" + plat.gameName + "): " + G.verdictText(tid, plat.targetSets)];
    lines = lines.concat(methodologyLines(plat, true));
    if (fromVisible) {
      lines.push("  measured menu -> first VISIBLE effect of the A press: " + f(menuToPressS, 3) + " s; minus the " + plat.familyKey.toUpperCase() + " press-to-visible lag",
        "  of " + f(lag, 2) + " frames (" + (plat.visibleLagNote || "no lag known for this console") + ") = offset " + f(r.predictedOffset, 1) + fn.mark(["table"]));
    } else {
      lines.push("  measured menu -> A press: " + f(menuToPressS, 3) + " s = offset " + f(r.predictedOffset, 1) + " (" + f(menuToPressS, 3) + " s x " + f(G.FPS, 4) + " fps - " + G.MENU_TO_TABLE_FRAMES + ")" + fn.mark(["table"]));
    }
    if (!r.inTable) {
      lines.push("  this Trainer ID is produced by NO press time on this console: INCONSISTENT with the table" + fn.mark(["table", "tidRoll"]));
      return { consistent: false, lines: lines.concat([""], fn.lines()) };
    }
    lines.push("  the table produces it at offset" + (r.offsets.length > 1 ? "s " : " ") + r.offsets.join(", ") + fn.mark(["table", "tidRoll"]));
    lines.push("  nearest offset " + r.nearest + " is " + f(r.differenceFrames, 1) + " frames from the measurement (tolerance +-" + toleranceFrames + " frames): " + (r.consistent ? "CONSISTENT" : "INCONSISTENT"));
    if (lag && other.consistent !== r.consistent) {
      lines.push("  NOTE: read the other way (measured from " + (fromVisible ? "the press" : "the visible effect") + ") it is " + f(other.differenceFrames, 1) + " frames off: " + (other.consistent ? "CONSISTENT" : "INCONSISTENT") + ".",
        "  On a Game Boy Player or DMG capture the press itself is invisible: the screen reacts " + f(lag, 2) + " frames later",
        "  (" + (plat.familyKey === "gba" ? "provisional" : "fitted on two runs") + "). Say which you measured.");
    }
    lines.push("  (this checks timing against the table only, and only under the methodology above; it says nothing else about the run)");
    return { consistent: r.consistent, lines: lines.concat([""], fn.lines()) };
  }

  // ---- Gen 3: the Secret ID from a typed Trainer ID (rngsolution/sidcli.py) --------------------
  function sidMethodologyFor(sidData, gameKey) {
    var g = sidData.games[gameKey];
    var m = g && sidData.methodologies[g.methodology];
    if (!m) throw new Error(gameKey + " has no Secret ID methodology in the data");
    return m;
  }
  function sidMethodologyLines(m, conditions) {
    var lines = ["Methodology: " + m.id + "   (" + m.name + "; v" + m.version + ", " + m.date + ")", METHODOLOGY_SENTENCE, "  status: " + m.status];
    if (conditions) {
      lines.push("Valid only if:");
      m.validity.forEach(function (c) { lines.push("  - " + c); });
    }
    return lines;
  }
  function sidModelFor(m, speed, path) {
    var model = G.variant(m.model, path || null);
    if (!model.text_speed[speed]) throw new Error("text speed " + speed + " is not measured for " + m.id + " on the " + (model.variant || "only") + " path (measured: " + Object.keys(model.text_speed).sort().join(", ") + ")");
    return model;
  }
  function sidDefaultKRange(model, nameLength, speed) {
    var lo = G.kFixed(model, nameLength, speed);
    return [lo, lo + (model.k_default_span || 1200)];
  }
  function sidCue(m, nameLength, speed, margin, early, late, path) {
    var model = sidModelFor(m, speed, path);
    var w = G.kWindowForCue(model, nameLength, speed, margin, early, late);
    var cues = w.beeps.map(function (b, i) {
      var last = i === w.beeps.length - 1, tone = last ? G.A_CUE_TONE : G.COUNT_IN_TONE;
      return { t: G.gbaFramesToSeconds(b[1]), freq: tone[0], ms: tone[1], label: b[0], kind: last ? "A" : "count" };
    });
    return { kExpected: w.kExpected, kMin: w.kMin, kMax: w.kMax, beeps: w.beeps, model: model,
      schedule: { anchor: "naming-ok", cues: cues, tA: cues[cues.length - 1].t, countInTimes: [], duration: cues[cues.length - 1].t + cues[cues.length - 1].ms / 1000.0 } };
  }
  function sidCueProtocolLines(m, gameName, nameLength, speed, margin, cue) {
    var model = cue.model;
    var lines = ["CUE PROTOCOL (" + gameName + ", " + nameLength + "-letter name, " + speed + " text speed" + (model.variant ? ", " + model.name : "") + ")",
      "  Methodology: " + m.id, "  " + METHODOLOGY_SENTENCE,
      "  The Trainer ID cannot be chosen (a sub-frame Timer1 count); this cue pins k, the VBlank count from",
      "  the naming-screen exit to the Secret ID roll, by making every press after naming land at a known time.",
      " 1. Play to the player naming screen and enter your name normally (" + nameLength + " letters; set the length above if not).",
      " 2. Press the ANCHOR button (or Space) at the SAME instant you press A on OK. That is the anchor. Touch nothing else.",
      " 3. Beeps follow, one per press: tap A ON each beep, once. Never press while the text is still printing:",
      "    that press is swallowed AND arms the hold-to-speed-up (text.c:944-952), after which a held A changes",
      "    the counts; a plain held A on a waiting box is harmless (measured). Never press B: on the name box",
      "    B answers NO and re-rolls the Trainer ID.",
      "    Each beep comes " + margin + " frames (" + f(G.gbaFramesToSeconds(margin), 2) + " s) after its box is first ready, so a press a little late is fine;",
      "    a press BEFORE the box is ready is swallowed and the attempt is void.",
      "    Only the LAST press (the long high beep) sets k: k = fixed + " + cue.beeps.length + " x " + margin + " + your lateness on that press."];
    cue.beeps.forEach(function (b) {
      lines.push("      " + f(G.gbaFramesToSeconds(b[1]), 3) + " s  " + b[0] + "  " + ((model.stage_text || {})[b[0]] || b[0]));
    });
    lines.push(" 4. Afterwards read the Trainer ID off the Trainer Card and type it below: the Secret ID candidates for",
      "    k in " + cue.kMin + "-" + cue.kMax + " (expected " + cue.kExpected + ") are listed. Pin one later with a PID you can see is shiny or not.",
      "  Constants: OK->seed " + model.ok_to_seed + " frames, per-stage ready times and last press->roll " + model.text_speed[speed].last_press_to_sid + " frames, " + (model.status || "EMPIRICAL (libmgba)") + ".");
    return lines;
  }
  // Pins follow the mode like the calibration samples: each mode has its own store (pinStoreKey),
  // every pin says which mode it was made in, and a pin of the other mode that turns up in a store
  // never filters the listing and is said so.
  function pinKey(methodologyId, tid) { return methodologyId + "/" + tid; }
  function pinStoreKey(mode) { return MODE.storeKey(STORE_KEY_PINS, mode); }
  function loadPins(mode) { return loadJson(pinStoreKey(mode), {}); }
  function savePins(pins, mode) { saveJson(pinStoreKey(mode), pins); }
  function allPins(pins, methodologyId, tid) { return (pins[pinKey(methodologyId, tid)] || []).slice(); }
  // the pins made in this mode (the ones the listing uses)
  function pinsFor(pins, methodologyId, tid, mode) { return MODE.splitByMode(allPins(pins, methodologyId, tid), mode).kept; }
  // the pins of another mode in the same store: never used, named in the listing
  function ignoredPins(pins, methodologyId, tid, mode) { return MODE.splitByMode(allPins(pins, methodologyId, tid), mode).rest; }
  function addPin(pins, methodologyId, tid, pid, shiny, note, mode) {
    MODE.checkMode(mode);                      // the pin must say which mode it was made in
    var key = pinKey(methodologyId, tid), all = allPins(pins, methodologyId, tid), list = pinsFor(pins, methodologyId, tid, mode);
    for (var i = 0; i < list.length; i++) {
      if (list[i].pid === pid && list[i].shiny !== shiny) throw new Error("PID " + hex8(pid) + " is already pinned as " + (list[i].shiny ? "shiny" : "not shiny"));
      if (list[i].pid === pid) return list;
    }
    var pin = { pid: pid, shiny: !!shiny, note: note || "", when: nowStamp(), mode: mode };
    all.push(pin);
    pins[key] = all;
    return list.concat([pin]);
  }
  // removes this mode's pins for the ID; pins of the other mode in the store stay where they are
  function clearPins(pins, methodologyId, tid, mode) {
    var key = pinKey(methodologyId, tid), split = MODE.splitByMode(allPins(pins, methodologyId, tid), mode);
    if (split.rest.length) pins[key] = split.rest; else delete pins[key];
    return { removed: split.kept, kept: split.rest };
  }
  function pinLines(list, m, tid, mode, ignored) {
    var lines = !list.length ? ["Pins: none stored for " + m.id + " / Trainer ID " + tid + " in " + MODE.label(mode) + " mode (add one with a PID you can see is shiny or not)"]
      : ["Pins stored for " + m.id + " / Trainer ID " + tid + " (" + MODE.label(mode) + " mode's store):"];
    list.forEach(function (p) { lines.push("  PID " + hex8(p.pid) + "  " + (p.shiny ? "SHINY" : "not shiny") + (p.note ? "  " + p.note : "") + (p.when ? "  [" + p.when + "]" : "")); });
    if (ignored && ignored.length) {
      var modes = {};
      ignored.forEach(function (p) { modes[MODE.describeMode(p)] = true; });
      lines.push("  NOTE: " + plural(ignored.length, "stored pin") + " for " + m.id + " / Trainer ID " + tid + " ignored: recorded in " + Object.keys(modes).sort().join(", ") +
        " mode, not " + MODE.label(mode) + ". Pins are never mixed across modes.");
    }
    return lines;
  }
  // The listing: candidates for k in [kMin, kMax], filtered by the pins and the one-off PIDs.
  function sidListing(m, gameName, tid, nameLength, speed, path, kMin, kMax, pinList, extraShiny, extraNon, tsv, cued) {
    var model = sidModelFor(m, speed, path);
    var def = sidDefaultKRange(model, nameLength, speed);
    var lo = isNil(kMin) ? def[0] : kMin, hi = isNil(kMax) ? def[1] : kMax;
    if (lo < 0 || hi < lo) throw new Error("need 0 <= k-min <= k-max (got " + lo + ", " + hi + ")");
    var cands = G.sidCandidates(tid, lo, hi);
    var shiny = pinList.filter(function (p) { return p.shiny; }).map(function (p) { return p.pid; }).concat(extraShiny || []);
    var non = pinList.filter(function (p) { return !p.shiny; }).map(function (p) { return p.pid; }).concat(extraNon || []);
    var fc = G.filterCandidates(cands, tid, shiny, non, isNil(tsv) ? null : tsv);
    var lines = ["Trainer ID " + G.formatTid(tid) + ": Secret ID = high 16 bits of the LCRNG after k+1 advances from seed = Trainer ID,",
      "  k = VBlank advances from the naming-screen exit to the roll (one Random() per VBlank; nothing else on the path).",
      "  k range " + lo + "-" + hi + ": fixed part " + G.kFixed(model, nameLength, speed) + " for a " + nameLength + "-letter name at " + speed + " text speed" +
        (model.variant ? " on the " + model.variant + " path" : "") + " (every press on the first frame it is accepted)" +
        ((isNil(kMin) && isNil(kMax) && !cued) ? ", plus up to " + (def[1] - def[0]) + " frames (" + f(G.gbaFramesToSeconds(def[1] - def[0]), 0) + " s) of waiting on the " + model.stages.length + " presses" : "")];
    if (cued) lines.push("  cued attempt: expected k " + cued.kExpected + " (window " + lo + "-" + hi + ")");
    var filt = [];
    if (shiny.length) filt.push(plural(shiny.length, "known shiny PID"));
    if (non.length) filt.push(plural(non.length, "known non-shiny PID"));
    if (!isNil(tsv)) filt.push("TSV " + tsv);
    lines.push("  " + plural(cands.length, "candidate") + (filt.length ? ", " + fc.kept.length + " after the filters (" + filt.join(", ") + ")" : ""));
    var out = { candidates: cands, kept: fc.kept, lines: lines, single: null };
    if (!fc.kept.length) {
      lines.push("  NO candidate survives: the pins contradict this k range (widen k-min/k-max), a pin is wrong,",
        "  or the attempt broke the protocol (a swallowed press, NO on the name box, another text speed).");
      return out;
    }
    if (fc.kept.length === 1) {
      var c = fc.kept[0];
      out.single = c;
      lines.push("  Secret ID " + c.sid + " ($" + hex4(c.sid) + "), TSV " + c.tsv + ", k = " + c.k + ": the only candidate under the pins.");
    } else if (shiny.length) {
      var sids = {};
      fc.kept.forEach(function (c) { sids[c.sid] = true; });
      var keys = Object.keys(sids).map(Number).sort(function (a, b) { return a - b; });
      lines.push("  A known shiny PID allows only 8 Secret IDs (" + keys.length + " of them in range: " + keys.slice(0, 8).map(function (s) { return "$" + hex4(s); }).join(", ") + "); a second shiny, or the exact k, settles it.");
    } else {
      lines.push("  Narrow it: catch anything, look at it, and pin its PID as shiny (it IS shiny) or not shiny.");
    }
    return out;
  }

  var api = {
    RULES_LINE: RULES_LINE, METHODOLOGY_SENTENCE: METHODOLOGY_SENTENCE, SID_GAMES: SID_GAMES, LEAD_S: LEAD_S,
    fmtSf: fmtSf, fmtMs: fmtMs, fmtPct: fmtPct, fmtAttempts: fmtAttempts, hex4: hex4, hex8: hex8,
    supportedGames: supportedGames, platformMethodologies: platformMethodologies, platformsFor: platformsFor, resolve: resolve,
    targetSetKeys: targetSetKeys, otherTargetSetKeys: otherTargetSetKeys, derivationTag: derivationTag, setTag: setTag, describeTarget: describeTarget,
    VERIFIED_TAG: VERIFIED_TAG, VERIFIED_OFF_REPO_TAG: VERIFIED_OFF_REPO_TAG, ONE_DERIVATION_TAG: ONE_DERIVATION_TAG,
    verifiedEvidenceInRepo: verifiedEvidenceInRepo, verifiedTag: verifiedTag, verificationLines: verificationLines,
    methodologyLines: methodologyLines, targetSetLines: targetSetLines, protocolLines: protocolLines, scheduleLines: scheduleLines,
    SOURCE_ORDER: SOURCE_ORDER, statusWord: statusWord, sourcesFor: sourcesFor, footnotesFor: footnotesFor, procedureProblems: FN.procedureProblems,
    announceCue: announceCue, buildSchedule: buildSchedule, renderCues: renderCues,
    calKey: calKey, calStoreKey: calStoreKey, loadCalibration: loadCalibration, saveCalibration: saveCalibration, allSamples: allSamples, samplesFor: samplesFor,
    ignoredSamples: ignoredSamples, correctionInForce: correctionInForce, ignoredSampleLines: ignoredSampleLines, recordOutcome: recordOutcome,
    dropLastSample: dropLastSample, clearSamples: clearSamples, sampleLine: sampleLine,
    hitSummary: hitSummary, statsLines: statsLines, pRangeText: pRangeText,
    resetStoreKey: resetStoreKey, loadResetAdjust: loadResetAdjust, saveResetAdjust: saveResetAdjust, resetAdjustFor: resetAdjustFor, setResetAdjust: setResetAdjust,
    resetAdjustIgnoredLine: resetAdjustIgnoredLine, resetPlan: resetPlan, verifyLines: verifyLines,
    sidMethodologyFor: sidMethodologyFor, sidMethodologyLines: sidMethodologyLines, sidModelFor: sidModelFor, sidDefaultKRange: sidDefaultKRange,
    sidCue: sidCue, sidCueProtocolLines: sidCueProtocolLines, pinStoreKey: pinStoreKey, loadPins: loadPins, savePins: savePins, allPins: allPins, pinsFor: pinsFor,
    ignoredPins: ignoredPins, addPin: addPin, clearPins: clearPins, pinLines: pinLines, sidListing: sidListing,
    _storage: { get: storageGet, set: storageSet }
  };
  root.ShinyGen1TidUi = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  // ======================= the DOM part =======================
  if (typeof document === "undefined" || !document.getElementById("tab-g1tid") || !G || !DATA || !SID) return;

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

  // -- audio: one AudioContext, one buffer per playback, started on the audio clock with the
  //    offset that aligns buffer time 0 with the anchor click (the output latency is what the
  //    correction absorbs).
  var audio = null;
  function ensureAudio() { if (!audio) audio = new (root.AudioContext || root.webkitAudioContext)(); return audio; }
  // A context created before any gesture starts suspended (autoplay policy). Resuming it on the first
  // gesture in the tab means it is already running at the anchor click; play() says so when it was not.
  function warmAudio() {
    try { var ctx = ensureAudio(); if (ctx.state === "suspended") ctx.resume(); } catch (e) { /* no audio here */ }
  }
  var player = { running: false, source: null, raf: 0, t0: 0, sched: null, announced: 0, onDone: null, display: null, log: null, prepared: null };

  function prepare(sched) {
    var ctx = ensureAudio();
    var r = renderCues(sched.cues, ctx.sampleRate);
    var buffer = ctx.createBuffer(1, r.length, ctx.sampleRate);
    buffer.getChannelData(0).set(r.samples);
    player.prepared = { sched: sched, buffer: buffer };
    return player.prepared;
  }
  function flash(kind) {
    var el = $("g1-flash");
    el.className = "on " + kind;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = ""; }, kind === "A" ? 220 : 90);
  }
  function play(sched, displayEl, logEl, onDone, announce) {
    if (player.running) return;
    var ctx = ensureAudio();
    var p = player.prepared && player.prepared.sched === sched ? player.prepared : prepare(sched);
    player.running = true; player.sched = sched; player.announced = 0; player.onDone = onDone; player.display = displayEl; player.log = logEl;
    player.announce = announce || announceCue;
    player.t0 = performance.now();
    var stateAtAnchor = ctx.state;
    logEl.textContent = "anchor at " + nowStamp().split(" ")[1] + "  [" + MODE.label(MODE.get()) + " mode]\n";
    Promise.resolve(ctx.state === "suspended" ? ctx.resume() : null).then(function () {
      if (!player.running || player.sched !== sched) return;
      var elapsed = (performance.now() - player.t0) / 1000.0;
      var src = ctx.createBufferSource();
      src.buffer = p.buffer;
      src.connect(ctx.destination);
      src.start(ctx.currentTime + LEAD_S, elapsed + LEAD_S);
      player.source = src;
      if (stateAtAnchor !== "running") {
        logEl.textContent += "  audio was " + stateAtAnchor + " at the anchor: output began " + f(elapsed * 1000.0, 1) + " ms after the click (aligned by the buffer offset; if this attempt's ID is off, discard it rather than calibrate on it)\n";
      }
      var latency = ctx.outputLatency || ctx.baseLatency || 0;
      if (latency > 0 && !player.latencyShown) { player.latencyShown = true; logEl.textContent += "  browser output latency " + f(latency * 1000.0, 1) + " ms (constant: the correction absorbs it)\n"; }
    });
    tick();
  }
  function tick() {
    if (!player.running) return;
    var sched = player.sched, elapsed = (performance.now() - player.t0) / 1000.0;
    while (player.announced < sched.cues.length && sched.cues[player.announced].t <= elapsed) {
      var c = sched.cues[player.announced++];
      var text = player.announce(c);
      if (text) player.log.textContent += "  " + f(c.t, 3) + "  " + text + "\n";
      flash(c.kind === "A" || c.kind === "abeat" ? "A" : c.kind);
    }
    if (!isNil(sched.tA) && sched.tA !== null) {
      var left = sched.tA - elapsed;
      player.display.textContent = left > 0 ? "A in " + f(left, 3) + " s" : "A!";
      player.display.classList.toggle("soon", left > 0 && left < 4.5);
    } else {
      player.display.textContent = f(elapsed, 1) + " s";
    }
    if (elapsed > sched.duration + 0.3) {
      stop("done");
      return;
    }
    player.raf = requestAnimationFrame(tick);
  }
  function stop(reason) {
    if (!player.running) return;
    player.running = false;
    cancelAnimationFrame(player.raf);
    if (player.source) { try { player.source.stop(); } catch (e) { /* already ended */ } player.source = null; }
    player.display.classList.remove("soon");
    if (reason === "done") { player.display.textContent = "done"; if (player.onDone) player.onDone(); }
    else { player.display.textContent = "cancelled"; player.log.textContent += "  stopped\n"; }
  }
  // The page has one AudioContext, one player and one flash element; the Gen 2 TID tab (gen2tid-ui.js) plays
  // its schedules through these, so a cue running in either tab blocks the other's anchor.
  api.cuePlayer = { prepare: prepare, play: play, stop: stop, warmAudio: warmAudio, running: function () { return player.running; } };

  // -- state
  var st = { plat: null, offset: null, anchor: G.ANCHOR_MENU, sched: null, correction: null, attempt: null, sidCue: null };
  var mode = MODE.get();
  var cal = loadCalibration(mode);
  var pins = loadPins(mode);
  MODE.subscribe(function (m) {
    // the other mode's stores, never merged: the correction, the stats, the notes, the remembered reset
    // adjustment and the Secret ID pins are re-read from them
    mode = m;
    cal = loadCalibration(m);
    pins = loadPins(m);
    $("g1-correction")._manual = false;
    $("g1-reset-adjust")._touched = false;
    if (st.plat) { refreshAnchor(); refreshStats(); refreshReset(); }
    if ($("sid-tid").value.trim()) sidRun();
  });

  function currentTargetSetKeys() {
    var keys = [];
    document.querySelectorAll("#g1-targetsets input[type=checkbox]").forEach(function (cb) { if (cb.checked) keys.push(cb.value); });
    return keys;
  }
  function refreshPlatform(keepTarget) {
    var game = $("g1-game").value;
    var plats = platformsFor(DATA, game);
    fill($("g1-platform"), plats.map(function (p) { return { value: p.key, text: p.spec.name + "   [" + (game === DEFAULT_GAME ? p.spec.status : (DATA.methodologies[p.def].status_short || "emulator-derived, no hardware sample yet")) + "]" }; }), $("g1-platform").value);
    var pk = $("g1-platform").value;
    var pm = platformMethodologies(DATA, pk, game);
    fill($("g1-methodology"), pm.ids.map(function (id) { return { value: id, text: id + ": " + (DATA.methodologies[id].name || "") }; }), $("g1-methodology").value || pm.def);
    $("g1-methodology-row").style.display = pm.ids.length > 1 ? "" : "none";
    // target sets: the game's sets, the defaults ticked
    var g = DATA.games[game];
    var box = $("g1-targetsets");
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
      st.plat = resolve(DATA, game, pk, $("g1-methodology").value, currentTargetSetKeys());
    } catch (e) {
      setText("g1-status", "cannot resolve: " + e.message);
      return;
    }
    var plat = st.plat;
    var menu = G.framesToSeconds(plat.timing.menu_frame);
    setText("g1-status", plat.gameName + " on " + plat.name + " [" + plat.status + "]: hold START " + f(G.framesToSeconds(plat.timing.hold_lo_frame), 2) + "-" +
      f(G.framesToSeconds(plat.timing.hold_hi_frame), 2) + " s after the boot starts (frames " + plat.timing.hold_lo_frame + "-" + plat.timing.hold_hi_frame +
      "); the NEW GAME menu opens at " + f(menu, 2) + " s (frame " + plat.timing.menu_frame + ").\n" + plat.validation);
    setText("g1-methodology-text", methodologyLines(plat, true, "").concat([""], targetSetLines(plat)));
    // targets
    var hits = G.routeValidTargets(plat.table, plat.targetSets);
    var rows = "<tr><th>offset</th><th>Trainer ID</th><th>A after the menu</th><th>after the boot starts</th><th>set</th><th>derivation</th></tr>";
    hits.forEach(function (h) {
      rows += '<tr class="pick" data-offset="' + h[0] + '"><td>' + h[0] + "</td><td class=mono>" + G.formatTid(h[1]) + "</td><td>" + fmtSf(G.targetSeconds(h[0])) + "</td><td>" +
        fmtSf(menu + G.targetSeconds(h[0])) + "</td><td>" + setTag(plat, h[1]) + "</td><td>" + derivationTag(plat, h[0]) + "</td></tr>";
    });
    if (!hits.length) rows += "<tr><td colspan=6>none in offsets 0-" + plat.maxOffset + " (" + f(G.targetSeconds(plat.maxOffset), 1) + " s after the menu): no press time in this table produces an accepted ID. Type a Trainer ID or an offset.</td></tr>";
    $("g1-targets-table").innerHTML = "<table>" + rows + "</table>";
    $("g1-targets-table").querySelectorAll("tr.pick").forEach(function (tr) { tr.addEventListener("click", function () { setTarget(Number(tr.dataset.offset)); }); });
    setText("g1-table-note", "Table: " + plat.tableFile + ", offsets 0-" + plat.maxOffset + ", " + plat.distinct + " distinct IDs, methodology " + plat.methodologyId + ".");
    // anchors
    fill($("g1-anchor"), plat.anchors.map(function (a) { return { value: a, text: a + ": " + (plat.anchorNames[a] || a) }; }), plat.anchors.indexOf(st.anchor) !== -1 ? st.anchor : plat.anchors[0]);
    st.anchor = $("g1-anchor").value;
    if (!keepTarget || st.offset === null || isNil(plat.table[st.offset])) st.offset = null;
    refreshAnchor();
    refreshReset();
    refreshStats();
  }
  function setTarget(offset) {
    st.offset = offset;
    setText("g1-target-info", "Target: " + describeTarget(st.plat, offset));
    refreshAnchor();
  }
  function refreshAnchor() {
    var plat = st.plat;
    st.anchor = $("g1-anchor").value || plat.anchors[0];
    var samples = samplesFor(cal, plat.key, st.anchor, plat.methodologyId, mode);
    var inForce = correctionInForce(cal, plat, st.anchor, mode);
    if (!$("g1-correction")._manual) $("g1-correction").value = f(inForce, 1);
    st.correction = numOr("g1-correction", inForce);
    var ignored = ignoredSampleLines(cal, plat, st.anchor, mode);
    setText("g1-correction-note", ($("g1-correction")._manual ? "Correction: " + fmtMs(st.correction) + " (typed for this session; in force " + fmtMs(inForce) + ")" :
      "Correction in force: " + fmtMs(inForce) + " (" + (samples.length === 0 ? "default, no calibration yet" : "mean of " + plural(samples.length, "calibrated attempt")) + ", " + MODE.label(mode) + " mode's store)") +
      (ignored.length ? "\n" + ignored.join("\n") : ""));
    st.sched = null;
    if (st.offset === null) {
      setText("g1-protocol", "Pick a target first (a row above, a typed Trainer ID, or an offset).");
      setText("g1-schedule", "");
      $("g1-anchor-btn").disabled = true;
      return;
    }
    var beeps = Math.max(0, Math.round(numOr("g1-beeps", plat.defaults.count_in_beeps)));
    var spacing = numOr("g1-spacing", plat.defaults.count_in_spacing_s);
    try {
      st.sched = buildSchedule(plat, st.anchor, st.offset, st.correction, beeps, spacing);
    } catch (e) {
      setText("g1-protocol", "cannot build the cue: " + e.message + ". If the correction is the problem, clear the samples or type another correction.");
      setText("g1-schedule", "");
      $("g1-anchor-btn").disabled = true;
      return;
    }
    setText("g1-protocol", protocolLines(plat, st.anchor, st.offset, st.sched, st.correction, beeps, spacing));
    setText("g1-schedule", scheduleLines(st.sched, st.offset, st.correction, plat));
    setText("g1-phit", hitSummary(samples, st.anchor, plat.methodologyId).line);
    $("g1-anchor-btn").disabled = false;
    $("g1-display").textContent = "A at " + f(st.sched.tA, 3) + " s after the anchor";
    try { prepare(st.sched); } catch (e) { /* no AudioContext until a gesture: rendered on the click */ }
  }
  function anchorNow() {
    if (!st.sched || player.running) return;
    st.attempt = nowStamp() + "/" + f(performance.now() / 1000.0, 3);
    play(st.sched, $("g1-display"), $("g1-cue-log"), function () {
      $("g1-cue-log").textContent += "Done. Target was offset " + st.offset + " -> " + G.formatTid(st.plat.table[st.offset]) + " under " + st.plat.methodologyId + ". Type the Trainer ID you got below.\n";
      $("g1-got").focus();
    });
  }
  function record() {
    if (!st.plat || st.offset === null) { setText("g1-outcome", "Load a target and play a cue first."); return; }
    var text = $("g1-got").value;
    var tid;
    try { tid = G.parseTid(text); } catch (e) { setText("g1-outcome", "not a Trainer ID (" + e.message + ")"); return; }
    var r = recordOutcome(cal, st.plat, st.anchor, st.offset, st.correction, tid, { force: $("g1-force").checked, attempt: st.attempt, mode: mode });
    if (r.added) { saveCalibration(cal, mode); $("g1-force").checked = false; $("g1-correction")._manual = false; }
    setText("g1-outcome", r.lines);
    refreshAnchor();
    refreshStats();
  }
  function refreshStats() {
    var plat = st.plat;
    setText("g1-stats", statsLines(samplesFor(cal, plat.key, st.anchor, plat.methodologyId, mode), plat, st.anchor, mode));
  }
  function refreshReset() {
    var plat = st.plat;
    var ra = resetAdjustFor(loadResetAdjust(mode), plat.key, mode);
    if (!$("g1-reset-adjust")._touched) $("g1-reset-adjust").value = ra.frames;
    var iv = $("g1-reset-interval").value === "" ? null : numOr("g1-reset-interval", null);
    try {
      st.reset = resetPlan(plat, $("g1-reset-preset").value, numOr("g1-reset-adjust", 0), null, iv, Math.max(1, Math.round(numOr("g1-reset-pairs", plat.defaults.reset_pairs))), numOr("g1-reset-cadence", plat.defaults.reset_cadence_s));
      setText("g1-reset-text", st.reset.lines.concat(ra.ignored ? ["", resetAdjustIgnoredLine(ra.ignored, plat.key, mode)] : []));
      $("g1-reset-start").disabled = false;
    } catch (e) {
      st.reset = null;
      setText("g1-reset-text", "cannot build the metronome: " + e.message);
      $("g1-reset-start").disabled = true;
    }
  }
  function findOffsets() {
    var plat = st.plat;
    var tid;
    try { tid = G.parseTid($("g1-tid").value); } catch (e) { setText("g1-invert", "not a Trainer ID (" + e.message + ")"); return; }
    var offs = G.invert(plat.table, tid);
    var lines = [G.formatTid(tid) + " on " + plat.name + " (" + plat.gameName + "): " + G.verdictText(tid, plat.targetSets)];
    if (!offs.length) { lines.push("  not in this table: no press time produces it on this console."); setText("g1-invert", lines); return; }
    var menu = G.framesToSeconds(plat.timing.menu_frame);
    var html = "";
    offs.forEach(function (o) {
      lines.push("  offset " + o + ": A pressed " + fmtSf(G.targetSeconds(o)) + " after the menu, " + fmtSf(menu + G.targetSeconds(o)) + " after the boot starts");
      html += '<button class="secondary" data-offset="' + o + '">aim at offset ' + o + "</button> ";
    });
    if (offs.length > 1) lines.push("  (two press times give this ID: pick the one nearest your rough menu-to-press time)");
    setText("g1-invert", lines);
    var holder = $("g1-invert-buttons");
    holder.innerHTML = html;
    holder.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { setTarget(Number(b.dataset.offset)); }); });
  }
  function verifyNow() {
    var plat = st.plat;
    var tid;
    try { tid = G.parseTid($("g1-verify-tid").value); } catch (e) { setText("g1-verify-out", "not a Trainer ID (" + e.message + ")"); return; }
    var s = numOr("g1-verify-s", NaN);
    if (!isFinite(s)) { setText("g1-verify-out", "give the menu-to-press seconds measured from the video"); return; }
    var r = verifyLines(plat, tid, s, $("g1-verify-from").value === "visible", Math.max(0, Math.round(numOr("g1-verify-tol", 3))), null);
    setText("g1-verify-out", r.lines);
  }

  // -- SID branch
  function sidRefresh() {
    var game = $("sid-game").value;
    var m = sidMethodologyFor(SID, game);
    var isFrlg = game !== "emerald";
    $("sid-rival-row").style.display = isFrlg ? "" : "none";
    if (isFrlg && !$("sid-speed").value) $("sid-speed").value = "mid";
    setText("sid-methodology-text", sidMethodologyLines(m, true));
  }
  function sidInputs() {
    var game = $("sid-game").value, m = sidMethodologyFor(SID, game);
    var speed = $("sid-speed").value;
    if (!speed) {
      if (game === "emerald") throw new Error("choose the text speed: Emerald's main menu has an OPTION entry and the PSR route sets FAST there before NEW GAME (a fresh cartridge is MID); the fixed part is 680 / 1645 / 2937 frames for a 1-letter name, so the tool will not guess");
      speed = "mid";
    }
    var path = game === "emerald" ? null : "rival-" + $("sid-rival").value;
    var nameLength = Math.min(7, Math.max(1, Math.round(numOr("sid-namelen", 7))));
    return { game: game, m: m, speed: speed, path: path, nameLength: nameLength, gameName: SID.games[game].name };
  }
  function parsePidList(text) {
    return text.split(/[\s,]+/).filter(function (x) { return x; }).map(function (x) { return G.parsePid(x); });
  }
  function sidRun() {
    var out = [];
    try {
      var inp = sidInputs();
      var tid = G.parseTid($("sid-tid").value);
      var model = sidModelFor(inp.m, inp.speed, inp.path);
      out.push(inp.gameName + ": Secret ID from a typed Trainer ID", "  [TARGET] The Trainer ID is human input: read it off the Trainer Card and type it. Nothing reads the game.");
      out.push("  input path: " + (model.name || "the one measured path") + "; text speed " + inp.speed +
        (inp.game !== "emerald" && inp.speed !== "mid" ? " (carried over from an existing save: a fresh FireRed / LeafGreen save is MID)" : "") + "; " + inp.nameLength + "-letter player name");
      var pinList = $("sid-nopins").checked ? [] : pinsFor(pins, inp.m.id, tid, mode);
      out = out.concat(pinLines(pinList, inp.m, tid, mode, $("sid-nopins").checked ? [] : ignoredPins(pins, inp.m.id, tid, mode)));
      var kMin = $("sid-kmin").value === "" ? null : Math.round(numOr("sid-kmin", 0));
      var kMax = $("sid-kmax").value === "" ? null : Math.round(numOr("sid-kmax", 0));
      var cued = st.sidCue && sidCueMatches(st.sidCue, inp) ? st.sidCue : null;
      if (cued && kMin === null && kMax === null) { kMin = cued.kMin; kMax = cued.kMax; }
      var tsv = $("sid-tsv").value === "" ? null : Math.round(numOr("sid-tsv", 0));
      var r = sidListing(inp.m, inp.gameName, tid, inp.nameLength, inp.speed, inp.path, kMin, kMax, pinList,
        parsePidList($("sid-shiny-pid").value), parsePidList($("sid-nonshiny-pid").value), tsv, cued);
      out = out.concat([""], r.lines);
      var limit = Math.max(0, Math.round(numOr("sid-limit", 60)));
      var shown = limit && r.kept.length > limit ? r.kept.slice(0, limit) : r.kept;
      var rows = "<tr><th>k</th><th>SID</th><th>hex</th><th>TSV</th></tr>";
      shown.forEach(function (c) { rows += "<tr><td>" + c.k + "</td><td>" + c.sid + "</td><td class=mono>$" + hex4(c.sid) + "</td><td>" + c.tsv + "</td></tr>"; });
      if (shown.length < r.kept.length) rows += "<tr><td colspan=4>... " + (r.kept.length - shown.length) + " more (limit 0 lists all)</td></tr>";
      $("sid-table").innerHTML = r.kept.length ? "<table>" + rows + "</table>" : "";
    } catch (e) {
      out.push("  " + e.message);
      $("sid-table").innerHTML = "";
    }
    setText("sid-out", out);
  }
  function sidPin(shiny) {
    try {
      var inp = sidInputs();
      var tid = G.parseTid($("sid-tid").value);
      var pid = G.parsePid($("sid-pin-pid").value);
      addPin(pins, inp.m.id, tid, pid, shiny, $("sid-pin-note").value, mode);
      savePins(pins, mode);
      setText("sid-pin-out", "pinned PID " + hex8(pid) + " as " + (shiny ? "SHINY" : "not shiny") + " for " + inp.m.id + " / Trainer ID " + tid +
        " (" + MODE.label(mode) + " mode's store; pins are kept per methodology, per Trainer ID and per mode, never shared)");
      sidRun();
    } catch (e) { setText("sid-pin-out", "pin refused: " + e.message); }
  }
  function sidPinsClear() {
    try {
      var inp = sidInputs();
      var tid = G.parseTid($("sid-tid").value);
      var r = clearPins(pins, inp.m.id, tid, mode);
      savePins(pins, mode);
      setText("sid-pin-out", "cleared " + plural(r.removed.length, "pin") + " for " + inp.m.id + " / Trainer ID " + tid + " (" + MODE.label(mode) + " mode)" +
        (r.kept.length ? "; " + plural(r.kept.length, "pin") + " of the other mode kept, untouched" : ""));
      sidRun();
    } catch (e) { setText("sid-pin-out", e.message); }
  }
  // The cue's k window belongs to the model it was rendered for; changing the game, text speed,
  // rival path, name length or margin drops it (sidDropCue), and sidRun uses it only when it matches.
  function sidCueMatches(cue, inp) {
    var c = cue.forInputs;
    return !!c && c.game === inp.game && c.speed === inp.speed && c.path === inp.path && c.nameLength === inp.nameLength;
  }
  function sidDropCue() { st.sidCue = null; $("sid-cue-btn").disabled = true; setText("sid-protocol", ""); }
  function sidPrepareCue() {
    try {
      var inp = sidInputs();
      var margin = Math.max(0, Math.round(numOr("sid-margin", 30)));
      var cue = sidCue(inp.m, inp.nameLength, inp.speed, margin, 6, 20, inp.path);
      cue.forGame = inp.game;
      cue.forInputs = { game: inp.game, speed: inp.speed, path: inp.path, nameLength: inp.nameLength, margin: margin };
      st.sidCue = cue;
      setText("sid-protocol", sidCueProtocolLines(inp.m, inp.gameName, inp.nameLength, inp.speed, margin, cue));
      $("sid-cue-btn").disabled = false;
      $("sid-display").textContent = "last press at " + f(cue.schedule.tA, 3) + " s after the anchor";
      try { prepare(cue.schedule); } catch (e) { /* rendered on the click */ }
    } catch (e) {
      st.sidCue = null;
      setText("sid-protocol", e.message);
      $("sid-cue-btn").disabled = true;
    }
  }
  function sidAnchorNow() {
    if (!st.sidCue || player.running) return;
    play(st.sidCue.schedule, $("sid-display"), $("sid-cue-log"), function () {
      $("sid-cue-log").textContent += "Done: expected k " + st.sidCue.kExpected + " (window " + st.sidCue.kMin + "-" + st.sidCue.kMax + "). Read the Trainer ID off the Trainer Card, type it above and list the candidates.\n";
      $("sid-tid").focus();
    }, function (c) { return c.kind === "A" ? ">>> A (last press) <<<" : "A  (" + c.label + ")"; });
  }

  // -- wiring
  fill($("g1-game"), supportedGames(DATA).map(function (k) { return { value: k, text: DATA.games[k].name }; }), DEFAULT_GAME);
  $("g1-game").addEventListener("change", function () { $("g1-platform").value = ""; $("g1-methodology").value = ""; refreshPlatform(false); });
  $("g1-platform").addEventListener("change", function () { $("g1-methodology").value = ""; refreshPlatform(false); });
  $("g1-methodology").addEventListener("change", function () { refreshPlatform(false); });
  $("g1-find").addEventListener("click", findOffsets);
  $("g1-use-offset").addEventListener("click", function () {
    var o = Math.round(numOr("g1-offset", -1));
    if (!st.plat || isNil(st.plat.table[o])) { setText("g1-invert", "offsets run 0-" + (st.plat ? st.plat.maxOffset : "?")); return; }
    setTarget(o);
  });
  $("g1-anchor").addEventListener("change", function () { $("g1-correction")._manual = false; refreshAnchor(); refreshStats(); });
  $("g1-correction").addEventListener("change", function () { $("g1-correction")._manual = true; refreshAnchor(); });
  $("g1-correction-reset").addEventListener("click", function () { $("g1-correction")._manual = false; refreshAnchor(); });
  ["g1-beeps", "g1-spacing"].forEach(function (id) { $(id).addEventListener("change", refreshAnchor); });
  $("g1-anchor-btn").addEventListener("click", anchorNow);
  $("g1-cancel").addEventListener("click", function () { stop("cancel"); });
  $("g1-record").addEventListener("click", record);
  $("g1-got").addEventListener("keydown", function (e) { if (e.key === "Enter") record(); });
  $("g1-drop-last").addEventListener("click", function () {
    var d = dropLastSample(cal, st.plat, st.anchor, mode);
    saveCalibration(cal, mode);
    setText("g1-outcome", d ? "dropped the newest sample: aimed " + d.aimed + ", hit " + d.hit + ", " + G.formatTid(d.tid) + " (under " + st.plat.methodologyId + ", " + MODE.label(mode) + " mode)" : "no samples under " + st.plat.methodologyId + " in " + MODE.label(mode) + " mode for " + st.plat.key + "/" + st.anchor);
    $("g1-correction")._manual = false;
    refreshAnchor(); refreshStats();
  });
  $("g1-clear").addEventListener("click", function () {
    var r = clearSamples(cal, st.plat, st.anchor, false, mode);
    saveCalibration(cal, mode);
    setText("g1-outcome", "cleared calibration for " + st.plat.key + "/" + st.anchor + " under " + st.plat.methodologyId + " (" + MODE.label(mode) + " mode): " + plural(r.removed.length, "sample") + " removed" +
      (r.kept.length ? "; " + plural(r.kept.length, "sample") + " under other methodologies or modes kept, untouched" : ""));
    $("g1-correction")._manual = false;
    refreshAnchor(); refreshStats();
  });
  ["g1-reset-preset", "g1-reset-adjust", "g1-reset-pairs", "g1-reset-cadence", "g1-reset-interval"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (id === "g1-reset-adjust") $(id)._touched = true; refreshReset(); });
  });
  $("g1-reset-save-adjust").addEventListener("click", function () {
    var adj = loadResetAdjust(mode);
    var saved = setResetAdjust(adj, st.plat.key, numOr("g1-reset-adjust", 0), mode);
    saveResetAdjust(adj, mode);
    setText("g1-reset-note", "Saved " + f(saved.frames, 2, true) + " frames as the default adjustment for " + st.plat.key + " (" + MODE.label(mode) + " mode's store; recorded with the mode, never in force in the other).");
    refreshReset();
  });
  $("g1-reset-start").addEventListener("click", function () {
    if (!st.reset || player.running) return;
    play(st.reset.schedule, $("g1-reset-display"), $("g1-reset-log"), null);
  });
  $("g1-reset-stop").addEventListener("click", function () { stop("cancel"); });
  $("g1-verify").addEventListener("click", verifyNow);
  fill($("sid-game"), SID_GAMES.map(function (k) { return { value: k, text: SID.games[k].name }; }), "emerald");
  $("sid-game").addEventListener("change", function () { sidDropCue(); sidRefresh(); });
  ["sid-speed", "sid-namelen", "sid-rival", "sid-margin"].forEach(function (id) {
    $(id).addEventListener("change", sidDropCue);
    $(id).addEventListener("input", sidDropCue);
  });
  // (4) the AudioContext is resumed on the first gesture in the tab, before the anchor click
  var tabEl = document.getElementById("tab-g1tid");
  tabEl.addEventListener("pointerdown", warmAudio, true);
  var tabBtn = document.querySelector("button[data-tab=g1tid]");
  if (tabBtn) tabBtn.addEventListener("pointerdown", warmAudio);
  document.addEventListener("keydown", function () { if (tabEl.classList.contains("active")) warmAudio(); }, true);
  ["g1-anchor-btn", "sid-cue-btn", "g1-reset-start"].forEach(function (id) { $(id).addEventListener("mousedown", warmAudio); });
  $("sid-run").addEventListener("click", sidRun);
  $("sid-tid").addEventListener("keydown", function (e) { if (e.key === "Enter") sidRun(); });
  $("sid-pin-shiny").addEventListener("click", function () { sidPin(true); });
  $("sid-pin-nonshiny").addEventListener("click", function () { sidPin(false); });
  $("sid-pins-clear").addEventListener("click", sidPinsClear);
  $("sid-prepare").addEventListener("click", sidPrepareCue);
  $("sid-cue-btn").addEventListener("click", sidAnchorNow);
  $("sid-cancel").addEventListener("click", function () { stop("cancel"); });
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    var tab = document.getElementById("tab-g1tid");
    if (!tab || !tab.classList.contains("active")) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
    if (player.running) { stop("cancel"); return; }
    var sidCard = $("sid-card");
    var useSid = sidCard && sidCard.getBoundingClientRect().top < window.innerHeight / 2 && st.sidCue;
    if (useSid) sidAnchorNow(); else anchorNow();
  });
  setText("g1-rules", RULES_LINE);
  refreshPlatform(false);
  sidRefresh();

  // ?g1selftest: drive the tab through its own handlers (no audio) and write a summary the
  // headless-browser check in tests/run-tests.sh reads back from the DOM.
  if (root.location && root.location.search.indexOf("g1selftest") !== -1) {
    var report = {};
    try {
      report.targets = $("g1-targets-table").querySelectorAll("tr.pick").length;
      setTarget(358);
      report.protocolHasMethodology = $("g1-protocol").textContent.indexOf("Methodology: red/gba/hold-start-v1") !== -1;
      // the footnotes: every step marked, the Sources block after the steps with the pokered title-loop line under its
      // FACTS.md section and the table under EMULATOR-EXACT (GSE), the target line and the schedule's A cue marked, no
      // problem; the registry without the hold-START line (the negative control) is reported as NOT IN THE REGISTRY and,
      // restored, is clean; the GBA HD and the DMG print HARDWARE-VALIDATED n, Yellow its pokeyellow line and EMPIRICAL
      var g1proto = $("g1-protocol").textContent;
      report.footnoteCount = (g1proto.match(/^  \[\^\d+\] /gm) || []).length;
      report.footnoteSteps = (g1proto.match(/^( [34]\. .*|    Press A ON the long high beep\. That is the only frame-exact action\.|    Each answer sharpens the correction\.)( \[\^\d+\])+$/gm) || []).length;
      report.footnoteHoldStart = /^  \[\^1\] pokered\/engine\/movie\/title\.asm:227-239,266 \(docs\/FACTS\.md: Gen 1\/2 \(Game Boy\) \/ Gen 1 Trainer ID \/ Where the ID comes from\): the title screen waits on CheckForUserInterruption/m.test(g1proto);
      report.footnoteStatusGse = /^  \[\^2\] EMULATOR-EXACT \(no decomp line; the table's derivation on pokemon-speedrunning\/gambatte-core with START held inside the window, docs\/FACTS\.md Gen 1 Trainer ID \(hold-START methodologies, RNG Solution\)\): hold START on any frame 1300-1475 and the NEW GAME menu opens on frame 1553; the A press frame is the menu frame \+ 80 \+ the offset/m.test(g1proto);
      report.footnoteHeaderStatus = g1proto.indexOf(FN.HEADER + FN.STATUS_NOTE) !== -1;
      report.footnoteProblems = FN.procedureProblems(g1proto).length;
      report.registryLoaded = FN.citationsLoaded();
      // Red's three cold boots are off-repository, so the target line must carry the QUALIFIED tag
      report.targetInfoMarked = /\[3x cold-boot verified off-repository: no derivation fixture here\] \[\^2\] \[\^4\]$/.test($("g1-target-info").textContent);
      report.methodologyVerification = $("g1-methodology-text").textContent.indexOf(
        "Verification: offsets 358, 743, 1131 [3x cold-boot verified off-repository: no derivation fixture here]") !== -1;
      report.scheduleMarked = /A cue \(long beep\) .* minus correction .* \[\^2\]$/m.test($("g1-schedule").textContent);
      var fullRegistry = root.ShinyCitations;
      FN.setCitations({ entries: (fullRegistry && fullRegistry.entries || []).filter(function (e) { return e.cite !== "pokered/engine/movie/title.asm:227-239,266"; }) });
      refreshAnchor();
      report.registryCutProblems = FN.procedureProblems($("g1-protocol").textContent);
      FN.setCitations(fullRegistry);
      refreshAnchor();
      report.registryRestoredProblems = FN.procedureProblems($("g1-protocol").textContent).length;
      $("g1-platform").value = "gba-hd"; $("g1-platform").dispatchEvent(new Event("change"));
      setTarget(358);
      report.footnoteStatusGbaHd = /^  \[\^2\] HARDWARE-VALIDATED 5 of 5 \(no decomp line; /m.test($("g1-protocol").textContent);
      $("g1-platform").value = "dmg"; $("g1-platform").dispatchEvent(new Event("change"));
      setTarget(517);
      report.footnoteStatusDmg = /^  \[\^2\] HARDWARE-VALIDATED 5 of 6 \(no decomp line; /m.test($("g1-protocol").textContent) && $("g1-protocol").textContent.indexOf("hold START on any frame 1450-1640 and the NEW GAME menu opens on frame 1701") !== -1;
      $("g1-game").value = "yellow"; $("g1-game").dispatchEvent(new Event("change"));
      $("g1-platform").value = "gba-hd"; $("g1-platform").dispatchEvent(new Event("change"));
      setTarget(358);
      report.footnoteYellow = /^  \[\^1\] pokeyellow\/engine\/movie\/title\.asm:166-175 \(docs\/FACTS\.md: Gen 1\/2 \(Game Boy\) \/ Gen 1 Trainer ID \/ Where the ID comes from\): Yellow's title loop/m.test($("g1-protocol").textContent) && /^  \[\^2\] EMPIRICAL \(no decomp line; /m.test($("g1-protocol").textContent) && /^  \[\^4\] pokeyellow\/engine\/movie\/oak_speech\/init_player_data\.asm:1-10 \(docs\/FACTS\.md: /m.test($("g1-protocol").textContent);
      $("g1-game").value = "red"; $("g1-game").dispatchEvent(new Event("change"));
      $("g1-platform").value = "gse"; $("g1-platform").dispatchEvent(new Event("change"));
      setTarget(358);
      report.scheduleA = ($("g1-schedule").textContent.match(/A cue \(long beep\)\s+([0-9.]+) s/) || [])[1];
      report.anchorEnabled = !$("g1-anchor-btn").disabled;
      $("g1-got").value = String(st.plat.table[360]);
      record();
      report.outcome = $("g1-outcome").textContent.split("\n")[1];
      report.correctionAfter = $("g1-correction").value;
      report.stored = JSON.parse(storageGet(STORE_KEY_CAL) || "{}");
      $("g1-game").value = "blue"; $("g1-game").dispatchEvent(new Event("change"));
      $("g1-platform").value = "dmg"; $("g1-platform").dispatchEvent(new Event("change"));
      report.blueDmgTargets = Array.prototype.map.call($("g1-targets-table").querySelectorAll("tr.pick"), function (tr) { return Number(tr.dataset.offset); });
      report.blueAnchors = Array.prototype.map.call($("g1-anchor").options, function (o) { return o.value; });
      report.resetLine = $("g1-reset-text").textContent.split("\n")[1];
      $("sid-game").value = "firered"; $("sid-game").dispatchEvent(new Event("change"));
      $("sid-tid").value = "9572"; $("sid-kmin").value = "1868"; $("sid-kmax").value = "1870";
      sidRun();
      report.sidRows = $("sid-table").querySelectorAll("tr").length - 1;
      report.sidFirstLine = $("sid-out").textContent.split("\n")[0];
      // one Space on this tab with a Gen 3 target loaded: the Gen 3 timer's handler (app.js) must stay quiet
      var navBtn = document.querySelector("button[data-tab=g1tid]");
      if (navBtn) navBtn.click();
      report.g1TabActive = document.getElementById("tab-g1tid").classList.contains("active");
      var g3Clicks = 0;
      if ($("tid-target") && $("tid-search")) {
        $("tid-target").value = "41191";                  // the TID at advance 1000 of the dead-battery seed: a hit inside 15 minutes
        $("tid-search").click();
        var g3row = document.querySelector("#tid-results tr.pick");
        report.g3TargetLoaded = !!g3row;
        if (g3row) g3row.click();
        if ($("g3-start")) $("g3-start").addEventListener("click", function () { g3Clicks++; });
      }
      $("g1-game").value = "red"; $("g1-game").dispatchEvent(new Event("change"));
      $("g1-platform").value = "gse"; $("g1-platform").dispatchEvent(new Event("change"));
      setTarget(358);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
      report.spaceAnchoredGen1 = $("g1-cue-log").textContent.indexOf("anchor at") === 0;
      report.cueLogNamesMode = /^anchor at \d\d:\d\d:\d\d  \[RUN mode\]\n/.test($("g1-cue-log").textContent);
      report.g3StartClicksOnSpace = g3Clicks;
      stop("cancel");
      // a prepared Secret ID cue is dropped when the model changes, and the listing then ignores it
      $("sid-speed").value = "mid"; $("sid-namelen").value = "7"; $("sid-rival").value = "newname"; $("sid-margin").value = "30";
      sidPrepareCue();
      report.sidCueWindow = st.sidCue ? st.sidCue.kMin + "-" + st.sidCue.kMax : null;
      $("sid-speed").value = "fast"; $("sid-speed").dispatchEvent(new Event("change"));
      report.sidCueDroppedOnSpeedChange = st.sidCue === null && $("sid-cue-btn").disabled;
      $("sid-kmin").value = ""; $("sid-kmax").value = "";
      sidRun();
      report.sidListingMentionsOldWindow = $("sid-out").textContent.indexOf("2240-2266") !== -1;
      // the RUN / PRACTICE-HUNT wall: RUN by default with the banner hidden; PRACTICE / HUNT turned on
      // through the switch shows the banner (outside every tab section); a sample recorded there is
      // stamped and lands in the practice store while the RUN store is untouched; back in RUN the
      // practice sample is not in force.
      report.modeDefault = MODE.get();
      report.bannerHiddenInRun = $("mode-banner").hidden === true;
      report.correctionInRunBefore = $("g1-correction").value;
      var runStoreBefore = storageGet(STORE_KEY_CAL);
      $("mode-practice").checked = true; $("mode-practice").dispatchEvent(new Event("change"));
      report.modeAfterToggle = MODE.get();
      report.bannerShownInPractice = $("mode-banner").hidden === false && $("mode-banner").textContent === MODE.BANNER;
      report.bannerOutsideTabs = !$("mode-banner").closest(".tab") && !!$("mode-banner").closest("body");
      report.correctionInPracticeBefore = $("g1-correction").value;
      $("g1-got").value = String(st.plat.table[364]);
      record();
      report.practiceOutcome = $("g1-outcome").textContent.split("\n")[1];
      report.practiceStored = JSON.parse(storageGet(calStoreKey(MODE.PRACTICE)) || "{}");
      report.runStoreUnchangedByPractice = storageGet(STORE_KEY_CAL) === runStoreBefore;
      report.correctionInPractice = $("g1-correction").value;
      // the remembered reset adjustment and the Secret ID pins follow the mode too: saved while PRACTICE / HUNT
      // is on, they land in the practice stores, stamped, and the RUN stores stay untouched
      var runResetBefore = storageGet(STORE_KEY_RESET), runPinsBefore = storageGet(STORE_KEY_PINS);
      $("g1-reset-adjust").value = "2"; $("g1-reset-adjust").dispatchEvent(new Event("change"));
      $("g1-reset-save-adjust").click();
      report.practiceResetNote = $("g1-reset-note").textContent;
      report.practiceResetStored = JSON.parse(storageGet(resetStoreKey(MODE.PRACTICE)) || "{}");
      report.runResetUnchangedByPractice = storageGet(STORE_KEY_RESET) === runResetBefore;
      var sidKey = pinKey(sidInputs().m.id, 9572);
      $("sid-pin-pid").value = "12345678"; $("sid-pin-note").value = "practice pin";
      sidPin(false);
      report.practicePinOut = $("sid-pin-out").textContent;
      report.practicePinsStored = JSON.parse(storageGet(pinStoreKey(MODE.PRACTICE)) || "{}");
      report.practicePinKeyPresent = !!(report.practicePinsStored[sidKey] && report.practicePinsStored[sidKey].length === 1 && report.practicePinsStored[sidKey][0].mode === "practice");
      report.runPinsUnchangedByPractice = storageGet(STORE_KEY_PINS) === runPinsBefore;
      $("mode-practice").checked = false; $("mode-practice").dispatchEvent(new Event("change"));
      report.modeBack = MODE.get();
      report.bannerHiddenAgain = $("mode-banner").hidden === true;
      report.correctionBackInRun = $("g1-correction").value;
      report.resetAdjustBackInRun = $("g1-reset-adjust").value;
      report.runListingHasPracticePin = $("sid-out").textContent.indexOf("12345678") !== -1;
      // records of the other mode planted in the RUN stores (a hand edit, or a hunt tool writing to the wrong key):
      // never in force, named in the notes, and one whose mode this head does not know breaks nothing
      var calSnapshot = JSON.stringify(cal);
      var practiceSample = report.practiceStored["gse/menu"].samples[0];
      cal["gse/menu"].samples.push(practiceSample);
      refreshAnchor();
      report.runNoteAboutPractice = $("g1-correction-note").textContent.indexOf("recorded in PRACTICE / HUNT mode, not RUN") !== -1;
      cal["gse/menu"].samples.push(Object.assign({}, practiceSample, { mode: "hunt", attempt: "h1" }));
      refreshAnchor();
      report.runNoteAboutUnknown = $("g1-correction-note").textContent.indexOf("\"hunt\" (unknown mode), PRACTICE / HUNT mode, not RUN") !== -1;
      report.correctionWithPlanted = $("g1-correction").value;
      $("g1-got").value = String(st.plat.table[362]);
      record();
      report.recordWithPlanted = $("g1-outcome").textContent.split("\n")[1];
      report.samplesInForceWithPlanted = samplesFor(cal, "gse", "menu", st.plat.methodologyId, MODE.RUN).length;
      cal = JSON.parse(calSnapshot);
      storageSet(STORE_KEY_CAL, calSnapshot);
      storageSet(STORE_KEY_RESET, JSON.stringify({ gse: { frames: 2, mode: "practice", when: "planted" } }));
      $("g1-reset-adjust")._touched = false;
      refreshReset();
      report.resetPlantedIgnored = $("g1-reset-text").textContent.indexOf("recorded in PRACTICE / HUNT mode, not RUN") !== -1 && $("g1-reset-adjust").value === "0";
      storageSet(STORE_KEY_RESET, runResetBefore);
      var planted = {};
      planted[sidKey] = [{ pid: 0x12345678, shiny: false, note: "", when: "planted", mode: "practice" }];
      storageSet(STORE_KEY_PINS, JSON.stringify(planted));
      pins = loadPins(MODE.RUN);
      sidRun();
      report.pinPlantedIgnored = $("sid-out").textContent.indexOf("1 stored pin for") !== -1 && $("sid-out").textContent.indexOf("recorded in PRACTICE / HUNT mode, not RUN") !== -1;
      storageSet(STORE_KEY_PINS, runPinsBefore);
      pins = loadPins(MODE.RUN);
      refreshAnchor(); refreshStats(); refreshReset();
      // nothing the self-test did reached the real localStorage
      var real = {};
      try { [STORE_KEY_CAL, calStoreKey(MODE.PRACTICE), STORE_KEY_PINS, pinStoreKey(MODE.PRACTICE), STORE_KEY_RESET, resetStoreKey(MODE.PRACTICE), MODE.KEY].forEach(function (k) { real[k] = root.localStorage ? root.localStorage.getItem(k) : null; }); } catch (e) { real.error = String(e); }
      report.realStorage = real;
      var el = document.createElement("pre");
      el.id = "g1-selftest";
      el.textContent = JSON.stringify(report);
      document.body.appendChild(el);
    } catch (e) {
      var bad = document.createElement("pre");
      bad.id = "g1-selftest";
      bad.textContent = JSON.stringify({ error: String(e && e.stack || e) });
      document.body.appendChild(bad);
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
