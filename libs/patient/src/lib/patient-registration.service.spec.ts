import { patientNameFields, withSinglePrimaryPerKey } from "./patient-registration.service";

describe("withSinglePrimaryPerKey", () => {
  type Contact = { system: string; isPrimary?: boolean };
  const bySystem = (c: Contact) => c.system;

  it("defaults the first item of each key to primary", () => {
    const result = withSinglePrimaryPerKey<Contact>([{ system: "mobile" }, { system: "mobile" }, { system: "email" }], bySystem);
    expect(result.map((c) => c.isPrimary)).toEqual([true, false, true]);
  });

  it("honors the first explicitly flagged item", () => {
    const result = withSinglePrimaryPerKey<Contact>(
      [{ system: "mobile" }, { system: "mobile", isPrimary: true }, { system: "mobile", isPrimary: true }],
      bySystem,
    );
    expect(result.map((c) => c.isPrimary)).toEqual([false, true, false]);
  });
});

describe("patientNameFields", () => {
  it("builds normalized search fields", () => {
    expect(patientNameFields({ familyName: "Dela Cruz", givenName: "Ma. Teresa", middleName: "Peña" })).toEqual({
      familyNameNormalized: "dela cruz",
      givenNameNormalized: "ma teresa",
      nameSearch: "ma teresa pena dela cruz",
    });
  });
});
