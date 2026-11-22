import { ASK_NOTES, COMPARE_MODES, MAX_QUESTION_LENGTH, PERIOD_KEY } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** A typed question: read, matched and dropped (never stored, logged or audited). */
export const interpretSchema = z.object({
  text: z.string().max(MAX_QUESTION_LENGTH * 2),
  /** "Answer for all facilities" ticked: questions that can be answered for every facility the person reports on. */
  allFacilities: z.boolean().optional(),
});
export class InterpretDto extends createZodDto(interpretSchema) {}

/** A catalogue question to answer: never the words typed. */
export const answerSchema = z.object({
  questionId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/),
  period: z.string().regex(PERIOD_KEY, "A period key").optional(),
  compare: z.enum(COMPARE_MODES).optional(),
  scope: z.enum(["facility", "organization"]).optional(),
  /** What the reading of the typed question left out (codes, said back in the answer). */
  notes: z.array(z.enum(ASK_NOTES)).max(ASK_NOTES.length).optional(),
});
export class AnswerDto extends createZodDto(answerSchema) {}
