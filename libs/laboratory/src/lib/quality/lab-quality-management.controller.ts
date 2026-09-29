import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { LabCompetencyService } from "./lab-competency.service";
import { LabEqaService } from "./lab-eqa.service";
import { LabNonconformanceService } from "./lab-nonconformance.service";
import { LabQualitySummaryService } from "./lab-quality-summary.service";
import { LabTemperatureService } from "./lab-temperature.service";
import {
  CloseNonconformanceDto,
  CreateEqaSchemeDto,
  CreateEqaSurveyDto,
  CreateNonconformanceDto,
  CreateStorageUnitDto,
  EqaEvaluationDto,
  NonconformanceEntryDto,
  NonconformanceQueryDto,
  ReadingQueryDto,
  ReclassifyDto,
  RecordCompetencyDto,
  RecordReadingDto,
  ReportEqaResultDto,
  StorageUnitQueryDto,
  UpdateStorageUnitDto,
} from "./quality-management.dto";

const uuid = new ParseUUIDPipe();

/** Laboratory quality management: temperature monitoring, nonconformance and CAPA, EQA, staff competency. */
@ApiTags("laboratory quality")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class LabQualityManagementController {
  constructor(
    private readonly temperatures: LabTemperatureService,
    private readonly nonconformances: LabNonconformanceService,
    private readonly eqa: LabEqaService,
    private readonly competency: LabCompetencyService,
    private readonly summaries: LabQualitySummaryService,
  ) {}

  @Get("quality/summary")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "What needs attention in the laboratory's quality system at the selected facility (counts)" })
  summary(@CurrentActor() actor: Actor) {
    return this.summaries.summary(actor);
  }

  // ---- Temperature monitoring ------------------------------------------------------------

  @Get("storage-units")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Storage units at the selected facility with their last reading, whether one is due, and recent excursions" })
  storageUnits(@CurrentActor() actor: Actor, @Query() query: StorageUnitQueryDto) {
    return this.temperatures.units(actor, query.includeRetired === "true");
  }

  @Post("storage-units")
  @RequireFacility()
  @RequirePermissions("lab.qc.manage")
  createStorageUnit(@CurrentActor() actor: Actor, @Body() body: CreateStorageUnitDto) {
    return this.temperatures.createUnit(actor, body);
  }

  @Patch("storage-units/:id")
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Change a unit's range, interval or status (reason required; readings keep the range they were read against)" })
  updateStorageUnit(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateStorageUnitDto) {
    return this.temperatures.updateUnit(actor, id, body);
  }

  @Get("storage-units/:id/readings")
  @RequirePermissions("lab.qc.read")
  readings(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Query() query: ReadingQueryDto) {
    return this.temperatures.readings(actor, id, query.days);
  }

  @Post("storage-units/:id/readings")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Record a reading; outside the range it needs a note and opens a nonconformance" })
  recordReading(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: RecordReadingDto) {
    return this.temperatures.record(actor, id, body);
  }

  // ---- Nonconformance ----------------------------------------------------------------------

  @Get("nonconformances")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  nonconformanceList(@CurrentActor() actor: Actor, @Query() query: NonconformanceQueryDto) {
    return this.nonconformances.list(actor, query.status);
  }

  @Get("nonconformances/:id")
  @RequirePermissions("lab.qc.read")
  nonconformance(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.nonconformances.get(actor, id);
  }

  @Post("nonconformances")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Report a nonconformance (incident) at the selected facility" })
  reportNonconformance(@CurrentActor() actor: Actor, @Body() body: CreateNonconformanceDto) {
    return this.nonconformances.create(actor, body);
  }

  @Post("nonconformances/:id/entries")
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Add to the investigation trail: note, correction, root cause, corrective or preventive action, effectiveness check" })
  addNonconformanceEntry(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: NonconformanceEntryDto) {
    return this.nonconformances.addEntry(actor, id, body);
  }

  @Post("nonconformances/:id/reclassify")
  @HttpCode(200)
  @RequirePermissions("lab.qc.manage")
  reclassify(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: ReclassifyDto) {
    return this.nonconformances.reclassify(actor, id, body);
  }

  @Post("nonconformances/:id/close")
  @HttpCode(200)
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Close once root cause, corrective action and effectiveness check are recorded" })
  closeNonconformance(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CloseNonconformanceDto) {
    return this.nonconformances.close(actor, id, body.summary, body.version);
  }

  // ---- EQA ---------------------------------------------------------------------------------

  @Get("eqa/schemes")
  @RequirePermissions("lab.qc.read")
  eqaSchemes(@CurrentActor() actor: Actor) {
    return this.eqa.schemes(actor);
  }

  @Post("eqa/schemes")
  @RequirePermissions("lab.qc.manage")
  createEqaScheme(@CurrentActor() actor: Actor, @Body() body: CreateEqaSchemeDto) {
    return this.eqa.createScheme(actor, body);
  }

  @Get("eqa/surveys")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "EQA rounds at the selected facility with reported results and the provider's evaluations" })
  eqaSurveys(@CurrentActor() actor: Actor) {
    return this.eqa.surveys(actor);
  }

  @Post("eqa/surveys")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  createEqaSurvey(@CurrentActor() actor: Actor, @Body() body: CreateEqaSurveyDto) {
    return this.eqa.createSurvey(actor, body);
  }

  @Post("eqa/surveys/:id/results")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  reportEqaResult(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: ReportEqaResultDto) {
    return this.eqa.report(actor, id, body);
  }

  @Post("eqa/results/:id/evaluation")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Record the provider's evaluation (once); an unacceptable result opens a nonconformance" })
  evaluateEqaResult(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: EqaEvaluationDto) {
    return this.eqa.evaluate(actor, id, body);
  }

  // ---- Competency ------------------------------------------------------------------------

  @Get("competency")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Result-entering staff at the selected facility with their latest assessment per test or department" })
  competencyOverview(@CurrentActor() actor: Actor) {
    return this.competency.overview(actor);
  }

  @Get("competency/users/:userId")
  @RequirePermissions("lab.qc.read")
  competencyHistory(@CurrentActor() actor: Actor, @Param("userId", uuid) userId: string) {
    return this.competency.history(actor, userId);
  }

  @Post("competency")
  @RequireFacility()
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Record a competency assessment (not of oneself)" })
  recordCompetency(@CurrentActor() actor: Actor, @Body() body: RecordCompetencyDto) {
    return this.competency.record(actor, body);
  }
}
