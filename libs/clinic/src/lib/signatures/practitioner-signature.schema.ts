import { boolean, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0122_practitioner_signature.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Whether medical certificates and referral letters print the issuing practitioner's signature (off until the organization decides). */
export const practitionerSignatureSetting = pgTable("practitioner_signature_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

/** A practitioner's own drawn signature (strokes in 0..1 inside a 3:1 box); one in force, earlier ones kept. */
export const practitionerSignature = pgTable("practitioner_signature", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  strokes: jsonb("strokes").$type<number[][][]>().notNull(),
  drawnBy: uuid("drawn_by").notNull(),
  drawnAt: ts("drawn_at").notNull().defaultNow(),
  withdrawnAt: ts("withdrawn_at"),
});
