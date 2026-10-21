import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PATIENT_QR_CONTENTS } from "./qr.schema";

export const patientQrSettingSchema = z.object({
  enabled: z.boolean(),
  issueAtRegistration: z.boolean(),
  content: z.enum(PATIENT_QR_CONTENTS),
  version: z.number().int().min(0),
});
export class PatientQrSettingDto extends createZodDto(patientQrSettingSchema) {}

export const revokePatientQrSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});
export class RevokePatientQrDto extends createZodDto(revokePatientQrSchema) {}

export const scanPatientQrSchema = z.object({
  /** What the scanner delivered, as read. Never stored or audited. */
  payload: z.string().trim().min(1).max(200),
});
export class ScanPatientQrDto extends createZodDto(scanPatientQrSchema) {}
