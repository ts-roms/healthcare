import {
  CHECK_PROMPTS_RULE,
  checkPromptSuggestions,
  checkPromptsParameters,
  dailyDose,
  DOSE_LIMIT_RULE,
  doseLimitSuggestions,
  dosePerAdministration,
  DUPLICATE_THERAPY_RULE,
  duplicateTherapySuggestions,
  type MedicineSetting,
  medicineWords,
  type PrescribingCheck,
  pregnancyCheckApplies,
  sameMedicine,
  settingFor,
  unitKey,
} from "./prescribing.rules";

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

const setting = (name: string, values: Partial<MedicineSetting> = {}): MedicineSetting => ({
  id: `set-${name}`,
  name,
  className: null,
  maxDailyDose: null,
  doseUnit: null,
  checkRenal: false,
  checkPregnancy: false,
  note: null,
  ...values,
});

const check = (values: Partial<PrescribingCheck> = {}): PrescribingCheck => ({
  encounterId: "e1",
  asOf: "2026-11-20T02:00:00.000Z",
  timeZone: "Asia/Manila",
  patient: { sex: "female", age: 30 },
  medicines: [],
  earlier: [],
  settings: [],
  ...values,
});

const earlier = (
  number: string,
  issuedAt: string,
  genericName: string,
  item: Partial<PrescribingCheck["earlier"][number]["items"][number]> = {},
  status = "active",
) => ({
  id: `rx-${number}`,
  prescriptionNumber: number,
  issuedAt,
  status: status as "active" | "cancelled" | "superseded",
  items: [{ genericName, durationValue: 30, durationUnit: "days" as const, refills: 0, ...item }],
});

describe("reading medicine names and doses", () => {
  it("keeps the words that name a medicine", () => {
    expect(medicineWords("Metformin HCl 500 mg XR tablet")).toEqual(["metformin", "hcl"]);
    expect(medicineWords("Paracetamol 500mg")).toEqual(["paracetamol"]);
    expect(medicineWords("Vitamin B12 0.5 mg")).toEqual(["vitamin", "b12"]);
    expect(medicineWords("Ácido fólico")).toEqual(["acido", "folico"]);
  });

  it("treats a salt or a combination holding a medicine as the same medicine, and nothing else", () => {
    expect(sameMedicine(medicineWords("Losartan potassium"), medicineWords("losartan"))).toBe(true);
    expect(sameMedicine(medicineWords("Losartan + Hydrochlorothiazide"), medicineWords("hydrochlorothiazide"))).toBe(true);
    expect(sameMedicine(medicineWords("Insulin glargine"), medicineWords("Insulin lispro"))).toBe(false);
    expect(sameMedicine(medicineWords("Vitamin C"), medicineWords("Vitamin B complex"))).toBe(false);
    expect(sameMedicine([], medicineWords("losartan"))).toBe(false);
  });

  it("finds the most specific setting for a name", () => {
    const settings = [setting("metformin"), setting("Metformin HCl")];
    expect(settingFor(medicineWords("Metformin HCl 500 mg"), settings)?.name).toBe("Metformin HCl");
    expect(settingFor(medicineWords("Metformin"), settings)?.name).toBe("metformin");
    expect(settingFor(medicineWords("Glimepiride"), settings)).toBeUndefined();
  });

  it("works out a dose from tablets and their strength, a volume of a concentration, or a unit of measure", () => {
    expect(dosePerAdministration({ doseAmount: 2, doseUnit: "tablets", strength: "500 mg" })).toEqual({ amount: 1000, unit: "mg" });
    expect(dosePerAdministration({ doseAmount: 5, doseUnit: "mL", strength: "250 mg/5 mL" })).toEqual({ amount: 250, unit: "mg" });
    expect(dosePerAdministration({ doseAmount: 500, doseUnit: "mg" })).toEqual({ amount: 500, unit: "mg" });
    expect(dosePerAdministration({ doseAmount: 2, doseUnit: "puffs", strength: "100 mcg" })).toEqual({ amount: 200, unit: "mcg" });
    // Two strengths in one tablet, or no strength for a counted dose: not worked out.
    expect(dosePerAdministration({ doseAmount: 1, doseUnit: "tablet", strength: "500 mg/125 mg" })).toBeNull();
    expect(dosePerAdministration({ doseAmount: 1, doseUnit: "tablet" })).toBeNull();
    expect(dosePerAdministration({ doseUnit: "mg" })).toBeNull();
    expect(unitKey("µg")).toBe("mcg");
    expect(unitKey("Capsules")).toBe("capsule");
  });

  it("counts doses a day from the frequency, as needed only when the organization chose a count", () => {
    expect(dailyDose({ genericName: "x", doseAmount: 500, doseUnit: "mg", frequency: "every_6_hours" }, 0)?.daily).toBe(2000);
    expect(dailyDose({ genericName: "x", doseAmount: 70, doseUnit: "mg", frequency: "weekly" }, 0)?.daily).toBeCloseTo(10);
    expect(dailyDose({ genericName: "x", doseAmount: 500, doseUnit: "mg", frequency: "as_needed" }, 0)).toBeNull();
    expect(dailyDose({ genericName: "x", doseAmount: 500, doseUnit: "mg", frequency: "as_needed" }, 4)?.daily).toBe(2000);
    expect(dailyDose({ genericName: "x", doseAmount: 500, doseUnit: "mg", frequency: "custom" }, 4)).toBeNull();
  });
});

