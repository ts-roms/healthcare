import {
  canUnmerge,
  type MergeCandidateFacts,
  mergeDifferences,
  mergeIneligibility,
  portalAccountHandling,
  splitWorkItems,
  unacknowledgedDifferences,
} from "./patient-merge.rules";

const base: MergeCandidateFacts = {
  id: "a",
  organizationId: "org",
  patientNumber: "P00000001",
  familyName: "Dela Cruz",
  givenName: "Juan",
  middleName: "Santos",
  suffix: null,
  sex: "male",
  birthDate: "1980-03-04",
  status: "active",
  mergedIntoPatientId: null,
};
const other = { ...base, id: "b", patientNumber: "P00000002" };
const none = { retired: [], survivor: [] };

describe("mergeIneligibility", () => {
  it("allows two active records of one organization", () => {
    expect(mergeIneligibility(base, other)).toBeUndefined();
  });

  it("refuses the same record, another organization and merged records on either side", () => {
    expect(mergeIneligibility(base, base)).toBe("same_record");
    expect(mergeIneligibility(base, { ...other, organizationId: "elsewhere" })).toBe("different_organization");
    expect(mergeIneligibility({ ...base, status: "merged", mergedIntoPatientId: "c" }, other)).toBe("retired_already_merged");
    expect(mergeIneligibility(base, { ...other, status: "merged", mergedIntoPatientId: "c" })).toBe("survivor_merged");
  });

  it("allows inactive and deceased records (their status is kept for an unmerge)", () => {
    expect(mergeIneligibility({ ...base, status: "inactive" }, { ...other, status: "deceased" })).toBeUndefined();
  });
});

describe("mergeDifferences", () => {
  it("flags nothing for the same person written the same way (case and accents ignored)", () => {
    expect(mergeDifferences(base, { ...other, familyName: "DELA CRUZ", givenName: "Juán" }, none)).toEqual([]);
  });

  it("flags names, birth date, sex and a deceased/not-deceased mismatch", () => {
    const codes = mergeDifferences(base, { ...other, middleName: null, birthDate: "1980-04-03", sex: "female", status: "deceased" }, none).map((d) => d.code);
    expect(codes).toEqual(["middle_name", "birth_date", "sex", "deceased_status"]);
  });

  it("flags identifiers of the same type and issuer with different values only", () => {
    const differences = mergeDifferences(base, other, {
      retired: [
        { type: "philhealth_pin", issuer: null, valueNormalized: "123" },
        { type: "hmo_member_id", issuer: "Maxicare", valueNormalized: "M1" },
        { type: "passport", issuer: null, valueNormalized: "X1" },
      ],
      survivor: [
        { type: "philhealth_pin", issuer: null, valueNormalized: "999" },
        { type: "hmo_member_id", issuer: "Intellicare", valueNormalized: "I1" },
        { type: "passport", issuer: null, valueNormalized: "X1" },
      ],
    });
    expect(differences).toEqual([{ code: "identifier:philhealth_pin", field: "Identifier (philhealth_pin)", retired: "123", survivor: "999" }]);
  });
});

describe("unacknowledgedDifferences", () => {
  it("lists the flagged differences the caller did not acknowledge", () => {
    const differences = mergeDifferences(base, { ...other, birthDate: "1980-04-03", status: "deceased" }, none);
    expect(unacknowledgedDifferences(differences, ["birth_date"])).toEqual(["deceased_status"]);
    expect(unacknowledgedDifferences(differences, ["birth_date", "deceased_status"])).toEqual([]);
  });
});

describe("splitWorkItems", () => {
  it("blocks on work in progress and only warns about active care plans", () => {
    const item = (kind: Parameters<typeof splitWorkItems>[0][number]["kind"]) => ({ kind, id: kind, label: kind, at: null, link: null });
    const { blockers, warnings } = splitWorkItems([item("encounter_in_progress"), item("care_plan_active"), item("draft_invoice")]);
    expect(blockers.map((b) => b.kind)).toEqual(["encounter_in_progress", "draft_invoice"]);
    expect(warnings.map((w) => w.kind)).toEqual(["care_plan_active"]);
  });
});

describe("canUnmerge", () => {
  it("undoes only a record that is merged now", () => {
    expect(canUnmerge("merged", "merged")).toBe(true);
    expect(canUnmerge("merged", "repointed")).toBe(true);
    expect(canUnmerge("active", "unmerged")).toBe(false);
    expect(canUnmerge("active", undefined)).toBe(false);
  });
});

describe("portalAccountHandling", () => {
  it("moves the only account to the survivor and disables a second one", () => {
    expect(portalAccountHandling(undefined, { status: "active" })).toBe("none");
    expect(portalAccountHandling({ status: "active" }, undefined)).toBe("moved_to_survivor");
    expect(portalAccountHandling({ status: "active" }, { status: "active" })).toBe("retired_disabled");
    expect(portalAccountHandling({ status: "disabled" }, { status: "active" })).toBe("survivor_kept");
  });
});
