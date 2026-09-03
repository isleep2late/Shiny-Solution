// The RUN / PRACTICE-HUNT wall's switch for the web app, and so for the Electron app and the
// mobile bundle, which are this page. Loaded before app.js and gen1tid-ui.js.
//
// RUN is the default and needs no action: human input only (an anchor press, a typed outcome),
// run-legal. PRACTICE / HUNT must be turned on explicitly; while it is on, a banner sits above
// every tab. Every calibration record and every logged attempt carries the mode it was made in,
// and each mode has its own calibration store (storeKey), so a practice-derived correction is
// never in force in RUN mode; a record of the other mode that does turn up in a store is left out
// and said so (splitByMode), the way samples under another methodology are.
//
// Tools that read a capture live only in webapp/hunt/ (never in this page, the static site or the
// mobile bundle: build-mobile-bundle.mjs and electron/build.sh refuse that directory without
// --with-hunt) and in RNG Solution's rngsolution/watch.py, which refuses to start without
// --practice. This page has no such tool; the switch here is the same wall seen from the RUN side.
(function (root) {
  var RUN = "run", PRACTICE = "practice";
  var KEY = "shinySolution.mode";              // absent or anything but "practice" means RUN
  var BANNER = "PRACTICE / HUNT mode - tools that read the capture are enabled; not for submitted runs";
  // Under ?g1selftest (tests/run-tests.sh drives the page headless) the mode lives in memory only,
  // like the Gen 1 TID tab's stores, so the self-test never flips a visitor's mode.
  var MEMORY_ONLY = !!(root.location && typeof root.location.search === "string" && root.location.search.indexOf("g1selftest") !== -1);
  var mem = null;
  var listeners = [];

  function isNil(x) { return x === null || x === undefined; }
  function isMode(m) { return m === RUN || m === PRACTICE; }
  function checkMode(m) {
    if (!isMode(m)) throw new Error("mode must be \"run\" or \"practice\", not " + JSON.stringify(m));
    return m;
  }
  function label(m) { return checkMode(m) === PRACTICE ? "PRACTICE / HUNT" : "RUN"; }

  function get() {
    if (MEMORY_ONLY) return mem || RUN;
    try { if (root.localStorage) return root.localStorage.getItem(KEY) === PRACTICE ? PRACTICE : RUN; } catch (e) { /* private mode */ }
    return mem || RUN;
  }
  function set(m) {
    checkMode(m);
    var before = get();
    mem = m;
    if (!MEMORY_ONLY) {
      try {
        if (root.localStorage) { if (m === PRACTICE) root.localStorage.setItem(KEY, m); else root.localStorage.removeItem(KEY); }
      } catch (e) { /* quota / private mode: the session keeps it in memory */ }
    }
    if (before !== m) listeners.forEach(function (fn) { fn(m, before); });
    return m;
  }
  function isPractice() { return get() === PRACTICE; }
  function subscribe(fn) { listeners.push(fn); }

  // The mode a stored record was made in. A record without one was written before modes existed,
  // by a head that had no capture-reading tool at all (nothing in this page, the desktop app or the
  // bundle read a capture then), so it is a RUN record; a practice-derived record always carries
  // "practice", stamped by the head that made it.
  function effectiveMode(record) {
    var m = record ? record.mode : null;
    return isNil(m) ? RUN : m;
  }
  // (the records made in this mode, all the others); the others are never averaged in.
  function splitByMode(records, mode) {
    checkMode(mode);
    return {
      kept: records.filter(function (r) { return effectiveMode(r) === mode; }),
      rest: records.filter(function (r) { return effectiveMode(r) !== mode; })
    };
  }
  // Each mode's store is its own key: RUN keeps the key as it was, PRACTICE / HUNT gets ".practice".
  function storeKey(baseKey, mode) { return checkMode(mode) === PRACTICE ? baseKey + ".practice" : baseKey; }

  // The banner and the switch (index.html #mode-bar), shown above every tab. They sit before the
  // scripts, so mounting happens as this file runs; a page that loads it earlier gets DOMContentLoaded.
  function mount() {
    var banner = document.getElementById("mode-banner");
    var toggle = document.getElementById("mode-practice");
    if (!banner || !toggle) return false;
    banner.textContent = BANNER;
    function render(m) {
      banner.hidden = m !== PRACTICE;
      toggle.checked = m === PRACTICE;
      document.body.classList.toggle("practice", m === PRACTICE);
    }
    toggle.addEventListener("change", function () { set(toggle.checked ? PRACTICE : RUN); });
    subscribe(render);
    render(get());
    return true;
  }

  var api = {
    RUN: RUN, PRACTICE: PRACTICE, KEY: KEY, BANNER: BANNER, MEMORY_ONLY: MEMORY_ONLY,
    isMode: isMode, checkMode: checkMode, label: label, get: get, set: set, isPractice: isPractice, subscribe: subscribe,
    effectiveMode: effectiveMode, splitByMode: splitByMode, storeKey: storeKey, mount: mount
  };
  root.ShinyMode = api;
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof document !== "undefined" && !mount()) document.addEventListener("DOMContentLoaded", mount);
})(typeof window !== "undefined" ? window : globalThis);