describe("prescription.duplicate-therapy", () => {
  const params = DUPLICATE_THERAPY_RULE.defaultParameters;

  it("warns that the medicine is in a current prescription, with the day it ends", () => {
    const s = only(
      duplicateTherapySuggestions(
        check({
          medicines: [{ genericName: "Amlodipine", frequency: "once_daily" }],
          earlier: [earlier("RX00000001", "2026-11-15T02:00:00.000Z", "Amlodipine besilate")],
        }),
        params,
      ),
    );
    expect(s).toMatchObject({
      id: "prescription.duplicate-therapy@1:encounter:e1:medicine:amlodipine",
      surface: "prescribing",
      severity: "warning",
      title: "Amlodipine is already prescribed: RX00000001 (2026-11-15), until 2026-12-15",
      basis: "rule",
    });
    expect(s.evidence).toEqual([
      {
        label: "RX00000001, issued 2026-11-15",
        resourceType: "prescription",
        resourceId: "rx-RX00000001",
        value: "Amlodipine besilate: current until 2026-12-15",
      },
    ]);
    expect(s.action).toBeUndefined();
  });

  it("counts a prescription without a duration as current for the days chosen", () => {
    const medicines = [{ genericName: "Losartan", frequency: "once_daily" }];
    const open = earlier("RX00000002", "2026-10-01T02:00:00.000Z", "Losartan potassium", { durationValue: null, durationUnit: null });
    expect(only(duplicateTherapySuggestions(check({ medicines, earlier: [open] }), params)).title).toBe(
      "Losartan is already prescribed: RX00000002 (2026-10-01), no duration given",
    );
    expect(duplicateTherapySuggestions(check({ medicines, earlier: [open] }), { ...params, openEndedDays: 30, recentDays: 0 })).toEqual([]);
  });

  it("mentions a recent course that ended as advice, and nothing once it is older than the days chosen", () => {
    const medicines = [{ genericName: "Amoxicillin", frequency: "three_times_daily" }];
    const ended = earlier("RX00000003", "2026-11-10T02:00:00.000Z", "Amoxicillin trihydrate", { durationValue: 5 });
    const s = only(duplicateTherapySuggestions(check({ medicines, earlier: [ended] }), params));
    expect(s).toMatchObject({ severity: "advice", title: "Amoxicillin was prescribed 10 days ago: RX00000003 (2026-11-10), course ended" });
    expect(duplicateTherapySuggestions(check({ medicines, earlier: [ended] }), { ...params, recentDays: 7 })).toEqual([]);
  });

  it("finds two medicines of one class the organization defined, and a medicine written twice", () => {
    const settings = [setting("ibuprofen", { className: "NSAID" }), setting("naproxen", { className: "nsaid" })];
    const current = earlier("RX00000004", "2026-11-18T02:00:00.000Z", "Ibuprofen");
    const s = only(
      duplicateTherapySuggestions(check({ settings, medicines: [{ genericName: "Naproxen", frequency: "twice_daily" }], earlier: [current] }), params),
    );
    expect(s.title).toBe("Naproxen and Ibuprofen are both nsaid (your organization's class): RX00000004 (2026-11-18)");
    const twice = duplicateTherapySuggestions(
      check({
        medicines: [
          { genericName: "Paracetamol", frequency: "every_6_hours" },
          { genericName: "Paracetamol 500mg", frequency: "as_needed" },
        ],
      }),
      params,
    );
    expect(only(twice)).toMatchObject({ severity: "warning", title: "Paracetamol 500mg is written twice in this prescription" });
  });

  it("ignores cancelled and superseded prescriptions", () => {
    const medicines = [{ genericName: "Amlodipine", frequency: "once_daily" }];
    const cancelled = earlier("RX00000005", "2026-11-15T02:00:00.000Z", "Amlodipine", {}, "cancelled");
    const superseded = earlier("RX00000006", "2026-11-16T02:00:00.000Z", "Amlodipine", {}, "superseded");
    expect(duplicateTherapySuggestions(check({ medicines, earlier: [cancelled, superseded] }), params)).toEqual([]);
  });
});

