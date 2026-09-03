// Gen 4 seed-to-time and LCRNG reversal (Phase 5 of the RNG guide design, sections 5.3/5.4/6.2).
//
// The seed (STRUCTURAL, pokeplatinum/src/main.c:306-315; pokeheartgold/src/main.c:281-284 with
// include/gf_rtc.h:46-51; pokediamond/arm9/src/main.c:239-249):
//   seed = ((month*day + minute + second) << 24) + (hour << 16) + (year - 2000) + delay
// where delay is gSystem.vblankCounter, the count of VBlanks since boot (main.c:136-150). The same
// value seeds the MT (TID/SID = 2nd output, coin flips) and the LCRNG (everything else).
//
// This module is the tool layer over that formula:
//   - seedToTimes: the inverse of seed() for one year (PokeFinder SeedToTimeCalculator4::calculateTimes,
//     Core/Gen4/Tools/SeedToTimeCalculator4.cpp:24-56, EMPIRICAL port: ordering and the hour-overflow rule).
//   - calibrateRows: the neighbour table (second +-s outer, delay -k..+k inner) with each row's seed and its
//     verification string (SeedToTimeCalculator4.cpp:58-105, SeedTime4.cpp:63-66, Utilities.cpp Utilities4).
//   - the reversal: IV pair -> seeds (PKHeX LCRNGReversal.GetSeedsIVs), the Method 4 skip variant
//     (LCRNGReversalSkip.GetSeedsIVs), PID -> seeds (LCRNGReversal.GetSeeds); PKHeX return semantics.
//   - reachableSeeds / seedsToTimes / wantedToTimes: the reachability-first search of design section 5.3
//     (back-step with the hour byte <= 23 filter), then the times for each candidate by delay distance.
//   - planAdvances: the advance planner with each tool's cost and citation.
//
// Phase 3 (core/generators.js) carries a copy of the IV reversal (seedsForIvWords) and a simpler back-step
// (gen4SeedsForTarget); the two are to be deduplicated onto this module when the branches merge.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rng.js"), require("./gen4.js"));
  else root.ShinySeedTime4 = factory(root.ShinyCore, root.ShinyGen4);
})(typeof self !== "undefined" ? self : this, function (core, gen4) {
  var MULT = 0x41c64e6d;
  var ADD = 0x6073;
  // Reverse LCRNG constants: PKHeX LCRNG.cs:30-31 (rMult, rAdd); PokeFinder LCRNG.hpp:295 (PokeRNGR).
  var RMULT = 0xeeb9eb65;
  var RADD = 0x0a3561a1;
  var NATURES = core.NATURES;

  function u32(x) { return x >>> 0; }
  function next(s) { return u32(Math.imul(s >>> 0, MULT) + ADD); }
  function prev(s) { return u32(Math.imul(s >>> 0, RMULT) + RADD); }
  function hi(s) { return s >>> 16; }
  function hex8(s) { var h = u32(s).toString(16).toUpperCase(); while (h.length < 8) h = "0" + h; return h; }

  function checkInt(name, v, lo, hi_) {
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v) throw new Error(name + " must be an integer, got " + v);
    if (v < lo || v > hi_) throw new Error(name + " must be in " + lo + ".." + hi_ + ", got " + v);
    return v;
  }
  function checkSeed(v) {
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < 0 || v > 0xffffffff) throw new Error("seed must be a 32-bit integer, got " + v);
    return v >>> 0;
  }

  // ------------------------------------------------------------------ dates (PokeFinder Core/Util/DateTime.cpp)
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var MIN_YEAR = 2000, MAX_YEAR = 2099;
  var DAY_COUNT = 36525; // 2000-01-01 .. 2099-12-31 (DateTime.cpp:47-49: minJD 2451545, maxJD 2488069)

  function isLeap(year) { return (year % 4) === 0; } // DateTime.cpp:59-64, exact within 2000..2099
  function daysInMonth(year, month) { return month === 2 && isLeap(year) ? 29 : MONTH_DAYS[month - 1]; } // :79-86

  // days since 2000-01-01 (0-based)
  function dayNumber(year, month, day) {
    var n = 0;
    for (var y = MIN_YEAR; y < year; y++) n += isLeap(y) ? 366 : 365;
    for (var m = 1; m < month; m++) n += daysInMonth(year, m);
    return n + day - 1;
  }
  function fromDayNumber(n) {
    var year = MIN_YEAR;
    while (true) { var len = isLeap(year) ? 366 : 365; if (n < len) break; n -= len; year++; }
    var month = 1;
    while (n >= daysInMonth(year, month)) { n -= daysInMonth(year, month); month++; }
    return { year: year, month: month, day: n + 1 };
  }

  // DateTime::addSeconds (DateTime.cpp:145-160, 196-208): time wraps into days (floor division), the date
  // moves by that many days; past 2099-12-31 it wraps to 2000 (PokeFinder's jdRange modulo), before
  // 2000-01-01 it is invalid (Date::valid, :132-138) and the caller skips the row.
  function addSeconds(t, seconds) {
    var total = t.hour * 3600 + t.minute * 60 + t.second + seconds;
    var days = Math.floor(total / 86400);
    var tod = total - days * 86400;
    var n = dayNumber(t.year, t.month, t.day) + days;
    var valid = true;
    if (n >= DAY_COUNT) n = n % DAY_COUNT;
    if (n < 0) valid = false;
    var d = valid ? fromDayNumber(n) : { year: t.year, month: t.month, day: t.day };
    return { year: d.year, month: d.month, day: d.day, hour: Math.floor(tod / 3600), minute: Math.floor(tod / 60) % 60, second: tod % 60, valid: valid };
  }

  // Utilities4::calcSeed (Utilities.cpp): ab and cd are truncated to bytes before the shift, then the
  // delay and the year offset are added with u32 wrap. Equal to gen4.seed() for hour <= 255.
  function calcSeed(t, delay) {
    var ab = (t.month * t.day + t.minute + t.second) & 0xff;
    var cd = t.hour & 0xff;
    return u32(u32((ab << 24) | (cd << 16)) + u32(delay) + t.year - 2000);
  }

  // ------------------------------------------------------------------ 1. seedToTimes (calculateTimes)
  // Every (date, time, delay) in `year` whose seed() is `seed`: the top byte is month*day+minute+second
  // (mod 256) over every valid combination (PokeFinder's month/day/minute/second order), and the hour and
  // the delay are the decomposition of the low 24 bits with the smallest non-negative delay:
  //   (cd << 16) + efgh = (hour << 16) + (year - 2000) + delay, hour a clock hour 0..23.
  // So hour = cd and delay = efgh - (year - 2000) when that is >= 0. When efgh < year - 2000 the hardware
  // sum carried into the hour byte, so the real time is hour cd - 1 with delay + 0x10000 (when cd is 0 no
  // clock hour reaches the seed in that year: the list is empty). An hour byte above 23 is PokeFinder's
  // overflow rule (SeedToTimeCalculator4.cpp:30-32), the same minimum-delay decomposition: hour 23 with
  // (cd - 23) * 0x10000 moved into the delay; opts.allowHourOverflow=false drops those seeds instead.
  // opts.pokefinderDelay=true reports the carry case as PokeFinder does instead (hour cd and the delay
  // wrapped to a u32, which no console can reach; its Test/Gen4/seedtotime4.json cases are written that
  // way); delaySigned is the delay as an int32 (negative only in that mode).
  function seedToTimes(seed, year, opts) {
    seed = checkSeed(seed);
    checkInt("year", year, MIN_YEAR, MAX_YEAR);
    var o = opts || {};
    var forceSecond = o.forceSecond === undefined || o.forceSecond === null ? null : checkInt("forceSecond", o.forceSecond, 0, 59);
    var limit = o.limit === undefined || o.limit === null ? Infinity : o.limit;
    var ab = seed >>> 24;
    var cd = (seed >>> 16) & 0xff;
    var efgh = seed & 0xffff;
    var results = [];
    if (cd > 23 && o.allowHourOverflow === false) return results;
    var hour = cd > 23 ? 23 : cd;
    var delay = (cd - hour) * 0x10000 + efgh - (year - 2000);
    if (delay < 0) {
      if (o.pokefinderDelay) delay = u32(delay);
      else if (hour >= 1) { hour -= 1; delay += 0x10000; }
      else return results;
    }
    for (var month = 1; month <= 12; month++) {
      var maxDays = daysInMonth(year, month);
      for (var day = 1; day <= maxDays; day++) {
        for (var minute = 0; minute < 60; minute++) {
          for (var second = 0; second < 60; second++) {
            if (ab === ((month * day + minute + second) & 0xff)) {
              if (forceSecond === null || second === forceSecond) {
                results.push({ year: year, month: month, day: day, hour: hour, minute: minute, second: second, delay: delay, delaySigned: delay | 0, seed: seed });
                if (results.length >= limit) return results;
              }
            }
          }
        }
      }
    }
    return results;
  }

  // ------------------------------------------------------------------ verification strings
  // DPPt coin toss: one MT output per flip, & 1, 1 = Heads (pokeplatinum/src/applications/poketch/coin_toss/main.c:158,
  // MTRNG_Next() % 2). The MT is drained without touching the LCRNG. PokeFinder Utilities4::coinFlips
  // formats 20 flips as "H, T, ..." (Utilities.cpp).
  function coinFlipsFormatted(seed) {
    var compact = gen4.coinFlips(seed, 20);
    return compact.split("").join(", ");
  }

  // HGSS Elm calls: each call is one LCRNG advance, hi16 % 3 -> E/K/P
  // (pokeheartgold/src/application/pokegear/phone/scripts/phone_scripts_prof_elm.c:84, post-game with the
  // Pokerus flag) or hi16 % 2 -> E/K before that flag (:86) and after the Everstone before 7 badges (:59).
  // The letters name the draw (E = 0, K = 1, P = 2), not a fixed message: the two %2 branches start at
  // different scripts, PHONE_SCRIPT_020 (:86) and PHONE_SCRIPT_014 (:59), so the same letters stand for
  // different calls (ELM_LEGEND; phone_script_defs.c:190-240 maps the scripts to msg_0716 rows 15-18 and
  // 27-32). PokeFinder Utilities4::getCalls formats 20+skips calls with the skipped roamer calls in
  // parentheses.
  var ELM_LEGEND = {
    3: { E: "evolution (PHONE_SCRIPT_020, msg_0716 row 27; :84)", K: "Kanto (PHONE_SCRIPT_021, row 29)", P: "Pokerus (PHONE_SCRIPT_022, row 31)" },
    2: { E: "post-game before the Pokerus flag (:86): evolution (PHONE_SCRIPT_020, row 27); after the Everstone before 7 badges (:59): egg hatch time (PHONE_SCRIPT_014, row 15)",
         K: "post-game before the Pokerus flag (:86): Kanto (PHONE_SCRIPT_021, row 29); after the Everstone before 7 badges (:59): hatched moves (PHONE_SCRIPT_015, row 17)" }
  };
  function elmCallsFormatted(seed, skips, ways) {
    var w = ways === 2 ? 2 : 3;
    var s = seed >>> 0;
    var total = 20 + skips;
    var out = skips > 0 ? "(" : "";
    var compact = "";
    for (var i = 0; i < total; i++) {
      s = next(s);
      var call = hi(s) % w;
      var letter = call === 0 ? "E" : call === 1 ? "K" : "P";
      out += letter;
      if (i >= skips) compact += letter;
      if (i !== total - 1) out += (skips !== 0 && skips === i + 1) ? " skipped)  " : ", ";
    }
    return { sequence: out, calls: compact };
  }

  // HGSS roamers: when a saved game is continued, every active roamer re-rolls its route from the LCRNG
  // before the player has control: pokeheartgold/src/field_warp_tasks.c:355-379 (FieldTask_ContinueGame_Normal,
  // case 0, calls sub_02067BE8) -> asm/unk_02067A60.s:212-220 (a thunk: Save_Roamers_Get, then
  // Save_RandomizeRoamersLocation) -> src/field_roamer.c:123-130 (every active roamer in the order Raikou,
  // Entei, Latias, Latios of include/constants/roamer.h:4-7; two more thunks re-roll on the warps at
  // field_warp_tasks.c:633 and :744). The draw (:236-254): LCRandom() % 16 + Johto start for Raikou/Entei,
  // % 25 + Kanto start for Latias/Latios, retried while it equals the roamer's current map or the player's
  // last map (:118-121 passes PlayerLocationHistoryGetBack). Route tables: field_roamer.c:24-69
  // (Johto 29-39, 42-46; Kanto 1-22, 24, 26, 28). PokeFinder HGSSRoamer.cpp models the retry against the
  // previous route only (the player is assumed to be off the roamer maps) and counts the calls as skips.
  function routeJ(rand16) { var v = rand16 & 15; return v < 11 ? v + 29 : v + 31; }
  function routeK(rand16) { var v = rand16 % 25; return v === 22 ? 24 : v === 23 ? 26 : v === 24 ? 28 : v + 1; }
  function roamerRoutes(seed, roamers, routes) {
    var r = roamers || {};
    var p = routes || {};
    var s = seed >>> 0;
    var skips = 0;
    var raikou = 0, entei = 0, lati = 0;
    if (r.raikou) { do { s = next(s); skips++; raikou = routeJ(hi(s)); } while ((p.raikou || 0) === raikou); }
    if (r.entei) { do { s = next(s); skips++; entei = routeJ(hi(s)); } while ((p.entei || 0) === entei); }
    if (r.lati) { do { s = next(s); skips++; lati = routeK(hi(s)); } while ((p.lati || 0) === lati); }
    var str = "";
    if (raikou) str += "R: " + raikou + " ";
    if (entei) str += "E: " + entei + " ";
    if (lati) str += "L: " + lati;
    return { raikou: raikou, entei: entei, lati: lati, skips: skips, routeString: str };
  }

  // Chatot: one LCRNG advance per cry, the pitch is the speed variance hi16 % 8192
  // (pokeplatinum/src/sound_chatot.c:80; pokeheartgold/src/sound_chatot.c:59). PokeFinder reports
  // (rand % 8192) * 100 >> 13 in five bands (State4.hpp:49; Utilities.cpp getPitch): EMPIRICAL scale.
  function chatotPitch(rand16) {
    var v = ((rand16 % 8192) * 100) >> 13;
    var band = v < 20 ? "L" : v < 40 ? "ML" : v < 60 ? "M" : v < 80 ? "MH" : "H";
    return { value: v, band: band };
  }
  function chatotSequence(seed, count) {
    var s = seed >>> 0;
    var out = [];
    for (var i = 0; i < count; i++) { s = next(s); out.push(chatotPitch(hi(s))); }
    return out;
  }

  function gameFamily(game) {
    var g = ("" + (game || "")).toLowerCase();
    if (g === "hgss" || g === "hg" || g === "ss" || g === "heartgold" || g === "soulsilver") return "HGSS";
    if (g === "dppt" || g === "dp" || g === "pt" || g === "d" || g === "p" || g === "diamond" || g === "pearl" || g === "platinum") return "DPPt";
    throw new Error("game must be DPPt or HGSS (got " + game + ")");
  }

  // ------------------------------------------------------------------ 2. calibrateRows (calibrate)
  // The target is opts.target ({year, month, day, hour, minute, second, delay}, checked: a real date, a clock
  // hour, delay 0..0xFFFFFF) or the first seedToTimes row for opts.year (default 2000, with opts.forceSecond).
  // Rows: second offset -s..+s outer (rows whose date falls before 2000-01-01 are skipped), delay offset
  // -k..+k inner (PokeFinder's u32 arithmetic: an offset below delay 0 wraps, the row re-seeds but is not a
  // reachable event); each row carries its own seed and the game's verification string. HGSS options:
  // roamers {raikou, entei, lati}, routes {raikou, entei, lati} (the roamer's previous route, 0 = none),
  // elmWays (3 or 2).
  function checkTarget(t) {
    if (!t || typeof t !== "object") throw new Error("target must be an object {year, month, day, hour, minute, second, delay}");
    checkInt("target.year", t.year, MIN_YEAR, MAX_YEAR);
    checkInt("target.month", t.month, 1, 12);
    checkInt("target.day", t.day, 1, daysInMonth(t.year, t.month));
    checkInt("target.hour", t.hour, 0, 23);
    checkInt("target.minute", t.minute, 0, 59);
    checkInt("target.second", t.second, 0, 59);
    checkInt("target.delay", t.delay, 0, 0xffffff);
    return t;
  }
  function calibrateRows(seed, delayRange, secondRange, game, opts) {
    var o = opts || {};
    var fam = gameFamily(game);
    checkInt("delayRange", delayRange, 0, 100000);
    checkInt("secondRange", secondRange, 0, 3600);
    var target = o.target === undefined || o.target === null ? null : checkTarget(o.target);
    if (!target) {
      var times = seedToTimes(seed, o.year === undefined ? 2000 : o.year, { forceSecond: o.forceSecond, limit: 1 });
      if (times.length === 0) throw new Error("seed " + hex8(seed) + " has no time in " + (o.year === undefined ? 2000 : o.year));
      target = times[0];
    }
    var rows = [];
    for (var so = -secondRange; so <= secondRange; so++) {
      var t = addSeconds(target, so);
      if (!t.valid) continue;
      for (var dof = -delayRange; dof <= delayRange; dof++) {
        var delay = u32(u32(target.delay) + dof);
        var rowSeed = calcSeed(t, delay);
        var row = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second,
          delay: delay, secondOffset: so, delayOffset: dof, seed: rowSeed };
        if (fam === "DPPt") {
          row.flips = gen4.coinFlips(rowSeed, 20);
          row.sequence = coinFlipsFormatted(rowSeed);
        } else {
          var roamer = (o.roamers && (o.roamers.raikou || o.roamers.entei || o.roamers.lati)) ? roamerRoutes(rowSeed, o.roamers, o.routes) : null;
          var skips = roamer ? roamer.skips : 0;
          var calls = elmCallsFormatted(rowSeed, skips, o.elmWays);
          row.calls = calls.calls;
          row.sequence = calls.sequence;
          row.roamer = roamer;
        }
        rows.push(row);
      }
    }
    return rows;
  }

  // ------------------------------------------------------------------ 3. advance planner
  // Each tool's cost per use in LCRNG advances, with its evidence label and citation.
  var ADVANCE_TOOLS = {
    chatot: { perUse: 1, label: "STRUCTURAL", what: "one Chatot cry (summary screen or Chatot's cry)",
      cite: "pokeplatinum/src/sound_chatot.c:80 (LCRNG_Next() % 8192); pokeheartgold/src/sound_chatot.c:59" },
    journal: { perUse: 2, label: "EMPIRICAL", what: "one Journal page flip (DPPt)",
      cite: "community convention (+2 per flip); no LCRNG call in pokeplatinum/src/journal.c, so not decomp-proven" },
    walk128: { perUse: 1, perPartyMon: true, label: "STRUCTURAL", what: "one 128-step friendship cycle: +1 per party member",
      cite: "pokeplatinum/src/overlay005/field_control.c:759-760,871 (step counter wraps at 128, then every party mon), src/pokemon.c:2637-2641 (LCRNG_Next() & 1 per mon); pokeheartgold/src/pokemon.c:2037" },
    elmCall: { perUse: 1, label: "STRUCTURAL", what: "one Elm call (HGSS, only on the story states that roll)",
      cite: "pokeheartgold/src/application/pokegear/phone/scripts/phone_scripts_prof_elm.c:59,84,86" },
    coinFlip: { perUse: 0, label: "STRUCTURAL", what: "one Poketch coin flip (DPPt): drains the MT only",
      cite: "pokeplatinum/src/applications/poketch/coin_toss/main.c:158 (MTRNG_Next() % 2)" },
    battleEnd: { perUse: 1, label: "STRUCTURAL", what: "a battle ending: at least the Pokerus roll",
      cite: "design section 5.3 (battle_controller_player.c:4044-4048); count per battle may be higher" }
  };

  function advanceCosts() {
    var out = {};
    for (var k in ADVANCE_TOOLS) if (Object.prototype.hasOwnProperty.call(ADVANCE_TOOLS, k)) {
      var t = ADVANCE_TOOLS[k];
      out[k] = { perUse: t.perUse, perPartyMon: !!t.perPartyMon, label: t.label, what: t.what, cite: t.cite };
    }
    return out;
  }

  // Greedy plan: tools in the given priority order (default walk128, journal, chatot), each used as many
  // whole times as fit; the remainder is what no listed tool can cover (0 when a 1-advance tool is listed).
  function planAdvances(currentFrame, targetFrame, opts) {
    var o = opts || {};
    checkInt("currentFrame", currentFrame, 0, 0xffffffff);
    checkInt("targetFrame", targetFrame, 0, 0xffffffff);
    var partyCount = o.partyCount === undefined ? 1 : checkInt("partyCount", o.partyCount, 1, 6);
    var tools = o.tools || ["walk128", "journal", "chatot"];
    var needed = targetFrame - currentFrame;
    var plan = [];
    if (needed < 0) return { needed: needed, plan: plan, remainder: 0, note: "target frame is behind the current frame: reset and start again" };
    var remaining = needed;
    for (var i = 0; i < tools.length; i++) {
      var name = tools[i];
      var t = ADVANCE_TOOLS[name];
      if (!t) throw new Error("unknown advance tool " + name);
      var per = t.perPartyMon ? t.perUse * partyCount : t.perUse;
      if (per <= 0) continue;
      var uses = Math.floor(remaining / per);
      if (uses > 0) {
        plan.push({ tool: name, uses: uses, perUse: per, advances: uses * per, label: t.label, cite: t.cite });
        remaining -= uses * per;
      }
    }
    return { needed: needed, plan: plan, remainder: remaining };
  }

  // ------------------------------------------------------------------ 4. reversal (PKHeX semantics)
  // PKHeX.Core/Legality/RNG/Algorithms/LCRNGReversal.cs, lattice bounds from StarfBerry's LCG_Recovery.py.
  // Returns every state R with hi15(next(R)) = IV word 1 and hi15(next(next(R))) = IV word 2, i.e. the
  // state one call BEFORE the IV1 call (Method 1: the PID-high state); each result comes with its
  // top-bit twin because bit 15 of an IV word is never observed (LCRNGReversal.cs:93-106).
  var LAG0 = 0x67d3, LAG1 = 0xc907, LOWER = 0x3443, UPPER = 0xc34e;           // :20-23
  var RLAG0 = 0x7ed7, RLAG1 = 0xd33, RLOWER = 0x50f5a0b, RUPPER = 0x50f40b4;   // :14-18
  // LCRNGReversalSkip.cs:14-21
  var RMULT2 = 0xdc6c95d9, SLAG0 = 0x6c31, SLAG1IVS = 0x2e90, SLOWERIVS = 0x1574621d, SUPPERIVS = 0x157488d6;

  function ivWords(hp, atk, def, spa, spd, spe) {
    checkInt("hp", hp, 0, 31); checkInt("atk", atk, 0, 31); checkInt("def", def, 0, 31);
    checkInt("spa", spa, 0, 31); checkInt("spd", spd, 0, 31); checkInt("spe", spe, 0, 31);
    return { first: u32((hp | (atk << 5) | (def << 10)) << 16), second: u32((spe | (spa << 5) | (spd << 10)) << 16) };
  }

  function addSeedsIvs(out, low, first, second) {                             // LCRNGReversal.cs:93-106
    low = low % LAG1;
    do {
      var seed = u32(first | low);
      if (u32(next(seed) & 0x7fff0000) === second) {
        seed = prev(seed);
        out.push(seed);
        out.push(u32(seed ^ 0x80000000));
      }
      low += LAG1;
    } while (low < 0x10000);
  }

  function seedsForIvWords(first, second) {                                   // LCRNGReversal.cs:77-91
    var tmp = u32(Math.imul(u32(second - Math.imul(MULT, first)) >>> 16, LAG1));
    var lo = u32(Math.imul(u32(tmp + LOWER) >>> 15, LAG0));
    var mi = u32(lo + LAG0);
    var up = u32(Math.imul(u32(tmp + UPPER) >>> 15, LAG0));
    var out = [];
    addSeedsIvs(out, lo, first, second);
    addSeedsIvs(out, mi, first, second);
    if (mi !== up) addSeedsIvs(out, up, first, second);
    return out;
  }

  function ivsToSeeds(hp, atk, def, spa, spd, spe) {                           // LCRNGReversal.cs:36-41
    var w = ivWords(hp, atk, def, spa, spd, spe);
    return seedsForIvWords(w.first, w.second);
  }

  // Method 4: a VBlank call lands between the two IV calls (LCRNGReversalSkip.cs:75-100). Same return
  // semantics: the state one call before IV1.
  function addSeedsIvsSkip(out, low, first, third) {
    do {
      var seed = prev(prev(u32(third | low)));
      if (u32(seed & 0x7fff0000) === first) {
        seed = prev(seed);
        out.push(seed);
        out.push(u32(seed ^ 0x80000000));
      }
      low += SLAG0;
    } while (low < 0x10000);
  }

  function seedsForIvWordsSkip(first, third) {
    var tmp = u32(Math.imul(u32(first - Math.imul(third, RMULT2)) >>> 16, SLAG0));
    var lo = u32(tmp + SLOWERIVS) >>> 15;
    var up = u32(tmp + SUPPERIVS) >>> 15;
    var out = [];
    addSeedsIvsSkip(out, u32(Math.imul(lo, SLAG1IVS)) % SLAG0, first, third);
    if (lo !== up) addSeedsIvsSkip(out, u32(Math.imul(up, SLAG1IVS)) % SLAG0, first, third);
    return out;
  }

  function ivsToSeedsSkip(hp, atk, def, spa, spd, spe) {                       // LCRNGReversalSkip.cs:34-39
    var w = ivWords(hp, atk, def, spa, spd, spe);
    return seedsForIvWordsSkip(w.first, w.second);
  }

  function ivsToSeedsByMethod(ivs, method) {
    var m = ("" + (method || "M1")).toUpperCase();
    if (m === "M4" || m === "METHOD4" || m === "4") return ivsToSeedsSkip(ivs.hp, ivs.atk, ivs.def, ivs.spa, ivs.spd, ivs.spe);
    if (m === "M1" || m === "METHOD1" || m === "1" || m === "J" || m === "K") return ivsToSeeds(ivs.hp, ivs.atk, ivs.def, ivs.spa, ivs.spd, ivs.spe);
    throw new Error("method must be M1 or M4 (got " + method + ")");
  }

  // PID -> seeds (LCRNGReversal.cs:50-68): the PID is hi16 of two consecutive calls, low half first
  // (pokeplatinum/src/pokemon.c:412,452-470). Returns the state BEFORE the PID-low call, i.e. the seed
  // whose frame 0 has this PID; empty when the lattice bounds disagree (about 10% of PIDs) or no state fits.
  function pidToSeeds(pid) {
    pid = checkSeed(pid);
    var first = u32(pid << 16);
    var second = u32(pid & 0xffff0000);
    var tmp = u32(Math.imul(u32(Math.imul(second, RMULT) - first) >>> 16, RLAG0));
    var lo = u32(tmp + RLOWER) >>> 16;
    var up = u32(tmp + RUPPER) >>> 16;
    var out = [];
    if (lo !== up) return out;
    var low = u32(Math.imul(lo, RLAG1)) % RLAG0;
    do {
      var seed = prev(u32(second | low));
      if (u32(seed & 0xffff0000) === first) out.push(prev(seed));
      low += RLAG0;
    } while (low < 0x10000);
    return out;
  }

  // The Method 1 mon generated from `frameSeed` (calls 1..4 after it), optionally with the Method 4 skip.
  function monFromFrameSeed(frameSeed, method) {
    var m = ("" + (method || "M1")).toUpperCase();
    var s1 = next(frameSeed), s2 = next(s1), s3 = next(s2), s4 = next(s3);
    var ivState2 = s4;
    if (m === "M4" || m === "METHOD4" || m === "4") ivState2 = next(s4);
    var pid = u32((hi(s2) << 16) | hi(s1));
    var w1 = hi(s3), w2 = hi(ivState2);
    return {
      pid: pid, nature: pid % 25, natureName: NATURES[pid % 25],
      ivs: { hp: w1 & 31, atk: (w1 >> 5) & 31, def: (w1 >> 10) & 31, spe: w2 & 31, spa: (w2 >> 5) & 31, spd: (w2 >> 10) & 31 }
    };
  }

  // Back-step each origin state to the seed of frame 0..maxFrame and keep the seeds whose hour byte is a
  // clock hour (design 5.3: "accept the value as a seed iff its hour byte <= 23"). callsBefore is how many
  // calls the origin sits after the frame seed: 2 for ivsToSeeds results (PID lo, PID hi come first),
  // 0 for pidToSeeds results. Frame N = the mon whose first call is the (N+1)-th output after the seed.
  function reachableSeeds(origins, opts) {
    var o = opts || {};
    var callsBefore = o.callsBefore === undefined ? 2 : checkInt("callsBefore", o.callsBefore, 0, 16);
    var maxFrame = o.maxFrame === undefined ? 100 : checkInt("maxFrame", o.maxFrame, 0, 10000000);
    var minFrame = o.minFrame === undefined ? 0 : checkInt("minFrame", o.minFrame, 0, maxFrame);
    var hourMax = o.allowHourOverflow ? 255 : 23;
    var hits = [];
    for (var i = 0; i < origins.length; i++) {
      var s = checkSeed(origins[i]);
      for (var b = 0; b < callsBefore; b++) s = prev(s);
      for (var frame = 0; frame <= maxFrame; frame++) {
        if (frame >= minFrame) {
          var hour = (s >>> 16) & 0xff;
          if (hour <= hourMax) hits.push({ seed: s, frame: frame, hour: hour, ab: s >>> 24, efgh: s & 0xffff, origin: origins[i] >>> 0 });
        }
        s = prev(s);
      }
    }
    hits.sort(function (a, b) { return a.frame - b.frame || a.seed - b.seed; });
    return hits;
  }

  // For each candidate {seed, frame}, the (year, delay) pairs with delay = efgh - (year - 2000) inside
  // [delayMin, delayMax] and year inside [yearMin, yearMax], nearest to targetDelay first, and up to
  // timesPerCandidate date/times for each (forceSecond honoured). A year past 2000 + efgh takes the hour-byte
  // carry of seedToTimes (hour cd - 1, delay + 0x10000; no time at all when the hour byte is 0). Rows sort
  // by delay distance, frame, seed.
  function seedsToTimes(candidates, opts) {
    var o = opts || {};
    var yearMin = o.yearMin === undefined ? MIN_YEAR : checkInt("yearMin", o.yearMin, MIN_YEAR, MAX_YEAR);
    var yearMax = o.yearMax === undefined ? MAX_YEAR : checkInt("yearMax", o.yearMax, yearMin, MAX_YEAR);
    var delayMin = o.delayMin === undefined ? 0 : checkInt("delayMin", o.delayMin, 0, 0xffffff);
    var delayMax = o.delayMax === undefined ? 0xffff : checkInt("delayMax", o.delayMax, delayMin, 0xffffff);
    var targetDelay = o.targetDelay === undefined ? delayMin : checkInt("targetDelay", o.targetDelay, 0, 0xffffff);
    var yearsPer = o.yearsPerCandidate === undefined ? 1 : checkInt("yearsPerCandidate", o.yearsPerCandidate, 1, 100);
    var timesPer = o.timesPerCandidate === undefined ? 1 : checkInt("timesPerCandidate", o.timesPerCandidate, 1, 100000);
    var rows = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var seed = checkSeed(c.seed);
      var cd = (seed >>> 16) & 0xff;
      if (cd > 23 && !o.allowHourOverflow) continue;
      var efgh = seed & 0xffff;
      var extra = cd > 23 ? (cd - 23) * 0x10000 : 0;
      var pairs = [];
      for (var year = yearMin; year <= yearMax; year++) {
        var delay = efgh - (year - 2000) + extra;
        if (delay < 0) { if (cd >= 1) delay += 0x10000; else continue; }
        if (delay >= delayMin && delay <= delayMax) pairs.push({ year: year, delay: delay, dist: Math.abs(delay - targetDelay) });
      }
      pairs.sort(function (a, b) { return a.dist - b.dist || a.year - b.year; });
      for (var p = 0; p < pairs.length && p < yearsPer; p++) {
        var times = seedToTimes(seed, pairs[p].year, { forceSecond: o.forceSecond, limit: timesPer });
        for (var t = 0; t < times.length; t++) {
          var tm = times[t];
          if (tm.delay !== pairs[p].delay) throw new Error("seedsToTimes: delay " + pairs[p].delay + " does not match seedToTimes " + tm.delay);
          rows.push({ seed: seed, frame: c.frame, year: tm.year, month: tm.month, day: tm.day, hour: tm.hour, minute: tm.minute, second: tm.second,
            delay: pairs[p].delay, delayDistance: pairs[p].dist, origin: c.origin });
        }
      }
    }
    rows.sort(function (a, b) { return a.delayDistance - b.delayDistance || a.frame - b.frame || a.seed - b.seed || a.year - b.year || a.month - b.month || a.day - b.day || a.minute - b.minute || a.second - b.second; });
    return rows;
  }

  function isShiny(pid, tid, sid) { return ((tid ^ sid ^ (pid >>> 16) ^ (pid & 0xffff)) & 0xffff) < 8; }

  function natureIndex(nature) {
    if (nature === undefined || nature === null) return null;
    if (typeof nature === "number") return checkInt("nature", nature, 0, 24);
    var idx = NATURES.map(function (n) { return n.toLowerCase(); }).indexOf(("" + nature).toLowerCase());
    if (idx < 0) throw new Error("unknown nature " + nature);
    return idx;
  }

  // Every shiny PID for (tid, sid), optionally of one nature: the low half runs 0..65535 and the high half
  // is low ^ tid ^ sid ^ v for v in 0..7 (pokeheartgold/src/pokemon.c:68-70). 524,288 PIDs, ~21k per nature.
  function shinyPids(tid, sid, nature) {
    checkInt("tid", tid, 0, 0xffff); checkInt("sid", sid, 0, 0xffff);
    var nat = natureIndex(nature);
    var out = [];
    var x = (tid ^ sid) & 0xffff;
    for (var lo = 0; lo < 0x10000; lo++) {
      for (var v = 0; v < 8; v++) {
        var pid = u32((((lo ^ x ^ v) & 0xffff) << 16) | lo);
        if (nat === null || pid % 25 === nat) out.push(pid);
      }
    }
    return out;
  }

  // The combined search. filter: { ivs: {hp,atk,def,spa,spd,spe} | pid | (tid, sid, shiny: true, nature?),
  //   method ("M1" | "M4"), nature, maxFrame, minFrame, yearMin, yearMax, delayMin, delayMax, targetDelay,
  //   forceSecond, timesPerCandidate, yearsPerCandidate, limit }.
  // Returns rows {seed, frame, year, month, day, hour, minute, second, delay, delayDistance, pid, nature,
  // natureName, ivs, shiny} sorted by delay distance from targetDelay.
  function wantedToTimes(filter) {
    var f = filter || {};
    var method = f.method || "M1";
    var nat = natureIndex(f.nature);
    var hasIds = f.tid !== undefined && f.tid !== null && f.sid !== undefined && f.sid !== null;
    var origins = [];
    var callsBefore;
    if (f.ivs) {
      callsBefore = 2;
      var ivOrigins = ivsToSeedsByMethod(f.ivs, method);
      for (var i = 0; i < ivOrigins.length; i++) {
        var s2 = ivOrigins[i];
        var pid = u32((hi(s2) << 16) | hi(prev(s2)));
        if (f.pid !== undefined && f.pid !== null && pid !== u32(f.pid)) continue;
        if (nat !== null && pid % 25 !== nat) continue;
        if (f.shiny && hasIds && !isShiny(pid, f.tid, f.sid)) continue;
        origins.push(s2);
      }
    } else if (f.pid !== undefined && f.pid !== null) {
      callsBefore = 0;
      origins = pidToSeeds(f.pid);
    } else if (f.shiny && hasIds) {
      callsBefore = 0;
      var pids = shinyPids(f.tid, f.sid, nat);
      for (var p = 0; p < pids.length; p++) {
        var found = pidToSeeds(pids[p]);
        for (var q = 0; q < found.length; q++) origins.push(found[q]);
      }
    } else {
      throw new Error("wantedToTimes needs ivs, a pid, or tid+sid with shiny: true");
    }
    var candidates = reachableSeeds(origins, { callsBefore: callsBefore, maxFrame: f.maxFrame, minFrame: f.minFrame, allowHourOverflow: f.allowHourOverflow });
    var rows = seedsToTimes(candidates, f);
    var limit = f.limit === undefined ? 100 : f.limit;
    var out = [];
    for (var r = 0; r < rows.length && out.length < limit; r++) {
      var row = rows[r];
      var mon = monFromFrameSeed(core.jump(row.seed, row.frame), method);
      if (nat !== null && mon.nature !== nat) continue;
      row.pid = mon.pid; row.nature = mon.nature; row.natureName = mon.natureName; row.ivs = mon.ivs;
      row.shiny = hasIds ? isShiny(mon.pid, f.tid, f.sid) : null;
      out.push(row);
    }
    return out;
  }

  // ------------------------------------------------------------------ TID search over every time (IDSearcher4)
  // Only the second MT output is needed for TID/SID, so the state is built up to word 398 and one word is
  // twisted (PokeFinder MTFast<2>(seed, 1), Core/RNG/MTFast.hpp; standard MT19937, math_util.c:79-119).
  function mtSecondOutput(seed) {
    var s = seed >>> 0;
    var s1 = u32(Math.imul(1812433253, s ^ (s >>> 30)) + 1);
    var s2 = u32(Math.imul(1812433253, s1 ^ (s1 >>> 30)) + 2);
    var x = s2;
    for (var i = 3; i <= 398; i++) x = u32(Math.imul(1812433253, x ^ (x >>> 30)) + i);
    var y = u32((s1 & 0x80000000) | (s2 & 0x7fffffff));
    var v = u32(x ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0));
    v = u32(v ^ (v >>> 11));
    v = u32(v ^ ((v << 7) & 0x9d2c5680));
    v = u32(v ^ ((v << 15) & 0xefc60000));
    v = u32(v ^ (v >>> 18));
    return v;
  }

  // PokeFinder IDSearcher4::search order (Core/Gen4/Searchers/IDSearcher4.cpp): efgh outer over the delay
  // range, then ab 0..255, then hour 0..23. delayMin/delayMax are true delays; the seed's low 16 bits are
  // delay + (year - 2000) (PokeFinder loops the low 16 bits and reports delay = efgh + 2000 - year, which
  // is the same thing for year 2000).
  function tidToSeeds(tid, year, delayMin, delayMax, opts) {
    checkInt("tid", tid, 0, 0xffff);
    checkInt("year", year, MIN_YEAR, MAX_YEAR);
    checkInt("delayMin", delayMin, 0, 0xffff); checkInt("delayMax", delayMax, delayMin, 0xffff);
    var o = opts || {};
    var wantSid = o.sid === undefined || o.sid === null ? null : checkInt("sid", o.sid, 0, 0xffff);
    var limit = o.limit === undefined ? Infinity : o.limit;
    var out = [];
    for (var delay = delayMin; delay <= delayMax; delay++) {
      var efgh = delay + (year - 2000);
      if (efgh > 0xffff) break;
      for (var ab = 0; ab < 256; ab++) {
        for (var cd = 0; cd < 24; cd++) {
          var seed = u32(u32((ab << 24) | (cd << 16)) + efgh);
          var r = mtSecondOutput(seed);
          var t = r & 0xffff;
          if (t !== tid) continue;
          var sid = r >>> 16;
          if (wantSid !== null && sid !== wantSid) continue;
          out.push({ seed: seed, delay: delay, tid: t, sid: sid, tsv: ((t ^ sid) >>> 3) & 0x1fff });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }

  return {
    MIN_YEAR: MIN_YEAR, MAX_YEAR: MAX_YEAR,
    next: next, prev: prev, hex8: hex8,
    daysInMonth: daysInMonth, addSeconds: addSeconds, calcSeed: calcSeed,
    seedToTimes: seedToTimes,
    coinFlipsFormatted: coinFlipsFormatted, elmCallsFormatted: elmCallsFormatted, ELM_LEGEND: ELM_LEGEND, checkTarget: checkTarget,
    roamerRoutes: roamerRoutes, routeJ: routeJ, routeK: routeK,
    chatotPitch: chatotPitch, chatotSequence: chatotSequence,
    calibrateRows: calibrateRows,
    advanceCosts: advanceCosts, planAdvances: planAdvances,
    ivsToSeeds: ivsToSeeds, ivsToSeedsSkip: ivsToSeedsSkip, ivsToSeedsByMethod: ivsToSeedsByMethod,
    seedsForIvWords: seedsForIvWords, seedsForIvWordsSkip: seedsForIvWordsSkip,
    pidToSeeds: pidToSeeds, shinyPids: shinyPids, isShiny: isShiny,
    monFromFrameSeed: monFromFrameSeed,
    reachableSeeds: reachableSeeds, seedsToTimes: seedsToTimes, wantedToTimes: wantedToTimes,
    mtSecondOutput: mtSecondOutput, tidToSeeds: tidToSeeds
  };
});
