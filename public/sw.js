// Coachly service worker: lets the app open and show the user's last-loaded data offline.
//  - /_next/static/*         cache-first (content-hashed, never changes)
//  - page navigations        network-first (12 s timeout), fall back to the last good copy, then /offline
//  - Supabase REST GETs      network-first (5 s timeout), fall back to the last good copy
//  - auth, writes, RPCs      never cached (always network)
// Cached pages/data belong to the signed-in user and are deleted on sign-out ("clear-data").

const VERSION = "v3";
const STATIC = `coachly-static-${VERSION}`;
const PAGES = `coachly-pages-${VERSION}`;
const DATA = `coachly-data-${VERSION}`;
const OFFLINE_URL = "/offline";
const NETWORK_TIMEOUT_MS = 5000;
// Pages get longer: the server may be slow while telling us the backend is down, and
// showing "You're offline" then would be wrong.
const NAV_TIMEOUT_MS = 12000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("coachly-") && ![STATIC, PAGES, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-data") {
    event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(DATA)]).then(() => caches.open(PAGES).then((c) => c.add(OFFLINE_URL))));
  }
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(request, cacheName, { fallbackUrl, cacheKey, timeout = NETWORK_TIMEOUT_MS } = {}) {
  const cache = await caches.open(cacheName);
  const key = cacheKey ?? request;
  try {
    const response = await withTimeout(fetch(request), timeout);
    if (response.ok && !response.redirected) cache.put(key, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(cacheFirst(request));
      return;
    }
    // In-app (RSC) navigations: let them fail offline so Next falls back to a full page load,
    // which the navigation handler below serves from cache.
    if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
    if (request.mode === "navigate") {
      // Ignore query strings for the cache key so /coach/clients/x?tab=… shares one entry.
      const cacheKey = url.origin + url.pathname;
      event.respondWith(networkFirst(request, PAGES, { fallbackUrl: OFFLINE_URL, cacheKey, timeout: NAV_TIMEOUT_MS }));
    }
    return;
  }

  // Supabase data reads (RLS-filtered for this user). Auth and storage are never cached.
  if (url.pathname.startsWith("/rest/v1/")) {
    event.respondWith(networkFirst(request, DATA));
  }
});