describe("prescription.dose-limit", () => {
  const params = DOSE_LIMIT_RULE.defaultParameters;
  const settings = [setting("paracetamol", { maxDailyDose: 4000, doseUnit: "mg", note: "Lower for liver disease" })];

  it("warns when the daily dose is above the organization's maximum in the same unit", () => {
    const s = only(
      doseLimitSuggestions(
        check({ settings, medicines: [{ genericName: "Paracetamol", strength: "500 mg", doseAmount: 2, doseUnit: "tablets", frequency: "every_4_hours" }] }),
        params,
      ),
    );
    expect(s).toMatchObject({ severity: "warning", title: "Paracetamol: 6,000 mg a day, above your organization's maximum of 4,000 mg" });
    expect(s.rationale).toContain("1,000 mg every 4 hours is 6,000 mg a day");
    expect(s.rationale).toContain("Its note: “Lower for liver disease”");
    expect(s.evidence.map((e) => e.value)).toEqual(["2 tablets of 500 mg, every 4 hours", "6,000 mg", "4,000 mg a day"]);
  });

  it("says nothing at the maximum, in another unit, or for a medicine taken as needed unless a count is chosen", () => {
    const at = { genericName: "Paracetamol", strength: "500 mg", doseAmount: 2, doseUnit: "tablets", frequency: "four_times_daily" };
    expect(doseLimitSuggestions(check({ settings, medicines: [at] }), params)).toEqual([]);
    expect(doseLimitSuggestions(check({ settings: [setting("paracetamol", { maxDailyDose: 4, doseUnit: "g" })], medicines: [at] }), params)).toEqual([]);
    const asNeeded = { genericName: "Paracetamol", doseAmount: 1000, doseUnit: "mg", frequency: "as_needed" };
    expect(doseLimitSuggestions(check({ settings, medicines: [asNeeded] }), params)).toEqual([]);
    expect(only(doseLimitSuggestions(check({ settings, medicines: [asNeeded] }), { asNeededDosesPerDay: 6 })).rationale).toContain(
      "1,000 mg as needed, counted 6 times a day as your organization chose, is 6,000 mg a day",
    );
  });
});

describe("prescription.check-prompts", () => {
  const params = CHECK_PROMPTS_RULE.defaultParameters;
  const settings = [
    setting("metformin", { checkRenal: true, note: "Look at the last eGFR" }),
    setting("isotretinoin", { checkPregnancy: true }),
    setting("methotrexate", { checkRenal: true, checkPregnancy: true }),
  ];

  it("asks for the checks the organization marked, with its note", () => {
    const s = only(checkPromptSuggestions(check({ settings, medicines: [{ genericName: "Metformin", frequency: "twice_daily" }] }), params));
    expect(s).toMatchObject({ severity: "advice", title: "Metformin: check kidney function before prescribing" });
    expect(s.rationale).toBe(
      "Your organization marked metformin for this check. Its note: “Look at the last eGFR” Record what you found in the consultation note.",
    );
    const both = only(checkPromptSuggestions(check({ settings, medicines: [{ genericName: "Methotrexate", frequency: "weekly" }] }), params));
    expect(both.title).toBe("Methotrexate: check kidney function and whether the patient may be pregnant before prescribing");
  });

  it("asks about pregnancy only for female patients in the ages chosen, or when sex or age is not recorded", () => {
    const medicines = [{ genericName: "Isotretinoin", frequency: "once_daily" }];
    expect(checkPromptSuggestions(check({ settings, medicines }), params)).toHaveLength(1);
    expect(checkPromptSuggestions(check({ settings, medicines, patient: { sex: "male", age: 30 } }), params)).toEqual([]);
    expect(checkPromptSuggestions(check({ settings, medicines, patient: { sex: "female", age: 60 } }), params)).toEqual([]);
    expect(pregnancyCheckApplies({ sex: "unknown", age: 30 }, params)).toBe(true);
    expect(pregnancyCheckApplies({ sex: "female", age: null }, params)).toBe(true);
    expect(checkPromptsParameters.safeParse({ pregnancyFromAge: 20, pregnancyToAge: 35 }).success).toBe(true);
  });
});
