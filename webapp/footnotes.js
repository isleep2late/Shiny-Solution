// The decomp citation footnotes shared by the Gen 1 TID, Gen 2 TID and wizard tabs (the desktop panels render the
// same text through app/App/Citations.cs). The registry core/data/citations.json (generated from docs/FACTS.md by
// tools/gen-citations.py, every cited line read in pret) is read as window.ShinyCitations (webapp/sync-core.sh
// writes it into gen1-data.js, the mobile bundle inlines it); node callers pass the parsed file to setCitations.
// A tab marks each protocol step, target line, schedule line or verify line with [^n] over its table of sources and
// lists them as a Sources block: a decomp line is printed with the docs/FACTS.md section the registry files it
// under; a source with no decomp line is SYNTHESISED (a timer model, a community convention) or, when it is a
// measured constant, printed under its validation status word (EMULATOR-EXACT, HARDWARE-VALIDATED n, EMPIRICAL);
// a citation the registry does not carry is printed as NOT IN THE REGISTRY, which procedureProblems reports and
// the self-tests refuse. Loaded after gen1-data.js and before the three tab scripts (index.html, the mobile
// bundle, the Electron stage).
(function (root) {
  var CITATIONS = null;
  function setCitations(registry) {
    CITATIONS = null;
    if (!registry || !Array.isArray(registry.entries)) return;
    var by = {};
    registry.entries.forEach(function (e) { by[e.cite] = e; });
    CITATIONS = { byCite: by, count: registry.entries.length };
  }
  function citationsLoaded() { return !!CITATIONS; }
  if (root.ShinyCitations) setCitations(root.ShinyCitations);

  var HEADER = "Sources: decomp lines from docs/FACTS.md through the registry core/data/citations.json; SYNTHESISED marks a source with no decomp line.";
  var STATUS_NOTE = " A measured source is printed under its validation status: EMULATOR-EXACT, HARDWARE-VALIDATED n or EMPIRICAL.";
  // one source: {cite, claim} a decomp line; {synth, claim} no decomp line; {measured, status, claim} a measured constant
  // under its status word (EMPIRICAL when none is given)
  function footnoteText(n, src) {
    var head = "[^" + n + "] ";
    if (src.synth) return head + "SYNTHESISED (no decomp line; " + src.synth + "): " + src.claim;
    if (src.measured) return head + (src.status || "EMPIRICAL") + " (no decomp line; " + src.measured + "): " + src.claim;
    var e = CITATIONS && CITATIONS.byCite[src.cite];
    if (!e) return head + src.cite + " NOT IN THE REGISTRY (" + (CITATIONS ? "core/data/citations.json carries no such line of docs/FACTS.md" : "no citation registry is loaded") + "): " + src.claim;
    return head + src.cite + " (docs/FACTS.md: " + e.section + "): " + src.claim;
  }
  // one procedure's footnotes over a table of sources: mark(keys) returns the markers for a line, lines() the Sources
  // block. With no order the numbers follow the order of first use (the wizard); with an order the numbers are fixed
  // up front, so a line rendered apart from the block (a target line, a verify output) carries the block's numbers,
  // and the block lists the sources used, in that order.
  function footnotes(sources, order) {
    var keys = (order || []).slice(), used = {};
    keys.forEach(function (k) { if (!sources[k]) throw new Error("no source named " + k); });
    return {
      mark: function (list) {
        return list.map(function (k) {
          if (!sources[k]) throw new Error("no source named " + k);
          var i = keys.indexOf(k);
          if (i < 0) { keys.push(k); i = keys.length - 1; }
          used[k] = true;
          return " [^" + (i + 1) + "]";
        }).join("");
      },
      lines: function () {
        var listed = keys.filter(function (k) { return !order || used[k]; });
        var measured = listed.some(function (k) { return !!sources[k].measured; });
        var out = [HEADER + (measured ? STATUS_NOTE : "")];
        keys.forEach(function (k, i) { if (!order || used[k]) out.push("  " + footnoteText(i + 1, sources[k])); });
        return out;
      }
    };
  }
  function procedureProblems(lines) {
    return (Array.isArray(lines) ? lines : String(lines).split("\n")).filter(function (l) { return /^  \[\^\d+\] .* NOT IN THE REGISTRY \(/.test(l); });
  }
  var api = { HEADER: HEADER, STATUS_NOTE: STATUS_NOTE, setCitations: setCitations, citationsLoaded: citationsLoaded, footnoteText: footnoteText, footnotes: footnotes, procedureProblems: procedureProblems };
  root.ShinyFootnotes = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
