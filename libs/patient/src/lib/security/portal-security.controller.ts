import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { createZodDto } from "nestjs-zod";
import { Public, requestMetadataFrom } from "@healthcare/core";
import type { Request } from "express";
import { z } from "zod";
import { CurrentPatient, PatientAccessGuard } from "../portal/patient-access.guard";
import type { PortalPrincipal } from "../portal/portal-account.service";
import { PortalEmailService } from "./portal-email.service";
import { PortalMfaService } from "./portal-mfa.service";

const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const password = z.string().min(1).max(128);
const code = z.string().trim().min(6).max(20);

class ConfirmEmailDto extends createZodDto(z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") })) {}
class ChangeEmailDto extends createZodDto(z.object({ newEmail: z.string().trim().toLowerCase().email().max(254), password, code: code.optional() })) {}
class MfaBeginDto extends createZodDto(z.object({ password })) {}
class MfaEnableDto extends createZodDto(z.object({ code })) {}
class MfaPasswordAndCodeDto extends createZodDto(z.object({ password, code })) {}
class MfaVerifyDto extends createZodDto(z.object({ challengeToken: z.string().min(20).max(2000), code })) {}

/**
 * Sign-in security of the patient's account in MyHealth: the sign-in email (verify, change) and two-step verification.
 * Public to the staff guard; the patient guard re-checks the session, account and consent on every request. Wrong
 * codes and passwords are refused with 422 (not 401, which would end the session) and count toward the sign-in lockout.
 */
@ApiTags("portal")
@ApiBearerAuth()
@Public()
@UseGuards(PatientAccessGuard)
@Controller({ path: "portal", version: "1" })
export class PortalSecurityController {
  constructor(
    private readonly email: PortalEmailService,
    private readonly mfa: PortalMfaService,
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
}

/** The second step of sign-in: public (the challenge from the password step is the credential). */
@ApiTags("portal")
@Controller({ path: "portal/auth/mfa", version: "1" })
export class PortalMfaLoginController {
  constructor(private readonly mfa: PortalMfaService) {}

  @Post("verify")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Finish signing in with the challenge from the password step and the app's code or a recovery code" })
  verify(@Body() body: MfaVerifyDto, @Req() request: Request) {
    return this.mfa.verifyLogin(body.challengeToken, body.code, requestMetadataFrom(request));
  }
}
