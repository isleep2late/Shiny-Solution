(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rng.js"));
  else root.ShinyGen4 = factory(root.ShinyCore);
})(typeof self !== "undefined" ? self : this, function (core) {
  var NDS_FPS = 59.8261;

  function Mt19937(seedValue) {
    this.state = new Array(624);
    this.state[0] = seedValue >>> 0;
    for (var i = 1; i < 624; i++) {
      var prev = this.state[i - 1];
      this.state[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.index = 624;
  }

  Mt19937.prototype.generate = function () {
    var st = this.state;
    for (var i = 0; i < 624; i++) {
      var y = ((st[i] & 0x80000000) | (st[(i + 1) % 624] & 0x7fffffff)) >>> 0;
      var next = st[(i + 397) % 624] ^ (y >>> 1);
      if ((y & 1) !== 0) next ^= 0x9908b0df;
      st[i] = next >>> 0;
    }
    this.index = 0;
  };

  Mt19937.prototype.next = function () {
    if (this.index >= 624) this.generate();
    var y = this.state[this.index++];
    y = (y ^ (y >>> 11)) >>> 0;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y = (y ^ (y >>> 18)) >>> 0;
    return y;
  };

  function seed(year, month, day, hour, minute, second, delay) {
    var ab = ((month * day + minute + second) << 24) >>> 0;
    var tail = (year - 2000) >>> 0;
    return (ab + ((hour << 16) >>> 0) + tail + (delay >>> 0)) >>> 0;
  }

  function tidSid(seedValue) {
    var mt = new Mt19937(seedValue);
    mt.next();
    var r = mt.next();
    return { tid: r & 0xffff, sid: r >>> 16 };
  }

  function coinFlips(seedValue, count) {
    var mt = new Mt19937(seedValue);
    var out = "";
    for (var i = 0; i < count; i++) {
      out += (mt.next() & 1) === 0 ? "T" : "H";
    }
    return out;
  }

  function elmCalls(seedValue, count, skips) {
    var s = seedValue >>> 0;
    for (var i = 0; i < skips; i++) s = core.next(s);
    var out = "";
    for (var j = 0; j < count; j++) {
      s = core.next(s);
      var v = core.hi(s) % 3;
      out += v === 0 ? "E" : v === 1 ? "K" : "P";
    }
    return out;
  }

  function searchTid(targetTid, year, month, day, hour, minute, delayMin, delayMax, limit) {
    var results = [];
    var cap = limit || 20;
    for (var second = 0; second < 60; second++) {
      for (var delay = delayMin; delay <= delayMax; delay++) {
        var sv = seed(year, month, day, hour, minute, second, delay);
        var ids = tidSid(sv);
        if (ids.tid === targetTid) {
          results.push({ second: second, delay: delay, seed: sv, tid: ids.tid, sid: ids.sid });
          if (results.length >= cap) return results;
        }
      }
    }
    return results;
  }

  function matchCoinFlips(flips, year, month, day, hour, minute, secondCenter, secondRadius, delayMin, delayMax, limit) {
    var results = [];
    var wanted = ("" + flips).trim().toUpperCase();
    if (wanted.length === 0) return results;
    var cap = limit || 20;
    var lo = Math.max(0, secondCenter - secondRadius);
    var hi = Math.min(59, secondCenter + secondRadius);
    for (var second = lo; second <= hi; second++) {
      for (var delay = delayMin; delay <= delayMax; delay++) {
        var sv = seed(year, month, day, hour, minute, second, delay);
        if (coinFlips(sv, wanted.length) === wanted) {
          results.push({ second: second, delay: delay, seed: sv });
          if (results.length >= cap) return results;
        }
      }
    }
    return results;
  }

  function toMs(delays) {
    return delays * 1000.0 / NDS_FPS;
  }

  function toDelays(ms) {
    return ms * NDS_FPS / 1000.0;
  }

  function calibrationMs(calibratedDelay, calibratedSecond) {
    return toMs(calibratedDelay) - calibratedSecond * 1000.0;
  }

  // Phase 1 is wound forward a whole minute at a time until it is long enough to
  // start the DS in. A non-finite p1 never reaches 14000, so the wind has to be
  // guarded rather than looped: an out-of-range calibrated second used to hang
  // the tab outright.
  function windForward(p1) {
    if (!isFinite(p1)) return NaN;
    return p1 + Math.max(0, Math.ceil((14000 - p1) / 60000)) * 60000;
  }

  function timerPhases(targetDelay, targetSecond, calibratedDelay, calibratedSecond) {
    var calibration = calibrationMs(calibratedDelay, calibratedSecond);
    var p2 = toMs(targetDelay) - calibration;
    var p1 = windForward(targetSecond * 1000.0 + calibration + 200.0 - toMs(targetDelay));
    return { phase1Ms: p1, phase2Ms: p2 };
  }

  // EonTimer's "minutes before target": the span at calibration 0. EonTimer computes
  // it that way on purpose (gen4Timer.ts:25-29; docs/FACTS.md:1314) and this has to
  // keep matching it, so that someone cross-checking against the community's timer
  // sees the same figure here. It is derived from timerPhases rather than restated,
  // so the two cannot drift. It is NOT always what the calibrated timer spans - see
  // minutesSpanned, and show both when they differ.
  function minutesBefore(targetDelay, targetSecond) {
    var p = timerPhases(targetDelay, targetSecond, 0, 0);
    return Math.floor((p.phase1Ms + p.phase2Ms) / 60000.0);
  }

  // What the CALIBRATED timer really spans, read off the same phases the countdown
  // runs. Calibration cancels out of p1 + p2 exactly - except that p1 is wound up to
  // the 14 s minimum AFTER calibration is applied (delayTimer.ts:9-22, same order as
  // here), so when calibration carries p1 across that threshold the total jumps by a
  // whole minute. At the default 500 / 14 that happens for 9.4% of (delay, second)
  // pairs. When it does, the DS clock has to go by THIS number: the RTC at the press
  // is the RTC at timer start plus the real span, not the calibration-0 one.
  function minutesSpanned(targetDelay, targetSecond, calibratedDelay, calibratedSecond) {
    var p = timerPhases(targetDelay, targetSecond, calibratedDelay, calibratedSecond);
    return Math.floor((p.phase1Ms + p.phase2Ms) / 60000.0);
  }

  function calibrate(calibratedDelay, targetDelay, hitDelay) {
    var delta = toMs(hitDelay) - toMs(targetDelay);
    if (Math.abs(delta) <= 167) delta *= 0.75;
    return calibratedDelay + toDelays(delta);
  }

  // ---- Cute Charm (wild encounters, DPPt + HGSS) ----
  // pokeplatinum overlay006/wild_encounters.c CreateWildMon: with a Cute Charm lead there is a 2/3 roll
  // (LCRNG_RandMod(3) > 0) to force the encounter to the OPPOSITE gender of the lead, and the personality is
  // then BUILT, not rolled: pokemon.c sub_02074088 -> sub_02074128 gives nature for a forced female and
  // 25 * (floor(ratio / 25) + 1) + nature for a forced male (pokeheartgold pokemon.c
  // GenPersonalityByGenderAndNature is the same code). Species with one gender or none are skipped.
  // Every such PID is below 65536, so the Gen 4 shiny rule (tid ^ sid ^ pidHi ^ pidLo) < 8 collapses to
  // ((tid ^ sid) >> 3) == (pid >> 3): one TID/SID pair is shiny for the natures of exactly one group.
  // Community source: Smogon DPP/HGSS RNG guide part 5 (Cute Charm TID/SID); its example 20101/20101 is
  // "male lead, PIDs 0-7", which is what cuteCharm(20101, 20101) reports.
  var GENDER_RATIOS = [
    { ratio: 31, label: "87.5% male / 12.5% female" },
    { ratio: 63, label: "75% male / 25% female" },
    { ratio: 127, label: "50% male / 50% female" },
    { ratio: 191, label: "25% male / 75% female" },
    { ratio: 225, label: "12.5% male / 87.5% female" }
  ];
  var CUTE_CHARM_ACTIVATION = 2 / 3;
  function cuteCharmPid(ratio, forcedGender, nature) {
    return forcedGender === "male" ? 25 * (Math.floor(ratio / 25) + 1) + nature : nature;
  }
  function cuteCharm(tid, sid) {
    var tsv = ((tid ^ sid) & 0xffff) >>> 3;
    var groups = [];
    function group(lead, forced, ratioLabel, ratio) {
      var natures = [], wrong = [];
      for (var n = 0; n < 25; n++) {
        var pid = cuteCharmPid(ratio, forced, n);
        if ((pid >>> 3) !== tsv) continue;
        natures.push(n);
        // for the 12.5%-male ratio the forced-male PID passes 255 for natures 6-24: the low byte wraps below
        // the ratio and the game hands out a FEMALE. Shininess is unaffected (it uses the whole PID).
        if (forced === "male" && (pid & 0xff) < ratio) wrong.push(n);
      }
      if (natures.length) groups.push({ lead: lead, target: forced, ratio: ratioLabel, natures: natures,
        pids: natures.map(function (n) { return cuteCharmPid(ratio, forced, n); }),
        chance: CUTE_CHARM_ACTIVATION * natures.length / 25, genderMismatch: wrong });
    }
    // a male lead forces a female: nature-only PIDs, identical for every gendered ratio
    group("male", "female", "any species with both genders", 31);
    for (var i = 0; i < GENDER_RATIOS.length; i++) group("female", "male", GENDER_RATIOS[i].label, GENDER_RATIOS[i].ratio);
    var best = groups.reduce(function (b, g) { return !b || g.chance > b.chance ? g : b; }, null);
    return { tsv: tsv, groups: groups, best: best };
  }
  // Which TSV values (tid ^ sid, ignoring the low 3 bits) have any Cute Charm group at all, and what they give.
  function cuteCharmTable() {
    var rows = [];
    for (var tsv = 0; tsv <= 34; tsv++) {          // the 12.5%-male ratio reaches PID 274 -> PSV 34
      var r = cuteCharm(tsv << 3, 0);
      if (r.groups.length) rows.push({ tsv: tsv, xorFrom: tsv << 3, xorTo: (tsv << 3) + 7, groups: r.groups });
    }
    return rows;
  }

  function searchShinyFromSeed(seedValue, tid, sid, startAdvance, maxAdvance, filters, limit) {
    return core.searchStarter(core.jump(seedValue, startAdvance), startAdvance, tid, sid, {
      maxAdvance: maxAdvance,
      limit: limit || 15,
      nature: filters ? filters.nature : null,
      gender: filters ? filters.gender : null,
      genderThreshold: filters && filters.genderThreshold !== undefined ? filters.genderThreshold : 31,
      minIv: filters ? filters.minIv : 0
    });
  }

  return {
    NDS_FPS: NDS_FPS,
    Mt19937: Mt19937,
    seed: seed,
    tidSid: tidSid,
    coinFlips: coinFlips,
    elmCalls: elmCalls,
    searchTid: searchTid,
    matchCoinFlips: matchCoinFlips,
    toMs: toMs,
    toDelays: toDelays,
    calibrationMs: calibrationMs,
    timerPhases: timerPhases,
    minutesBefore: minutesBefore,
    minutesSpanned: minutesSpanned,
    calibrate: calibrate,
    searchShinyFromSeed: searchShinyFromSeed,
    cuteCharm: cuteCharm, cuteCharmTable: cuteCharmTable, cuteCharmPid: cuteCharmPid,
    GENDER_RATIOS: GENDER_RATIOS, CUTE_CHARM_ACTIVATION: CUTE_CHARM_ACTIVATION
  };
});
