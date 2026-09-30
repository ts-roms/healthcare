import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<"active" | "suspended" | "archived">().notNull().default("active"),
  /** Staff must use two-step verification (0089): members without it can only set it up after signing in. */
  staffMfaRequired: boolean("staff_mfa_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const FACILITY_TYPES = ["clinic", "laboratory", "dental_clinic", "hospital", "diagnostic_center", "telemedicine_hub", "other"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const facility = pgTable("facility", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  facilityType: text("facility_type").$type<FacilityType>().notNull(),
  addressLine: text("address_line"),
  barangay: text("barangay"),
  cityMunicipality: text("city_municipality"),
  province: text("province"),
  region: text("region"),
  postalCode: text("postal_code"),
  contactNumber: text("contact_number"),
  email: text("email"),
  licenseNumber: text("license_number"),
  timezone: text("timezone").notNull().default("Asia/Manila"),
  status: text("status").$type<"active" | "inactive" | "archived">().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const department = pgTable("department", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<"active" | "inactive" | "archived">().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type OrganizationRecord = typeof organization.$inferSelect;
export type FacilityRecord = typeof facility.$inferSelect;
export type DepartmentRecord = typeof department.$inferSelect;
