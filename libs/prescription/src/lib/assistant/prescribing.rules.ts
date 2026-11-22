import { localDate, type RuleDefinition, type Suggestion, type SuggestionEvidence, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * The assistant's prescribing rules (docs/domains/assistant.md), checked in the prescribing dialog before a prescription
 * is issued, against the patient's earlier prescriptions and the organization's own medicine settings
 * (`prescribing_medicine`). Clinical decision support (CLAUDE.md §35): labelled, showing what was compared, never
 * blocking and never changing a prescription; off until an administrator turns a rule on, after the organization's
 * clinicians validated it. Medicines are compared by the words of their names, like the allergy check: a different salt,
 * spelling or combination may not match, so no suggestion is not evidence that there is no duplicate or no limit.
 */

const DAY_MS = 86_400_000;

// ---- reading medicine names ------------------------------------------------------------------------------------------

/** Words that say how a medicine is made or measured, not what it is. */
const IGNORED_WORDS = new Set([
  "mg",
  "mcg",
  "ug",
  "g",
  "kg",
  "ml",
  "l",
  "iu",
  "unit",
  "units",
  "tab",
  "tabs",
  "tablet",
  "tablets",
  "cap",
  "caps",
  "capsule",
  "capsules",
  "syrup",
  "suspension",
  "susp",
  "drops",
  "drop",
  "cream",
  "ointment",
  "gel",
  "lotion",
  "injection",
  "inj",
  "solution",
  "soln",
  "sol",
  "er",
  "sr",
  "xr",
  "xl",
  "mr",
  "cr",
  "dr",
  "od",
  "film",
  "coated",
  "chewable",
  "dispersible",
  "effervescent",
  "powder",
  "sachet",
  "sachets",
  "vial",
  "ampule",
  "ampoule",
  "amp",
  "for",
  "of",
  "and",
  "with",
  "the",
]);

/**
 * The words that name a medicine: lower case, without accents, strengths ("500", "500mg", "0.5") and dosage forms
 * ("tablet", "syrup", "XR"). "Metformin HCl 500 mg XR tablet" → metformin, hcl.
 */
export function medicineWords(name: string): string[] {
  const words = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !/^\d+[a-z]*$/.test(w) && !IGNORED_WORDS.has(w));
  return [...new Set(words)];
}

/** One name's words all appear in the other's: "losartan" and "losartan potassium", or a combination holding a medicine. */
export function sameMedicine(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  return small.every((w) => large.includes(w));
}

export interface MedicineSetting {
  id: string;
  name: string;
  className: string | null;
  maxDailyDose: number | null;
  doseUnit: string | null;
  checkRenal: boolean;
  checkPregnancy: boolean;
  note: string | null;
}

/** The organization's setting for a prescribed name: the most specific one whose words all appear in it. */
export function settingFor<S extends Pick<MedicineSetting, "name">>(words: readonly string[], settings: readonly S[]): S | undefined {
  let best: { setting: S; size: number } | undefined;
  for (const setting of settings) {
    const own = medicineWords(setting.name);
    if (own.length === 0 || !own.every((w) => words.includes(w))) continue;
    if (!best || own.length > best.size) best = { setting, size: own.length };
  }
  return best?.setting;
}

// ---- doses -----------------------------------------------------------------------------------------------------------

/** Administrations a day for each prescription frequency; as needed and custom ones are not known. */
export const DOSES_PER_DAY: Record<string, number | null> = {
  once: 1,
  once_daily: 1,
  twice_daily: 2,
  three_times_daily: 3,
  four_times_daily: 4,
  every_4_hours: 6,
  every_6_hours: 4,
  every_8_hours: 3,
  every_12_hours: 2,
  at_bedtime: 1,
  weekly: 1 / 7,
  as_needed: null,
  custom: null,
};

const FREQUENCY_WORDS: Record<string, string> = {
  once: "once",
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  four_times_daily: "four times a day",
  every_4_hours: "every 4 hours",
  every_6_hours: "every 6 hours",
  every_8_hours: "every 8 hours",
  every_12_hours: "every 12 hours",
  at_bedtime: "at bedtime",
  weekly: "once a week",
  as_needed: "as needed",
  custom: "as described",
};

