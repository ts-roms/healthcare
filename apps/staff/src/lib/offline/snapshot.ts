/**
 * The Offline page's snapshot in the service worker's cache (public/sw.js). It holds patient data (today's queue), so
 * it exists only after a signed-in person opened the Offline page, and goes when the browser signs out. Every call
 * fails quietly: no cache (private window, no service worker) means nothing to keep or clear.
 */

/** Must match CACHE and OFFLINE_PATH in public/sw.js. */
export const OFFLINE_CACHE = "healthcare-staff-offline-v1";
export const OFFLINE_PATH = "/offline";

/** Asks the service worker to keep a copy of the Offline page (opened while connected). */
export async function takeOfflineSnapshot(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "take-offline-snapshot" });
  } catch {
    // Without a service worker there is no offline copy.
  }
}

/** Deletes the copy (sign-out, idle sign-out, the sign-in page). */
export async function clearOfflineSnapshot(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await (await caches.open(OFFLINE_CACHE)).delete(OFFLINE_PATH);
  } catch {
    // Storage refused: nothing was kept either.
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-offline-snapshot" });
  } catch {
    // No service worker controls this page.
  }
}
