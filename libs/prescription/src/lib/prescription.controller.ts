import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { CancelPrescriptionDto, IssuePrescriptionDto, ListPrescriptionsDto, ReplacePrescriptionDto } from "./prescription.dto";
import { PrescriptionService } from "./prescription.service";

@ApiTags("prescriptions")
@ApiBearerAuth()
@Controller({ path: "prescriptions", version: "1" })
export class PrescriptionController {
  constructor(private readonly prescriptions: PrescriptionService) {}

  @Post()
  @RequirePermissions("prescription.issue")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiOperation({ summary: "Issue a prescription within an open encounter (409 allergy_warning = decision support; review and override with a reason)" })
  issue(@CurrentActor() actor: Actor, @Body() body: IssuePrescriptionDto) {
    return this.prescriptions.issue(actor, body);
  }

  @Get()
  @RequirePermissions("prescription.read")
  list(@CurrentActor() actor: Actor, @Query() query: ListPrescriptionsDto) {
    return this.prescriptions.list(actor, { ...query, activeOnly: query.activeOnly === "true" });
  }

  @Get(":prescriptionId")
  @RequirePermissions("prescription.read")
  get(@CurrentActor() actor: Actor, @Param("prescriptionId", ParseUUIDPipe) id: string) {
    return this.prescriptions.get(actor, id);
  }

  @Post(":prescriptionId/replace")
  @RequirePermissions("prescription.issue")
  @ApiOperation({ summary: "Correct a prescription: supersedes it and issues a new one" })
  replace(@CurrentActor() actor: Actor, @Param("prescriptionId", ParseUUIDPipe) id: string, @Body() body: ReplacePrescriptionDto) {
    return this.prescriptions.replace(actor, id, body);
  }

  @Post(":prescriptionId/cancel")
  @HttpCode(200)
  @RequirePermissions("prescription.cancel")
  cancel(@CurrentActor() actor: Actor, @Param("prescriptionId", ParseUUIDPipe) id: string, @Body() body: CancelPrescriptionDto) {
    return this.prescriptions.cancel(actor, id, body);
  }
}
