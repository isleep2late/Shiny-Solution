(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShinyCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var MULT = 1103515245;
  var ADD = 24691;
  var GBA_FPS = 16777216 / 280896;
  var DEAD_BATTERY_SEED_RS = 0x5a0;
  var NATURES = [
    "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
    "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive",
    "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky"
  ];

  function next(s) {
    return (Math.imul(MULT, s) + ADD) >>> 0;
  }

  function jump(s, n) {
    var a = MULT >>> 0;
    var c = ADD >>> 0;
    var r = s >>> 0;
    var k = Math.floor(n);
    while (k > 0) {
      if (k % 2 === 1) r = (Math.imul(a, r) + c) >>> 0;
      c = (Math.imul(a, c) + c) >>> 0;
      a = Math.imul(a, a) >>> 0;
      k = Math.floor(k / 2);
    }
    return r;
  }

  function hi(s) {
    return s >>> 16;
  }

  function ivsFromWords(w1, w2) {
    return {
      hp: w1 & 31,
      atk: (w1 >> 5) & 31,
      def: (w1 >> 10) & 31,
      spe: w2 & 31,
      spa: (w2 >> 5) & 31,
      spd: (w2 >> 10) & 31
    };
  }

  function method1(state) {
    var s1 = next(state);
    var s2 = next(s1);
    var s3 = next(s2);
    var s4 = next(s3);
    var pid = (hi(s2) * 65536 + hi(s1)) >>> 0;
    return {
      pid: pid,
      nature: pid % 25,
      natureName: NATURES[pid % 25],
      genderValue: pid & 255,
      ivs: ivsFromWords(hi(s3), hi(s4)),
      endState: s4
    };
  }

  function isShiny(pid, tid, sid) {
    return ((tid ^ sid ^ (pid >>> 16) ^ (pid & 65535)) & 65535) < 8;
  }

  function genderChar(genderValue, threshold) {
    return genderValue < threshold ? "F" : "M";
  }

  function monMatches(mon, filters) {
    if (!filters) return true;
    if (filters.nature !== null && filters.nature !== undefined && mon.nature !== filters.nature) return false;
    if (filters.gender) {
      var threshold = filters.genderThreshold === undefined || filters.genderThreshold === null ? 31 : filters.genderThreshold;
      if (genderChar(mon.genderValue, threshold) !== filters.gender) return false;
    }
    if (filters.minIv) {
      var ivs = mon.ivs;
      if (ivs.hp < filters.minIv || ivs.atk < filters.minIv || ivs.def < filters.minIv ||
          ivs.spe < filters.minIv || ivs.spa < filters.minIv || ivs.spd < filters.minIv) return false;
    }
    return true;
  }

  function searchStarter(startState, startAdvance, tid, sid, opts) {
    var o = opts || {};
    var maxAdvance = o.maxAdvance !== undefined ? o.maxAdvance : startAdvance + 1000000;
    var limit = o.limit || 10;
    var results = [];
    var s = startState >>> 0;
    for (var i = startAdvance; i <= maxAdvance; i++) {
      var t1 = next(s);
      var t2 = next(t1);
      var pid = (hi(t2) * 65536 + hi(t1)) >>> 0;
      if (isShiny(pid, tid, sid)) {
        var mon = method1(s);
        if (monMatches(mon, o)) {
          mon.advance = i;
          mon.shiny = true;
          results.push(mon);
          if (results.length >= limit) break;
        }
      }
      s = t1;
    }
    return results;
  }

  function searchTid(startState, startAdvance, targetTid, opts) {
    var o = opts || {};
    var maxAdvance = o.maxAdvance !== undefined ? o.maxAdvance : startAdvance + 1000000;
    var limit = o.limit || 10;
    var results = [];
    var s = startState >>> 0;
    for (var i = startAdvance; i <= maxAdvance; i++) {
      var t1 = next(s);
      var t2 = next(t1);
      if (hi(t2) === targetTid) {
        results.push({ advance: i, sid: hi(t1), tid: hi(t2) });
        if (results.length >= limit) break;
      }
      s = t1;
    }
    return results;
  }

  function findByTid(startState, startAdvance, tid, sid, maxAdvance) {
    var results = [];
    var s = startState >>> 0;
    for (var i = startAdvance; i <= maxAdvance; i++) {
      var t1 = next(s);
      var t2 = next(t1);
      if (hi(t2) === tid && (sid === null || sid === undefined || hi(t1) === sid)) {
        results.push({ advance: i, sid: hi(t1), tid: hi(t2) });
      }
      s = t1;
    }
    return results;
  }

  function findByMon(startState, startAdvance, maxAdvance, nature, gender, genderThreshold) {
    var results = [];
    var s = startState >>> 0;
    for (var i = startAdvance; i <= maxAdvance; i++) {
      var mon = method1(s);
      var ok = true;
      if (nature !== null && nature !== undefined && mon.nature !== nature) ok = false;
      if (ok && gender) {
        var t = genderThreshold === undefined || genderThreshold === null ? 31 : genderThreshold;
        if (genderChar(mon.genderValue, t) !== gender) ok = false;
      }
      if (ok) {
        mon.advance = i;
        results.push(mon);
      }
      s = next(s);
    }
    return results;
  }

  function nearestAdvance(candidates, target) {
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      if (best === null || Math.abs(candidates[i].advance - target) < Math.abs(best.advance - target)) {
        best = candidates[i];
      }
    }
    return best;
  }

  function advancesToMs(n, fps) {
    return n * 1000 / (fps || GBA_FPS);
  }

  function msToAdvances(ms, fps) {
    return Math.round(ms * (fps || GBA_FPS) / 1000);
  }

  function fmtMs(ms) {
    var total = Math.max(0, Math.round(ms));
    var m = Math.floor(total / 60000);
    var s = Math.floor((total % 60000) / 1000);
    var frac = total % 1000;
    return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s : "" + s) + "." +
      ("00" + frac).slice(-3);
  }

  var STAT_KEYS = ["atk", "def", "spe", "spa", "spd"];
  var STARTERS_RS = {
    Treecko: { hp: 40, atk: 45, def: 35, spa: 65, spd: 55, spe: 70 },
    Torchic: { hp: 45, atk: 60, def: 40, spa: 70, spd: 50, spe: 45 },
    Mudkip: { hp: 50, atk: 70, def: 50, spa: 50, spd: 50, spe: 40 }
  };

  function natureStatMods(nature) {
    var plus = Math.floor(nature / 5);
    var minus = nature % 5;
    var mods = { atk: 100, def: 100, spe: 100, spa: 100, spd: 100 };
    if (plus !== minus) {
      mods[STAT_KEYS[plus]] = 110;
      mods[STAT_KEYS[minus]] = 90;
    }
    return mods;
  }

  function statsAtLevel(base, ivs, level, nature) {
    var mods = natureStatMods(nature);
    var out = { hp: Math.floor((2 * base.hp + ivs.hp) * level / 100) + level + 10 };
    STAT_KEYS.forEach(function (k) {
      var raw = Math.floor((2 * base[k] + ivs[k]) * level / 100) + 5;
      out[k] = Math.floor(raw * mods[k] / 100);
    });
    return out;
  }

  function natureIndex(name) {
    if (name === null || name === undefined || name === "") return null;
    var lower = ("" + name).toLowerCase();
    for (var i = 0; i < NATURES.length; i++) {
      if (NATURES[i].toLowerCase() === lower) return i;
    }
    return null;
  }

  return {
    MULT: MULT,
    ADD: ADD,
    GBA_FPS: GBA_FPS,
    DEAD_BATTERY_SEED_RS: DEAD_BATTERY_SEED_RS,
    NATURES: NATURES,
    next: next,
    jump: jump,
    hi: hi,
    method1: method1,
    isShiny: isShiny,
    genderChar: genderChar,
    ivsFromWords: ivsFromWords,
    searchStarter: searchStarter,
    searchTid: searchTid,
    findByTid: findByTid,
    findByMon: findByMon,
    nearestAdvance: nearestAdvance,
    advancesToMs: advancesToMs,
    msToAdvances: msToAdvances,
    fmtMs: fmtMs,
    natureIndex: natureIndex,
    natureStatMods: natureStatMods,
    statsAtLevel: statsAtLevel,
    STARTERS_RS: STARTERS_RS
  };
});
