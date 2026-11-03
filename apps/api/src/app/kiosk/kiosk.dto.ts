import { addressInput, contactPointInput, identifierInput, RELATIONSHIPS, registerPatientSchema } from "@healthcare/patient";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const reason = z.string().trim().min(5, "Give a reason of at least 5 characters").max(500);

// ---- Staff: devices ------------------------------------------------------------------------------------------------

export const registerDeviceSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "3–40 lower-case letters, digits or hyphens"),
  name: z.string().trim().min(2).max(100),
  /** The staff account the kiosk signs in with: it must hold the Patient kiosk role at this facility. */
  userId: z.string().uuid(),
});
export class RegisterDeviceDto extends createZodDto(registerDeviceSchema) {}

export const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    status: z.enum(["active", "maintenance", "disabled"]).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, "Nothing to change");
export class UpdateDeviceDto extends createZodDto(updateDeviceSchema) {}

// ---- The kiosk itself ----------------------------------------------------------------------------------------------

export const heartbeatSchema = z.object({
  appVersion: z.string().trim().min(1).max(40).optional(),
  printerStatus: z.enum(["none", "ok", "paper_out", "offline", "error"]).optional(),
});
export class HeartbeatDto extends createZodDto(heartbeatSchema) {}

export const identifySchema = z.object({
  /** Patient number or mobile number. */
  key: z.string().trim().min(3).max(30),
  birthDate: z.iso.date(),
  givenName: z.string().trim().min(1).max(100),
});
export class IdentifyDto extends createZodDto(identifySchema) {}

/** Check in for one of today's appointments, or as a walk-in for a service the kiosk offers: exactly one. */
export const kioskCheckInSchema = z
  .object({ appointmentId: z.string().uuid().optional(), visitTypeId: z.string().uuid().optional() })
  .refine((v) => Boolean(v.appointmentId) !== Boolean(v.visitTypeId), "Choose an appointment or a service");
export class KioskCheckInDto extends createZodDto(kioskCheckInSchema) {}

/**
 * What a new patient types at the kiosk. The same fields the front desk records (the Patient Master's own schema),
 * except what only staff decide: duplicate overrides, QR codes and links to existing patients. The emergency contact
 * is a name and a number; the privacy acknowledgement must be given.
 */
export const kioskRegistrationSchema = registerPatientSchema
  .omit({ duplicateOverride: true, issueQrCode: true, relationships: true, identifiers: true })
  .extend({
    contacts: z.array(contactPointInput).max(4).default([]),
    addresses: z.array(addressInput).max(2).default([]),
    identifiers: z.array(identifierInput).max(3).default([]),
    emergencyContact: z.object({
      name: z.string().trim().min(2).max(200),
      contactNumber: z.string().trim().min(7).max(40),
      relationship: z.enum(RELATIONSHIPS),
    }),
    privacyAcknowledged: z.literal(true, { error: "The privacy notice must be acknowledged" }),
  });
export class KioskRegistrationDto extends createZodDto(kioskRegistrationSchema) {}
export type KioskRegistrationInput = z.infer<typeof kioskRegistrationSchema>;

// ---- Staff: registration review ------------------------------------------------------------------------------------

export const approveRegistrationSchema = z.object({
  /** Put the new patient in the queue for this service as part of approving. */
  visitTypeId: z.string().uuid().optional(),
  /** Possible duplicates were reviewed and this is a different person (same rule as the front desk's registration). */
  duplicateOverride: z.object({ reviewedCandidateIds: z.array(z.string().uuid()).min(1), reason }).optional(),
});
export class ApproveRegistrationDto extends createZodDto(approveRegistrationSchema) {}

export const linkRegistrationSchema = z.object({ patientId: z.string().uuid(), visitTypeId: z.string().uuid().optional() });
export class LinkRegistrationDto extends createZodDto(linkRegistrationSchema) {}

export const rejectRegistrationSchema = z.object({ reason });
export class RejectRegistrationDto extends createZodDto(rejectRegistrationSchema) {}
