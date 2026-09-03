// Gen 2 Trainer ID / Lucky ID engine (Gold / Silver / Crystal hold-START single-tap methodologies):
// the 4-frame poll bins, bin -> offsets, table lookups across the RTC states, the typed-TID /
// typed-(TID, LID) inversion with the two-state prior, the target sets and verdicts, the cue
// schedules (menu / power-on / reset anchors) and the bin-based calibration and verify.
// A separate module from core/gen1tid.js on purpose: gen1tid.js is a line-for-line port of RNG
// Solution's Python (the oracle of tests/gen1tid-vectors.json) and its model is per-frame offsets
// with an 80-frame settle; Gen 2 is 4-frame bins relative to a menu that is visible 4 frames after
// the game's detector, three IDs per bin, and a Gold/Silver RTC state that selects the table. The
// timing helpers, tones, count-in and the calibration sample arithmetic are reused from gen1tid.js
// so the heads render Gen 2 cues with the Gen 1 code paths.
// Oracle: tests/gen2_reference.py (reads the derivation CSVs directly) -> tests/gen2tid-vectors.json.
// Pure functions: no I/O, no DOM. Data is passed in from core/data/gen2-tid.json.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./gen1tid.js"));
  else root.ShinyGen2Tid = factory(root.ShinyGen1Tid);
})(typeof self !== "undefined" ? self : this, function (g1) {
  var FPS = g1.FPS;
  var FRAME_MS = g1.FRAME_MS;
  var VISIBLE_MENU_LAG_FRAMES = 4;       // the menu box is drawn 4 frames after the detector (every configuration)
  var BIN_COUNT = 599;
  var OFFSET_MAX = 2399;
  var POLL_PERIOD_FRAMES = 4;
  var TAP_FRAMES = [4, 8];               // the A tap: 4-8 frames (67-134 ms)
  var TAP_MS = [TAP_FRAMES[0] * FRAME_MS, TAP_FRAMES[1] * FRAME_MS];
  var ROLL_SETTLE_S = 0.35;              // press nothing until the New Game roll is over
  var OUTLIER_FRAMES = g1.OUTLIER_FRAMES; // 60 frames = 15 bins: Gen 1's calibration guard reused
  var COUNT_IN_CLEAR_S = g1.COUNT_IN_CLEAR_S;
  var TWO_STATE_PRIOR = ["days0", "days512"];
  var ANCHOR_MENU = "menu", ANCHOR_POWERON = "poweron", ANCHOR_RESET = "reset";
  var ANCHORS = [ANCHOR_MENU, ANCHOR_POWERON, ANCHOR_RESET];

  function isNil(x) { return x === null || x === undefined; }
  function fail(msg) { var e = new Error(msg); e.name = "ValueError"; throw e; }
  function hex(n, width) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < width) s = "0" + s;
    return s;
  }

  // ---- data helpers ----------------------------------------------------------------------------
  function game(data, gameKey) {
    var g = data.games && data.games[gameKey];
    if (!g) fail("no game " + JSON.stringify(gameKey) + " in the data");
    return g;
  }
  function binRule(data, gameKey) {
    var name = game(data, gameKey).bin_rule;
    var r = data.bin_rules[name];
    if (!r) fail("no bin rule " + JSON.stringify(name));
    return r;
  }
  function methodology(data, id) {
    var m = data.methodologies[id];
    if (!m) fail("no methodology " + JSON.stringify(id) + " in the data");
    return m;
  }
  function methodologyFor(data, gameKey, platformKey) {
    var ids = game(data, gameKey).methodologies;
    for (var i = 0; i < ids.length; i++) if (data.methodologies[ids[i]].platform_key === platformKey) return data.methodologies[ids[i]];
    fail("no methodology for " + gameKey + " on " + JSON.stringify(platformKey));
  }
  function stateIds(data, gameKey) {
    if (!game(data, gameKey).rtc_dependent) return ["days0"];
    return data.rtc.families.running.states.concat(data.rtc.families.halted.states);
  }
  function stateInfo(data, state) {
    var s = data.rtc.states[state];
    if (!s) fail("no RTC state " + JSON.stringify(state));
    return s;
  }
  function isHaltedState(state) { return state.indexOf("halt") === 0; }
  var ID_MAX = 0xFFFF;
  var FAMILIES = ["all", "running", "halted"];
  // Typed IDs are integers 0..65535; a hex string, NaN or an out-of-range number is a caller bug, not "absent from the tables".
  function id16(x, name) {
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > ID_MAX) fail(name + " must be an integer 0..65535 (got " + JSON.stringify(x) + ")");
    return x;
  }
  function optId16(x, name) { return isNil(x) ? null : id16(x, name); }
  function finite(x, name) {
    if (typeof x !== "number" || !Number.isFinite(x)) fail(name + " must be a finite number (got " + String(x) + ")");
    return x;
  }
  function tableKey(gameKey, platformKey, state) { return gameKey + "/" + platformKey + "/" + state; }
  function splitKey(key) { var p = key.split("/"); return { game: p[0], platformKey: p[1], state: p[2] }; }

  // The record for a table key: the methodology's table_data for days0, else rtc.tables[key].
  function tableRecord(data, key) {
    var k = splitKey(key);
    if (k.state === "days0") return methodologyFor(data, k.game, k.platformKey).table_data;
    var r = data.rtc.tables[key];
    if (!r) fail("no table " + JSON.stringify(key));
    return r;
  }
  // Follows same_data_as to the record that carries the payload.
  function resolveTable(data, key) {
    var k = key, r = tableRecord(data, key), hops = 0;
    while (r.same_data_as) {
      k = r.same_data_as; r = tableRecord(data, k);
      if (++hops > 8) fail("same_data_as loop at " + key);
    }
    return { key: k, record: r };
  }
  function decodeHex4(s) {
    var out = [];
    for (var j = 0; j + 4 <= s.length; j += 4) out.push(parseInt(s.substr(j, 4), 16));
    return out;
  }
  var decodeCache = typeof Map !== "undefined" ? new Map() : null;
  function decodeTable(record) {
    if (decodeCache && decodeCache.has(record)) return decodeCache.get(record);
    if (!record.tids_hex) fail("table record carries no payload (follow same_data_as first)");
    var t = {
      tids: decodeHex4(record.tids_hex), lids: decodeHex4(record.lids_hex),
      sids: record.sids_hex ? decodeHex4(record.sids_hex) : null,
      rollBase: record.roll_base, rollSlips: record.roll_slips || {}, bins: record.bins
    };
    if (t.tids.length !== BIN_COUNT || t.lids.length !== BIN_COUNT) fail("table payload is not " + BIN_COUNT + " bins");
    if (decodeCache) decodeCache.set(record, t);
    return t;
  }
  // {key (the carrier), record, table (decoded), game, platformKey, state, timing, rule}
  function tableFor(data, gameKey, platformKey, state) {
    var key = tableKey(gameKey, platformKey, state);
    var res = resolveTable(data, key);
    var m = methodologyFor(data, gameKey, platformKey);
    return { key: key, carrier: res.key, record: res.record, table: decodeTable(res.record), game: gameKey, platformKey: platformKey,
      state: state, methodology: m.id, timing: m.timing, rule: binRule(data, gameKey) };
  }
  // Every table key of a game in data order (platform keys, then the running and halted states).
  // The scope options are validated here (invert, ambiguity, sampleFromHit and verify all come through): an unknown platform,
  // family or state throws instead of silently scoping to no table at all.
  function tableKeys(data, gameKey, opts) {
    var o = opts || {};
    var g = game(data, gameKey), out = [];
    var states = stateIds(data, gameKey);
    var family = isNil(o.family) ? "all" : o.family;
    if (FAMILIES.indexOf(family) === -1) fail("family must be one of " + FAMILIES.join(", ") + " (got " + JSON.stringify(o.family) + ")");
    if (!isNil(o.platformKey) && g.platform_keys.indexOf(o.platformKey) === -1) {
      fail("no platform " + JSON.stringify(o.platformKey) + " for " + gameKey + " (choose from " + g.platform_keys.join(", ") + ")");
    }
    // states: every id must be a real RTC state (rtc.states); for an RTC-immune game (Crystal) the filter is then moot,
    // whatever the cartridge's clock its one table is days0.
    var stateFilter = null;
    if (!isNil(o.states)) {
      if (!Array.isArray(o.states) || o.states.length === 0) fail("states must be a non-empty array of RTC state ids");
      o.states.forEach(function (st) { stateInfo(data, st); });
      if (g.rtc_dependent) stateFilter = o.states;
    }
    g.platform_keys.forEach(function (pk) {
      if (!isNil(o.platformKey) && pk !== o.platformKey) return;
      states.forEach(function (st) {
        if (family !== "all" && ((family === "halted") !== isHaltedState(st))) return;
        if (stateFilter !== null && stateFilter.indexOf(st) === -1) return;
        out.push(tableKey(gameKey, pk, st));
      });
    });
    return out;
  }

  // ---- bins --------------------------------------------------------------------------------------
  function binOf(offset, rule) {
    if (typeof offset !== "number" || !Number.isInteger(offset)) fail("offset must be an integer frame count (got " + JSON.stringify(offset) + ")");
    if (offset < 0 || offset > OFFSET_MAX) return null;
    if (rule.dropped_offsets.indexOf(offset) !== -1) return null;
    if (rule.bin0_offsets[0] <= offset && offset <= rule.bin0_offsets[1]) return 0;
    return Math.floor((offset - rule.subtract) / 4);
  }
  function bin(data, gameKey, offset) { return binOf(offset, binRule(data, gameKey)); }
  function offsetsForBin(b, rule) {
    if (!(Number.isInteger(b) && b >= 0 && b < BIN_COUNT)) fail("bin " + b + " is outside 0.." + (BIN_COUNT - 1));
    if (b === 0) return [rule.bin0_offsets[0], rule.bin0_offsets[1]];
    var lo = 4 * b + rule.subtract;
    return [lo, Math.min(lo + 3, OFFSET_MAX)];
  }
  function aimOffset(b, rule) { var r = offsetsForBin(b, rule); return (r[0] + r[1]) / 2.0; }
  function visibleWindow(b, rule) { var r = offsetsForBin(b, rule); return [r[0] - VISIBLE_MENU_LAG_FRAMES, r[1] - VISIBLE_MENU_LAG_FRAMES]; }
  function pressFrame(timing, offset) { return timing.menu_frame + 1 + offset; }
  function acceptFrame(timing, b) { return timing.first_poll_frame + POLL_PERIOD_FRAMES * b; }
  function rollFrame(table, timing, b) { return timing.menu_frame + table.rollBase + POLL_PERIOD_FRAMES * b + (table.rollSlips[String(b)] || 0); }

  // ---- lookups -----------------------------------------------------------------------------------
  function lookup(data, gameKey, platformKey, state, b) {
    var t = tableFor(data, gameKey, platformKey, state);
    var off = offsetsForBin(b, t.rule);
    return {
      game: gameKey, platformKey: platformKey, state: state, key: t.key, carrier: t.carrier, methodology: t.methodology, bin: b,
      tid: t.table.tids[b], lid: t.table.lids[b], sid: t.table.sids ? t.table.sids[b] : null,
      offsets: off, visible: visibleWindow(b, t.rule), aim: aimOffset(b, t.rule),
      pressFrames: [pressFrame(t.timing, off[0]), pressFrame(t.timing, off[1])], acceptFrame: acceptFrame(t.timing, b), rollFrame: rollFrame(t.table, t.timing, b)
    };
  }
  function entries(data, gameKey, platformKey, state) {
    var t = tableFor(data, gameKey, platformKey, state), out = [];
    for (var b = 0; b < BIN_COUNT; b++) out.push({ bin: b, tid: t.table.tids[b], lid: t.table.lids[b], sid: t.table.sids ? t.table.sids[b] : null });
    return out;
  }

  // ---- inversion ---------------------------------------------------------------------------------
  // Groups the tables in scope by the payload they carry (identical tables are one candidate each).
  function carrierGroups(data, gameKey, opts) {
    var keys = tableKeys(data, gameKey, opts), groups = [], index = {};
    keys.forEach(function (key) {
      var c = resolveTable(data, key).key;
      if (!(c in index)) { index[c] = groups.length; groups.push({ carrier: c, members: [] }); }
      var k = splitKey(key);
      groups[index[c]].members.push([k.platformKey, k.state]);
    });
    return groups;
  }
  function reachable(data, gameKey, state) {
    var info = stateInfo(data, state);
    if (!game(data, gameKey).rtc_dependent) return true;
    return !!info.reachable_after_first_boot;
  }
  // invert(data, game, tid, {lid, sid, platformKey, family: "all"|"running"|"halted", states: [..]})
  // Each candidate: key = the table that carries the payload (identical tables are stored once, possibly under the other DMG
  // platform), table = the first in-scope table of the group (use this in head text), members = every in-scope (platform, state).
  function invert(data, gameKey, tid, opts) {
    var o = opts || {};
    var g = game(data, gameKey);
    tid = id16(tid, "tid");
    var lid = optId16(o.lid, "lid"), sid = optId16(o.sid, "sid");
    if (sid !== null && g.ids.indexOf("sid") === -1) fail(gameKey + " rolls no Secret ID: sid must not be given");
    var crystal = !g.rtc_dependent;
    var rule = binRule(data, gameKey);
    var cands = [];
    carrierGroups(data, gameKey, o).forEach(function (grp) {
      var t = decodeTable(tableRecord(data, grp.carrier));
      var st = splitKey(grp.carrier).state;
      for (var b = 0; b < BIN_COUNT; b++) {
        if (t.tids[b] !== tid) continue;
        if (lid !== null && t.lids[b] !== lid) continue;
        if (sid !== null && (!t.sids || t.sids[b] !== sid)) continue;
        cands.push({
          key: grp.carrier, table: tableKey(gameKey, grp.members[0][0], grp.members[0][1]),
          members: grp.members.map(function (m) { return m.slice(); }), bin: b, offsets: offsetsForBin(b, rule),
          tid: t.tids[b], lid: t.lids[b], sid: t.sids ? t.sids[b] : null,
          family: isHaltedState(st) ? "halted" : "running",
          reachableAfterFirstBoot: grp.members.some(function (m) { return reachable(data, gameKey, m[1]); })
        });
      }
    });
    var preferred = cands.filter(function (c) {
      return crystal || c.members.some(function (m) { return TWO_STATE_PRIOR.indexOf(m[1]) !== -1; });
    });
    var resolved = cands.length === 1 ? cands[0] : (preferred.length === 1 ? preferred[0] : null);
    return { candidates: cands, preferred: preferred, ambiguous: cands.length > 1, resolved: resolved };
  }
  // The README's ambiguity statistics over the distinct tables in scope.
  function ambiguity(data, gameKey, opts) {
    var groups = carrierGroups(data, gameKey, opts), byTid = {}, byPair = {}, tot = 0;
    groups.forEach(function (grp) {
      var t = decodeTable(tableRecord(data, grp.carrier));
      for (var b = 0; b < BIN_COUNT; b++) {
        var k1 = t.tids[b], k2 = hex(t.tids[b], 4) + "/" + hex(t.lids[b], 4);
        (byTid[k1] = byTid[k1] || []).push([grp.carrier, b]);
        (byPair[k2] = byPair[k2] || []).push([grp.carrier, b]);
        tot++;
      }
    });
    var ambiguousTids = 0, ambiguousEntries = 0, maxC = 0, distinct = 0;
    Object.keys(byTid).forEach(function (k) {
      distinct++;
      var n = byTid[k].length;
      if (n > maxC) maxC = n;
      if (n > 1) { ambiguousTids++; ambiguousEntries += n; }
    });
    var coll = Object.keys(byPair).filter(function (k) { return byPair[k].length > 1; }).sort();
    return { tables: groups.length, entries: tot, distinctTids: distinct, ambiguousTids: ambiguousTids, ambiguousEntries: ambiguousEntries,
      maxCandidates: maxC, pairCollisions: coll.length, pairCollisionList: coll.slice(0, 20) };
  }

  // ---- target sets -------------------------------------------------------------------------------
  function parseHex4(x) {
    var str = ("" + x).trim();
    if (!/^[0-9A-Fa-f]{1,4}$/.test(str)) fail("target set member " + JSON.stringify(x) + " is not a 1-4 digit hex ID");
    return parseInt(str, 16);
  }
  function makeTargetSet(key, spec) {
    var ts = {
      key: key, name: isNil(spec.name) ? key : spec.name, kind: isNil(spec.kind) ? "tid-list" : spec.kind, games: (spec.games || []).slice(),
      protocol: spec.protocol || "", provenance: spec.provenance || "", route: spec.route || "", note: spec.note || "",
      tids: [], lids: [], pairs: [], singlePressHits: (spec.single_press_hits || []).slice()
    };
    if (ts.kind === "tid-list") ts.tids = (spec.tids || []).map(parseHex4);
    else if (ts.kind === "lid-list") ts.lids = (spec.lids || []).map(parseHex4);
    else if (ts.kind === "pair-list") ts.pairs = (spec.pairs || []).map(function (p) { return [parseHex4(p[0]), parseHex4(p[1])]; });
    else fail("target set " + key + ": unknown kind " + JSON.stringify(ts.kind));
    return ts;
  }
  function targetSetsFor(data, gameKey, keys) {
    var g = game(data, gameKey), all = data.target_sets || {};
    var wanted = keys && keys.length ? keys.slice() : (g.default_target_sets || g.target_sets || []).slice();
    return wanted.map(function (k) {
      if (!(k in all)) fail("target set " + JSON.stringify(k) + " is not defined (choose from " + Object.keys(all).join(", ") + ")");
      if ((all[k].games || []).indexOf(gameKey) === -1) fail("target set " + JSON.stringify(k) + " is not defined for " + gameKey);
      return makeTargetSet(k, all[k]);
    });
  }
  function setAccepts(ts, tid, lid, sid) {
    if (ts.kind === "tid-list") return ts.tids.indexOf(tid) !== -1;
    if (isNil(lid)) return false;
    if (ts.kind === "lid-list") return ts.lids.indexOf(lid) !== -1;
    return ts.pairs.some(function (p) { return p[0] === tid && p[1] === lid; });
  }
  function setDescribe(ts) {
    if (ts.kind === "tid-list") return ts.key + ": TID " + ts.tids.map(function (t) { return "$" + hex(t, 4) + " (" + t + ")"; }).join(", ");
    if (ts.kind === "lid-list") return ts.key + ": Lucky ID " + ts.lids.map(function (t) { return "$" + hex(t, 4) + " (" + ("00000" + t).slice(-5) + ")"; }).join(", ");
    return ts.key + ": " + ts.pairs.map(function (p) { return "TID $" + hex(p[0], 4) + " + LID $" + hex(p[1], 4); }).join(", ");
  }
  function setsAccepting(tid, lid, sid, sets) {
    id16(tid, "tid"); optId16(lid, "lid"); optId16(sid, "sid");
    return (sets || []).filter(function (s) { return setAccepts(s, tid, lid, sid); });
  }
  function verdictDetail(tid, lid, sid, sets) {
    var hits = setsAccepting(tid, lid, sid, sets);
    return { verdict: hits.length ? "RUN" : "no", sets: hits.map(function (s) { return s.key; }) };
  }
  function verdict(tid, lid, sid, sets) { return verdictDetail(tid, lid, sid, sets).verdict; }
  function verdictText(tid, lid, sid, sets) {
    var d = verdictDetail(tid, lid, sid, sets);
    if (d.verdict === "RUN") {
      var scripted = d.sets.filter(function (k) { var s = sets.filter(function (x) { return x.key === k; })[0]; return s && s.protocol === "community-script"; });
      return "route target (target set " + d.sets.join(", ") + ")" +
        (scripted.length ? "; the published protocol for it is a community multi-step script, not this single-tap methodology" : "");
    }
    return "not a route target (accepted by none of: " + (sets || []).map(function (s) { return s.key; }).join(", ") + ")";
  }
  // targets(data, game, platformKey, state, sets): the bins of one table that produce a member of any set.
  function targets(data, gameKey, platformKey, state, sets) {
    var t = tableFor(data, gameKey, platformKey, state), out = [];
    for (var b = 0; b < BIN_COUNT; b++) {
      var tid = t.table.tids[b], lid = t.table.lids[b], sid = t.table.sids ? t.table.sids[b] : null;
      var hit = setsAccepting(tid, lid, sid, sets);
      if (hit.length) out.push({ bin: b, offsets: offsetsForBin(b, t.rule), tid: tid, lid: lid, sid: sid, sets: hit.map(function (s) { return s.key; }),
        reachableAfterFirstBoot: reachable(data, gameKey, state) });
    }
    return out;
  }
  function targetsAllStates(data, gameKey, platformKey, sets) {
    var out = [];
    stateIds(data, gameKey).forEach(function (st) {
      targets(data, gameKey, platformKey, st, sets).forEach(function (h) { h.state = st; out.push(h); });
    });
    return out;
  }

  // ---- schedules ---------------------------------------------------------------------------------
  function cue(t, tone, label, kind) { return { t: Number(t), freq: tone[0], ms: tone[1], label: label, kind: kind }; }
  // scheduleGen2(data, methodologyId, bin, correctionMs, {anchor, beeps, spacingS, resetExtraS})
  function scheduleGen2(data, methodologyId, b, correctionMs, opts) {
    var o = opts || {};
    var anchor = isNil(o.anchor) ? ANCHOR_MENU : o.anchor;
    var beeps = isNil(o.beeps) ? 4 : o.beeps, spacing = isNil(o.spacingS) ? 1.0 : o.spacingS;
    var m = methodology(data, methodologyId), rule = binRule(data, m.game_key), timing = m.timing;
    if (m.anchors.indexOf(anchor) === -1) fail("anchor " + JSON.stringify(anchor) + " is not offered for " + methodologyId);
    finite(correctionMs, "correction (ms)"); finite(spacing, "count-in spacing (s)");
    if (!Number.isInteger(beeps) || beeps < 0) fail("count-in beeps must be an integer 0 or more (got " + String(beeps) + ")");
    var vw = visibleWindow(b, rule), aimV = aimOffset(b, rule) - VISIBLE_MENU_LAG_FRAMES;
    var cues, tA, holdLo = null, holdHi = null, menu = null, ci, base = 0.0;
    if (anchor === ANCHOR_MENU) {
      tA = aimV / FPS - correctionMs / 1000.0;
      if (tA <= 0) fail("the A cue would be due before the anchor (bin " + b + ", correction " + correctionMs + " ms)");
      ci = g1.countInCues(tA, beeps, spacing);
      cues = ci.cues.slice();
      cues.push(cue(tA, g1.A_CUE_TONE, "A", "A"));
    } else {
      var extra = 0.0;
      if (anchor === ANCHOR_RESET) {
        if (isNil(o.resetExtraS)) fail("the reset anchor needs the console's reset delay (fade + stall)");
        extra = finite(o.resetExtraS, "reset delay (s)");
      }
      holdLo = timing.hold_lo_frame / FPS + extra;
      holdHi = timing.hold_hi_frame / FPS + extra;
      menu = timing.visible_menu_frame / FPS + extra;
      tA = menu + aimV / FPS - correctionMs / 1000.0;
      if (tA <= menu) fail("the A cue would be due before the menu (bin " + b + ", correction " + correctionMs + " ms)");
      cues = [
        cue(holdLo, g1.HOLD_TONE, "hold-start", "hold"),
        cue((holdLo + holdHi) / 2.0, g1.HOLD_TONE, "hold-centre", "hold"),
        cue(menu, g1.MENU_MARK_TONE, "menu", "menu"),
        cue(menu + 0.08, g1.MENU_MARK_TONE, "menu-2", "menu")
      ];
      ci = g1.countInCues(tA, beeps, spacing, menu + COUNT_IN_CLEAR_S);
      cues = cues.concat(ci.cues);
      cues.push(cue(tA, g1.A_CUE_TONE, "A", "A"));
      base = menu;
    }
    cues.sort(function (x, y) { return x.t - y.t; });
    var duration = 0.0;
    cues.forEach(function (c, i) { var d = c.t + c.ms / 1000.0; if (i === 0 || d > duration) duration = d; });
    return {
      anchor: anchor, tA: tA, holdLo: holdLo, holdHi: holdHi, menu: menu, droppedCountIn: ci.dropped, duration: duration,
      countInTimes: cues.filter(function (c) { return c.kind === "count"; }).map(function (c) { return c.t; }), cues: cues,
      bin: b, aimOffset: aimOffset(b, rule), aimV: aimV, aWindow: [base + vw[0] / FPS, base + (vw[1] + 1) / FPS],
      tapMs: TAP_MS.slice(), rollSettleS: ROLL_SETTLE_S, methodology: methodologyId
    };
  }

  // ---- calibration (Gen 1's sample arithmetic over bin centres) ----------------------------------
  function errorFramesBins(rule, hitBin, aimedBin) { return aimOffset(hitBin, rule) - aimOffset(aimedBin, rule); }
  function isOutlierBins(rule, hitBin, aimedBin) { return Math.abs(errorFramesBins(rule, hitBin, aimedBin)) > OUTLIER_FRAMES; }
  function impliedCorrectionBins(rule, correctionUsedMs, hitBin, aimedBin) {
    return correctionUsedMs + g1.framesToMs(errorFramesBins(rule, hitBin, aimedBin));
  }
  // sampleFromHit(data, game, platformKey, state|null, typedTid, typedLid|null, aimedBin, correctionUsedMs, {attempt, note, player}):
  // inverts the typed IDs on the platform (the given state, else the two-state prior), picks the candidate nearest the aim and
  // builds a calibration sample the Gen 1 helpers (addSample, meanCorrection, drift) accept: hit/aimed are bin-centre offsets.
  function sampleFromHit(data, gameKey, platformKey, state, typedTid, typedLid, aimedBin, correctionUsedMs, opts) {
    var o = opts || {};
    var rule = binRule(data, gameKey), crystal = !game(data, gameKey).rtc_dependent;
    offsetsForBin(aimedBin, rule);
    finite(correctionUsedMs, "correction used (ms)");
    var states = !isNil(state) ? [state] : (crystal ? null : TWO_STATE_PRIOR.slice());
    var inv = invert(data, gameKey, typedTid, { lid: isNil(typedLid) ? null : typedLid, platformKey: platformKey, states: states });
    var near = null;
    inv.candidates.forEach(function (c) {
      if (near === null || Math.abs(c.bin - aimedBin) < Math.abs(near.bin - aimedBin) || (Math.abs(c.bin - aimedBin) === Math.abs(near.bin - aimedBin) && c.bin < near.bin)) near = c;
    });
    var sample = null;
    if (near !== null) {
      var st = {};
      near.members.forEach(function (m) { st[m[1]] = true; });
      sample = {
        tid: typedTid, lid: isNil(typedLid) ? null : typedLid, aimed_bin: aimedBin, hit_bin: near.bin,
        aimed: aimOffset(aimedBin, rule), hit: aimOffset(near.bin, rule), correction_used_ms: Number(correctionUsedMs),
        implied_ms: impliedCorrectionBins(rule, correctionUsedMs, near.bin, aimedBin), state: Object.keys(st).sort().join("="),
        methodology: methodologyFor(data, gameKey, platformKey).id
      };
      if (!isNil(o.attempt)) sample.attempt = o.attempt;
      if (!isNil(o.note)) sample.note = o.note;
      if (!isNil(o.player)) sample.player = o.player;
    }
    return { candidates: inv.candidates, candidateBins: inv.candidates.map(function (c) { return c.bin; }), nearest: near, nearestBin: near ? near.bin : null,
      ambiguous: inv.ambiguous, sample: sample };
  }

  // ---- verify ------------------------------------------------------------------------------------
  // verify(data, game, platformKey, tid, lid|null, measuredS, {state}): the moderator's menu-to-press time (from the VISIBLE menu box to
  // the A press) against the typed IDs: predicted bin vs the bins that produce the IDs.
  function verify(data, gameKey, platformKey, tid, lid, measuredS, opts) {
    var o = opts || {};
    var rule = binRule(data, gameKey);
    finite(measuredS, "measured time (s)");
    var inv = invert(data, gameKey, tid, { lid: isNil(lid) ? null : lid, platformKey: platformKey, states: isNil(o.state) ? null : [o.state] });
    var predictedOffset = measuredS * FPS + VISIBLE_MENU_LAG_FRAMES;
    var predictedBin = binOf(Math.floor(predictedOffset + 0.5), rule);
    var bins = inv.candidates.map(function (c) { return c.bin; });
    var nearest = null, ref = predictedBin === null ? -1000 : predictedBin;
    bins.forEach(function (b) { if (nearest === null || Math.abs(b - ref) < Math.abs(nearest - ref) || (Math.abs(b - ref) === Math.abs(nearest - ref) && b < nearest)) nearest = b; });
    var diff = (nearest === null || predictedBin === null) ? null : nearest - predictedBin;
    return { predictedOffset: predictedOffset, predictedBin: predictedBin, bins: bins, nearest: nearest, differenceBins: diff,
      inTable: bins.length > 0, consistent: diff !== null && Math.abs(diff) <= 1 };
  }

  return {
    FPS: FPS, FRAME_MS: FRAME_MS, VISIBLE_MENU_LAG_FRAMES: VISIBLE_MENU_LAG_FRAMES, BIN_COUNT: BIN_COUNT, OFFSET_MAX: OFFSET_MAX,
    POLL_PERIOD_FRAMES: POLL_PERIOD_FRAMES, TAP_FRAMES: TAP_FRAMES, TAP_MS: TAP_MS, ROLL_SETTLE_S: ROLL_SETTLE_S, OUTLIER_FRAMES: OUTLIER_FRAMES,
    TWO_STATE_PRIOR: TWO_STATE_PRIOR, ANCHOR_MENU: ANCHOR_MENU, ANCHOR_POWERON: ANCHOR_POWERON, ANCHOR_RESET: ANCHOR_RESET, ANCHORS: ANCHORS,
    game: game, binRule: binRule, methodology: methodology, methodologyFor: methodologyFor, stateIds: stateIds, stateInfo: stateInfo,
    isHaltedState: isHaltedState, tableKey: tableKey, splitKey: splitKey, tableRecord: tableRecord, resolveTable: resolveTable, decodeTable: decodeTable,
    tableFor: tableFor, tableKeys: tableKeys,
    binOf: binOf, bin: bin, offsetsForBin: offsetsForBin, aimOffset: aimOffset, visibleWindow: visibleWindow, pressFrame: pressFrame,
    acceptFrame: acceptFrame, rollFrame: rollFrame, lookup: lookup, entries: entries,
    carrierGroups: carrierGroups, reachable: reachable, invert: invert, ambiguity: ambiguity,
    makeTargetSet: makeTargetSet, targetSetsFor: targetSetsFor, setAccepts: setAccepts, setDescribe: setDescribe, setsAccepting: setsAccepting,
    verdict: verdict, verdictDetail: verdictDetail, verdictText: verdictText, targets: targets, targetsAllStates: targetsAllStates,
    scheduleGen2: scheduleGen2, schedule: scheduleGen2,
    errorFramesBins: errorFramesBins, isOutlierBins: isOutlierBins, impliedCorrectionBins: impliedCorrectionBins, sampleFromHit: sampleFromHit,
    verify: verify, parseTid: g1.parseTid, formatTid: g1.formatTid, hex: hex
  };
});
