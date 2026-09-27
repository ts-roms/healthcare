import { describe, expect, it } from "vitest";
import { allergyFormSchema, BLANK_ALLERGY, reviewState } from "./allergy-form";

describe("allergyFormSchema", () => {
  it("requires a substance and drops empty optional fields", () => {
    expect(allergyFormSchema.safeParse(BLANK_ALLERGY).success).toBe(false);
    expect(allergyFormSchema.parse({ ...BLANK_ALLERGY, substance: " Penicillin ", reaction: " " })).toEqual({
      category: "medication",
      substance: "Penicillin",
      reaction: undefined,
      severity: undefined,
      criticality: "unable_to_assess",
      verification: "unconfirmed",
    });
  });
});

describe("reviewState", () => {
  it("never presents an unreviewed record as no allergies", () => {
    expect(reviewState({ status: "not_reviewed", allergies: [] })).toEqual({
      tone: "warning",
      text: "Allergies not recorded — ask the patient",
      canConfirmNone: true,
    });
    expect(reviewState({ status: "no_known_allergies", allergies: [] })).toMatchObject({ tone: "success", canConfirmNone: false });
  });

  it("does not offer 'no known allergies' while allergies are recorded", () => {
    const state = reviewState({ status: "has_allergies", allergies: [{} as never, {} as never] });
    expect(state).toEqual({ tone: "neutral", text: "2 active allergies", canConfirmNone: false });
  });
});
