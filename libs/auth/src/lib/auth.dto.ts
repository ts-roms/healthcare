import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { passwordSchema } from "./password";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  /** Required only when the user belongs to more than one organization. */
  organizationId: z.string().uuid().optional(),
});
export class LoginDto extends createZodDto(loginSchema) {}

/** The 6 digits from the authenticator app, or a recovery code ("K7M2P-X9QRT"; case, spaces and the dash do not matter). */
const secondFactorCode = z.string().trim().min(6, "Enter the 6-digit code or a recovery code").max(20);

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(1),
  code: secondFactorCode,
});
export class MfaVerifyDto extends createZodDto(mfaVerifySchema) {}

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
export class RefreshDto extends createZodDto(refreshSchema) {}

export const mfaConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export class MfaConfirmDto extends createZodDto(mfaConfirmSchema) {}

export const mfaDisableSchema = z.object({ password: z.string().min(1).max(128), code: secondFactorCode });
export class MfaDisableDto extends createZodDto(mfaDisableSchema) {}

/** Renewing recovery codes needs the password and the app's current code (not a recovery code). */
export const recoveryCodesRenewSchema = z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) });
export class RecoveryCodesRenewDto extends createZodDto(recoveryCodesRenewSchema) {}

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must differ from the current password",
    path: ["newPassword"],
  });
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

export interface TokenResponse {
  status: "authenticated";
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  organizationId: string;
}

export interface MfaRequiredResponse {
  status: "mfa_required";
  challengeToken: string;
}
