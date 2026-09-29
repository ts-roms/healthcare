import { describe, expect, it } from "vitest";
import { checkMergeForm, differenceLabel, filedUnderLookup, filedUnderText, MERGE_WORK_ACTIONS, MERGE_WORK_LABELS, mergeWorkHref } from "./patient-merge";

describe("filedUnderLookup", () => {
  it("names the retired record a row was filed under, and nothing for the patient's own rows", () => {
    const filedUnder = filedUnderLookup([{ id: "r1", patientNumber: "P00000002" }]);
    expect(filedUnder("r1")).toBe("P00000002");
    expect(filedUnder("survivor")).toBeNull();
    expect(filedUnder(undefined)).toBeNull();
    expect(filedUnderLookup(null)("r1")).toBeNull();
    expect(filedUnderText("P00000002")).toBe("Filed under P00000002");
    expect(filedUnderText(null)).toBeNull();
  });
});

describe("mergeWorkHref", () => {
  it("opens the screen that resolves each kind of work", () => {
    expect(mergeWorkHref({ link: { type: "encounter", id: "e1" } }, "r")).toBe("/clinic/encounters/e1");
    expect(mergeWorkHref({ link: { type: "visit", id: "v1" } }, "r")).toBe("/queue/visits/v1");
    expect(mergeWorkHref({ link: { type: "invoice", id: "i1" } }, "r")).toBe("/billing/invoices/i1");
    expect(mergeWorkHref({ link: { type: "billing_patient", id: "r" } }, "r")).toBe("/billing/patients/r");
    expect(mergeWorkHref({ link: { type: "lab_order", id: "o1" } }, "r")).toBe("/patients/r#laboratory");
    expect(mergeWorkHref({ link: null }, "r")).toBeNull();
  });

  it("labels and explains every kind", () => {
    expect(Object.keys(MERGE_WORK_ACTIONS).sort()).toEqual(Object.keys(MERGE_WORK_LABELS).sort());
  });
});

describe("checkMergeForm", () => {
  const differences = [{ code: "birth_date" }, { code: "deceased_status" }];

  it("accepts a reason, every difference acknowledged and the retired number typed", () => {
    expect(
      checkMergeForm(
        { reason: "Same person registered twice", confirmation: " p00000002 ", acknowledged: ["birth_date", "deceased_status"] },
        "P00000002",
        differences,
      ),
    ).toEqual({});
  });

  it("asks for each missing part", () => {
    expect(checkMergeForm({ reason: "dup", confirmation: "P00000003", acknowledged: ["birth_date"] }, "P00000002", differences)).toEqual({
      reason: "Give a reason of at least 5 characters.",
      acknowledged: "Review and tick every flagged difference.",
      confirmation: "Type P00000002 to confirm.",
    });
  });

  it("words a deceased mismatch plainly", () => {
    expect(differenceLabel({ code: "deceased_status", field: "Deceased" })).toBe("Deceased status differs");
    expect(differenceLabel({ code: "birth_date", field: "Birth date" })).toBe("Birth date differs");
  });
});
