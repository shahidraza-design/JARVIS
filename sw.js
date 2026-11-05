/* ═══════════════════════════════════════════════════════════════
   sw.js — offline shell for J.A.R.V.I.S.

   Strategy, deliberately conservative:
     • navigations    → network first, cached shell when offline
     • same-origin JS/CSS/icons → instant from cache, refreshed in the background
     • everything else (weather, Wikipedia, fonts) → untouched, straight to network

   The third rule matters: the assistant must never serve a stale weather
   report or a stale Wikipedia summary from a cache. Those skills already
   degrade with a clear message when the network is unavailable.

   Bump CACHE_VERSION whenever the shell changes.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = "jarvis-shell-v1";

// Resolve every path against the worker's own URL so the shell works whether the
// app is served from a domain root or a subpath (e.g. /JARVIS/ on GitHub Pages).
const abs = (path) => new URL(path, self.location.href).href;

const SHELL_PATHS = [
  "./",
  "index.html",
  "manifest.json",
  "assets/css/base.css",
  "assets/css/app.css",
  "assets/js/app.js",
  "assets/js/audio.js",
  "assets/js/brain.js",
  "assets/js/hud.js",
  "assets/js/skills.js",
  "assets/js/speech.js",
  "assets/js/timers.js",
  "assets/js/util.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/icons/apple-touch-icon.png",
];

const SHELL = SHELL_PATHS.map(abs);
const SHELL_INDEX = abs("index.html");
const SHELL_ROOT = abs("./");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Add individually so one missing file can't fail the whole install.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {
            /* a missing optional asset must not break the worker */
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

const isShellAsset = (url) =>
  /\.(?:js|css|png|svg|json|woff2?)$/i.test(url.pathname) ||
  url.pathname.endsWith("/") ||
  url.pathname.endsWith("/index.html");

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET, and only our own origin. Never touch weather/Wikipedia/fonts.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isShellAsset(url)) return;

  // Navigations: try the network so a redeploy is picked up immediately,
  // fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(SHELL_INDEX, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (
            (await cache.match(SHELL_INDEX)) ||
            (await cache.match(SHELL_ROOT)) ||
            new Response("<h1>Offline</h1><p>Reopen J.A.R.V.I.S. once you're back online.</p>", {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  // Static shell assets: instant from cache, refreshed in the background so the
  // next load picks up any change.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