/** Units a dose is counted in ("2 tablets"): the strength says how much each holds. */
const COUNT_UNITS = new Set(["tablet", "tab", "capsule", "cap", "sachet", "puff", "drop", "suppository", "patch", "lozenge", "piece", "pc"]);

/** A unit as compared: lower case, "µg"/"ug" as "mcg", counted units in the singular ("tablets" → "tablet"). */
export function unitKey(unit: string): string {
  const u = unit
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^µg$|^ug$/, "mcg");
  return u.length > 2 && u.endsWith("s") && COUNT_UNITS.has(u.slice(0, -1)) ? u.slice(0, -1) : u;
}

const SIMPLE_STRENGTH = /^(\d+(?:\.\d+)?)\s*([a-zµ]+)$/i;
const CONCENTRATION = /^(\d+(?:\.\d+)?)\s*([a-zµ]+)\s*\/\s*(\d+(?:\.\d+)?)?\s*([a-z]+)$/i;

/**
 * How much one administration holds: a dose in a unit of measure as written ("500 mg"); a counted dose times its strength
 * ("2 tablets" of "500 mg" → 1000 mg); a volume of a concentration ("5 mL" of "250 mg/5 mL" → 250 mg). Null when the
 * strength cannot be read for a counted dose, or no dose is given.
 */
export function dosePerAdministration(item: { strength?: string | null; doseAmount?: number | null; doseUnit?: string | null }): {
  amount: number;
  unit: string;
} | null {
  if (item.doseAmount === null || item.doseAmount === undefined || !item.doseUnit) return null;
  const doseUnit = unitKey(item.doseUnit);
  const strength = (item.strength ?? "").trim().replace(/,/g, "");
  const concentration = CONCENTRATION.exec(strength);
  if (concentration && unitKey(concentration[4] ?? "") === doseUnit) {
    return { amount: (item.doseAmount * Number(concentration[1])) / Number(concentration[3] ?? 1), unit: unitKey(concentration[2] ?? "") };
  }
  const simple = SIMPLE_STRENGTH.exec(strength);
  if (COUNT_UNITS.has(doseUnit)) return simple ? { amount: item.doseAmount * Number(simple[1]), unit: unitKey(simple[2] ?? "") } : null;
  return { amount: item.doseAmount, unit: doseUnit };
}

const number = (n: number): string => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(n);

// ---- what the rules read ---------------------------------------------------------------------------------------------

/** A medicine as written in the prescription being drafted. */
export interface DraftMedicine {
  genericName: string;
  brandName?: string | null;
  strength?: string | null;
  doseAmount?: number | null;
  doseUnit?: string | null;
  frequency: string;
}

export interface EarlierPrescription {
  id: string;
  prescriptionNumber: string;
  /** ISO instant. */
  issuedAt: string;
  /** Its status at the moment read. */
  status: "active" | "cancelled" | "superseded";
  items: Array<{ genericName: string; durationValue: number | null; durationUnit: "days" | "weeks" | "months" | null; refills: number }>;
}

export interface PrescribingCheck {
  /** The consultation the prescription is written in. */
  encounterId: string;
  /** ISO instant the check reads at: now, or a prescription's issue time in a replay. */
  asOf: string;
  /** The facility's time zone, for the days in the wording. */
  timeZone: string;
  patient: { sex: string | null; age: number | null };
  medicines: DraftMedicine[];
  /** The patient's prescriptions issued before `asOf` (linked records included), without the one being replaced. */
  earlier: EarlierPrescription[];
  /** The organization's active medicine settings. */
  settings: MedicineSetting[];
}

const DURATION_DAYS = { days: 1, weeks: 7, months: 30 } as const;

/** When an earlier prescription's course ends: its duration times one plus its refills, else after `openEndedDays`. */
export function courseEnds(issuedAt: string, item: EarlierPrescription["items"][number], openEndedDays: number): Date {
  const days = item.durationValue && item.durationUnit ? item.durationValue * DURATION_DAYS[item.durationUnit] * (1 + item.refills) : openEndedDays;
  return new Date(Date.parse(issuedAt) + days * DAY_MS);
}

