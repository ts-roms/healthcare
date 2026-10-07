import { Controller, Get, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { COMPARISON_MODES, EXPORT_TABLES } from "./management-dashboard.rules";
import { ManagementDashboardService } from "./management-dashboard.service";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a calendar date");

export const managementDashboardQuerySchema = z.object({
  /** Local dates (inclusive), read in the facility's time zone; the last 30 days when omitted. */
  from: localDate.optional(),
  to: localDate.optional(),
  /** One facility; every facility the caller may report on when omitted. */
  facilityId: z.uuid().optional(),
  /** What to compare with: the period of the same length just before (default) or the same dates one year earlier. */
  comparison: z.enum(COMPARISON_MODES).optional(),
});
export class ManagementDashboardQueryDto extends createZodDto(managementDashboardQuerySchema) {}

export const managementExportQuerySchema = managementDashboardQuerySchema.extend({ table: z.enum(EXPORT_TABLES) });
export class ManagementExportQueryDto extends createZodDto(managementExportQuerySchema) {}

@ApiTags("management")
@ApiBearerAuth()
@Controller({ path: "management", version: "1" })
export class ManagementDashboardController {
  constructor(private readonly dashboards: ManagementDashboardService) {}

  @Get("dashboard")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({
    summary:
      "Management dashboard over a range of local days (≤ 366): patient volume, appointments, no-shows, waiting time, providers, laboratory volume and turnaround, dental, revenue, collections and top services. Counts and amounts only.",
  })
  get(@CurrentActor() actor: Actor, @Query() query: ManagementDashboardQueryDto) {
    return this.dashboards.dashboard(actor, query);
  }

  @Get("dashboard/export")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({
    summary:
      "One table of the management dashboard as CSV (summary with the previous period, daily, services, categories, providers); amounts in pesos; audited",
  })
  async export(@CurrentActor() actor: Actor, @Query() query: ManagementExportQueryDto): Promise<StreamableFile> {
    const { table, ...range } = query;
    const { filename, csv } = await this.dashboards.export(actor, range, table);
    // A byte-order mark so spreadsheet programs read the peso sign and names as UTF-8.
    const body = Buffer.from(`\uFEFF${csv}`, "utf8");
    return new StreamableFile(body, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}"`, length: body.length });
  }

  @Get("dashboard/export.pdf")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({
    summary:
      "The whole management dashboard as one printable PDF: key figures against the comparison period, then every section's table (withheld sections marked as not available); audited",
  })
  async exportPdf(@CurrentActor() actor: Actor, @Query() query: ManagementDashboardQueryDto): Promise<StreamableFile> {
    const { filename, pdf } = await this.dashboards.exportPdf(actor, query);
    return new StreamableFile(pdf, { type: "application/pdf", disposition: `attachment; filename="${filename}"`, length: pdf.length });
  }
}
