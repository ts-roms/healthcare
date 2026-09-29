import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { MergePatientDto, MergePreviewQueryDto, UnmergePatientDto } from "./patient-merge.dto";
import { PatientMergeService } from "./patient-merge.service";

@ApiTags("patients")
@ApiBearerAuth()
@Controller({ path: "patients", version: "1" })
export class PatientMergeController {
  constructor(private readonly merges: PatientMergeService) {}

  @Get(":patientId/merge-preview")
  @RequirePermissions("patient.read", "patient.merge")
  @ApiOperation({ summary: "Compare this record (to retire) with the surviving record: flagged differences and work in progress that blocks a merge" })
  preview(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Query() query: MergePreviewQueryDto) {
    return this.merges.preview(actor, patientId, query.into);
  }

  @Post(":patientId/merge")
  @HttpCode(200)
  @RequirePermissions("patient.read", "patient.merge")
  @ApiOperation({ summary: "Merge this duplicate into the surviving record (link, don't move: nothing filed under it is rewritten)" })
  merge(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: MergePatientDto) {
    return this.merges.merge(actor, patientId, body);
  }

  @Post(":patientId/unmerge")
  @HttpCode(200)
  @RequirePermissions("patient.read", "patient.merge")
  @ApiOperation({ summary: "Undo the merge of this retired record (its previous status comes back; later records stay on the survivor)" })
  unmerge(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: UnmergePatientDto) {
    return this.merges.unmerge(actor, patientId, body);
  }

  @Get(":patientId/merges")
  @RequirePermissions("patient.read")
  @ApiOperation({ summary: "Merge history of this record (as the retired record and as the survivor)" })
  history(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.merges.history(actor, patientId);
  }
}
