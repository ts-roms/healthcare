import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { CreateRuleDto, DismissDto, FacilityCodeDto, ListCasesDto, RecordExternalDto, SubmitCaseDto } from "./doh.dto";
import { DohReportsService } from "./doh-reports.service";
import { DohSettingsService, strip } from "./doh-settings.service";

@ApiTags("doh")
@ApiBearerAuth()
@Controller({ path: "doh", version: "1" })
export class DohController {
  constructor(
    private readonly reports: DohReportsService,
    private readonly settings: DohSettingsService,
  ) {}

  @Get("integration")
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "Status of the DOH reporting integration (an integration dependency until the official specification is obtained)" })
  integration() {
    return this.reports.integration();
  }

  @Get("rules")
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "The organization's reportable-condition rules (ICD-10 code prefixes it configured)" })
  async rules(@CurrentActor() actor: Actor) {
    return (await this.settings.rules(actor.organizationId)).map(strip);
  }

  @Post("rules")
  @RequirePermissions("doh.settings.manage")
  @ApiOperation({ summary: "Add a reportable-condition rule (from the official issuance the organization follows)" })
  createRule(@CurrentActor() actor: Actor, @Body() body: CreateRuleDto) {
    return this.settings.createRule(actor, body);
  }

  @Post("rules/:ruleId/deactivate")
  @HttpCode(200)
  @RequirePermissions("doh.settings.manage")
  deactivateRule(@CurrentActor() actor: Actor, @Param("ruleId", ParseUUIDPipe) ruleId: string) {
    return this.settings.deactivateRule(actor, ruleId);
  }

  @Get("facilities/:facilityId/facility-code")
  @RequirePermissions("doh.settings.manage")
  @ApiOperation({ summary: "The facility's DOH health facility code, as recorded" })
  async facilityCode(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string) {
    const row = await this.settings.facilityCode(actor.organizationId, facilityId);
    return { facilityCode: row ? strip(row) : null };
  }

  @Put("facilities/:facilityId/facility-code")
  @RequirePermissions("doh.settings.manage")
  @ApiOperation({ summary: "Record the facility's DOH health facility code (as issued; not verified with DOH)" })
  recordFacilityCode(@CurrentActor() actor: Actor, @Param("facilityId", ParseUUIDPipe) facilityId: string, @Body() body: FacilityCodeDto) {
    return this.settings.recordFacilityCode(actor, facilityId, body);
  }

  @Get("case-reports")
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "Case reports opened by the organization's rules, those awaiting review first" })
  list(@CurrentActor() actor: Actor, @Query() query: ListCasesDto) {
    return this.reports.list(actor, query.status);
  }

  @Get("case-reports/:caseReportId")
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "One case report: readiness checks, the prepared report, submissions" })
  get(@CurrentActor() actor: Actor, @Param("caseReportId", ParseUUIDPipe) id: string) {
    return this.reports.get(actor, id);
  }

  @Post("case-reports/:caseReportId/reported")
  @HttpCode(200)
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "Record that the case was reported through DOH's own channel, with its reference" })
  recordExternal(@CurrentActor() actor: Actor, @Param("caseReportId", ParseUUIDPipe) id: string, @Body() body: RecordExternalDto) {
    return this.reports.recordExternal(actor, id, body);
  }

  @Post("case-reports/:caseReportId/dismiss")
  @HttpCode(200)
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "Dismiss a case report (not reportable after review), with a reason" })
  dismiss(@CurrentActor() actor: Actor, @Param("caseReportId", ParseUUIDPipe) id: string, @Body() body: DismissDto) {
    return this.reports.dismiss(actor, id, body);
  }

  @Post("case-reports/:caseReportId/submissions")
  @HttpCode(202)
  @RequirePermissions("doh.report.manage")
  @ApiOperation({ summary: "Queue the report for the integration worker (refused while DOH reporting is an integration dependency)" })
  submit(@CurrentActor() actor: Actor, @Param("caseReportId", ParseUUIDPipe) id: string, @Body() body: SubmitCaseDto) {
    return this.reports.submit(actor, id, body);
  }
}
