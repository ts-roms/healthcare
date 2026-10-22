import { describe, expect, it } from "vitest";
import { BLANK_VISIT_TYPE, VISIT_TYPE_MODALITIES, visitTypeFormSchema } from "./visit-type-form";

const valid = {
  code: "consult",
  name: "Consultation",
  defaultDurationMinutes: "20",
  modality: "in_person" as const,
  requiresTriage: true,
  onlineBooking: false,
};
const firstMessage = (input: unknown) => {
  const parsed = visitTypeFormSchema.safeParse(input);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("visit type form", () => {
  it("accepts a complete form and turns the duration into a number", () => {
    const parsed = visitTypeFormSchema.parse(valid);
    expect(parsed).toEqual({ ...valid, defaultDurationMinutes: 20 });
  });

  it("trims and lower-cases the code and name the way the API does", () => {
    const parsed = visitTypeFormSchema.parse({ ...valid, code: "  Follow-Up  ", name: "  Follow-up visit  " });
    expect(parsed.code).toBe("follow-up");
    expect(parsed.name).toBe("Follow-up visit");
  });

  it("refuses codes the API would refuse", () => {
    expect(firstMessage({ ...valid, code: "" })).toMatch(/lower-case letters, digits or hyphens/);
    expect(firstMessage({ ...valid, code: "a" })).toMatch(/lower-case letters, digits or hyphens/);
    expect(firstMessage({ ...valid, code: "-dash" })).toMatch(/lower-case letters, digits or hyphens/);
    expect(firstMessage({ ...valid, code: "with space" })).toMatch(/lower-case letters, digits or hyphens/);
    expect(firstMessage({ ...valid, code: "x".repeat(50) })).toMatch(/lower-case letters, digits or hyphens/);
    expect(firstMessage({ ...valid, code: "x".repeat(49) })).toBeNull();
  });

  it("needs a name of at most 120 characters", () => {
    expect(firstMessage({ ...valid, name: "   " })).toMatch(/Name the visit type/);
    expect(firstMessage({ ...valid, name: "n".repeat(121) })).toMatch(/120 characters/);
    expect(firstMessage({ ...valid, name: "n".repeat(120) })).toBeNull();
  });

  it("keeps the duration between 5 and 480 whole minutes", () => {
    expect(firstMessage({ ...valid, defaultDurationMinutes: "" })).toMatch(/length in minutes|at least 5/);
    expect(firstMessage({ ...valid, defaultDurationMinutes: "abc" })).toMatch(/length in minutes/);
    expect(firstMessage({ ...valid, defaultDurationMinutes: "4" })).toMatch(/at least 5 minutes/);
    expect(firstMessage({ ...valid, defaultDurationMinutes: "481" })).toMatch(/at most 8 hours/);
    expect(firstMessage({ ...valid, defaultDurationMinutes: "12.5" })).toMatch(/whole minutes/);
    expect(firstMessage({ ...valid, defaultDurationMinutes: "5" })).toBeNull();
    expect(firstMessage({ ...valid, defaultDurationMinutes: "480" })).toBeNull();
  });

  it("allows only the two modalities the API knows", () => {
    expect(VISIT_TYPE_MODALITIES.map((m) => m.value)).toEqual(["in_person", "telemedicine"]);
    expect(firstMessage({ ...valid, modality: "telemedicine" })).toBeNull();
    expect(firstMessage({ ...valid, modality: "home" })).toMatch(/where the visit happens/);
  });

  it("requires the two switches to be answered", () => {
    expect(firstMessage({ ...valid, requiresTriage: undefined })).not.toBeNull();
    expect(firstMessage({ ...valid, onlineBooking: "yes" })).not.toBeNull();
  });

  it("starts in person, with triage, staff-only, and does not pass as a visit type yet", () => {
    expect(BLANK_VISIT_TYPE.modality).toBe("in_person");
    expect(BLANK_VISIT_TYPE.requiresTriage).toBe(true);
    expect(BLANK_VISIT_TYPE.onlineBooking).toBe(false);
    expect(firstMessage(BLANK_VISIT_TYPE)).not.toBeNull();
  });
});
