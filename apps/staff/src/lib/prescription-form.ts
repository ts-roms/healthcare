import { z } from "zod";
import type { Prescription, PrescriptionFrequency, PrescriptionLine, PrescriptionRoute } from "./api/types";

/**
 * Prescription form ↔ API mapping. Validation mirrors `libs/prescription`
 * (`prescription.dto.ts`) so errors show on the right field before a round
 * trip; the API validates again and is authoritative. There is no drug
 * catalogue: medicines are entered by generic name.
 */

export const ROUTE_LABEL: Record<PrescriptionRoute, string> = {
  oral: "Oral",
  sublingual: "Sublingual",
  buccal: "Buccal",
  topical: "Topical",
  transdermal: "Transdermal",
  inhalation: "Inhalation",
  nasal: "Nasal",
  ophthalmic: "Eye",
  otic: "Ear",
  rectal: "Rectal",
  vaginal: "Vaginal",
  subcutaneous: "Subcutaneous",
  intramuscular: "Intramuscular",
  intravenous: "Intravenous",
  other: "Other",
};

export const FREQUENCY_LABEL: Record<PrescriptionFrequency, string> = {
  once: "Once",
  once_daily: "Once a day",
  twice_daily: "Twice a day",
  three_times_daily: "3 times a day",
  four_times_daily: "4 times a day",
  every_4_hours: "Every 4 hours",
  every_6_hours: "Every 6 hours",
  every_8_hours: "Every 8 hours",
  every_12_hours: "Every 12 hours",
  at_bedtime: "At bedtime",
  weekly: "Once a week",
  as_needed: "As needed",
  custom: "Other (describe)",
};

/** One medicine line as typed (strings, so partial input is kept). */
export interface LineForm {
  key: string;
  genericName: string;
  brandName: string;
  strength: string;
  dosageForm: string;
  doseAmount: string;
  doseUnit: string;
  route: PrescriptionRoute;
  frequency: PrescriptionFrequency;
  frequencyText: string;
  asNeededReason: string;
  durationValue: string;
  durationUnit: "" | "days" | "weeks" | "months";
  quantity: string;
  quantityUnit: string;
  refills: string;
  instructions: string;
}

export type LineField = Exclude<keyof LineForm, "key">;
export type LineErrors = Partial<Record<LineField, string>>;
export type LinePayload = z.infer<typeof lineSchema>;

let counter = 0;
export function blankLine(): LineForm {
  counter += 1;
  return {
    key: `line-${counter}`,
    genericName: "",
    brandName: "",
    strength: "",
    dosageForm: "",
    doseAmount: "",
    doseUnit: "",
    route: "oral",
    frequency: "three_times_daily",
    frequencyText: "",
    asNeededReason: "",
    durationValue: "",
    durationUnit: "days",
    quantity: "",
    quantityUnit: "",
    refills: "0",
    instructions: "",
  };
}

/** Prefills the form from an issued prescription (for "Replace"). */
export function linesFromPrescription(p: Pick<Prescription, "items">): LineForm[] {
  return p.items.map((i: PrescriptionLine) => ({
    ...blankLine(),
    genericName: i.genericName,
    brandName: i.brandName ?? "",
    strength: i.strength ?? "",
    dosageForm: i.dosageForm ?? "",
    doseAmount: i.doseAmount === null ? "" : String(i.doseAmount),
    doseUnit: i.doseUnit ?? "",
    route: i.route,
    frequency: i.frequency,
    frequencyText: i.frequencyText ?? "",
    asNeededReason: i.asNeededReason ?? "",
    durationValue: i.durationValue === null ? "" : String(i.durationValue),
    durationUnit: i.durationUnit ?? "",
    quantity: String(i.quantity),
    quantityUnit: i.quantityUnit,
    refills: String(i.refills),
    instructions: i.instructions,
  }));
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined);
const optionalNumber = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Enter a number" });
      return z.NEVER;
    }
    return n;
  });

