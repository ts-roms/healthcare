import { z } from "zod";

/**
 * Triage form ↔ API mapping. Vital-sign limits mirror `libs/clinic`
 * (`domain/vital-signs.ts`): they are data-entry guards against impossible
 * values, not clinical reference ranges. The API re-checks every value and is
 * authoritative; this only lets the nurse fix a typo before submitting.
 */
export const VITAL_FIELDS = {
  systolicMmhg: { label: "Systolic", min: 40, max: 300, unit: "mmHg", integer: true },
  diastolicMmhg: { label: "Diastolic", min: 20, max: 200, unit: "mmHg", integer: true },
  heartRateBpm: { label: "Heart rate", min: 20, max: 300, unit: "/min", integer: true },
  respiratoryRateBpm: { label: "Respiratory rate", min: 4, max: 80, unit: "/min", integer: true },
  temperatureC: { label: "Temperature", min: 30, max: 45, unit: "°C", integer: false },
  spo2Percent: { label: "SpO₂", min: 50, max: 100, unit: "%", integer: true },
  weightKg: { label: "Weight", min: 0.3, max: 400, unit: "kg", integer: false },
  heightCm: { label: "Height", min: 20, max: 260, unit: "cm", integer: false },
  bloodGlucoseMgDl: { label: "Blood glucose", min: 10, max: 1500, unit: "mg/dL", integer: true },
} as const;

export type VitalField = keyof typeof VITAL_FIELDS;
export type VitalsForm = Record<VitalField, string>;
export type VitalsPayload = Partial<Record<VitalField, number>>;

export const EMPTY_VITALS: VitalsForm = Object.fromEntries(Object.keys(VITAL_FIELDS).map((k) => [k, ""])) as VitalsForm;

/** Parses the entered values. Blank fields are omitted; errors are per field. */
export function parseVitals(form: VitalsForm): { values: VitalsPayload; errors: Partial<Record<VitalField, string>> } {
  const values: VitalsPayload = {};
  const errors: Partial<Record<VitalField, string>> = {};
  for (const [field, spec] of Object.entries(VITAL_FIELDS) as Array<[VitalField, (typeof VITAL_FIELDS)[VitalField]]>) {
    const raw = form[field].trim().replace(",", ".");
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) errors[field] = "Enter a number";
    else if (spec.integer && !Number.isInteger(value)) errors[field] = "Enter a whole number";
    else if (value < spec.min || value > spec.max) errors[field] = `Outside ${spec.min}–${spec.max} ${spec.unit}; check the entry`;
    else values[field] = value;
  }
  const hasSys = form.systolicMmhg.trim() !== "";
  const hasDia = form.diastolicMmhg.trim() !== "";
  if (hasSys !== hasDia) errors[hasSys ? "diastolicMmhg" : "systolicMmhg"] ??= "Record both systolic and diastolic pressure";
  else if (values.systolicMmhg !== undefined && values.diastolicMmhg !== undefined && values.systolicMmhg <= values.diastolicMmhg) {
    errors.diastolicMmhg ??= "Must be lower than systolic";
  }
  return { values, errors };
}

/** Body-mass index for display only (kg/m², one decimal), as the API computes it. */
export function bmi(weightKg?: number, heightCm?: number): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/** Risk flags typed as a comma-separated list: trimmed, de-duplicated, at most 20 of 60 characters. */
export function parseRiskFlags(input: string): string[] {
  const flags = input
    .split(",")
    .map((f) => f.trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(flags)].slice(0, 20);
}

export const triageInputSchema = z.object({
  visitId: z.uuid(),
  chiefComplaint: z.string().trim().min(1, "Record the chief complaint").max(500),
  priority: z.enum(["routine", "urgent", "emergency"]),
  painScore: z.number().int().min(0).max(10).optional(),
  riskFlags: z.array(z.string().trim().min(1).max(60)).max(20),
  notes: z.string().trim().max(2000).optional(),
  vitals: z.record(z.string(), z.number()).optional(),
  completeTriage: z.boolean(),
});
export type TriageInput = z.input<typeof triageInputSchema>;

/** Field errors from the API's `implausible_vital_signs` details (`[{ field, message }]`). */
export function vitalErrorsFromApi(details: unknown): Partial<Record<VitalField, string>> {
  const errors: Partial<Record<VitalField, string>> = {};
  if (!Array.isArray(details)) return errors;
  for (const d of details as Array<{ field?: unknown; message?: unknown }>) {
    if (typeof d?.field === "string" && d.field in VITAL_FIELDS && typeof d.message === "string") errors[d.field as VitalField] ??= d.message;
  }
  return errors;
}
