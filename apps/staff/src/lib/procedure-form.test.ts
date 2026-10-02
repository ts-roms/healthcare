import { describe, expect, it } from "vitest";
import {
  applyDefinition,
  BLANK_DEFINITION_FORM,
  BLANK_PROCEDURE_FORM,
  definitionFormSchema,
  definitionLabel,
  procedureFormSchema,
  procedurePayload,
} from "./procedure-form";

const D = "3f1f7c1e-5b36-4a51-9a51-0d6a4c1f0b11";
const P = "9e121d11-9636-4505-836b-66d13ba58f5e";

describe("procedure form", () => {
  it("builds the payload without blanks, with the Philippine offset on the time", () => {
    const parsed = procedureFormSchema.parse({
      ...BLANK_PROCEDURE_FORM,
      definitionId: D,
      quantity: "2",
      performedAt: "2026-09-30T10:15",
      bodySite: " left forearm ",
    });
    expect(procedurePayload(parsed)).toEqual({ definitionId: D, quantity: 2, performedAt: "2026-09-30T10:15:00+08:00", bodySite: "left forearm" });
    const withPerformer = procedureFormSchema.parse({ ...BLANK_PROCEDURE_FORM, definitionId: D, performerPractitionerId: P, notes: "Tolerated well" });
    expect(procedurePayload(withPerformer)).toEqual({ definitionId: D, quantity: 1, performerPractitionerId: P, notes: "Tolerated well" });
  });

  it("asks for the procedure, a valid quantity, the site when needed and a reason after signing", () => {
    expect(procedureFormSchema.safeParse(BLANK_PROCEDURE_FORM).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE_FORM, definitionId: D, quantity: "0" }).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE_FORM, definitionId: D, quantity: "100" }).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE_FORM, definitionId: D, performedAt: "30/09/2026" }).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE_FORM, definitionId: D, requiresBodySite: true }).success).toBe(false);
    const signed = { ...BLANK_PROCEDURE_FORM, definitionId: D, signed: true };
    expect(procedureFormSchema.safeParse(signed).success).toBe(false);
    const late = procedureFormSchema.parse({ ...signed, lateEntryReason: "Not recorded before signing" });
    expect(procedurePayload(late)).toMatchObject({ lateEntryReason: "Not recorded before signing" });
    // A reason typed before signing is not sent.
    const early = procedureFormSchema.parse({ ...BLANK_PROCEDURE_FORM, definitionId: D, lateEntryReason: "Typed anyway" });
    expect(procedurePayload(early)).not.toHaveProperty("lateEntryReason");
  });

  it("checks catalogue entries", () => {
    expect(definitionFormSchema.safeParse({ ...BLANK_DEFINITION_FORM, code: "SUT-S", name: "Suture repair" }).success).toBe(true);
    expect(definitionFormSchema.safeParse({ ...BLANK_DEFINITION_FORM, code: "sut s", name: "Suture repair" }).success).toBe(false);
    expect(definitionFormSchema.safeParse({ ...BLANK_DEFINITION_FORM, code: "SUT", name: "Suture", codeSystem: "rvs" }).success).toBe(false);
    expect(definitionLabel({ code: "NEB", name: "Nebulization" })).toBe("NEB · Nebulization");
  });

  it("sends the consent only when one is recorded, and asks for it when the catalogue requires it", () => {
    const W = "1c2f0b6a-7d2e-4b53-9d4e-0a1b2c3d4e5f";
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE_FORM, definitionId: D, consentRequired: true }).success).toBe(false);
    const paper = procedureFormSchema.parse({ ...BLANK_PROCEDURE_FORM, definitionId: D, consentRequired: true, consentGiven: true });
    expect(procedurePayload(paper)).toEqual({ definitionId: D, quantity: 1, consent: { capturedVia: "paper", givenBy: "patient" } });
    expect(procedureFormSchema.safeParse({ ...paper, consentGivenBy: "representative" }).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...paper, consentCapturedVia: "electronic" }).success).toBe(false);
    const full = procedureFormSchema.parse({
      ...paper,
      consentCapturedVia: "electronic",
      consentGivenBy: "representative",
      consentRepresentativeName: "Maria Dela Cruz",
      consentRepresentativeRelationship: "mother",
      consentObtainedAt: "2026-09-30T10:00",
      consentWordingId: W,
      consentDocumentId: P,
      consentNotes: "Explained in Filipino",
    });
    expect(procedurePayload(full).consent).toEqual({
      capturedVia: "electronic",
      givenBy: "representative",
      representativeName: "Maria Dela Cruz",
      representativeRelationship: "mother",
      obtainedAt: "2026-09-30T10:00:00+08:00",
      wordingId: W,
      documentId: P,
      notes: "Explained in Filipino",
    });
    // Representative fields typed and then "patient" chosen: not sent.
    expect(procedurePayload({ ...full, consentGivenBy: "patient" }).consent).not.toHaveProperty("representativeName");
  });

  it("prefills the note template when a procedure is chosen, without overwriting the clinician's own words", () => {
    const wording = { id: "1c2f0b6a-7d2e-4b53-9d4e-0a1b2c3d4e5f", definitionId: D, version: 2, title: "Consent", body: "…", createdAt: "" };
    const suture = { id: D, requiresBodySite: true, consentRequired: true, noteTemplate: "Anaesthetic:\nSutures:", consentWording: wording };
    const neb = { id: P, requiresBodySite: false, consentRequired: false, noteTemplate: null, consentWording: null };
    const chosen = applyDefinition(BLANK_PROCEDURE_FORM, suture, undefined);
    expect(chosen).toMatchObject({
      definitionId: D,
      requiresBodySite: true,
      consentRequired: true,
      consentGiven: true,
      consentWordingId: wording.id,
      notes: "Anaesthetic:\nSutures:",
    });
    // Switching to another entry replaces an untouched template; typed notes stay.
    expect(applyDefinition(chosen, neb, suture)).toMatchObject({ definitionId: P, consentWordingId: "", notes: "" });
    const typed = { ...chosen, notes: "Anaesthetic: lidocaine 2%\nSutures: 4" };
    expect(applyDefinition(typed, neb, suture).notes).toBe("Anaesthetic: lidocaine 2%\nSutures: 4");
    expect(applyDefinition(typed, undefined, suture)).toMatchObject({ definitionId: "", requiresBodySite: false });
  });
});
