// The service worker for the static page (registered by index.html over http/https only: never under
// file://, so the Electron app and the ?selftest runs never see it, and never in the mobile bundle,
// which build-mobile-bundle.mjs strips of the registration). Two caches per build:
//   shiny-shell-<BUILD>  the app shell, precached at install (each request with cache mode reload, so a new build
//                        never fills its caches from the browser's HTTP-cache copies of the old files): index.html,
//                        every script the page loads, the stylesheet, the manifest and the icons; served cache-first;
//   shiny-data-<BUILD>   data/*.js (the wizard's tables), cached on first use and cache-first from then
//                        on, so the wizard works offline after the tab was opened once online.
// A navigation to the scope root or to index.html (any query, offline or not) is answered with the cached index.html;
// a navigation to any other path under the scope goes to the network and, offline, gets a small page that sends the
// browser to index.html (a script, a meta refresh and a link), since the shell's script and stylesheet URLs are relative
// and resolve only beside index.html.
// BUILD is stamped by webapp/sync-core.sh (a hash of the shipped sources, written here and into
// index.html): a changed sw.js installs as a new worker, precaches into new caches and, at activate,
// deletes every shiny-* cache of another build, so a new sync invalidates the old copy.
const BUILD = "001c7d26f1b0";
const SHELL_CACHE = "shiny-shell-" + BUILD;
const DATA_CACHE = "shiny-data-" + BUILD;
const INDEX = "index.html";
const SCOPE_PATH = new URL("./", self.location.href).pathname;
const SHELL = [
  INDEX, "app.css", "manifest.webmanifest",
  "rng.js", "gen4.js", "gen12.js", "gen1tid.js", "timers.js", "gen5.js", "seedtime4.js", "generators.js", "gen2tid.js",
  "gen1-data.js", "downloads.js", "mode.js", "footnotes.js", "app.js", "gen1tid-ui.js", "gen2tid-ui.js", "wizard-ui.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
    return cache.addAll(SHELL.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("shiny-") === 0 && k !== SHELL_CACHE && k !== DATA_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// the offline answer to a navigation away from index.html: the shell's relative URLs resolve only beside index.html, so
// the browser is sent there (a script, a meta refresh for a browser without scripts, and a link)
function toIndex() {
  const to = new URL(INDEX, self.location.href).href;
  const html = '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=' + to + '"><title>Shiny-Solution</title>' +
    '<script>location.replace(' + JSON.stringify(to) + ');</script><p>Offline: <a href="' + to + '">' + to + '</a></p>';
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function isDataFile(url) {
  return /\/data\/[^/]+\.js$/.test(url.pathname);
}

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    if (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + INDEX) {
      // the shell, whatever the query; the network only when the shell is not cached yet
      event.respondWith(caches.match(INDEX).then(function (cached) { return cached || fetch(request); }));
    } else {
      // another path under the scope: the network; offline, the page that sends the browser to index.html
      event.respondWith(fetch(request).catch(function () { return toIndex(); }));
    }
    return;
  }
  // DATA ROUTE BEGIN (tests/test-sw.cjs removes these lines for its negative control)
  if (isDataFile(url)) {
    event.respondWith(caches.open(DATA_CACHE).then(function (cache) {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        });
      });
    }));
    return;
  }
  // DATA ROUTE END
  event.respondWith(caches.match(request, { ignoreSearch: true }).then(function (cached) { return cached || fetch(request); }));
});
