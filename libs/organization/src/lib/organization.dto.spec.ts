import { createFacilitySchema, createOrganizationSchema, normalizeContactNumber, updateFacilitySchema } from "./organization.dto";

describe("organization input rules", () => {
  it("normalizes codes to lower case and rejects unsafe ones", () => {
    expect(createOrganizationSchema.parse({ code: " Demo-Health ", name: "Demo Health" }).code).toBe("demo-health");
    expect(createOrganizationSchema.safeParse({ code: "x", name: "Too short" }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ code: "has space", name: "Bad" }).success).toBe(false);
  });

  it("requires 4-digit Philippine postal codes", () => {
    const base = { code: "main", name: "Main Clinic", facilityType: "clinic" };
    expect(createFacilitySchema.safeParse({ ...base, postalCode: "1210" }).success).toBe(true);
    expect(createFacilitySchema.safeParse({ ...base, postalCode: "12100" }).success).toBe(false);
  });

  it("requires the version being edited on update", () => {
    expect(updateFacilitySchema.safeParse({ name: "Renamed" }).success).toBe(false);
    expect(updateFacilitySchema.safeParse({ name: "Renamed", version: 3 }).success).toBe(true);
  });

  it("stores recognizable mobile numbers in E.164 and keeps landlines as typed", () => {
    expect(normalizeContactNumber("0917 123 4567")).toBe("+639171234567");
    expect(normalizeContactNumber("(02) 8123 4567")).toBe("(02) 8123 4567");
    expect(normalizeContactNumber(undefined)).toBeUndefined();
  });
});
