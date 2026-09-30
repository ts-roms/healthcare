import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  type Actor,
  AllowDuringMfaEnrollment,
  CurrentActor,
  ForbiddenError,
  Public,
  RequireFacility,
  requestMetadataFrom,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import type { Request } from "express";
import { ChangePasswordDto, LoginDto, MfaConfirmDto, MfaDisableDto, MfaVerifyDto, RefreshDto } from "./auth.dto";
import { AccessService, facilitiesInReach } from "./access.service";
import { AuthService } from "./auth.service";
import { MfaPolicyService } from "./mfa-policy.service";
import { REALTIME_TICKET_TTL_SECONDS, TokenService } from "./tokens";

// Credential endpoints get a much tighter rate limit than the API default.
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags("auth")
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly organizations: OrganizationService,
    private readonly tokens: TokenService,
    private readonly mfaPolicy: MfaPolicyService,
  ) {}

  @Post("realtime-tickets")
  @ApiBearerAuth()
  @RequireFacility()
  @ApiOperation({
    summary: "Short-lived ticket to open the realtime socket for the current session and facility (never an access token)",
  })
  async realtimeTicket(@CurrentActor() actor: Actor): Promise<{ ticket: string; expiresInSeconds: number }> {
    if (!actor.sessionId) throw new ForbiddenError("A user session is required");
    const ticket = await this.tokens.signRealtimeTicket({ sub: actor.userId, sid: actor.sessionId, org: actor.organizationId, fac: requireFacilityId(actor) });
    return { ticket, expiresInSeconds: REALTIME_TICKET_TTL_SECONDS };
  }

  @Post("login")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Sign in with email and password; may require an MFA step" })
  login(@Body() body: LoginDto, @Req() request: Request) {
    return this.auth.login(body, requestMetadataFrom(request));
  }

  @Post("mfa/verify")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Complete sign-in with a TOTP code" })
  verifyMfa(@Body() body: MfaVerifyDto, @Req() request: Request) {
    return this.auth.verifyMfa(body.challengeToken, body.code, requestMetadataFrom(request));
  }

  @Post("refresh")
  @Public()
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Exchange a refresh token for new tokens (rotates the refresh token)" })
  refresh(@Body() body: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(body.refreshToken, requestMetadataFrom(request));
  }

  @Post("logout")
  @AllowDuringMfaEnrollment()
  @HttpCode(204)
  @ApiBearerAuth()
  async logout(@CurrentActor() actor: Actor): Promise<void> {
    await this.auth.logout(actor);
  }

  @Get("me")
  @AllowDuringMfaEnrollment()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Current user, organization, facility context and effective permissions" })
  async me(@CurrentActor() actor: Actor) {
    const [user, organization] = await Promise.all([this.auth.getUser(actor.userId), this.organizations.getOrganization(actor.organizationId)]);
    const mfaPolicy = await this.mfaPolicy.forMember(user.id, actor.organizationId, user.mfaEnabled);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        mfaEnabled: user.mfaEnabled,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      organization: { id: organization.id, code: organization.code, name: organization.name },
      facilityId: actor.facilityId ?? null,
      mfaPolicy,
      // Until enrollment, the member can do nothing else; the staff app shows only the set-up.
      permissions: mfaPolicy.enrollmentRequired ? [] : [...actor.permissions].sort(),
    };
  }

  @Get("me/facilities")
  @AllowDuringMfaEnrollment()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Active facilities the current user can work in (holds a role there, or an organization-wide role); for the facility selector",
  })
  async myFacilities(@CurrentActor() actor: Actor) {
    const [grants, facilities] = await Promise.all([
      this.access.grantsFor(actor.userId, actor.organizationId),
      this.organizations.listFacilities(actor.organizationId),
    ]);
    const active = facilities.filter((f) => f.status === "active");
    return facilitiesInReach(grants, active).map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      facilityType: f.facilityType,
      timezone: f.timezone,
      status: f.status,
    }));
  }

  @Post("password")
  @AllowDuringMfaEnrollment()
  @HttpCode(204)
  @ApiBearerAuth()
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOperation({ summary: "Change password; signs out all other sessions" })
  async changePassword(@CurrentActor() actor: Actor, @Body() body: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(actor, body);
  }

  @Post("mfa/setup")
  @AllowDuringMfaEnrollment()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Start TOTP enrollment; returns the secret and otpauth URI for a QR code" })
  setupMfa(@CurrentActor() actor: Actor) {
    return this.auth.beginMfaSetup(actor);
  }

  @Post("mfa/confirm")
  @AllowDuringMfaEnrollment()
  @HttpCode(204)
  @ApiBearerAuth()
  @Throttle(CREDENTIAL_THROTTLE)
  async confirmMfa(@CurrentActor() actor: Actor, @Body() body: MfaConfirmDto): Promise<void> {
    await this.auth.confirmMfaSetup(actor, body.code);
  }

  @Post("mfa/disable")
  @HttpCode(204)
  @ApiBearerAuth()
  @Throttle(CREDENTIAL_THROTTLE)
  async disableMfa(@CurrentActor() actor: Actor, @Body() body: MfaDisableDto): Promise<void> {
    await this.auth.disableMfa(actor, body.password, body.code);
  }
}
