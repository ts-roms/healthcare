import { describe, expect, it } from "vitest";
import { consentState, consentTypeLabel, EMPTY_CONSENT_FORM, parseConsentForm, todayInManila } from "./consent-form";

const TODAY = "2026-09-27";

describe("parseConsentForm", () => {
  it("builds the API payload; the end date runs to the end of that day in Manila", () => {
    const result = parseConsentForm({ ...EMPTY_CONSENT_FORM, consentType: "portal_access", expiresOn: "2027-09-27", notes: "  Signed at front desk " }, TODAY);
    expect(result).toEqual({
      ok: true,
      payload: {
        consentType: "portal_access",
        decision: "granted",
        capturedVia: "paper",
        expiresAt: "2027-09-27T23:59:59+08:00",
        notes: "Signed at front desk",
      },
    });
  });

  it("omits empty optional fields", () => {
    const result = parseConsentForm({ ...EMPTY_CONSENT_FORM, consentType: "telemedicine", decision: "withdrawn", capturedVia: "verbal" }, TODAY);
    expect(result).toEqual({
      ok: true,
      payload: { consentType: "telemedicine", decision: "withdrawn", capturedVia: "verbal", expiresAt: undefined, notes: undefined },
    });
  });

  it("requires a consent type and rejects unknown values", () => {
    const result = parseConsentForm({ ...EMPTY_CONSENT_FORM, capturedVia: "fax" }, TODAY);
    expect(result).toMatchObject({ ok: false, errors: { consentType: "Choose the consent.", capturedVia: "Choose how the consent was given." } });
  });

  it("rejects an end date today or earlier, or on a refusal", () => {
    expect(parseConsentForm({ ...EMPTY_CONSENT_FORM, consentType: "research", expiresOn: TODAY }, TODAY)).toMatchObject({
      ok: false,
      errors: { expiresOn: "The end date must be after today." },
    });
    expect(parseConsentForm({ ...EMPTY_CONSENT_FORM, consentType: "research", decision: "refused", expiresOn: "2027-01-01" }, TODAY)).toMatchObject({
      ok: false,
      errors: { expiresOn: "Only a granted consent can have an end date." },
    });
  });
});

describe("consentState", () => {
  const now = new Date("2026-09-27T04:00:00Z");
  const base = { decision: "granted", effectiveAt: "2026-01-01T00:00:00Z", expiresAt: null };
  it("distinguishes in effect, expired, future, refused and withdrawn", () => {
    expect(consentState(base, now)).toBe("in_effect");
    expect(consentState({ ...base, expiresAt: "2026-09-27T03:59:59Z" }, now)).toBe("expired");
    expect(consentState({ ...base, effectiveAt: "2026-10-01T00:00:00Z" }, now)).toBe("not_yet_effective");
    expect(consentState({ ...base, decision: "refused" }, now)).toBe("refused");
    expect(consentState({ ...base, decision: "withdrawn" }, now)).toBe("withdrawn");
  });
});

describe("helpers", () => {
  it("uses the Philippine date, not the server's", () => {
    expect(todayInManila(new Date("2026-09-27T17:00:00Z"))).toBe("2026-09-28");
  });
  it("labels consent types in plain language", () => {
    expect(consentTypeLabel("portal_access")).toBe("Patient portal access (MyHealth)");
    expect(consentTypeLabel("something_new")).toBe("something new");
  });
});
