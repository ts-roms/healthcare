/* Staff app service worker (ADR-0013): keeps the Offline page and the app's static files available without a
 * connection. It touches nothing else: every other request goes to the network as before. No patient data is cached
 * here — the Offline page's snapshot is whatever the page showed the last time it loaded online, and the outbox lives
 * encrypted in IndexedDB, not in this cache. */
const CACHE = "healthcare-staff-offline-v1";
const OFFLINE_PATH = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_PATH, { credentials: "same-origin" })).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The Offline page: the network when it answers (and the copy is refreshed), the last copy otherwise.
  if (request.mode === "navigate" && url.pathname === OFFLINE_PATH) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put(OFFLINE_PATH, response.clone()));
          return response;
        })
        .catch(() =>
          caches
            .match(OFFLINE_PATH)
            .then(
              (cached) =>
                cached || new Response("Offline page not available: open it once while connected.", { status: 503, headers: { "content-type": "text/plain" } }),
            ),
        ),
    );
    return;
  }

  // Hashed static files: once fetched, served from the cache.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});
