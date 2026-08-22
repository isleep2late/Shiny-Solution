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
for (const name of ["rng.js", "gen4.js", "gen12.js"]) {
  const js = readFileSync(join(here, "..", "core", name), "utf8");
  html = html.replace(`<script src="${name}"></script>`, "<script>\n" + js + "\n</script>");
}
for (const local of ["downloads.js", "app.js"]) {
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
