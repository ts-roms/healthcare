import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { DeclineSubmissionDto, FileSubmissionDto } from "./outside-result-submission.dto";
import { OutsideResultSubmissionService } from "./outside-result-submission.service";

/** The records office answers outside results patients sent from MyHealth. */
@ApiTags("outside-results")
@ApiBearerAuth()
@Controller({ path: "outside-result-submissions", version: "1" })
export class OutsideResultSubmissionController {
  constructor(private readonly submissions: OutsideResultSubmissionService) {}

  @Get()
  @RequirePermissions("outside-result.submission.manage")
  @ApiOperation({ summary: "Submissions waiting for the records office, oldest first, with the patient (each listed patient is audited)" })
  queue(@CurrentActor() actor: Actor) {
    return this.submissions.queue(actor);
  }

  @Get(":submissionId/link")
  @RequirePermissions("outside-result.submission.manage")
  @ApiOperation({ summary: "Short-lived signed link to the report the patient sent (audited); inline=true to show a PDF or photo in the page" })
  link(@CurrentActor() actor: Actor, @Param("submissionId", ParseUUIDPipe) id: string, @Query("inline") inline?: string) {
    return this.submissions.link(actor, id, inline === "true");
  }

  @Post(":submissionId/file")
  @HttpCode(200)
  @RequirePermissions("outside-result.submission.manage")
  @ApiOperation({ summary: "File the report on the patient's record as an outside result, with the records office's own reading of it" })
  file(@CurrentActor() actor: Actor, @Param("submissionId", ParseUUIDPipe) id: string, @Body() body: FileSubmissionDto) {
    return this.submissions.file(actor, id, body);
  }

  @Post(":submissionId/decline")
  @HttpCode(200)
  @RequirePermissions("outside-result.submission.manage")
  @ApiOperation({ summary: "Decline the submission with a reason the patient reads; nothing is filed" })
  decline(@CurrentActor() actor: Actor, @Param("submissionId", ParseUUIDPipe) id: string, @Body() body: DeclineSubmissionDto) {
    return this.submissions.decline(actor, id, body.reason);
  }
}
