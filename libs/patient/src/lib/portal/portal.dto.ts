import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { passwordSchema } from "@healthcare/auth";

const organizationCode = z.string().trim().toLowerCase().min(2).max(49);
const email = z.string().trim().toLowerCase().email().max(254);

export const portalActivateSchema = z.object({
  organizationCode,
  patientNumber: z.string().trim().toUpperCase().min(1).max(32),
  birthDate: z.iso.date("Use YYYY-MM-DD"),
  activationCode: z.string().trim().min(10).max(20),
  email,
  password: passwordSchema,
});
export class PortalActivateDto extends createZodDto(portalActivateSchema) {}

export const portalLoginSchema = z.object({ organizationCode, email, password: z.string().min(1).max(128) });
export class PortalLoginDto extends createZodDto(portalLoginSchema) {}

export const portalRefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export class PortalRefreshDto extends createZodDto(portalRefreshSchema) {}

export const disablePortalAccountSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export class DisablePortalAccountDto extends createZodDto(disablePortalAccountSchema) {}

export interface PortalTokenResponse {
  status: "authenticated";
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export const portalPasswordResetRequestSchema = z.object({ organizationCode, email });
export class PortalPasswordResetRequestDto extends createZodDto(portalPasswordResetRequestSchema) {}

export const portalPasswordResetConfirmSchema = z.object({
  token: z.string().trim().min(20).max(200),
  birthDate: z.iso.date("Use YYYY-MM-DD"),
  password: passwordSchema,
});
export class PortalPasswordResetConfirmDto extends createZodDto(portalPasswordResetConfirmSchema) {}
