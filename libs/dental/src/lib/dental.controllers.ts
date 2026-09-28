import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, BadRequestError, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { DentalCatalogService } from "./catalog/dental-catalog.service";
import { DentalChartService } from "./chart/dental-chart.service";
import {
  AddImageDto,
  AddPlanItemDto,
  CancelPlanItemDto,
  CreatePlanDto,
  CreateProcedureTypeDto,
  DecidePlanDto,
  DiscontinuePlanDto,
  EnteredInErrorDto,
  NotationDto,
  RecordExaminationDto,
  RecordPerioChartDto,
  RecordProcedureDto,
  UpdateProcedureTypeDto,
  VisitsQueryDto,
} from "./dental.dto";
import { isTooth } from "./dental.rules";
import { DentalRecordService } from "./dental-record.service";
import { DentalImagingService } from "./imaging/dental-imaging.service";
import { DentalPerioService } from "./periodontal/dental-perio.service";
import { DentalPlanService } from "./plans/dental-plan.service";
import { DentalProcedureService } from "./procedures/dental-procedure.service";

@ApiTags("dental")
@ApiBearerAuth()
@Controller({ path: "dental", version: "1" })
export class DentalRecordController {
  constructor(
    private readonly records: DentalRecordService,
    private readonly chart: DentalChartService,
    private readonly procedures: DentalProcedureService,
    private readonly imaging: DentalImagingService,
    private readonly perio: DentalPerioService,
  ) {}

  @Get("visits")
  @RequireFacility()
  @RequirePermissions("dental.record.read")
  @ApiOperation({ summary: "Dentists' encounters at the selected facility on a day (default today), with charting and procedure counts" })
  visits(@CurrentActor() actor: Actor, @Query() query: VisitsQueryDto) {
    return this.records.visits(actor, query.date);
  }

  @Get("patients/:patientId")
  @RequirePermissions("dental.record.read")
  @ApiOperation({ summary: "The patient's dental record: current chart, examinations, treatment plans, procedures and images (audited)" })
  record(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.records.record(actor, patientId);
  }

  @Get("patients/:patientId/teeth/:tooth")
  @RequirePermissions("dental.record.read")
  @ApiOperation({ summary: "Every charted state of one tooth, newest first (corrected records flagged)" })
  toothHistory(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Param("tooth") tooth: string) {
    if (!isTooth(tooth)) throw new BadRequestError("An FDI tooth code (11–48 permanent, 51–85 primary)", "invalid_tooth");
    return this.records.toothHistory(actor, patientId, tooth);
  }

  @Post("patients/:patientId/examinations")
  @RequireFacility()
  @RequirePermissions("dental.chart.write")
  @ApiOperation({ summary: "Record an examination during the patient's encounter, charting the examined teeth (a new chart state; nothing is overwritten)" })
  examine(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordExaminationDto) {
    return this.chart.recordExamination(actor, patientId, body);
  }

