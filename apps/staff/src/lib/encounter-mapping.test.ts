import { describe, expect, it } from "vitest";
import {
  diagnosisLabel,
  encounterControls,
  prescriptionControls,
  isNoteDirty,
  noteFromRevision,
  notePayload,
  noteReadyToSign,
  sortDiagnoses,
} from "./encounter-mapping";

const doctor = ["encounter.read", "encounter.write", "encounter.sign", "encounter.amend"];

describe("note helpers", () => {
  it("maps revisions to the form and back, omitting empty sections", () => {
    const form = noteFromRevision({ subjective: "Cough", objective: null, assessment: null, plan: "  " });
    expect(form).toEqual({ subjective: "Cough", objective: "", assessment: "", plan: "  " });
    expect(notePayload(form)).toEqual({ subjective: "Cough" });
    expect(noteFromRevision(null)).toEqual({ subjective: "", objective: "", assessment: "", plan: "" });
  });

  it("detects unsaved changes", () => {
    const saved = noteFromRevision(null);
    expect(isNoteDirty(saved, { ...saved })).toBe(false);
    expect(isNoteDirty(saved, { ...saved, plan: "Rest" })).toBe(true);
  });

  it("requires an assessment or plan before signing, as the API does", () => {
    expect(noteReadyToSign({ subjective: "x", objective: "y", assessment: " ", plan: "" })).toBe(false);
    expect(noteReadyToSign({ subjective: "", objective: "", assessment: "", plan: "Rest" })).toBe(true);
  });
});

describe("encounterControls", () => {
  it("lets the responsible practitioner edit and sign an encounter in progress", () => {
    expect(encounterControls("in_progress", { permissions: doctor, isResponsiblePractitioner: true })).toEqual({
      editNote: true,
      sign: true,
      amend: false,
      markEnteredInError: true,
      addDiagnosis: true,
      diagnosisNeedsReason: false,
    });
  });

  it("does not offer signing to anyone else", () => {
    expect(encounterControls("in_progress", { permissions: doctor, isResponsiblePractitioner: false }).sign).toBe(false);
  });

  it("offers only amendments once signed, and nothing once entered in error", () => {
    const signed = encounterControls("completed", { permissions: doctor, isResponsiblePractitioner: true });
    expect(signed).toMatchObject({ editNote: false, sign: false, amend: true, markEnteredInError: false, addDiagnosis: true, diagnosisNeedsReason: true });
    expect(encounterControls("completed", { permissions: ["encounter.read", "encounter.write"], isResponsiblePractitioner: true }).addDiagnosis).toBe(false);
    const voided = encounterControls("entered_in_error", { permissions: doctor, isResponsiblePractitioner: true });
    expect([voided.editNote, voided.sign, voided.amend, voided.markEnteredInError, voided.addDiagnosis]).toEqual([false, false, false, false, false]);
  });

  it("is read-only without write permission", () => {
    const view = encounterControls("in_progress", { permissions: ["encounter.read"], isResponsiblePractitioner: false });
    expect(view.editNote || view.sign || view.addDiagnosis || view.markEnteredInError).toBe(false);
  });
});

describe("diagnoses", () => {
  it("labels coded diagnoses with their code system", () => {
    expect(diagnosisLabel({ code: "E11.9", display: "Type 2 diabetes", codeSystemKey: "icd10" })).toBe("E11.9 · Type 2 diabetes (icd10)");
    expect(diagnosisLabel({ code: null, display: "Viral URTI", codeSystemKey: null })).toBe("Viral URTI");
  });

  it("orders active primary first, entered-in-error last", () => {
    const rows = [
      { id: "e", status: "entered_in_error", rank: "primary", recordedAt: "1" },
      { id: "s", status: "active", rank: "secondary", recordedAt: "1" },
      { id: "p", status: "active", rank: "primary", recordedAt: "2" },
      { id: "r", status: "resolved", rank: "secondary", recordedAt: "0" },
    ] as const;
    expect(sortDiagnoses([...rows]).map((r) => r.id)).toEqual(["p", "s", "r", "e"]);
  });
});

describe("prescriptionControls", () => {
  const prescriber = ["prescription.read", "prescription.issue", "prescription.cancel"];
  it("issues only in an open encounter, corrects active prescriptions after signing too", () => {
    const open = prescriptionControls("in_progress", prescriber);
    expect(open.issue).toBe(true);
    const signed = prescriptionControls("completed", prescriber);
    expect(signed.issue).toBe(false);
    expect(signed.replace({ status: "active" })).toBe(true);
    expect(signed.replace({ status: "superseded" })).toBe(false);
    expect(signed.cancel({ status: "cancelled" })).toBe(false);
  });

  it("offers nothing without permission or on an encounter entered in error", () => {
    const readOnly = prescriptionControls("in_progress", ["prescription.read"]);
    expect([readOnly.issue, readOnly.replace({ status: "active" }), readOnly.cancel({ status: "active" })]).toEqual([false, false, false]);
    expect(prescriptionControls("entered_in_error", prescriber).replace({ status: "active" })).toBe(false);
  });
});
