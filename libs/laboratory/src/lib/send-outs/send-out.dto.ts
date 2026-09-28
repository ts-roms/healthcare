import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use 2–49 lowercase letters, digits or hyphens");
const text = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().min(3).max(500);
const version = z.number().int().positive();

// ---- Reference laboratories (organization configuration) ------------------------------------

const referenceLabFields = {
  name: text(160),
  contactName: text(160).nullable().optional(),
  phone: text(40).nullable().optional(),
  email: z.email().max(200).nullable().optional(),
  address: text(500).nullable().optional(),
  /** The accreditation / licence reference as recorded by staff (not verified by the platform). */
  accreditationReference: text(120).nullable().optional(),
  notes: text(1000).nullable().optional(),
};

export const createReferenceLabSchema = z.object({ code, ...referenceLabFields });
export class CreateReferenceLabDto extends createZodDto(createReferenceLabSchema) {}

export const updateReferenceLabSchema = z.object({
  name: referenceLabFields.name.optional(),
  contactName: referenceLabFields.contactName,
  phone: referenceLabFields.phone,
  email: referenceLabFields.email,
  address: referenceLabFields.address,
  accreditationReference: referenceLabFields.accreditationReference,
  notes: referenceLabFields.notes,
  status: z.enum(["active", "inactive"]).optional(),
  version,
});
export class UpdateReferenceLabDto extends createZodDto(updateReferenceLabSchema) {}

/** Refer a test out from the selected facility's laboratory (replaces an earlier referral of the same test). */
export const setReferralSchema = z.object({
  referenceLaboratoryId: z.uuid(),
  /** Expected turnaround at the reference laboratory, from dispatch (defaults to the test's turnaround). */
  turnaroundMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 90)
    .nullable()
    .optional(),
});
export class SetReferralDto extends createZodDto(setReferralSchema) {}

export const removeReferralSchema = z.object({ reason });
export class RemoveReferralDto extends createZodDto(removeReferralSchema) {}

// ---- Send-outs ------------------------------------------------------------------------------

export const SEND_OUT_VIEWS = ["to_dispatch", "awaiting", "closed", "all"] as const;
export const listSendOutsSchema = z.object({ view: z.enum(SEND_OUT_VIEWS).default("awaiting") });
export class ListSendOutsDto extends createZodDto(listSendOutsSchema) {}

/** Refer received tests that are not configured as referred (or were rejected / cancelled before) to a reference laboratory. */
export const prepareSendOutSchema = z.object({
  orderItemIds: z.array(z.uuid()).min(1).max(60),
  referenceLaboratoryId: z.uuid(),
});
export class PrepareSendOutDto extends createZodDto(prepareSendOutSchema) {}

const notFuture = (value: string) => new Date(value).getTime() <= Date.now() + 60_000;

export const dispatchSchema = z.object({
  sendOutIds: z.array(z.uuid()).min(1).max(200),
  /** Who carries the specimens (courier company, the reference laboratory's rider…). */
  courier: text(120),
  /** The courier's manifest / waybill reference, if any. */
  courierReference: text(80).optional(),
  /** When the specimens were handed over, if not now. */
  dispatchedAt: z.iso.datetime({ offset: true }).refine(notFuture, "The handover time cannot be in the future").optional(),
});
export class DispatchDto extends createZodDto(dispatchSchema) {}

export const resultsReceivedSchema = z.object({
  /** The reference laboratory's own accession number for the specimen (as on its report). */
  referenceAccession: text(60),
  /** When the report arrived, if not now. */
  receivedAt: z.iso.datetime({ offset: true }).refine(notFuture, "The time cannot be in the future").optional(),
});
export class ResultsReceivedDto extends createZodDto(resultsReceivedSchema) {}

export const referenceRejectSchema = z.object({ reason, referenceAccession: text(60).optional() });
export class ReferenceRejectDto extends createZodDto(referenceRejectSchema) {}

export const cancelSendOutSchema = z.object({ reason });
export class CancelSendOutDto extends createZodDto(cancelSendOutSchema) {}
