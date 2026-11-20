import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { AssistantService } from "./assistant.service";
import { FeedbackDto, InsightsQueryDto, RuleSettingDto, RulesQueryDto, SuggestionsQueryDto } from "./assistant.dto";

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
    return this.assistant.suggestions(actor, query.surface);
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

  @Get("insights")
  @RequirePermissions("assistant.insights.read")
  @ApiOperation({ summary: "How staff answered each rule's suggestions over a period (counts only; audited)" })
  insights(@CurrentActor() actor: Actor, @Query() query: InsightsQueryDto) {
    return this.assistant.insights(actor, query.days);
  }
}
