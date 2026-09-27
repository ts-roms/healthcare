import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, pdfFile, RequireFacility, requireFacilityId, RequirePermissions } from "@healthcare/core";
import { LabCatalogService } from "./catalog/lab-catalog.service";
import {
  AddReferenceRangeDto,
  CancelDto,
  CatalogQueryDto,
  CollectSpecimenDto,
  CommunicateCriticalDto,
  CorrectResultDto,
  CreateDepartmentDto,
  CreateOrderDto,
  CreatePanelDto,
  CreateSpecimenTypeDto,
  CreateTestDto,
  CriticalQueryDto,
  EnterResultDto,
  FacilityPolicyDto,
  LabelQueryDto,
  ListOrdersDto,
  RejectSpecimenDto,
  TrendQueryDto,
  UpdateCatalogEntryDto,
  UpdateTestDto,
  WorklistDto,
} from "./laboratory.dto";
import { LabLabelService } from "./orders/lab-labels";
import { LabOrderService } from "./orders/lab-order.service";
import { LabWorklistService } from "./orders/lab-worklist.service";
import { LabReportService } from "./results/lab-report";
import { LabReportArchive } from "./results/lab-report-archive";
import { LabResultService } from "./results/lab-result.service";

const uuid = new ParseUUIDPipe();

@ApiTags("laboratory")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class LabCatalogController {
  constructor(private readonly catalog: LabCatalogService) {}

  @Get("departments")
  @RequirePermissions("lab.order.read")
  departments(@CurrentActor() actor: Actor, @Query() query: CatalogQueryDto) {
    return this.catalog.listDepartments(actor.organizationId, query.includeInactive === "true");
  }

  @Post("departments")
  @RequirePermissions("lab.catalog.manage")
  createDepartment(@CurrentActor() actor: Actor, @Body() body: CreateDepartmentDto) {
    return this.catalog.createDepartment(actor, body);
  }

  @Patch("departments/:id")
  @RequirePermissions("lab.catalog.manage")
  updateDepartment(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateCatalogEntryDto) {
    return this.catalog.updateDepartment(actor, id, body);
  }

  @Get("specimen-types")
  @RequirePermissions("lab.order.read")
  specimenTypes(@CurrentActor() actor: Actor, @Query() query: CatalogQueryDto) {
    return this.catalog.listSpecimenTypes(actor.organizationId, query.includeInactive === "true");
  }

  @Post("specimen-types")
  @RequirePermissions("lab.catalog.manage")
  createSpecimenType(@CurrentActor() actor: Actor, @Body() body: CreateSpecimenTypeDto) {
    return this.catalog.createSpecimenType(actor, body);
  }

  @Patch("specimen-types/:id")
  @RequirePermissions("lab.catalog.manage")
  updateSpecimenType(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateCatalogEntryDto) {
    return this.catalog.updateSpecimenType(actor, id, body);
  }

  @Get("tests")
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "The test catalog with each test's current reference ranges" })
  tests(@CurrentActor() actor: Actor, @Query() query: CatalogQueryDto) {
    return this.catalog.listTests(actor.organizationId, query.includeInactive === "true");
  }

  @Get("tests/:id")
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "One test with its full reference-range history" })
  test(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.catalog.getTest(actor.organizationId, id);
  }

  @Post("tests")
  @RequirePermissions("lab.catalog.manage")
  createTest(@CurrentActor() actor: Actor, @Body() body: CreateTestDto) {
    return this.catalog.createTest(actor, body);
  }

  @Patch("tests/:id")
  @RequirePermissions("lab.catalog.manage")
  updateTest(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateTestDto) {
    return this.catalog.updateTest(actor, id, body);
  }

  @Post("tests/:id/reference-ranges")
  @RequirePermissions("lab.catalog.manage")
  @ApiOperation({ summary: "Add a reference range; an open range for the same sex and ages is closed (history is kept)" })
  addRange(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: AddReferenceRangeDto) {
    return this.catalog.addReferenceRange(actor, id, body);
  }

  @Get("panels")
  @RequirePermissions("lab.order.read")
  panels(@CurrentActor() actor: Actor, @Query() query: CatalogQueryDto) {
    return this.catalog.listPanels(actor.organizationId, query.includeInactive === "true");
  }

  @Post("panels")
  @RequirePermissions("lab.catalog.manage")
  createPanel(@CurrentActor() actor: Actor, @Body() body: CreatePanelDto) {
    return this.catalog.createPanel(actor, body);
  }

  @Patch("panels/:id")
  @RequirePermissions("lab.catalog.manage")
  updatePanel(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: UpdateCatalogEntryDto) {
    return this.catalog.updatePanel(actor, id, body);
  }

  @Get("policy")
  @RequireFacility()
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "The selected facility's laboratory policy (separation of duties, release on approval)" })
  policy(@CurrentActor() actor: Actor) {
    return this.catalog.getPolicy(actor, requireFacilityId(actor));
  }

  @Put("policy")
  @RequireFacility()
  @RequirePermissions("lab.catalog.manage")
  @ApiOperation({ summary: "Change the selected facility's laboratory policy (audited, reason required)" })
  setPolicy(@CurrentActor() actor: Actor, @Body() body: FacilityPolicyDto) {
    return this.catalog.setPolicy(actor, requireFacilityId(actor), body);
  }
}

