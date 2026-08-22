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

  function timerPhases(targetDelay, targetSecond, calibratedDelay, calibratedSecond) {
    var calibration = calibrationMs(calibratedDelay, calibratedSecond);
    var p2 = toMs(targetDelay) - calibration;
    var p1 = targetSecond * 1000.0 + calibration + 200.0 - toMs(targetDelay);
    while (p1 < 14000) p1 += 60000;
    return { phase1Ms: p1, phase2Ms: p2 };
  }

  function minutesBefore(targetDelay, targetSecond) {
    var p2 = toMs(targetDelay);
    var p1 = targetSecond * 1000.0 + 200.0 - toMs(targetDelay);
    while (p1 < 14000) p1 += 60000;
    return Math.floor((p1 + p2) / 60000.0);
  }

  function calibrate(calibratedDelay, targetDelay, hitDelay) {
    var delta = toMs(hitDelay) - toMs(targetDelay);
    if (Math.abs(delta) <= 167) delta *= 0.75;
    return calibratedDelay + toDelays(delta);
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
    calibrate: calibrate,
    searchShinyFromSeed: searchShinyFromSeed
  };
});
