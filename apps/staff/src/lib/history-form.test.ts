import { describe, expect, it } from "vitest";
import {
  alcoholText,
  BLANK_CONDITION,
  BLANK_FAMILY,
  BLANK_PROCEDURE,
  conditionFormSchema,
  conditionPayload,
  familyFormSchema,
  familyPayload,
  familyStateView,
  partialDateLabel,
  procedureFormSchema,
  procedurePayload,
  reviewFormSchema,
  reviewPayload,
  socialFormFrom,
  socialPayload,
  sourceLabel,
  tobaccoText,
} from "./history-form";

const format = (d: string) => `D:${d}`;
const V = "3f1f7c1e-5b36-4a51-9a51-0d6a4c1f0b11";

describe("history display", () => {
  it("prints a past date at its precision", () => {
    expect(partialDateLabel("2019", "year", format)).toBe("2019");
    expect(partialDateLabel("2019-05", "month", format)).toBe("May 2019");
    expect(partialDateLabel("2019-05-12", "day", format)).toBe("D:2019-05-12");
    expect(partialDateLabel(null, null, format)).toBe("Date not known");
  });

  it("says where an entry comes from", () => {
    expect(sourceLabel({ source: "reported", reportedBy: "relative" })).toBe("Reported by relative");
    expect(sourceLabel({ source: "recorded_here" })).toBe("Documented here");
    expect(sourceLabel({ source: "external_import" })).toBe("Imported");
  });

  it("words the family history state like allergies: none known only after a review", () => {
    expect(familyStateView("not_recorded", null)).toMatchObject({ label: "Family history not recorded — ask the patient", variant: "warning" });
    expect(familyStateView("none_known", null).label).toBe("No known family history");
    expect(familyStateView("unknown", { unknownReason: "adopted" }).label).toBe("Family history not known (adopted)");
    expect(familyStateView("recorded", null).tone).toBe("recorded");
  });

  it("describes tobacco and alcohol use", () => {
    expect(tobaccoText({ tobaccoStatus: "former", tobaccoType: "Cigarettes", tobaccoAmount: null, tobaccoQuitYear: 2015 })).toBe(
      "Former — Cigarettes, quit 2015",
    );
    expect(tobaccoText({ tobaccoStatus: null, tobaccoType: null, tobaccoAmount: null, tobaccoQuitYear: null })).toBeNull();
    expect(alcoholText({ alcoholStatus: "never", alcoholFrequency: null })).toBe("Never");
  });
});

describe("history forms", () => {
  it("builds a procedure without blanks, with who reported it only for a reported entry", () => {
    const parsed = procedureFormSchema.parse({ ...BLANK_PROCEDURE, description: "Appendectomy", performed: "2010", encounterId: V });
    expect(procedurePayload(parsed)).toEqual({ description: "Appendectomy", performed: "2010", encounterId: V, source: "reported", reportedBy: "patient" });
    const here = procedureFormSchema.parse({
      ...BLANK_PROCEDURE,
      description: "Cholecystectomy",
      source: "recorded_here",
      codeSystem: "Procedure",
      code: "LC",
    });
    expect(procedurePayload(here)).toEqual({ description: "Cholecystectomy", codeSystem: "procedure", code: "LC", source: "recorded_here" });
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE, description: "X", performed: "May 2010" }).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE, description: "X", code: "LC" }).success).toBe(false);
    expect(procedureFormSchema.safeParse({ ...BLANK_PROCEDURE, description: "X", reportedBy: "" }).success).toBe(false);
  });

  it("builds a condition with its reported status", () => {
    const parsed = conditionFormSchema.parse({ ...BLANK_CONDITION, description: "Tuberculosis", status: "resolved", onset: "2015-03" });
    expect(conditionPayload(parsed)).toEqual({ description: "Tuberculosis", status: "resolved", onset: "2015-03", source: "reported", reportedBy: "patient" });
  });

  it("builds a family history entry: the relative, age at onset, and a cause of death only for a relative who died", () => {
    expect(familyFormSchema.safeParse({ ...BLANK_FAMILY, condition: "Diabetes" }).success).toBe(false);
    expect(familyFormSchema.safeParse({ ...BLANK_FAMILY, relationship: "other", condition: "Diabetes" }).success).toBe(false);
    expect(familyFormSchema.safeParse({ ...BLANK_FAMILY, relationship: "father", condition: "Stroke", causeOfDeath: "Stroke" }).success).toBe(false);
    const parsed = familyFormSchema.parse({
      ...BLANK_FAMILY,
      relationship: "father",
      condition: "Diabetes",
      onsetAge: "45",
      deceased: "yes",
      causeOfDeath: "Stroke",
    });
    expect(familyPayload(parsed)).toEqual({
      relationship: "father",
      condition: "Diabetes",
      reportedBy: "patient",
      onsetAge: 45,
      deceased: true,
      causeOfDeath: "Stroke",
    });
    const alive = familyFormSchema.parse({ ...BLANK_FAMILY, relationship: "sister", relationshipText: "older", condition: "Asthma", deceased: "no" });
    expect(familyPayload(alive)).toEqual({ relationship: "sister", relationshipText: "older", condition: "Asthma", reportedBy: "patient", deceased: false });
  });

  it("needs the reason when the family history is not known", () => {
    expect(reviewFormSchema.safeParse({ outcome: "unknown", unknownReason: "", notes: "" }).success).toBe(false);
    expect(reviewPayload(reviewFormSchema.parse({ outcome: "unknown", unknownReason: "adopted", notes: "" }))).toEqual({
      outcome: "unknown",
      unknownReason: "adopted",
    });
    expect(reviewPayload(reviewFormSchema.parse({ outcome: "none_known", unknownReason: "adopted", notes: "Asked" }))).toEqual({
      outcome: "none_known",
      notes: "Asked",
    });
  });
});

describe("social history versions", () => {
  const current = {
    id: V,
    tobaccoStatus: "current" as const,
    tobaccoType: "Cigarettes",
    tobaccoAmount: "10 a day",
    tobaccoQuitYear: null,
    alcoholStatus: null,
    alcoholFrequency: null,
    substanceUse: "None",
    occupation: "Driver",
    occupationalExposures: null,
    livingSituation: null,
    physicalActivity: null,
    diet: null,
    sexualHistory: null,
    notes: null,
  };

  it("sends only what changed, on top of the current version", () => {
    const form = { ...socialFormFrom(current), tobaccoStatus: "former" as const, tobaccoQuitYear: "2025", occupation: "" };
    expect(socialPayload(form, current, true)).toEqual({ ok: true, body: { basedOn: V, tobaccoStatus: "former", tobaccoQuitYear: 2025, occupation: null } });
  });

  it("never sends the sensitive parts for a user who may not see them", () => {
    const withheld = { ...current, substanceUse: null };
    const form = { ...socialFormFrom(withheld), substanceUse: "Cannabis", diet: "Low salt" };
    expect(socialPayload(form, withheld, false)).toEqual({ ok: true, body: { basedOn: V, diet: "Low salt" } });
  });

  it("starts the first version from nothing and refuses an unchanged or malformed one", () => {
    expect(socialPayload({ ...socialFormFrom(null), occupation: "Farmer" }, null, true)).toEqual({ ok: true, body: { basedOn: null, occupation: "Farmer" } });
    expect(socialPayload(socialFormFrom(current), current, true)).toEqual({ ok: false, message: "Nothing changed from the current version" });
    expect(socialPayload({ ...socialFormFrom(current), tobaccoQuitYear: "15" }, current, true)).toMatchObject({ ok: false });
  });
});
