// Inlines the web app into one HTML string for the Hackmons Hub mobile screen.
//   node build-mobile-bundle.mjs [--with-hunt] <output.ts>
// The wall: webapp/hunt/ (capture-watching code, PRACTICE / HUNT only) never goes into the bundle
// unless --with-hunt is passed explicitly. Without it, a page that references a script under
// hunt/ is refused, and a bundle that turns out to contain any hunt file's text is refused too.
// The published bundle is built without the flag (tests/run-tests.sh checks both ways).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const withHunt = args.includes("--with-hunt");
const unknown = args.filter((a) => a.startsWith("--") && a !== "--with-hunt");
const outPath = args.filter((a) => !a.startsWith("--"))[0];
if (!outPath || unknown.length) {
  console.error("usage: node build-mobile-bundle.mjs [--with-hunt] <output.ts>");
  process.exit(2);
}

const huntDir = join(here, "hunt");
function huntFiles(dir) {
  let out = [];
  let names = [];
  try { names = readdirSync(dir).sort(); } catch (e) { return out; }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(huntFiles(p));
    else out.push(p);
  }
  return out;
}
function refuse(why) {
  console.error("refusing to build the mobile bundle: " + why);
  console.error("  webapp/hunt/ is PRACTICE / HUNT code (it reads the capture) and never ships in the static site or the mobile bundle;");
  console.error("  pass --with-hunt for a practice build, never for the published one (webapp/hunt/README.md).");
  process.exit(1);
}

let html = readFileSync(join(here, "index.html"), "utf8");
const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
const huntRefs = scriptSrcs.filter((src) => /(^|\/)hunt\//.test(src));
if (huntRefs.length && !withHunt) refuse("index.html references " + huntRefs.join(", ") + " under webapp/hunt/ and --with-hunt was not passed");

const css = readFileSync(join(here, "app.css"), "utf8") +
  "\nbody { padding: 10px; } button { min-height: 40px; } input, select { min-height: 38px; font-size: 16px; }\n";
html = html.replace('<link rel="stylesheet" href="app.css">', "<style>\n" + css + "\n</style>");
for (const name of ["rng.js", "gen4.js", "gen12.js", "gen1tid.js", "timers.js", "gen5.js", "seedtime4.js", "generators.js", "gen2tid.js"]) {
  const js = readFileSync(join(here, "..", "core", name), "utf8");
  html = html.replace(`<script src="${name}"></script>`, "<script>\n" + js + "\n</script>");
}
// core/data/*.json inlined as the same globals webapp/sync-core.sh writes into gen1-data.js
// ("</" is escaped so no JSON string can end the script element).
const inlineJson = (name) => readFileSync(join(here, "..", "core", "data", name), "utf8").trim().replace(/<\//g, "<\\/");
const dataJs = "window.ShinyGen1Data = " + inlineJson("gen1-tid.json") + ";\nwindow.ShinyGen3SidData = " + inlineJson("gen3-sid.json") + ";\nwindow.ShinyGen2TidData = " + inlineJson("gen2-tid.json") + ";\nwindow.ShinyCitations = " + inlineJson("citations.json") + ";\n";
html = html.replace('<script src="gen1-data.js"></script>', "<script>\n" + dataJs + "</script>");
// The wizard's species, encounter and static tables (4.7 MB of JSON) are not inlined: the bundle is one HTML
// string with no file beside it to load lazily, so the wizard tab is told and says the tables need the static
// page or the Electron app (docs/DATA.md records the choice).
html = html.replace('<script src="wizard-ui.js"></script>', '<script>\nwindow.SHINY_WIZARD_NO_DATA = "the mobile bundle inlines no species, encounter or static tables";\n</script>\n<script src="wizard-ui.js"></script>');
// No service worker and no manifest in the bundle: it is one HTML string for a WebView with no file beside it, so the
// registration element (index.html, id sw-register) and the manifest and icon links go, and the page's status line
// (#sw-status) is written with the reason, SHINY_NO_SERVICE_WORKER, by the script that takes the element's place
// (tests/run-tests.sh reads it back from the bundle's DOM in headless Chrome). A bundle that still carries a
// registration call is refused.
const swElement = html.match(/<script id="sw-register">[\s\S]*?<\/script>\n?/);
if (!swElement) { console.error("index.html has no <script id=\"sw-register\"> element to strip"); process.exit(1); }
html = html.replace(swElement[0], '<script>\nwindow.SHINY_NO_SERVICE_WORKER = "the mobile bundle is one HTML string for the Hub app, with no sw.js beside it";\n(function () { var el = document.getElementById("sw-status"); if (el) el.textContent = "offline copy: not registered: " + window.SHINY_NO_SERVICE_WORKER + " (build " + window.SHINY_BUILD + ")"; })();\n</script>\n');
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n?/g, "");
for (const local of ["downloads.js", "mode.js", "footnotes.js", "app.js", "gen1tid-ui.js", "gen2tid-ui.js", "wizard-ui.js"]) {
  const js = readFileSync(join(here, local), "utf8");
  html = html.replace(`<script src="${local}"></script>`, "<script>\n" + js + "\n</script>");
}
if (withHunt) {
  // a practice build: the referenced hunt scripts in place, every other hunt/*.js appended before </body>
  for (const src of huntRefs) {
    const js = readFileSync(join(here, src), "utf8");
    html = html.replace(`<script src="${src}"></script>`, "<script>\n" + js + "\n</script>");
  }
  const extra = huntFiles(huntDir).filter((p) => p.endsWith(".js") && !huntRefs.includes(relative(here, p)));
  const tail = "<script>\nwindow.SHINY_HUNT_BUNDLED = true;\n</script>\n" +
    extra.map((p) => "<script>\n" + readFileSync(p, "utf8") + "\n</script>\n").join("");
  html = html.replace("</body>", tail + "</body>");
  console.error("--with-hunt: " + (huntRefs.length + extra.length) + " file(s) from webapp/hunt/ bundled (a PRACTICE / HUNT build, not for publishing)");
} else {
  // nothing from webapp/hunt/ may be in the page, whatever path it took
  for (const p of huntFiles(huntDir)) {
    const text = readFileSync(p, "utf8").trim();
    if (text.length >= 20 && html.includes(text)) refuse("the bundle contains the text of " + relative(here, p) + " without --with-hunt");
  }
}
if (html.includes("<script src=")) {
  console.error("unresolved script tag remains");
  process.exit(1);
}
if (/serviceWorker\.register\(/.test(html) || /rel="manifest"/.test(html)) {
  console.error("the bundle still registers a service worker or links the manifest");
  process.exit(1);
}
const ts = "export const shinySolutionHtml = " + JSON.stringify(html) + ";\n";
writeFileSync(outPath, ts);
console.log(`wrote ${outPath} (${ts.length} bytes${withHunt ? ", WITH webapp/hunt/" : ""})`);
