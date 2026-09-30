import {
  recordFamilyHistorySchema,
  recordPastConditionSchema,
  recordPastProcedureSchema,
  recordReportedMedicationSchema,
  familyReviewSchema,
  recordSocialHistorySchema,
} from "./history.dto";
import {
  alcoholText,
  changedSocialFields,
  EMPTY_SOCIAL,
  familyHistoryState,
  isPartialDateText,
  medicationState,
  nextSocialVersion,
  partialDateInFuture,
  partialDateText,
  parsePartialDate,
  relativeText,
  reviewConflict,
  socialHasContent,
  stopBeforeStart,
  tobaccoText,
} from "./history.rules";

describe("partial dates", () => {
  it("accepts a year, a month or a real day from 1900", () => {
    expect(isPartialDateText("2019")).toBe(true);
    expect(isPartialDateText("2019-05")).toBe(true);
    expect(isPartialDateText("2020-02-29")).toBe(true);
    expect(isPartialDateText("2019-02-29")).toBe(false);
    expect(isPartialDateText("2019-13")).toBe(false);
    expect(isPartialDateText("1899")).toBe(false);
    expect(isPartialDateText("2019-05-12T10:00:00Z")).toBe(false);
    expect(isPartialDateText("childhood")).toBe(false);
  });

  it("keeps a year as 1 January and a month as its first day, and prints them back at their precision", () => {
    expect(parsePartialDate("2019")).toEqual({ date: "2019-01-01", precision: "year" });
    expect(parsePartialDate("2019-05")).toEqual({ date: "2019-05-01", precision: "month" });
    expect(parsePartialDate("2019-05-12")).toEqual({ date: "2019-05-12", precision: "day" });
    expect(partialDateText("2019-01-01", "year")).toBe("2019");
    expect(partialDateText("2019-05-01", "month")).toBe("2019-05");
    expect(partialDateText("2019-05-12", "day")).toBe("2019-05-12");
    expect(partialDateText(null, null)).toBeNull();
    expect(() => parsePartialDate("May 2019")).toThrow();
  });

  it("is in the future only when it starts after today", () => {
    expect(partialDateInFuture(parsePartialDate("2026"), "2026-09-30")).toBe(false);
    expect(partialDateInFuture(parsePartialDate("2026-10"), "2026-09-30")).toBe(true);
    expect(partialDateInFuture(parsePartialDate("2026-09-30"), "2026-09-30")).toBe(false);
  });
});

describe("family history", () => {
  it("shows the relative with the free text, or the free text alone for another relative", () => {
    expect(relativeText("mother", null)).toBe("Mother");
    expect(relativeText("sister", "older")).toBe("Sister (older)");
    expect(relativeText("other", "Godmother")).toBe("Godmother");
  });

  it("says none known or not known only after a review; entries win over a review", () => {
    expect(familyHistoryState(0, null)).toBe("not_recorded");
    expect(familyHistoryState(0, { outcome: "none_known" })).toBe("none_known");
    expect(familyHistoryState(0, { outcome: "unknown" })).toBe("unknown");
    expect(familyHistoryState(2, { outcome: "none_known" })).toBe("recorded");
    expect(familyHistoryState(0, { outcome: "reviewed" })).toBe("not_recorded");
  });

  it("refuses a review that contradicts what is listed", () => {
    expect(reviewConflict("none_known", 1)).toMatch(/listed/);
    expect(reviewConflict("reviewed", 0)).toMatch(/Nothing is listed/);
    expect(reviewConflict("reviewed", 2)).toBeNull();
    expect(reviewConflict("unknown", 2)).toBeNull();
  });

  it("validates the relative and the cause of death", () => {
    expect(recordFamilyHistorySchema.safeParse({ relationship: "other", condition: "Diabetes" }).success).toBe(false);
    expect(recordFamilyHistorySchema.safeParse({ relationship: "other", relationshipText: "Godmother", condition: "Diabetes" }).success).toBe(true);
    expect(recordFamilyHistorySchema.safeParse({ relationship: "cousin", condition: "Stroke", causeOfDeath: "Stroke" }).success).toBe(false);
    expect(recordFamilyHistorySchema.safeParse({ relationship: "cousin", condition: "Stroke", deceased: true, causeOfDeath: "Stroke" }).success).toBe(true);
    expect(recordFamilyHistorySchema.safeParse({ relationship: "aunt", condition: "Stroke" }).success).toBe(false);
    expect(familyReviewSchema.safeParse({ outcome: "unknown" }).success).toBe(false);
    expect(familyReviewSchema.safeParse({ outcome: "unknown", unknownReason: "adopted" }).success).toBe(true);
    expect(familyReviewSchema.safeParse({ outcome: "none_known", unknownReason: "adopted" }).success).toBe(false);
  });
});

describe("past procedures and conditions", () => {
  it("needs who reported it unless documented here, a code with its system, and a partial date", () => {
    expect(recordPastProcedureSchema.safeParse({ description: "Appendectomy" }).success).toBe(false);
    expect(recordPastProcedureSchema.safeParse({ description: "Appendectomy", reportedBy: "patient", performed: "2010" }).success).toBe(true);
    expect(recordPastProcedureSchema.safeParse({ description: "Appendectomy", source: "recorded_here" }).success).toBe(true);
    expect(recordPastProcedureSchema.safeParse({ description: "Appendectomy", source: "recorded_here", reportedBy: "patient" }).success).toBe(false);
    expect(recordPastProcedureSchema.safeParse({ description: "Appendectomy", reportedBy: "patient", code: "0DTJ4ZZ" }).success).toBe(false);
    expect(recordPastProcedureSchema.safeParse({ description: "Appendectomy", reportedBy: "patient", performed: "10/2010" }).success).toBe(false);
    expect(recordPastConditionSchema.safeParse({ description: "Tuberculosis", status: "resolved", reportedBy: "patient", onset: "2015-03" }).success).toBe(
      true,
    );
    expect(recordPastConditionSchema.safeParse({ description: "Tuberculosis", reportedBy: "patient" }).success).toBe(false);
  });
});

