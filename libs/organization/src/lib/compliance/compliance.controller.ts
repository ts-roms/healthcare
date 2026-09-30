import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { RecordComplianceReviewDto } from "./compliance.dto";
import { ComplianceReviewService } from "./compliance-review.service";

@ApiTags("compliance")
@ApiBearerAuth()
@Controller({ path: "compliance", version: "1" })
export class ComplianceController {
  constructor(private readonly reviews: ComplianceReviewService) {}

  @Get("reviews")
  @RequirePermissions("compliance.review.manage")
  @ApiOperation({ summary: "Each compliance area with its latest recorded review, and the history" })
  overview(@CurrentActor() actor: Actor) {
    return this.reviews.overview(actor);
  }

  @Post("reviews")
  @RequirePermissions("compliance.review.manage")
  @ApiOperation({ summary: "Record who reviewed an area's configuration against official requirements (append-only)" })
  record(@CurrentActor() actor: Actor, @Body() body: RecordComplianceReviewDto) {
    return this.reviews.record(actor, body);
  }
}