@ApiTags("laboratory")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class LabOrderController {
  constructor(
    private readonly orders: LabOrderService,
    private readonly worklists: LabWorklistService,
    private readonly labels: LabLabelService,
  ) {}

  @Post("orders")
  @RequireFacility()
  @RequirePermissions("lab.order.create")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiOperation({ summary: "Order tests and panels (from an open encounter, or at the laboratory for external and patient requests)" })
  create(@CurrentActor() actor: Actor, @Body() body: CreateOrderDto) {
    return this.orders.create(actor, body);
  }

  @Get("orders")
  @RequirePermissions("lab.order.read")
  list(@CurrentActor() actor: Actor, @Query() query: ListOrdersDto) {
    return this.orders.list(actor, query);
  }

  @Get("orders/:id")
  @RequirePermissions("lab.order.read")
  get(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.orders.get(actor, id);
  }

  @Post("orders/:id/cancel")
  @HttpCode(200)
  @RequirePermissions("lab.order.cancel")
  cancel(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CancelDto) {
    return this.orders.cancel(actor, id, body.reason);
  }

  @Post("orders/:id/items/:itemId/cancel")
  @HttpCode(200)
  @RequirePermissions("lab.order.cancel")
  cancelItem(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Param("itemId", uuid) itemId: string, @Body() body: CancelDto) {
    return this.orders.cancelItem(actor, id, itemId, body.reason);
  }

  @Post("orders/:id/specimens")
  @RequireFacility()
  @RequirePermissions("lab.specimen.collect")
  @ApiHeader({ name: "Idempotency-Key", required: false })
  @ApiOperation({ summary: "Collect a specimen for some of the order's tests; assigns the accession number (barcode)" })
  collect(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CollectSpecimenDto) {
    return this.orders.collect(actor, id, body);
  }

  @Get("specimens/by-accession/:accession")
  @RequireFacility()
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "Barcode lookup at the selected facility" })
  byAccession(@CurrentActor() actor: Actor, @Param("accession") accession: string) {
    return this.orders.byAccession(actor, accession.trim());
  }

  @Get("specimens/:id/label.pdf")
  @RequireFacility()
  @RequirePermissions("lab.specimen.collect")
  @ApiOperation({ summary: "Tube label(s) for a specimen: Code 128 barcode of the accession number, minimal identification (audited)" })
  async label(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Query() query: LabelQueryDto): Promise<StreamableFile> {
    const { filename, pdf } = await this.labels.specimenLabels(actor, id, query.copies);
    return pdfFile(pdf, filename);
  }

  @Get("specimens/:id/events")
  @RequirePermissions("lab.order.read")
  specimenEvents(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.orders.specimenEvents(actor, id);
  }

  @Post("specimens/:id/receive")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.specimen.receive")
  receive(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.orders.receive(actor, id);
  }

  @Post("specimens/:id/reject")
  @HttpCode(200)
  @RequirePermissions("lab.specimen.reject")
  reject(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: RejectSpecimenDto) {
    return this.orders.reject(actor, id, body);
  }

  @Get("worklist")
  @RequireFacility()
  @RequirePermissions("lab.order.read")
  @ApiOperation({ summary: "Work waiting at one stage (collect, receive, enter, verify, approve, release), STAT first" })
  worklist(@CurrentActor() actor: Actor, @Query() query: WorklistDto) {
    return this.worklists.worklist(actor, query.stage, query.departmentId);
  }

  @Get("dashboard")
  @RequireFacility()
  @RequirePermissions("lab.dashboard.read")
  dashboard(@CurrentActor() actor: Actor) {
    return this.worklists.dashboard(actor);
  }
}

@ApiTags("laboratory")
@ApiBearerAuth()
@Controller({ path: "laboratory", version: "1" })
export class LabResultController {
  constructor(
    private readonly results: LabResultService,
    private readonly reports: LabReportService,
    private readonly archive: LabReportArchive,
  ) {}

