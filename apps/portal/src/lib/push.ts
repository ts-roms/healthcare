/** Helpers for turning on notifications in the browser (Web Push). The API decides what is allowed; these shape the screen. */

/** The clinic's public key, as the browser wants it (a base64url string to bytes). */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** A base64url string of a browser key, as the API takes it. */
export function bytesToBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PushSupport = "ready" | "denied" | "unsupported";

/** Whether this browser can do it and the patient has not blocked it. Needs a secure address (https) and a service worker. */
export function pushSupport(env: {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: string | null;
  secure: boolean;
}): PushSupport {
  if (!env.secure || !env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  return env.permission === "denied" ? "denied" : "ready";
}

/** Messages for the API's refusals, in the patient's words. */
export function pushMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "too_many_push_devices":
      return "You can receive notifications on up to 5 devices. Remove one first.";
    case "push_not_available":
      return "Notifications on this device are not available at this clinic.";
    case "no_push_device":
      return "Turn on notifications on a device first.";
    default:
      return fallback;
  }
}
