import { diffChanges } from "./audit.service";

describe("diffChanges", () => {
  const before: { givenName: string; familyName: string; birthDate: string; occupation: string | null } = {
    givenName: "Juan",
    familyName: "Dela Cruz",
    birthDate: "1980-01-01",
    occupation: null,
  };

  it("records only changed fields that were supplied", () => {
    expect(diffChanges(before, { givenName: "Juan", familyName: "Santos" }, ["givenName", "familyName", "birthDate"])).toEqual({
      familyName: { from: "Dela Cruz", to: "Santos" },
    });
  });

  it("treats null and undefined targets as null", () => {
    expect(diffChanges({ ...before, occupation: "Teacher" }, { occupation: null }, ["occupation"])).toEqual({
      occupation: { from: "Teacher", to: null },
    });
  });

  it("ignores keys not in the allow-list", () => {
    expect(diffChanges(before, { givenName: "Pedro" }, ["familyName"])).toEqual({});
  });
});
