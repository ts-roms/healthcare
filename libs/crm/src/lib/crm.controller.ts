import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, Public, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { segmentCriteriaSchema } from "./crm.rules";
import { OUTREACH_CHANNELS } from "./crm.schema";
import { CrmService } from "./crm.service";

const segmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  criteria: segmentCriteriaSchema,
});
const campaignSchema = z.object({
  segmentId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  channels: z.array(z.enum(OUTREACH_CHANNELS)).min(1).max(4),
  subject: z.string().trim().max(120).nullable().optional(),
  body: z.string().trim().min(10).max(2000),
  sendAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const version = z.object({ version: z.number().int().min(1) });

export class SegmentDto extends createZodDto(segmentSchema) {}
export class SegmentUpdateDto extends createZodDto(segmentSchema.extend(version.shape)) {}
export class VersionDto extends createZodDto(version) {}
export class CampaignDto extends createZodDto(campaignSchema) {}
export class CampaignUpdateDto extends createZodDto(campaignSchema.extend(version.shape)) {}
export class CancelDto extends createZodDto(version.extend({ reason: z.string().trim().min(3).max(500) })) {}
export class OptOutDto extends createZodDto(z.object({ token: z.string().min(16).max(200) })) {}

@ApiTags("outreach")
@ApiBearerAuth()
@Controller({ path: "outreach", version: "1" })
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get("segments")
  @RequirePermissions("crm.read")
  @ApiOperation({ summary: "The organization's outreach segments" })
  listSegments(@CurrentActor() actor: Actor) {
    return this.crm.listSegments(actor);
  }

  @Post("segments")
  @RequirePermissions("crm.segment.manage")
  @ApiOperation({ summary: "Define a segment from non-clinical criteria" })
  createSegment(@CurrentActor() actor: Actor, @Body() body: SegmentDto) {
    return this.crm.createSegment(actor, body);
  }

  @Put("segments/:id")
  @RequirePermissions("crm.segment.manage")
  @ApiOperation({ summary: "Change a segment (optimistic version)" })
  updateSegment(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: SegmentUpdateDto) {
    return this.crm.updateSegment(actor, id, body);
  }

  @Post("segments/:id/archive")
  @RequirePermissions("crm.segment.manage")
  @ApiOperation({ summary: "Archive a segment that no open campaign uses" })
  archiveSegment(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: VersionDto) {
    return this.crm.archiveSegment(actor, id, body.version);
  }

  @Get("segments/:id/preview")
  @RequirePermissions("crm.read")
  @ApiOperation({ summary: "Who matches the segment now: a count and a work list of at most 200 (audited)" })
  previewSegment(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.crm.previewSegment(actor, id);
  }

  @Get("campaigns")
  @RequirePermissions("crm.read")
  @ApiOperation({ summary: "Campaigns, newest first" })
  listCampaigns(@CurrentActor() actor: Actor) {
    return this.crm.listCampaigns(actor);
  }

  @Get("campaigns/:id")
  @RequirePermissions("crm.read")
  @ApiOperation({ summary: "One campaign with its delivery summary (counts by channel and outcome; no names)" })
  getCampaign(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.crm.getCampaign(actor, id);
  }

  @Post("campaigns")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Draft a campaign: segment, channels, the organization's own wording, optional send time" })
  createCampaign(@CurrentActor() actor: Actor, @Body() body: CampaignDto) {
    return this.crm.createCampaign(actor, body);
  }

  @Put("campaigns/:id")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Change a draft campaign; the caller becomes its author" })
  updateCampaign(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: CampaignUpdateDto) {
    return this.crm.updateCampaign(actor, id, body);
  }

  @Post("campaigns/:id/submit")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Submit a draft for approval by someone else" })
  submit(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: VersionDto) {
    return this.crm.submitCampaign(actor, id, body.version);
  }

  @Post("campaigns/:id/reopen")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Take a submitted campaign back to draft" })
  reopen(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: VersionDto) {
    return this.crm.reopenCampaign(actor, id, body.version);
  }

  @Post("campaigns/:id/approve")
  @RequirePermissions("crm.campaign.approve")
  @ApiOperation({ summary: "Approve a submitted campaign (never one's own); it is sent at its time, or within a minute" })
  approve(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: VersionDto) {
    return this.crm.approveCampaign(actor, id, body.version);
  }

  @Post("campaigns/:id/cancel")
  @RequirePermissions("crm.campaign.manage")
  @ApiOperation({ summary: "Cancel a campaign that has not started sending, with a reason" })
  cancel(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: CancelDto) {
    return this.crm.cancelCampaign(actor, id, body.version, body.reason);
  }

  @Public()
  @Post("opt-out")
  @ApiOperation({ summary: "Record the opt-out an outreach email's link stands for (single-use token; the answer never says whether it existed)" })
  async optOut(@Body() body: OptOutDto): Promise<{ recorded: boolean; channel?: string }> {
    const result = await this.crm.optOutByToken(body.token);
    return result ? { recorded: true, channel: result.channel } : { recorded: false };
  }
}
