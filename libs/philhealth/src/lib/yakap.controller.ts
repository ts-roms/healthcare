import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { ListYakapRegistrationsDto, RecordYakapRegistrationDto, SubmitYakapDto, YakapParticipationDto } from "./yakap.dto";
import { participationView, PhilHealthYakapService } from "./yakap.service";

/**
 * PhilHealth YAKAP adapter stubs (docs/interoperability/philhealth-yakap.md). Existing permissions: the facility's
 * participation reference is a PhilHealth setting, registration answers are recorded like eligibility answers, and the
 * encounter package is prepared and submitted by those who prepare PhilHealth claims.
 */
@ApiTags("philhealth")
@ApiBearerAuth()
@Controller({ path: "philhealth", version: "1" })
export class PhilHealthYakapController {
  constructor(private readonly yakap: PhilHealthYakapService) {}

  @Get("facilities/:facilityId/yakap-participation")
  @RequirePermissions("philhealth.settings.manage")
  @ApiOperation({ summary: "The facility's recorded PhilHealth YAKAP participation reference" })
  async participation(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string) {
    const row = await this.yakap.participation(actor.organizationId, facilityId);
    // Wrapped: a bare null would be an empty response body.
    return { participation: row ? participationView(row) : null };
  }

  @Put("facilities/:facilityId/yakap-participation")
  @RequirePermissions("philhealth.settings.manage")
  @ApiOperation({ summary: "Record the facility's YAKAP participation reference (as issued by PhilHealth; not verified)" })
  recordParticipation(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string, @Body() body: YakapParticipationDto) {
    return this.yakap.recordParticipation(actor, facilityId, body);
  }

  @Get("yakap/registrations")
  @RequirePermissions("philhealth.eligibility.manage")
  @ApiOperation({ summary: "PhilHealth's recorded answers about a patient's YAKAP registration (newest first)" })
  registrations(@CurrentActor() actor: Actor, @Query() query: ListYakapRegistrationsDto) {
    return this.yakap.registrations(actor, query.patientId);
  }

  @Post("yakap/registrations")
  @RequirePermissions("philhealth.eligibility.manage")
  @ApiOperation({ summary: "Record what PhilHealth's own channel answered about the patient's YAKAP registration (never changed afterwards)" })
  recordRegistration(@CurrentActor() actor: Actor, @Body() body: RecordYakapRegistrationDto) {
    return this.yakap.recordRegistration(actor, body);
  }

  @Get("yakap/patients/:patientId/consultations")
  @RequirePermissions("philhealth.claim.submit")
  @ApiOperation({ summary: "The patient's consultations with their latest YAKAP submission" })
  consultations(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.yakap.consultations(actor, patientId);
  }

  @Get("yakap/encounters/:encounterId")
  @RequirePermissions("philhealth.claim.submit")
  @ApiOperation({ summary: "Prepare a consultation's YAKAP encounter package: readiness checks of the platform's data, the package (PIN masked), submissions" })
  preview(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) encounterId: string) {
    return this.yakap.preview(actor, encounterId);
  }

  @Post("yakap/encounters/:encounterId/submissions")
  @HttpCode(202)
  @RequirePermissions("philhealth.claim.submit")
  @ApiOperation({ summary: "Queue the package for the configured YAKAP adapter (refused while the integration is a dependency)" })
  submit(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) encounterId: string, @Body() body: SubmitYakapDto) {
    return this.yakap.requestSubmission(actor, encounterId, body.idempotencyKey);
  }
}
