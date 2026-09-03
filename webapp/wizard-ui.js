// The wanted-IVs wizard tab (design section 5): a wanted Pokemon -> the (PID, IVs) states that satisfy
// the filter -> the frame from the game's fixed seed (Gen 3) or the seeds a DS clock can reach (Gen 4,
// reachability-first through core/seedtime4.js) -> the timer and the numbered procedure -> the typed
// outcome that calibrates the console. TARGET mode, human input only: every value is typed or picked and
// nothing reads a capture; every output names the seed model it runs under and that model's validation
// status, which today is EMPIRICAL / model output for every game (no hardware session).
//
// Loaded after core/generators.js, core/timers.js, mode.js and app.js (the Gen 4 two-phase countdown,
// app.js's Countdown, is reused as root.ShinyCountdown). Species, encounter and static tables are
// fetched lazily on first use as data/wizard-gen{3,4}.js (webapp/sync-core.sh writes them from
// core/data/*.json); the mobile bundle carries none of them and says so (docs/DATA.md).
(function (root) {
  var core = root.ShinyCore, gen4 = root.ShinyGen4, ST = root.ShinySeedTime4, G = root.ShinyGenerators, T = root.ShinyTimers, MODE = root.ShinyMode;
  var IV_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
  var IV_NAMES = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
  var STORE_KEY = "shinySolution.wizard.calibration";
  var NO_HARDWARE = "EMPIRICAL / model output: no hardware session has run this procedure. Every frame, time and delay here is the engine's prediction from the decompiled code; the typed outcome in the last step is what ties it to your console.";
  var STATUS_NO_SESSION = "EMPIRICAL / model output: no hardware session";

  function isNil(x) { return x === null || x === undefined; }
  function hex8(n) { var s = (n >>> 0).toString(16).toUpperCase(); while (s.length < 8) s = "0" + s; return s; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function f3(x) { return x.toFixed(3); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function ivText(ivs) { return IV_KEYS.map(function (k) { return ivs[k]; }).join("/"); }
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function nowStamp() {
    var d = new Date();
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
  }
  function fmtLong(ms) {
    if (ms > 48 * 3600000) return (ms / 86400000).toFixed(1) + " days";
    if (ms > 2 * 3600000) return (ms / 3600000).toFixed(1) + " hours";
    return core.fmtMs(ms);
  }
  function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
  function speciesName(rec) { return rec.name.charAt(0) + rec.name.slice(1).toLowerCase(); }

  // ---- games, consoles and seed models ----------------------------------------------------
  // The seed model is what stands in for a methodology id here: no Gen 3 / Gen 4 methodology registry
  // exists in core/data yet, so each model carries its id, its decomp source and its validation status.
  var SEED_MODELS = {
    "rs/gba/boot-seed-v0": {
      id: "rs/gba/boot-seed-v0", kind: "fixed", seed: 0x5a0,
      text: "Ruby / Sapphire with a dead battery: the seed is 0x5A0 at every boot (pokeruby/src/rtc.c:13,134-140), and the RNG advances once per frame from then on, so a frame is a time after power-on at the console's rate.",
      typed: "A live battery seeds from the RTC (a minute-based value): type that seed instead, or replace the battery so the dead-battery model applies.",
      status: "defined and emulator-verified (tests/harness on libmgba); " + STATUS_NO_SESSION + " (the power-on-to-press offset of a console is the calibration below)"
    },
    "emerald/gba/boot-seed-0-v0": {
      id: "emerald/gba/boot-seed-0-v0", kind: "fixed", seed: 0,
      text: "Emerald seeds 0 at boot (pokeemerald/src/main.c:108-110) and advances once per VBlank (main.c:365-366; twice per frame in battle), so a frame is a time after power-on at the console's rate.",
      typed: null,
      status: "decomp-derived; " + STATUS_NO_SESSION
    },
    "frlg/gba/typed-seed-v0": {
      id: "frlg/gba/typed-seed-v0", kind: "typed", seed: null,
      text: "FireRed / LeafGreen seed the RNG from a Timer1 count at the title-screen press (pokefirered/src/naming_screen.c:717-722 for the naming exit; the title press is the same kind of count): there is no fixed seed. Type the seed you already know (from a frame hit you identified, or a community seed table); without one this game is stated unavailable here.",
      typed: "the seed is typed",
      status: "seed model only; " + STATUS_NO_SESSION
    },
    "dppt/nds/seed-to-time-v0": {
      id: "dppt/nds/seed-to-time-v0", kind: "chosen",
      text: "Diamond / Pearl / Platinum: seed = ((month*day + minute + second) << 24) + (hour << 16) + (year - 2000) + delay (pokeplatinum/src/main.c:306-315), delay = VBlanks since boot. The wizard back-steps the wanted IVs to a seed a clock can produce (the hour byte must be 0-23) and lists the date, time and delay that reach it (core/seedtime4.js).",
      status: "PokeFinder's seed-to-time and reversal data bit for bit; EMPIRICAL / model output: no DS session has landed a seed chosen by this tool (the hardware gate)"
    },
    "hgss/nds/seed-to-time-v0": {
      id: "hgss/nds/seed-to-time-v0", kind: "chosen",
      text: "HeartGold / SoulSilver: the same seed formula (pokeheartgold/src/main.c:281-284 with include/gf_rtc.h:46-51), the same back-step; Elm's calls verify the seed (phone_scripts_prof_elm.c:59,84,86), and the roamers' re-roll on continue is counted when you say which roam.",
      status: "PokeFinder's seed-to-time and reversal data bit for bit; EMPIRICAL / model output: no DS session has landed a seed chosen by this tool (the hardware gate)"
    }
  };
  var GAMES = {
    ruby: { key: "ruby", name: "Ruby", gen: 3, family: "rs", model: "rs/gba/boot-seed-v0" },
    sapphire: { key: "sapphire", name: "Sapphire", gen: 3, family: "rs", model: "rs/gba/boot-seed-v0" },
    emerald: { key: "emerald", name: "Emerald", gen: 3, family: "e", model: "emerald/gba/boot-seed-0-v0" },
    firered: { key: "firered", name: "FireRed", gen: 3, family: "frlg", model: "frlg/gba/typed-seed-v0" },
    leafgreen: { key: "leafgreen", name: "LeafGreen", gen: 3, family: "frlg", model: "frlg/gba/typed-seed-v0" },
    diamond: { key: "diamond", name: "Diamond", gen: 4, family: "dppt", method: "J", model: "dppt/nds/seed-to-time-v0" },
    pearl: { key: "pearl", name: "Pearl", gen: 4, family: "dppt", method: "J", model: "dppt/nds/seed-to-time-v0" },
    platinum: { key: "platinum", name: "Platinum", gen: 4, family: "dppt", method: "J", model: "dppt/nds/seed-to-time-v0" },
    heartgold: { key: "heartgold", name: "HeartGold", gen: 4, family: "hgss", method: "K", model: "hgss/nds/seed-to-time-v0" },
    soulsilver: { key: "soulsilver", name: "SoulSilver", gen: 4, family: "hgss", method: "K", model: "hgss/nds/seed-to-time-v0" }
  };
  var GAME_ORDER = ["ruby", "sapphire", "emerald", "firered", "leafgreen", "diamond", "pearl", "platinum", "heartgold", "soulsilver"];
  var CONSOLES = {
    GBA: { key: "GBA", gen: 3, name: "GBA / GBA SP / Game Boy Player (59.7275 fps)" },
    NDS_SLOT2: { key: "NDS_SLOT2", gen: 3, name: "DS slot-2, a GBA cartridge in a DS (59.6555 fps)" },
    NDS_SLOT1: { key: "NDS_SLOT1", gen: 4, name: "DS / DS Lite (59.8261 fps)" },
    DSI: { key: "DSI", gen: 4, name: "DSi / 3DS (59.8261 fps)" }
  };
  function consolesFor(gameKey) {
    var gen = GAMES[gameKey].gen;
    return Object.keys(CONSOLES).filter(function (k) { return CONSOLES[k].gen === gen; }).map(function (k) { return CONSOLES[k]; });
  }
  function fpsOf(consoleKey) { return T.fps({ console: consoleKey }); }
  function frameToMs(frame, consoleKey) { return frame * 1000 / fpsOf(consoleKey); }
  function modelOf(gameKey) { return SEED_MODELS[GAMES[gameKey].model]; }

  // ---- data (core/data/{species,encounters,statics}-gen{3,4}.json) ---------------------------
  var DATA = { 3: null, 4: null };
  var SPECIES_BY_DEX = { 3: null, 4: null };
  function setData(gen, d) {
    if (!d || !d.species || !d.encounters || !d.statics) throw new Error("wizard data for Gen " + gen + " needs {species, encounters, statics}");
    DATA[gen] = d;
    var m = {};
    d.species.species.forEach(function (s) { m[s.dex] = s; });
    SPECIES_BY_DEX[gen] = m;
  }
  function hasData(gen) { return !!DATA[gen]; }
  function dataFor(gen) {
    if (!DATA[gen]) throw new Error("the Gen " + gen + " species, encounter and static tables are not loaded");
    return DATA[gen];
  }
  function speciesRec(gen, dex) {
    var r = dataFor(gen) && SPECIES_BY_DEX[gen][dex];
    if (!r) throw new Error("no species record for dex " + dex + " in Gen " + gen);
    return r;
  }

  // ---- statics ---------------------------------------------------------------------------
  var M1_CATEGORIES = { starter: 1, fossil: 1, gift: 1, game_corner: 1, roamer: 1, event: 1 };
  function staticMethod(game, e) {
    var m = (e.creation || "").match(/Method (1|J|K)/);
    if (m) return m[1] === "1" ? "M1" : m[1];
    if (game.gen === 3) return "M1";
    // D/P rows carry PokeFinder provenance and no call chain: the category decides, as for their Platinum twins
    if (M1_CATEGORIES[e.category]) return "M1";
    return game.method;
  }
  function staticEntries(gameKey) {
    var game = GAMES[gameKey];
    var d = dataFor(game.gen);
    var out = [];
    d.statics.entries.forEach(function (e) {
      if (e.games.indexOf(gameKey) === -1) return;
      var refused = null;
      if (e.category === "egg") refused = "an egg: its PID is split between the trigger and the pickup (design 5.3); the egg generators are engine-only here";
      else if (e.shiny === "never") refused = "not RNG-manipulable: " + (e.notes || "its personality is fixed");
      else if (e.catchable === false) refused = "not catchable";
      var shinyMode = e.shiny === "always" ? "always" : e.shiny === "never" ? "never" : "random";
      var method = e.id === "hgss/static/gyarados" || e.id === "gen4/event/manaphy-egg" ? "M1" : staticMethod(game, e);
      var bugged = game.gen === 3 && e.category === "roamer" && game.family !== "e";
      out.push({
        id: e.id, entry: e, category: e.category, species: speciesRec(game.gen, e.species), level: e.level, method: method, shinyMode: shinyMode,
        buggedRoamer: bugged, refused: refused, provenance: e.provenance, levelVerified: e.level_verified_against_decomp,
        label: speciesName(speciesRec(game.gen, e.species)) + " L" + e.level + " - " + e.location + " [" + e.category + ", " + (method === "M1" ? "Method 1" : "Method " + method) + (bugged ? ", roamer IV bug" : "") + (shinyMode !== "random" ? ", shiny " + shinyMode : "") + "]"
      });
    });
    return out;
  }

  // ---- wild tables ------------------------------------------------------------------------
  var KIND_NAMES = { grass: "grass / cave (land)", surf: "surfing", rock_smash: "Rock Smash", old_rod: "Old Rod", good_rod: "Good Rod", super_rod: "Super Rod" };
  function wildTables(gameKey) {
    var game = GAMES[gameKey];
    var d = dataFor(game.gen);
    var out = [];
    if (game.gen === 3) {
      d.encounters.games[gameKey].maps.forEach(function (m) {
        var kinds = [];
        if (m.land) kinds.push("grass");
        if (m.water) kinds.push("surf");
        if (m.rock_smash) kinds.push("rock_smash");
        if (m.fishing) { kinds.push("old_rod"); kinds.push("good_rod"); kinds.push("super_rod"); }
        if (kinds.length) out.push({ index: m.index, name: m.name + " (" + m.map + ")", kinds: kinds, tanoby: !!(m.land && m.land.unown_letter_ids) });
      });
    } else {
      d.encounters.games[gameKey].tables.forEach(function (t) {
        var kinds = [];
        if (game.family === "dppt") { if (t.grass) kinds.push("grass"); }
        else if (t.land) kinds.push("grass");
        if (t.surf) kinds.push("surf");
        if (game.family === "hgss" && t.rock_smash) kinds.push("rock_smash");
        if (t.old_rod) kinds.push("old_rod");
        if (t.good_rod) kinds.push("good_rod");
        if (t.super_rod) kinds.push("super_rod");
        if (kinds.length) out.push({ index: t.index, name: (t.names || [t.table]).join(" / ") + " (" + t.table + ")", kinds: kinds });
      });
    }
    return out;
  }
  function tableRecord(gameKey, index) {
    var game = GAMES[gameKey];
    var d = dataFor(game.gen);
    var list = game.gen === 3 ? d.encounters.games[gameKey].maps : d.encounters.games[gameKey].tables;
    for (var i = 0; i < list.length; i++) if (list[i].index === index) return list[i];
    throw new Error("no encounter table " + index + " in " + gameKey);
  }
  function slot3(gen, s, form) { return { species: speciesRec(gen, s.species), minLevel: s.min_level, maxLevel: s.max_level, form: form || 0 }; }
  // opts.time: "morning" | "day" | "night" (Gen 4 land; DPPt's day / night lists replace slots 2 and 3, morning is the base table)
  function slotsFor(gameKey, index, kind, opts) {
    var game = GAMES[gameKey];
    var o = opts || {};
    var t = tableRecord(gameKey, index);
    var slots = [], rate = 0, note = null;
    if (game.gen === 3) {
      if (kind === "grass") {
        if (!t.land) throw new Error("no land table");
        rate = t.land.rate;
        slots = t.land.slots.map(function (s, i) { return slot3(3, s, t.land.unown_letter_ids ? t.land.unown_letter_ids[i] : 0); });
        if (t.land.unown_letter_ids) note = "Tanoby chamber: the Unown letter is fixed per slot and the PID loop rolls until it matches";
      } else if (kind === "surf") { rate = t.water.rate; slots = t.water.slots.map(function (s) { return slot3(3, s); }); }
      else if (kind === "rock_smash") { rate = t.rock_smash.rate; slots = t.rock_smash.slots.map(function (s) { return slot3(3, s); }); }
      else { rate = t.fishing.rate; slots = t.fishing[kind].map(function (s) { return slot3(3, s); }); }
    } else if (game.family === "dppt") {
      if (kind === "grass") {
        if (!t.grass) throw new Error("no land table");
        rate = t.grass.rate;
        slots = t.grass.slots.map(function (s) { return { species: speciesRec(4, s.species), minLevel: s.level, maxLevel: s.level, form: 0 }; });
        var repl = o.time === "day" ? t.day : o.time === "night" ? t.night : null;
        if (repl) [2, 3].forEach(function (si, j) { if (repl[j] && repl[j].species) slots[si].species = speciesRec(4, repl[j].species); });
      } else { rate = t[kind].rate; slots = t[kind].slots.map(function (s) { return slot3(4, s); }); }
    } else {
      if (kind === "grass") {
        if (!t.land) throw new Error("no land table");
        rate = t.land.rate;
        var time = o.time === "morning" || o.time === "night" ? o.time : "day";
        slots = t.land.slots.map(function (s) { return { species: speciesRec(4, s[time].species), minLevel: s.level, maxLevel: s.level, form: 0 }; });
      } else { rate = t[kind].rate; slots = t[kind].slots.map(function (s) { return slot3(4, s); }); }
    }
    return { slots: slots, rate: rate, note: note, tanoby: game.gen === 3 && kind === "grass" && !!(t.land && t.land.unown_letter_ids) };
  }
  function speciesInSlots(slots) {
    var seen = {}, out = [];
    slots.forEach(function (s, i) {
      var d = s.species.dex;
      if (!seen[d]) { seen[d] = { species: s.species, slots: [], levels: [] }; out.push(seen[d]); }
      seen[d].slots.push(i);
      seen[d].levels.push(s.minLevel === s.maxLevel ? "" + s.minLevel : s.minLevel + "-" + s.maxLevel);
    });
    return out;
  }
  // The share of the slot roll that lands on the species (docs/DATA.md slot rates), for the feasibility estimate.
  var SLOT_RATES = {
    grass: [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1], surf: [60, 30, 5, 4, 1], rock_smash3: [60, 30, 5, 4, 1], rock_smash4: [80, 20],
    old_rod3: [70, 30], good_rod3: [60, 20, 20], super_rod3: [40, 40, 15, 4, 1],
    old_rod_j: [60, 30, 5, 4, 1], good_rod_j: [40, 40, 15, 4, 1], super_rod_j: [40, 40, 15, 4, 1], rod_k: [40, 30, 15, 10, 5]
  };
  function slotRates(gameKey, kind) {
    var game = GAMES[gameKey];
    if (kind === "grass" || kind === "surf") return SLOT_RATES[kind];
    if (kind === "rock_smash") return game.gen === 3 ? SLOT_RATES.rock_smash3 : SLOT_RATES.rock_smash4;
    if (game.gen === 3) return SLOT_RATES[kind + "3"];
    if (game.family === "dppt") return SLOT_RATES[kind + "_j"];
    return SLOT_RATES.rod_k;
  }
  function speciesShare(gameKey, kind, slots, dex) {
    var rates = slotRates(gameKey, kind), sum = 0;
    for (var i = 0; i < slots.length && i < rates.length; i++) if (slots[i].species.dex === dex) sum += rates[i];
    return sum / 100;
  }

  // ---- leads -------------------------------------------------------------------------------
  var LEADS = {
    e: [
      { key: "", name: "no lead effect" },
      { key: "SYNCHRONIZE", name: "Synchronize (nature)" }, { key: "CUTE_CHARM", name: "Cute Charm (gender)" },
      { key: "MAGNET_PULL", name: "Magnet Pull (Steel slots, land)" }, { key: "STATIC", name: "Static (Electric slots, land and surf)" },
      { key: "PRESSURE", name: "Pressure / Hustle / Vital Spirit (level)" }, { key: "KEEN_EYE", name: "Keen Eye / Intimidate (level suppression)" }
    ],
    rs: [{ key: "", name: "no lead effect (Ruby / Sapphire have none: pokeruby/src/wild_encounter.c:271-312)" }],
    frlg: [{ key: "", name: "no lead effect (FireRed / LeafGreen roll the nature directly: pokefirered/src/wild_encounter.c:226-240)" }],
    gen4wild: [
      { key: "", name: "no lead effect" }, { key: "SYNCHRONIZE", name: "Synchronize (nature)" },
      { key: "MAGNET_PULL", name: "Magnet Pull (Steel slots)" }, { key: "STATIC", name: "Static (Electric slots)" },
      { key: "PRESSURE", name: "Pressure / Hustle / Vital Spirit (level)" }
    ],
    gen4static: [{ key: "", name: "no lead effect" }, { key: "SYNCHRONIZE", name: "Synchronize (nature)" }]
  };
  var GEN4_CUTE_CHARM_NOTE = "Cute Charm is not offered for Gen 4: when it procs the PID is arithmetic (pokeplatinum/src/pokemon.c:505-545), not the two LCRNG outputs before the IVs, so the IV back-step no longer reaches the PID";
  function leadOptions(gameKey, kind) {
    var game = GAMES[gameKey];
    if (game.gen === 3) return kind === "static" ? [LEADS.rs[0]] : LEADS[game.family];
    return kind === "static" ? LEADS.gen4static : LEADS.gen4wild;
  }
  function makeLead(key, nature, gender, level) {
    if (!key) return null;
    var l = { ability: key };
    if (key === "SYNCHRONIZE") l.nature = nature;
    if (key === "CUTE_CHARM") l.gender = gender;
    if (key === "KEEN_EYE") l.level = level;
    return l;
  }

  // ---- the filter ----------------------------------------------------------------------------
  // wanted: { ivMin: {hp..spe}, ivMax: {..}, nature: 0..24 | null, gender: "M" | "F" | null, ability: 0 | 1 | null,
  //           shiny: bool, tid, sid, species: dex | null }
  function checkIvRange(w) {
    var mn = {}, mx = {};
    IV_KEYS.forEach(function (k) {
      var a = isNil(w.ivMin) || isNil(w.ivMin[k]) ? 0 : w.ivMin[k];
      var b = isNil(w.ivMax) || isNil(w.ivMax[k]) ? 31 : w.ivMax[k];
      if (a !== Math.floor(a) || b !== Math.floor(b) || a < 0 || b > 31 || a > b) throw new Error(IV_NAMES[k] + " IV range must be whole numbers 0..31 with min <= max, got " + a + ".." + b);
      mn[k] = a; mx[k] = b;
    });
    return { ivMin: mn, ivMax: mx };
  }
  function buildFilter(w) {
    var r = checkIvRange(w);
    var f = { ivMin: r.ivMin, ivMax: r.ivMax, validOnly: true };
    if (!isNil(w.nature)) f.natures = [w.nature];
    if (w.gender === "M" || w.gender === "F") f.gender = w.gender;
    if (w.ability === 0 || w.ability === 1) f.ability = w.ability;
    if (w.shiny) {
      if (isNil(w.tid) || isNil(w.sid)) throw new Error("a shiny target needs your Trainer ID and Secret ID typed (the Trainer Card, and the Secret ID from the Gen 1 TID tab's Emerald / FRLG branch or a known shiny)");
      f.shiny = true;
    }
    if (!isNil(w.species)) f.species = [w.species];
    return f;
  }
  function ivCombos(f, cap) {
    var n = 1;
    IV_KEYS.forEach(function (k) { n *= f.ivMax[k] - f.ivMin[k] + 1; });
    if (n > cap) return { count: n, combos: null };
    var combos = [];
    (function rec(i, cur) {
      if (i === 6) { combos.push({ hp: cur.hp, atk: cur.atk, def: cur.def, spa: cur.spa, spd: cur.spd, spe: cur.spe }); return; }
      var k = IV_KEYS[i];
      for (var v = f.ivMin[k]; v <= f.ivMax[k]; v++) { cur[k] = v; rec(i + 1, cur); }
    })(0, {});
    return { count: n, combos: combos };
  }
  function wordCount(mn, mx, keys) {
    var n = 0;
    for (var w = 0; w < 65536; w++) {
      var v = [w & 31, (w >> 5) & 31, (w >> 10) & 31], ok = true;
      for (var i = 0; i < 3 && ok; i++) if (v[i] < mn[keys[i]] || v[i] > mx[keys[i]]) ok = false;
      if (ok) n++;
    }
    return n;
  }
  function pidPasses(pid, f, species, tid, sid) {
    if (f.natures && f.natures.indexOf(pid % 25) < 0) return false;
    if (f.gender) { var g = f.gender === "F" ? 1 : 0; if (G.genderOf(pid, species.gender_ratio) !== g) return false; }
    if (!isNil(f.ability) && (pid & 1) !== f.ability) return false;
    if (f.shiny && !core.isShiny(pid, tid, sid)) return false;
    return true;
  }

  // ---- feasibility (design 5.1 step 5) ----------------------------------------------------------
  // The IV part is the exact count of LCRNG states whose two IV words pass (core/generators.js countIvStates, the
  // 2^32 cycle) when the matching-word product is affordable, else the independent-uniform estimate; the nature,
  // gender, ability, shiny and slot shares multiply in as independent odds (an estimate: the PID and the IV
  // words are consecutive outputs, not independent draws).
  function feasibility(f, method, species, share) {
    var a = wordCount(f.ivMin, f.ivMax, ["hp", "atk", "def"]);
    var b = wordCount(f.ivMin, f.ivMax, ["spe", "spa", "spd"]);
    var exact = a * b <= 4000000;
    var ivPer100k;
    if (exact) ivPer100k = G.countIvStates({ ivMin: f.ivMin, ivMax: f.ivMax }, method).per100k;
    else { var p = 1; IV_KEYS.forEach(function (k) { p *= (f.ivMax[k] - f.ivMin[k] + 1) / 32; }); ivPer100k = p * 100000; }
    var odds = 1;
    var parts = [];
    if (f.natures) { odds *= f.natures.length / 25; parts.push("nature 1/25"); }
    if (f.gender && species) {
      var pf = species.gender_ratio === 255 ? 0 : species.gender_ratio === 254 ? 1 : species.gender_ratio === 0 ? 0 : species.gender_ratio / 256;
      var pg = f.gender === "F" ? pf : 1 - pf;
      odds *= pg; parts.push("gender " + f1(100 * pg) + " %");
    }
    if (!isNil(f.ability)) { odds *= 0.5; parts.push("ability 1/2"); }
    if (f.shiny) { odds *= 8 / 65536; parts.push("shiny 8/65536"); }
    if (!isNil(share) && share !== 1) { odds *= share; parts.push("slot share " + f1(100 * share) + " %"); }
    var per100k = ivPer100k * odds;
    return { ivPer100k: ivPer100k, ivExact: exact, wordsA: a, wordsB: b, odds: odds, parts: parts, per100k: per100k,
      expectedFrames: per100k > 0 ? 100000 / per100k : Infinity };
  }
  function feasibilityLines(fs, consoleKey) {
    var lines = [];
    lines.push("Feasibility: about " + (fs.per100k >= 100 ? Math.round(fs.per100k) : fs.per100k.toPrecision(3)) + " matching frames per 100,000 (" +
      (fs.ivExact ? "IV count exact over the 2^32 LCRNG cycle: " + fs.ivPer100k.toPrecision(4) + " per 100,000" : "IV part estimated as independent uniform draws: " + fs.ivPer100k.toPrecision(4) + " per 100,000") +
      (fs.parts.length ? "; x " + fs.parts.join(" x ") : "") + ").");
    if (fs.expectedFrames !== Infinity) lines.push("  Expected first hit near frame " + Math.round(fs.expectedFrames) + (consoleKey ? " (" + fmtLong(frameToMs(fs.expectedFrames, consoleKey)) + " at " + fpsOf(consoleKey).toFixed(4) + " fps)" : "") + " on average.");
    else lines.push("  No state can match: the filter is empty.");
    return lines;
  }

  // ---- Gen 3: the forward search from the fixed (or typed) seed ----------------------------------------
  // cfg: { game, console, seed, kind: "static" | "wild", method: "M1" | "M2" | "M4", species (static), level (static),
  //        buggedRoamer, shinyMode, slots, encounter, rate, lead, options, wanted, maxFrame, limit }
  function gen3Args(cfg, f, frameStart, frameCount) {
    var a = { frameStart: frameStart, frameCount: frameCount, method: cfg.method || "M1", tid: cfg.wanted.tid || 0, sid: cfg.wanted.sid || 0, filter: f };
    if (cfg.kind === "static") { a.species = cfg.species; a.level = cfg.level; a.buggedRoamer = !!cfg.buggedRoamer; }
    else { a.game = cfg.game; a.encounter = cfg.encounter; a.slots = cfg.slots; a.rate = cfg.rate; a.lead = cfg.lead || null; a.options = cfg.options || {}; }
    return a;
  }
  function gen3Run(cfg, f, frameStart, frameCount) {
    var a = gen3Args(cfg, f, frameStart, frameCount);
    return cfg.kind === "static" ? G.gen3Static(cfg.seed, a) : G.gen3Wild(cfg.seed, a);
  }
  function searchGen3(cfg) {
    var game = GAMES[cfg.game];
    if (game.gen !== 3) throw new Error("searchGen3 is for Gen 3 games");
    if (isNil(cfg.seed)) throw new Error("no seed: " + modelOf(cfg.game).text);
    var f = buildFilter(cfg.wanted);
    if (cfg.kind === "static") delete f.species;
    var maxFrame = Math.max(0, Math.floor(cfg.maxFrame));
    var limit = cfg.limit || 20;
    var hits = [];
    var chunk = 16384;
    for (var frame = 0; frame <= maxFrame && hits.length < limit; frame += chunk) {
      var count = Math.min(chunk, maxFrame - frame + 1);
      var res = gen3Run(cfg, f, frame, count);
      for (var i = 0; i < res.length && hits.length < limit; i++) hits.push(res[i]);
    }
    var share = cfg.kind === "wild" && !isNil(cfg.wanted.species) ? speciesShare(cfg.game, cfg.encounter, cfg.slots, cfg.wanted.species) : 1;
    var species = cfg.kind === "static" ? cfg.species : (isNil(cfg.wanted.species) ? null : speciesRec(3, cfg.wanted.species));
    var fs = feasibility(f, cfg.method || "M1", species, share);
    var out = { hits: hits, maxFrame: maxFrame, limit: limit, feasibility: fs, exactFirst: null, model: modelOf(cfg.game).id };
    // statics: the exact first frame of the IV part over the whole cycle when the matching word 1 set is small
    if (cfg.kind === "static" && fs.wordsA <= 128 && !cfg.buggedRoamer) {
      var method = (cfg.method || "M1").toUpperCase();
      var states = G.listIvStates({ ivMin: f.ivMin, ivMax: f.ivMax }, method);
      var best = null;
      for (var s = 0; s < states.length; s++) {
        var p = G.pidForIvState(states[s], method);
        if (!pidPasses(p.pid, f, cfg.species, cfg.wanted.tid || 0, cfg.wanted.sid || 0)) continue;
        var fr = G.frameForIvState(cfg.seed, states[s], method);
        if (best === null || fr < best.frame) best = { frame: fr, pid: p.pid, state: states[s] };
      }
      out.exactFirst = { states: states.length, first: best };
    }
    return out;
  }
  function gen3SearchLines(r, cfg) {
    var lines = [];
    var model = modelOf(cfg.game);
    lines.push("Seed model: " + model.id + " (" + model.status + "); seed " + hex8(cfg.seed) + ", frames counted from the seed at " + fpsOf(cfg.console).toFixed(4) + " fps.");
    if (r.hits.length) {
      lines.push(r.hits.length + (r.hits.length >= r.limit ? " (the first " + r.limit + ")" : "") + " matching frame" + (r.hits.length === 1 ? "" : "s") + " within the first " + r.maxFrame + " frames (" + core.fmtMs(frameToMs(r.maxFrame, cfg.console)) + "); the first at frame " + r.hits[0].frame + " = " + core.fmtMs(frameToMs(r.hits[0].frame, cfg.console)) + " after the seed.");
    } else {
      lines.push("No matching frame within the first " + r.maxFrame + " frames (" + core.fmtMs(frameToMs(r.maxFrame, cfg.console)) + "): the honest limit of this seed model is stated, not promised away.");
    }
    lines = lines.concat(feasibilityLines(r.feasibility, cfg.console));
    if (r.exactFirst) {
      if (r.exactFirst.first) {
        var fr = r.exactFirst.first.frame;
        var ms = frameToMs(fr, cfg.console);
        lines.push("  Exact over the whole cycle: " + r.exactFirst.states + " IV state" + (r.exactFirst.states === 1 ? "" : "s") + " pass the IV ranges; the first one that also passes the PID filter is frame " + fr + " from this seed = " + fmtLong(ms) + " (PID " + hex8(r.exactFirst.first.pid) + ").");
      } else lines.push("  Exact over the whole cycle: " + r.exactFirst.states + " IV state" + (r.exactFirst.states === 1 ? "" : "s") + " pass the IV ranges and none passes the PID filter: this combination never occurs from any seed.");
    }
    return lines;
  }

  // ---- Gen 4: reachability first (design 5.3), then the generator verifies every candidate ----------------
  // cfg: { game, console, kind, staticMethod ("M1" | "J" | "K"), species, level, shinyMode, slots, encounter, rate, lead, options,
  //        wanted, maxFrame, yearMin, yearMax, delayMin, delayMax, targetDelay, limit }
  var GEN4_COMBO_CAP = { M1: 4096, JK: 512 };
  var GEN4_WILD_LOOKBACK = 800; // calls a wild or J/K creation may spend before its IV words (slot, level, nature, the PID loop)
  function gen4Args(cfg, f, frameStart, frameCount) {
    var a = { frameStart: frameStart, frameCount: frameCount, tid: cfg.wanted.tid || 0, sid: cfg.wanted.sid || 0, filter: f, lead: cfg.lead || null };
    if (cfg.kind === "static") { a.method = cfg.staticMethod || "M1"; a.species = cfg.species; a.level = cfg.level; a.shiny = cfg.shinyMode || "random"; }
    else { a.game = cfg.game; a.method = GAMES[cfg.game].method; a.encounter = cfg.encounter; a.slots = cfg.slots; a.rate = cfg.rate; a.options = cfg.options || {}; }
    return a;
  }
  function gen4Run(seed, cfg, f, frameStart, frameCount) {
    var a = gen4Args(cfg, f, frameStart, frameCount);
    return cfg.kind === "static" ? G.gen4Static(seed, a) : G.gen4Wild(seed, a);
  }
  function searchGen4(cfg) {
    var game = GAMES[cfg.game];
    if (game.gen !== 4) throw new Error("searchGen4 is for Gen 4 games");
    var f = buildFilter(cfg.wanted);
    if (cfg.kind === "static") delete f.species;
    var method1 = cfg.kind === "static" && (cfg.staticMethod || "M1") === "M1";
    var cap = method1 ? GEN4_COMBO_CAP.M1 : GEN4_COMBO_CAP.JK;
    var combos = ivCombos(f, cap);
    if (!combos.combos) return { error: "the IV ranges span " + combos.count + " combinations; the Gen 4 search reverses each exact IV set to its seeds, so narrow the ranges to at most " + cap + " combinations" + (method1 ? "" : " (Method J / K creations are verified frame by frame)"), count: combos.count };
    var maxFrame = Math.max(0, Math.floor(cfg.maxFrame));
    var species = cfg.kind === "static" ? cfg.species : (isNil(cfg.wanted.species) ? null : speciesRec(4, cfg.wanted.species));
    var tid = cfg.wanted.tid || 0, sid = cfg.wanted.sid || 0;
    var shinyMode = cfg.kind === "static" ? (cfg.shinyMode || "random") : "random";
    var prefilter = shinyMode === "random" && !(cfg.lead && cfg.lead.ability === "SYNCHRONIZE");
    var origins = [];
    combos.combos.forEach(function (ivs) {
      ST.ivsToSeeds(ivs.hp, ivs.atk, ivs.def, ivs.spa, ivs.spd, ivs.spe).forEach(function (s2) {
        if (prefilter && species) {
          var pid = ((s2 >>> 16) << 16 | (ST.prev(s2) >>> 16)) >>> 0;
          if (!pidPasses(pid, f, species, tid, sid)) return;
        }
        origins.push(s2);
      });
    });
    var callsBefore = shinyMode === "always" ? 15 : 2;
    var lookback = method1 ? 0 : GEN4_WILD_LOOKBACK;
    var cands = ST.reachableSeeds(origins, { callsBefore: callsBefore, maxFrame: maxFrame + lookback });
    var seen = {}, verified = [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var lo, count;
      if (method1) { lo = c.frame; count = 1; }
      else { lo = Math.max(0, c.frame - lookback); count = Math.min(maxFrame, c.frame) - lo + 1; }
      if (count <= 0) continue;
      var res = gen4Run(c.seed, cfg, f, lo, count);
      for (var j = 0; j < res.length; j++) {
        var key = hex8(c.seed) + ":" + res[j].frame;
        if (seen[key] || res[j].frame > maxFrame) continue;
        seen[key] = true;
        verified.push({ seed: c.seed, frame: res[j].frame, origin: c.origin, mon: res[j] });
      }
    }
    verified.sort(function (a, b) { return a.frame - b.frame || a.seed - b.seed; });
    var rows = ST.seedsToTimes(verified, {
      yearMin: cfg.yearMin, yearMax: cfg.yearMax, delayMin: cfg.delayMin, delayMax: cfg.delayMax, targetDelay: cfg.targetDelay,
      timesPerCandidate: cfg.timesPerCandidate || 2, yearsPerCandidate: 1
    });
    var byKey = {};
    verified.forEach(function (v) { byKey[hex8(v.seed) + ":" + v.frame] = v.mon; });
    var limit = cfg.limit || 30;
    var out = [];
    for (var r = 0; r < rows.length && out.length < limit; r++) {
      var row = rows[r];
      row.mon = byKey[hex8(row.seed) + ":" + row.frame];
      out.push(row);
    }
    var share = cfg.kind === "wild" && !isNil(cfg.wanted.species) ? speciesShare(cfg.game, cfg.encounter, cfg.slots, cfg.wanted.species) : 1;
    return { rows: out, combos: combos.count, origins: origins.length, candidates: cands.length, verified: verified.length, maxFrame: maxFrame,
      feasibility: feasibility(f, "M1", species, share), model: modelOf(cfg.game).id };
  }
  function gen4SearchLines(r, cfg) {
    var lines = [];
    var model = modelOf(cfg.game);
    if (r.error) { lines.push(r.error); return lines; }
    lines.push("Seed model: " + model.id + " (" + model.status + ").");
    lines.push(r.combos + " IV combination" + (r.combos === 1 ? "" : "s") + " -> " + plural(r.origins, "IV origin state") + " after the PID filter -> " + plural(r.candidates, "seed") + " a clock can produce within " + r.maxFrame + " frames (hour byte 0-23) -> " + plural(r.verified, "candidate") + " confirmed by the " + (cfg.kind === "static" ? "static" : "wild") + " generator frame by frame.");
    if (r.rows.length) lines.push(r.rows.length + " date / time / delay row" + (r.rows.length === 1 ? "" : "s") + " inside the delay and year windows, nearest the target delay first (the year is a delay knob: +1 year = -1 delay for the same seed).");
    else lines.push("No row inside the delay and year windows: widen the delay window or the years, or raise the frame limit; the design's flawless case, 7B0448D1 -> frame 0, needs delay 18641 in 2000.");
    lines = lines.concat(feasibilityLines(r.feasibility, null));
    lines.push("  A reachable seed exists for about 9.4 % of back-steps (the hour byte), so the search is exact within its windows, not a promise that a low frame exists.");
    return lines;
  }

  // ---- the result card (design 5.1 step 5) -----------------------------------------------------
  function abilityName(gen, species, slot) {
    var names = species.abilities || [];
    return names[slot] || names[0] || "?";
  }
  function cardLines(mon, ctx) {
    var species = ctx.species || speciesRec(ctx.gen, mon.species);
    var lines = [];
    lines.push("Result card (" + NO_HARDWARE.split(":")[0] + ")");
    lines.push("  " + speciesName(species) + " L" + mon.level + "  PID " + hex8(mon.pid) + "  nature " + mon.natureName + "  gender " + (mon.gender === 2 ? "none" : mon.gender === 1 ? "F" : "M") + "  ability " + abilityName(ctx.gen, species, mon.abilitySlot) + " (slot " + (mon.abilitySlot + 1) + ")");
    lines.push("  IVs " + ivText(mon.ivs) + " (HP/Atk/Def/SpA/SpD/Spe)  Hidden Power " + titleCase(mon.hiddenPowerType) + " " + mon.hiddenPowerPower + "  stats at L" + mon.level + " " + mon.stats.join("/"));
    lines.push("  shiny: " + (ctx.hasIds ? (mon.shiny ? "YES for TID " + ctx.tid + " / SID " + ctx.sid : "no for TID " + ctx.tid + " / SID " + ctx.sid) : "unknown (type your Trainer ID and Secret ID to know)") + (mon.encounterSlot !== undefined && mon.encounterSlot >= 0 ? "  slot " + mon.encounterSlot : ""));
    lines.push("  frame " + mon.frame + "  seed " + hex8(ctx.seed) + (ctx.timeText ? "  " + ctx.timeText : "") + "  calls used " + mon.callsUsed);
    lines.push("  seed model " + ctx.model.id + ": " + ctx.model.status);
    return lines;
  }

  // ---- procedures (design 5.1 step 6), numbered, every step under the seed model id ---------------------
  function gen3Procedure(cfg, hit, timerModel) {
    var model = modelOf(cfg.game), game = GAMES[cfg.game];
    var ms = frameToMs(hit.frame, cfg.console);
    var phases = T.gen3Phases({ console: cfg.console }, timerModel);
    var lines = [];
    lines.push("Procedure (" + model.id + "; " + NO_HARDWARE + ")");
    lines.push("1. Prepare the save: " + (cfg.kind === "static" ? "stand where the encounter starts (" + cfg.staticLabel + ") and save; the last A that starts the battle or the gift is the timed press." : "stand on the " + KIND_NAMES[cfg.encounter] + " tile of " + cfg.tableName + " and save; the timed press is the one that triggers the encounter (a step, a cast, a Rock Smash)" + (cfg.lead ? "; lead " + cfg.lead.ability.replace("_", " ").toLowerCase() : "") + "."));
    lines.push("2. The seed: " + (model.kind === "fixed" ? "power on (or A+B+Start+Select soft reset) and the game seeds " + hex8(cfg.seed) + " at frame 0 (" + model.id + ")." : "the typed seed " + hex8(cfg.seed) + " must be the one in force (" + model.id + ": " + model.text + ")"));
    lines.push("3. Take the same input path every time from power-on to the press (title, CONTINUE, the last dialogue): the frame count runs from the seed, so a constant path is absorbed by the calibration and a variable one is not.");
    lines.push("4. Timer: phase 1 " + core.fmtMs(phases[0]) + " (the pre-timer: power on at its end, the first long beep), phase 2 " + core.fmtMs(phases[1]) + " = frame " + hit.frame + " x " + (1000 / fpsOf(cfg.console)).toFixed(4) + " ms " + (timerModel.calibration >= 0 ? "+ " : "- ") + Math.abs(timerModel.calibration) + " ms calibration: press A on the last beep. Target " + core.fmtMs(ms) + " after the seed" + (game.family === "e" && cfg.kind === "static" ? " (Emerald in battle advances twice per frame: the count here is up to the press that starts it)" : "") + ".");
    lines.push("5. Read what you got (nature and the six stats on the summary screen, or the IVs from a calculator) and type it below: the tool finds the frame you hit and moves the calibration by the difference (EonTimer's frame model, core/timers.js calibrateGen3).");
    lines.push("6. Repeat until the frame hit equals the target; then the card above is what the game creates.");
    return lines;
  }
  function gen4Procedure(cfg, row, timerModel, plan) {
    var model = modelOf(cfg.game), game = GAMES[cfg.game];
    var settings = { console: cfg.console };
    var phases = T.gen4Phases(settings, timerModel);
    var minutes = T.gen4MinutesBefore(settings, timerModel);
    var lines = [];
    lines.push("Procedure (" + model.id + "; " + NO_HARDWARE + ")");
    lines.push("1. Prepare the save: " + (cfg.kind === "static" ? "in front of " + cfg.staticLabel + ", the last A before the battle or the gift is the frame that matters." : "on the " + KIND_NAMES[cfg.encounter] + " tile of " + cfg.tableName + (cfg.lead ? ", lead " + cfg.lead.ability.replace("_", " ").toLowerCase() : "") + ".") + " Save with the party you will advance with (" + plural(plan.partyCount, "member") + ").");
    lines.push("2. DS clock: set " + row.year + "-" + two(row.month) + "-" + two(row.day) + " " + two(row.hour) + ":" + two(row.minute) + " and confirm it " + plural(minutes, "minute") + " before the target minute (the countdown spans that long); target second " + row.second + ", target delay " + row.delay + " -> seed " + hex8(row.seed) + " (" + model.id + ").");
    lines.push("3. Timer: start it as the clock confirms; phase 1 " + core.fmtMs(phases[0]) + " ends on the first long beep: press A to load the game from the DS menu; phase 2 " + core.fmtMs(phases[1]) + " ends on the last beep: press A on CONTINUE, the seed forms then (calibrated delay " + timerModel.calibratedDelay + ", calibrated second " + timerModel.calibratedSecond + "; EonTimer's delay model, core/timers.js).");
    lines.push("4. Verify the seed: " + (game.family === "dppt" ? "open the Poketch coin toss and flip it 10-20 times (the MT only: the LCRNG frame does not move), type the H/T string below" : "call Elm (each call is one LCRNG advance: count them) and type the E/K/P letters below, with the roamers active on the save") + ": the tool names the delay you hit and corrects the calibrated delay. Repeat until the hit is the target.");
    lines.push("5. Advance to frame " + row.frame + ": " + (plan.needed <= 0 ? "no advance needed from frame " + plan.current + "." : plan.plan.map(function (p) { return p.uses + " x " + p.tool + " (+" + p.perUse + " each, " + p.label + ")"; }).join(", ") + (plan.remainder ? " and " + plan.remainder + " left that no listed tool covers" : "") + " from frame " + plan.current + " (type where you are after loading: DPPt sits a few frames in, HGSS more with roamers).") + " Then trigger the encounter.");
    lines.push("6. Read the nature and stats: the card above says what frame " + row.frame + " of seed " + hex8(row.seed) + " creates.");
    return lines;
  }

  // ---- the typed outcome: Gen 3 frame hit and Gen 4 delay hit ----------------------------------------
  // Gen 3: nature plus IVs (or the six stats at the level) typed after the attempt; the frames around the target are
  // generated again and the nearest match is the frame hit. The IV words alone can repeat within the window, which
  // is said; the nature (and the stats) usually settle it.
  function gen3IdentifyHit(cfg, target, got, window) {
    var w = window || 3000;
    var lo = Math.max(0, target - w), count = target + w - lo + 1;
    var f = { validOnly: true };
    if (!isNil(got.nature)) f.natures = [got.nature];
    if (got.ivs) { f.ivMin = got.ivs; f.ivMax = got.ivs; }
    if (cfg.kind === "wild" && !isNil(cfg.wanted.species)) f.species = [cfg.wanted.species];
    var res = gen3Run(cfg, f, lo, count);
    if (got.stats) {
      res = res.filter(function (r) { return IV_KEYS.every(function (k, i) { return isNil(got.stats[k]) || r.stats[i] === got.stats[k]; }); });
    }
    if (!res.length) return { hit: null, candidates: 0 };
    var best = res[0];
    res.forEach(function (r) { if (Math.abs(r.frame - target) < Math.abs(best.frame - target)) best = r; });
    return { hit: best, candidates: res.length, window: w };
  }
  // Gen 4: the typed coin flips (DPPt) or Elm calls (HGSS) against the calibrate rows around the target.
  function normaliseCalls(text) { return ("" + text).toUpperCase().replace(/[^HTEKP]/g, ""); }
  function gen4IdentifyHit(gameKey, target, typed, delayRange, secondRange, opts) {
    var fam = GAMES[gameKey].family === "dppt" ? "DPPt" : "HGSS";
    var rows = ST.calibrateRows(target.seed, delayRange, secondRange, fam, { target: target, roamers: opts && opts.roamers, routes: opts && opts.routes, elmWays: opts && opts.elmWays });
    var s = normaliseCalls(typed);
    if (s.length < 5) return { error: "type at least 5 " + (fam === "DPPt" ? "coin flips (H / T)" : "Elm calls (E / K / P)") + "; " + s.length + " given", matches: [] };
    var matches = rows.filter(function (r) { return (fam === "DPPt" ? r.flips : r.calls).indexOf(s) === 0; });
    matches.sort(function (a, b) { return Math.abs(a.delayOffset) - Math.abs(b.delayOffset) || Math.abs(a.secondOffset) - Math.abs(b.secondOffset); });
    return { matches: matches, rows: rows.length, typed: s, family: fam };
  }

  // ---- the store: the timer calibration per game and console, per mode ----------------------------------
  var MEMORY_ONLY = !!(root.location && typeof root.location.search === "string" && root.location.search.indexOf("wizselftest") !== -1);
  var mem = {};
  function storageGet(key) {
    if (!MEMORY_ONLY) { try { if (root.localStorage) return root.localStorage.getItem(key); } catch (e) { /* private mode */ } }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }
  function storageSet(key, value) {
    mem[key] = value;
    if (MEMORY_ONLY) return;
    try { if (root.localStorage) root.localStorage.setItem(key, value); } catch (e) { /* quota / private mode */ }
  }
  function storeKeyFor(mode) { return MODE.storeKey(STORE_KEY, mode); }
  function loadStore(mode) { try { return JSON.parse(storageGet(storeKeyFor(mode)) || "{}"); } catch (e) { return {}; } }
  function saveStore(store, mode) { storageSet(storeKeyFor(mode), JSON.stringify(store)); }
  function entryKey(gameKey, consoleKey) { return gameKey + "/" + consoleKey; }
  function entryFor(store, gameKey, consoleKey) {
    var k = entryKey(gameKey, consoleKey);
    if (!store[k]) store[k] = { samples: [] };
    return store[k];
  }
  // The calibration in force: the last sample made in this mode under this seed model (EonTimer keeps a running
  // value; every sample records the value it was applied to, so the chain is auditable). Samples of another mode or
  // model are left out and named.
  function inForce(store, gameKey, consoleKey, mode, modelId) {
    var e = store[entryKey(gameKey, consoleKey)];
    var gen = GAMES[gameKey].gen;
    var dflt = gen === 3 ? { calibration: 0, preTimer: 5000 } : { calibratedDelay: T.DEFAULTS.gen4.calibratedDelay, calibratedSecond: T.DEFAULTS.gen4.calibratedSecond };
    if (!e) return { value: dflt, samples: [], ignored: [] };
    var split = MODE.splitByMode(e.samples, mode);
    var kept = split.kept.filter(function (s) { return s.model === modelId; });
    var ignored = split.rest.concat(split.kept.filter(function (s) { return s.model !== modelId; }));
    var value = dflt;
    if (kept.length) value = kept[kept.length - 1].after;
    return { value: value, samples: kept, ignored: ignored };
  }
  function ignoredLines(ignored, mode, modelId) {
    var lines = [];
    var modes = {}, models = {};
    ignored.forEach(function (s) {
      if (MODE.effectiveMode(s) !== mode) modes[MODE.describeMode(s)] = true;
      else models[s.model || "no seed model"] = true;
    });
    var m = Object.keys(modes), d = Object.keys(models);
    if (m.length) lines.push(plural(ignored.filter(function (s) { return MODE.effectiveMode(s) !== mode; }).length, "sample") + " recorded in " + m.join(", ") + " mode, not " + MODE.label(mode) + ": left out, never in force here");
    if (d.length) lines.push(plural(ignored.filter(function (s) { return MODE.effectiveMode(s) === mode; }).length, "sample") + " recorded under " + d.join(", ") + ", not " + modelId + ": left out");
    return lines;
  }
  function addSample(store, gameKey, consoleKey, sample, mode) {
    var e = entryFor(store, gameKey, consoleKey);
    sample.mode = MODE.checkMode(mode);
    sample.when = sample.when || nowStamp();
    e.samples.push(sample);
    saveStore(store, mode);
    return sample;
  }

  var api = {
    GAMES: GAMES, GAME_ORDER: GAME_ORDER, CONSOLES: CONSOLES, SEED_MODELS: SEED_MODELS, IV_KEYS: IV_KEYS, KIND_NAMES: KIND_NAMES,
    NO_HARDWARE: NO_HARDWARE, GEN4_CUTE_CHARM_NOTE: GEN4_CUTE_CHARM_NOTE, STORE_KEY: STORE_KEY, MEMORY_ONLY: MEMORY_ONLY,
    setData: setData, hasData: hasData, speciesRec: speciesRec, consolesFor: consolesFor, fpsOf: fpsOf, frameToMs: frameToMs, modelOf: modelOf,
    staticEntries: staticEntries, wildTables: wildTables, slotsFor: slotsFor, speciesInSlots: speciesInSlots, speciesShare: speciesShare,
    leadOptions: leadOptions, makeLead: makeLead, buildFilter: buildFilter, ivCombos: ivCombos, feasibility: feasibility, feasibilityLines: feasibilityLines,
    searchGen3: searchGen3, gen3SearchLines: gen3SearchLines, gen3Run: gen3Run, searchGen4: searchGen4, gen4SearchLines: gen4SearchLines, gen4Run: gen4Run,
    cardLines: cardLines, gen3Procedure: gen3Procedure, gen4Procedure: gen4Procedure, gen3IdentifyHit: gen3IdentifyHit, gen4IdentifyHit: gen4IdentifyHit,
    loadStore: loadStore, saveStore: saveStore, inForce: inForce, ignoredLines: ignoredLines, addSample: addSample, entryKey: entryKey,
    hex8: hex8, ivText: ivText, speciesName: speciesName, _storage: { get: storageGet, set: storageSet }
  };
  root.ShinyWizardUi = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  // =========================================================================================== the DOM part
  if (typeof document === "undefined" || !document.getElementById("tab-wizard")) return;
  function $(id) { return document.getElementById(id); }
  function setText(id, lines) { $(id).textContent = Array.isArray(lines) ? lines.join("\n") : lines; }
  function option(sel, value, text, selected, disabled) {
    var o = document.createElement("option"); o.value = value; o.textContent = text; if (selected) o.selected = true; if (disabled) o.disabled = true; sel.appendChild(o);
  }
  function fill(sel, items, current) {
    sel.innerHTML = "";
    items.forEach(function (it) { option(sel, it.value, it.text, it.value === current, it.disabled); });
    if (current && sel.value !== current) sel.value = items.length ? items[0].value : "";
  }
  function numOr(id, fallback) { var v = parseFloat($(id).value); return isNaN(v) ? fallback : v; }
  function intOr(id, fallback) { var v = parseInt($(id).value, 10); return isNaN(v) ? fallback : v; }
  function show(id, on) { $(id).style.display = on ? "" : "none"; }

  // -- data loading: a script element per generation, appended on first use (file:// friendly: no fetch, no CORS)
  var loading = { 3: null, 4: null };
  function loadData(gen, cb) {
    if (hasData(gen)) return cb(null);
    if (root.SHINY_WIZARD_NO_DATA) return cb(new Error("this build carries no species, encounter or static tables (" + root.SHINY_WIZARD_NO_DATA + "): the wizard needs the static page or the Electron app, which fetch data/wizard-gen" + gen + ".js on first use"));
    if (loading[gen]) { loading[gen].push(cb); return; }
    loading[gen] = [cb];
    var s = document.createElement("script");
    s.src = "data/wizard-gen" + gen + ".js";
    function done(err) { var cbs = loading[gen]; loading[gen] = null; cbs.forEach(function (fn) { fn(err); }); }
    s.onload = function () {
      var d = root["ShinyWizardData" + gen];
      if (!d) return done(new Error("data/wizard-gen" + gen + ".js loaded but set no ShinyWizardData" + gen));
      try { setData(gen, d); done(null); } catch (e) { done(e); }
    };
    s.onerror = function () { done(new Error("data/wizard-gen" + gen + ".js could not be loaded (run webapp/sync-core.sh: it writes the file from core/data/*.json)")); };
    document.head.appendChild(s);
  }

  var st = { game: "emerald", console: "GBA", kind: "static", table: null, slots: null, rate: 0, staticEntry: null, target: null, rows: [], cfg: null, timerModel: null, store: null, lastSearch: null };
  var Countdown = root.ShinyCountdown;
  var timer = Countdown ? new Countdown($("wz-display"), $("wz-phase")) : null;

  function currentGame() { return GAMES[st.game]; }
  function mode() { return MODE.get(); }
  function modelId() { return modelOf(st.game).id; }

  function fillGames() {
    fill($("wz-game"), GAME_ORDER.map(function (k) { return { value: k, text: GAMES[k].name + " (Gen " + GAMES[k].gen + ")" }; }), st.game);
    fill($("wz-console"), consolesFor(st.game).map(function (c) { return { value: c.key, text: c.name }; }), st.console);
    st.console = $("wz-console").value;
    var natures = [{ value: "", text: "any" }];
    core.NATURES.forEach(function (n, i) { natures.push({ value: String(i), text: n }); });
    fill($("wz-nature"), natures, "");
    fill($("wz-lead-nature"), natures.slice(1), "0");
    fill($("wz-got-nature"), natures, "");
  }
  function refreshSetup() {
    var game = currentGame(), model = modelOf(st.game);
    fill($("wz-console"), consolesFor(st.game).map(function (c) { return { value: c.key, text: c.name }; }), st.console);
    st.console = $("wz-console").value;
    var lines = [];
    lines.push("Seed model: " + model.id);
    lines.push("  " + model.text);
    if (model.typed) lines.push("  " + model.typed);
    lines.push("  Validation status: " + model.status + ".");
    lines.push("  Console rate: " + fpsOf(st.console).toFixed(4) + " fps (core/timers.js, EonTimer's constants); a frame is " + (1000 / fpsOf(st.console)).toFixed(4) + " ms.");
    lines.push("  " + NO_HARDWARE);
    setText("wz-model", lines);
    show("wz-seed-row", game.gen === 3);
    if (game.gen === 3) {
      $("wz-seed").value = model.kind === "fixed" ? hex8(model.seed) : ($("wz-seed").value === "00000000" || $("wz-seed").value === "000005A0" ? "" : $("wz-seed").value);
      $("wz-seed-note").textContent = model.kind === "fixed" ? "the model's fixed seed (edit it for a live-battery seed you know)" : "no fixed seed: type one, or this game is unavailable here";
    }
    show("wz-gen3-window", game.gen === 3);
    show("wz-gen4-window", game.gen === 4);
    show("wz-timer-gen3", game.gen === 3);
    show("wz-timer-gen4", game.gen === 4);
    show("wz-got-gen3", game.gen === 3);
    show("wz-got-gen4", game.gen === 4);
    show("wz-hgss-row", game.family === "hgss");
    $("wz-got-calls-label").textContent = game.family === "dppt" ? "Coin flips you got (H/T, in order)" : "Elm calls you got (E/K/P, in order)";
    st.target = null; st.rows = []; st.lastSearch = null;
    $("wz-results").innerHTML = "";
    setText("wz-search-out", ""); setText("wz-card", ""); setText("wz-procedure", "");
    setText("wz-status", "loading the Gen " + game.gen + " tables (species, encounters, statics)...");
    loadData(game.gen, function (err) {
      if (err) { setText("wz-status", "Gen " + game.gen + " tables: " + err.message); $("wz-encounter-card").classList.add("hidden"); return; }
      $("wz-encounter-card").classList.remove("hidden");
      var d = dataFor(game.gen);
      setText("wz-status", "Gen " + game.gen + " tables loaded: " + d.species.species.length + " species, " + (game.gen === 3 ? d.encounters.games[st.game].maps.length : d.encounters.games[st.game].tables.length) + " encounter tables, " + staticEntries(st.game).length + " static / gift entries for " + game.name + " (docs/DATA.md).");
      refreshEncounter();
    });
    refreshTimer();
  }
  function refreshEncounter() {
    var game = currentGame();
    st.kind = $("wz-kind").value;
    show("wz-static-row", st.kind === "static");
    show("wz-wild-row", st.kind === "wild");
    var leadSel = $("wz-lead");
    fill(leadSel, leadOptions(st.game, st.kind).map(function (l) { return { value: l.key, text: l.name }; }), leadSel.value);
    show("wz-lead-row", leadOptions(st.game, st.kind).length > 1);
    $("wz-lead-note").textContent = game.gen === 4 && st.kind === "wild" ? GEN4_CUTE_CHARM_NOTE : "";
    show("wz-method-row", game.gen === 3);
    if (st.kind === "static") {
      var entries = staticEntries(st.game);
      fill($("wz-static"), entries.map(function (e) { return { value: e.id, text: e.label + (e.refused ? " - not offered: " + e.refused : ""), disabled: !!e.refused }; }), $("wz-static").value);
      var id = $("wz-static").value;
      st.staticEntry = entries.filter(function (e) { return e.id === id; })[0] || null;
      st.slots = null;
      if (st.staticEntry && game.gen === 3) $("wz-method").value = $("wz-method").value || "M1";
      $("wz-encounter-note").textContent = st.staticEntry ? "creation: " + st.staticEntry.entry.creation + (st.staticEntry.provenance === "pokefinder" ? " [provenance: PokeFinder; level not verified against a decomp]" : " [decomp; level verified]") : "";
    } else {
      var tables = wildTables(st.game);
      fill($("wz-table"), tables.map(function (t) { return { value: String(t.index), text: t.name }; }), $("wz-table").value);
      var tIndex = intOr("wz-table", tables[0].index);
      var t = tables.filter(function (x) { return x.index === tIndex; })[0] || tables[0];
      fill($("wz-enc-kind"), t.kinds.map(function (k) { return { value: k, text: KIND_NAMES[k] }; }), $("wz-enc-kind").value);
      show("wz-time-row", game.gen === 4 && $("wz-enc-kind").value === "grass");
      var sl = slotsFor(st.game, t.index, $("wz-enc-kind").value, { time: $("wz-time").value });
      st.table = t; st.slots = sl.slots; st.rate = sl.rate; st.tanoby = sl.tanoby;
      var sp = speciesInSlots(sl.slots);
      fill($("wz-species"), sp.map(function (s) { return { value: String(s.species.dex), text: speciesName(s.species) + " (slots " + s.slots.join(",") + ", L" + s.levels.join("/") + ", " + f1(100 * speciesShare(st.game, $("wz-enc-kind").value, sl.slots, s.species.dex)) + " % of the slot roll)" }; }), $("wz-species").value);
      $("wz-encounter-note").textContent = "table " + t.index + ", rate " + sl.rate + (sl.note ? "; " + sl.note : "") + (game.gen === 3 && $("wz-enc-kind").value === "rock_smash" && game.family !== "frlg" ? "; Rock Smash spends the odds roll (rate " + sl.rate + " x 16 of 2880), frames that fail it are skipped" : "");
    }
    refreshWanted();
  }
  function wantedSpecies() {
    if (st.kind === "static") return st.staticEntry ? st.staticEntry.species : null;
    var dex = intOr("wz-species", NaN);
    return isNaN(dex) ? null : speciesRec(currentGame().gen, dex);
  }
  function refreshWanted() {
    var sp = wantedSpecies();
    var genderFixed = !sp || sp.gender_ratio === 0 || sp.gender_ratio === 254 || sp.gender_ratio === 255;
    var abilities = sp ? sp.abilities : [];
    show("wz-gender-row", !genderFixed);
    show("wz-ability-row", !!(sp && sp.ability_ids && sp.ability_ids[1]));
    fill($("wz-ability"), [{ value: "", text: "any" }].concat(abilities.map(function (a, i) { return { value: String(i), text: "slot " + (i + 1) + ": " + a.replace(/_/g, " ").toLowerCase() }; })).filter(function (x, i) { return i === 0 || abilities[i - 1] !== "NONE"; }), $("wz-ability").value);
    $("wz-wanted-note").textContent = sp ? speciesName(sp) + ": gender byte " + sp.gender_ratio + (genderFixed ? " (fixed, no gender filter)" : "") + ", abilities " + abilities.filter(function (a) { return a !== "NONE"; }).join(" / ") : "";
  }
  function readWanted() {
    var w = { ivMin: {}, ivMax: {} };
    IV_KEYS.forEach(function (k) { w.ivMin[k] = intOr("wz-min-" + k, 0); w.ivMax[k] = intOr("wz-max-" + k, 31); });
    w.nature = $("wz-nature").value === "" ? null : Number($("wz-nature").value);
    w.gender = $("wz-gender-row").style.display === "none" ? null : ($("wz-gender").value || null);
    w.ability = $("wz-ability-row").style.display === "none" || $("wz-ability").value === "" ? null : Number($("wz-ability").value);
    w.shiny = $("wz-shiny").checked;
    w.tid = $("wz-tid").value === "" ? null : intOr("wz-tid", NaN);
    w.sid = $("wz-sid").value === "" ? null : intOr("wz-sid", NaN);
    if ((w.tid !== null && (isNaN(w.tid) || w.tid < 0 || w.tid > 65535)) || (w.sid !== null && (isNaN(w.sid) || w.sid < 0 || w.sid > 65535))) throw new Error("Trainer ID and Secret ID are 0..65535");
    var sp = wantedSpecies();
    w.species = st.kind === "wild" && sp ? sp.dex : null;
    return w;
  }
  function readLead() {
    var key = $("wz-lead").value;
    return makeLead(key, Number($("wz-lead-nature").value), $("wz-lead-gender").value, intOr("wz-lead-level", 50));
  }
  function buildCfg() {
    var game = currentGame();
    var wanted = readWanted();
    var cfg = { game: st.game, console: st.console, kind: st.kind, wanted: wanted, lead: readLead() };
    if (st.kind === "static") {
      if (!st.staticEntry) throw new Error("pick a static / gift entry");
      if (st.staticEntry.refused) throw new Error(st.staticEntry.label + " is not offered: " + st.staticEntry.refused);
      cfg.species = st.staticEntry.species; cfg.level = st.staticEntry.level; cfg.buggedRoamer = st.staticEntry.buggedRoamer; cfg.shinyMode = st.staticEntry.shinyMode;
      cfg.staticMethod = st.staticEntry.method; cfg.staticLabel = st.staticEntry.label;
      cfg.method = game.gen === 3 ? $("wz-method").value : st.staticEntry.method;
      if (game.gen === 4 && cfg.staticMethod === "M1" && cfg.lead) throw new Error("a Method 1 creation (gift, starter, roamer, fossil) takes no lead effect");
    } else {
      if (!st.slots) throw new Error("pick an encounter table");
      cfg.slots = st.slots; cfg.rate = st.rate; cfg.encounter = $("wz-enc-kind").value; cfg.tableName = st.table.name;
      cfg.options = { tanoby: !!st.tanoby };
      cfg.method = game.gen === 3 ? $("wz-method").value : game.method;
    }
    if (game.gen === 3) {
      var seedText = $("wz-seed").value.replace(/^\$|^0x/i, "");
      if (!/^[0-9a-fA-F]{1,8}$/.test(seedText)) throw new Error("no seed: " + modelOf(st.game).text);
      cfg.seed = parseInt(seedText, 16) >>> 0;
      cfg.maxFrame = Math.round(Math.min(240, Math.max(0.1, numOr("wz-minutes", 60))) * 60 * fpsOf(st.console));
      cfg.limit = 20;
    } else {
      cfg.maxFrame = Math.min(2000, Math.max(0, intOr("wz-maxframe", 100)));
      cfg.yearMin = Math.min(2099, Math.max(2000, intOr("wz-year-min", 2000)));
      cfg.yearMax = Math.min(2099, Math.max(cfg.yearMin, intOr("wz-year-max", 2099)));
      cfg.delayMin = Math.max(0, intOr("wz-delay-min", 0));
      cfg.delayMax = Math.max(cfg.delayMin, intOr("wz-delay-max", 65535));
      cfg.targetDelay = Math.max(0, intOr("wz-delay-target", 600));
      cfg.limit = 30;
    }
    return cfg;
  }
  function cardCtx(cfg, seed, timeText) {
    return { gen: currentGame().gen, species: cfg.kind === "static" ? cfg.species : null, hasIds: !isNil(cfg.wanted.tid) && !isNil(cfg.wanted.sid), tid: cfg.wanted.tid, sid: cfg.wanted.sid, seed: seed, model: modelOf(cfg.game), timeText: timeText };
  }
  function renderRows(rows, headers, cells, onPick) {
    var html = "<table><tr>" + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr>";
    rows.forEach(function (r, i) { html += '<tr class="pick" data-i="' + i + '">' + cells(r).map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; });
    $("wz-results").innerHTML = html + "</table>";
    $("wz-results").querySelectorAll("tr.pick").forEach(function (tr) {
      tr.addEventListener("click", function () {
        $("wz-results").querySelectorAll("tr").forEach(function (x) { x.classList.remove("selected"); });
        tr.classList.add("selected");
        onPick(rows[Number(tr.dataset.i)]);
      });
    });
  }
  function search() {
    var out = [];
    try {
      var cfg = buildCfg();
      st.cfg = cfg;
      st.target = null; setText("wz-card", ""); setText("wz-procedure", "");
      if (currentGame().gen === 3) {
        var r = searchGen3(cfg);
        st.lastSearch = r;
        out = gen3SearchLines(r, cfg);
        renderRows(r.hits, ["Frame", "Time after the seed", "PID", "Nature", "IVs", "Gender", "Shiny"], function (m) {
          return [m.frame, core.fmtMs(frameToMs(m.frame, cfg.console)), "<span class='mono'>" + hex8(m.pid) + "</span>", m.natureName, ivText(m.ivs), m.gender === 2 ? "-" : m.gender === 1 ? "F" : "M", cfg.wanted.tid === null || cfg.wanted.sid === null ? "?" : (m.shiny ? "YES" : "no")];
        }, function (m) { setTargetGen3(cfg, m); });
      } else {
        var r4 = searchGen4(cfg);
        st.lastSearch = r4;
        out = gen4SearchLines(r4, cfg);
        renderRows(r4.rows, ["Seed", "Frame", "Date", "Time", "Delay", "PID", "Nature", "IVs", "Shiny"], function (row) {
          return ["<span class='mono'>" + hex8(row.seed) + "</span>", row.frame, row.year + "-" + two(row.month) + "-" + two(row.day), two(row.hour) + ":" + two(row.minute) + ":" + two(row.second), row.delay, "<span class='mono'>" + hex8(row.mon.pid) + "</span>", row.mon.natureName, ivText(row.mon.ivs), cfg.wanted.tid === null || cfg.wanted.sid === null ? "?" : (row.mon.shiny ? "YES" : "no")];
        }, function (row) { setTargetGen4(cfg, row); });
      }
    } catch (e) { out = ["cannot search: " + e.message]; $("wz-results").innerHTML = ""; }
    setText("wz-search-out", out);
  }
  function timerModelGen3() {
    var v = inForce(st.store, st.game, st.console, mode(), modelId()).value;
    return { mode: "STANDARD", preTimer: numOr("wz-pretimer", v.preTimer || 5000), targetFrame: st.target ? st.target.frame : 0, calibration: numOr("wz-cal3", v.calibration || 0) };
  }
  function timerModelGen4() {
    var v = inForce(st.store, st.game, st.console, mode(), modelId()).value;
    return { targetDelay: st.target ? st.target.delay : 600, targetSecond: st.target ? st.target.second : 50, calibratedDelay: numOr("wz-cald", v.calibratedDelay), calibratedSecond: numOr("wz-cals", v.calibratedSecond) };
  }
  function setTargetGen3(cfg, m) {
    st.target = m;
    var timeText = core.fmtMs(frameToMs(m.frame, cfg.console)) + " after the seed";
    setText("wz-card", cardLines(m, cardCtx(cfg, cfg.seed, timeText)));
    $("wz-target-info").textContent = "Target: frame " + m.frame + " of seed " + hex8(cfg.seed) + " (" + timeText + "); seed model " + modelId();
    refreshTimer();
  }
  function setTargetGen4(cfg, row) {
    st.target = row;
    var timeText = row.year + "-" + two(row.month) + "-" + two(row.day) + " " + two(row.hour) + ":" + two(row.minute) + ":" + two(row.second) + " delay " + row.delay;
    setText("wz-card", cardLines(row.mon, cardCtx(cfg, row.seed, timeText)));
    $("wz-target-info").textContent = "Target: seed " + hex8(row.seed) + " frame " + row.frame + " (" + timeText + "); seed model " + modelId();
    refreshTimer();
  }
  function refreshTimer() {
    var game = currentGame();
    var force = inForce(st.store, st.game, st.console, mode(), modelId());
    var lines = [];
    if (game.gen === 3) {
      if (!$("wz-cal3")._touched) $("wz-cal3").value = f1(force.value.calibration || 0);
      if (!$("wz-pretimer")._touched) $("wz-pretimer").value = force.value.preTimer || 5000;
    } else {
      if (!$("wz-cald")._touched) $("wz-cald").value = force.value.calibratedDelay;
      if (!$("wz-cals")._touched) $("wz-cals").value = force.value.calibratedSecond;
    }
    lines.push("Calibration in force for " + GAMES[st.game].name + " on " + CONSOLES[st.console].name + " in " + MODE.label(mode()) + " mode (store " + storeKeyFor(mode()) + "): " + plural(force.samples.length, "sample") + " under " + modelId() + (force.samples.length ? ", last " + force.samples[force.samples.length - 1].when : "") + ".");
    lines = lines.concat(ignoredLines(force.ignored, mode(), modelId()).map(function (l) { return "  " + l; }));
    if (!st.target || !st.cfg) { lines.push("No target yet: search, then click a row."); setText("wz-timer-note", lines); setText("wz-procedure", ""); $("wz-display").textContent = "--:--.---"; return; }
    if (game.gen === 3) {
      st.timerModel = timerModelGen3();
      var ph = T.gen3Phases({ console: st.console }, st.timerModel);
      lines.push("Phases: " + core.fmtMs(ph[0]) + " (pre-timer, power on at its end) then " + core.fmtMs(ph[1]) + " (A on the last beep).");
      $("wz-display").textContent = core.fmtMs(ph[0] + ph[1]);
      setText("wz-procedure", gen3Procedure(st.cfg, st.target, st.timerModel));
    } else {
      st.timerModel = timerModelGen4();
      var p4 = T.gen4Phases({ console: st.console }, st.timerModel);
      lines.push("Phases: " + core.fmtMs(p4[0]) + " then " + core.fmtMs(p4[1]) + "; set the clock " + plural(T.gen4MinutesBefore({ console: st.console }, st.timerModel), "minute") + " before the target minute.");
      $("wz-display").textContent = core.fmtMs(p4[0] + p4[1]);
      var plan = ST.planAdvances(Math.max(0, intOr("wz-current-frame", 0)), st.target.frame, { partyCount: Math.min(6, Math.max(1, intOr("wz-party", 1))), tools: GAMES[st.game].family === "dppt" ? ["walk128", "journal", "chatot"] : ["walk128", "elmCall", "chatot"] });
      plan.current = Math.max(0, intOr("wz-current-frame", 0)); plan.partyCount = Math.min(6, Math.max(1, intOr("wz-party", 1)));
      setText("wz-procedure", gen4Procedure(st.cfg, st.target, st.timerModel, plan));
    }
    setText("wz-timer-note", lines);
  }
  function startTimer() {
    if (!st.target || !timer || timer.running) return;
    var ph = currentGame().gen === 3 ? T.gen3Phases({ console: st.console }, st.timerModel) : T.gen4Phases({ console: st.console }, st.timerModel);
    if (ph[1] <= 0) { setText("wz-timer-note", ["phase 2 is not positive: check the calibration"]); return; }
    $("wz-timer-log").textContent = "started at " + nowStamp().split(" ")[1] + "  [" + MODE.label(mode()) + " mode]  " + modelId() + "\n";
    timer.start(ph);
  }
  function recordGen3() {
    var out = [];
    try {
      if (!st.target || !st.cfg) throw new Error("no target: search and pick a frame first");
      var got = { nature: $("wz-got-nature").value === "" ? null : Number($("wz-got-nature").value) };
      var ivs = {}, haveIvs = true, stats = {}, haveStats = false;
      IV_KEYS.forEach(function (k) { var v = $("wz-got-iv-" + k).value; if (v === "") haveIvs = false; else ivs[k] = Number(v); var s = $("wz-got-stat-" + k).value; if (s !== "") { stats[k] = Number(s); haveStats = true; } });
      if (haveIvs) got.ivs = ivs;
      if (haveStats) got.stats = stats;
      if (!haveIvs && !haveStats && got.nature === null) throw new Error("type the nature and the IVs (or the six stats) you got");
      var r = gen3IdentifyHit(st.cfg, st.target.frame, got, 3000);
      if (!r.hit) throw new Error("nothing within " + 3000 + " frames of the target matches what you typed: check the values, or the seed model is not in force (a different seed, a different input path)");
      var settings = { console: st.console };
      var before = st.timerModel.calibration;
      var next = T.gen3Calibrated(settings, st.timerModel, r.hit.frame);
      var sample = { model: modelId(), target: st.target.frame, hit: r.hit.frame, before: { calibration: before, preTimer: st.timerModel.preTimer }, after: { calibration: next.calibration, preTimer: next.preTimer }, candidates: r.candidates, attempt: $("wz-timer-log").textContent.split("\n")[0] || "" };
      addSample(st.store, st.game, st.console, sample, mode());
      $("wz-cal3")._touched = false;
      var d3 = r.hit.frame - st.target.frame;
      out.push("You hit frame " + r.hit.frame + ", aimed " + st.target.frame + ": " + (d3 === 0 ? "on the frame" : Math.abs(d3) + " frame" + (Math.abs(d3) === 1 ? "" : "s") + " " + (d3 > 0 ? "late" : "early") + " (" + f1(frameToMs(d3, st.console)) + " ms)") + "; " + plural(r.candidates, "candidate") + " matched within +-" + r.window + " frames" + (r.candidates > 1 ? ", the nearest taken: type the stats too to settle it" : "") + ".");
      out.push("Calibration " + f1(before) + " ms -> " + f1(next.calibration) + " ms (core/timers.js calibrateGen3, frame delta x " + (1000 / fpsOf(st.console)).toFixed(4) + " ms); recorded under " + modelId() + " [" + MODE.label(mode()) + " mode].");
    } catch (e) { out.push("not recorded: " + e.message); }
    setText("wz-outcome", out);
    refreshTimer();
  }
  function recordGen4() {
    var out = [];
    try {
      if (!st.target || !st.cfg) throw new Error("no target: search and pick a row first");
      var target = { year: st.target.year, month: st.target.month, day: st.target.day, hour: st.target.hour, minute: st.target.minute, second: st.target.second, delay: st.target.delay, seed: st.target.seed };
      var roam = GAMES[st.game].family === "hgss" ? { raikou: $("wz-roam-raikou").checked, entei: $("wz-roam-entei").checked, lati: $("wz-roam-lati").checked } : null;
      var r = gen4IdentifyHit(st.game, target, $("wz-got-calls").value, Math.min(2000, Math.max(1, intOr("wz-delay-range", 100))), Math.min(30, Math.max(0, intOr("wz-second-range", 1))), { roamers: roam, elmWays: 3 });
      if (r.error) throw new Error(r.error);
      if (!r.matches.length) throw new Error("no delay within +-" + intOr("wz-delay-range", 100) + " and second +-" + intOr("wz-second-range", 1) + " of the target produces " + r.typed + " (" + r.rows + " rows checked): widen the ranges, or the clock was set to another minute");
      var m = r.matches[0];
      var settings = { console: st.console };
      var before = st.timerModel.calibratedDelay;
      var next = T.gen4Calibrated(settings, st.timerModel, m.delay);
      var sample = { model: modelId(), target: st.target.delay, hit: m.delay, secondOffset: m.secondOffset, typed: r.typed, before: { calibratedDelay: before, calibratedSecond: st.timerModel.calibratedSecond }, after: { calibratedDelay: next.calibratedDelay, calibratedSecond: next.calibratedSecond }, candidates: r.matches.length, attempt: $("wz-timer-log").textContent.split("\n")[0] || "" };
      addSample(st.store, st.game, st.console, sample, mode());
      $("wz-cald")._touched = false;
      var d4 = m.delay - st.target.delay;
      out.push("You hit delay " + m.delay + " (seed " + hex8(m.seed) + ", second " + (m.secondOffset >= 0 ? "+" : "") + m.secondOffset + "), aimed " + st.target.delay + ": " + (d4 === 0 && m.secondOffset === 0 ? "on the target" : Math.abs(d4) + " delay" + (Math.abs(d4) === 1 ? "" : "s") + " " + (d4 > 0 ? "late" : "early") + " (" + f1(T.toMilliseconds({ console: st.console }, Math.abs(d4))) + " ms)") + "; " + plural(r.matches.length, "row") + " of " + r.rows + " match " + r.typed + (r.matches.length > 1 ? " (the nearest taken: type more flips / calls to settle it)" : "") + ".");
      out.push("Calibrated delay " + before + " -> " + next.calibratedDelay + " (core/timers.js calibrateGen4: the delta x 0.75 within 167 ms, else x 1.0, rounded half to even); recorded under " + modelId() + " [" + MODE.label(mode()) + " mode].");
      if (m.delay === st.target.delay && m.secondOffset === 0) out.push("The seed is hit: advance to frame " + st.target.frame + " with the plan in the procedure, then trigger the encounter.");
    } catch (e) { out.push("not recorded: " + e.message); }
    setText("wz-outcome", out);
    refreshTimer();
  }
  function calRows() {
    var out = [];
    try {
      if (!st.target || currentGame().gen !== 4) throw new Error("a Gen 4 target is needed");
      var target = { year: st.target.year, month: st.target.month, day: st.target.day, hour: st.target.hour, minute: st.target.minute, second: st.target.second, delay: st.target.delay };
      var fam = GAMES[st.game].family === "dppt" ? "DPPt" : "HGSS";
      var roam = fam === "HGSS" ? { raikou: $("wz-roam-raikou").checked, entei: $("wz-roam-entei").checked, lati: $("wz-roam-lati").checked } : null;
      var rows = ST.calibrateRows(st.target.seed, Math.min(50, Math.max(1, intOr("wz-delay-range", 100))), 0, fam, { target: target, roamers: roam, elmWays: 3 });
      out.push("Neighbouring delays at the target second (seed, delay, " + (fam === "DPPt" ? "coin flips" : "Elm calls") + "; core/seedtime4.js calibrateRows):");
      rows.forEach(function (r) { out.push("  " + hex8(r.seed) + "  delay " + r.delay + (r.delayOffset === 0 ? " <- target" : "") + "  " + r.sequence.slice(0, 40)); });
    } catch (e) { out.push(e.message); }
    setText("wz-calrows-out", out);
  }

  // -- wiring
  st.store = loadStore(mode());
  fillGames();
  $("wz-game").addEventListener("change", function () { st.game = $("wz-game").value; st.console = consolesFor(st.game)[0].key; refreshSetup(); });
  $("wz-console").addEventListener("change", function () { st.console = $("wz-console").value; refreshSetup(); });
  $("wz-kind").addEventListener("change", refreshEncounter);
  $("wz-static").addEventListener("change", refreshEncounter);
  $("wz-table").addEventListener("change", function () { $("wz-enc-kind").value = ""; refreshEncounter(); });
  $("wz-enc-kind").addEventListener("change", refreshEncounter);
  $("wz-time").addEventListener("change", refreshEncounter);
  $("wz-species").addEventListener("change", refreshWanted);
  $("wz-lead").addEventListener("change", function () {
    var k = $("wz-lead").value;
    show("wz-lead-nature-row", k === "SYNCHRONIZE"); show("wz-lead-gender-row", k === "CUTE_CHARM"); show("wz-lead-level-row", k === "KEEN_EYE");
  });
  $("wz-search").addEventListener("click", search);
  ["wz-cal3", "wz-pretimer", "wz-cald", "wz-cals"].forEach(function (id) { $(id).addEventListener("input", function () { $(id)._touched = true; refreshTimer(); }); });
  ["wz-current-frame", "wz-party"].forEach(function (id) { $(id).addEventListener("input", refreshTimer); });
  $("wz-start").addEventListener("click", startTimer);
  $("wz-cancel").addEventListener("click", function () { if (timer) timer.cancel(); refreshTimer(); });
  $("wz-record3").addEventListener("click", recordGen3);
  $("wz-record4").addEventListener("click", recordGen4);
  $("wz-calrows").addEventListener("click", calRows);
  $("wz-clear").addEventListener("click", function () {
    var e = st.store[entryKey(st.game, st.console)];
    if (!e) return;
    var kept = e.samples.filter(function (s) { return !(MODE.effectiveMode(s) === mode() && s.model === modelId()); });
    var removed = e.samples.length - kept.length;
    e.samples = kept; saveStore(st.store, mode());
    ["wz-cal3", "wz-pretimer", "wz-cald", "wz-cals"].forEach(function (id) { $(id)._touched = false; });
    setText("wz-outcome", ["cleared " + plural(removed, "sample") + " under " + modelId() + " in " + MODE.label(mode()) + " mode; other modes' and other models' samples kept"]);
    refreshTimer();
  });
  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && st.target && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "SELECT" && $("tab-wizard").classList.contains("active")) {
      e.preventDefault();
      if (timer && timer.running) { timer.cancel(); refreshTimer(); } else startTimer();
    }
  });
  MODE.subscribe(function () {
    st.store = loadStore(mode());
    ["wz-cal3", "wz-pretimer", "wz-cald", "wz-cals"].forEach(function (id) { $(id)._touched = false; });
    setText("wz-outcome", "");
    refreshTimer();
  });
  refreshSetup();

  // ?wizselftest: three end-to-end scenarios with known answers (tests/generators-vectors.json and
  // tests/seedtime4-vectors.json) driven through the tab's own handlers once the tables have loaded; the
  // report is read back from the DOM by tests/run-tests.sh. Stores and the mode stay in memory.
  if (root.location && root.location.search.indexOf("wizselftest") !== -1) {
    var report = { modelStatus: {} };
    function finish() {
      var el = document.createElement("pre");
      el.id = "wz-selftest";
      el.textContent = JSON.stringify(report);
      document.body.appendChild(el);
    }
    function pick(rowIndex) { var tr = $("wz-results").querySelectorAll("tr.pick")[rowIndex]; if (tr) tr.click(); return !!tr; }
    function setIvs(arr) { IV_KEYS.forEach(function (k, i) { $("wz-min-" + k).value = arr[i]; $("wz-max-" + k).value = arr[i]; }); }
    function selectGame(g) { $("wz-game").value = g; $("wz-game").dispatchEvent(new Event("change")); }
    function whenLoaded(gen, cb) { loadData(gen, function (err) { if (err) { report.error = err.message; finish(); return; } cb(); }); }
    try {
      report.tabPresent = !!document.querySelector("button[data-tab=wizard]");
      report.countdownShared = !!Countdown;
      // scenario A: Gen 3 static, Ruby Groudon Method 4 from the typed seed 0 (vector static3[0], advance 3)
      selectGame("ruby");
      whenLoaded(3, function () {
        report.rubyModel = modelId();
        report.rubyStatus = $("wz-model").textContent.indexOf("rs/gba/boot-seed-v0") !== -1 && $("wz-model").textContent.indexOf("no hardware session") !== -1;
        report.rubyFixedSeed = $("wz-seed").value;
        $("wz-seed").value = "00000000";
        $("wz-kind").value = "static"; refreshEncounter();
        $("wz-static").value = "ruby/legend/groudon"; refreshEncounter();
        $("wz-method").value = "M4";
        setIvs([12, 22, 24, 30, 25, 27]);
        $("wz-nature").value = ""; $("wz-shiny").checked = false; $("wz-tid").value = "12345"; $("wz-sid").value = "54321";
        $("wz-minutes").value = "60";
        search();
        report.groudonRows = $("wz-results").querySelectorAll("tr.pick").length;
        report.groudonFirst = st.lastSearch && st.lastSearch.hits[0] ? { frame: st.lastSearch.hits[0].frame, pid: st.lastSearch.hits[0].pid, ivs: st.lastSearch.hits[0].ivArray } : null;
        report.groudonExactFirst = st.lastSearch && st.lastSearch.exactFirst ? st.lastSearch.exactFirst.first.frame : null;
        pick(0);
        report.groudonCard = $("wz-card").textContent;
        report.groudonProcedure = $("wz-procedure").textContent;
        report.groudonTimerTotal = $("wz-display").textContent;
        // the typed outcome: nature Naive (18) and the vector's IVs -> frame 3 hit, calibration unchanged (0 frames off)
        $("wz-got-nature").value = "18"; IV_KEYS.forEach(function (k, i) { $("wz-got-iv-" + k).value = [12, 22, 24, 30, 25, 27][i]; });
        recordGen3();
        report.groudonOutcome = $("wz-outcome").textContent.split("\n")[0];
        report.groudonStored = JSON.parse(storageGet(STORE_KEY) || "{}");
        // a 6-IV request on Emerald's fixed seed: no hit in an hour, the honest limit and the exact first frame stated
        selectGame("emerald");
        whenLoaded(3, function () {
          $("wz-kind").value = "static"; refreshEncounter();
          $("wz-static").value = "rse/starter/treecko"; refreshEncounter();
          $("wz-method").value = "M1";
          setIvs([31, 31, 31, 31, 31, 31]); $("wz-nature").value = ""; $("wz-tid").value = ""; $("wz-sid").value = "";
          $("wz-minutes").value = "60";
          search();
          report.emeraldSeed = $("wz-seed").value;
          report.flawlessRows = $("wz-results").querySelectorAll("tr.pick").length;
          report.flawlessOut = $("wz-search-out").textContent;
          // scenario B: Gen 3 wild, Emerald Route 111 grass from the typed seed 1C71C71C (vector wild3[0], advance 7)
          $("wz-seed").value = "1C71C71C";
          $("wz-kind").value = "wild"; refreshEncounter();
          $("wz-table").value = "6"; refreshEncounter();
          $("wz-enc-kind").value = "grass"; refreshEncounter();
          var wanted = report.wildWanted = { dex: 328, ivs: null };
          var vec = null;
          try {
            var sl = slotsFor("emerald", 6, "grass", {});
            var res = G.gen3Wild(0x1c71c71c, { game: "emerald", method: "M1", encounter: "grass", slots: sl.slots, rate: sl.rate, lead: null, options: {}, tid: 12345, sid: 54321, frameStart: 7, frameCount: 1 });
            vec = res[0];
          } catch (e) { report.wildSetupError = e.message; }
          if (vec) {
            wanted.dex = vec.species; wanted.ivs = vec.ivArray; wanted.pid = vec.pid; wanted.nature = vec.nature;
            $("wz-species").value = String(vec.species); refreshWanted();
            setIvs(vec.ivArray); $("wz-nature").value = String(vec.nature); $("wz-lead").value = ""; $("wz-tid").value = "12345"; $("wz-sid").value = "54321";
            search();
            report.wildRows = $("wz-results").querySelectorAll("tr.pick").length;
            report.wildFirst = st.lastSearch && st.lastSearch.hits[0] ? { frame: st.lastSearch.hits[0].frame, pid: st.lastSearch.hits[0].pid, ivs: st.lastSearch.hits[0].ivArray, slot: st.lastSearch.hits[0].encounterSlot } : null;
            pick(0);
            report.wildCard = $("wz-card").textContent;
            report.wildOutHasShare = $("wz-search-out").textContent.indexOf("slot share") !== -1;
          }
          // scenario C: Gen 4, the design's gate seed 7B0448D1 -> frame 0 for a flawless Method 1 static (Platinum Turtwig)
          selectGame("platinum");
          whenLoaded(4, function () {
            report.platinumModel = modelId();
            report.platinumStatus = $("wz-model").textContent.indexOf("has landed a seed chosen by this tool") !== -1;
            $("wz-kind").value = "static"; refreshEncounter();
            $("wz-static").value = "pt/starter/turtwig"; refreshEncounter();
            setIvs([31, 31, 31, 31, 31, 31]); $("wz-nature").value = ""; $("wz-tid").value = ""; $("wz-sid").value = ""; $("wz-lead").value = "";
            $("wz-maxframe").value = "100"; $("wz-year-min").value = "2000"; $("wz-year-max").value = "2000"; $("wz-delay-min").value = "0"; $("wz-delay-max").value = "65535"; $("wz-delay-target").value = "18641";
            search();
            report.gateOut = $("wz-search-out").textContent;
            var rows = st.lastSearch && st.lastSearch.rows ? st.lastSearch.rows : [];
            var gate = null, gateIndex = -1;
            rows.forEach(function (r, i) { if (gate === null && r.seed === 0x7b0448d1 && r.frame === 0) { gate = r; gateIndex = i; } });
            report.gateRow = gate ? { seed: hex8(gate.seed), frame: gate.frame, hour: gate.hour, delay: gate.delay, year: gate.year, month: gate.month, day: gate.day, minute: gate.minute, second: gate.second, pid: hex8(gate.mon.pid), ivs: gate.mon.ivArray, nature: gate.mon.natureName } : null;
            if (gateIndex >= 0) pick(gateIndex);
            report.gateCard = $("wz-card").textContent;
            report.gateProcedure = $("wz-procedure").textContent;
            report.gateTimerNote = $("wz-timer-note").textContent;
            // the typed coin flips of the target seed itself identify delay 18641 (calibrateRows row 0)
            var flips = gen4.coinFlips(0x7b0448d1, 12);
            $("wz-got-calls").value = flips; $("wz-delay-range").value = "100"; $("wz-second-range").value = "1";
            recordGen4();
            report.gateOutcome = $("wz-outcome").textContent;
            report.gateFlips = flips;
            // a neighbour's flips (delay 18645) identify that delay and move the calibrated delay by 4 x 0.75 = 3
            $("wz-got-calls").value = gen4.coinFlips(0x7b0448d5, 12);
            recordGen4();
            report.gateNeighbourOutcome = $("wz-outcome").textContent;
            report.caldAfter = $("wz-cald").value;
            // scenario D: Gen 4 wild, Platinum Route 222 grass with a Magnet Pull lead (vector wild4[3], seed 5D1745D0, frame 0)
            $("wz-kind").value = "wild"; refreshEncounter();
            $("wz-table").value = "170"; refreshEncounter();
            $("wz-enc-kind").value = "grass"; refreshEncounter();
            $("wz-time").value = "morning"; refreshEncounter();
            $("wz-lead").value = "MAGNET_PULL";
            var sl4 = slotsFor("platinum", 170, "grass", { time: "morning" });
            report.wild4Slot7 = sl4.slots[7].species.dex;
            $("wz-species").value = String(sl4.slots[7].species.dex); refreshWanted();
            setIvs([18, 30, 14, 17, 17, 14]); $("wz-nature").value = ""; $("wz-tid").value = "12345"; $("wz-sid").value = "54321";
            $("wz-maxframe").value = "50"; $("wz-year-min").value = "2000"; $("wz-year-max").value = "2099"; $("wz-delay-min").value = "0"; $("wz-delay-max").value = "65535"; $("wz-delay-target").value = "600";
            search();
            var rows4 = st.lastSearch && st.lastSearch.rows ? st.lastSearch.rows : [];
            var w4 = null;
            rows4.forEach(function (r) { if (w4 === null && r.seed === 0x5d1745d0 && r.frame === 0) w4 = r; });
            report.wild4Row = w4 ? { seed: hex8(w4.seed), frame: w4.frame, pid: w4.mon.pid, ivs: w4.mon.ivArray, slot: w4.mon.encounterSlot, level: w4.mon.level } : null;
            report.wild4Out = $("wz-search-out").textContent;
            // the mode wall: a sample made in PRACTICE / HUNT lands in the practice store and is not in force back in RUN
            report.modeDefault = MODE.get();
            var runStoreBefore = storageGet(STORE_KEY);
            $("mode-practice").checked = true; $("mode-practice").dispatchEvent(new Event("change"));
            report.modeAfterToggle = MODE.get();
            report.bannerShown = $("mode-banner").hidden === false;
            report.timerNoteInPractice = $("wz-timer-note").textContent.split("\n")[0];
            selectGame("platinum");
            whenLoaded(4, function () {
              $("wz-kind").value = "static"; refreshEncounter();
              $("wz-static").value = "pt/starter/turtwig"; refreshEncounter();
              setIvs([31, 31, 31, 31, 31, 31]); $("wz-tid").value = ""; $("wz-sid").value = ""; $("wz-lead").value = "";
              $("wz-maxframe").value = "100"; $("wz-year-min").value = "2000"; $("wz-year-max").value = "2000"; $("wz-delay-min").value = "0"; $("wz-delay-max").value = "65535"; $("wz-delay-target").value = "18641";
              search();
              var rows2 = st.lastSearch.rows, gi = -1;
              rows2.forEach(function (r, i) { if (gi < 0 && r.seed === 0x7b0448d1 && r.frame === 0) gi = i; });
              pick(gi);
              report.caldInPracticeBefore = $("wz-cald").value;
              $("wz-got-calls").value = gen4.coinFlips(0x7b0448d5, 12);
              recordGen4();
              report.practiceOutcome = $("wz-outcome").textContent.split("\n")[0];
              report.practiceStored = JSON.parse(storageGet(storeKeyFor(MODE.PRACTICE)) || "{}");
              report.runStoreUnchangedByPractice = storageGet(STORE_KEY) === runStoreBefore;
              $("mode-practice").checked = false; $("mode-practice").dispatchEvent(new Event("change"));
              report.modeBack = MODE.get();
              report.caldBackInRun = $("wz-cald").value;
              // a practice sample planted in the RUN store is named and never in force
              var planted = report.practiceStored["platinum/NDS_SLOT1"].samples[0];
              st.store["platinum/NDS_SLOT1"].samples.push(planted);
              refreshTimer();
              report.runNoteAboutPractice = $("wz-timer-note").textContent.indexOf("recorded in PRACTICE / HUNT mode, not RUN") !== -1;
              report.caldWithPlanted = $("wz-cald").value;
              st.store["platinum/NDS_SLOT1"].samples.pop();
              refreshTimer();
              var real = {};
              try { [STORE_KEY, storeKeyFor(MODE.PRACTICE), MODE.KEY].forEach(function (k) { real[k] = root.localStorage ? root.localStorage.getItem(k) : null; }); } catch (e) { real.error = String(e); }
              report.realStorage = real;
              finish();
            });
          });
        });
      });
    } catch (e) {
      report.error = String(e && e.stack || e);
      finish();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
