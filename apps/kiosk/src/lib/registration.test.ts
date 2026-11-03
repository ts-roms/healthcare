import { describe, expect, it } from "vitest";
import { normalizeMobile, registrationForm, toRegistrationPayload } from "./registration";

const valid = {
  familyName: " Dela Cruz ",
  givenName: "Maria",
  middleName: "",
  sex: "female",
  birthDay: "5",
  birthMonth: "3",
  birthYear: "1985",
  civilStatus: "",
  mobile: "0917 123 4567",
  email: "",
  line1: "",
  barangay: "San Roque",
  cityMunicipality: "Quezon City",
  province: "",
  postalCode: "",
  philhealthPin: "",
  emergencyName: "Juan Dela Cruz",
  emergencyNumber: "09181234567",
  emergencyRelationship: "spouse",
  privacyAcknowledged: true,
};

describe("normalizeMobile", () => {
  it("writes Philippine mobile numbers in international form", () => {
    expect(normalizeMobile("0917 123 4567")).toBe("+639171234567");
    expect(normalizeMobile("+63 917-123-4567")).toBe("+639171234567");
    expect(normalizeMobile("639171234567")).toBe("+639171234567");
  });

  it("refuses anything else", () => {
    expect(normalizeMobile("12345")).toBeNull();
    expect(normalizeMobile("0817 123 4567")).toBeNull();
  });
});

describe("registration form", () => {
  it("accepts a complete form and reports what is missing", () => {
    expect(registrationForm.safeParse(valid).success).toBe(true);
    const bad = registrationForm.safeParse({ ...valid, givenName: "", mobile: "abc", privacyAcknowledged: undefined });
    expect(bad.success).toBe(false);
    const fields = bad.success ? [] : bad.error.issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["givenName", "mobile", "privacyAcknowledged"]));
  });

  it("requires the privacy acknowledgement to be given, not merely present", () => {
    expect(registrationForm.safeParse({ ...valid, privacyAcknowledged: false }).success).toBe(false);
  });
});

describe("toRegistrationPayload", () => {
  it("sends the API's shape, leaves empty optional fields out and invents nothing", () => {
    const payload = toRegistrationPayload(registrationForm.parse(valid), "2026-11-03");
    expect(payload).toEqual({
      familyName: "Dela Cruz",
      givenName: "Maria",
      sex: "female",
      birthDate: "1985-03-05",
      contacts: [{ system: "mobile", value: "+639171234567", use: "personal", isPrimary: true }],
      addresses: [{ use: "home", isPrimary: true, cityMunicipality: "Quezon City", barangay: "San Roque" }],
      identifiers: [],
      emergencyContact: { name: "Juan Dela Cruz", contactNumber: "09181234567", relationship: "spouse" },
      privacyAcknowledged: true,
    });
  });

  it("adds the email and PhilHealth number only when typed", () => {
    const payload = toRegistrationPayload(registrationForm.parse({ ...valid, email: "m@example.com", philhealthPin: "12-345678901-2" }), "2026-11-03");
    expect(payload.contacts.map((c) => c.system)).toEqual(["mobile", "email"]);
    expect(payload.identifiers).toEqual([{ type: "philhealth_pin", value: "12-345678901-2" }]);
  });
});
