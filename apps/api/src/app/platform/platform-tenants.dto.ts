import { createFacilitySchema, createOrganizationSchema } from "@healthcare/organization";
import { passwordSchema } from "@healthcare/auth";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** A new tenant: the organization, its first facility and its first administrator (docs/architecture/platform-console.md). */
export const createTenantSchema = createOrganizationSchema.extend({
  facility: createFacilitySchema,
  administrator: z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1).max(200),
    /** Required when the email is new to the platform; replaced at the first sign-in. Ignored for an existing account. */
    temporaryPassword: passwordSchema.optional(),
  }),
});
export class CreateTenantDto extends createZodDto(createTenantSchema) {}

/** Suspend or reactivate, with the reason kept in the organization's history and audit trail. */
export const tenantStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(1000),
  /** Optimistic lock: the organization version the console last read. */
  version: z.number().int().positive(),
});
export class TenantStatusDto extends createZodDto(tenantStatusSchema) {}
