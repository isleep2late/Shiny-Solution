// The service worker (webapp/sw.js) driven in a node vm sandbox with a fake CacheStorage, fetch and clients:
// install precaches the app shell (every script index.html loads, the stylesheet, the manifest, the icons), activate
// deletes the caches of other builds and claims the clients, and, with the network gone, a fetch for a shell file, a
// navigation (any page URL under the scope) and a data file opened once before are all answered from the caches; the
// data route is cache-first (a second online request never reaches the network), a data file never opened is not
// served offline, and cross-origin requests are left alone. The build stamp in sw.js must be the one in index.html
// and the precache list must name every file the page loads, each present under webapp/.
// The build stamp must also be what the shipped sources hash to now (sync-core.sh's recipe recomputed here).
// usage: node test-sw.cjs [sw.js] [index.html]      (tests/run-tests.sh also runs it on a copy of sw.js with the
//                                                      data route removed, which must fail)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const swPath = process.argv[2] || path.join(root, "webapp", "sw.js");
const indexPath = process.argv[3] || path.join(root, "webapp", "index.html");
const ORIGIN = "http://127.0.0.1:41234";
const BASE = ORIGIN + "/app/";
let failures = 0, checks = 0;
function assert(label, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error("FAIL " + label + (detail === undefined ? "" : "\n  " + JSON.stringify(detail))); }
}

// ---- the fakes ---------------------------------------------------------------------------------
const network = { online: true, log: [], files: {} };
function toRequest(x) { return typeof x === "string" ? new Request(new URL(x, BASE + "sw.js").href) : x; }
function fakeFetch(input) {
  const req = toRequest(input);
  network.log.push(req.url);
  if (!network.online) return Promise.reject(new TypeError("Failed to fetch (offline)"));
  const p = new URL(req.url).pathname;
  const body = network.files[p];
  if (body === undefined) return Promise.resolve(new Response("not found", { status: 404 }));
  return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/plain" } }));
}
class FakeCache {
  constructor() { this.map = new Map(); }
  keyOf(input, opts) { const u = new URL(toRequest(input).url); if (opts && opts.ignoreSearch) u.search = ""; return u.href; }
  async put(input, response) { this.map.set(this.keyOf(input), response); }
  async add(input) { const r = await fakeFetch(toRequest(input)); if (!r.ok) throw new TypeError("addAll: bad response for " + toRequest(input).url); await this.put(input, r); }
  async addAll(list) { for (const x of list) await this.add(x); }
  async match(input, opts) {
    const want = this.keyOf(input, opts);
    for (const [k, v] of this.map) { const kk = opts && opts.ignoreSearch ? k.replace(/\?.*$/, "") : k; if (kk === want) return v.clone(); }
    return undefined;
  }
  urls() { return [...this.map.keys()]; }
}
const store = new Map();
const caches = {
  async open(name) { if (!store.has(name)) store.set(name, new FakeCache()); return store.get(name); },
  async keys() { return [...store.keys()]; },
  async delete(name) { return store.delete(name); },
  async has(name) { return store.has(name); },
  async match(input, opts) { for (const c of store.values()) { const r = await c.match(input, opts); if (r) return r; } return undefined; }
};
const listeners = {};
let claimed = 0, skipped = 0;
const self = {
  location: new URL(BASE + "sw.js"),
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  skipWaiting() { skipped++; return Promise.resolve(); },
  clients: { claim() { claimed++; return Promise.resolve(); } }
};
const sandbox = { self, caches, fetch: fakeFetch, URL, Request, Response, Promise, console };
sandbox.self.caches = caches;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(swPath, "utf8"), sandbox, { filename: swPath });

async function lifecycle(type) {
  const waits = [];
  const ev = { waitUntil(p) { waits.push(p); } };
  for (const fn of listeners[type] || []) fn(ev);
  await Promise.all(waits);
}
async function fetchEvent(url, mode) {
  const request = new Request(url, { method: "GET", mode: mode === "navigate" ? undefined : mode });
  if (mode === "navigate") Object.defineProperty(request, "mode", { value: "navigate" });
  let responded = null;
  const ev = { request, respondWith(p) { responded = Promise.resolve(p); } };
  for (const fn of listeners.fetch || []) fn(ev);
  if (!responded) return { handled: false };
  try { const r = await responded; return { handled: true, response: r, text: r ? await r.text() : null }; }
  catch (e) { return { handled: true, error: e }; }
}

