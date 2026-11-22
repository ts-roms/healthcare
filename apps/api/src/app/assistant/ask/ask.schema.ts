import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0160_assistant_ask.sql (the migration is the source of truth). The assistant's Ask belongs
// to the API's assistant composition, which reads several domains (ADR-0018, ADR-0019).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type AskScope = "facility" | "organization";

/** A person's recent and saved questions: the catalogue question, period and scope, never the words typed. */
export const assistantAskedQuestion = pgTable("assistant_asked_question", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  questionId: text("question_id").notNull(),
  periodKey: text("period_key").notNull().default(""),
  compareKey: text("compare_key").notNull().default(""),
  scope: text("scope").$type<AskScope>().notNull().default("facility"),
  timesAsked: integer("times_asked").notNull().default(1),
  lastAskedAt: ts("last_asked_at").notNull().defaultNow(),
  savedAt: ts("saved_at"),
});
