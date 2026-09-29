import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { LabQualityService } from "./lab-quality.service";
import { LabReagentService } from "./lab-reagent.service";
import {
  AddQcTargetDto,
  CreateInstrumentDto,
  CreateQcLotDto,
  CreateQcMaterialDto,
  InstrumentEventDto,
  InstrumentQueryDto,
  LoadReagentDto,
  RecordReagentUseDto,
  ReagentUsageQueryDto,
  SetReagentYieldDto,
  SetTestsPerRunDto,
  QcActionDto,
  QcRunQueryDto,
  ReagentQueryDto,
  RecordQcRunDto,
  UnloadReagentDto,
  UpdateInstrumentDto,
} from "./quality.dto";

const uuid = new ParseUUIDPipe();

/** Laboratory quality management: instruments and their log, internal QC. */
@ApiTags("laboratory quality")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class LabQualityController {
  constructor(
    private readonly quality: LabQualityService,
    private readonly reagents: LabReagentService,
  ) {}

  // ---- Instruments ----------------------------------------------------------------------

  @Get("instruments")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Instruments at the selected facility, with last calibration and maintenance" })
  instruments(@CurrentActor() actor: Actor, @Query() query: InstrumentQueryDto) {
    return this.quality.listInstruments(actor, query.includeRetired === "true");
  }

  @Post("instruments")
  @RequireFacility()
  @RequirePermissions("lab.qc.manage")
  createInstrument(@CurrentActor() actor: Actor, @Body() body: CreateInstrumentDto) {
    return this.quality.createInstrument(actor, body);
  }

  @Patch("instruments/:id")
  @RequirePermissions("lab.qc.manage")
  updateInstrument(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateInstrumentDto) {
    return this.quality.updateInstrument(actor, id, body);
  }

  @Get("instruments/:id/log")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Maintenance, calibration, repair, verification and service status log, newest first" })
  instrumentLog(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.quality.instrumentLog(actor, id);
  }

  @Post("instruments/:id/log")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Record maintenance or calibration, or take the instrument out of / back into service (retiring needs lab.qc.manage)" })
  logInstrument(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: InstrumentEventDto) {
    return this.quality.recordInstrumentEvent(actor, id, body);
  }

  // ---- Reagent lots ----------------------------------------------------------------------

  @Get("reagents")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Reagent lots loaded on instruments at the selected facility (optionally one instrument)" })
  reagentsInUse(@CurrentActor() actor: Actor, @Query() query: ReagentQueryDto) {
    return this.reagents.inUse(actor, query.instrumentId);
  }

  @Get("reagents/available")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Unexpired reagent lots with stock at the selected facility (from inventory), to load on an instrument" })
  reagentsAvailable(@CurrentActor() actor: Actor) {
    return this.reagents.available(actor);
  }

  @Get("instruments/:id/reagents")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Every reagent lot loaded on the instrument, newest first" })
  reagentHistory(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.reagents.history(actor, id);
  }

  @Post("instruments/:id/reagents")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Load a reagent lot on the instrument (all tests or one); replaces the lot of the same reagent in use" })
  loadReagent(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: LoadReagentDto) {
    return this.reagents.load(actor, id, body);
  }

  @Post("reagents/:loadId/unload")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  unloadReagent(@CurrentActor() actor: Actor, @Param("loadId", uuid) loadId: string, @Body() body: UnloadReagentDto) {
    return this.reagents.unload(actor, loadId, body.reason);
  }

  // ---- Reagent use per test run -----------------------------------------------------------

  @Get("reagents/usage")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Reagent use at the selected facility over a period: loads in use, runs by kind, what is left, cost per patient run" })
  reagentUsage(@CurrentActor() actor: Actor, @Query() query: ReagentUsageQueryDto) {
    return this.reagents.usage(actor, query);
  }

  @Get("reagents/yields")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Tests per stock unit of each reagent (used for the capacity of new loads)" })
  reagentYields(@CurrentActor() actor: Actor) {
    return this.reagents.yields(actor);
  }

  @Put("reagents/yields/:itemId")
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Set how many tests one stock unit of a reagent holds" })
  setReagentYield(@CurrentActor() actor: Actor, @Param("itemId", uuid) itemId: string, @Body() body: SetReagentYieldDto) {
    return this.reagents.setYield(actor, itemId, body.testsPerUnit);
  }

  @Get("reagents/tests-per-run")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Tests one run of a test uses from a reagent, where more than 1 (duplicates, dilutions, blanks)" })
  reagentTestsPerRun(@CurrentActor() actor: Actor) {
    return this.reagents.testsPerRun(actor);
  }

  @Put("reagents/yields/:itemId/tests/:testId")
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Set how many tests one run of a test uses from a reagent (1 removes the setting)" })
  setReagentTestsPerRun(
    @CurrentActor() actor: Actor,
    @Param("itemId", uuid) itemId: string,
    @Param("testId", uuid) testId: string,
    @Body() body: SetTestsPerRunDto,
  ) {
    return this.reagents.setTestsPerRun(actor, itemId, testId, body.testsPerRun);
  }

  @Get("reagents/:loadId/uses")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Every run and recorded use counted against a loaded reagent lot, newest first" })
  reagentUses(@CurrentActor() actor: Actor, @Param("loadId", uuid) loadId: string) {
    return this.reagents.uses(actor, loadId);
  }

  @Post("reagents/:loadId/uses")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Record reagent use not entered as a result or QC run (repeat, calibration, priming, waste, other)" })
  recordReagentUse(@CurrentActor() actor: Actor, @Param("loadId", uuid) loadId: string, @Body() body: RecordReagentUseDto) {
    return this.reagents.recordUse(actor, loadId, body);
  }

  // ---- QC materials, lots, targets -------------------------------------------------------

  @Get("qc/materials")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Control materials with their lots and current targets" })
  materials(@CurrentActor() actor: Actor) {
    return this.quality.listMaterials(actor);
  }

  @Post("qc/materials")
  @RequirePermissions("lab.qc.manage")
  createMaterial(@CurrentActor() actor: Actor, @Body() body: CreateQcMaterialDto) {
    return this.quality.createMaterial(actor, body);
  }

  @Post("qc/materials/:id/lots")
  @RequirePermissions("lab.qc.manage")
  createLot(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CreateQcLotDto) {
    return this.quality.createLot(actor, id, body);
  }

  @Post("qc/lots/:id/retire")
  @HttpCode(200)
  @RequirePermissions("lab.qc.manage")
  retireLot(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.quality.retireLot(actor, id);
  }

  @Post("qc/lots/:id/targets")
  @RequirePermissions("lab.qc.manage")
  @ApiOperation({ summary: "Set the target mean and SD for a test on an instrument; the current target is closed, not rewritten" })
  addTarget(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: AddQcTargetDto) {
    return this.quality.addTarget(actor, id, body);
  }

  // ---- QC runs ---------------------------------------------------------------------------

  @Get("qc/status")
  @RequireFacility()
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "QC board: each test on each instrument, the latest run within the facility's QC window" })
  status(@CurrentActor() actor: Actor) {
    return this.quality.status(actor);
  }

  @Get("qc/runs")
  @RequirePermissions("lab.qc.read")
  @ApiOperation({ summary: "Runs of a test on an instrument (Levey-Jennings series), oldest first" })
  runs(@CurrentActor() actor: Actor, @Query() query: QcRunQueryDto) {
    return this.quality.listRuns(actor, query);
  }

  @Post("qc/runs")
  @RequireFacility()
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Record a control value; evaluated with the facility's Westgard rules (accepted, warning or rejected)" })
  recordRun(@CurrentActor() actor: Actor, @Body() body: RecordQcRunDto) {
    return this.quality.recordRun(actor, body);
  }

  @Post("qc/runs/:id/actions")
  @RequirePermissions("lab.qc.enter")
  @ApiOperation({ summary: "Record the cause and corrective action for a warning or rejected run" })
  addAction(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: QcActionDto) {
    return this.quality.addAction(actor, id, body.action);
  }
}
