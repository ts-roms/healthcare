import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { type Actor, CurrentActor, Public, requestMetadataFrom, RequirePermissions } from "@healthcare/core";
import type { Request } from "express";
import { CurrentPatient, PatientAccessGuard } from "./patient-access.guard";
import {
  DisablePortalAccountDto,
  PortalActivateDto,
  PortalLoginDto,
  PortalPasswordResetConfirmDto,
  PortalPasswordResetRequestDto,
  PortalRefreshDto,
} from "./portal.dto";
import { type PortalPrincipal, PortalAccountService } from "./portal-account.service";
import { PortalPasswordResetService } from "./portal-password-reset.service";

// Credential endpoints get the same tight rate limit as staff sign-in.
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Patient-facing portal endpoints. Public to the staff guard; the patient guard protects the rest. */
@ApiTags("portal")
@Controller({ path: "portal", version: "1" })
export class PortalController {
  constructor(
    private readonly accounts: PortalAccountService,
    private readonly passwordReset: PortalPasswordResetService,
  ) {}

  @Post("auth/password-reset/request")
  @Public()
  @HttpCode(202)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Ask for a password-reset link by email; the answer is the same whether or not an account exists" })
  async requestPasswordReset(@Body() body: PortalPasswordResetRequestDto, @Req() request: Request): Promise<{ status: "accepted" }> {
    await this.passwordReset.request(body, requestMetadataFrom(request));
    return { status: "accepted" };
  }

  @Post("auth/password-reset/confirm")
  @Public()
  @HttpCode(204)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Choose a new password with the emailed token and the patient's date of birth; signs the account out everywhere" })
  async confirmPasswordReset(@Body() body: PortalPasswordResetConfirmDto, @Req() request: Request): Promise<void> {
    await this.passwordReset.confirm(body, requestMetadataFrom(request));
  }

  @Post("auth/activate")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "First sign-in with patient number, birth date and the activation code from the clinic; sets email and password" })
  activate(@Body() body: PortalActivateDto, @Req() request: Request) {
    return this.accounts.activate(body, requestMetadataFrom(request));
  }

  @Post("auth/login")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  login(@Body() body: PortalLoginDto, @Req() request: Request) {
    return this.accounts.login(body, requestMetadataFrom(request));
  }

  @Post("auth/refresh")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  refresh(@Body() body: PortalRefreshDto, @Req() request: Request) {
    return this.accounts.refresh(body.refreshToken, requestMetadataFrom(request));
  }

  @Post("auth/logout")
  @Public()
  @UseGuards(PatientAccessGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  async logout(@CurrentPatient() patient: PortalPrincipal): Promise<void> {
    await this.accounts.logout(patient);
  }

  @Get("me")
  @Public()
  @UseGuards(PatientAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The signed-in patient's profile" })
  me(@CurrentPatient() patient: PortalPrincipal) {
    return this.accounts.me(patient);
  }
}

/** Staff management of a patient's portal account. */
@ApiTags("patients")
@ApiBearerAuth()
@Controller({ path: "patients/:patientId/portal-account", version: "1" })
export class PatientPortalAccountController {
  constructor(private readonly accounts: PortalAccountService) {}

  @Get()
  @RequirePermissions("patient.read")
  status(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.accounts.status(actor, patientId);
  }

  @Post("invitations")
  @RequirePermissions("patient.portal.manage")
  @ApiOperation({ summary: "Issue a one-time activation code (shown once) after verifying the patient in person" })
  invite(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.accounts.invite(actor, patientId);
  }

  @Post("disable")
  @HttpCode(204)
  @RequirePermissions("patient.portal.manage")
  async disable(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: DisablePortalAccountDto): Promise<void> {
    await this.accounts.disable(actor, patientId, body.reason);
  }
}
