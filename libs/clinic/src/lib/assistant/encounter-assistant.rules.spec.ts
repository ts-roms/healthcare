import { CODE_SUGGESTIONS_RULE, codeSuggestions, type UsedCode } from "./code-suggestions.rules";
import { ENCOUNTER_CHECKLIST_RULE, encounterChecklistSuggestions, missingItems, type EncounterChecklistInput } from "./encounter-checklist.rules";

describe("clinic.encounter-checklist", () => {
  const params = { vitalsWithinHours: 24, checkVitals: 1, checkCoding: 1 };
  const complete: EncounterChecklistInput = {
    encounterId: "e1",
    inPerson: true,
    hasChiefComplaint: true,
    hasVitals: true,
    hasAssessment: true,
    hasPlan: true,
    diagnoses: [{ coded: true, primary: true }],
    allergiesReviewed: true,
    codingAvailable: true,
  };

  it("says nothing when the record holds everything", () => {
    expect(encounterChecklistSuggestions(complete, params)).toEqual([]);
    expect(encounterChecklistSuggestions(null, params)).toEqual([]);
  });

  it("lists what is missing, in the order a doctor works", () => {
    const empty = { ...complete, hasChiefComplaint: false, hasVitals: false, hasAssessment: false, hasPlan: false, diagnoses: [], allergiesReviewed: false };
    expect(missingItems(empty, params)).toEqual([
      "Chief complaint",
      "Vital signs (none in the last 24 hours)",
      "Allergy review",
      "Assessment",
      "Plan",
      "A diagnosis",
    ]);
    const [s] = encounterChecklistSuggestions(empty, params);
    expect(s).toMatchObject({ ruleId: "clinic.encounter-checklist", severity: "advice", title: "Before signing: 6 items not recorded yet" });
    expect(s!.action).toBeUndefined();
  });

  it("checks codes and a primary diagnosis", () => {
    const diagnoses = [
      { coded: false, primary: false },
      { coded: true, primary: false },
    ];
    expect(missingItems({ ...complete, diagnoses }, params)).toEqual(["A code for 1 diagnosis", "A primary diagnosis"]);
    expect(missingItems({ ...complete, diagnoses, codingAvailable: false }, params)).toEqual(["A primary diagnosis"]);
    expect(missingItems({ ...complete, diagnoses }, { ...params, checkCoding: 0 })).toEqual(["A primary diagnosis"]);
  });

  it("skips vital signs online or when the organization turned the check off", () => {
    expect(missingItems({ ...complete, hasVitals: false, inPerson: false }, params)).toEqual([]);
    expect(missingItems({ ...complete, hasVitals: false }, { ...params, checkVitals: 0 })).toEqual([]);
  });

  it("accepts its default parameters", () => {
    expect(ENCOUNTER_CHECKLIST_RULE.parametersSchema.safeParse(ENCOUNTER_CHECKLIST_RULE.defaultParameters).success).toBe(true);
  });
});

describe("clinic.code-suggestions", () => {
  const params = { minCoveragePercent: 60, minUses: 2, lookbackDays: 730 };
  const codes: UsedCode[] = [
    { codeSystemKey: "icd10", code: "J06.9", display: "Acute upper respiratory infection", uses: 34 },
    { codeSystemKey: "icd10", code: "J20.9", display: "Acute bronchitis", uses: 12 },
    { codeSystemKey: "icd10", code: "J02.9", display: "Acute pharyngitis", uses: 20 },
    { codeSystemKey: "icd10", code: "X99", display: "Upper respiratory infection after travel to a rare place", uses: 1 },
  ];

  it("offers the organization's codes whose descriptions the text covers, with the matching words", () => {
    const [s] = codeSuggestions([{ key: "diagnosis:d1", kind: "diagnosis", text: "Acute upper respiratory infections" }], codes, params);
    expect(s).toMatchObject({ ruleId: "clinic.code-suggestions", severity: "info", basis: "text-match", strength: "matched" });
    expect(s!.title).toBe("Codes your clinic used for “Acute upper respiratory infections”");
    expect(s!.evidence[0]).toMatchObject({
      label: "J06.9 Acute upper respiratory infection (icd10)",
      value: "used 34 times; matching words: acute, upper, respiratory, infection",
    });
    expect(s!.action).toBeUndefined();
  });

  it("never offers a code used fewer times than the minimum", () => {
    const [s] = codeSuggestions(
      [{ key: "assessment:e1", kind: "assessment", text: "Upper respiratory infection after travel to a rare place" }],
      codes,
      params,
    );
    expect(s!.evidence.map((e) => e.resourceId)).toEqual(["icd10:J06.9"]);
  });

  it("stays silent when nothing covers enough, and ranks closer, then more used, matches first", () => {
    expect(codeSuggestions([{ key: "diagnosis:d2", kind: "diagnosis", text: "Sprained ankle" }], codes, params)).toEqual([]);
    const [s] = codeSuggestions([{ key: "assessment:e1", kind: "assessment", text: "Acute bronchitis, also acute pharyngitis" }], codes, params);
    // Both descriptions are fully covered: the code used more often comes first.
    expect(s!.evidence.map((e) => e.resourceId)).toEqual(["icd10:J02.9", "icd10:J20.9"]);
  });

  it("accepts its default parameters", () => {
    expect(CODE_SUGGESTIONS_RULE.parametersSchema.safeParse(CODE_SUGGESTIONS_RULE.defaultParameters).success).toBe(true);
  });
});
