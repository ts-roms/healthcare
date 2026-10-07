import { Body, Controller, Get, Param, Post, Put, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PDF_REPORT, REPORT_FILES } from "./management-dashboard.rules";
import { REPORT_CADENCES } from "./management-report.schema";
import { ManagementReportService } from "./management-report.service";

const scheduleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  cadence: z.enum(REPORT_CADENCES),
  tables: z.array(z.enum(REPORT_FILES)).min(1).max(20),
  /** One facility, or null for every facility the owner may report on. */
  facilityId: z.uuid().nullable().optional(),
  recipientUserIds: z.array(z.uuid()).min(1).max(50),
});
export class ReportScheduleDto extends createZodDto(scheduleSchema) {}
export class ReportScheduleUpdateDto extends createZodDto(scheduleSchema.extend({ version: z.number().int().min(1) })) {}
export class ReportScheduleStatusDto extends createZodDto(z.object({ status: z.enum(["active", "paused"]), version: z.number().int().min(1) })) {}
export class ReportRunsQueryDto extends createZodDto(z.object({ scheduleId: z.uuid().optional() })) {}
export class ReportFileParamsDto extends createZodDto(z.object({ id: z.uuid(), table: z.enum(REPORT_FILES) })) {}

@ApiTags("management")
@ApiBearerAuth()
@Controller({ path: "management", version: "1" })
export class ManagementReportController {
  constructor(private readonly reports: ManagementReportService) {}

  @Get("report-schedules")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({ summary: "The organization's scheduled management reports" })
  listSchedules(@CurrentActor() actor: Actor) {
    return this.reports.listSchedules(actor);
  }

  @Post("report-schedules")
  @RequirePermissions("management.report.manage")
  @ApiOperation({
    summary:
      "Schedule a weekly or monthly management report: dashboard tables, facility scope and recipients (members allowed to view the dashboard); produced with the caller's permissions",
  })
  createSchedule(@CurrentActor() actor: Actor, @Body() body: ReportScheduleDto) {
    return this.reports.createSchedule(actor, body);
  }

  @Put("report-schedules/:id")
  @RequirePermissions("management.report.manage")
  @ApiOperation({ summary: "Change a scheduled report (optimistic version); the caller becomes its owner" })
  updateSchedule(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: ReportScheduleUpdateDto) {
    return this.reports.updateSchedule(actor, id, body);
  }

  @Post("report-schedules/:id/status")
  @RequirePermissions("management.report.manage")
  @ApiOperation({ summary: "Pause or resume a scheduled report" })
  setStatus(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: ReportScheduleStatusDto) {
    return this.reports.setScheduleStatus(actor, id, body.status, body.version);
  }

  @Get("reports")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({ summary: "Produced reports, newest period first, with their stored tables and anything withheld" })
  listRuns(@CurrentActor() actor: Actor, @Query() query: ReportRunsQueryDto) {
    return this.reports.listRuns(actor, query.scheduleId);
  }

  @Get("reports/:id/files/:table")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({
    summary:
      "One table of a produced report as CSV, or the whole dashboard as PDF (table `pdf`); gated tables need their permission on every facility of the run; audited",
  })
  async download(@CurrentActor() actor: Actor, @Param() params: ReportFileParamsDto): Promise<StreamableFile> {
    const { fileName, body } = await this.reports.download(actor, params.id, params.table);
    const type = params.table === PDF_REPORT ? "application/pdf" : "text/csv; charset=utf-8";
    return new StreamableFile(body, { type, disposition: `attachment; filename="${fileName}"`, length: body.length });
  }
}
