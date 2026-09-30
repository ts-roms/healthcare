import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { DeclineRecordsRequestDto, FulfilRecordsRequestDto, RecordsRequestQueryDto, RecordsRequestSettingDto, StartReviewDto } from "./records-request.dto";
import { RecordsRequestService } from "./records-request.service";

/** The records office's side of patients' records requests (`patient.records-request.manage`). */
@ApiTags("records requests")
@ApiBearerAuth()
@Controller({ path: "records-requests", version: "1" })
export class RecordsRequestController {
  constructor(private readonly requests: RecordsRequestService) {}

  @Get()
  @RequirePermissions("patient.records-request.manage")
  @ApiOperation({ summary: "Records requests: open (oldest first), closed or all" })
  list(@CurrentActor() actor: Actor, @Query() query: RecordsRequestQueryDto) {
    return this.requests.list(actor, query.status);
  }

  @Get("setting")
  @RequirePermissions("patient.records-request.manage")
  @ApiOperation({ summary: "The organization's own records-request procedure: response time, identity check, notice to patients" })
  setting(@CurrentActor() actor: Actor) {
    return this.requests.setting(actor.organizationId);
  }

  @Put("setting")
  @RequirePermissions("patient.records-request.manage", "organization.manage")
  @ApiOperation({ summary: "Set the organization's records-request procedure (no deadline, fee or disclosure rule is encoded)" })
  setSetting(@CurrentActor() actor: Actor, @Body() body: RecordsRequestSettingDto) {
    return this.requests.setSetting(actor, body);
  }

  @Get(":requestId")
  @RequirePermissions("patient.records-request.manage")
  @ApiOperation({ summary: "One request, what was shared and the documents of the patient's record that could be (audited)" })
  get(@CurrentActor() actor: Actor, @Param("requestId", ParseUUIDPipe) id: string) {
    return this.requests.get(actor, id);
  }

  @Post(":requestId/review")
  @HttpCode(200)
  @RequirePermissions("patient.records-request.manage")
  review(@CurrentActor() actor: Actor, @Param("requestId", ParseUUIDPipe) id: string, @Body() body: StartReviewDto) {
    return this.requests.startReview(actor, id, body.version);
  }

  @Post(":requestId/fulfil")
  @HttpCode(200)
  @RequirePermissions("patient.records-request.manage")
  @ApiOperation({ summary: "Share documents of the patient's record in answer (the patient downloads them in MyHealth)" })
  fulfil(@CurrentActor() actor: Actor, @Param("requestId", ParseUUIDPipe) id: string, @Body() body: FulfilRecordsRequestDto) {
    return this.requests.fulfil(actor, id, body);
  }

  @Post(":requestId/decline")
  @HttpCode(200)
  @RequirePermissions("patient.records-request.manage")
  @ApiOperation({ summary: "Decline with a reason the patient reads" })
  decline(@CurrentActor() actor: Actor, @Param("requestId", ParseUUIDPipe) id: string, @Body() body: DeclineRecordsRequestDto) {
    return this.requests.decline(actor, id, body);
  }
}
