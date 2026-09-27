/** Base URL of the healthcare API, including the version prefix. Server-side only; never exposed to the browser. */
export const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");

/**
 * Socket.IO namespace the browser connects to for live updates. Unlike the
 * REST API it must be reachable from the browser (in production, route
 * `/realtime` to the API through the same trusted proxy). Browsers only ever
 * present a short-lived ticket, never an access token.
 */
export const REALTIME_URL = process.env.REALTIME_URL ?? `${new URL(API_BASE_URL).origin}/realtime`;

/** Session cookies. Tokens live only in httpOnly cookies set by the staff app's server. */
export const COOKIES = {
  access: "hc_at",
  refresh: "hc_rt",
  mfaChallenge: "hc_mfa",
  facility: "hc_fac",
} as const;

export const SECURE_COOKIES = process.env.NODE_ENV === "production";
