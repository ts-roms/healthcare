/** Base URL of the healthcare API, including the version prefix. Server-side only. */
export const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");

/**
 * Cookies, all httpOnly and set by this app's server. Nothing about a patient is ever kept in the browser's storage or
 * readable by its scripts: the person's session token travels in `session` and is deleted when they finish.
 */
export const COOKIES = {
  /** The kiosk's own staff account (the device identity). */
  access: "kc_at",
  refresh: "kc_rt",
  facility: "kc_fac",
  /** One person's kiosk session token (header `X-Kiosk-Session` on the API). */
  session: "kc_ss",
} as const;

export const SECURE_COOKIES = process.env.NODE_ENV === "production";

/** The version the kiosk reports to the API with its heartbeat. */
export const APP_VERSION = process.env.KIOSK_APP_VERSION ?? "0.1.0";

/**
 * The privacy notice shown before a new patient registers. The wording is the organization's own decision (it is a
 * compliance item, docs/security/compliance-dependencies.md); until it sets `KIOSK_PRIVACY_NOTICE` the kiosk shows a
 * plain statement of what it does, and nothing that claims a legal basis.
 */
export const PRIVACY_NOTICE =
  process.env.KIOSK_PRIVACY_NOTICE ??
  "The details you enter here are sent to the clinic's reception so staff can create your patient record. Nothing is kept on this screen when you finish. Reception will check your details before your record is made. You can ask the front desk about how your information is used.";
