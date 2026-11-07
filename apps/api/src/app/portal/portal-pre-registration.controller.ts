import { Body, Controller, Get, HttpCode, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PlatformScope, Public, requestMetadataFrom } from "@healthcare/core";
import type { Request } from "express";
import { PreRegistrationDto, PreRegistrationQueryDto } from "../kiosk/kiosk.dto";
import { KioskRegistrationService } from "../kiosk/kiosk-registration.service";

/** Fewer than the sign-in routes allow: a person sends one pre-registration, a script sends many. */
const PRE_REGISTRATION_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * Pre-registration from MyHealth before a first visit (migration 0150, docs/domains/kiosk.md). Public: the person has no
 * account yet. Nothing here creates a patient, an account or access: the request waits, sealed, for reception, who check
 * the person's identification before registering them; MyHealth access then starts with the clinic's activation code.
 */
@ApiTags("portal")
@Public()
@Controller({ path: "portal/pre-registration", version: "1" })
export class PortalPreRegistrationController {
  constructor(private readonly registrations: KioskRegistrationService) {}

  @Get()
  @PlatformScope("MyHealth pre-registration: what the clinic offers")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Whether the clinic offers pre-registration, its privacy notice and the facilities to choose from (names only)" })
  info(@Query() query: PreRegistrationQueryDto) {
    return this.registrations.preRegistrationInfo(query.organizationCode);
  }

  @Post()
  @HttpCode(202)
  @PlatformScope("MyHealth pre-registration: a new request")
  @Throttle(PRE_REGISTRATION_THROTTLE)
  @ApiOperation({ summary: "Send a pre-registration for reception to review; the answer is always a reference and when it expires" })
  submit(@Body() body: PreRegistrationDto, @Req() request: Request) {
    return this.registrations.submitFromMyHealth(body, requestMetadataFrom(request));
  }
}
