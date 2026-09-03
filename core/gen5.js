/*
 * Shiny Solution - Gen 5 engine (Pokemon Black / White / Black 2 / White 2).
 *
 * Every algorithm and constant in this file is ported from PokeFinder by Admiral-Fish
 * (GPL-3.0, https://github.com/Admiral-Fish/PokeFinder, commit 7adce35):
 *   Core/RNG/SHA1.cpp            the SHA-1 message words and the digest -> seed step
 *   Core/RNG/LCRNG64.hpp         the 64-bit LCRNG (BWRNG) and its bounded output
 *   Core/Gen5/Nazos.cpp          the nazo words per game / language / DS type
 *   Core/Gen5/Keypresses.cpp     the keypress word and the valid button combinations
 *   Core/Util/Utilities.cpp      the probability table and the initial advances
 *   Core/Gen5/Generators/IDGenerator5.cpp   TID / SID rows
 *   Core/Gen5/Searchers/ProfileSearcher5.cpp  the profile (Timer0 / VCount) searcher
 *   Core/Gen5/Searchers/IDSearcher5.cpp       the seed-to-time iteration order
 * and cross-read against Admiral-Fish's RNGWriteups (Gen 5/Initial Seeding.md,
 * Gen 5/Initial Frame.md). Everything is EMPIRICAL: no Gen 5 decompilation exists.
 * Citations for each constant are in docs/FACTS.md ("Gen 5").
 *
 * Where PokeFinder reads IVs from a precomputed cache (Profile5 ivCache /
 * MTFast<8, true>), this port computes them directly from MT19937 (ivsFromSeed).
 * Needs BigInt (ES2020) for the 64-bit LCRNG.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./gen4.js"));
  else root.ShinyGen5 = factory(root.ShinyGen4);
})(typeof self !== "undefined" ? self : this, function (gen4) {
  "use strict";

  var MASK64 = (1n << 64n) - 1n;
  var MASK32 = 0xffffffffn;

  // LCRNG64.hpp:270 (BWRNG) and :271 (BWRNGR, the inverse step).
  var LCRNG64_MULT = 0x5d588b656c078965n;
  var LCRNG64_ADD = 0x269ec3n;
  var LCRNG64_REVERSE_MULT = 0xdedcedae9638806dn;
  var LCRNG64_REVERSE_ADD = 0x9b1ae6e9a384e6f9n;

  function u64(v) {
    if (typeof v === "bigint") return v & MASK64;
    if (typeof v === "number") {
      if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) throw new RangeError("u64: pass values above 2^53 as strings or BigInt");
      return BigInt(v);
    }
    if (typeof v === "string") return BigInt(v.trim()) & MASK64;
    throw new TypeError("u64: unsupported value " + v);
  }

  function hex64(v) {
    return "0x" + u64(v).toString(16).padStart(16, "0");
  }

  function dec64(v) {
    return u64(v).toString(10);
  }

  function next64(s) {
    return (u64(s) * LCRNG64_MULT + LCRNG64_ADD) & MASK64;
  }

  function prev64(s) {
    return (u64(s) * LCRNG64_REVERSE_MULT + LCRNG64_REVERSE_ADD) & MASK64;
  }

  function jumpWith(s, n, a, c) {
    var r = u64(s);
    var k = BigInt(n);
    if (k < 0n) throw new RangeError("jump64: negative count");
    while (k > 0n) {
      if (k & 1n) r = (a * r + c) & MASK64;
      c = (a * c + c) & MASK64;
      a = (a * a) & MASK64;
      k >>= 1n;
    }
    return r;
  }

  function jump64(s, n) {
    return jumpWith(s, n, LCRNG64_MULT, LCRNG64_ADD);
  }

  function jumpReverse64(s, n) {
    return jumpWith(s, n, LCRNG64_REVERSE_MULT, LCRNG64_REVERSE_ADD);
  }

  // LCRNG64.hpp:248-251 nextUInt(): the high 32 bits of the state after a step.
  function high32(s) {
    return Number(u64(s) >> 32n);
  }

  function high16(s) {
    return Number(u64(s) >> 48n);
  }

  // LCRNG64.hpp:261-264 nextUInt(max): ((state >> 32) * max) >> 32.
  function bounded(s, max) {
    return Number(((u64(s) >> 32n) * BigInt(max >>> 0)) >> 32n);
  }

  // A BWRNG stream with an advance counter, mirroring PokeFinder's LCRNG64 usage.
  function Rng(seed, advances) {
    this.state = jump64(seed, advances || 0);
    this.count = 0;
  }

  Rng.prototype.next = function () {
    this.state = next64(this.state);
    this.count++;
    return this.state;
  };

  Rng.prototype.nextUInt = function (max) {
    this.next();
    return max === undefined ? high32(this.state) : bounded(this.state, max);
  };

  Rng.prototype.advance = function (n) {
    for (var i = 0; i < n; i++) this.next();
    return this.state;
  };

  var GAMES = ["black", "white", "black2", "white2"];
  var LANGUAGES = ["english", "french", "german", "italian", "japanese", "korean", "spanish"];
  var DS_TYPES = ["ds", "dsi", "3ds"];

  function normKey(v) {
    return String(v).toLowerCase().replace(/[\s_\-]/g, "");
  }

  function normGame(g) {
    var k = normKey(g);
    if (GAMES.indexOf(k) < 0) throw new RangeError("gen5: unknown game " + g);
    return k;
  }

  function normLanguage(l) {
    var k = normKey(l);
    if (LANGUAGES.indexOf(k) < 0) throw new RangeError("gen5: unknown language " + l);
    return k;
  }

  function normDsType(t) {
    var k = normKey(t);
    if (k === "ds" || k === "dslite" || k === "dsphat" || k === "lite" || k === "phat") return "ds";
    if (k === "dsi") return "dsi";
    if (k === "3ds" || k === "ds3") return "3ds";
    throw new RangeError("gen5: unknown DS type " + t);
  }

  function isBW(game) {
    var g = normGame(game);
    return g === "black" || g === "white";
  }

  // Nazos.cpp:56-117, verbatim. One base address for BW (computeNazoBW, :27-38);
  // [nazo, nazo0, nazo1] for BW2 (computeNazoBW2, :40-52). DSi and 3DS share the DSi row
  // (:128-134 and the same pattern per language). The Korean Black 2 DSi base equals the
  // Korean White 2 DS base in PokeFinder's table; ported as found.
  var NAZO_BASE = {
    english: {
      black: [0x022160b0], white: [0x022160d0], blackDsi: [0x02760190], whiteDsi: [0x027601b0],
      black2: [0x02200010, 0x0209aee8, 0x02039de9], white2: [0x02200050, 0x0209af28, 0x02039e15],
      black2Dsi: [0x027a5f70, 0x0209aee8, 0x02039de9], white2Dsi: [0x027a5e90, 0x0209af28, 0x02039e15]
    },
    japanese: {
      black: [0x02215f10], white: [0x02215f30], blackDsi: [0x02761150], whiteDsi: [0x02761150],
      black2: [0x021ff9b0, 0x0209a8dc, 0x02039ac9], white2: [0x021ff9d0, 0x0209a8fc, 0x02039af5],
      black2Dsi: [0x027aa730, 0x0209a8dc, 0x02039ac9], white2Dsi: [0x027aa5f0, 0x0209a8fc, 0x02039af5]
    },
    german: {
      black: [0x02215ff0], white: [0x02216010], blackDsi: [0x027602f0], whiteDsi: [0x027602f0],
      black2: [0x021fff50, 0x0209ae28, 0x02039d69], white2: [0x021fff70, 0x0209ae48, 0x02039d95],
      black2Dsi: [0x027a6110, 0x0209ae28, 0x02039d69], white2Dsi: [0x027a6010, 0x0209ae48, 0x02039d95]
    },
    spanish: {
      black: [0x02216070], white: [0x02216070], blackDsi: [0x027601f0], whiteDsi: [0x027601f0],
      black2: [0x021fffd0, 0x0209aea8, 0x02039db9], white2: [0x021ffff0, 0x0209aec8, 0x02039de5],
      black2Dsi: [0x027a6070, 0x0209aea8, 0x02039db9], white2Dsi: [0x027a5fb0, 0x0209aec8, 0x02039de5]
    },
    french: {
      black: [0x02216030], white: [0x02216050], blackDsi: [0x02760230], whiteDsi: [0x02760250],
      black2: [0x02200030, 0x0209af08, 0x02039df9], white2: [0x02200050, 0x0209af28, 0x02039e25],
      black2Dsi: [0x027a5f90, 0x0209af08, 0x02039df9], white2Dsi: [0x027a5ef0, 0x0209af28, 0x02039e25]
    },
    italian: {
      black: [0x02215fb0], white: [0x02215fd0], blackDsi: [0x027601d0], whiteDsi: [0x027601d0],
      black2: [0x021fff10, 0x0209ade8, 0x02039d69], white2: [0x021fff50, 0x0209ae28, 0x02039d95],
      black2Dsi: [0x027a5f70, 0x0209ade8, 0x02039d69], white2Dsi: [0x027a5ed0, 0x0209ae28, 0x02039d95]
    },
    korean: {
      black: [0x022167b0], white: [0x022167b0], blackDsi: [0x02761150], whiteDsi: [0x02761150],
      black2: [0x02200750, 0x0209b60c, 0x0203a4d5], white2: [0x02200770, 0x0209b62c, 0x0203a501],
      black2Dsi: [0x02200770, 0x0209b60c, 0x0203a4d5], white2Dsi: [0x027a57b0, 0x0209b62c, 0x0203a501]
    }
  };

  function bswap32(v) {
    v >>>= 0;
    return (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0;
  }

  function nazo(game, language, dsType) {
    var g = normGame(game);
    var l = normLanguage(language);
    var t = normDsType(dsType);
    var base = NAZO_BASE[l][g + (t === "ds" ? "" : "Dsi")];
    var n = base[0];
    if (base.length === 1) {
      // Nazos.cpp:29-36: offsets 0xfc and 0xfc + 0x4c, each used twice.
      var o1 = (n + 0xfc) >>> 0;
      var o2 = (n + 0xfc + 0x4c) >>> 0;
      return [bswap32(n), bswap32(o1), bswap32(o1), bswap32(o2), bswap32(o2)];
    }
    // Nazos.cpp:43-50: nazo0, nazo1, nazo, then nazo + 0x54 twice.
    var o = (n + 0x54) >>> 0;
    return [bswap32(base[1]), bswap32(base[2]), bswap32(n), bswap32(o), bswap32(o)];
  }

  // Buttons.hpp:28-48 bit order; Keypresses.cpp:103-115 subtraction table and 0xff2f0000 base.
  var BUTTONS = {
    R: 1 << 0, L: 1 << 1, X: 1 << 2, Y: 1 << 3, A: 1 << 4, B: 1 << 5,
    SELECT: 1 << 6, START: 1 << 7, RIGHT: 1 << 8, LEFT: 1 << 9, UP: 1 << 10, DOWN: 1 << 11
  };
  var BUTTON_NAMES = ["R", "L", "X", "Y", "A", "B", "Select", "Start", "Right", "Left", "Up", "Down"];
  var KEYPRESS_VALUES = [
    0x10000, 0x20000, 0x40000, 0x80000, 0x1000000, 0x2000000,
    0x4000000, 0x8000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000
  ];
  var KEYPRESS_BASE = 0xff2f0000;

  function keypressValue(mask) {
    var value = KEYPRESS_BASE;
    for (var i = 0; i < 12; i++) {
      if (mask & (1 << i)) value -= KEYPRESS_VALUES[i];
    }
    return value >>> 0;
  }

  function popcount(v) {
    var c = 0;
    for (v >>>= 0; v; v >>>= 1) c += v & 1;
    return c;
  }

  // Keypresses.cpp:35-56: no L+R when skipLR, never Up+Down, never Left+Right, never the
  // soft-reset chord L+R+Select+Start.
  function keypressValid(mask, skipLR) {
    if (skipLR && (mask & (BUTTONS.L | BUTTONS.R)) !== 0) return false;
    var ud = BUTTONS.UP | BUTTONS.DOWN;
    if ((mask & ud) === ud) return false;
    var lr = BUTTONS.LEFT | BUTTONS.RIGHT;
    if ((mask & lr) === lr) return false;
    var soft = BUTTONS.L | BUTTONS.R | BUTTONS.SELECT | BUTTONS.START;
    if ((mask & soft) === soft) return false;
    return true;
  }

  // Keypresses.cpp:83-98: enabledCounts[k] says whether combinations of exactly k held
  // buttons (0..8) are searched; PokeFinder's profile default is [true, false x 8].
  function keypressCombos(enabledCounts, skipLR) {
    var counts = enabledCounts || [true, false, false, false, false, false, false, false, false];
    var out = [];
    for (var bits = 0; bits < 0x1000; bits++) {
      var c = popcount(bits);
      if (c <= 8 && counts[c] && keypressValid(bits, !!skipLR)) out.push({ buttons: bits, value: keypressValue(bits) });
    }
    return out;
  }

  function buttonNames(mask) {
    var names = [];
    for (var i = 0; i < 12; i++) if (mask & (1 << i)) names.push(BUTTON_NAMES[i]);
    return names.length ? names.join("+") : "None";
  }

  function parseButtons(text) {
    var mask = 0;
    var parts = String(text || "").split(/[+,\s]+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || p.toLowerCase() === "none") continue;
      var idx = BUTTON_NAMES.map(function (n) { return n.toLowerCase(); }).indexOf(p.toLowerCase());
      if (idx < 0) throw new RangeError("gen5: unknown button " + p);
      mask |= 1 << idx;
    }
    return mask;
  }

  // SHA1.cpp:50-53 computeBCD.
  function bcd(v) {
    return ((Math.floor(v / 10) << 4) + (v % 10)) >>> 0;
  }

  // DateTime.cpp:66-72 (Julian day number) and :88-91 (weekday = (jd + 1) % 7, Sunday = 0);
  // SHA1.cpp:55-62 repeats the same formula for the date table.
  function julianDay(year, month, day) {
    var a = month < 3 ? 1 : 0;
    var y = year + 4800 - a;
    var m = month + 12 * a - 3;
    return day + Math.floor((153 * m + 2) / 5) - 32045 + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
  }

  // DateTime.cpp:98-113 getParts (inverse of julianDay).
  function dateFromJulianDay(jd) {
    var a = jd + 32044;
    var b = Math.floor((4 * a + 3) / 146097);
    var c = a - Math.floor((146097 * b) / 4);
    var d = Math.floor((4 * c + 3) / 1461);
    var e = c - Math.floor((1461 * d) / 4);
    var m = Math.floor((5 * e + 2) / 153);
    return {
      year: 100 * b + d - 4800 + Math.floor(m / 10),
      month: m + 3 - 12 * Math.floor(m / 10),
      day: e - Math.floor((153 * m + 2) / 5) + 1
    };
  }

  function dayOfWeek(year, month, day) {
    return (julianDay(year, month, day) + 1) % 7;
  }

  // SHA1.cpp:64-93: BCD(year % 100) << 24 | BCD(month) << 16 | BCD(day) << 8 | weekday.
  function dateWord(year, month, day) {
    return ((bcd(year % 100) << 24) | (bcd(month) << 16) | (bcd(day) << 8) | dayOfWeek(year, month, day)) >>> 0;
  }

  // SHA1.cpp:95-120 and :356-363: BCD(hour) << 24 | BCD(minute) << 16 | BCD(second) << 8,
  // plus 0x40000000 for hour >= 12 on a DS / DSi; the 3DS never sets the PM bit.
  function timeWord(hour, minute, second, dsType) {
    var w = ((bcd(hour) << 24) | (bcd(minute) << 16) | (bcd(second) << 8)) >>> 0;
    if (hour >= 12 && normDsType(dsType) !== "3ds") w = (w | 0x40000000) >>> 0;
    return w;
  }

  // The 16-word SHA-1 block (SHA1.cpp:178-192, :336-363; RNGWriteups Initial Seeding.md
  // "Overall"). p: game, language, dsType, mac (48-bit; number, string or BigInt), vframe,
  // gxstat, timer0, vcount, year, month, day, hour, minute, second, and either keypress (the
  // u32 word) or buttons (a BUTTONS mask). softReset (writeup only; not in PokeFinder) XORs
  // 0x01000000 into word 6.
  function message(p) {
    var w = nazo(p.game, p.language, p.dsType);
    var mac = u64(p.mac);
    w[5] = bswap32((((p.vcount & 0xff) << 16) | (p.timer0 >>> 0)) >>> 0);
    w[6] = (Number(mac & 0xffffn) ^ (p.softReset ? 0x01000000 : 0)) >>> 0;
    w[7] = (Number((mac >> 16n) & MASK32) ^ ((p.vframe & 0xff) << 24) ^ (p.gxstat & 0xff)) >>> 0;
    w[8] = dateWord(p.year, p.month, p.day);
    w[9] = timeWord(p.hour, p.minute, p.second, p.dsType);
    w[10] = 0;
    w[11] = 0;
    w[12] = p.keypress !== undefined && p.keypress !== null ? p.keypress >>> 0 : keypressValue(p.buttons || 0);
    w[13] = 0x80000000;
    w[14] = 0;
    w[15] = 0x1a0;
    return w;
  }

  function rotl(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  // One SHA-1 compression of a single 16-word block (SHA1.cpp:122-168 round functions and
  // constants, :304-311 initial state). Returns [h0, h1, h2, h3, h4].
  function sha1(words) {
    var w = new Array(80);
    var i;
    for (i = 0; i < 16; i++) w[i] = words[i] >>> 0;
    for (i = 16; i < 80; i++) w[i] = rotl((w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) >>> 0, 1);
    var a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, e = 0xc3d2e1f0;
    for (i = 0; i < 80; i++) {
      var f, k;
      if (i < 20) { f = ((b & c) | (~b & d)) >>> 0; k = 0x5a827999; }
      else if (i < 40) { f = (b ^ c ^ d) >>> 0; k = 0x6ed9eba1; }
      else if (i < 60) { f = ((b & c) | (b & d) | (c & d)) >>> 0; k = 0x8f1bbcdc; }
      else { f = (b ^ c ^ d) >>> 0; k = 0xca62c1d6; }
      var t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    return [(0x67452301 + a) >>> 0, (0xefcdab89 + b) >>> 0, (0x98badcfe + c) >>> 0, (0x10325476 + d) >>> 0, (0xc3d2e1f0 + e) >>> 0];
  }

  // SHA1.cpp:298-301: the 64-bit value byteswap(h1) << 32 | byteswap(h0).
  function sha1Seed(words) {
    var h = sha1(words);
    return (BigInt(bswap32(h[1])) << 32n) | BigInt(bswap32(h[0]));
  }

  // SHA1.cpp:302: the initial seed the game runs from is that value stepped once.
  function initialSeed(p) {
    return next64(sha1Seed(message(p)));
  }

  // Utilities.cpp:29-70. Returns the number of LCRNG steps consumed by one pass.
  function advanceProbabilityTable(rng) {
    var start = rng.count;
    rng.next();
    if (rng.nextUInt(101) > 50) rng.next();
    if (rng.nextUInt(101) > 30) rng.next();
    if (rng.nextUInt(101) > 25) {
      if (rng.nextUInt(101) > 30) rng.next();
    }
    if (rng.nextUInt(101) > 20) {
      if (rng.nextUInt(101) > 25) {
        if (rng.nextUInt(101) > 33) rng.next();
      }
    }
    return rng.count - start;
  }

  // Utilities.cpp:283-294: five passes.
  function initialAdvancesBW(seed) {
    var rng = new Rng(seed);
    var count = 0;
    for (var i = 0; i < 5; i++) count += advanceProbabilityTable(rng);
    return count;
  }

  // Utilities.cpp:296-328: five passes, 2 (memory link) or 3 extra steps after the first,
  // then up to 100 triples of nextUInt(15) until all three differ.
  function initialAdvancesBW2(seed, memoryLink) {
    var rng = new Rng(seed);
    var count = 0;
    for (var i = 0; i < 5; i++) {
      count += advanceProbabilityTable(rng);
      if (i === 0) {
        var k = memoryLink ? 2 : 3;
        count += k;
        rng.advance(k);
      }
    }
    for (var limit = 0; limit < 100; limit++) {
      count += 3;
      var r1 = rng.nextUInt(15);
      var r2 = rng.nextUInt(15);
      var r3 = rng.nextUInt(15);
      if (r1 !== r2 && r1 !== r3 && r2 !== r3) break;
    }
    return count;
  }

  // Utilities.cpp:330-343: a fixed 2 plus three passes.
  function initialAdvancesBWID(seed) {
    var rng = new Rng(seed);
    var count = 2;
    for (var i = 0; i < 3; i++) count += advanceProbabilityTable(rng);
    return count;
  }

  // Utilities.cpp:345-372: a fixed 10 plus three passes, with 2 uncounted steps after the
  // first pass and 4 after the second (the fixed 10 already includes them).
  function initialAdvancesBW2ID(seed) {
    var rng = new Rng(seed);
    var count = 10;
    for (var i = 0; i < 3; i++) {
      count += advanceProbabilityTable(rng);
      if (i === 0) rng.advance(2);
      else if (i === 1) rng.advance(4);
    }
    return count;
  }

  // Utilities.cpp:374-384.
  function initialAdvancesID(seed, game) {
    return isBW(game) ? initialAdvancesBWID(seed) : initialAdvancesBW2ID(seed);
  }

  // Utilities.cpp:271-281.
  function initialAdvances(seed, game, memoryLink) {
    return isBW(game) ? initialAdvancesBW(seed) : initialAdvancesBW2(seed, !!memoryLink);
  }

  // IDGenerator5.cpp:34-58 without the filter: rows at initialAdvancesID + extra + cnt.
  // rand = nextUInt(0xffffffff); TID = low 16, SID = high 16, TSV = (TID ^ SID) >> 3.
  function idRows(seed, game, extraAdvances, maxAdvances) {
    var s = u64(seed);
    var base = initialAdvancesID(s, game);
    var extra = extraAdvances || 0;
    var rng = new Rng(s, base + extra);
    var rows = [];
    for (var cnt = 0; cnt <= maxAdvances; cnt++) {
      var rand = rng.nextUInt(0xffffffff);
      var tid = rand & 0xffff;
      var sid = rand >>> 16;
      rows.push({ advances: base + extra + cnt, tid: tid, sid: sid, tsv: (tid ^ sid) >>> 3 });
    }
    return rows;
  }

  // The ID the game writes for a seed. noCount is the row offset from the base index; the
  // design doc maps it to the number of "No" answers given to Juniper (EMPIRICAL claim from
  // community guides; PokeFinder exposes the offset only as a table row).
  function tidSid(seed, game, noCount) {
    return idRows(seed, game, noCount || 0, 0)[0];
  }

  // ProfileSearcher5.cpp:171,177-186 with MTFast.hpp: MT19937 seeded with the high 32 bits
  // of the seed, skip 2 outputs on BW2 (0 on BW), then six outputs >> 27, in the order
  // HP, Atk, Def, SpA, SpD, Spe (StaticGenerator5.cpp:29-31,67-88 gen() and the non-roamer
  // order). PokeFinder serves these from a precomputed IV cache; this computes them.
  function ivsFromSeed(seed, game) {
    var mt = new gen4.Mt19937(high32(seed));
    var skip = isBW(game) ? 0 : 2;
    for (var i = 0; i < skip; i++) mt.next();
    var ivs = [];
    for (var j = 0; j < 6; j++) ivs.push(mt.next() >>> 27);
    return ivs;
  }

  // ProfileSearcher5.cpp:205-229: the save-screen / Unova Link needles, nextUInt(8) each,
  // with one extra step per needle over Unova Link and one extra advance when Unova Link is
  // used without memory link.
  function needlesFromSeed(seed, game, count, unovaLink, memoryLink) {
    var advances = initialAdvances(seed, game, memoryLink);
    if (unovaLink && !memoryLink) advances++;
    var rng = new Rng(seed, advances);
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push(rng.nextUInt(8));
      if (unovaLink) rng.next();
    }
    return out;
  }

  // ProfileSearcher5.cpp:121-160 (single thread): VFrame -> GxStat -> Timer0 -> VCount ->
  // second, every seed through valid(). p: game, language, dsType, mac, buttons (mask),
  // year, month, day, hour, minute, minSecond, maxSecond, minVCount, maxVCount, minTimer0,
  // maxTimer0, minGxStat, maxGxStat, minVFrame, maxVFrame, softReset.
  function profileSearch(p, valid) {
    var results = [];
    var keypress = keypressValue(p.buttons || 0);
    for (var vframe = p.minVFrame; vframe <= p.maxVFrame; vframe++) {
      for (var gxstat = p.minGxStat; gxstat <= p.maxGxStat; gxstat++) {
        for (var timer0 = p.minTimer0; timer0 <= p.maxTimer0; timer0++) {
          for (var vcount = p.minVCount; vcount <= p.maxVCount; vcount++) {
            for (var second = p.minSecond; second <= p.maxSecond; second++) {
              var seed = initialSeed({
                game: p.game, language: p.language, dsType: p.dsType, mac: p.mac,
                vframe: vframe, gxstat: gxstat, timer0: timer0, vcount: vcount,
                year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: second,
                keypress: keypress, softReset: !!p.softReset
              });
              if (valid(seed)) results.push({ seed: seed, timer0: timer0, vcount: vcount, vframe: vframe, gxstat: gxstat, second: second });
            }
          }
        }
      }
    }
    return results;
  }

  // ProfileIVSearcher5 (:163-187): minIvs / maxIvs in HP, Atk, Def, SpA, SpD, Spe order.
  function profileSearchIvs(p, minIvs, maxIvs) {
    return profileSearch(p, function (seed) {
      var ivs = ivsFromSeed(seed, p.game);
      for (var i = 0; i < 6; i++) if (ivs[i] < minIvs[i] || ivs[i] > maxIvs[i]) return false;
      return true;
    });
  }

  // ProfileNeedleSearcher5 (:189-229).
  function profileSearchNeedles(p, needles, unovaLink, memoryLink) {
    return profileSearch(p, function (seed) {
      var got = needlesFromSeed(seed, p.game, needles.length, !!unovaLink, !!memoryLink);
      for (var i = 0; i < needles.length; i++) if (got[i] !== needles[i]) return false;
      return true;
    });
  }

  // ProfileSeedSearcher5 (:231-244).
  function profileSearchSeed(p, target) {
    var want = u64(target);
    return profileSearch(p, function (seed) { return seed === want; });
  }

  // IDSearcher5.cpp:63-90: Timer0 -> keypress combination -> second, every seed through the
  // ID generator, keeping rows whose TID (and SID when given) match. profile: game, language,
  // dsType, mac, vframe, gxstat, vcount, timer0Min, timer0Max, keypresses (9 booleans),
  // skipLR, softReset. Returns the hits in iteration order; limit caps the count.
  function searchTid(profile, year, month, day, hour, minute, minSecond, maxSecond, targetTid, targetSid, maxAdvances, limit) {
    var combos = keypressCombos(profile.keypresses, profile.skipLR);
    var hits = [];
    var max = maxAdvances === undefined ? 0 : maxAdvances;
    for (var timer0 = profile.timer0Min; timer0 <= profile.timer0Max; timer0++) {
      for (var k = 0; k < combos.length; k++) {
        for (var second = minSecond; second <= maxSecond; second++) {
          var seed = initialSeed({
            game: profile.game, language: profile.language, dsType: profile.dsType, mac: profile.mac,
            vframe: profile.vframe, gxstat: profile.gxstat, timer0: timer0, vcount: profile.vcount,
            year: year, month: month, day: day, hour: hour, minute: minute, second: second,
            keypress: combos[k].value, softReset: !!profile.softReset
          });
          var rows = idRows(seed, profile.game, 0, max);
          for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (targetTid !== undefined && targetTid !== null && row.tid !== targetTid) continue;
            if (targetSid !== undefined && targetSid !== null && row.sid !== targetSid) continue;
            hits.push({
              year: year, month: month, day: day, hour: hour, minute: minute, second: second,
              seed: seed, buttons: combos[k].buttons, keypress: combos[k].value, timer0: timer0,
              advances: row.advances, noCount: r, tid: row.tid, sid: row.sid, tsv: row.tsv
            });
            if (limit && hits.length >= limit) return hits;
          }
        }
      }
    }
    return hits;
  }

  // Convenience over searchTid for a run of days at one clock time (Shiny Solution's own
  // wrapper, not a PokeFinder port).
  function searchTidDates(profile, startJd, endJd, hour, minute, minSecond, maxSecond, targetTid, targetSid, maxAdvances, limit) {
    var hits = [];
    for (var jd = startJd; jd <= endJd; jd++) {
      var d = dateFromJulianDay(jd);
      var part = searchTid(profile, d.year, d.month, d.day, hour, minute, minSecond, maxSecond, targetTid, targetSid, maxAdvances, limit ? limit - hits.length : undefined);
      for (var i = 0; i < part.length; i++) hits.push(part[i]);
      if (limit && hits.length >= limit) break;
    }
    return hits;
  }

  return {
    MASK64: MASK64,
    LCRNG64_MULT: LCRNG64_MULT,
    LCRNG64_ADD: LCRNG64_ADD,
    LCRNG64_REVERSE_MULT: LCRNG64_REVERSE_MULT,
    LCRNG64_REVERSE_ADD: LCRNG64_REVERSE_ADD,
    GAMES: GAMES,
    LANGUAGES: LANGUAGES,
    DS_TYPES: DS_TYPES,
    BUTTONS: BUTTONS,
    BUTTON_NAMES: BUTTON_NAMES,
    KEYPRESS_BASE: KEYPRESS_BASE,
    KEYPRESS_VALUES: KEYPRESS_VALUES,
    u64: u64,
    hex64: hex64,
    dec64: dec64,
    next64: next64,
    prev64: prev64,
    jump64: jump64,
    jumpReverse64: jumpReverse64,
    high32: high32,
    high16: high16,
    bounded: bounded,
    Rng: Rng,
    normGame: normGame,
    normLanguage: normLanguage,
    normDsType: normDsType,
    isBW: isBW,
    bswap32: bswap32,
    nazo: nazo,
    keypressValue: keypressValue,
    keypressValid: keypressValid,
    keypressCombos: keypressCombos,
    buttonNames: buttonNames,
    parseButtons: parseButtons,
    bcd: bcd,
    julianDay: julianDay,
    dateFromJulianDay: dateFromJulianDay,
    dayOfWeek: dayOfWeek,
    dateWord: dateWord,
    timeWord: timeWord,
    message: message,
    sha1: sha1,
    sha1Seed: sha1Seed,
    initialSeed: initialSeed,
    advanceProbabilityTable: advanceProbabilityTable,
    initialAdvancesBW: initialAdvancesBW,
    initialAdvancesBW2: initialAdvancesBW2,
    initialAdvancesBWID: initialAdvancesBWID,
    initialAdvancesBW2ID: initialAdvancesBW2ID,
    initialAdvancesID: initialAdvancesID,
    initialAdvances: initialAdvances,
    idRows: idRows,
    tidSid: tidSid,
    ivsFromSeed: ivsFromSeed,
    needlesFromSeed: needlesFromSeed,
    profileSearch: profileSearch,
    profileSearchIvs: profileSearchIvs,
    profileSearchNeedles: profileSearchNeedles,
    profileSearchSeed: profileSearchSeed,
    searchTid: searchTid,
    searchTidDates: searchTidDates
  };
});
