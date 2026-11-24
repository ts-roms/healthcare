import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { RateLimitPerPerson } from "../rate-limit.guard";
import { AssistantService } from "./assistant.service";
import {
  CheckDto,
  FeedbackDto,
  InsightsQueryDto,
  OverviewQueryDto,
  ReplayDto,
  RuleReviewDto,
  RuleSettingDto,
  RulesQueryDto,
  SuggestionsQueryDto,
} from "./assistant.dto";

/**
 * Overview requests a person may make a minute: each runs every rule turned on for the screens it names. Room for moving
 * between the Suggestions tabs and the refresh after each answer.
 */
const OVERVIEW_LIMIT = 30;

/**
 * The heuristic assistant (docs/architecture/heuristic-assistant.md): decision support computed from rules over data the
 * caller may already read. It suggests and links; it never changes a record.
 */
@ApiTags("assistant")
@ApiBearerAuth()
@Controller({ path: "assistant", version: "1" })
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get("suggestions")
  @RequireFacility()
  @RequirePermissions("assistant.use")
  @ApiOperation({ summary: "Suggestions for a screen at the selected facility, from the rules turned on there (audited, rule ids only)" })
  suggestions(@CurrentActor() actor: Actor, @Query() query: SuggestionsQueryDto) {
    return this.assistant.suggestions(actor, query.surface, {
      date: query.date,
      encounterId: query.encounterId,
      patientId: query.patientId,
      prescriptionId: query.prescriptionId,
    });
  }

  @Get("overview")
  @RequireFacility()
  @RequirePermissions("assistant.use")
  @RateLimitPerPerson(OVERVIEW_LIMIT)
  @ApiOperation({
    summary:
      "What the assistant says now across several screens: per surface, the rules the caller may read with their state and the suggestions of those that need nothing on screen (one audit row, rule ids only)",
  })
  overview(@CurrentActor() actor: Actor, @Query() query: OverviewQueryDto) {
    return this.assistant.overview(actor, query.surfaces, query.limit);
  }

  @Post("suggestions/check")
  @HttpCode(200)
  @RequireFacility()
  @RequirePermissions("assistant.use")
  @ApiOperation({ summary: "Suggestions for a draft before it is saved: a prescription being written in a consultation (audited, rule ids only)" })
  check(@CurrentActor() actor: Actor, @Body() body: CheckDto) {
    return this.assistant.suggestions(actor, body.surface, {
      prescriptionDraft: { encounterId: body.encounterId, medicines: body.medicines, replacesPrescriptionId: body.replacesPrescriptionId },
    });
  }

  @Post("suggestions/:id/feedback")
  @HttpCode(201)
  @RequireFacility()
  @RequirePermissions("assistant.use")
  @ApiOperation({ summary: "Accept, dismiss or mark a suggestion not useful (dismissed ones stay hidden from the same person for 14 days)" })
  feedback(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: FeedbackDto) {
    return this.assistant.answer(actor, id, body.outcome, body.reason);
  }

  @Get("rules")
  @RequirePermissions("assistant.configure")
  @ApiOperation({ summary: "Every rule with its setting for the organization, or for one facility with ?facilityId=" })
  rules(@CurrentActor() actor: Actor, @Query() query: RulesQueryDto) {
    return this.assistant.ruleSettings(actor, query.facilityId);
  }

  @Put("rules/:ruleId/settings")
  @RequirePermissions("assistant.configure")
  @ApiOperation({ summary: "Turn a rule on or off and set its parameters (a new version; audited)" })
  updateSetting(@CurrentActor() actor: Actor, @Param("ruleId") ruleId: string, @Body() body: RuleSettingDto) {
    return this.assistant.updateSetting(actor, ruleId, body);
  }

  @Post("rules/:ruleId/replay")
  @HttpCode(200)
  @RequirePermissions("assistant.configure")
  @ApiOperation({ summary: "How often a rule would have spoken on each of the last days at a facility, with given parameters (counts only; audited)" })
  replay(@CurrentActor() actor: Actor, @Param("ruleId") ruleId: string, @Body() body: ReplayDto) {
    return this.assistant.replay(actor, ruleId, body);
  }

  @Get("insights")
  @RequirePermissions("assistant.insights.read")
  @ApiOperation({
    summary: "How each rule did over a period: times shown, followed, dismissed and not useful, recent reasons, where it is on and its last review (audited)",
  })
  insights(@CurrentActor() actor: Actor, @Query() query: InsightsQueryDto) {
    return this.assistant.insights(actor, query.days);
  }

  @Get("rules/:ruleId/reviews")
  @RequirePermissions("assistant.insights.read")
  @ApiOperation({ summary: "The organization's reviews of a rule, newest first" })
  reviews(@CurrentActor() actor: Actor, @Param("ruleId") ruleId: string) {
    return this.assistant.reviews(actor, ruleId);
  }

  @Post("rules/:ruleId/reviews")
  @HttpCode(201)
  @RequirePermissions("assistant.configure")
  @ApiOperation({ summary: "Record a review of a rule: keep, adjust, or retire it (turned off wherever it is on in the organization; audited)" })
  recordReview(@CurrentActor() actor: Actor, @Param("ruleId") ruleId: string, @Body() body: RuleReviewDto) {
    return this.assistant.recordReview(actor, ruleId, body);
  }
}
