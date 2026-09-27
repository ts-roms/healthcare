import { describe, expect, it } from "vitest";
import type { Allergy } from "@healthcare/domain";
import { createPrescriptionSchema, toPrescriptionSubmission, type PrescriptionFormValues } from "./prescription-schema";

const penicillin: Allergy = { id: "a1", substance: "Penicillin", reaction: "Urticaria", severity: "severe" };

const line = (drug: string, extra: Partial<PrescriptionFormValues["items"][number]> = {}) => ({
  id: `rx-${drug}`,
  drug,
  strength: "500 mg",
  form: "capsule",
  sig: "1 cap PO TID",
  quantity: 21,
  refills: 0,
  ...extra,
});

const reasonIssues = (r: ReturnType<ReturnType<typeof createPrescriptionSchema>["safeParse"]>) =>
  r.success ? [] : r.error.issues.filter((i) => i.path.at(-1) === "overrideReason").map((i) => i.path[1]);

describe("createPrescriptionSchema", () => {
  const schema = createPrescriptionSchema([penicillin]);

  it("accepts lines with no allergy conflict", () => {
    expect(schema.safeParse({ items: [line("Metformin")] }).success).toBe(true);
  });

  it("rejects a conflicting line without a documented reason, pointing at that line", () => {
    const r = schema.safeParse({ items: [line("Metformin"), line("Amoxicillin")] });
    expect(r.success).toBe(false);
    expect(reasonIssues(r)).toEqual([1]);
  });

  it("rejects a reason that is too short to be meaningful", () => {
    expect(schema.safeParse({ items: [line("Amoxicillin", { overrideReason: "ok" })] }).success).toBe(false);
  });

  it("accepts a conflicting line once an override reason is documented", () => {
    expect(schema.safeParse({ items: [line("Amoxicillin", { overrideReason: "Tolerated previously without reaction" })] }).success).toBe(true);
  });

  it("still reports the missing override when other fields on the line are invalid", () => {
    const r = schema.safeParse({ items: [line("Amoxicillin", { sig: "" })] });
    expect(r.success).toBe(false);
    expect(reasonIssues(r)).toEqual([0]);
  });

  it("does not require a reason when the patient has no matching allergy", () => {
    expect(createPrescriptionSchema([]).safeParse({ items: [line("Amoxicillin")] }).success).toBe(true);
  });
});

describe("toPrescriptionSubmission", () => {
  it("returns clean items plus one audit-ready override per conflicting line", () => {
    const values = {
      items: [line("Metformin", { overrideReason: "stale text from a previous drug" }), line("Amoxicillin", { overrideReason: "  Tolerated in 2024  " })],
    } as PrescriptionFormValues;
    const s = toPrescriptionSubmission(values, [penicillin]);
    expect(s.items.map((i) => i.drug)).toEqual(["Metformin", "Amoxicillin"]);
    expect(s.items.every((i) => !("overrideReason" in i))).toBe(true);
    expect(s.allergyOverrides).toEqual([
      {
        prescriptionItemId: "rx-Amoxicillin",
        drug: "Amoxicillin",
        allergyId: "a1",
        substance: "Penicillin",
        matchedTerm: "amoxicillin",
        reason: "Tolerated in 2024",
      },
    ]);
  });
});