const lineSchema = z
  .object({
    genericName: z.string().trim().min(1, "Enter the generic name").max(200),
    brandName: optionalText(200),
    strength: optionalText(60),
    dosageForm: optionalText(60),
    doseAmount: optionalNumber.refine((v) => v === undefined || v > 0, "Must be more than 0"),
    doseUnit: optionalText(20),
    route: z.string() as z.ZodType<PrescriptionRoute>,
    frequency: z.string() as z.ZodType<PrescriptionFrequency>,
    frequencyText: optionalText(200),
    asNeededReason: optionalText(200),
    durationValue: optionalNumber.refine((v) => v === undefined || (Number.isInteger(v) && v > 0 && v <= 365), "Whole number, 1–365"),
    durationUnit: z.enum(["", "days", "weeks", "months"]).transform((v) => v || undefined),
    quantity: optionalNumber.refine((v) => v !== undefined && v > 0 && v <= 100_000, "Enter the quantity to dispense"),
    quantityUnit: z.string().trim().min(1, "e.g. tablets").max(30),
    refills: optionalNumber.refine((v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 11), "0–11"),
    instructions: z.string().trim().min(1, "Directions for the patient").max(1000),
  })
  .superRefine((v, ctx) => {
    if ((v.doseAmount === undefined) !== (v.doseUnit === undefined))
      ctx.addIssue({ code: "custom", path: [v.doseAmount === undefined ? "doseAmount" : "doseUnit"], message: "Dose amount and unit go together" });
    if (v.durationValue !== undefined && v.durationUnit === undefined) ctx.addIssue({ code: "custom", path: ["durationUnit"], message: "Choose a unit" });
    if (v.frequency === "custom" && !v.frequencyText) ctx.addIssue({ code: "custom", path: ["frequencyText"], message: "Describe the frequency" });
    if (v.frequency === "as_needed" && !v.asNeededReason) ctx.addIssue({ code: "custom", path: ["asNeededReason"], message: "Give the as-needed indication" });
  })
  .transform((v) => ({
    ...v,
    // A unit without a duration is dropped rather than sent alone.
    durationUnit: v.durationValue === undefined ? undefined : v.durationUnit,
    quantity: v.quantity as number,
    refills: v.refills ?? 0,
  }));

/** Validates every line; returns payload lines or per-line field errors. */
export function parseLines(lines: LineForm[]): { ok: true; items: LinePayload[] } | { ok: false; errors: LineErrors[] } {
  if (lines.length === 0) return { ok: false, errors: [] };
  const items: LinePayload[] = [];
  const errors: LineErrors[] = [];
  let failed = false;
  for (const { key: _key, ...line } of lines) {
    const result = lineSchema.safeParse(line);
    if (result.success) {
      items.push(result.data);
      errors.push({});
    } else {
      failed = true;
      const e: LineErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as LineField | undefined;
        if (field && !e[field]) e[field] = issue.message;
      }
      errors.push(e);
    }
  }
  return failed ? { ok: false, errors } : { ok: true, items };
}

/** "Amoxicillin 500 mg capsule — 1 capsule oral, 3 times a day for 7 days (#21 capsules)". */
export function lineSummary(
  i: Pick<
    PrescriptionLine,
    | "genericName"
    | "brandName"
    | "strength"
    | "dosageForm"
    | "doseAmount"
    | "doseUnit"
    | "route"
    | "frequency"
    | "frequencyText"
    | "asNeededReason"
    | "durationValue"
    | "durationUnit"
    | "quantity"
    | "quantityUnit"
    | "refills"
  >,
): string {
  const name = [i.genericName, i.brandName ? `(${i.brandName})` : null, i.strength, i.dosageForm].filter(Boolean).join(" ");
  const dose = i.doseAmount !== null && i.doseUnit ? `${i.doseAmount} ${i.doseUnit} ` : "";
  const frequency =
    i.frequency === "custom"
      ? (i.frequencyText ?? "")
      : i.frequency === "as_needed"
        ? `as needed for ${i.asNeededReason ?? "—"}`
        : FREQUENCY_LABEL[i.frequency].toLowerCase();
  const duration = i.durationValue && i.durationUnit ? ` for ${i.durationValue} ${i.durationUnit}` : "";
  const refills = i.refills ? `, ${i.refills} refill${i.refills === 1 ? "" : "s"}` : "";
  return `${name} — ${dose}${ROUTE_LABEL[i.route].toLowerCase()}, ${frequency}${duration} (#${i.quantity} ${i.quantityUnit}${refills})`;
}

/** Minimum override reason, as the API requires. */
export const OVERRIDE_MIN_LENGTH = 10;
