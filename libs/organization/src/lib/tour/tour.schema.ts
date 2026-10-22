import { boolean, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0124_staff_tour_setting.sql; the migration is the source of truth.

/** Whether the organization offers the staff app's guided tour. No row = on. */
export const staffTourSetting = pgTable("staff_tour_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