  @Post("order-items/:itemId/results")
  @RequireFacility()
  @RequirePermissions("lab.result.enter")
  @ApiOperation({ summary: "Enter the result of a received test; flags against the reference range snapshotted now" })
  enter(@CurrentActor() actor: Actor, @Param("itemId", uuid) itemId: string, @Body() body: EnterResultDto) {
    return this.results.enter(actor, itemId, body);
  }

  @Get("order-items/:itemId/results")
  @RequirePermissions("lab.result.read")
  @ApiOperation({ summary: "Every version of the test's result, newest first (outside the laboratory: released versions only)" })
  history(@CurrentActor() actor: Actor, @Param("itemId", uuid) itemId: string) {
    return this.results.history(actor, itemId);
  }

  @Post("results/:id/verify")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.verify")
  verify(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.results.verify(actor, id);
  }

  @Post("results/:id/approve")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.approve")
  approve(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.results.approve(actor, id);
  }

  @Post("results/:id/release")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.release")
  release(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.results.release(actor, id);
  }

  @Post("orders/:id/release")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.release")
  @ApiOperation({ summary: "Release every approved result of an order" })
  releaseOrder(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.results.releaseOrder(actor, id);
  }

  @Post("results/:id/correct")
  @RequireFacility()
  // The service requires lab.result.enter (unreleased) or lab.result.amend (released).
  @RequirePermissions("lab.result.read")
  @ApiOperation({ summary: "Correct a result: adds a new version and supersedes this one (needs lab.result.enter; released results need lab.result.amend)" })
  correct(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CorrectResultDto) {
    return this.results.correct(actor, id, body);
  }

  @Post("results/:id/cancel")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("lab.result.enter")
  cancel(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CancelDto) {
    return this.results.cancel(actor, id, body.reason);
  }

  @Get("orders/:id/report.pdf")
  @RequirePermissions("lab.order.read", "lab.result.read")
  @ApiOperation({ summary: "Printable result report of an order (released results only; audited)" })
  async report(@CurrentActor() actor: Actor, @Param("id", uuid) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.reports.staffReport(actor, id);
    return pdfFile(pdf, filename);
  }

  @Get("patients/:patientId/report-archive")
  @RequirePermissions("lab.order.read", "lab.result.read")
  @ApiOperation({ summary: "The patient's archived laboratory reports (one per order and set of released result versions), newest first" })
  archivedReports(@CurrentActor() actor: Actor, @Param("patientId", uuid) patientId: string) {
    return this.archive.listForPatient(actor, patientId);
  }

  @Get("report-archive/:id/report.pdf")
  @RequirePermissions("lab.order.read", "lab.result.read")
  @ApiOperation({ summary: "The stored PDF of an archived laboratory report, exactly as archived (audited)" })
  async archivedReport(@CurrentActor() actor: Actor, @Param("id", uuid) id: string): Promise<StreamableFile> {
    const { filename, pdf } = await this.archive.download(actor, id);
    return pdfFile(pdf, filename);
  }

  @Get("patients/:patientId/results")
  @RequirePermissions("lab.result.read")
  @ApiOperation({ summary: "The patient's released results, newest first" })
  patientResults(@CurrentActor() actor: Actor, @Param("patientId", uuid) patientId: string) {
    return this.results.patientResults(actor, patientId);
  }

  @Get("patients/:patientId/trends")
  @RequirePermissions("lab.result.read")
  @ApiOperation({ summary: "Released values of one analyte over time, with the reference range each was read against (display aid)" })
  trend(@CurrentActor() actor: Actor, @Param("patientId", uuid) patientId: string, @Query() query: TrendQueryDto) {
    return this.results.trend(actor, patientId, query.testId);
  }

  @Get("critical-results")
  @RequireFacility()
  @RequirePermissions("lab.result.read")
  criticals(@CurrentActor() actor: Actor, @Query() query: CriticalQueryDto) {
    return this.results.criticalAlerts(actor, query.status);
  }

  @Post("critical-results/:id/communicate")
  @HttpCode(200)
  @RequirePermissions("lab.critical.manage")
  @ApiOperation({ summary: "Document who was told about a critical result, how, and whether they read it back" })
  communicate(@CurrentActor() actor: Actor, @Param("id", uuid) id: string, @Body() body: CommunicateCriticalDto) {
    return this.results.communicateCritical(actor, id, body);
  }

  @Post("critical-results/:id/acknowledge")
  @HttpCode(200)
  @RequirePermissions("lab.result.read")
  acknowledge(@CurrentActor() actor: Actor, @Param("id", uuid) id: string) {
    return this.results.acknowledgeCritical(actor, id);
  }
}
