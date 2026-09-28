import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { EnteredInErrorDto } from "../clinic.dto";
import { ExternalRecordsService } from "./external-records.service";

@ApiTags("clinical records")
@ApiBearerAuth()
@Controller({ version: "1" })
export class ExternalHistoryController {
  constructor(private readonly external: ExternalRecordsService) {}

  @Get("patients/:patientId/external-history")
  @RequirePermissions("clinical.read")
  @ApiOperation({ summary: "External clinical history accepted from imports (conditions, observations, medications, documents), labelled as external" })
  list(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.external.list(actor, patientId);
  }

  @Post("patients/:patientId/external-history/:entryId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("interop.fhir.import.review")
  @ApiOperation({ summary: "Mark an accepted external history entry entered in error (e.g. accepted for the wrong patient), with a reason" })
  enteredInError(
    @CurrentActor() actor: Actor,
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
    @Body() body: EnteredInErrorDto,
  ) {
    return this.external.markEnteredInError(actor, patientId, entryId, body.reason);
  }
}
