/** Base URL of the healthcare API, including the version prefix. Server-side only; never exposed to the browser. */
export const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3333/api/v1").replace(/\/+$/, "");

/**
 * The organization this portal deployment serves (its `organization.code`).
 * Patients sign in to one organization's portal; they never pick an organization.
 */
export const PORTAL_ORGANIZATION_CODE = (process.env.PORTAL_ORGANIZATION_CODE ?? "demo").trim().toLowerCase();

/** Session cookies. Distinct names from the staff app so the two sessions never mix on a shared domain. */
export const COOKIES = {
  access: "hp_at",
  refresh: "hp_rt",
} as const;

export const SECURE_COOKIES = process.env.NODE_ENV === "production";
