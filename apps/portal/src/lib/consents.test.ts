import { describe, expect, it } from "vitest";
import { consentMessage, consentState } from "./consents";

const decision = (d: "granted" | "refused" | "withdrawn") => ({
  id: "c1",
  decision: d,
  effectiveAt: "2026-01-01T00:00:00Z",
  expiresAt: null,
  recordedAt: "2026-01-01T00:00:00Z",
  recordedVia: "clinic" as const,
});

describe("consents", () => {
  it("describes a consent's state", () => {
    expect(consentState({ current: null, inEffect: false })).toBe("not_recorded");
    expect(consentState({ current: decision("granted"), inEffect: true })).toBe("given");
    expect(consentState({ current: decision("granted"), inEffect: false })).toBe("expired");
    expect(consentState({ current: decision("withdrawn"), inEffect: false })).toBe("withdrawn");
    expect(consentState({ current: decision("refused"), inEffect: false })).toBe("refused");
  });

  it("explains refusals in the patient's words", () => {
    expect(consentMessage("consent_withdraw_at_clinic", "x")).toContain("withdrawn at the clinic");
    expect(consentMessage(undefined, "Something went wrong")).toBe("Something went wrong");
  });
});