const sameClass = (a: string | null | undefined, b: string | null | undefined): boolean => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

const REQUIRES = ["prescription.read", "prescription.issue"] as const;

// ---- prescription.duplicate-therapy ----------------------------------------------------------------------------------

export const duplicateTherapyParameters = z.object({
  /** The same medicine prescribed in this many days is mentioned even when its course ended (0: never). */
  recentDays: z.number().int().min(0).max(90),
  /** A prescription without a duration counts as current for this many days. */
  openEndedDays: z.number().int().min(7).max(3650),
});
export type DuplicateTherapyParameters = z.infer<typeof duplicateTherapyParameters>;

export const DUPLICATE_THERAPY_RULE: RuleDefinition<DuplicateTherapyParameters> = {
  id: "prescription.duplicate-therapy",
  version: 1,
  domain: "prescription",
  title: "The same medicine or class is already prescribed",
  description:
    "Before a prescription is issued: a medicine already in a current prescription of the patient (by name, or by a class your organization gave its medicines), written twice, or prescribed in the last days. It may be intended; it blocks nothing.",
  surfaces: ["prescribing"],
  requires: [...REQUIRES],
  parametersSchema: duplicateTherapyParameters,
  defaultParameters: { recentDays: 14, openEndedDays: 90 },
  parameterLabels: {
    recentDays: { label: "Also mention the same medicine prescribed in the last", unit: "days, even if its course ended (0: never)", min: 0, max: 90 },
    openEndedDays: {
      label: "A prescription without a duration counts as current for",
      unit: "days",
      min: 7,
      max: 3650,
      hint: "With a duration, a course lasts its duration times one plus its refills.",
    },
  },
  reads:
    "The medicines being prescribed (their names), the patient's earlier prescriptions here (names, status, issue dates, durations and refills, records linked to theirs included) and the classes your organization gave its medicines. Never notes, instructions or the allergy override.",
  knownFalsePositives: [
    "An earlier course stopped early still counts as current: for its duration times one plus its refills, or for the days you set when it has none.",
    "A dose change written as a new prescription instead of replacing the earlier one.",
    "Medicines of the same class combined on purpose.",
  ],
  blindSpots: [
    "A different salt, spelling or brand-only name may not match (metoprolol tartrate and metoprolol succinate).",
    "Medicines from other prescribers, bought over the counter, or recorded in the patient's history as taken.",
  ],
};

type DuplicateKind = "draft-same" | "current-same" | "draft-class" | "current-class" | "recent-same";
const KIND_ORDER: DuplicateKind[] = ["draft-same", "current-same", "draft-class", "current-class", "recent-same"];

