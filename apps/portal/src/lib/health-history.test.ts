import { describe, expect, it } from "vitest";
import {
  buildSubmission,
  EMPTY_SOCIAL,
  familyStateText,
  historySourceText,
  medicationStatusText,
  partialDateProblem,
  pastDate,
  submissionMessage,
} from "./health-history";

describe("health history", () => {
  it("prints a past date as precisely as it is known", () => {
    expect(pastDate("2019")).toBe("2019");
    expect(pastDate("2019-05")).toBe("May 2019");
    expect(pastDate("2019-05-12")).toBe("May 12, 2019");
    expect(pastDate(null)).toBe("Date not known");
  });

  it("says where an entry comes from and the family history state in plain words", () => {
    expect(historySourceText("reported")).toMatch(/told/);
    expect(historySourceText("external_import")).toMatch(/another provider/);
    expect(historySourceText("reported", "patient_portal")).toMatch(/here in MyHealth/);
    expect(familyStateText({ state: "not_recorded", unknownReason: null })).toMatch(/not recorded/);
    expect(familyStateText({ state: "unknown", unknownReason: "adopted" })).toMatch(/adopted/);
    expect(familyStateText({ state: "none_known", unknownReason: null })).toMatch(/No known/);
  });

  it("says whether a medicine from elsewhere is still taken", () => {
    expect(medicationStatusText({ status: "taking", started: "2019-05", stopped: null })).toBe("Taking since May 2019");
    expect(medicationStatusText({ status: "stopped", started: null, stopped: "2020" })).toBe("Stopped 2020");
    expect(medicationStatusText({ status: "unknown", started: null, stopped: null })).toMatch(/Not known/);
  });
});

describe("the questionnaire", () => {
  const med = { medication: "Losartan 50 mg", dose: "", reason: "", prescribedBy: "", started: "", status: "taking" as const, stopped: "" };
  const empty = { medications: [], conditions: [], procedures: [], family: [], social: EMPTY_SOCIAL, socialTouched: false };

  it("accepts a past date as a year, month or day", () => {
    expect(partialDateProblem("")).toBeNull();
    expect(partialDateProblem("2019")).toBeNull();
    expect(partialDateProblem("2019-05")).toBeNull();
    expect(partialDateProblem("2019-05-12")).toBeNull();
    expect(partialDateProblem("May 2019")).toMatch(/year/);
    expect(partialDateProblem("2019-13")).toMatch(/year/);
  });

  it("drops blank rows, leaves blank fields out and refuses an empty questionnaire", () => {
    expect(buildSubmission(empty)).toEqual({ ok: false, problem: expect.stringMatching(/at least one/) });
    const built = buildSubmission({
      ...empty,
      medications: [med, { ...med, medication: "  " }],
      family: [{ relationship: "mother", relationshipText: "", condition: "Diabetes", onsetAge: "50", deceased: "", causeOfDeath: "" }],
    });
    expect(built).toEqual({
      ok: true,
      body: {
        medications: [
          {
            medication: "Losartan 50 mg",
            dose: undefined,
            reason: undefined,
            prescribedBy: undefined,
            started: undefined,
            status: "taking",
            stopped: undefined,
          },
        ],
        conditions: [],
        procedures: [],
        family: [{ relationship: "mother", relationshipText: undefined, condition: "Diabetes", onsetAge: 50, deceased: undefined, causeOfDeath: undefined }],
      },
    });
  });

  it("names the first problem instead of sending", () => {
    expect(buildSubmission({ ...empty, medications: [{ ...med, started: "soon" }] })).toMatchObject({ ok: false, problem: expect.stringMatching(/Losartan/) });
    expect(buildSubmission({ ...empty, medications: [{ ...med, stopped: "2020" }] })).toMatchObject({ ok: false, problem: expect.stringMatching(/stop date/) });
    expect(
      buildSubmission({
        ...empty,
        family: [{ relationship: "other", relationshipText: "", condition: "Asthma", onsetAge: "", deceased: "", causeOfDeath: "" }],
      }),
    ).toMatchObject({ ok: false, problem: expect.stringMatching(/who the relative is/) });
  });

  it("sends daily life only when something was filled in, and only what was", () => {
    const touched = { ...empty, social: { ...EMPTY_SOCIAL, tobaccoStatus: "former" as const, tobaccoQuitYear: "2015" }, socialTouched: true };
    expect(buildSubmission(touched)).toMatchObject({ ok: true, body: { social: { tobaccoStatus: "former", tobaccoQuitYear: 2015 } } });
    expect(buildSubmission({ ...touched, social: { ...touched.social, tobaccoQuitYear: "15" } })).toMatchObject({ ok: false });
    expect(buildSubmission({ ...empty, socialTouched: true })).toMatchObject({ ok: false });
  });

  it("explains the clinic's refusals in plain words", () => {
    expect(submissionMessage("date_in_future", "x")).toMatch(/future/);
    expect(submissionMessage("proxy_view_only", "x")).toMatch(/view-only/);
    expect(submissionMessage(undefined, "Something else")).toBe("Something else");
  });
});
