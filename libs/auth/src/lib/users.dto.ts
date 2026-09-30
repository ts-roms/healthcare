import { PERMISSIONS } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { emailSchema } from "./auth.dto";
import { passwordSchema } from "./password";

export const createUserSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(200),
  /** Required when the email is new to the platform; ignored for existing accounts. */
  initialPassword: passwordSchema.optional(),
});
export class CreateUserDto extends createZodDto(createUserSchema) {}

export const updateMembershipSchema = z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(3).max(500) });
export class UpdateMembershipDto extends createZodDto(updateMembershipSchema) {}

/** A temporary password the administrator gives the person directly; it must be replaced at the next sign-in. */
export const resetPasswordSchema = z.object({ temporaryPassword: passwordSchema, reason: z.string().trim().min(3).max(500) });
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}

export const resetMfaSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class ResetMfaDto extends createZodDto(resetMfaSchema) {}

export const grantRoleSchema = z
  .object({
    roleId: z.string().uuid(),
    facilityId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
  })
  .refine((value) => !value.departmentId || value.facilityId, { message: "departmentId requires facilityId", path: ["departmentId"] });
export class GrantRoleDto extends createZodDto(grantRoleSchema) {}

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,48}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).min(1),
});
export class CreateRoleDto extends createZodDto(createRoleSchema) {}
