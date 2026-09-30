import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { IMMUNIZATION_NOT_DONE_REASONS } from "./immunization.schema";
import { isOccurrenceText } from "./immunization.rules";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();
const calendarDate = z.iso.date();
const option = z.string().trim().min(1).max(60);

// ---- the vaccine catalogue (clinic.configure) -----------------------------------------------------------------

const vaccineFields = {
  name: z.string().trim().min(2, "Name the vaccine").max(200),
  productName: optionalText(200),
  manufacturer: optionalText(200),
  /** A key naming the code system (e.g. "vaccine" for the organization's own list). */
  codeSystem: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, "Use lower-case letters, digits, dots, hyphens or underscores")
    .optional(),
  code: optionalText(40),
  routes: z.array(option).max(10).default([]),
  sites: z.array(option).max(20).default([]),
  /** As the organization records it; informational only (nothing is scheduled from it). */
  dosesInSeries: z.number().int().min(1).max(20).optional(),
};

export const createVaccineSchema = z
  .object(vaccineFields)
  .refine((v) => !v.codeSystem || v.code, { message: "Give the code with its code system", path: ["code"] });
export class CreateVaccineDto extends createZodDto(createVaccineSchema) {}

export const updateVaccineSchema = z.object({
  name: vaccineFields.name.optional(),
  productName: text(200).nullable().optional(),
  manufacturer: text(200).nullable().optional(),
  codeSystem: vaccineFields.codeSystem.nullable().optional(),
  code: text(40).nullable().optional(),
  routes: z.array(option).max(10).optional(),
  sites: z.array(option).max(20).optional(),
  dosesInSeries: z.number().int().min(1).max(20).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  version: z.number().int().positive(),
});
export class UpdateVaccineDto extends createZodDto(updateVaccineSchema) {}

export const vaccineListQuery = z.object({ includeInactive: z.enum(["true", "false"]).optional() });
export class VaccineListQueryDto extends createZodDto(vaccineListQuery) {}

// ---- records --------------------------------------------------------------------------------------------------

const dose = {
  /** The dose as the clinician records it (e.g. "1", "Booster"); nothing is derived from it. */
  doseLabel: optionalText(60),
  doseNumber: z.number().int().min(1).max(50).optional(),
};

/** A dose given (or not given) here, at the selected facility. */
export const recordAdministeredSchema = z
  .object({
    vaccineId: z.uuid(),
    encounterId: z.uuid().optional(),
    status: z.enum(["completed", "not_done"]).default("completed"),
    notDoneReason: z.enum(IMMUNIZATION_NOT_DONE_REASONS).optional(),
    /** The clinician's own words (required when the reason is "other"). */
    notDoneReasonText: optionalText(500),
    /** When it was given: a day (YYYY-MM-DD) or an instant with a time zone; now when left out. */
    occurrence: z
      .string()
      .trim()
      .refine((v) => isOccurrenceText(v) && v.length >= 10, "Give the day (YYYY-MM-DD) or the date and time given")
      .optional(),
    ...dose,
    lotNumber: optionalText(60),
    expiryDate: calendarDate.optional(),
    route: option.optional(),
    site: option.optional(),
    doseQuantity: z.number().positive().max(10000).optional(),
    doseUnit: optionalText(20),
    /** Take the dose from a stock lot at a location of the facility (optional: recording without stock stays possible). */
    stock: z.object({ locationId: z.uuid(), lotId: z.uuid(), quantity: z.number().int().min(1).max(100).default(1) }).optional(),
    notes: optionalText(2000),
    adverseReaction: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.status === "not_done") {
      if (!v.notDoneReason) ctx.addIssue({ code: "custom", message: "Say why the dose was not given", path: ["notDoneReason"] });
      if (v.notDoneReason === "other" && !v.notDoneReasonText) ctx.addIssue({ code: "custom", message: "Describe the reason", path: ["notDoneReasonText"] });
      for (const key of ["lotNumber", "expiryDate", "route", "site", "doseQuantity", "stock", "adverseReaction"] as const) {
        if (v[key] !== undefined) ctx.addIssue({ code: "custom", message: "Not recorded for a dose that was not given", path: [key] });
      }
    } else {
      if (v.notDoneReason || v.notDoneReasonText) ctx.addIssue({ code: "custom", message: "Only for a dose not given", path: ["notDoneReason"] });
      if (!v.lotNumber && !v.stock) ctx.addIssue({ code: "custom", message: "Give the lot number", path: ["lotNumber"] });
    }
    if ((v.doseQuantity === undefined) !== (v.doseUnit === undefined)) {
      ctx.addIssue({ code: "custom", message: "Give the dose amount with its unit", path: ["doseUnit"] });
    }
  });
export class RecordAdministeredDto extends createZodDto(recordAdministeredSchema) {}

/** A dose reported by the patient or another provider (e.g. from a vaccination card). */
export const recordHistoricalSchema = z
  .object({
    /** A vaccine of the catalogue, or the name as reported. */
    vaccineId: z.uuid().optional(),
    vaccineName: optionalText(200),
    /** YYYY, YYYY-MM or YYYY-MM-DD: as precise as the source is. */
    occurrence: z
      .string()
      .trim()
      .refine((v) => isOccurrenceText(v) && v.length <= 10, "Give the year (YYYY), month (YYYY-MM) or day (YYYY-MM-DD)"),
    ...dose,
    lotNumber: optionalText(60),
    /** Who gave it or where, as reported (e.g. "Barangay health station"). */
    givenBy: optionalText(200),
    /** Where the information comes from (e.g. "Vaccination card", "Patient's recall"). */
    sourceDescription: text(300),
    /** An uploaded scan of the patient's record (a document of the patient). */
    documentId: z.uuid().optional(),
    notes: optionalText(2000),
  })
  .refine((v) => Boolean(v.vaccineId) !== Boolean(v.vaccineName), { message: "Choose a vaccine or type its name as reported", path: ["vaccineName"] });
export class RecordHistoricalDto extends createZodDto(recordHistoricalSchema) {}

export const immunizationReactionSchema = z.object({ adverseReaction: text(1000) });
export class ImmunizationReactionDto extends createZodDto(immunizationReactionSchema) {}

export const immunizationInErrorSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });
export class ImmunizationInErrorDto extends createZodDto(immunizationInErrorSchema) {}
