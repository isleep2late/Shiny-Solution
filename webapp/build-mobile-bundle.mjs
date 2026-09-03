import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: node build-mobile-bundle.mjs <output.ts>");
  process.exit(2);
}

let html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "app.css"), "utf8") +
  "\nbody { padding: 10px; } button { min-height: 40px; } input, select { min-height: 38px; font-size: 16px; }\n";
html = html.replace('<link rel="stylesheet" href="app.css">', "<style>\n" + css + "\n</style>");
for (const name of ["rng.js", "gen4.js", "gen12.js", "gen1tid.js", "timers.js", "gen5.js"]) {
  const js = readFileSync(join(here, "..", "core", name), "utf8");
  html = html.replace(`<script src="${name}"></script>`, "<script>\n" + js + "\n</script>");
}
// core/data/*.json inlined as the same globals webapp/sync-core.sh writes into gen1-data.js
// ("</" is escaped so no JSON string can end the script element).
const inlineJson = (name) => readFileSync(join(here, "..", "core", "data", name), "utf8").trim().replace(/<\//g, "<\\/");
const dataJs = "window.ShinyGen1Data = " + inlineJson("gen1-tid.json") + ";\nwindow.ShinyGen3SidData = " + inlineJson("gen3-sid.json") + ";\n";
html = html.replace('<script src="gen1-data.js"></script>', "<script>\n" + dataJs + "</script>");
for (const local of ["downloads.js", "app.js", "gen1tid-ui.js"]) {
  const js = readFileSync(join(here, local), "utf8");
  html = html.replace(`<script src="${local}"></script>`, "<script>\n" + js + "\n</script>");
}
if (html.includes("<script src=")) {
  console.error("unresolved script tag remains");
  process.exit(1);
}
const ts = "export const shinySolutionHtml = " + JSON.stringify(html) + ";\n";
writeFileSync(outPath, ts);
console.log(`wrote ${outPath} (${ts.length} bytes)`);
