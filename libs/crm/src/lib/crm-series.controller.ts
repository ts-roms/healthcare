import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { campaignSchema } from "./crm.controller";
import { CrmSeriesService } from "./crm-series.service";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");
const seriesSchema = campaignSchema.omit({ sendAt: true }).extend({
  cadence: z.enum(["weekly", "monthly"]),
  /** Weekly: 0 = Sunday to 6 = Saturday. */
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  /** Monthly: 1 to 28. */
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  sendTime: hhmm,
  startsOn: z.iso.date(),
  endsOn: z.iso.date().nullable().optional(),
});
const version = z.object({ version: z.number().int().min(1) });

export class SeriesDto extends createZodDto(seriesSchema) {}
export class SeriesUpdateDto extends createZodDto(seriesSchema.extend(version.shape)) {}
export class SeriesVersionDto extends createZodDto(version) {}
export class SeriesCloseDto extends createZodDto(version.extend({ reason: z.string().trim().min(3).max(500) })) {}

/** Recurring outreach: one wording and segment, sent weekly or monthly once two people have approved it. */
@ApiTags("outreach")
@ApiBearerAuth()
@Controller({ path: "outreach/series", version: "1" })
export class CrmSeriesController {
  constructor(private readonly series: CrmSeriesService) {}

  @Get()
  @RequirePermissions("crm.read")
  @ApiOperation({ summary: "The organization's recurring campaigns" })
  list(@CurrentActor() actor: Actor) {
    return this.series.list(actor);
  }

  @Get(":id")
  @RequirePermissions("crm.read")
  @ApiOperation({ summary: "One recurring campaign with its latest occurrences (each an ordinary campaign)" })
  get(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.series.get(actor, id);
  }

  @Post()
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Draft a recurring campaign: the wording and segment of a campaign, and a weekly or monthly schedule" })
  create(@CurrentActor() actor: Actor, @Body() body: SeriesDto) {
    return this.series.create(actor, body);
  }

  @Put(":id")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Change a draft recurring campaign; the caller becomes its author" })
  update(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesUpdateDto) {
    return this.series.update(actor, id, body);
  }

  @Post(":id/submit")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Submit a draft for approval by someone else" })
  submit(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesVersionDto) {
    return this.series.submit(actor, id, body.version);
  }

  @Post(":id/reopen")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Take a submitted or paused recurring campaign back to a draft (the approval is gone)" })
  reopen(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesVersionDto) {
    return this.series.reopen(actor, id, body.version);
  }

  @Post(":id/approve")
  @RequirePermissions("crm.campaign.approve")
  @ApiOperation({ summary: "Approve a submitted recurring campaign (never one's own); every occurrence then goes out at its time" })
  approve(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesVersionDto) {
    return this.series.approve(actor, id, body.version);
  }

  @Post(":id/pause")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Pause an active recurring campaign: nothing more is created until it is resumed" })
  pause(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesVersionDto) {
    return this.series.pause(actor, id, body.version);
  }

  @Post(":id/resume")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Resume a paused recurring campaign at its next occurrence (those missed while paused are not sent)" })
  resume(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesVersionDto) {
    return this.series.resume(actor, id, body.version);
  }

  @Post(":id/end")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "End a recurring campaign for good, with a reason (occurrences already sent stay)" })
  end(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesCloseDto) {
    return this.series.end(actor, id, body.version, body.reason);
  }

  @Post(":id/cancel")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Cancel a recurring campaign that was never approved, with a reason" })
  cancel(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SeriesCloseDto) {
    return this.series.cancel(actor, id, body.version, body.reason);
  }
}
