import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { AccreditationDto, SubmitClaimDto } from "./philhealth.dto";
import { PhilHealthClaimsService } from "./philhealth-claims.service";
import { PhilHealthSettingsService, view } from "./philhealth-settings.service";

@ApiTags("philhealth")
@ApiBearerAuth()
@Controller({ path: "philhealth", version: "1" })
export class PhilHealthController {
  constructor(
    private readonly claims: PhilHealthClaimsService,
    private readonly settings: PhilHealthSettingsService,
  ) {}

  @Get("integration")
  @RequirePermissions("philhealth.claim.submit")
  @ApiOperation({ summary: "Status of the PhilHealth eClaims integration (an integration dependency until the official specification is obtained)" })
  integration() {
    return this.claims.integration();
  }

  @Get("facilities/:facilityId/accreditation")
  @RequirePermissions("philhealth.settings.manage")
  @ApiOperation({ summary: "The facility's recorded PhilHealth accreditation number" })
  async accreditation(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string) {
    const row = await this.settings.accreditation(actor.organizationId, facilityId);
    // Wrapped: a bare null would be an empty response body.
    return { accreditation: row ? view(row) : null };
  }

  @Put("facilities/:facilityId/accreditation")
  @RequirePermissions("philhealth.settings.manage")
  @ApiOperation({ summary: "Record the facility's PhilHealth accreditation number (as issued; not verified with PhilHealth)" })
  recordAccreditation(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string, @Body() body: AccreditationDto) {
    return this.settings.recordAccreditation(actor, facilityId, body);
  }

  @Get("claims/invoices/:invoiceId")
  @RequirePermissions("philhealth.claim.submit")
  @ApiOperation({ summary: "Prepare the PhilHealth claim of an issued invoice: readiness checks of the platform's data, the claim (PIN masked), submissions" })
  preview(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) invoiceId: string) {
    return this.claims.preview(actor, invoiceId);
  }

  @Post("claims/invoices/:invoiceId/submissions")
  @HttpCode(202)
  @RequirePermissions("philhealth.claim.submit")
  @ApiOperation({ summary: "Queue the claim for submission through the configured eClaims adapter (refused while the integration is a dependency)" })
  submit(@CurrentActor() actor: Actor, @Param("invoiceId", ParseUUIDPipe) invoiceId: string, @Body() body: SubmitClaimDto) {
    return this.claims.requestSubmission(actor, invoiceId, body.idempotencyKey);
  }
}
