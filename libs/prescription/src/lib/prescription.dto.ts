import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { FREQUENCIES, ROUTES } from "./prescription.schema";

const text = (max: number) => z.string().trim().min(1).max(max);

export const prescriptionItemSchema = z
  .object({
    genericName: text(200),
    brandName: text(200).optional(),
    strength: text(60).optional(),
    dosageForm: text(60).optional(),
    doseAmount: z.number().positive().optional(),
    doseUnit: text(20).optional(),
    route: z.enum(ROUTES),
    frequency: z.enum(FREQUENCIES),
    frequencyText: text(200).optional(),
    asNeededReason: text(200).optional(),
    durationValue: z.number().int().positive().max(365).optional(),
    durationUnit: z.enum(["days", "weeks", "months"]).optional(),
    quantity: z.number().positive().max(100_000),
    quantityUnit: text(30),
    refills: z.number().int().min(0).max(11).default(0),
    instructions: text(1000),
  })
  .refine((v) => (v.doseAmount === undefined) === (v.doseUnit === undefined), { message: "doseAmount and doseUnit go together", path: ["doseUnit"] })
  .refine((v) => (v.durationValue === undefined) === (v.durationUnit === undefined), {
    message: "durationValue and durationUnit go together",
    path: ["durationUnit"],
  })
  .refine((v) => v.frequency !== "custom" || v.frequencyText, { message: "Describe the custom frequency", path: ["frequencyText"] })
  .refine((v) => v.frequency !== "as_needed" || v.asNeededReason, { message: "Give the as-needed indication", path: ["asNeededReason"] });

const items = z.array(prescriptionItemSchema).min(1).max(20);
const override = z.string().trim().min(10, "Document why the warning is overridden").max(1000);

export const issuePrescriptionSchema = z.object({
  encounterId: z.string().uuid(),
  items,
  notes: text(2000).optional(),
  /** Required when drug–allergy warnings apply; the warnings are stored with the prescription. */
  allergyOverrideReason: override.optional(),
});
export class IssuePrescriptionDto extends createZodDto(issuePrescriptionSchema) {}

export const replacePrescriptionSchema = z.object({
  items,
  reason: z.string().trim().min(5).max(500),
  notes: text(2000).optional(),
  allergyOverrideReason: override.optional(),
});
export class ReplacePrescriptionDto extends createZodDto(replacePrescriptionSchema) {}

export const cancelPrescriptionSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export class CancelPrescriptionDto extends createZodDto(cancelPrescriptionSchema) {}

export const listPrescriptionsSchema = z
  .object({ patientId: z.string().uuid().optional(), encounterId: z.string().uuid().optional(), activeOnly: z.enum(["true", "false"]).optional() })
  .refine((v) => v.patientId || v.encounterId, { message: "Provide patientId or encounterId" });
export class ListPrescriptionsDto extends createZodDto(listPrescriptionsSchema) {}

const day = z.iso.date("Use YYYY-MM-DD");
/** The prescriptions issued at the selected facility over a period of its own calendar days (at most 92). */
export const issuedPrescriptionsSchema = z.object({
  from: day.optional(),
  to: day.optional(),
  status: z.enum(["active", "cancelled", "superseded"]).optional(),
  /** Only those issued by the signed-in practitioner. */
  mine: z.enum(["true", "false"]).optional(),
});
export class IssuedPrescriptionsDto extends createZodDto(issuedPrescriptionsSchema) {}

export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;
