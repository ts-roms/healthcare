import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { OutsideResultInErrorDto, RecordOutsideResultDto, ReviewOutsideResultDto } from "./outside-result.dto";
import { OutsideResultService } from "./outside-result.service";

@ApiTags("outside-results")
@ApiBearerAuth()
@Controller({ version: "1" })
export class OutsideResultController {
  constructor(private readonly outsideResults: OutsideResultService) {}

  @Get("patients/:patientId/outside-results")
  @RequirePermissions("outside-result.read")
  @ApiOperation({ summary: "Results from outside laboratories and hospitals filed on the patient's record (entries in error marked)" })
  list(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string) {
    return this.outsideResults.list(actor, patientId);
  }

  @Post("patients/:patientId/outside-results")
  @RequirePermissions("outside-result.record")
  @ApiOperation({ summary: "File an uploaded report from an outside laboratory or hospital (not one of this laboratory's results)" })
  record(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Body() body: RecordOutsideResultDto) {
    return this.outsideResults.record(actor, patientId, body);
  }

  @Get("outside-results/unreviewed")
  @RequirePermissions("outside-result.review")
  @ApiOperation({ summary: "Filings awaiting a clinician's review, oldest first, with the patient (each listed patient is audited)" })
  unreviewed(@CurrentActor() actor: Actor) {
    return this.outsideResults.unreviewed(actor);
  }

  @Post("outside-results/:outsideResultId/review")
  @HttpCode(200)
  @RequirePermissions("outside-result.review")
  @ApiOperation({ summary: "Record that you read the filed report (once; not on an entry in error). Says nothing about what it shows." })
  review(@CurrentActor() actor: Actor, @Param("outsideResultId", ParseUUIDPipe) id: string, @Body() body: ReviewOutsideResultDto) {
    return this.outsideResults.review(actor, id, body.note);
  }

  @Get("outside-results/:outsideResultId/download-url")
  @RequirePermissions("outside-result.read")
  @ApiOperation({ summary: "Short-lived signed link to the filed report (audited)" })
  downloadUrl(@CurrentActor() actor: Actor, @Param("outsideResultId", ParseUUIDPipe) id: string, @Query("inline") inline?: string) {
    return this.outsideResults.downloadUrl(actor, id, inline === "true");
  }

  @Post("outside-results/:outsideResultId/entered-in-error")
  @HttpCode(200)
  @RequirePermissions("outside-result.record")
  @ApiOperation({ summary: "Mark a filing entered in error with a reason (the report is kept)" })
  enteredInError(@CurrentActor() actor: Actor, @Param("outsideResultId", ParseUUIDPipe) id: string, @Body() body: OutsideResultInErrorDto) {
    return this.outsideResults.markEnteredInError(actor, id, body.reason);
  }
}
