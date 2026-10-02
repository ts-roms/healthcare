import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, type StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, RequireFacility, RequirePermissions } from "@healthcare/core";
import {
  ConsentFormQueryDto,
  CreateProcedureDefinitionDto,
  ProcedureConsentDto,
  ProcedureDefinitionListQueryDto,
  ProcedureInErrorDto,
  ProcedureSupplyTemplateDto,
  PublishConsentWordingDto,
  RecordProcedureDto,
  RecordProcedureSuppliesDto,
  RecordVisitProcedureDto,
  ReturnProcedureSuppliesDto,
  UpdateProcedureDefinitionDto,
} from "./procedure.dto";
import { ProcedureSuppliesService } from "./procedure-supplies.service";
import { ClinicProcedureService } from "./procedure.service";

@ApiTags("clinic procedures")
@ApiBearerAuth()
@Controller({ version: "1" })
export class ClinicProcedureController {
  constructor(
    private readonly procedures: ClinicProcedureService,
    private readonly supplies: ProcedureSuppliesService,
  ) {}

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

  // ---- consent wording and forms (migration 0095) -----------------------------------------------------------------

  @Get("clinic/procedure-definitions/:definitionId/consent-wordings")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Every version of the organization's consent wording for a procedure, latest first" })
  consentWordings(@CurrentActor() actor: Actor, @Param("definitionId", ParseUUIDPipe) id: string) {
    return this.procedures.consentWordings(actor, id);
  }

  @Post("clinic/procedure-definitions/:definitionId/consent-wordings")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Publish the next version of the organization's own consent wording for a procedure (append-only; none is shipped)" })
  publishConsentWording(@CurrentActor() actor: Actor, @Param("definitionId", ParseUUIDPipe) id: string, @Body() body: PublishConsentWordingDto) {
    return this.procedures.publishConsentWording(actor, id, body);
  }

  @Get("clinic/procedure-definitions/:definitionId/consent-form.pdf")
  @RequirePermissions("encounter.read", "patient.read")
  @RequireFacility()
  @ApiOperation({ summary: "Printable consent form for a patient to sign: the current wording with its version and signature lines (audited; not stored)" })
  async consentForm(
    @CurrentActor() actor: Actor,
    @Param("definitionId", ParseUUIDPipe) id: string,
    @Query() query: ConsentFormQueryDto,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.procedures.consentFormPdf(actor, id, query.patientId);
    return pdfFile(pdf, filename);
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

  @Get("visits/:visitId/procedures")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Procedures recorded under a queue visit without a consultation" })
  forVisit(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) visitId: string) {
    return this.procedures.listForVisit(actor, visitId);
  }

  @Post("visits/:visitId/procedures")
  @RequirePermissions("procedure.record")
  @RequireFacility()
  @ApiOperation({
    summary: "Record a procedure performed under an open in-person queue visit without a consultation (catalogue entries the organization allows)",
  })
  recordForVisit(@CurrentActor() actor: Actor, @Param("visitId", ParseUUIDPipe) visitId: string, @Body() body: RecordVisitProcedureDto) {
    return this.procedures.recordForVisit(actor, visitId, body);
  }

  @Post("procedures/:procedureId/consent")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Record the consent obtained for a procedure recorded without one (once; needs encounter.write or procedure.record)" })
  addConsent(@CurrentActor() actor: Actor, @Param("procedureId", ParseUUIDPipe) id: string, @Body() body: ProcedureConsentDto) {
    return this.procedures.addConsent(actor, id, body);
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

  // ---- supplies used, from inventory (migration 0089) ----------------------------------------------------------

  @Get("clinic/procedure-supplies/options")
  @RequirePermissions("encounter.read")
  @ApiOperation({
    summary:
      "Supply templates per catalogue entry, active inventory items a procedure may use and, for the selected facility, stock locations and usable stock",
  })
  supplyOptions(@CurrentActor() actor: Actor) {
    return this.supplies.options(actor);
  }

  @Put("clinic/procedure-definitions/:definitionId/supplies")
  @RequirePermissions("clinic.configure")
  @ApiOperation({ summary: "Set the supplies a procedure usually uses (inventory items and quantities; staff confirm each time)" })
  setSupplyTemplate(@CurrentActor() actor: Actor, @Param("definitionId", ParseUUIDPipe) id: string, @Body() body: ProcedureSupplyTemplateDto) {
    return this.supplies.setTemplate(actor, id, body);
  }

  @Get("encounters/:encounterId/procedure-supplies")
  @RequirePermissions("encounter.read")
  @ApiOperation({ summary: "Supplies used by the consultation's procedures (issues and returns, with lots and what is still out)" })
  suppliesForEncounter(@CurrentActor() actor: Actor, @Param("encounterId", ParseUUIDPipe) encounterId: string) {
    return this.supplies.forEncounter(actor.organizationId, encounterId);
  }

  @Post("procedures/:procedureId/supplies")
  @RequireFacility()
  @RequirePermissions("encounter.write")
  @ApiOperation({
    summary: "Record the supplies a procedure used and issue them from stock (FEFO, never expired lots; all lines or nothing; idempotent by key)",
  })
  recordSupplies(@CurrentActor() actor: Actor, @Param("procedureId", ParseUUIDPipe) procedureId: string, @Body() body: RecordProcedureSuppliesDto) {
    return this.supplies.record(actor, procedureId, body);
  }

  @Post("procedures/:procedureId/supplies/returns")
  @RequireFacility()
  @RequirePermissions("encounter.write")
  @ApiOperation({ summary: "Return unused supplies of a procedure to the lots they were issued from (with a reason)" })
  returnSupplies(@CurrentActor() actor: Actor, @Param("procedureId", ParseUUIDPipe) procedureId: string, @Body() body: ReturnProcedureSuppliesDto) {
    return this.supplies.returnUnused(actor, procedureId, body);
  }
}