describe("social history versions", () => {
  const current = {
    ...EMPTY_SOCIAL,
    tobaccoStatus: "current" as const,
    tobaccoType: "Cigarettes",
    tobaccoAmount: "10 a day",
    alcoholStatus: "current" as const,
    alcoholFrequency: "Weekends",
    occupation: "Driver",
    substanceUse: "None reported",
  };

  it("carries over what is left out, replaces what is given and clears with null", () => {
    const next = nextSocialVersion(current, { occupation: "Farmer", alcoholFrequency: null });
    expect(next.occupation).toBe("Farmer");
    expect(next.tobaccoType).toBe("Cigarettes");
    expect(next.alcoholFrequency).toBeNull();
    expect(next.substanceUse).toBe("None reported");
    expect(changedSocialFields(current, next)).toEqual(["alcoholFrequency", "occupation"]);
  });

  it("drops details a status no longer allows", () => {
    const quit = nextSocialVersion(current, { tobaccoStatus: "former", tobaccoQuitYear: 2025 });
    expect(quit.tobaccoType).toBe("Cigarettes");
    expect(quit.tobaccoQuitYear).toBe(2025);
    const never = nextSocialVersion(quit, { tobaccoStatus: "never", alcoholStatus: "never" });
    expect(never).toMatchObject({ tobaccoType: null, tobaccoAmount: null, tobaccoQuitYear: null, alcoholFrequency: null });
    const againCurrent = nextSocialVersion(quit, { tobaccoStatus: "current" });
    expect(againCurrent.tobaccoQuitYear).toBeNull();
  });

  it("starts from nothing for the first version and knows an empty one", () => {
    expect(socialHasContent(nextSocialVersion(null, {}))).toBe(false);
    expect(socialHasContent(nextSocialVersion(null, { diet: "Low salt" }))).toBe(true);
    expect(changedSocialFields(null, nextSocialVersion(null, { diet: "Low salt" }))).toEqual(["diet"]);
  });

  it("describes tobacco and alcohol use in words", () => {
    expect(tobaccoText(current)).toBe("Current — Cigarettes, 10 a day");
    expect(tobaccoText({ ...current, tobaccoStatus: "former", tobaccoType: null, tobaccoAmount: null, tobaccoQuitYear: 2015 })).toBe("Former — quit 2015");
    expect(tobaccoText(EMPTY_SOCIAL)).toBeNull();
    expect(alcoholText({ alcoholStatus: "never", alcoholFrequency: null })).toBe("Never");
    expect(alcoholText(current)).toBe("Current — Weekends");
  });

  it("requires the version it is based on (null for the first)", () => {
    expect(recordSocialHistorySchema.safeParse({ occupation: "Driver" }).success).toBe(false);
    expect(recordSocialHistorySchema.safeParse({ basedOn: null, occupation: "Driver" }).success).toBe(true);
    expect(recordSocialHistorySchema.safeParse({ basedOn: null, effectiveDate: "2026-02-30" }).success).toBe(false);
  });
});

describe("medications taken", () => {
  it("refuses a stop only when it ends before the start, at the precisions known", () => {
    const d = (v: string) => parsePartialDate(v);
    expect(stopBeforeStart(d("2019-05"), d("2019"))).toBe(false);
    expect(stopBeforeStart(d("2019-05-20"), d("2019-05"))).toBe(false);
    expect(stopBeforeStart(d("2019-05"), d("2018"))).toBe(true);
    expect(stopBeforeStart(d("2019-05-20"), d("2019-05-19"))).toBe(true);
    expect(stopBeforeStart(d("2024-02"), d("2024-02-29"))).toBe(false);
    expect(stopBeforeStart(null, d("2019"))).toBe(false);
    expect(stopBeforeStart(d("2019"), null)).toBe(false);
  });

  it("is stopped once marked stopped, otherwise as reported", () => {
    expect(medicationState({ reportedStatus: "taking", stopRecordedAt: null })).toBe("taking");
    expect(medicationState({ reportedStatus: "unknown", stopRecordedAt: new Date() })).toBe("stopped");
    expect(medicationState({ reportedStatus: "stopped", stopRecordedAt: null })).toBe("stopped");
  });

  it("validates what is recorded", () => {
    const base = { medication: "Losartan 50 mg tablet", status: "taking" as const, source: "reported" as const, reportedBy: "patient" as const };
    expect(recordReportedMedicationSchema.safeParse(base).success).toBe(true);
    expect(recordReportedMedicationSchema.safeParse({ ...base, stopped: "2020" }).success).toBe(false);
    expect(recordReportedMedicationSchema.safeParse({ ...base, status: "stopped", stopped: "2020" }).success).toBe(true);
    expect(recordReportedMedicationSchema.safeParse({ ...base, reportedBy: undefined }).success).toBe(false);
    expect(recordReportedMedicationSchema.safeParse({ ...base, source: "recorded_here", reportedBy: undefined }).success).toBe(true);
    expect(recordReportedMedicationSchema.safeParse({ ...base, code: "C09CA01" }).success).toBe(false);
    expect(recordReportedMedicationSchema.safeParse({ ...base, started: "2019-13" }).success).toBe(false);
  });
});
