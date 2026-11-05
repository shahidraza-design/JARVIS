/**
 * sw.test.mjs — exercises the service worker's routing rules without a browser.
 *
 * sw.js is written against the service-worker globals (`self`, `caches`,
 * `fetch`). This runs the real file inside a sandbox with those globals
 * stubbed, then fires the actual `install`/`fetch` events and checks what the
 * worker would have done. That way the offline shell is verified rather than
 * assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(resolve(ROOT, "sw.js"), "utf8");
const ORIGIN = "https://example.github.io";

/** Minimal CacheStorage good enough for the worker's usage. */
function makeCaches() {
  const stores = new Map();
  const makeCache = (name) => {
    const entries = new Map();
    if (!stores.has(name)) stores.set(name, entries);
    const store = stores.get(name);
    const keyOf = (req) => (typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
    return {
      async add(req) {
        const url = keyOf(req);
        store.set(url, new Response(`cached:${url}`, { status: 200 }));
      },
      async match(req) {
        return store.get(keyOf(req));
      },
      async put(req, res) {
        store.set(keyOf(req), res);
      },
      entries: store,
    };
  };
  return {
    async open(name) {
      return makeCache(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    _stores: stores,
    _cache: makeCache,
  };
}

async function boot({ offline = false } = {}) {
  const handlers = new Map();
  const caches = makeCaches();
  const fetched = [];
  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    addEventListener: (type, fn) => handlers.set(type, fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const fetchStub = async (req) => {
    const url = typeof req === "string" ? req : req.url;
    fetched.push(url);
    if (offline) throw new TypeError("Failed to fetch");
    return new Response(`network:${url}`, { status: 200 });
  };

  const context = vm.createContext({
    self,
    caches,
    fetch: fetchStub,
    Request,
    Response,
    URL,
    console,
    Promise,
  });
  vm.runInContext(SOURCE, context, { filename: "sw.js" });

  const fire = async (type, event) => handlers.get(type)(event);
  return { handlers, caches, fetched, fire, self };
}

/** undici won't construct mode:"navigate", so build a plain request-like object. */
const fakeRequest = (url, { mode = "no-cors", method = "GET" } = {}) => ({
  url,
  method,
  mode,
  clone() { return this; },
});

const navEvent = (path, request, mode = "no-cors") => {
  const respond = [];
  const req = request || fakeRequest(new URL(path, `${ORIGIN}/`).href, { mode });
  return {
    event: { request: req, waitUntil: (p) => p, respondWith: (p) => respond.push(p) },
    respond,
  };
};

test("install precaches the whole app shell", async () => {
  const sw = await boot();
  const pending = [];
  await sw.fire("install", { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);

  const store = sw.caches._stores.get("jarvis-shell-v1");
  assert.ok(store, "shell cache should exist");
  for (const required of [
    "index.html",
    "manifest.webmanifest",
    "assets/css/app.css",
    "assets/js/app.js",
    "assets/js/brain.js",
    "assets/icons/icon-512.png",
  ]) {
    const key = new URL(required, `${ORIGIN}/`).href;
    assert.ok(store.has(key), `expected ${required} to be precached`);
  }
});

test("a navigation is served from the network when online", async () => {
  const sw = await boot();
  const { event, respond } = navEvent("/", null, "navigate");
  await sw.fire("fetch", event);
  assert.equal(respond.length, 1, "worker should answer the request");
  const res = await respond[0];
  assert.match(await res.text(), /^network:/);
});

test("a navigation falls back to the cached shell when offline", async () => {
  const sw = await boot({ offline: true });
  // simulate a previous successful load populating the shell
  const cache = await sw.caches.open("jarvis-shell-v1");
  await cache.put(`${ORIGIN}/index.html`, new Response("<title>JARVIS shell</title>", { status: 200 }));

  const { event, respond } = navEvent("/", null, "navigate");
  await sw.fire("fetch", event);
  assert.equal(respond.length, 1);
  const res = await respond[0];
  assert.equal(res.status, 200);
  assert.match(await res.text(), /JARVIS shell/);
});

test("cross-origin requests are never intercepted or cached", async () => {
  for (const url of [
    "https://api.open-meteo.com/v1/forecast?latitude=22.6",
    "https://en.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace",
    "https://fonts.googleapis.com/css2?family=Space+Grotesk",
  ]) {
    const sw = await boot();
    const { event, respond } = navEvent("/", fakeRequest(url));
    await sw.fire("fetch", event);
    assert.equal(respond.length, 0, `${url} must go straight to the network`);
  }
});

test("non-asset same-origin requests are left alone", async () => {
  const sw = await boot();
  const { event, respond } = navEvent("/some/endpoint", fakeRequest(`${ORIGIN}/some/endpoint`));
  await sw.fire("fetch", event);
  assert.equal(respond.length, 0);
});

test("shell assets are served from cache instantly, then refreshed", async () => {
  const sw = await boot();
  const cache = await sw.caches.open("jarvis-shell-v1");
  const url = `${ORIGIN}/assets/js/app.js`;
  await cache.put(url, new Response("old-version", { status: 200 }));

  const { event, respond } = navEvent("/assets/js/app.js", fakeRequest(url));
  await sw.fire("fetch", event);
  const res = await respond[0];
  assert.equal(await res.text(), "old-version", "cache answers first");

  await new Promise((r) => setTimeout(r, 10));
  const refreshed = await cache.match(url);
  assert.match(await refreshed.text(), /^network:/, "cache is updated in the background");
});

test("POST requests are ignored even for shell paths", async () => {
  const sw = await boot();
  const { event, respond } = navEvent("/assets/js/app.js", fakeRequest(`${ORIGIN}/assets/js/app.js`, { method: "POST" }));
  await sw.fire("fetch", event);
  assert.equal(respond.length, 0);
});
