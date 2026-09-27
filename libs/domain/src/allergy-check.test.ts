import { describe, expect, it } from "vitest";
import { findAllergyConflict, isValidOverrideReason } from "./allergy-check";
import type { Allergy } from "./types";

const penicillin: Allergy = { id: "a1", substance: "Penicillin", reaction: "Urticaria", severity: "severe" };
const shellfish: Allergy = { id: "a2", substance: "Shellfish", severity: "mild" };
const sulfa: Allergy = { id: "a3", substance: "Sulfonamides", severity: "moderate" };

describe("findAllergyConflict", () => {
  it("matches a drug in the allergy's cross-reactive class and names the class as evidence", () => {
    const c = findAllergyConflict("Amoxicillin 500 mg", [penicillin]);
    expect(c?.allergy).toBe(penicillin);
    expect(c?.matchedTerm).toBe("amoxicillin");
    expect(c?.drugClass).toBe("penicillin-class antibiotics");
    expect(c?.source).toMatch(/verify clinically/);
  });

  it("matches the substance name itself without claiming a class", () => {
    const c = findAllergyConflict("Penicillin V", [penicillin]);
    expect(c?.matchedTerm).toBe("penicillin");
    expect(c?.drugClass).toBeUndefined();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(findAllergyConflict("  CO-TRIMOXAZOLE ", [sulfa])?.allergy).toBe(sulfa);
  });

  it("falls back to the substance name for allergies without a class rule", () => {
    expect(findAllergyConflict("Shellfish extract", [shellfish])?.allergy).toBe(shellfish);
    expect(findAllergyConflict("Losartan", [shellfish])).toBeUndefined();
  });

  it("returns nothing for unrelated drugs, empty drugs, or no allergies", () => {
    expect(findAllergyConflict("Metformin", [penicillin, sulfa])).toBeUndefined();
    expect(findAllergyConflict("   ", [penicillin])).toBeUndefined();
    expect(findAllergyConflict("Amoxicillin", [])).toBeUndefined();
  });

  it("uses a configured class map instead of the demo list", () => {
    const classes = { penicillin: { label: "custom", members: ["drugx"] } };
    expect(findAllergyConflict("DrugX", [penicillin], classes, "Formulary v2")).toMatchObject({ drugClass: "custom", source: "Formulary v2" });
    expect(findAllergyConflict("Amoxicillin", [penicillin], classes)).toBeUndefined();
  });
});

describe("isValidOverrideReason", () => {
  it("requires a documented reason of at least 10 characters", () => {
    expect(isValidOverrideReason(undefined)).toBe(false);
    expect(isValidOverrideReason("   ok      ")).toBe(false);
    expect(isValidOverrideReason("Tolerated before")).toBe(true);
  });
});
