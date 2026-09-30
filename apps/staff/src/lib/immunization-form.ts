import { z } from "zod";
import type { ImmunizationNotDoneReason, ImmunizationRecord, ImmunizationSource, OccurrencePrecision, Vaccine, VaccineStockLot } from "./api/types";

/**
 * Immunization helpers for the staff app. The API (`libs/clinic` immunizations) validates, audits and decides; these
 * give field-level errors and display text. Nothing here knows a schedule or which dose is due: the platform records
 * what was given, not given or reported. Records are never edited: a mistake is marked "entered in error" (with a
 * reason) and recorded again.
 */

export const SOURCE_LABEL: Record<ImmunizationSource, string> = {
  administered_here: "Given here",
  historical: "Reported",
  external_import: "Imported",
};

export const NOT_DONE_REASON_LABEL: Record<ImmunizationNotDoneReason, string> = {
  refused: "Refused",
  contraindicated: "Contraindicated",
  unavailable: "Vaccine unavailable",
  other: "Other reason",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When a dose was given, at the precision known: "2019", "May 2019", or the date (and time, in the facility's time
 * zone) formatted by the given functions.
 */
export function occurrenceLabel(
  occurrence: string,
  precision: OccurrencePrecision,
  format: { date: (isoDate: string) => string; dateTime: (iso: string) => string },
): string {
  if (precision === "year") return occurrence.slice(0, 4);
  if (precision === "month") return `${MONTHS[Number(occurrence.slice(5, 7)) - 1] ?? ""} ${occurrence.slice(0, 4)}`.trim();
  if (precision === "day") return format.date(occurrence);
  return format.dateTime(occurrence);
}

/** Status as text and badge variant (the page adds an icon: never colour alone). */
export function immunizationStatus(i: Pick<ImmunizationRecord, "status" | "enteredInError">): {
  label: string;
  variant: "success" | "warning" | "neutral";
  tone: "done" | "stopped" | "error";
} {
  if (i.enteredInError) return { label: "Entered in error", variant: "neutral", tone: "error" };
  if (i.status === "not_done") return { label: "Not given", variant: "warning", tone: "stopped" };
  return { label: "Given", variant: "success", tone: "done" };
}

/** Records grouped by vaccine name (A–Z), each group newest first as the API lists them. */
export function groupByVaccine<T extends Pick<ImmunizationRecord, "vaccineName">>(records: readonly T[]): Array<{ vaccine: string; records: T[] }> {
  const groups = new Map<string, { vaccine: string; records: T[] }>();
  for (const r of records) {
    const key = r.vaccineName.trim().toLowerCase();
    const group = groups.get(key) ?? { vaccine: r.vaccineName, records: [] };
    group.records.push(r);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.vaccine.localeCompare(b.vaccine));
}

/** A lot as offered in the "from stock" list. */
export function stockLotLabel(lot: VaccineStockLot): string {
  return [
    lot.itemName,
    lot.lotNumber ? `lot ${lot.lotNumber}` : "no lot number",
    lot.expiryDate ? `exp. ${lot.expiryDate}` : null,
    `${lot.quantity} ${lot.stockUnit}`,
    lot.locationName,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The vaccine as offered in lists: name and product. */
export function vaccineLabel(v: Pick<Vaccine, "name" | "productName">): string {
  return v.productName ? `${v.name} (${v.productName})` : v.name;
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The "dose given here" form (also "not given"). */
export const givenFormSchema = z
  .object({
    vaccineId: z.uuid("Choose the vaccine"),
    encounterId: z.uuid().optional(),
    given: z.boolean(),
    notDoneReason: z.enum(["", "refused", "contraindicated", "unavailable", "other"]),
    notDoneReasonText: optional(500),
    /** YYYY-MM-DD; empty: now. */
    date: z
      .string()
      .trim()
      .refine((v) => v === "" || DAY.test(v), "Use the date picker"),
    doseLabel: optional(60),
    doseNumber: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,2}$/.test(v), "A whole number"),
    stockLotId: z.string(),
    lotNumber: optional(60),
    expiryDate: z
      .string()
      .trim()
      .refine((v) => v === "" || DAY.test(v), "Use the date picker"),
    route: optional(60),
    site: optional(60),
    doseQuantity: z
      .string()
      .trim()
      .refine((v) => v === "" || (Number(v) > 0 && Number(v) <= 10000), "A positive amount"),
    doseUnit: optional(20),
    notes: optional(2000),
    adverseReaction: optional(1000),
  })
  .superRefine((v, ctx) => {
    if (!v.given) {
      if (!v.notDoneReason) ctx.addIssue({ code: "custom", message: "Say why the dose was not given", path: ["notDoneReason"] });
      if (v.notDoneReason === "other" && !v.notDoneReasonText) ctx.addIssue({ code: "custom", message: "Describe the reason", path: ["notDoneReasonText"] });
      return;
    }
    if (!v.stockLotId && !v.lotNumber) ctx.addIssue({ code: "custom", message: "Give the lot number, or take the dose from stock", path: ["lotNumber"] });
    if ((v.doseQuantity === "") !== !v.doseUnit) ctx.addIssue({ code: "custom", message: "Give the amount with its unit", path: ["doseUnit"] });
  });
export type GivenForm = z.input<typeof givenFormSchema>;

export const BLANK_GIVEN: GivenForm = {
  vaccineId: "",
  given: true,
  notDoneReason: "",
  notDoneReasonText: "",
  date: "",
  doseLabel: "",
  doseNumber: "",
  stockLotId: "",
  lotNumber: "",
  expiryDate: "",
  route: "",
  site: "",
  doseQuantity: "",
  doseUnit: "",
  notes: "",
  adverseReaction: "",
};

/** The API body for a dose given (or not given) here; the stock lot's location comes from the list offered. */
export function givenPayload(form: z.output<typeof givenFormSchema>, lots: readonly VaccineStockLot[]) {
  const lot = form.stockLotId ? lots.find((l) => l.lotId === form.stockLotId) : undefined;
  const common = {
    vaccineId: form.vaccineId,
    ...(form.encounterId ? { encounterId: form.encounterId } : {}),
    ...(form.date ? { occurrence: form.date } : {}),
    ...(form.doseLabel ? { doseLabel: form.doseLabel } : {}),
    ...(form.doseNumber ? { doseNumber: Number(form.doseNumber) } : {}),
    ...(form.notes ? { notes: form.notes } : {}),
  };
  if (!form.given) {
    return {
      ...common,
      status: "not_done" as const,
      notDoneReason: form.notDoneReason as ImmunizationNotDoneReason,
      ...(form.notDoneReasonText ? { notDoneReasonText: form.notDoneReasonText } : {}),
    };
  }
  return {
    ...common,
    status: "completed" as const,
    ...(lot ? { stock: { locationId: lot.locationId, lotId: lot.lotId, quantity: 1 } } : {}),
    ...(form.lotNumber && !lot?.lotNumber ? { lotNumber: form.lotNumber } : {}),
    ...(form.expiryDate && !lot?.expiryDate ? { expiryDate: form.expiryDate } : {}),
    ...(form.route ? { route: form.route } : {}),
    ...(form.site ? { site: form.site } : {}),
    ...(form.doseQuantity && form.doseUnit ? { doseQuantity: Number(form.doseQuantity), doseUnit: form.doseUnit } : {}),
    ...(form.adverseReaction ? { adverseReaction: form.adverseReaction } : {}),
  };
}

/** The "reported dose" form (a vaccination card, another provider's record, the patient's recall). */
export const reportedFormSchema = z
  .object({
    vaccineId: z.string(),
    vaccineName: optional(200),
    /** YYYY, YYYY-MM or YYYY-MM-DD: as precise as the source is. */
    occurrence: z
      .string()
      .trim()
      .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Give the year (2019), month (2019-05) or day (2019-05-12)"),
    doseLabel: optional(60),
    doseNumber: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,2}$/.test(v), "A whole number"),
    lotNumber: optional(60),
    givenBy: optional(200),
    sourceDescription: z.string().trim().min(1, "Say where the information comes from (e.g. vaccination card)").max(300),
    documentId: z.string(),
    notes: optional(2000),
  })
  .refine((v) => Boolean(v.vaccineId) !== Boolean(v.vaccineName), { message: "Choose a vaccine, or type its name as reported", path: ["vaccineName"] });
export type ReportedForm = z.input<typeof reportedFormSchema>;

export const BLANK_REPORTED: ReportedForm = {
  vaccineId: "",
  vaccineName: "",
  occurrence: "",
  doseLabel: "",
  doseNumber: "",
  lotNumber: "",
  givenBy: "",
  sourceDescription: "Vaccination card",
  documentId: "",
  notes: "",
};

export function reportedPayload(form: z.output<typeof reportedFormSchema>) {
  return {
    ...(form.vaccineId ? { vaccineId: form.vaccineId } : { vaccineName: form.vaccineName }),
    occurrence: form.occurrence,
    ...(form.doseLabel ? { doseLabel: form.doseLabel } : {}),
    ...(form.doseNumber ? { doseNumber: Number(form.doseNumber) } : {}),
    ...(form.lotNumber ? { lotNumber: form.lotNumber } : {}),
    ...(form.givenBy ? { givenBy: form.givenBy } : {}),
    sourceDescription: form.sourceDescription,
    ...(form.documentId ? { documentId: form.documentId } : {}),
    ...(form.notes ? { notes: form.notes } : {}),
  };
}

/** Catalogue form: options are typed one per line (or comma-separated). */
export function splitOptions(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}
