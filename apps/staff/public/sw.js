/* Staff app service worker (ADR-0013): keeps the Offline page and the app's static files available without a
 * connection. It touches nothing else: every other request goes to the network as before.
 *
 * The Offline page's snapshot is the page as it last loaded online, and that page lists today's queue (patient numbers,
 * names, complaints): patient data on the device. It is therefore kept as little as possible (zero trust in a shared
 * clinic computer): deleted whenever the browser signs out or reaches the sign-in page (src/lib/offline/snapshot.ts and
 * below), and never served once older than SNAPSHOT_MAX_AGE_MS. The outbox lives encrypted in IndexedDB, not here. */
const CACHE = "healthcare-staff-offline-v1";
const OFFLINE_PATH = "/offline";
/** A snapshot older than a working day is never served (and is deleted). */
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_HEADER = "x-offline-snapshot-at";

function deleteSnapshot() {
  return caches.open(CACHE).then((cache) => cache.delete(OFFLINE_PATH));
}

/** The copy to keep: the same page, stamped with when it was taken. */
function stamped(response) {
  return response.blob().then((body) => {
    const headers = new Headers(response.headers);
    headers.set(SNAPSHOT_HEADER, String(Date.now()));
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  });
}

function freshSnapshot() {
  return caches.match(OFFLINE_PATH).then((cached) => {
    if (!cached) return undefined;
    const at = Number(cached.headers.get(SNAPSHOT_HEADER));
    if (!Number.isFinite(at) || Date.now() - at > SNAPSHOT_MAX_AGE_MS) return deleteSnapshot().then(() => undefined);
    return cached;
  });
}

/** Fetches the Offline page with the person's session and keeps it, unless the answer is the sign-in page. */
function takeSnapshot() {
  return fetch(new Request(OFFLINE_PATH, { credentials: "same-origin" }))
    .then((response) => {
      if (!response.ok || response.redirected) return deleteSnapshot();
      return stamped(response).then((copy) => caches.open(CACHE).then((cache) => cache.put(OFFLINE_PATH, copy)));
    })
    .catch(() => undefined);
}

// The Offline page asks for its copy once it is open (src/lib/offline/snapshot.ts); sign-out asks for it to go.
self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "take-offline-snapshot") event.waitUntil(takeSnapshot());
  if (type === "clear-offline-snapshot") event.waitUntil(deleteSnapshot());
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Nothing is fetched ahead: the snapshot is taken only when a signed-in person opens the Offline page.
      .then(() => deleteSnapshot())
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

  // Reaching the sign-in page (signed out, idle sign-out, session ended): the snapshot goes.
  if (request.mode === "navigate" && url.pathname === "/login") {
    event.waitUntil(deleteSnapshot());
    return;
  }

  // The Offline page: the network when it answers (and the copy is refreshed), a recent copy otherwise.
  if (request.mode === "navigate" && url.pathname === OFFLINE_PATH) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only the page itself: a redirect to sign-in (no session) is never kept as the snapshot.
          if (response.ok && !response.redirected) {
            event.waitUntil(stamped(response.clone()).then((copy) => caches.open(CACHE).then((cache) => cache.put(OFFLINE_PATH, copy))));
          } else if (response.redirected) {
            event.waitUntil(deleteSnapshot());
          }
          return response;
        })
        .catch(() =>
          freshSnapshot().then(
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

/* Push notifications for staff (docs/domains/notification.md, "Push"): a message carries only a title, one line and the
 * page it is about — the content-free push wording of an in-app notice — and tapping it opens that page. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Notification";
  const options = {
    body: typeof data.body === "string" ? data.body : "You have a notification in the staff app.",
    tag: "healthcare-staff",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/notifications" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
