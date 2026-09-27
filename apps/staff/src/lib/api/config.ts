/** Base URL of the healthcare API, including the version prefix. Server-side only; never exposed to the browser. */
export const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");

/** Session cookies. Tokens live only in httpOnly cookies set by the staff app's server. */
export const COOKIES = {
  access: "hc_at",
  refresh: "hc_rt",
  mfaChallenge: "hc_mfa",
  facility: "hc_fac",
} as const;

export const SECURE_COOKIES = process.env.NODE_ENV === "production";

/** Refresh the access token this many seconds before it expires. */
export const ACCESS_TOKEN_SKEW_SECONDS = 30;
