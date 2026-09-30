import { describe, expect, it } from "vitest";
import { BLANK_DEFINITION_FORM, BLANK_PROCEDURE_FORM, definitionFormSchema, definitionLabel, procedureFormSchema, procedurePayload } from "./procedure-form";

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
});
