import { describe, expect, it } from "vitest";
import { fieldErrorsFromApi, registrationFormSchema, toRegisterPayload } from "./patient-registration";

const base = { familyName: " Dela Cruz ", givenName: "Juan", sex: "male" as const, birthDate: "1985-06-15" };

describe("registrationFormSchema", () => {
  it("requires names, sex and a past birth date", () => {
    expect(registrationFormSchema.safeParse(base).success).toBe(true);
    expect(registrationFormSchema.safeParse({ ...base, birthDate: "2999-01-01" }).success).toBe(false);
    expect(registrationFormSchema.safeParse({ ...base, familyName: "" }).success).toBe(false);
  });

  it("accepts PH mobile formats and empty optional fields", () => {
    for (const mobile of ["09171234567", "+639171234567", "639171234567", ""]) expect(registrationFormSchema.safeParse({ ...base, mobile }).success).toBe(true);
    expect(registrationFormSchema.safeParse({ ...base, mobile: "12345" }).success).toBe(false);
  });
});

describe("toRegisterPayload", () => {
  it("sends only filled sub-records, normalized", () => {
    const payload = toRegisterPayload({
      ...base,
      mobile: "0917 123-4567",
      email: "",
      philhealthPin: "12-345678901-2",
      cityMunicipality: "Quezon City",
      barangay: "",
    });
    expect(payload).toMatchObject({
      familyName: "Dela Cruz",
      contacts: [{ system: "mobile", value: "09171234567", isPrimary: true }],
      identifiers: [{ type: "philhealth_pin", value: "123456789012" }],
      addresses: [{ cityMunicipality: "Quezon City", barangay: undefined, isPrimary: true }],
    });
    expect(payload).not.toHaveProperty("duplicateOverride");
  });

  it("includes the duplicate override only when given", () => {
    const override = { reviewedCandidateIds: ["8c7b1a6e-1111-4c2b-9d9e-000000000001"], reason: "Twin brother" };
    expect(toRegisterPayload(base, override).duplicateOverride).toEqual(override);
  });
});

describe("fieldErrorsFromApi", () => {
  it("maps API validation paths onto form fields", () => {
    expect(
      fieldErrorsFromApi([
        { path: "birthDate", message: "Invalid date" },
        { path: "contacts.0.value", message: "Invalid mobile number" },
        { path: "", message: "ignored" },
      ]),
    ).toEqual({ birthDate: "Invalid date", mobile: "Invalid mobile number" });
    expect(fieldErrorsFromApi("nope")).toEqual({});
  });
});
