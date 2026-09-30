import { describe, expect, it } from "vitest";
import {
  contactFormSchema,
  contactPayload,
  demographicsFormFrom,
  demographicsFormSchema,
  demographicsPatch,
  effectivePreferences,
  identifierFormSchema,
  identifierPayload,
  preferencesPayload,
  statusFormSchema,
} from "./patient-edit";

const current = {
  familyName: "Dela Cruz",
  givenName: "Juan",
  middleName: "Santos",
  suffix: null,
  sex: "male",
  genderIdentity: null,
  birthDate: "1980-05-12",
  birthDateIsEstimated: false,
  civilStatus: "married",
  nationality: "PH",
  occupation: null,
};

describe("demographicsPatch", () => {
  it("sends only what changed, clearing optional fields with null", () => {
    const form = demographicsFormSchema.parse({ ...demographicsFormFrom(current), middleName: "", occupation: "Teacher", reason: "Corrected at the desk" });
    expect(demographicsPatch(current, form, 3)).toEqual({ middleName: null, occupation: "Teacher", version: 3, reason: "Corrected at the desk" });
  });

  it("is null when nothing changed", () => {
    expect(demographicsPatch(current, demographicsFormSchema.parse(demographicsFormFrom(current)), 3)).toBeNull();
  });

  it("upper-cases the nationality code", () => {
    const form = demographicsFormSchema.parse({ ...demographicsFormFrom(current), nationality: "jp" });
    expect(demographicsPatch(current, form, 1)).toEqual({ nationality: "JP", version: 1 });
  });
});

describe("status form", () => {
  it("needs the time of death for deceased, and a reason", () => {
    expect(statusFormSchema.safeParse({ status: "deceased", reason: "Death certificate seen" }).success).toBe(false);
    expect(statusFormSchema.safeParse({ status: "inactive", reason: "x" }).success).toBe(false);
    expect(statusFormSchema.safeParse({ status: "deceased", deceasedAt: "2026-09-01T08:30", reason: "Death certificate seen" }).success).toBe(true);
  });
});

describe("contacts and identifiers", () => {
  it("checks and cleans a PH mobile number", () => {
    expect(contactFormSchema.safeParse({ system: "mobile", value: "12345", use: "personal", isPrimary: true }).success).toBe(false);
    const ok = contactFormSchema.parse({ system: "mobile", value: "0917 123-4567", use: "personal", isPrimary: true });
    expect(contactPayload(ok).value).toBe("09171234567");
  });

  it("strips PhilHealth PIN dashes and asks for an HMO's name", () => {
    expect(identifierPayload(identifierFormSchema.parse({ type: "philhealth_pin", value: "12-345678901-2", issuer: "", validUntil: "" }))).toEqual({
      type: "philhealth_pin",
      value: "123456789012",
      issuer: undefined,
      validUntil: undefined,
    });
    expect(identifierFormSchema.safeParse({ type: "hmo_member_id", value: "M-1", issuer: "", validUntil: "" }).success).toBe(false);
  });
});

describe("communication preferences", () => {
  it("defaults to care messages on and outreach off", () => {
    expect(effectivePreferences([])).toMatchObject({ "sms:clinical": true, "sms:outreach": false });
  });

  it("sends only choices that differ from the ones in force", () => {
    const recorded = [{ channel: "sms", category: "administrative", optedIn: false }];
    const chosen = { ...effectivePreferences(recorded), "sms:administrative": false, "email:outreach": true };
    expect(preferencesPayload(recorded, chosen)).toEqual({ preferences: [{ channel: "email", category: "outreach", optedIn: true }] });
    expect(preferencesPayload(recorded, effectivePreferences(recorded))).toBeNull();
  });
});
