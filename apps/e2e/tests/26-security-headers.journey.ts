import { expect, test } from "@playwright/test";
import { PORTAL_URL, STAFF_URL } from "../support/env";

/** Browser hardening headers on the staff app and MyHealth (docs/security-audit, VR-23). HSTS is sent in production builds only. */
for (const [name, url] of [
  ["staff app", STAFF_URL],
  ["MyHealth", PORTAL_URL],
] as const) {
  test(`the ${name} answers with browser hardening headers`, async ({ request }) => {
    const response = await request.get(`${url}/`, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("geolocation=()");
  });
}
