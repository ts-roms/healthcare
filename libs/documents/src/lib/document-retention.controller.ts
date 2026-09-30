import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions, BadRequestError } from "@healthcare/core";
import { RetentionPolicyDto, RetentionReviewQueryDto } from "./document.dto";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "./document.schema";
import { DocumentRetentionService } from "./document-retention.service";

/** The organization's retention periods per document category and the review of documents past them (nothing is deleted). */
@ApiTags("documents")
@ApiBearerAuth()
@Controller({ path: "document-retention", version: "1" })
export class DocumentRetentionController {
  constructor(private readonly retention: DocumentRetentionService) {}

  @Get()
  @RequirePermissions("document.retention.manage")
  @ApiOperation({ summary: "Retention periods per document category, with how many available documents are past each (audited)" })
  overview(@CurrentActor() actor: Actor) {
    return this.retention.overview(actor);
  }

  @Put()
  @RequirePermissions("document.retention.manage")
  @ApiOperation({ summary: "Set a category's retention period from the organization's own schedule (the previous one is kept as history)" })
  set(@CurrentActor() actor: Actor, @Body() body: RetentionPolicyDto) {
    return this.retention.setPolicy(actor, body);
  }

  @Post(":category/end")
  @HttpCode(200)
  @RequirePermissions("document.retention.manage")
  end(@CurrentActor() actor: Actor, @Param("category") category: string) {
    if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestError("Unknown document category");
    return this.retention.endPolicy(actor, category as DocumentCategory);
  }

  @Get("review")
  @RequirePermissions("document.retention.manage")
  @ApiOperation({ summary: "Available documents of a category older than its retention period, oldest first (metadata only; audited)" })
  review(@CurrentActor() actor: Actor, @Query() query: RetentionReviewQueryDto) {
    return this.retention.review(actor, query.category);
  }
}
