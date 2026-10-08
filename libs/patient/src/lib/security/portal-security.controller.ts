import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { createZodDto } from "nestjs-zod";
import { PlatformScope, Public, requestMetadataFrom } from "@healthcare/core";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Request } from "express";
import { z } from "zod";
import { AllowDuringPortalMfaEnrollment, CurrentPatient, PatientAccessGuard } from "../portal/patient-access.guard";
import { patientAuditContext, type PortalPrincipal } from "../portal/portal-account.service";
import { PortalEmailService } from "./portal-email.service";
import { PortalMfaService } from "./portal-mfa.service";
import { PortalPasskeyService } from "./portal-passkey.service";
import { PortalTrustedDeviceService } from "./portal-trusted-device.service";

const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const password = z.string().min(1).max(128);
const code = z.string().trim().min(6).max(20);

class ConfirmEmailDto extends createZodDto(z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") })) {}
class ChangeEmailDto extends createZodDto(z.object({ newEmail: z.string().trim().toLowerCase().email().max(254), password, code: code.optional() })) {}
class MfaBeginDto extends createZodDto(z.object({ password })) {}
class MfaEnableDto extends createZodDto(z.object({ code })) {}
class MfaPasswordAndCodeDto extends createZodDto(z.object({ password, code })) {}
const base64url = (max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(max);
/** A WebAuthn answer as @simplewebauthn/browser sends it; the library checks the content. */
const registrationResponse = z.object({
  id: base64url(1400),
  rawId: base64url(1400),
  type: z.literal("public-key"),
  response: z
    .object({
      clientDataJSON: base64url(4000),
      attestationObject: base64url(20000),
      transports: z.array(z.string().max(30)).max(10).optional(),
    })
    .passthrough(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().max(30).optional(),
});
const authenticationResponse = z.object({
  id: base64url(1400),
  rawId: base64url(1400),
  type: z.literal("public-key"),
  response: z
    .object({
      clientDataJSON: base64url(4000),
      authenticatorData: base64url(4000),
      signature: base64url(2000),
      userHandle: base64url(400).optional(),
    })
    .passthrough(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().max(30).optional(),
});
class MfaVerifyDto extends createZodDto(
  z
    .object({
      challengeToken: z.string().min(20).max(2000),
      code: code.optional(),
      /** A passkey's answer instead of a code (migration 0108). */ passkey: authenticationResponse.optional(),
      /** Remember this browser for 30 days (migration 0100). */ rememberDevice: z.boolean().optional(),
    })
    .refine((v) => (v.code === undefined) !== (v.passkey === undefined), { message: "Send a code or a passkey", path: ["code"] }),
) {}
class PasskeyChallengeDto extends createZodDto(z.object({ challengeToken: z.string().min(20).max(2000) })) {}
class PasskeyAddDto extends createZodDto(z.object({ response: registrationResponse, label: z.string().trim().min(1).max(80).optional() })) {}

/**
 * Sign-in security of the patient's account in MyHealth: the sign-in email (verify, change) and two-step verification.
 * Public to the staff guard; the patient guard re-checks the session, account and consent on every request. Wrong
 * codes and passwords are refused with 422 (not 401, which would end the session) and count toward the sign-in lockout.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@AllowDuringPortalMfaEnrollment()
@Controller({ path: "portal", version: "1" })
export class PortalSecurityController {
  constructor(
    private readonly email: PortalEmailService,
    private readonly mfa: PortalMfaService,
    private readonly devices: PortalTrustedDeviceService,
    private readonly passkeys: PortalPasskeyService,
  ) {}

  @Get("email")
  @ApiOperation({ summary: "The sign-in email, whether it is verified, and a code waiting to be entered" })
  emailStatus(@CurrentPatient() patient: PortalPrincipal) {
    return this.email.status(patient);
  }

  @Post("email/verification")
  @HttpCode(202)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Send a 6-digit code to the sign-in email to verify it" })
  sendVerification(@CurrentPatient() patient: PortalPrincipal) {
    return this.email.sendCode(patient);
  }

  @Post("email/verification/confirm")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Enter the code: verifies the email, or completes a change of it" })
  confirmEmail(@CurrentPatient() patient: PortalPrincipal, @Body() body: ConfirmEmailDto) {
    return this.email.confirm(patient, body.code);
  }

  @Post("email/change")
  @HttpCode(202)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({
    summary: "Switch the sign-in email: needs the password (and the authenticator code when two-step verification is on); a code goes to the new address",
  })
  changeEmail(@CurrentPatient() patient: PortalPrincipal, @Body() body: ChangeEmailDto) {
    return this.email.requestChange(patient, body);
  }

  @Get("mfa")
  @ApiOperation({ summary: "Whether two-step verification is on, and how many recovery codes are left" })
  mfaStatus(@CurrentPatient() patient: PortalPrincipal) {
    return this.mfa.status(patient);
  }

  @Post("mfa/setup")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Start two-step verification: a new secret for the authenticator app (needs the password and a verified email)" })
  beginMfa(@CurrentPatient() patient: PortalPrincipal, @Body() body: MfaBeginDto) {
    return this.mfa.begin(patient, body.password);
  }

  @Post("mfa/enable")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Confirm the app's code to turn it on; returns the recovery codes, once" })
  enableMfa(@CurrentPatient() patient: PortalPrincipal, @Body() body: MfaEnableDto) {
    return this.mfa.enable(patient, body.code);
  }

  @Post("mfa/disable")
  @HttpCode(204)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Turn it off: needs the password and a current code (the app's or a recovery code)" })
  async disableMfa(@CurrentPatient() patient: PortalPrincipal, @Body() body: MfaPasswordAndCodeDto): Promise<void> {
    await this.mfa.disable(patient, body);
  }

  @Post("mfa/recovery-codes")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Make new recovery codes (the old ones stop working); needs the password and the app's code" })
  renewRecoveryCodes(@CurrentPatient() patient: PortalPrincipal, @Body() body: MfaPasswordAndCodeDto) {
    return this.mfa.renewRecoveryCodes(patient, body);
  }

  @Get("mfa/passkeys")
  @ApiOperation({ summary: "The account's passkeys, and whether this MyHealth address offers them" })
  passkeyList(@CurrentPatient() patient: PortalPrincipal) {
    return this.passkeys.list(patient);
  }

  @Post("mfa/passkeys/options")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Start adding a passkey: needs the password and a current code (the app's or a recovery code); returns the browser's options" })
  async passkeyOptions(@CurrentPatient() patient: PortalPrincipal, @Body() body: MfaPasswordAndCodeDto) {
    await this.passkeys.assertCanAdd(patient);
    await this.mfa.confirmPasswordAndSecondFactor(patient, body);
    return this.passkeys.registrationOptions(patient);
  }

  @Post("mfa/passkeys")
  @HttpCode(201)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Store the passkey the browser made for the latest options" })
  addPasskey(@CurrentPatient() patient: PortalPrincipal, @Body() body: PasskeyAddDto, @Req() request: Request) {
    return this.passkeys.register(patient, body.response as RegistrationResponseJSON, body.label, requestMetadataFrom(request).userAgent ?? null);
  }

  @Post("mfa/passkeys/:passkeyId/remove")
  @HttpCode(204)
  @ApiOperation({ summary: "Remove a passkey; the app's codes and recovery codes keep working" })
  async removePasskey(@CurrentPatient() patient: PortalPrincipal, @Param("passkeyId", ParseUUIDPipe) passkeyId: string) {
    await this.passkeys.remove(patient, passkeyId);
  }

  @Get("mfa/devices")
  @ApiOperation({ summary: "Browsers remembered for the second step (the one asking is marked when it sends X-Device-Token)" })
  devicesList(@CurrentPatient() patient: PortalPrincipal, @Headers("x-device-token") deviceToken?: string) {
    return this.devices.list(patient.accountId, deviceToken?.trim() || undefined);
  }

  @Post("mfa/devices/:deviceId/forget")
  @HttpCode(204)
  @ApiOperation({ summary: "Forget one remembered browser: it asks for the code again" })
  async forgetDevice(@CurrentPatient() patient: PortalPrincipal, @Param("deviceId", ParseUUIDPipe) deviceId: string) {
    await this.devices.forget(patientAuditContext(patient), deviceId);
  }

  @Post("mfa/devices/forget-all")
  @HttpCode(200)
  @ApiOperation({ summary: "Forget every remembered browser" })
  async forgetAllDevices(@CurrentPatient() patient: PortalPrincipal) {
    return { forgotten: await this.devices.forgetAll(patientAuditContext(patient)) };
  }
}

/** The second step of sign-in: public (the challenge from the password step is the credential). */
@ApiTags("portal")
@Controller({ path: "portal/auth/mfa", version: "1" })
export class PortalMfaLoginController {
  constructor(
    private readonly mfa: PortalMfaService,
    private readonly passkeys: PortalPasskeyService,
  ) {}

  @Post("passkey/options")
  @Public()
  @PlatformScope("MyHealth passkey options at sign-in")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Options for answering the second step with a passkey (the challenge from the password step is the credential)" })
  passkeyOptions(@Body() body: PasskeyChallengeDto) {
    return this.passkeys.signInOptions(body.challengeToken);
  }

  @Post("verify")
  @Public()
  @PlatformScope("MyHealth two-step verification at sign-in")
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Finish signing in with the challenge from the password step and the app's code, a recovery code or a passkey's answer" })
  verify(@Body() body: MfaVerifyDto, @Req() request: Request) {
    const answer = body.passkey ? { passkey: body.passkey as AuthenticationResponseJSON } : { code: body.code ?? "" };
    return this.mfa.verifyLogin(body.challengeToken, answer, requestMetadataFrom(request), body.rememberDevice === true);
  }
}
