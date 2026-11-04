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
  /** The staff account the device signs in with: the Patient kiosk role for a kiosk, the Waiting-room display role for a display. */
  userId: z.string().uuid(),
  kind: z.enum(["kiosk", "display"]).default("kiosk"),
  /** The kiosk has a ticket printer and a print agent: tickets are queued for printing. Off until staff turn it on. */
  printsTickets: z.boolean().default(false),
  /** The print agent account that serves this kiosk; leave empty to let any print agent of the facility serve it. */
  printAgentUserId: z.string().uuid().optional(),
});
export class RegisterDeviceDto extends createZodDto(registerDeviceSchema) {}

export const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    status: z.enum(["active", "maintenance", "disabled"]).optional(),
    printsTickets: z.boolean().optional(),
    /** The print agent account that serves this kiosk; null lets any print agent of the facility serve it. */
    printAgentUserId: z.string().uuid().nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined || v.printsTickets !== undefined || v.printAgentUserId !== undefined, "Nothing to change");
export class UpdateDeviceDto extends createZodDto(updateDeviceSchema) {}

// ---- The kiosk itself ----------------------------------------------------------------------------------------------

// ---- Ticket printing (migration 0139) -------------------------------------------------------------------------------

const deviceCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,39}$/);

/** The print agent asks for the next ticket of one kiosk's printer. */
export const claimPrintSchema = z.object({ deviceCode });
export class ClaimPrintDto extends createZodDto(claimPrintSchema) {}

/** What happened to a claimed ticket. A failure names its cause as a short code, never a printer's raw answer. */
export const printResultSchema = z
  .object({
    outcome: z.enum(["printed", "failed"]),
    error: z.enum(["paper_out", "offline", "error"]).optional(),
    /** The agent will try again (a jam, a cable): the job goes back in line while it has attempts left. */
    retry: z.boolean().default(false),
  })
  .refine((v) => v.outcome === "printed" || v.error !== undefined, { message: "Say why it failed", path: ["error"] });
export class PrintResultDto extends createZodDto(printResultSchema) {}

/** The agent's report of the printer it drives. */
export const printerHeartbeatSchema = z.object({ deviceCode, printerStatus: z.enum(["ok", "paper_out", "offline", "error"]) });
export class PrinterHeartbeatDto extends createZodDto(printerHeartbeatSchema) {}

export const reprintSchema = z.object({ reason });
export class ReprintDto extends createZodDto(reprintSchema) {}

export const printJobsQuerySchema = z.object({ status: z.enum(["queued", "printing", "printed", "failed", "cancelled"]).optional() });
export class PrintJobsQueryDto extends createZodDto(printJobsQuerySchema) {}

export const heartbeatSchema = z.object({
  appVersion: z.string().trim().min(1).max(40).optional(),
  // The printer's state is reported by the print agent only (POST /kiosk/print/heartbeat); a kiosk cannot overwrite it.
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

/**
 * Registering or linking a person is a decision about who they are, so the reviewer must confirm that they checked the
 * person's identification (the confirmation and the optional note on how are kept in the audit trail).
 */
const identityCheck = {
  identityChecked: z.literal(true, { error: "Confirm that you checked the person's identification" }),
  identityNote: z.string().trim().min(2).max(200).optional(),
};

export const approveRegistrationSchema = z.object({
  ...identityCheck,
  /** Put the new patient in the queue for this service as part of approving. */
  visitTypeId: z.string().uuid().optional(),
  /** Possible duplicates were reviewed and this is a different person (same rule as the front desk's registration). */
  duplicateOverride: z.object({ reviewedCandidateIds: z.array(z.string().uuid()).min(1), reason }).optional(),
});
export class ApproveRegistrationDto extends createZodDto(approveRegistrationSchema) {}

export const linkRegistrationSchema = z.object({ ...identityCheck, patientId: z.string().uuid(), visitTypeId: z.string().uuid().optional() });
export class LinkRegistrationDto extends createZodDto(linkRegistrationSchema) {}

export const rejectRegistrationSchema = z.object({ reason });
export class RejectRegistrationDto extends createZodDto(rejectRegistrationSchema) {}
