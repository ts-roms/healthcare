import { ADULT_VITAL_BANDS, interpretVital, type VitalBandKey, type VitalInterpretation } from "@healthcare/domain";
import { bmi, type VitalsPayload } from "./triage-form";

/**
 * What the triage screen says about the readings the nurse has typed. The adult bands (`@healthcare/domain` `vital-bands`) are
 * guidance beside the number, never a diagnosis: nothing here changes the priority or blocks a save, and the nurse decides.
 */

/** The readings a hint or a flag is about; blood pressure is one reading made of two fields. */
export type ReadingKey = "bp" | "heartRate" | "respiratoryRate" | "temperatureC" | "spo2";

export interface Reading {
  key: ReadingKey;
  label: string;
  /** The value as written on the form, with its unit. */
  text: string;
  interpretation: VitalInterpretation;
  /** The band as people read it: "60–100", "≥95". */
  range: string;
}

function rangeText(key: VitalBandKey): string {
  const { low, high } = ADULT_VITAL_BANDS[key];
  // Oxygen saturation has no upper concern; read it as a minimum.
  return key === "spo2" ? `≥${low}` : `${low}–${high}`;
}

const BP_RANGE = `${rangeText("systolic")} / ${rangeText("diastolic")}`;

/** Blood pressure reads by its systolic number unless that is within the band, then by the diastolic. */
function bpInterpretation(values: VitalsPayload): VitalInterpretation {
  const s = interpretVital("systolic", values.systolicMmhg);
  return s !== "normal" ? s : interpretVital("diastolic", values.diastolicMmhg);
}

/** The readings that were entered, in the order the form shows them, each placed against the adult band. */
export function readings(values: VitalsPayload): Reading[] {
  const out: Reading[] = [];
  if (values.systolicMmhg !== undefined && values.diastolicMmhg !== undefined) {
    out.push({
      key: "bp",
      label: "Blood pressure",
      text: `${values.systolicMmhg}/${values.diastolicMmhg} mmHg`,
      interpretation: bpInterpretation(values),
      range: BP_RANGE,
    });
  }
  const simple: Array<[Exclude<ReadingKey, "bp">, string, number | undefined, VitalBandKey, string]> = [
    ["heartRate", "Heart rate", values.heartRateBpm, "heartRate", "/min"],
    ["respiratoryRate", "Respiratory rate", values.respiratoryRateBpm, "respiratoryRate", "/min"],
    ["temperatureC", "Temperature", values.temperatureC, "temperatureC", "°C"],
    ["spo2", "SpO₂", values.spo2Percent, "spo2", "%"],
  ];
  for (const [key, label, value, band, unit] of simple) {
    if (value === undefined) continue;
    out.push({ key, label, text: `${value} ${unit}`, interpretation: interpretVital(band, value), range: rangeText(band) });
  }
  return out;
}

/** The entered readings outside the band: what the "From these vitals" card lists. */
export function outOfRange(values: VitalsPayload): Reading[] {
  return readings(values).filter((r) => r.interpretation !== "normal");
}

export interface VitalHint {
  text: string;
  flagged: boolean;
}

const WORD: Record<VitalInterpretation, string> = { normal: "Normal", low: "Low", high: "High" };

export type HintKey = ReadingKey | "bmi" | "glucose";

/** The line under each field: where the reading sits, or what the band is while it is blank. Absent where there is no band. */
export function vitalHints(values: VitalsPayload): Partial<Record<HintKey, VitalHint>> {
  const hints: Partial<Record<HintKey, VitalHint>> = {};
  const rangeOf: Record<ReadingKey, string> = {
    bp: BP_RANGE,
    heartRate: rangeText("heartRate"),
    respiratoryRate: rangeText("respiratoryRate"),
    temperatureC: rangeText("temperatureC"),
    spo2: rangeText("spo2"),
  };
  const entered = new Map(readings(values).map((r) => [r.key, r]));
  for (const key of Object.keys(rangeOf) as ReadingKey[]) {
    const reading = entered.get(key);
    const flagged = !!reading && reading.interpretation !== "normal";
    hints[key] = { text: flagged ? `${WORD[reading.interpretation]} · normal ${rangeOf[key]}` : `Normal ${rangeOf[key]}`, flagged };
  }
  const index = bmi(values.weightKg, values.heightCm);
  if (index !== null) hints.bmi = { text: `BMI ${index} · ${WORD[interpretVital("bmi", index)].toLowerCase()}`, flagged: false };
  hints.glucose = { text: values.bloodGlucoseMgDl === undefined ? "Not measured" : "", flagged: false };
  return hints;
}

/** Complaints offered as one-tap starting words; wording only, nothing is coded or decided from them. */
export const COMMON_COMPLAINTS = ["Fever", "Cough / colds", "Headache", "Abdominal pain", "High blood pressure", "Follow-up"] as const;

/** Adds a complaint to what is already written, or starts the text with it; adding the same one again changes nothing. */
export function addComplaint(current: string, complaint: string): string {
  const trimmed = current.trim();
  if (!trimmed) return complaint;
  if (trimmed.toLowerCase().includes(complaint.toLowerCase())) return current;
  return `${trimmed.replace(/[,.;\s]+$/, "")}, ${complaint.toLowerCase()}`;
}

/** Flags offered as one-tap choices; any other flag is typed under "Other". */
export const RISK_FLAG_PRESETS = ["Fall risk", "Pregnant", "Infectious symptoms", "Senior (60+)", "PWD", "Needs interpreter", "Wheelchair"] as const;

/** Turns a flag on or off in the list (case-insensitive match, kept as first written). */
export function toggleFlag(flags: readonly string[], flag: string): string[] {
  const has = flags.some((f) => f.toLowerCase() === flag.toLowerCase());
  return has ? flags.filter((f) => f.toLowerCase() !== flag.toLowerCase()) : [...flags, flag];
}

/** Whole minutes since the patient checked in, never negative. */
export function minutesSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60000));
}
