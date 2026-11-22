import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequireFacility, RequirePermissions } from "@healthcare/core";
import { RateLimitPerPerson } from "../../rate-limit.guard";
import { AnswerDto, InterpretDto } from "./ask.dto";
import { AskService } from "./ask.service";

/** Typed questions a person may read a minute (each read is cheap, but nothing should probe the reader). */
const INTERPRET_LIMIT = 30;
/** Answers a person may ask for a minute: some read the management dashboard twice (a comparison). */
const ANSWER_LIMIT = 20;

/**
 * The assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019). Two routes keep the words typed away from the
 * figures: `interpret` reads a text against the catalogue and reads no data; `answer` takes a catalogue question, never
 * a text, and answers it with the figures the person may already open on its source screen.
 */
@ApiTags("assistant")
@ApiBearerAuth()
@RequireFacility()
@RequirePermissions("assistant.ask")
@Controller({ path: "assistant/ask", version: "1" })
export class AskController {
  constructor(private readonly ask: AskService) {}

  @Get("questions")
  @ApiOperation({ summary: "The questions Ask answers, and whether each one's figures are the caller's to see" })
  questions(@CurrentActor() actor: Actor) {
    return this.ask.questions(actor);
  }

  @Post("interpret")
  @HttpCode(200)
  @RateLimitPerPerson(INTERPRET_LIMIT)
  @ApiOperation({ summary: "Which catalogue question a typed text asks, with its period: reads no figures, stores and audits nothing" })
  interpret(@CurrentActor() actor: Actor, @Body() body: InterpretDto) {
    return this.ask.interpret(actor, body.text, body.allFacilities ?? false);
  }

  @Post("answer")
  @HttpCode(200)
  @RateLimitPerPerson(ANSWER_LIMIT)
  @ApiOperation({ summary: "The answer to a catalogue question, from its source route's figures and permissions (audited without any text)" })
  answer(@CurrentActor() actor: Actor, @Body() body: AnswerDto) {
    return this.ask.answer(actor, body);
  }

  @Get("history")
  @ApiOperation({ summary: "The caller's saved and recent questions (question, period and scope; never the words typed)" })
  history(@CurrentActor() actor: Actor) {
    return this.ask.history(actor);
  }

  @Post("history/clear")
  @HttpCode(200)
  @ApiOperation({ summary: "Forget the caller's recent questions (saved ones stay)" })
  clear(@CurrentActor() actor: Actor) {
    return this.ask.clear(actor);
  }

  @Post("history/:id/save")
  @HttpCode(200)
  @ApiOperation({ summary: "Save one of the caller's questions (at most 20)" })
  save(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.ask.save(actor, id);
  }

  @Post("history/:id/unsave")
  @HttpCode(200)
  @ApiOperation({ summary: "Stop keeping one of the caller's questions as saved" })
  unsave(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.ask.unsave(actor, id);
  }

  @Post("history/:id/remove")
  @HttpCode(200)
  @ApiOperation({ summary: "Remove one of the caller's questions" })
  remove(@CurrentActor() actor: Actor, @Param("id", ParseUUIDPipe) id: string) {
    return this.ask.remove(actor, id);
  }
}
