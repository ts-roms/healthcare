import { normalizePhMobile } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { FACILITY_TYPES } from "./organization.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use 2-49 lower-case letters, digits or hyphens");
const name = z.string().trim().min(1).max(200);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const createOrganizationSchema = z.object({ code, name });
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

/** The code is the organization's permanent identifier and is never changed. */
export const updateOrganizationSchema = z.object({
  name,
  /** Require two-step verification of staff (left unchanged when omitted). */
  staffMfaRequired: z.boolean().optional(),
  /** Optimistic lock: the version the client last read. */
  version: z.number().int().positive(),
});
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}

const facilityFields = z.object({
  name,
  facilityType: z.enum(FACILITY_TYPES),
  addressLine: optionalText(300),
  barangay: optionalText(120),
  cityMunicipality: optionalText(120),
  province: optionalText(120),
  region: optionalText(120),
  postalCode: z
    .string()
    .regex(/^\d{4}$/, "Philippine postal codes have 4 digits")
    .optional(),
  contactNumber: optionalText(40),
  email: z.string().trim().toLowerCase().email().optional(),
  licenseNumber: optionalText(80),
});

export const createFacilitySchema = facilityFields.extend({ code });
export class CreateFacilityDto extends createZodDto(createFacilitySchema) {}

export const updateFacilitySchema = facilityFields.partial().extend({
  status: z.enum(["active", "inactive"]).optional(),
  /** Optimistic lock: the version the client last read. */
  version: z.number().int().positive(),
});
export class UpdateFacilityDto extends createZodDto(updateFacilitySchema) {}

export const createDepartmentSchema = z.object({ code, name });
export class CreateDepartmentDto extends createZodDto(createDepartmentSchema) {}

/** Mobile numbers are stored in E.164 when recognizable; landlines are kept as typed. */
export function normalizeContactNumber(value: string | undefined): string | undefined {
  if (!value) return value;
  return normalizePhMobile(value) ?? value;
}
