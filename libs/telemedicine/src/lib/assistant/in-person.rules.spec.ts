import { IN_PERSON_RULE, type InPersonInput, inPersonSuggestions } from "./in-person.rules";

const params = IN_PERSON_RULE.defaultParameters; // 3 online in 30 days, 12 months, 14 days

function input(over: Partial<InPersonInput> = {}): InPersonInput {
  return {
    encounterId: "enc-1",
    asOf: "2026-11-21T02:00:00.000Z",
    timeZone: "Asia/Manila",
    redFlags: [],
    symptomDurationDays: 3,
    onlineConsultations: 1,
    lastInPersonAt: "2026-09-10T01:00:00.000Z",
    lastVitalsAt: "2026-09-10T01:05:00.000Z",
    ...over,
  };
}

describe("telemedicine.in-person-care", () => {
  it("is silent for a patient seen in person lately, without red flags or long symptoms", () => {
    expect(inPersonSuggestions(input(), params)).toEqual([]);
  });

  it("warns with the red flags the patient ticked, by their questionnaire wording", () => {
    const [s, ...rest] = inPersonSuggestions(input({ redFlags: ["chest_pain", "difficulty_breathing"] }), params);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      id: "telemedicine.in-person-care@1:encounter:enc-1",
      surface: "encounter",
      severity: "warning",
      basis: "rule",
      title: "Consider seeing the patient in person: 2 red flags ticked",
    });
    expect(s!.rationale).toContain("the patient ticked: Chest pain or pressure; Difficulty breathing or shortness of breath.");
    expect(s!.rationale).toContain("Escalate to in-person care");
    expect(s!.evidence.filter((e) => e.label === "Red flag ticked by the patient").map((e) => e.value)).toEqual([
      "Chest pain or pressure",
      "Difficulty breathing or shortness of breath",
    ]);
    expect(s!.action).toBeUndefined();
  });

  it("advises on repeated online consultations, long symptoms and no in-person consultation for months", () => {
    const [s] = inPersonSuggestions(
      input({ onlineConsultations: 3, symptomDurationDays: 21, lastInPersonAt: "2025-08-01T01:00:00.000Z", lastVitalsAt: null }),
      params,
    );
    expect(s).toMatchObject({
      severity: "advice",
      title: "Consider seeing the patient in person: symptoms for 21 days; 3 online consultations in 30 days; not seen in person since 2025-08-01",
    });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Symptoms lasted (the patient's answer)", "21 days"],
      ["Online consultations in 30 days", "3 (this one included)"],
      ["Last in-person consultation", "2025-08-01"],
      ["Last vital signs", "none recorded here"],
    ]);
  });

  it("says when the patient was never seen in person here, and lets checks be turned off", () => {
    const never = input({ lastInPersonAt: null });
    expect(inPersonSuggestions(never, params)[0]!.title).toBe("Consider seeing the patient in person: never seen in person here");
    expect(inPersonSuggestions(never, { ...params, inPersonMonths: 0 })).toEqual([]);
    expect(inPersonSuggestions(input({ symptomDurationDays: 60 }), { ...params, symptomDays: 0 })).toEqual([]);
    expect(inPersonSuggestions(input({ symptomDurationDays: null }), params)).toEqual([]);
  });
});