  @Post("examinations/:examinationId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("dental.record.write")
  examinationError(@CurrentActor() actor: Actor, @Param("examinationId", ParseUUIDPipe) id: string, @Body() body: EnteredInErrorDto) {
    return this.chart.markExaminationEnteredInError(actor, id, body.reason);
  }

  @Post("patients/:patientId/perio-charts")
  @RequireFacility()
  @RequirePermissions("dental.chart.write")
  @ApiOperation({ summary: "Record a periodontal chart during the patient's encounter (probing depths, gingival margin, bleeding, mobility, furcation)" })
  recordPerio(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordPerioChartDto) {
    return this.perio.record(actor, patientId, body);
  }

  @Get("perio-charts/:chartId")
  @RequirePermissions("dental.record.read")
  @ApiOperation({ summary: "A periodontal chart with its summary and the changes since the previous chart (audited)" })
  perioChart(@CurrentActor() actor: Actor, @Param("chartId", ParseUUIDPipe) chartId: string) {
    return this.perio.get(actor, chartId);
  }

  @Post("perio-charts/:chartId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("dental.record.write")
  perioError(@CurrentActor() actor: Actor, @Param("chartId", ParseUUIDPipe) chartId: string, @Body() body: EnteredInErrorDto) {
    return this.perio.markEnteredInError(actor, chartId, body.reason);
  }

  @Post("patients/:patientId/procedures")
  @RequireFacility()
  @RequirePermissions("dental.procedure.record")
  @ApiOperation({ summary: "Record a performed procedure during the patient's encounter (updates the chart, completes a plan item, is charged by billing)" })
  performProcedure(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordProcedureDto) {
    return this.procedures.record(actor, patientId, body);
  }

  @Post("procedures/:procedureId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("dental.record.write")
  procedureError(@CurrentActor() actor: Actor, @Param("procedureId", ParseUUIDPipe) id: string, @Body() body: EnteredInErrorDto) {
    return this.procedures.markEnteredInError(actor, id, body.reason);
  }

  @Post("patients/:patientId/images")
  @RequireFacility()
  @RequirePermissions("dental.imaging.upload")
  @ApiOperation({ summary: "Add an uploaded radiograph or photo (an imaging document of this patient) to the dental record" })
  addImage(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: AddImageDto) {
    return this.imaging.add(actor, patientId, body);
  }

  @Get("images/:imageId/link")
  @RequirePermissions("dental.imaging.read")
  @ApiOperation({ summary: "A short-lived signed link to open the image (audited)" })
  imageLink(@CurrentActor() actor: Actor, @Param("imageId", ParseUUIDPipe) id: string) {
    return this.imaging.link(actor, id);
  }

  @Post("images/:imageId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("dental.record.write")
  imageError(@CurrentActor() actor: Actor, @Param("imageId", ParseUUIDPipe) id: string, @Body() body: EnteredInErrorDto) {
    return this.imaging.markEnteredInError(actor, id, body.reason);
  }
}

@ApiTags("dental")
@ApiBearerAuth()
@Controller({ path: "dental/treatment-plans", version: "1" })
export class DentalPlanController {
  constructor(private readonly plans: DentalPlanService) {}

  @Post()
  @RequireFacility()
  @RequirePermissions("dental.treatment-plan.manage")
  @ApiOperation({ summary: "Propose a treatment plan (phased items: procedure, tooth, surfaces)" })
  create(@CurrentActor() actor: Actor, @Body() body: CreatePlanDto) {
    return this.plans.create(actor, body);
  }

  @Get(":planId")
  @RequirePermissions("dental.record.read")
  get(@CurrentActor() actor: Actor, @Param("planId", ParseUUIDPipe) id: string) {
    return this.plans.get(actor.organizationId, id);
  }

  @Post(":planId/items")
  @RequirePermissions("dental.treatment-plan.manage")
  addItem(@CurrentActor() actor: Actor, @Param("planId", ParseUUIDPipe) id: string, @Body() body: AddPlanItemDto) {
    return this.plans.addItem(actor, id, body);
  }

  @Post(":planId/decision")
  @HttpCode(200)
  @RequirePermissions("dental.treatment-plan.manage")
  @ApiOperation({ summary: "Record the patient's decision: listed items accepted, other items awaiting a decision declined" })
  decide(@CurrentActor() actor: Actor, @Param("planId", ParseUUIDPipe) id: string, @Body() body: DecidePlanDto) {
    return this.plans.decide(actor, id, body);
  }

  @Post(":planId/items/:itemId/cancel")
  @HttpCode(200)
  @RequirePermissions("dental.treatment-plan.manage")
  cancelItem(
    @CurrentActor() actor: Actor,
    @Param("planId", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() body: CancelPlanItemDto,
  ) {
    return this.plans.cancelItem(actor, id, itemId, body.version);
  }

  @Post(":planId/discontinue")
  @HttpCode(200)
  @RequirePermissions("dental.treatment-plan.manage")
  discontinue(@CurrentActor() actor: Actor, @Param("planId", ParseUUIDPipe) id: string, @Body() body: DiscontinuePlanDto) {
    return this.plans.discontinue(actor, id, body.reason, body.version);
  }
}

@ApiTags("dental")
@ApiBearerAuth()
@Controller({ path: "dental", version: "1" })
export class DentalSettingsController {
  constructor(private readonly catalog: DentalCatalogService) {}

  @Get("settings")
  @RequirePermissions("dental.record.read")
  @ApiOperation({ summary: "The selected facility's tooth notation and the procedure catalog" })
  async settings(@CurrentActor() actor: Actor) {
    const [notation, procedureTypes] = await Promise.all([
      this.catalog.notation(actor.organizationId, actor.facilityId),
      this.catalog.procedureTypes(actor.organizationId),
    ]);
    return { notation, procedureTypes };
  }

  @Put("facilities/:facilityId/notation")
  @RequirePermissions("dental.settings.manage")
  setNotation(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string, @Body() body: NotationDto) {
    return this.catalog.setNotation(actor, facilityId, body.notation);
  }

  @Post("procedure-types")
  @RequirePermissions("dental.settings.manage")
  @ApiOperation({ summary: "Add a procedure to the organization's dental catalog (its own codes)" })
  createProcedureType(@CurrentActor() actor: Actor, @Body() body: CreateProcedureTypeDto) {
    return this.catalog.createProcedureType(actor, body);
  }

  @Patch("procedure-types/:procedureTypeId")
  @RequirePermissions("dental.settings.manage")
  updateProcedureType(@CurrentActor() actor: Actor, @Param("procedureTypeId", ParseUUIDPipe) id: string, @Body() body: UpdateProcedureTypeDto) {
    return this.catalog.updateProcedureType(actor, id, body);
  }
}
