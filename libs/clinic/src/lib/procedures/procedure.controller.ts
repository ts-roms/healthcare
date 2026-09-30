import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  CreateProcedureDefinitionDto,
  ProcedureDefinitionListQueryDto,
  ProcedureInErrorDto,
  RecordProcedureDto,
  UpdateProcedureDefinitionDto,
} from "./procedure.dto";
import { ClinicProcedureService } from "./procedure.service";

@ApiTags("clinic procedures")
@ApiBearerAuth()
@Controller({ version: "1" })
export class ClinicProcedureController {
  constructor(private readonly procedures: ClinicProcedureService) {}

  @Get("clinic/procedure-definitions")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "The organization's procedure catalogue (active entries; includeInactive=true for all)" })
  catalog(@CurrentActor() actor: Actor, @Query() query: ProcedureDefinitionListQueryDto) {
    return this.procedures.listDefinitions(actor, query.includeInactive === "true");
  }

  @Post("clinic/procedure-definitions")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Add a procedure to the organization's catalogue (its own code; no national code set is assumed)" })
  addDefinition(@CurrentActor() actor: Actor, @Body() body: CreateProcedureDefinitionDto) {
    return this.procedures.createDefinition(actor, body);
  }

  @Patch("clinic/procedure-definitions/:definitionId")
  @RequirePermissions("clinic.configure")
  updateDefinition(@CurrentActor() actor: Actor, @Param("definitionId", ParseUUIDPipe) id: string, @Body() body: UpdateProcedureDefinitionDto) {
    return this.procedures.updateDefinition(actor, id, body);
  }

  @Get("encounters/:encounterId/procedures")
  @RequirePermissions("encounter.read")
  forEncounter(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) encounterId: string) {
    return this.procedures.listForEncounter(actor, encounterId);
  }

  @Post("encounters/:encounterId/procedures")
  @RequirePermissions("encounter.write")
  @RequireFacility()
  @ApiOperation({ summary: "Record a procedure performed in an in-person consultation (a signed one needs encounter.amend and a reason)" })
  record(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) encounterId: string, @Body() body: RecordProcedureDto) {
    return this.procedures.record(actor, encounterId, body);
  }

  @Get("patients/:patientId/procedures")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Procedures performed on the patient at the clinic (records merged into it included; entries in error marked)" })
  forPatient(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.procedures.listForPatient(actor, patientId);
  }

  @Post("procedures/:procedureId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("encounter.write")
  @ApiOperation({ summary: "Mark a procedure entered in error with a reason (its charge, if not yet invoiced, is cancelled)" })
  enteredInError(@CurrentActor() actor: Actor, @Param("procedureId", ParseUUIDPipe) id: string, @Body() body: ProcedureInErrorDto) {
    return this.procedures.markEnteredInError(actor, id, body.reason);
  }
}
