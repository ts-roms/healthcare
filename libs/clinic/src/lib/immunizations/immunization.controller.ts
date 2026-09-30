import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  CreateVaccineDto,
  ImmunizationInErrorDto,
  ImmunizationReactionDto,
  RecordAdministeredDto,
  RecordHistoricalDto,
  UpdateVaccineDto,
  VaccineListQueryDto,
} from "./immunization.dto";
import { ImmunizationService } from "./immunization.service";

@ApiTags("immunizations")
@ApiBearerAuth()
@Controller({ version: "1" })
export class ImmunizationController {
  constructor(private readonly immunizations: ImmunizationService) {}

  @Get("immunizations/catalog")
  @RequirePermissions("immunization.read")
  @ApiOperation({ summary: "The organization's vaccine catalogue (active vaccines; includeInactive=true for all)" })
  catalog(@CurrentActor() actor: Actor, @Query() query: VaccineListQueryDto) {
    return this.immunizations.listVaccines(actor, query.includeInactive === "true");
  }

  @Post("immunizations/catalog")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Add a vaccine to the organization's catalogue (no national list or schedule is assumed)" })
  addVaccine(@CurrentActor() actor: Actor, @Body() body: CreateVaccineDto) {
    return this.immunizations.createVaccine(actor, body);
  }

  @Patch("immunizations/catalog/:vaccineId")
  @RequirePermissions("clinic.configure")
  updateVaccine(@CurrentActor() actor: Actor, @Param("vaccineId", ParseUUIDPipe) id: string, @Body() body: UpdateVaccineDto) {
    return this.immunizations.updateVaccine(actor, id, body);
  }

  @Get("immunizations/stock")
  @RequirePermissions("immunization.record")
  @RequireFacility()
  @ApiOperation({ summary: "Vaccine lots in stock at the selected facility, to take a dose from" })
  stock(@CurrentActor() actor: Actor) {
    return this.immunizations.vaccineStock(actor);
  }

  @Get("patients/:patientId/immunizations")
  @RequirePermissions("immunization.read")
  @ApiOperation({ summary: "The patient's immunization history (records merged into it included; entries in error marked)" })
  list(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.immunizations.list(actor, patientId);
  }

  @Post("patients/:patientId/immunizations")
  @RequirePermissions("immunization.record")
  @RequireFacility()
  @ApiOperation({ summary: "Record a dose given (or not given, with the reason) at the selected facility, optionally from stock" })
  recordAdministered(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordAdministeredDto) {
    return this.immunizations.recordAdministered(actor, patientId, body);
  }

  @Post("patients/:patientId/immunizations/historical")
  @RequirePermissions("immunization.record")
  @ApiOperation({ summary: "Record a dose reported by the patient or another provider (a year, month or day)" })
  recordHistorical(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordHistoricalDto) {
    return this.immunizations.recordHistorical(actor, patientId, body);
  }

  @Get("encounters/:encounterId/immunizations")
  @RequirePermissions("immunization.read")
  forEncounter(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) encounterId: string) {
    return this.immunizations.listForEncounter(actor, encounterId);
  }

  @Post("immunizations/:immunizationId/reaction")
  @HttpCode(200)
  @RequirePermissions("immunization.record")
  @ApiOperation({ summary: "Add a reaction noticed after the dose (once). Record an allergy separately if appropriate." })
  reaction(@CurrentActor() actor: Actor, @Param("immunizationId", ParseUUIDPipe) id: string, @Body() body: ImmunizationReactionDto) {
    return this.immunizations.addReaction(actor, id, body.adverseReaction);
  }

  @Post("immunizations/:immunizationId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("immunization.record")
  @ApiOperation({ summary: "Mark a record entered in error with a reason (stock taken for it goes back once)" })
  enteredInError(@CurrentActor() actor: Actor, @Param("immunizationId", ParseUUIDPipe) id: string, @Body() body: ImmunizationInErrorDto) {
    return this.immunizations.markEnteredInError(actor, id, body.reason);
  }
}
