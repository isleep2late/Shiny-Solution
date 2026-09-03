// Gen 3 / Gen 4 encounter generators, derived values, filters, rarity and reachability.
//
// Every RNG call below follows the pret decompilations (see docs/FACTS.md, "Generators").
// Frame convention (PokeFinder's): frame N means the generator starts from jump(seed, N), so
// the first value it consumes is the (N+1)-th LCRNG output after the seed.
//
// Pure functions only: no data files are read here. Species records are the objects of
// core/data/species-gen{3,4}.json (dex, gender_ratio, ability_ids, type_ids, base_stats);
// encounter slots are {species: <record>, minLevel, maxLevel, form}.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rng.js"), require("./gen4.js"));
  } else {
    root.ShinyGenerators = factory(root.ShinyCore, root.ShinyGen4);
  }
})(typeof self !== "undefined" ? self : this, function (core, gen4) {
  "use strict";

  var MULT = 0x41c64e6d;
  var ADD = 0x6073;
  var RMULT = 0xeeb9eb65; // inverse multiplier (PokeFinder PokeRNGR, PKHeX LCRNG.rMult)
  var RADD = 0x0a3561a1;
  var ARNG_MULT = 0x6c078965; // MT19937_F, pokeplatinum/src/math_util.c:104-107
  var TYPE_STEEL = 8;
  var TYPE_ELECTRIC = 13;
  var HIDDEN_POWER_TYPES = [
    "FIGHTING", "FLYING", "POISON", "GROUND", "ROCK", "BUG", "GHOST", "STEEL",
    "FIRE", "WATER", "GRASS", "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK"
  ];
  var IV_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"]; // PokeFinder array order
  // decomp stat ids 0..5 = HP, ATK, DEF, SPEED, SPATK, SPDEF -> position in IV_ORDER
  var STAT_ID_TO_KEY = ["hp", "atk", "def", "spe", "spa", "spd"];

  function u32(x) { return x >>> 0; }
  function next(s) { return core.next(s); }
  function prev(s) { return u32(Math.imul(s >>> 0, RMULT) + RADD); }
  function arngNext(s) { return u32(Math.imul(s >>> 0, ARNG_MULT) + 1); }

  // ---------------------------------------------------------------- RNG stream
  function Stream(state) {
    this.s = state >>> 0;
    this.calls = 0;
  }
  Stream.prototype.next = function () {
    this.s = core.next(this.s);
    this.calls++;
    return this.s >>> 16;
  };
  // Random() % n (Gen 3), LCRandRange / LCRandom() % n (HGSS), LCRNG_Next() % n (DPPt)
  Stream.prototype.mod = function (n) { return this.next() % n; };
  // LCRNG_RandMod (DPPt): rand / ((0xffff / n) + 1)   pokeplatinum/include/inlines.h:156-169
  Stream.prototype.div = function (n) { return Math.floor(this.next() / (Math.floor(0xffff / n) + 1)); };
  Stream.prototype.skip = function (k) { for (var i = 0; i < k; i++) this.next(); };
  Stream.prototype.clone = function () { return new Stream(this.s); }; // call count restarts per frame

  function makeJumpTable() {
    var t = [{ mult: u32(MULT), add: u32(ADD) }];
    for (var i = 1; i < 32; i++) {
      var p = t[i - 1];
      t.push({ mult: u32(Math.imul(p.mult, p.mult)), add: u32(Math.imul(p.add, u32(p.mult + 1))) });
    }
    return t;
  }
  var JUMP_TABLE = makeJumpTable();

  // Number of LCRNG steps from state `from` to state `to` (0 .. 2^32-1). The low k bits of a
  // full-period power-of-two LCG repeat with period 2^k, so bit i of the distance is fixed by
  // whether bit i still differs after the lower bits have been matched (PokeFinder
  // Core/RNG/LCRNG.hpp:51-64, EMPIRICAL port; the period property is standard LCG theory).
  function lcrngDistance(from, to) {
    var start = from >>> 0;
    var end = to >>> 0;
    var count = 0;
    for (var i = 0; i < 32 && start !== end; i++) {
      var bit = i === 31 ? 0x80000000 : (1 << i);
      if (((start ^ end) & bit) !== 0) {
        start = u32(Math.imul(JUMP_TABLE[i].mult, start) + JUMP_TABLE[i].add);
        count += Math.pow(2, i);
      }
    }
    return count;
  }

  // ---------------------------------------------------------------- derived values
  function ivsFromWords(w1, w2) {
    return {
      hp: w1 & 31, atk: (w1 >> 5) & 31, def: (w1 >> 10) & 31,
      spe: w2 & 31, spa: (w2 >> 5) & 31, spd: (w2 >> 10) & 31
    };
  }
  function ivArray(ivs) { return IV_ORDER.map(function (k) { return ivs[k]; }); }

  // pokeemerald/src/pokemon.c:3471-3485 ; pokeplatinum/src/pokemon.c (BoxPokemon_GetGender); 0=M 1=F 2=none
  function genderOf(pid, ratio) {
    if (ratio === 255) return 2;
    if (ratio === 254) return 1;
    if (ratio === 0) return 0;
    return (pid & 0xff) < ratio ? 1 : 0;
  }
  function genderFixed(ratio) { return ratio === 0 || ratio === 254 || ratio === 255; }

  // pokeemerald/src/battle_script_commands.c:8889-8912 ; pokeplatinum/src/battle/battle_script.c:6007-6031
  function hiddenPower(ivs) {
    var order = ["hp", "atk", "def", "spe", "spa", "spd"];
    var typeBits = 0, powerBits = 0;
    for (var i = 0; i < 6; i++) {
      typeBits |= (ivs[order[i]] & 1) << i;
      powerBits |= ((ivs[order[i]] >> 1) & 1) << i;
    }
    var index = Math.floor(typeBits * 15 / 63); // 0..15, PokeFinder index
    var typeId = index + 1; // decomp type id; TYPE_MYSTERY (9) is skipped
    if (typeId >= 9) typeId++;
    return { index: index, typeId: typeId, type: HIDDEN_POWER_TYPES[index], power: Math.floor(powerBits * 40 / 63) + 30 };
  }

  function shinyType(pid, tid, sid) {
    var psv = ((pid >>> 16) ^ (pid & 0xffff)) & 0xffff;
    var tsv = (tid ^ sid) & 0xffff;
    if (psv === tsv) return 2;
    return ((psv ^ tsv) & 0xffff) < 8 ? 1 : 0;
  }

  function unownLetter(pid) {
    // pokeemerald/include/pokemon.h:364-369 ; pokefirered/src/wild_encounter.c:243-251
    return (((pid & 0x03000000) >>> 18) | ((pid & 0x00030000) >>> 12) | ((pid & 0x00000300) >>> 6) | (pid & 0x3)) % 28;
  }

  function abilityInfo(species, pid) {
    var ids = species.ability_ids || [0, 0];
    var bit = pid & 1;
    // pokeemerald/src/pokemon.c:2298-2302 ; pokeplatinum/src/pokemon.c:472-483: the second slot is
    // used only when the species has a second ability.
    var slot = ids[1] ? bit : 0;
    return { abilityBit: bit, abilitySlot: slot, abilityId: ids[slot] || ids[0] || 0 };
  }

  function buildResult(frame, pid, ivs, level, species, tid, sid, extra) {
    pid = pid >>> 0;
    var hp = hiddenPower(ivs);
    var ab = abilityInfo(species, pid);
    var stats = core.statsAtLevel(species.base_stats, ivs, level, pid % 25);
    var r = {
      frame: frame,
      pid: pid,
      nature: pid % 25,
      natureName: core.NATURES[pid % 25],
      ivs: ivs,
      ivArray: ivArray(ivs),
      level: level,
      gender: genderOf(pid, species.gender_ratio),
      abilityBit: ab.abilityBit,
      abilitySlot: ab.abilitySlot,
      abilityId: ab.abilityId,
      shiny: core.isShiny(pid, tid, sid),
      shinyType: shinyType(pid, tid, sid),
      psv: ((pid >>> 16) ^ (pid & 0xffff)) & 0xffff,
      tsv: (tid ^ sid) & 0xffff,
      hiddenPower: hp.index,
      hiddenPowerType: hp.type,
      hiddenPowerTypeId: hp.typeId,
      hiddenPowerPower: hp.power,
      stats: [stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.spe],
      species: species.dex,
      valid: true
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
    return r;
  }

  // ---------------------------------------------------------------- filters
  function toIvObject(v, dflt) {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) {
      var o = {};
      for (var i = 0; i < 6; i++) o[IV_ORDER[i]] = v[i] === undefined || v[i] === null ? dflt : v[i];
      return o;
    }
    return v;
  }

  function monMatches(r, f) {
    if (!f) return true;
    if (f.validOnly && r.valid === false) return false;
    if (f.natures && f.natures.length && f.natures.indexOf(r.nature) < 0) return false;
    if (f.gender) {
      var g = f.gender === "F" ? 1 : f.gender === "M" ? 0 : f.gender;
      if (r.gender !== g) return false;
    }
    if (f.ability !== null && f.ability !== undefined && r.abilityBit !== f.ability) return false;
    if (f.shiny === true && !r.shiny) return false;
    if (f.shiny === false && r.shiny) return false;
    if (f.hpTypes && f.hpTypes.length && f.hpTypes.indexOf(r.hiddenPower) < 0) return false;
    if (f.hpPowerMin && r.hiddenPowerPower < f.hpPowerMin) return false;
    if (f.minIv) for (var i = 0; i < 6; i++) if (r.ivs[IV_ORDER[i]] < f.minIv) return false;
    var mn = toIvObject(f.ivMin, 0), mx = toIvObject(f.ivMax, 31);
    for (var j = 0; j < 6; j++) {
      var k = IV_ORDER[j];
      if (mn && mn[k] !== undefined && mn[k] !== null && r.ivs[k] < mn[k]) return false;
      if (mx && mx[k] !== undefined && mx[k] !== null && r.ivs[k] > mx[k]) return false;
    }
    if (f.levelMin && r.level < f.levelMin) return false;
    if (f.levelMax && r.level > f.levelMax) return false;
    if (f.slots && f.slots.length && r.encounterSlot !== undefined && f.slots.indexOf(r.encounterSlot) < 0) return false;
    if (f.species && f.species.length && f.species.indexOf(r.species) < 0) return false;
    if (f.forms && f.forms.length && r.form !== undefined && f.forms.indexOf(r.form) < 0) return false;
    return true;
  }

  function applyFilter(results, filter) {
    if (!filter) return results;
    return results.filter(function (r) { return monMatches(r, filter); });
  }

  // ---------------------------------------------------------------- leads
  var PRESSURE_FAMILY = { PRESSURE: 1, HUSTLE: 1, VITAL_SPIRIT: 1 };
  var KEEN_EYE_FAMILY = { KEEN_EYE: 1, INTIMIDATE: 1 };
  var SUCTION_FAMILY = { SUCTION_CUPS: 1, STICKY_HOLD: 1 };
  var ARENA_FAMILY = { ARENA_TRAP: 1, NO_GUARD: 1, ILLUMINATE: 1 };
  var COMPOUND_FAMILY = { COMPOUND_EYES: 1, SUPER_LUCK: 1 };
  var FIELD_ABILITIES = { SYNCHRONIZE: 1, CUTE_CHARM: 1, MAGNET_PULL: 1, STATIC: 1, PRESSURE: 1, HUSTLE: 1, VITAL_SPIRIT: 1, KEEN_EYE: 1, INTIMIDATE: 1 };

  function normalizeLead(lead) {
    if (!lead || !lead.ability) return { ability: null };
    var a = ("" + lead.ability).toUpperCase();
    var out = { ability: a, nature: lead.nature, gender: lead.gender, level: lead.level };
    if (a === "SYNCHRONIZE" && (out.nature === null || out.nature === undefined)) throw new Error("Synchronize lead needs a nature");
    if (a === "CUTE_CHARM" && out.gender !== "M" && out.gender !== "F") throw new Error("Cute Charm lead needs gender 'M' or 'F'");
    return out;
  }
  function isPressure(l) { return !!PRESSURE_FAMILY[l.ability]; }
  function isKeenEye(l) { return !!KEEN_EYE_FAMILY[l.ability]; }
  function cuteCharmWants(l) { return l.gender === "F" ? 0 : 1; } // opposite gender of the lead (0=M,1=F)

  function typedSlots(slots, type) {
    var idx = [];
    for (var i = 0; i < slots.length; i++) {
      var t = slots[i].species.type_ids || [];
      if (t[0] === type || t[1] === type) idx.push(i);
    }
    if (idx.length === 0 || idx.length === slots.length) return [];
    return idx;
  }
  function leadType(l) { return l.ability === "MAGNET_PULL" ? TYPE_STEEL : l.ability === "STATIC" ? TYPE_ELECTRIC : null; }

  // ---------------------------------------------------------------- slot tables
  function slotFromCumulative(rand, cum) {
    for (var i = 0; i < cum.length; i++) if (rand < cum[i]) return i;
    return cum.length - 1;
  }
  var CUM_LAND = [20, 40, 50, 60, 70, 80, 85, 90, 94, 98, 99, 100];
  var CUM_WATER = [60, 90, 95, 99, 100];
  var CUM_OLD3 = [70, 100];
  var CUM_GOOD3 = [60, 80, 100];
  var CUM_SUPER3 = [40, 80, 95, 99, 100];
  var CUM_ROD_J_GOOD_SUPER = [40, 80, 95, 99, 100];
  var CUM_ROD_K = [40, 70, 85, 95, 100];
  var CUM_ROCK_K = [80, 100];
  var CUM_HEADBUTT = [50, 65, 80, 90, 95, 100];
  var BUG_RATES = [80, 60, 50, 40, 30, 20, 15, 10, 5, 0];

  // pokeemerald/src/wild_encounter.c:182-262 (identical tables in pokeruby :144-230, pokefirered :71-130)
  function hSlot(rand, encounter) {
    switch (encounter) {
      case "old_rod": return slotFromCumulative(rand, CUM_OLD3);
      case "good_rod": return slotFromCumulative(rand, CUM_GOOD3);
      case "super_rod": return slotFromCumulative(rand, CUM_SUPER3);
      case "surf": case "rock_smash": return slotFromCumulative(rand, CUM_WATER);
      default: return slotFromCumulative(rand, CUM_LAND);
    }
  }
  // pokeplatinum/src/overlay006/wild_encounters.c:820-915
  function jSlot(rand, encounter) {
    switch (encounter) {
      case "good_rod": case "super_rod": return slotFromCumulative(rand, CUM_ROD_J_GOOD_SUPER);
      case "old_rod": case "surf": return slotFromCumulative(rand, CUM_WATER);
      default: return slotFromCumulative(rand, CUM_LAND);
    }
  }
  // pokeheartgold/src/field/encounter_check.c:631-716 ; bug contest src/overlay_bug_contest.c:178-183
  function kSlot(rand, encounter) {
    switch (encounter) {
      case "old_rod": case "good_rod": case "super_rod": return slotFromCumulative(rand, CUM_ROD_K);
      case "surf": return slotFromCumulative(rand, CUM_WATER);
      case "rock_smash": return slotFromCumulative(rand, CUM_ROCK_K);
      case "headbutt": return slotFromCumulative(rand, CUM_HEADBUTT);
      case "bug_contest":
        for (var i = 0; i < BUG_RATES.length; i++) if (rand >= BUG_RATES[i]) return i;
        return BUG_RATES.length - 1;
      default: return slotFromCumulative(rand, CUM_LAND);
    }
  }
  var FEEBAS_SLOT3 = { old_rod: 2, good_rod: 3, super_rod: 5 };
  // feebasTile needs the Feebas pseudo-slot (species 349) appended at the index PokeFinder reports
  // (docs/FACTS.md, Gen 3 wild / Method J); fail early with the requirement instead of "slot N missing"
  function assertFeebasSlot(fn, slots, idx) {
    var s = slots[idx];
    if (!s || !s.species || s.species.dex !== 349) {
      throw new Error(fn + ": feebasTile requires the Feebas slot (species 349) at index " + idx + " of the rod table (the table has " + slots.length + " slots)");
    }
  }
  function isFishing(enc) { return enc === "old_rod" || enc === "good_rod" || enc === "super_rod"; }

  // pokeplatinum/src/overlay006/wild_encounters.c:116-179 (index = table id - 1)
  var DPPT_UNOWN_GROUPS = [
    [0, 1, 2, 6, 7, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25],
    [5], [17], [8], [13], [4], [3], [26, 27]
  ];
  // pokeheartgold/src/field/encounter_check.c:1252-1297 (puzzle order Kabuto, Aerodactyl, Omanyte, Ho-Oh; Sinjoh last)
  var HGSS_UNOWN_PUZZLES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [17, 18, 19, 20, 21], [10, 11, 12, 13, 14, 15, 16], [22, 23, 24, 25]
  ];
  var HGSS_UNOWN_SINJOH = [26, 27];

  // ================================================================ Gen 3
  // Method 1/2/4 statics and gifts. pokeemerald/src/pokemon.c:2218 (Random32 = lo | hi<<16,
  // include/random.h:12), :2277-2296 (IV words), VBlank Random() at src/main.c:365-366; the skip
  // positions are PokeFinder's (EMPIRICAL, WildGenerator3.cpp:179-187, StaticGenerator3.cpp:33-38).
  function gen3Static(seed, o) {
    var out = [];
    var start = o.frameStart || 0;
    var count = o.frameCount === undefined ? 10 : o.frameCount;
    var method = (o.method || "M1").toUpperCase();
    var tid = o.tid || 0, sid = o.sid || 0;
    var species = o.species;
    var rng = new Stream(core.jump(seed, start));
    for (var i = 0; i < count; i++) {
      var go = rng.clone();
      var lo = go.next();
      var hi = go.next();
      var pid = u32((hi << 16) | lo);
      if (method === "M2") go.next();
      var w1 = go.next();
      if (method === "M4") go.next();
      var w2 = go.next();
      if (o.buggedRoamer) {
        // RS/FRLG roamer: SetBoxMonData(MON_DATA_IVS) reads one byte: pokeruby/src/pokemon_2.c:938,
        // pokefirered/src/pokemon.c:3660; Emerald reads all four (pokeemerald/src/pokemon.c:4400)
        w1 &= 0xff;
        w2 = 0;
      }
      out.push(buildResult(start + i, pid, ivsFromWords(w1, w2), o.level, species, tid, sid, { callsUsed: go.calls }));
      rng.next();
    }
    return applyFilter(out, o.filter);
  }

  var GEN3_GAMES = { ruby: "rs", sapphire: "rs", emerald: "e", firered: "frlg", leafgreen: "frlg" };

  // Wild Method H. Emerald: pokeemerald/src/wild_encounter.c (slot :182-262, level :268-301,
  // nature :335-377, CreateWildMon :379-415, TryGenerateWildMon :424-455, Magnet Pull/Static
  // :936-951, Keen Eye :897-912, odds :493-497, new metatile :535, roamer src/roamer.c:216-227,
  // outbreak :476-486, Feebas :113-138, Safari :340-343). Ruby: pokeruby/src/wild_encounter.c
  // (nature :271-300, CreateWildMon :302-306). FRLG: pokefirered/src/wild_encounter.c:226-253.
  function gen3Wild(seed, o) {
    var game = GEN3_GAMES[o.game];
    if (!game) throw new Error("gen3Wild: unknown game " + o.game);
    var enc = o.encounter;
    var slots = o.slots;
    var lead = normalizeLead(o.lead);
    if (game !== "e" && lead.ability && FIELD_ABILITIES[lead.ability]) {
      throw new Error("gen3Wild: " + o.game + " has no lead ability effects (" + lead.ability + ")");
    }
    var method = (o.method || "M1").toUpperCase();
    var opt = o.options || {};
    if (opt.feebasTile && isFishing(enc) && game !== "frlg") assertFeebasSlot("gen3Wild", slots, FEEBAS_SLOT3[enc]);
    var tid = o.tid || 0, sid = o.sid || 0;
    var start = o.frameStart || 0;
    var count = o.frameCount === undefined ? 10 : o.frameCount;
    var ltype = game === "e" ? leadType(lead) : null;
    var typed = ltype !== null ? typedSlots(slots, ltype) : [];
    // decomp: Magnet Pull is checked on land only, Static on land and water, neither on rocks
    // (pokeemerald/src/wild_encounter.c:429-446)
    var typedApplies = ltype !== null && (enc === "grass" || (enc === "surf" && lead.ability === "STATIC"));
    var rockOdds = game !== "frlg" && enc === "rock_smash";
    var rate16 = 0;
    if (rockOdds) {
      // WildEncounterCheck(rate, ignoreAbility=TRUE): pokeemerald/src/wild_encounter.c:500-528
      rate16 = (o.rate || 0) * 16;
      if (opt.bike) rate16 = Math.floor(rate16 * 80 / 100);
      if (opt.item === "white_flute") rate16 += Math.floor(rate16 / 2);
      else if (opt.item === "black_flute") rate16 = Math.floor(rate16 / 2);
      if (opt.item === "cleanse_tag") rate16 = Math.floor(rate16 * 2 / 3);
      if (rate16 > 2880) rate16 = 2880;
    }
    var out = [];
    var rng = new Stream(core.jump(seed, start));
    for (var i = 0; i < count; i++) {
      var frame = start + i;
      var go = rng.clone();
      rng.next();
      var r = null;
      var slot = -1, level = 0, feebas = false, suppressed = null;

      // optional rolls that precede the slot roll in StandardWildEncounter (all off by default,
      // which is PokeFinder's frame convention)
      if (opt.newMetatile && enc !== "rock_smash" && !isFishing(enc)) {
        // pokeemerald :535-540, pokeruby :427-433, pokefirered :348-353
        if (go.mod(100) >= 60) { out.push(invalid(frame, "new_metatile", go.calls)); continue; }
      }
      if (rockOdds) {
        if (go.mod(2880) >= rate16) { out.push(invalid(frame, "rock_smash_odds", go.calls)); continue; }
      } else if (opt.oddsRoll && !isFishing(enc)) {
        if (game === "frlg") {
          // FRLG rolls the odds on its own RNG (pokefirered/src/wild_encounter.c:304,667-671): no main call
        } else {
          var lr = Math.min(2880, (o.rate || 0) * 16);
          if (go.mod(2880) >= lr) { out.push(invalid(frame, "odds", go.calls)); continue; }
        }
      }
      if (opt.roamer && (enc === "grass" || enc === "surf")) {
        // pokeemerald/src/roamer.c:216-227 ; pokeruby/src/roamer.c:183 ; pokefirered TryStartRoamerEncounter
        if (go.mod(4) === 0) { out.push(invalid(frame, "roamer", go.calls)); continue; }
      }
      var outbreakHit = false;
      if (opt.outbreak && enc === "grass" && game !== "frlg") {
        // pokeemerald :476-486 ; pokeruby :365-375
        if (go.mod(100) < (opt.outbreak.probability || 0)) outbreakHit = true;
      }

      var speciesRec, minL, maxL, form = 0;
      if (outbreakHit) {
        speciesRec = opt.outbreak.species; level = opt.outbreak.level; slot = -1;
      } else {
        if (isFishing(enc) && (opt.feebasTile || opt.feebasMap) && game !== "frlg") {
          // CheckFeebas: the 50% roll comes right after the Route 119 map check and BEFORE the spot
          // comparison (pokeemerald :121-122,137; pokeruby :84-85,98), so every cast on the map spends it
          // (feebasMap); only a cast on the tile (feebasTile) can hit. PokeFinder skips it off the tile (D7).
          var feebasRoll = go.mod(100);
          if (feebasRoll <= 49 && opt.feebasTile) { feebas = true; slot = FEEBAS_SLOT3[enc]; }
        }
        if (!feebas) {
          var forced = false;
          if (typedApplies) {
            // TryGetAbilityInfluencedWildMonIndex: pokeemerald :929-951
            if (go.mod(2) === 0 && typed.length > 0) { slot = typed[go.mod(typed.length)]; forced = true; }
          }
          if (!forced) slot = hSlot(go.mod(100), enc);
        }
        var sl = slots[slot];
        if (!sl) throw new Error("gen3Wild: slot " + slot + " missing in table");
        speciesRec = sl.species; minL = sl.minLevel; maxL = sl.maxLevel; form = sl.form || 0;
        // ChooseWildMonLevel: pokeemerald :268-301 (Pressure family only in Emerald), pokeruby :233-252, pokefirered :132-149
        var range = maxL - minL + 1;
        var rand = go.mod(range);
        if (game === "e" && isPressure(lead)) {
          if (go.mod(2) === 0) rand = range - 1;
          else if (rand !== 0) rand--;
        }
        level = minL + rand;
        if (game === "e" && isKeenEye(lead) && lead.level > 5 && enc !== "old_rod" && enc !== "good_rod" && enc !== "super_rod") {
          // IsAbilityAllowingEncounter: pokeemerald :897-912 (only with WILD_CHECK_KEEN_EYE)
          if (level <= lead.level - 5 && go.mod(2) === 0) { out.push(invalid(frame, "keen_eye", go.calls)); continue; }
        }
      }

      var pid, nature;
      if (game === "frlg" && opt.tanoby) {
        // GenerateUnownPersonalityByLetter: pokefirered :243-251, first call is the high half
        do {
          var uh = go.next();
          var ul = go.next();
          pid = u32((uh << 16) | ul);
        } while (unownLetter(pid) !== form);
        nature = pid % 25;
      } else {
        var wantGender = -1;
        if (game === "e" && lead.ability === "CUTE_CHARM" && !genderFixed(speciesRec.gender_ratio)) {
          // pokeemerald :391-395
          if (go.mod(3) !== 0) wantGender = cuteCharmWants(lead);
        }
        if (game !== "frlg" && opt.safari) {
          // PickWildMonNature safari roll, no Pokeblock assumed: pokeemerald :340-343, pokeruby :271-274
          go.mod(100);
        }
        if (game === "e" && lead.ability === "SYNCHRONIZE") {
          // pokeemerald :369-374
          nature = go.mod(2) === 0 ? lead.nature : go.mod(25);
        } else {
          nature = go.mod(25); // pokeemerald :377, pokeruby :299, pokefirered :232
        }
        // CreateMonWithNature / CreateMonWithGenderNatureLetter: pokeemerald/src/pokemon.c:2305-2347
        do {
          var plo = go.next();
          var phi = go.next();
          pid = u32((phi << 16) | plo);
        } while (pid % 25 !== nature || (wantGender >= 0 && genderOf(pid, speciesRec.gender_ratio) !== wantGender));
      }
      if (method === "M2") go.next();
      var w1 = go.next();
      if (method === "M4") go.next();
      var w2 = go.next();
      r = buildResult(frame, pid, ivsFromWords(w1, w2), level, speciesRec, tid, sid, {
        encounterSlot: slot, form: form, feebas: feebas, outbreak: outbreakHit, callsUsed: go.calls
      });
      out.push(r);
    }
    return applyFilter(out, o.filter);
  }

  function invalid(frame, reason, calls) {
    return { frame: frame, valid: false, reason: reason, callsUsed: calls };
  }

  // Gen 3 eggs. PokeFinder's held/pickup split and skip presets are EMPIRICAL (EggGenerator3.cpp);
  // the calls themselves: Emerald trigger pokeemerald/src/daycare.c:445-449,455-484 and :893,
  // pickup :813-814 -> pokemon.c:2277-2296 + daycare.c:527-597; RS pokeruby/src/daycare.c:363-366,
  // :406-465, :714-722, :755-756; FRLG pokefirered/src/daycare.c:750,791-820,1121-1122,1152.
  var EGG3_PRESETS = {
    EBred: { iv1: 0, iv2: 0, inh: 1 }, EBredSplit: { iv1: 0, iv2: 1, inh: 1 }, EBredAlternate: { iv1: 0, iv2: 0, inh: 2 },
    RSFRLGBred: { iv1: 1, iv2: 0, inh: 1 }, RSFRLGBredSplit: { iv1: 0, iv2: 1, inh: 1 },
    RSFRLGBredAlternate: { iv1: 1, iv2: 0, inh: 2 }, RSFRLGBredMixed: { iv1: 0, iv2: 0, inh: 2 }
  };

  function eggSpeciesFor(pid, o) {
    // Nidoran / Illumise eggs pick the male species from bit 15 (pokeemerald/src/daycare.c:784-791)
    if (o.speciesMale && (pid & 0x8000)) return o.speciesMale;
    return o.species;
  }

  // Emerald inheritance (RemoveIVIndexFromList(availableIVs, i) removes position i, so the lists are
  // fixed): pokeemerald/src/daycare.c:527-597. RS/FRLG remove the *value* as an index:
  // pokeruby/src/daycare.c:428-429, pokefirered/src/daycare.c:809-810. HGSS removes the rolled
  // index (correct): pokeheartgold/src/get_egg.c:316-320. DPPt is like Emerald: pokeplatinum/src/overlay005/daycare.c:400-411.
  function inherit(ivs, parents, inh, par, mode) {
    var inheritance = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    var available = [0, 1, 2, 3, 4, 5]; // decomp stat ids
    for (var i = 0; i < 3; i++) {
      var pos = inh[i];
      var stat = available[pos];
      var key = STAT_ID_TO_KEY[stat];
      ivs[key] = parents[par[i]][key];
      inheritance[key] = par[i] + 1;
      var removeAt = mode === "fixed" ? i : mode === "value" ? stat : pos;
      if (removeAt < available.length) available.splice(removeAt, 1);
      else available.length = Math.max(0, available.length - 1);
    }
    return inheritance;
  }

  function parentIvs(o) {
    return [toIvObject(o.parentIvs[0], 0), toIvObject(o.parentIvs[1], 0)];
  }

  function gen3EggEmerald(o) {
    var seed = o.seed === undefined ? 0 : o.seed; // Emerald seeds 0 at boot
    var preset = EGG3_PRESETS[o.method] || o.skips || EGG3_PRESETS.EBred;
    var start = o.frameStart || 0, count = o.frameCount === undefined ? 10 : o.frameCount;
    var pStart = o.pickupStart || 0, pCount = o.pickupCount === undefined ? 10 : o.pickupCount;
    var calibration = o.calibration === undefined ? 18 : o.calibration;
    var minRedraw = o.minRedraw || 0, maxRedraw = o.maxRedraw === undefined ? 0 : o.maxRedraw;
    var compat = o.compatibility === undefined ? 70 : o.compatibility;
    var tid = o.tid || 0, sid = o.sid || 0;
    var maxTries = o.maxNatureTries === undefined ? 17 : o.maxNatureTries; // PokeFinder VBlank cut-off (EMPIRICAL); decomp allows 2400 (daycare.c:480)
    var parents = parentIvs(o);
    // female (or Ditto) parent decides Everstone inheritance: pokeemerald/src/daycare.c:421-434
    var parent = 0;
    for (var p = 0; p < 2; p++) if (o.parentGenders[p] === 1) parent = p;
    for (p = 0; p < 2; p++) if (o.parentGenders[p] === 3) parent = p;
    var everstone = o.parentItems[parent] === 1;
    var wantedNature = o.parentNatures[parent];

    var held = [];
    var rng = new Stream(core.jump(seed, start));
    var val = start + 1;
    for (var cnt = 0; cnt < count; cnt++, val++) {
      // TryProduceOrHatchEgg: compatibility > (Random()*100)/USHRT_MAX (daycare.c:893)
      if (Math.floor(rng.next() * 100 / 0xffff) >= compat) continue;
      for (var redraw = minRedraw; redraw <= maxRedraw; redraw++) {
        var go = rng.clone();
        var offset = calibration + 3 * redraw;
        // GetParentToInheritNature: Random() >= USHRT_MAX/2 -> no inheritance (daycare.c:446-447)
        var flag = everstone ? go.next() < 0x7fff : false;
        var trng = new Stream((val - offset) & 0xffff); // Random2 seeded with vblankCounter2 (daycare.c:459), EMPIRICAL model
        var pid;
        if (!flag) {
          pid = u32(((trng.next() << 16) >>> 0) | (go.mod(0xfffe) + 1)); // daycare.c:465
        } else {
          var tries = 0, ok = false;
          while (tries < maxTries) {
            tries++;
            pid = u32(((trng.next() << 16) >>> 0) | go.next()); // daycare.c:476-479
            if (pid % 25 === wantedNature && pid !== 0) { ok = true; break; }
          }
          if (!ok) continue;
        }
        var sp = eggSpeciesFor(pid, o);
        held.push({ advances: u32(start + cnt - offset), heldFrame: start + cnt - offset, redraws: redraw, pid: pid, species: sp, everstoneInherited: flag });
      }
    }
    return eggPickup3(seed, held, { start: pStart, count: pCount, preset: preset, parents: parents, mode: "fixed", tid: tid, sid: sid, filter: o.filter, high: false, level: 5 });
  }

  function gen3EggRSFRLG(o) {
    var preset = EGG3_PRESETS[o.method] || o.skips || EGG3_PRESETS.RSFRLGBred;
    var start = o.frameStart || 0, count = o.frameCount === undefined ? 10 : o.frameCount;
    var pStart = o.pickupStart || 0, pCount = o.pickupCount === undefined ? 10 : o.pickupCount;
    var compat = o.compatibility === undefined ? 70 : o.compatibility;
    var tid = o.tid || 0, sid = o.sid || 0;
    var parents = parentIvs(o);
    var held = [];
    var rng = new Stream(core.jump(o.seed, start));
    for (var cnt = 0; cnt < count; cnt++) {
      var go = rng.clone();
      rng.next();
      if (Math.floor(go.next() * 100 / 0xffff) < compat) {
        var low = go.mod(0xfffe) + 1; // pokeruby daycare.c:364
        held.push({ advances: start + cnt, heldFrame: start + cnt, redraws: 0, pid: low, species: eggSpeciesFor(low, o) });
      }
    }
    return eggPickup3(o.seedPickup, held, { start: pStart, count: pCount, preset: preset, parents: parents, mode: "value", tid: tid, sid: sid, filter: o.filter, high: true, level: 5 });
  }

  function eggPickup3(seed, held, c) {
    var out = [];
    if (held.length === 0) return out;
    var rng = new Stream(core.jump(seed, c.start));
    for (var cnt = 0; cnt < c.count; cnt++) {
      var go = rng.clone();
      rng.next();
      var high = 0;
      if (c.high) high = go.next(); // RS/FRLG: pending low half | Random() << 16 at pickup (pokeruby daycare.c:721)
      go.skip(c.preset.iv1);
      var w1 = go.next();
      go.skip(c.preset.iv2);
      var w2 = go.next();
      go.skip(c.preset.inh);
      var inh = [go.mod(6), go.mod(5), go.mod(4)];
      var par = [go.mod(2), go.mod(2), go.mod(2)];
      for (var h = 0; h < held.length; h++) {
        var st = held[h];
        var pid = c.high ? u32((high << 16) | st.pid) : st.pid;
        var ivs = ivsFromWords(w1, w2);
        var inheritance = inherit(ivs, c.parents, inh, par, c.mode);
        var sp = c.high ? eggSpeciesFor(pid, { species: st.species, speciesMale: null }) : st.species;
        var r = buildResult(c.start + cnt, pid, ivs, c.level, st.species, c.tid, c.sid, {
          advances: st.advances, heldFrame: st.heldFrame, pickupAdvances: c.start + cnt, redraws: st.redraws,
          everstoneInherited: !!st.everstoneInherited,
          inheritance: inheritance, inheritanceArray: ivArray(inheritance), callsUsed: go.calls
        });
        out.push(r);
      }
    }
    // redraws breaks the (advances, pickupAdvances) ties that redraw ranges create (cnt - 3*redraw collides);
    // PokeFinder's compare (EggGenerator3.cpp) has no tiebreak, so no oracle order exists for them
    out.sort(function (a, b) { return a.advances - b.advances || a.pickupAdvances - b.pickupAdvances || a.redraws - b.redraws; });
    return applyFilter(out, c.filter);
  }

  // ================================================================ Gen 4
  // Pokemon_InitWith: pokeplatinum/src/pokemon.c:405-470 (PID lo|hi<<16 :412, IVs :452-470);
  // HGSS CreateBoxMon pokeheartgold/src/pokemon.c:188-240. Shiny::Always = Pokemon_FindShinyPersonality
  // pokeplatinum/src/pokemon.c:2762-2795 / GenerateShinyPersonality pokeheartgold/src/pokemon.c:2132-2152.
  // Shiny::Never = the Manaphy egg hatch reroll, pokeplatinum/src/overlay005/daycare.c:1128-1134 (ARNG).
  function shinyPid(go, tid, sid) {
    var tsv = ((tid ^ sid) & 0xffff) >>> 3;
    var low = go.next() & 7;
    var high = go.next() & 7;
    for (var i = 0; i < 13; i++) {
      var bit = 1 << (i + 3);
      if (tsv & (1 << i)) {
        if (go.next() & 1) low |= bit; else high |= bit;
      } else if (go.next() & 1) {
        low |= bit; high |= bit;
      }
    }
    return u32((high << 16) | low);
  }

  function gen4Static(seed, o) {
    var out = [];
    var start = o.frameStart || 0;
    var count = o.frameCount === undefined ? 10 : o.frameCount;
    var method = (o.method || "M1").toUpperCase();
    var tid = o.tid || 0, sid = o.sid || 0;
    var species = o.species;
    var lead = normalizeLead(o.lead);
    var shiny = o.shiny || "random";
    var rng = new Stream(core.jump(seed, start));
    for (var i = 0; i < count; i++) {
      var frame = start + i;
      var go = rng.clone();
      var prng = rng.next();
      var pid, nature;
      if (method === "M1") {
        if (shiny === "always") {
          pid = shinyPid(go, tid, sid);
        } else {
          var lo = go.next();
          var hi = go.next();
          pid = u32((hi << 16) | lo);
          if (shiny === "never") {
            while (core.isShiny(pid, tid, sid)) pid = arngNext(pid);
          }
        }
      } else {
        // CreateWildMon path (Method J / K statics): pokeplatinum/src/overlay006/wild_encounters.c:1047-1087,
        // pokeheartgold/src/field/encounter_check.c:821-875
        var res = gen4WildPid(go, method, lead, species);
        pid = res.pid;
      }
      var w1 = go.next();
      var w2 = go.next();
      var extra = { callsUsed: go.calls, call: prng % 3, chatot: ((prng % 8192) * 100) >> 13 };
      if (method !== "M1") extra.callsUsedWithItem = go.calls + 1; // Pokemon_GiveHeldItem follows (:4681)
      out.push(buildResult(frame, pid, ivsFromWords(w1, w2), o.level, species, tid, sid, extra));
    }
    return applyFilter(out, o.filter);
  }

  // HGSS creates the three starters in a row, 4 calls each: pokeheartgold/src/choose_starter.c:55-59.
  function gen4StarterTriple(seed, frame, speciesList, tid, sid) {
    var out = [];
    for (var i = 0; i < 3; i++) {
      out.push(gen4Static(seed, { frameStart: frame + 4 * i, frameCount: 1, method: "M1", species: speciesList[i], level: 5, tid: tid, sid: sid })[0]);
    }
    return out;
  }

  // Cute Charm roll, Synchronize/nature roll and PID for the Gen 4 wild creator.
  // DPPt: wild_encounters.c:942-950 (nature), :1047-1087 (CreateWildMon), pokemon.c:505-545
  // (sub_02074044 loop, sub_02074088 -> sub_02074128 arithmetic PID). HGSS: encounter_check.c:733-739,
  // :821-875, pokemon.c:258-297 (GenPersonalityByGenderAndNature).
  function gen4WildPid(go, method, lead, species, forceOnePerfect) {
    var div = method === "J";
    var roll = function (n) { return div ? go.div(n) : go.mod(n); };
    var ccFlag = false;
    if (lead.ability === "CUTE_CHARM" && !genderFixed(species.gender_ratio)) ccFlag = roll(3) !== 0;
    var nature, pid, w1, w2;
    var natureRoll = function () {
      if (lead.ability === "SYNCHRONIZE") return roll(2) === 0 ? lead.nature : roll(25);
      return roll(25);
    };
    if (ccFlag) {
      nature = natureRoll();
      var wants = cuteCharmWants(lead);
      pid = wants === 0 ? 25 * (Math.floor(species.gender_ratio / 25) + 1) + nature : nature;
      return { pid: u32(pid), nature: nature, cuteCharm: true };
    }
    if (forceOnePerfect) {
      // Safari / Bug Contest: up to 4 full creations until one IV is 31 (encounter_check.c:854-868)
      for (var t = 0; t < 4; t++) {
        nature = natureRoll();
        do { var lo1 = go.next(); var hi1 = go.next(); pid = u32((hi1 << 16) | lo1); } while (pid % 25 !== nature);
        w1 = go.next(); w2 = go.next();
        var ivs = ivsFromWords(w1, w2);
        if (ivs.hp === 31 || ivs.atk === 31 || ivs.def === 31 || ivs.spe === 31 || ivs.spa === 31 || ivs.spd === 31) break;
      }
      // t == 4 means all four creations missed a 31: report 4 tries and perfectIvFound false (C# parity)
      return { pid: pid, nature: nature, cuteCharm: false, w1: w1, w2: w2, tries: Math.min(t + 1, 4), found: t < 4 };
    }
    nature = natureRoll();
    do { var lo = go.next(); var hi = go.next(); pid = u32((hi << 16) | lo); } while (pid % 25 !== nature);
    return { pid: pid, nature: nature, cuteCharm: false };
  }

  // battleAdvances (EMPIRICAL, PokeFinder WildGenerator4.cpp:247-270): calls between the frame and
  // the battle start that are not part of the creation.
  function battleConst(o, enc) {
    var opt = o.options || {};
    var c = 0;
    if (isFishing(enc)) c += 1;
    if (o.game === "diamond" || o.game === "pearl") c += 4;
    if (!opt.greatMarsh && !opt.safari) c += 1;
    return c;
  }

  function itemClass(rand, compound) {
    // pokeplatinum/src/pokemon.c:4681-4700 (45/95, Compound Eyes 20/80); pokeheartgold/src/pokemon.c:3748-3762
    var t = compound ? [20, 80] : [45, 95];
    return rand < t[0] ? "none" : rand < t[1] ? "common" : "rare";
  }

  function gen4Wild(seed, o) {
    var method = (o.method || "J").toUpperCase();
    if (method !== "J" && method !== "K") throw new Error("gen4Wild: method must be J or K");
    var div = method === "J";
    var enc = o.encounter;
    var slots = o.slots || [];
    var lead = normalizeLead(o.lead);
    var opt = o.options || {};
    if (opt.feebasTile && isFishing(enc) && method === "J") assertFeebasSlot("gen4Wild", slots, 5);
    var tid = o.tid || 0, sid = o.sid || 0;
    var start = o.frameStart || 0;
    var count = o.frameCount === undefined ? 10 : o.frameCount;
    var ltype = leadType(lead);
    var typed = ltype !== null ? typedSlots(slots, ltype) : [];
    var safari = !!opt.safari;
    var bug = enc === "bug_contest";
    var honey = enc === "honey_tree";
    var radar = enc === "radar";
    var compound = !!COMPOUND_FAMILY[lead.ability];
    var bconst = battleConst(o, enc);
    var rate = o.rate || 0;
    if (method === "K") {
      // pokeheartgold/src/field/encounter_check.c:1040-1081 (fishing friendship boost), :1119-1142 (ability rate)
      if (isFishing(enc)) {
        rate += opt.fishingBoost || 0;
        if (SUCTION_FAMILY[lead.ability]) rate *= 2;
      } else if (ARENA_FAMILY[lead.ability]) rate *= 2;
      if (rate > 100 && lead.ability) rate = 100;
    }
    var nibbleEnc = isFishing(enc) || (method === "K" && enc === "rock_smash");
    var out = [];
    var rng = new Stream(core.jump(seed, start));
    for (var i = 0; i < count; i++) {
      var frame = start + i;
      var go = rng.clone();
      var prng = rng.next();
      var valid = true;
      var slot = 0, level = 0, feebas = false, sl, species, form = 0;
      var extra = {};

      if (nibbleEnc) {
        // DPPt wild_encounters.c:396 (RandMod); HGSS encounter_check.c:341 (LCRandRange), :388 (LCRandom()%100)
        if ((div ? go.div(100) : go.mod(100)) >= rate) valid = false;
      }

      if (honey) {
        // CreateWildMon_HoneyTree: wild_encounters.c:1196-1224
        sl = slots[opt.index || 0];
        species = sl.species;
        level = 5 + go.div(11);
        if (isPressure(lead)) { if (go.div(2) !== 0) level = 15; }
        slot = opt.index || 0;
      } else if (radar) {
        // chain kept: CreateWildMon_FromRadarKeepChain (:1149-1161); a new patch rolls a slot (:1164-1194)
        if (opt.radarKeepChain === false) {
          var f2 = false;
          if (ltype !== null) { if (go.div(2) === 0 && typed.length) { slot = typed[go.mod(typed.length)]; f2 = true; } }
          if (!f2) slot = jSlot(go.div(100), "grass");
        } else slot = opt.index || 0;
        sl = slots[slot]; species = sl.species; level = sl.maxLevel;
      } else {
        var forced = false;
        if (isFishing(enc) && (opt.feebasTile || opt.feebasMap) && method === "J") {
          // PlayerAvatar_IsFacingFeebasTile: overlay006/feebas_fishing.c:37 (RandMod(2)==0 -> not Feebas) is the
          // first statement of the function, reached on every cast on Mt. Coronet B1F (wild_encounters.c:407,
          // map_header.c:194-196) whether or not the tile matches (feebasMap); a hit needs the tile (feebasTile).
          // The whole table is then Feebas (:407-420) and the normal slot roll still happens (:1121-1127).
          var feebasRoll4 = go.div(2);
          if (feebasRoll4 !== 0 && opt.feebasTile) {
            feebas = true; slot = 5;
            if (ltype !== null) go.div(2); // TryGetSlotForTypeMatchAbility for the lead's ability (:1319)
            go.div(100); // GetRodEncounterSlot (:872)
            forced = true;
          }
        }
        if (!forced && ltype !== null) {
          // DPPt :1317-1323 + ForceMatchingTypeEncounterSlot :1288-1314 (LCRNG_Next() % n);
          // HGSS :1111-1117 + chooseAbilityCoercedSlot :1088-1109 (LCRandom() % n)
          if ((div ? go.div(2) : go.mod(2)) === 0 && typed.length) {
            var pick = typed[go.mod(typed.length)];
            if (method === "J" && enc !== "grass" && lead.ability === "MAGNET_PULL") {
              // DPPt water/fishing: the Magnet Pull result is overwritten by the Static check (:1112-1120, BUG comment)
            } else { slot = pick; forced = true; }
          }
        }
        if (!forced) {
          if (method === "K" && safari) slot = go.next() % 10; // encounter_check.c:959
          else if (bug) slot = kSlot(go.mod(100), "bug_contest"); // overlay_bug_contest.c:178-183
          else slot = div ? jSlot(go.div(100), enc) : kSlot(go.mod(100), enc);
        }
        sl = slots[slot];
        if (!sl) throw new Error("gen4Wild: slot " + slot + " missing in table");
        species = sl.species;
        form = sl.form || 0;
        var fixedLevel = enc === "grass" || (method === "K" && safari);
        if (fixedLevel) {
          // grass: level is the slot's; Pressure family keeps the slot on RandMod(2)==0 else the
          // higher-level same-species slot. DPPt :1499-1518; HGSS :1358-1372 (land and safari land only)
          if (isPressure(lead) && (!safari || enc === "grass")) {
            if ((div ? go.div(2) : go.mod(2)) !== 0) {
              var ns = slot;
              for (var k = 0; k < slots.length; k++) {
                if (slots[k].species.dex === slots[ns].species.dex && slots[k].maxLevel > slots[ns].maxLevel) ns = k;
              }
              slot = ns; sl = slots[slot];
            }
          }
          level = sl.maxLevel;
        } else if (bug) {
          // BugContest_GetEncounterSlot :185-186: level roll only, no Pressure roll
          level = sl.minLevel + go.next() % (sl.maxLevel - sl.minLevel + 1);
        } else {
          // GetWildMonLevel :953-981 / EncounterSlot_WildMonLevelRoll :741-763: modulo range, Pressure RandMod(2)
          var range = sl.maxLevel - sl.minLevel + 1;
          var rand = go.next() % range;
          level = sl.minLevel + rand;
          if (isPressure(lead)) { if ((div ? go.div(2) : go.mod(2)) !== 0) level = sl.maxLevel; }
        }
        if (isKeenEye(lead) && lead.level > 5 && enc !== "honey_tree" && !bug) {
          // FirstMonAbilityPreventsEncounter :1359-1378 / DoesAbilitySuppressEncounter :1144-1160, called from the
          // regular (:920) and Safari (:966) paths only: the Bug Contest path (:976-986) never rolls it
          if (level <= lead.level - 5 && (div ? go.div(2) : go.mod(2)) === 0) {
            out.push(invalid(frame, "keen_eye", go.calls)); continue;
          }
        }
      }

      var pid, nature, w1, w2;
      if (radar && opt.radarShiny) {
        // CreateWildMonShinyWithGenderOrNature :983-1045
        var pick = -1, wantN = -1;
        if (lead.ability === "CUTE_CHARM" && !genderFixed(species.gender_ratio)) { if (go.div(3) !== 0) pick = cuteCharmWants(lead); }
        else if (lead.ability === "SYNCHRONIZE") { if (go.div(2) === 0) wantN = lead.nature; }
        pid = shinyPid(go, tid, sid);
        while ((pick >= 0 && genderOf(pid, species.gender_ratio) !== pick) || (wantN >= 0 && pid % 25 !== wantN)) pid = shinyPid(go, tid, sid);
        nature = pid % 25;
        w1 = go.next(); w2 = go.next();
      } else {
        var force = method === "K" && (safari || bug);
        var res = gen4WildPid(go, method, lead, species, force);
        pid = res.pid; nature = res.nature;
        if (res.w1 !== undefined) { w1 = res.w1; w2 = res.w2; extra.perfectIvTries = res.tries; extra.perfectIvFound = res.found; }
        else { w1 = go.next(); w2 = go.next(); }
        extra.cuteCharm = res.cuteCharm;
      }
      // held item: pokemon.c:4681 (DPPt), pokeheartgold/src/pokemon.c:3748 (HGSS), always one call
      var itemRoll = go.mod(100);
      extra.itemRoll = itemRoll;
      extra.itemClass = itemClass(itemRoll, compound);
      if (species.dex === 201) {
        if (method === "J") {
          // AddWildMonToParty :1488-1490 with WildEncounters_UnownTables :116-179
          var group = DPPT_UNOWN_GROUPS[(opt.unownTable || 1) - 1] || DPPT_UNOWN_GROUPS[0];
          form = group[go.next() % group.length];
        } else {
          // EncounterGen_ChooseUnownForm :1299-1347
          if (opt.sinjoh) form = HGSS_UNOWN_SINJOH[go.next() % 2];
          else {
            var avail = [], uncaught = [];
            var puzzles = opt.unownPuzzles || [true, true, true, true];
            var seen = opt.unownSeen || null;
            for (var pz = 0; pz < 4; pz++) {
              if (!puzzles[pz]) continue;
              for (var q = 0; q < HGSS_UNOWN_PUZZLES[pz].length; q++) {
                var letter = HGSS_UNOWN_PUZZLES[pz][q];
                if (seen && !seen[letter]) uncaught.push(letter);
                avail.push(letter);
              }
            }
            if (opt.unownRadio && uncaught.length > 0 && go.next() % 100 < 50) form = uncaught[go.next() % uncaught.length];
            else form = avail[go.next() % avail.length];
          }
        }
      }
      extra.encounterSlot = slot;
      extra.form = form;
      extra.feebas = feebas;
      extra.callsUsed = go.calls;
      extra.battleAdvances = frame + go.calls + bconst;
      extra.call = prng % 3;
      extra.chatot = ((prng % 8192) * 100) >> 13;
      var r = buildResult(frame, pid, ivsFromWords(w1, w2), level, species, tid, sid, extra);
      r.valid = valid;
      out.push(r);
    }
    return applyFilter(out, o.filter);
  }

  // Poke Radar shiny patch odds: pokeplatinum/src/pokeradar.c:468-482
  function radarShinyOdds(chain) {
    if (!chain) return 0;
    var rate = 8200 - chain * 200;
    if (rate < 200) rate = 200;
    return 1 / rate;
  }

  // Gen 4 eggs. PID: one MT output at trigger (pokeplatinum/src/overlay005/daycare.c:346-370,
  // pokeheartgold/src/get_egg.c:259-274); Masuda: up to 4 ARNG rerolls (daycare.c:719-731,
  // get_egg.c:600-609); pickup: IVs from Pokemon_InitWith then Egg_InheritIVs (daycare.c:764-766,
  // :396-415; get_egg.c:631-632, :294-326).
  function gen4EggHeld(seed, o) {
    var start = o.frameStart || 0;
    var count = o.frameCount === undefined ? 10 : o.frameCount;
    var tid = o.tid || 0, sid = o.sid || 0;
    var everstone = o.everstoneNature === undefined ? null : o.everstoneNature;
    // The Everstone check is an LCRNG roll at trigger time, not an MT call: LCRNG_Next() >= 0xffff/2 (= 0x7fff)
    // -> no inheritance (pokeplatinum/src/overlay005/daycare.c:336-341; HGSS LCRandom() >= 0x7FFF, get_egg.c:241,247),
    // so the parent's nature passes only GEN4_EVERSTONE_INHERIT_CHANCE (32767/65536) of the time. everstoneProc: false
    // models the failed roll (the PID is the plain MT output). The trigger-time LCRNG state itself is not tracked.
    var proc = o.everstoneProc === undefined ? true : !!o.everstoneProc;
    if (!proc) everstone = null;
    var mt = new gen4.Mt19937(seed >>> 0);
    for (var s = 0; s < start; s++) mt.next();
    var buf = [];
    var need = count + (everstone === null ? 0 : 2401);
    for (var b = 0; b < need; b++) buf.push(mt.next());
    var held = [];
    for (var i = 0; i < count; i++) {
      var pid = buf[i];
      var tries = 0;
      if (everstone !== null) {
        // Daycare_SetInheritedNature: loop until the nature matches and pid != 0, 2400 tries (daycare.c:353-367)
        var j = i;
        while (!(pid % 25 === everstone && pid !== 0)) {
          if (++tries > 2400) break;
          pid = buf[++j];
        }
      }
      if (o.masuda) {
        if (!core.isShiny(pid, tid, sid)) {
          for (var m = 0; m < 4; m++) { pid = arngNext(pid); if (core.isShiny(pid, tid, sid)) break; }
        }
      }
      held.push({ advances: start + i, pid: pid >>> 0, species: eggSpeciesFor(pid, o), natureTries: tries, everstoneInherited: everstone !== null });
    }
    return held;
  }

  function gen4EggPickup(seed, held, o) {
    var out = [];
    if (held.length === 0) return out;
    var start = o.pickupStart || 0;
    var count = o.pickupCount === undefined ? 10 : o.pickupCount;
    var tid = o.tid || 0, sid = o.sid || 0;
    var parents = parentIvs(o);
    var hgss = o.game === "heartgold" || o.game === "soulsilver" || o.game === "hgss";
    var rng = new Stream(core.jump(seed, start));
    for (var cnt = 0; cnt < count; cnt++) {
      var go = rng.clone();
      var prng = rng.next();
      var w1 = go.next();
      var w2 = go.next();
      var ivsBase = ivsFromWords(w1, w2);
      var inh = [], par = [], startNum = 0;
      var forced = null;
      if (hgss && o.powerItem) {
        // Daycare_TryGetForcedInheritedIV get_egg.c:999-1029: the parent with the power item decides
        // the first stat; two power items -> LCRandom()%2 picks the parent
        forced = { stat: o.powerItem.stat, parent: o.powerItem.parent };
        if (o.powerItem.both) forced.parent = go.next() % 2 !== 0 ? 0 : 1;
        startNum = 1;
      }
      for (var k = startNum; k < 3; k++) inh.push(go.next() % (6 - k));
      for (k = startNum; k < 3; k++) par.push(go.next() % 2);
      for (var h = 0; h < held.length; h++) {
        var st = held[h];
        var ivs = { hp: ivsBase.hp, atk: ivsBase.atk, def: ivsBase.def, spa: ivsBase.spa, spd: ivsBase.spd, spe: ivsBase.spe };
        var inheritance;
        if (forced) {
          inheritance = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
          var available = [0, 1, 2, 3, 4, 5];
          var fk = STAT_ID_TO_KEY[forced.stat];
          ivs[fk] = parents[forced.parent][fk];
          inheritance[fk] = forced.parent + 1;
          available.splice(forced.stat, 1);
          for (var q = 0; q < 2; q++) {
            var stat = available[inh[q]];
            var key = STAT_ID_TO_KEY[stat];
            ivs[key] = parents[par[q]][key];
            inheritance[key] = par[q] + 1;
            available.splice(inh[q], 1);
          }
        } else {
          inheritance = inherit(ivs, parents, inh, par, hgss ? "index" : "fixed");
        }
        out.push(buildResult(start + cnt, st.pid, ivs, 1, st.species, tid, sid, {
          advances: st.advances, pickupAdvances: start + cnt, inheritance: inheritance, inheritanceArray: ivArray(inheritance),
          everstoneInherited: !!st.everstoneInherited,
          call: prng % 3, chatot: ((prng % 8192) * 100) >> 13, callsUsed: go.calls
        }));
      }
    }
    out.sort(function (a, b) { return a.advances - b.advances || a.pickupAdvances - b.pickupAdvances; });
    return applyFilter(out, o.filter);
  }

  function gen4Egg(o) {
    var held = gen4EggHeld(o.seed, o);
    return gen4EggPickup(o.seedPickup, held, o);
  }

  // ================================================================ rarity and reachability
  function jumpParams(k) {
    var mult = 1, add = 0;
    for (var i = 0; i < k; i++) { add = u32(Math.imul(mult, ADD) + add); mult = u32(Math.imul(mult, MULT)); }
    return { mult: mult, add: add };
  }
  var HIST_CACHE = {};
  // h_k[v] = #{t in [0,65536): hi16((a_k*t + c_k) mod 2^32) == v}
  function hist(k) {
    if (HIST_CACHE[k]) return HIST_CACHE[k];
    var p = jumpParams(k);
    var h = new Uint32Array(65536);
    for (var t = 0; t < 65536; t++) h[u32(Math.imul(p.mult, t) + p.add) >>> 16]++;
    HIST_CACHE[k] = h;
    return h;
  }
  function wordMatches(w, keys, mn, mx) {
    var v = [w & 31, (w >> 5) & 31, (w >> 10) & 31];
    for (var i = 0; i < 3; i++) {
      var k = keys[i];
      if (mn && mn[k] !== undefined && mn[k] !== null && v[i] < mn[k]) return false;
      if (mx && mx[k] !== undefined && mx[k] !== null && v[i] > mx[k]) return false;
    }
    return true;
  }
  // Exact number of LCRNG states s (2^32 of them) whose IV words (hi16(s), hi16(jump(s, k))) pass the
  // filter; k = 1 for Method 1/2/J/K, 2 for Method 4. Cost is |A| x |B| (matching words per half).
  function countIvStates(filter, method) {
    var k = (method || "M1").toUpperCase() === "M4" ? 2 : 1;
    var p = jumpParams(k);
    var h = hist(k);
    var f = filter || {};
    var mn = toIvObject(f.ivMin, 0), mx = toIvObject(f.ivMax, 31);
    if (f.minIv) { mn = mn || {}; for (var i = 0; i < 6; i++) if (mn[IV_ORDER[i]] === undefined || mn[IV_ORDER[i]] < f.minIv) mn[IV_ORDER[i]] = f.minIv; }
    var A = [], B = [];
    for (var w = 0; w < 65536; w++) {
      if (wordMatches(w, ["hp", "atk", "def"], mn, mx)) A.push(w);
      if (wordMatches(w, ["spe", "spa", "spd"], mn, mx)) B.push(w);
    }
    var hpTypes = f.hpTypes && f.hpTypes.length ? f.hpTypes : null;
    var hpPowerMin = f.hpPowerMin || 0;
    var total = 0;
    for (var a = 0; a < A.length; a++) {
      var X = u32(Math.imul(p.mult, A[a])) & 0xffff;
      for (var b = 0; b < B.length; b++) {
        if (hpTypes || hpPowerMin) {
          var hp = hiddenPower(ivsFromWords(A[a], B[b]));
          if (hpTypes && hpTypes.indexOf(hp.index) < 0) continue;
          if (hp.power < hpPowerMin) continue;
        }
        total += h[(B[b] - X) & 0xffff];
      }
    }
    return { count: total, per100k: total / 4294967296 * 100000, pairs: A.length * B.length };
  }

  // All states s whose word pair passes `pred(ivs)`; `wordPred(v3)` (v3 = the three IVs of one word)
  // narrows both halves before the 65536-state inner loop.
  function listIvStates(filter, method, pred, wordPred) {
    var k = (method || "M1").toUpperCase() === "M4" ? 2 : 1;
    var p = jumpParams(k);
    var f = filter || {};
    var mn = toIvObject(f.ivMin, 0), mx = toIvObject(f.ivMax, 31);
    if (f.minIv) { mn = mn || {}; for (var i = 0; i < 6; i++) if (mn[IV_ORDER[i]] === undefined || mn[IV_ORDER[i]] < f.minIv) mn[IV_ORDER[i]] = f.minIv; }
    var states = [];
    var wp = function (w) { return !wordPred || wordPred([w & 31, (w >> 5) & 31, (w >> 10) & 31]); };
    for (var w1 = 0; w1 < 65536; w1++) {
      if (!wordMatches(w1, ["hp", "atk", "def"], mn, mx) || !wp(w1)) continue;
      for (var t = 0; t < 65536; t++) {
        var s = u32((w1 << 16) | t);
        var w2 = u32(Math.imul(p.mult, s) + p.add) >>> 16;
        if (!wordMatches(w2, ["spe", "spa", "spd"], mn, mx) || !wp(w2)) continue;
        var ivs = ivsFromWords(w1, w2);
        if (pred && !pred(ivs)) continue;
        states.push(s);
      }
    }
    return states;
  }

  // PID and nature for the IV1 state `s` under a method (M1/M4: PID hi is prev(s); M2: prev(prev(s))).
  function pidForIvState(s, method) {
    var m = (method || "M1").toUpperCase();
    var hiState = m === "M2" ? prev(prev(s)) : prev(s);
    var loState = prev(hiState);
    var pid = u32(((hiState >>> 16) << 16) | (loState >>> 16));
    return { pid: pid, nature: pid % 25, natureName: core.NATURES[pid % 25], psv: ((pid >>> 16) ^ (pid & 0xffff)) & 0xffff, seedState: prev(loState) };
  }

  function flawlessTable(method) {
    var m = (method || "M1").toUpperCase();
    var states = listIvStates({ minIv: 31 }, m);
    return states.map(function (s) {
      var p = pidForIvState(s, m);
      return { ivState: s, seedState: p.seedState, pid: p.pid, nature: p.nature, natureName: p.natureName, psv: p.psv };
    });
  }

  function fiveThirtyOneStates(method) {
    var m = (method || "M1").toUpperCase();
    return listIvStates(null, m, function (ivs) {
      var n = 0;
      for (var i = 0; i < 6; i++) if (ivs[IV_ORDER[i]] === 31) n++;
      return n === 5;
    }, function (v3) { return (v3[0] === 31) + (v3[1] === 31) + (v3[2] === 31) >= 2; });
  }

  // frame at which a Method 1/2/4 generation from `seed` uses `ivState` as its IV1 state
  function frameForIvState(seed, ivState, method) {
    var m = (method || "M1").toUpperCase();
    var callsBefore = m === "M2" ? 3 : 2; // outputs consumed before the IV1 output: PID lo, PID hi (+ skip)
    var d = lcrngDistance(seed, ivState);
    return d - callsBefore - 1;
  }

  // PKHeX LCRNGReversal.GetSeedsIVs (Legality/RNG/Algorithms/LCRNGReversal.cs:65-104): every state R
  // such that hi15(next(R)) = IV1 word and hi15(next(next(R))) = IV2 word (R is the PID-high state).
  var RV_LAG0 = 0x67d3, RV_LAG1 = 0xc907, RV_LOWER = 0x3443, RV_UPPER = 0xc34e;
  function seedsForIvWords(w1, w2) {
    var first = u32((w1 & 0x7fff) << 16);
    var second = u32((w2 & 0x7fff) << 16);
    var tmp = u32(Math.imul(u32(second - Math.imul(MULT, first)) >>> 16, RV_LAG1));
    var lo = u32(Math.imul(u32(tmp + RV_LOWER) >>> 15, RV_LAG0));
    var mi = u32(lo + RV_LAG0);
    var up = u32(Math.imul(u32(tmp + RV_UPPER) >>> 15, RV_LAG0));
    var out = [];
    function add(low) {
      low = low % RV_LAG1;
      do {
        var seed = u32(first | low);
        if ((next(seed) & 0x7fff0000) >>> 0 === second) {
          seed = prev(seed);
          out.push(seed);
          out.push(u32(seed ^ 0x80000000));
        }
        low += RV_LAG1;
      } while (low < 0x10000);
    }
    add(lo); add(mi); if (mi !== up) add(up);
    return out;
  }
  function seedsForIvs(ivs) {
    var w1 = ivs.hp | (ivs.atk << 5) | (ivs.def << 10);
    var w2 = ivs.spe | (ivs.spa << 5) | (ivs.spd << 10);
    return seedsForIvWords(w1, w2);
  }

  // Gen 4 reachability-first search: back-step each IV-origin state to the seed of frame N and keep
  // the seeds whose hour byte is a valid clock hour (0..23). Seed layout: core/gen4.js seed().
  function gen4SeedsForTarget(ivs, o) {
    var opt = o || {};
    var maxFrame = opt.maxFrame === undefined ? 100 : opt.maxFrame;
    var callsBefore = opt.callsBeforeIv1 === undefined ? 2 : opt.callsBeforeIv1; // Method 1: PID lo, PID hi
    var origins = seedsForIvs(ivs);
    var hits = [];
    for (var i = 0; i < origins.length; i++) {
      var s = origins[i];
      // origins are the PID-high states (next(R) is the IV1 word): frame 0's seed is callsBefore steps back
      for (var b = 0; b < callsBefore; b++) s = prev(s);
      for (var frame = 0; frame <= maxFrame; frame++) {
        var hour = (s >>> 16) & 0xff;
        if (hour <= 23) {
          hits.push({ seed: s, frame: frame, hour: hour, ab: s >>> 24, delayPlusYear: s & 0xffff, ivOrigin: origins[i] });
        }
        s = prev(s);
      }
    }
    hits.sort(function (a, b) { return a.frame - b.frame || a.seed - b.seed; });
    return hits;
  }

  return {
    Stream: Stream,
    prev: prev,
    arngNext: arngNext,
    lcrngDistance: lcrngDistance,
    IV_ORDER: IV_ORDER,
    HIDDEN_POWER_TYPES: HIDDEN_POWER_TYPES,
    ivsFromWords: ivsFromWords,
    ivArray: ivArray,
    genderOf: genderOf,
    hiddenPower: hiddenPower,
    shinyType: shinyType,
    unownLetter: unownLetter,
    abilityInfo: abilityInfo,
    buildResult: buildResult,
    monMatches: monMatches,
    applyFilter: applyFilter,
    normalizeLead: normalizeLead,
    hSlot: hSlot,
    jSlot: jSlot,
    kSlot: kSlot,
    DPPT_UNOWN_GROUPS: DPPT_UNOWN_GROUPS,
    HGSS_UNOWN_PUZZLES: HGSS_UNOWN_PUZZLES,
    gen3Static: gen3Static,
    gen3Wild: gen3Wild,
    gen3EggEmerald: gen3EggEmerald,
    gen3EggRSFRLG: gen3EggRSFRLG,
    EGG3_PRESETS: EGG3_PRESETS,
    gen4Static: gen4Static,
    gen4StarterTriple: gen4StarterTriple,
    gen4Wild: gen4Wild,
    radarShinyOdds: radarShinyOdds,
    GEN4_EVERSTONE_INHERIT_CHANCE: 32767 / 65536, // LCRNG_Next() < 0x7fff at trigger (daycare.c:336-341, get_egg.c:241,247)
    gen4EggHeld: gen4EggHeld,
    gen4EggPickup: gen4EggPickup,
    gen4Egg: gen4Egg,
    shinyPid: shinyPid,
    countIvStates: countIvStates,
    listIvStates: listIvStates,
    pidForIvState: pidForIvState,
    flawlessTable: flawlessTable,
    fiveThirtyOneStates: fiveThirtyOneStates,
    frameForIvState: frameForIvState,
    seedsForIvWords: seedsForIvWords,
    seedsForIvs: seedsForIvs,
    gen4SeedsForTarget: gen4SeedsForTarget
  };
});