export function duplicateTherapySuggestions(check: PrescribingCheck, params: DuplicateTherapyParameters): Suggestion[] {
  const asOf = Date.parse(check.asOf);
  const day = (iso: string) => localDate(new Date(iso), check.timeZone);
  const drafted = check.medicines.map((m) => {
    const words = medicineWords(m.genericName);
    return { name: m.genericName.trim(), words, className: settingFor(words, check.settings)?.className ?? null };
  });
  const out: Suggestion[] = [];
  drafted.forEach((medicine, index) => {
    if (medicine.words.length === 0) return;
    const findings: Array<{ kind: DuplicateKind; text: string; evidence: SuggestionEvidence }> = [];
    drafted.slice(0, index).forEach((other, j) => {
      const same = sameMedicine(medicine.words, other.words);
      if (!same && !sameClass(medicine.className, other.className)) return;
      findings.push({
        kind: same ? "draft-same" : "draft-class",
        text: same
          ? `${medicine.name} is written twice in this prescription`
          : `${medicine.name} and ${other.name} are both ${medicine.className} (your organization's class)`,
        evidence: { label: `Medicine ${j + 1} of this prescription`, resourceType: "prescription_draft", resourceId: `medicine:${j + 1}`, value: other.name },
      });
    });
    for (const earlier of check.earlier) {
      if (earlier.status === "cancelled" || earlier.status === "superseded") continue;
      for (const item of earlier.items) {
        const words = medicineWords(item.genericName);
        const same = sameMedicine(medicine.words, words);
        const ends = courseEnds(earlier.issuedAt, item, params.openEndedDays);
        const current = ends.getTime() >= asOf;
        const daysAgo = Math.floor((asOf - Date.parse(earlier.issuedAt)) / DAY_MS);
        const otherClass = settingFor(words, check.settings)?.className ?? null;
        const where = `${earlier.prescriptionNumber} (${day(earlier.issuedAt)})`;
        const evidence = (value: string): SuggestionEvidence => ({
          label: `${earlier.prescriptionNumber}, issued ${day(earlier.issuedAt)}`,
          resourceType: "prescription",
          resourceId: earlier.id,
          value,
        });
        const open = !(item.durationValue && item.durationUnit);
        if (current && same) {
          findings.push({
            kind: "current-same",
            text: `${medicine.name} is already prescribed: ${where}${open ? ", no duration given" : `, until ${day(ends.toISOString())}`}`,
            evidence: evidence(`${item.genericName}: current${open ? "" : ` until ${day(ends.toISOString())}`}`),
          });
        } else if (current && sameClass(medicine.className, otherClass)) {
          findings.push({
            kind: "current-class",
            text: `${medicine.name} and ${item.genericName} are both ${medicine.className} (your organization's class): ${where}`,
            evidence: evidence(`${item.genericName}: current, ${medicine.className}`),
          });
        } else if (same && !current && params.recentDays > 0 && daysAgo <= params.recentDays) {
          findings.push({
            kind: "recent-same",
            text: `${medicine.name} was prescribed ${daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`}: ${where}, course ended`,
            evidence: evidence(`${item.genericName}: course ended ${day(ends.toISOString())}`),
          });
        }
      }
    }
    if (findings.length === 0) return;
    findings.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const warning = findings.some((f) => f.kind !== "recent-same");
    out.push({
      id: suggestionId(DUPLICATE_THERAPY_RULE.id, DUPLICATE_THERAPY_RULE.version, `encounter:${check.encounterId}:medicine:${medicine.words.join("-")}`),
      ruleId: DUPLICATE_THERAPY_RULE.id,
      ruleVersion: DUPLICATE_THERAPY_RULE.version,
      surface: "prescribing",
      severity: warning ? "warning" : "advice",
      title: findings[0]?.text ?? medicine.name,
      rationale:
        (findings.length > 1
          ? `Also: ${findings
              .slice(1)
              .map((f) => f.text)
              .join("; ")}. `
          : "") +
        "It may be intended (a dose change, a second course, a planned combination); if not, change this prescription, or replace or cancel the earlier one. " +
        "Medicines are compared by the words of their names and the classes your organization gave them: a different salt, spelling or combination may not match.",
      evidence: findings.map((f) => f.evidence),
      basis: "rule",
      strength: "matched",
      requires: [...DUPLICATE_THERAPY_RULE.requires],
    });
  });
  return out;
}

// ---- prescription.dose-limit -----------------------------------------------------------------------------------------

export const doseLimitParameters = z.object({
  /** Administrations a day assumed for a medicine taken as needed (0: those are not checked). */
  asNeededDosesPerDay: z.number().int().min(0).max(24),
});
export type DoseLimitParameters = z.infer<typeof doseLimitParameters>;

export const DOSE_LIMIT_RULE: RuleDefinition<DoseLimitParameters> = {
  id: "prescription.dose-limit",
  version: 1,
  domain: "prescription",
  title: "Above your organization's maximum daily dose",
  description:
    "Before a prescription is issued: a medicine whose daily dose, worked out from the dose, its strength and the frequency, is above the maximum your organization set for it in the same unit. Doses in another unit, by body weight or with a custom frequency are not checked.",
  surfaces: ["prescribing"],
  requires: [...REQUIRES],
  parametersSchema: doseLimitParameters,
  defaultParameters: { asNeededDosesPerDay: 0 },
  parameterLabels: {
    asNeededDosesPerDay: {
      label: "For medicines taken as needed, count at most",
      unit: "doses a day (0: do not check them)",
      min: 0,
      max: 24,
    },
  },
  reads:
    "The medicines being prescribed (dose, strength and frequency) and the maximum daily dose and unit your organization set for each medicine that has one.",
  knownFalsePositives: [
    "A loading dose or a short high-dose course the prescriber intends.",
    "One maximum per medicine: a dose right for another indication or age is still above it.",
    "Frequencies count in full: every 4 hours is six doses a day, even if fewer are taken at night.",
  ],
  blindSpots: [
    "Doses in another unit (no conversion), by body weight, with a custom frequency, or taken as needed unless you chose a count.",
    "Doses are not added across medicines: two products with the same ingredient are each compared on their own.",
    "Kidney function, age, weight and the patient's other medicines are not read.",
  ],
};

/** The daily dose of a drafted medicine, or null when it cannot be worked out. */
export function dailyDose(medicine: DraftMedicine, asNeededDosesPerDay: number): { perDose: number; daily: number; unit: string; perDay: number } | null {
  const perDose = dosePerAdministration(medicine);
  const perDay = medicine.frequency === "as_needed" ? (asNeededDosesPerDay > 0 ? asNeededDosesPerDay : null) : (DOSES_PER_DAY[medicine.frequency] ?? null);
  if (!perDose || perDay === null) return null;
  return { perDose: perDose.amount, daily: perDose.amount * perDay, unit: perDose.unit, perDay };
}

export function doseLimitSuggestions(check: PrescribingCheck, params: DoseLimitParameters): Suggestion[] {
  const out: Suggestion[] = [];
  for (const medicine of check.medicines) {
    const words = medicineWords(medicine.genericName);
    const setting = settingFor(words, check.settings);
    if (!setting?.maxDailyDose || !setting.doseUnit) continue;
    const dose = dailyDose(medicine, params.asNeededDosesPerDay);
    const unit = unitKey(setting.doseUnit);
    if (!dose || dose.unit !== unit || dose.daily <= setting.maxDailyDose * (1 + 1e-9)) continue;
    const name = medicine.genericName.trim();
    const how =
      medicine.frequency === "as_needed"
        ? `${number(dose.perDose)} ${unit} as needed, counted ${dose.perDay} times a day as your organization chose,`
        : `${number(dose.perDose)} ${unit} ${FREQUENCY_WORDS[medicine.frequency] ?? medicine.frequency}`;
    out.push({
      id: suggestionId(DOSE_LIMIT_RULE.id, DOSE_LIMIT_RULE.version, `encounter:${check.encounterId}:dose:${words.join("-")}`),
      ruleId: DOSE_LIMIT_RULE.id,
      ruleVersion: DOSE_LIMIT_RULE.version,
      surface: "prescribing",
      severity: "warning",
      title: `${name}: ${number(dose.daily)} ${unit} a day, above your organization's maximum of ${number(setting.maxDailyDose)} ${unit}`,
      rationale:
        `${how} is ${number(dose.daily)} ${unit} a day. The maximum is your organization's own setting for ${setting.name}; ` +
        "check the dose, the frequency and the patient before issuing." +
        (setting.note ? ` Its note: “${setting.note}”` : ""),
      evidence: [
        {
          label: "Dose",
          resourceType: "prescription_draft",
          resourceId: name,
          value: `${number(medicine.doseAmount ?? 0)} ${medicine.doseUnit ?? ""}${medicine.strength ? ` of ${medicine.strength}` : ""}, ${FREQUENCY_WORDS[medicine.frequency] ?? medicine.frequency}`,
        },
        { label: "Daily dose", resourceType: "prescription_draft", resourceId: name, value: `${number(dose.daily)} ${unit}` },
        {
          label: "Your organization's maximum",
          resourceType: "prescribing_medicine",
          resourceId: setting.id,
          value: `${number(setting.maxDailyDose)} ${unit} a day`,
        },
      ],
      basis: "rule",
      strength: "matched",
      requires: [...DOSE_LIMIT_RULE.requires],
    });
  }
  return out;
}

// ---- prescription.check-prompts --------------------------------------------------------------------------------------

export const checkPromptsParameters = z
  .object({
    /** Ages between which the pregnancy check is asked for female patients. */
    pregnancyFromAge: z.number().int().min(8).max(20),
    pregnancyToAge: z.number().int().min(35).max(60),
  })
  .refine((p) => p.pregnancyToAge > p.pregnancyFromAge, { path: ["pregnancyToAge"], message: "The upper age must be above the lower one" });
export type CheckPromptsParameters = z.infer<typeof checkPromptsParameters>;

export const CHECK_PROMPTS_RULE: RuleDefinition<CheckPromptsParameters> = {
  id: "prescription.check-prompts",
  version: 1,
  domain: "prescription",
  title: "Checks your organization asks for before prescribing",
  description:
    "Before a prescription is issued: a reminder to check kidney function, or whether the patient may be pregnant, for the medicines your organization marked, with its own note. The pregnancy check is shown for female patients in the ages you set and for patients whose sex is not recorded as male.",
  surfaces: ["prescribing"],
  requires: [...REQUIRES],
  parametersSchema: checkPromptsParameters,
  defaultParameters: { pregnancyFromAge: 12, pregnancyToAge: 50 },
  parameterLabels: {
    pregnancyFromAge: { label: "Ask about pregnancy from age", unit: "years", min: 8, max: 20 },
    pregnancyToAge: { label: "…up to age", unit: "years", min: 35, max: 60 },
  },
  reads: "The medicines being prescribed, the checks and note your organization set for them and, for the pregnancy check, the patient's recorded sex and age.",
  knownFalsePositives: [
    "A check already done: nothing reads results or records that the check was done.",
    "The pregnancy prompt shows for patients whose sex is not recorded, and for every female patient in the ages you set, whatever her history.",
  ],
  blindSpots: [
    "Medicines your organization has not marked, or written without all the words of the setting's name.",
    "Kidney results and pregnancy status are never read.",
  ],
};

/** Whether the pregnancy check applies: never for a male patient; for a female one within the ages; otherwise yes. */
export function pregnancyCheckApplies(patient: PrescribingCheck["patient"], params: CheckPromptsParameters): boolean {
  if (patient.sex === "male") return false;
  if (patient.sex !== "female" || patient.age === null) return true;
  return patient.age >= params.pregnancyFromAge && patient.age <= params.pregnancyToAge;
}

export function checkPromptSuggestions(check: PrescribingCheck, params: CheckPromptsParameters): Suggestion[] {
  const out: Suggestion[] = [];
  const pregnancy = pregnancyCheckApplies(check.patient, params);
  for (const medicine of check.medicines) {
    const words = medicineWords(medicine.genericName);
    const setting = settingFor(words, check.settings);
    if (!setting) continue;
    const checks = [
      ...(setting.checkRenal ? ["kidney function"] : []),
      ...(setting.checkPregnancy && pregnancy ? ["whether the patient may be pregnant"] : []),
    ];
    if (checks.length === 0) continue;
    const name = medicine.genericName.trim();
    out.push({
      id: suggestionId(CHECK_PROMPTS_RULE.id, CHECK_PROMPTS_RULE.version, `encounter:${check.encounterId}:checks:${words.join("-")}`),
      ruleId: CHECK_PROMPTS_RULE.id,
      ruleVersion: CHECK_PROMPTS_RULE.version,
      surface: "prescribing",
      severity: "advice",
      title: `${name}: check ${checks.join(" and ")} before prescribing`,
      rationale:
        `Your organization marked ${setting.name} for ${checks.length === 2 ? "these checks" : "this check"}.` +
        (setting.note ? ` Its note: “${setting.note}”` : "") +
        " Record what you found in the consultation note.",
      evidence: [
        { label: "Marked by your organization", resourceType: "prescribing_medicine", resourceId: setting.id, value: setting.name },
        ...(setting.checkPregnancy && pregnancy
          ? [
              {
                label: "Patient",
                resourceType: "patient",
                resourceId: "sex-age",
                value: `${check.patient.sex ?? "sex not recorded"}${check.patient.age === null ? "" : `, ${check.patient.age} years`}`,
              },
            ]
          : []),
      ],
      basis: "rule",
      strength: "matched",
      requires: [...CHECK_PROMPTS_RULE.requires],
    });
  }
  return out;
}