// ---- the sources ---------------------------------------------------------------------------------
const swSrc = fs.readFileSync(swPath, "utf8");
const page = fs.readFileSync(indexPath, "utf8");
const build = (swSrc.match(/^const BUILD = "([0-9a-f]{12})";/m) || [])[1];
const pageBuild = (page.match(/window\.SHINY_BUILD = "([0-9a-f]{12})"/) || [])[1];
assert("sw.js carries a 12-hex build stamp", !!build);
assert("index.html carries the same build stamp", !!pageBuild && pageBuild === build, { build, pageBuild });
// The stamp must be the one webapp/sync-core.sh computes from the shipped sources as they are now (the same SHA-256 over
// the same files in the same order, the two stamp lines left out): a shipped file edited without a new sync would keep
// the old stamp, and the browser would never drop the old caches.
const crypto = require("crypto");
function recomputeStamp() {
  const h = crypto.createHash("sha256");
  const core = (n) => path.join(root, "core", n), data = (n) => path.join(root, "core", "data", n), web = (n) => path.join(path.dirname(indexPath), n);
  const files = ["rng.js", "gen4.js", "gen12.js", "gen1tid.js", "timers.js", "gen5.js", "seedtime4.js", "generators.js", "gen2tid.js"].map(core)
    .concat(["gen1-tid.json", "gen3-sid.json", "gen2-tid.json", "citations.json", "species-gen3.json", "encounters-gen3.json", "statics-gen3.json", "species-gen4.json", "encounters-gen4.json", "statics-gen4.json"].map(data))
    .concat(["app.css", "app.js", "downloads.js", "mode.js", "gen1tid-ui.js", "gen2tid-ui.js", "wizard-ui.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"].map(web));
  for (const f of files) h.update(fs.readFileSync(f));
  const withoutLines = (text, re) => { const lines = text.split("\n"); if (lines[lines.length - 1] === "") lines.pop(); return lines.filter((l) => !re.test(l)).map((l) => l + "\n").join(""); };
  h.update(withoutLines(page, /window\.SHINY_BUILD = "/));
  h.update(withoutLines(swSrc, /^const BUILD = "/));
  return h.digest("hex").slice(0, 12);
}
const recomputed = recomputeStamp();
assert("the build stamp is the one the shipped sources hash to now (run webapp/sync-core.sh after editing a shipped file)", recomputed === build, { build, recomputed });
const shellList = (swSrc.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1];
const shell = shellList ? [...shellList.matchAll(/"([^"]+)"/g)].map((m) => m[1]).concat("index.html") : [];
const pageScripts = [...page.matchAll(/<script[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
const pageLinks = [...page.matchAll(/<link[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);
for (const f of pageScripts.concat(pageLinks)) assert("the precache names " + f, shell.includes(f));
for (const icon of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"]) assert("the precache names " + icon, shell.includes(icon));
const webappDir = path.dirname(indexPath);
for (const f of shell) assert("precached file exists under webapp/: " + f, fs.existsSync(path.join(webappDir, f)));
assert("the precache names no data file (those are cached on first use)", !shell.some((f) => /^data\//.test(f)));

// the fake origin serves the shell and the two table files
for (const f of shell) network.files["/app/" + f] = "shell:" + f;
network.files["/app/data/wizard-gen3.js"] = "window.ShinyWizardData3 = {};";
network.files["/app/data/wizard-gen4.js"] = "window.ShinyWizardData4 = {};";

(async () => {
  // an old build's caches, to be dropped at activate
  store.set("shiny-shell-000000000000", new FakeCache());
  store.set("shiny-data-000000000000", new FakeCache());
  store.set("other-app-cache", new FakeCache());

  await lifecycle("install");
  const shellCache = store.get("shiny-shell-" + build);
  assert("install opens the shell cache of this build", !!shellCache, [...store.keys()]);
  for (const f of shell) assert("install precaches " + f, !!shellCache && shellCache.urls().includes(BASE + f));
  assert("install fetched only the shell", network.log.every((u) => shell.some((f) => u === BASE + f)) && network.log.length === shell.length, network.log);
  assert("install skips waiting", skipped === 1);

  await lifecycle("activate");
  assert("activate deletes the other build's caches", !store.has("shiny-shell-000000000000") && !store.has("shiny-data-000000000000"), [...store.keys()]);
  assert("activate keeps this build's cache and caches that are not the app's", store.has("shiny-shell-" + build) && store.has("other-app-cache"));
  assert("activate claims the clients", claimed === 1);

  // the wizard tab opens once online: the Gen 3 tables come from the network and are put into the data cache
  network.log.length = 0;
  let r = await fetchEvent(BASE + "data/wizard-gen3.js", "no-cors");
  assert("data file (first use, online) is served", r.handled && r.text === "window.ShinyWizardData3 = {};", r.error && String(r.error));
  assert("data file (first use, online) came from the network", network.log.length === 1 && network.log[0] === BASE + "data/wizard-gen3.js");
  const dataCache = store.get("shiny-data-" + build);
  assert("data file (first use) is put into the data cache of this build", !!dataCache && dataCache.urls().includes(BASE + "data/wizard-gen3.js"));
  network.log.length = 0;
  r = await fetchEvent(BASE + "data/wizard-gen3.js", "no-cors");
  assert("data file (second use, online) is cache-first: the network is not asked", r.handled && r.text === "window.ShinyWizardData3 = {};" && network.log.length === 0, network.log);

  // the server is gone
  network.online = false;
  network.log.length = 0;
  r = await fetchEvent(BASE + "app.js", "no-cors");
  assert("offline: a shell script is served from the cache", r.handled && r.text === "shell:app.js", r.error && String(r.error));
  r = await fetchEvent(BASE + "app.css", "no-cors");
  assert("offline: the stylesheet is served from the cache", r.handled && r.text === "shell:app.css");
  r = await fetchEvent(BASE + "icons/icon-192.png", "no-cors");
  assert("offline: an icon is served from the cache", r.handled && r.text === "shell:icons/icon-192.png");
  r = await fetchEvent(BASE + "manifest.webmanifest", "no-cors");
  assert("offline: the manifest is served from the cache", r.handled && r.text === "shell:manifest.webmanifest");
  r = await fetchEvent(BASE + "index.html", "navigate");
  assert("offline: a navigation to index.html is the cached shell", r.handled && r.text === "shell:index.html", r.error && String(r.error));
  r = await fetchEvent(BASE + "index.html?g1selftest", "navigate");
  assert("offline: a navigation with a query is the cached shell", r.handled && r.text === "shell:index.html");
  r = await fetchEvent(BASE, "navigate");
  assert("offline: a navigation to the directory is the cached shell (the fallback)", r.handled && r.text === "shell:index.html");
  r = await fetchEvent(BASE + "some/other/page", "navigate");
  assert("offline: a navigation to another path under the scope is the cached shell (the fallback)", r.handled && r.text === "shell:index.html");
  r = await fetchEvent(BASE + "data/wizard-gen3.js", "no-cors");
  assert("offline: the tables opened once are served from the data cache", r.handled && r.text === "window.ShinyWizardData3 = {};", r.error && String(r.error));
  r = await fetchEvent(BASE + "data/wizard-gen4.js", "no-cors");
  assert("offline: tables never opened are not served (the fetch fails, the tab reports it)", r.handled && !!r.error, r.text);
  assert("offline: only the never-opened tables were asked of the network", JSON.stringify(network.log) === JSON.stringify([BASE + "data/wizard-gen4.js"]), network.log);
  r = await fetchEvent(BASE + "app.js?v=2", "no-cors");
  assert("offline: a shell file asked with a query is served ignoring the search", r.handled && r.text === "shell:app.js");

  // left alone: cross-origin and non-GET
  r = await fetchEvent("https://example.org/x.js", "no-cors");
  assert("a cross-origin request is not handled", !r.handled);
  {
    const request = new Request(BASE + "app.js", { method: "POST", body: "x" });
    let responded = false;
    for (const fn of listeners.fetch || []) fn({ request, respondWith() { responded = true; } });
    assert("a POST is not handled", !responded);
  }

  console.log("service worker: " + checks + " checks, " + failures + " failure" + (failures === 1 ? "" : "s") + " (build " + build + ")");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAIL service worker: " + (e && e.stack || e)); process.exit(1); });
