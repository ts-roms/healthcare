import { date, integer, numeric, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0079_immunizations.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const IMMUNIZATION_STATUSES = ["completed", "not_done"] as const;
export type ImmunizationStatus = (typeof IMMUNIZATION_STATUSES)[number];
/** Why a dose was not given; the clinician's own words go with it. */
export const IMMUNIZATION_NOT_DONE_REASONS = ["refused", "contraindicated", "unavailable", "other"] as const;
export type ImmunizationNotDoneReason = (typeof IMMUNIZATION_NOT_DONE_REASONS)[number];
export const IMMUNIZATION_SOURCES = ["administered_here", "historical", "external_import"] as const;
export type ImmunizationSource = (typeof IMMUNIZATION_SOURCES)[number];
export const OCCURRENCE_PRECISIONS = ["year", "month", "day", "time"] as const;
export type OccurrencePrecision = (typeof OCCURRENCE_PRECISIONS)[number];

/** The organization's own vaccine catalogue: nothing about any national schedule is encoded. */
export const immunizationVaccine = pgTable("immunization_vaccine", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  productName: text("product_name"),
  manufacturer: text("manufacturer"),
  codeSystem: text("code_system"),
  code: text("code"),
  routes: text("routes").array().notNull().default([]),
  sites: text("sites").array().notNull().default([]),
  dosesInSeries: smallint("doses_in_series"),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

/** One immunization record: immutable except entered in error (with a stock return) and a reaction added once. */
export const immunization = pgTable("immunization", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  facilityId: uuid("facility_id"),
  encounterId: uuid("encounter_id"),
  vaccineId: uuid("vaccine_id"),
  vaccineName: text("vaccine_name").notNull(),
  vaccineProduct: text("vaccine_product"),
  vaccineManufacturer: text("vaccine_manufacturer"),
  vaccineCodeSystem: text("vaccine_code_system"),
  vaccineCode: text("vaccine_code"),
  doseLabel: text("dose_label"),
  doseNumber: smallint("dose_number"),
  occurrenceDate: date("occurrence_date", { mode: "string" }).notNull(),
  occurrencePrecision: text("occurrence_precision").$type<OccurrencePrecision>().notNull(),
  occurredAt: ts("occurred_at"),
  status: text("status").$type<ImmunizationStatus>().notNull(),
  statusReason: text("status_reason").$type<ImmunizationNotDoneReason>(),
  statusReasonText: text("status_reason_text"),
  source: text("source").$type<ImmunizationSource>().notNull(),
  performerPractitionerId: uuid("performer_practitioner_id"),
  performerName: text("performer_name"),
  lotNumber: text("lot_number"),
  expiryDate: date("expiry_date", { mode: "string" }),
  route: text("route"),
  site: text("site"),
  doseQuantity: numeric("dose_quantity", { precision: 8, scale: 3, mode: "number" }),
  doseUnit: text("dose_unit"),
  stockItemId: uuid("stock_item_id"),
  stockLocationId: uuid("stock_location_id"),
  stockQuantity: integer("stock_quantity"),
  stockMovementGroupId: uuid("stock_movement_group_id"),
  stockReturnGroupId: uuid("stock_return_group_id"),
  sourceDescription: text("source_description"),
  documentId: uuid("document_id"),
  sourceReference: text("source_reference"),
  declaredSource: text("declared_source"),
  notes: text("notes"),
  adverseReaction: text("adverse_reaction"),
  adverseReactionRecordedBy: uuid("adverse_reaction_recorded_by"),
  adverseReactionRecordedAt: ts("adverse_reaction_recorded_at"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  enteredInErrorAt: ts("entered_in_error_at"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export type VaccineRecord = typeof immunizationVaccine.$inferSelect;
export type ImmunizationRecord = typeof immunization.$inferSelect;
