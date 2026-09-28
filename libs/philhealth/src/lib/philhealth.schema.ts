import { date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const ELIGIBILITY_STATUSES = ["queued", "eligible", "not_eligible", "undetermined", "failed"] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/** Mirrors database/migrations/0024_philhealth_eligibility.sql. A recorded answer never changes (trigger). */
export const philhealthEligibilityCheck = pgTable("philhealth_eligibility_check", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  serviceDate: date("service_date", { mode: "string" }).notNull(),
  status: text("status").$type<EligibilityStatus>().notNull(),
  source: text("source").$type<"external_channel" | "adapter">().notNull(),
  externalReference: text("external_reference"),
  note: text("note"),
  outcomeDetail: jsonb("outcome_detail").$type<Record<string, unknown>>().notNull().default({}),
  exchangeId: uuid("exchange_id"),
  requestedBy: uuid("requested_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type EligibilityCheckRecord = typeof philhealthEligibilityCheck.$inferSelect;

/** Mirrors database/migrations/0049_philhealth_yakap.sql: the facility's YAKAP participation reference as issued. */
export const philhealthYakapParticipation = pgTable("philhealth_yakap_participation", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  participationReference: text("participation_reference").notNull(),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type YakapParticipationRecord = typeof philhealthYakapParticipation.$inferSelect;

export const YAKAP_REGISTRATION_STATUSES = ["registered", "not_registered", "pending", "unknown"] as const;
export type YakapRegistrationStatus = (typeof YAKAP_REGISTRATION_STATUSES)[number];

/** Mirrors 0049: PhilHealth's answer about a patient's YAKAP registration. Append-only (trigger). */
export const philhealthYakapRegistration = pgTable("philhealth_yakap_registration", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  status: text("status").$type<YakapRegistrationStatus>().notNull(),
  effectiveDate: date("effective_date", { mode: "string" }),
  externalReference: text("external_reference"),
  note: text("note"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export type YakapRegistrationRecord = typeof philhealthYakapRegistration.$inferSelect;
