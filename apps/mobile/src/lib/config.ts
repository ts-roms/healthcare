/**
 * Build-time settings (`EXPO_PUBLIC_*` are inlined into the app and readable in the binary — never a secret).
 * One build serves one organization, as one MyHealth web deployment does (`PORTAL_ORGANIZATION_CODE`).
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
export const ORGANIZATION_CODE = process.env.EXPO_PUBLIC_ORGANIZATION_CODE ?? "";

export const configured = API_BASE_URL !== "" && ORGANIZATION_CODE !== "";
