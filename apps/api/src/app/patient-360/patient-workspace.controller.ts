import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { PatientWorkspaceService } from "./patient-workspace.service";

@ApiTags("patients")
@ApiBearerAuth()
@Controller({ path: "patients", version: "1" })
export class PatientWorkspaceController {
  constructor(private readonly workspace: PatientWorkspaceService) {}

  @Get(":patientId/workspace")
  @RequirePermissions("patient.read")
  @ApiOperation({
    summary:
      "Patient 360 workspace: consultations in progress and today's visit, recent consultations with diagnoses, critical results awaiting acknowledgement, open laboratory orders, dental images and documents. Panels the caller may not read are null and listed in `withheld`; allergies, problems, medications and care plans come from the summary.",
  })
  get(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.workspace.workspace(actor, patientId);
  }
}
