import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0021_philhealth_claims.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const philhealthFacilityAccreditation = pgTable("philhealth_facility_accreditation", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  accreditationNumber: text("accreditation_number").notNull(),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type AccreditationRecord = typeof philhealthFacilityAccreditation.$inferSelect;
