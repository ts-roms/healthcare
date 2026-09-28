import { bigint, jsonb, numeric, pgTable, smallint, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";

export const ROUTES = [
  "oral",
  "sublingual",
  "buccal",
  "topical",
  "transdermal",
  "inhalation",
  "nasal",
  "ophthalmic",
  "otic",
  "rectal",
  "vaginal",
  "subcutaneous",
  "intramuscular",
  "intravenous",
  "other",
] as const;
export const FREQUENCIES = [
  "once",
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "four_times_daily",
  "every_4_hours",
  "every_6_hours",
  "every_8_hours",
  "every_12_hours",
  "at_bedtime",
  "weekly",
  "as_needed",
  "custom",
] as const;

export const prescriptionNumberSequence = pgTable("prescription_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

export const prescription = pgTable("prescription", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  prescriberPractitionerId: uuid("prescriber_practitioner_id").notNull(),
  prescriptionNumber: text("prescription_number").notNull(),
  status: text("status").$type<"active" | "cancelled" | "superseded">().notNull().default("active"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  issuedBy: uuid("issued_by").notNull(),
  notes: text("notes"),
  replacesPrescriptionId: uuid("replaces_prescription_id"),
  allergyOverrideReason: text("allergy_override_reason"),
  allergyWarnings: jsonb("allergy_warnings").$type<AllergyWarning[]>().notNull().default([]),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
});

export const prescriptionItem = pgTable("prescription_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  prescriptionId: uuid("prescription_id").notNull(),
  lineNumber: smallint("line_number").notNull(),
  genericName: text("generic_name").notNull(),
  brandName: text("brand_name"),
  strength: text("strength"),
  dosageForm: text("dosage_form"),
  doseAmount: numeric("dose_amount", { precision: 10, scale: 3, mode: "number" }),
  doseUnit: text("dose_unit"),
  route: text("route").$type<(typeof ROUTES)[number]>().notNull(),
  frequency: text("frequency").$type<(typeof FREQUENCIES)[number]>().notNull(),
  frequencyText: text("frequency_text"),
  asNeededReason: text("as_needed_reason"),
  durationValue: integer("duration_value"),
  durationUnit: text("duration_unit").$type<"days" | "weeks" | "months">(),
  quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull(),
  quantityUnit: text("quantity_unit").notNull(),
  refills: smallint("refills").notNull().default(0),
  instructions: text("instructions").notNull(),
});

export interface AllergyWarning {
  allergyId: string;
  substance: string;
  medication: string;
  criticality: string;
  reaction: string | null;
  basis: "name_match";
}

export type PrescriptionRecord = typeof prescription.$inferSelect;
export type PrescriptionItemRecord = typeof prescriptionItem.$inferSelect;

// Mirrors database/migrations/0053_prescription_dispensing.sql.
export const prescriptionDispense = pgTable("prescription_dispense", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  prescriptionId: uuid("prescription_id").notNull(),
  prescriptionItemId: uuid("prescription_item_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  locationId: uuid("location_id").notNull(),
  quantity: integer("quantity").notNull(),
  itemName: text("item_name").notNull(),
  stockUnit: text("stock_unit").notNull(),
  stockMovementGroupId: uuid("stock_movement_group_id").notNull(),
  note: text("note"),
  dispensedBy: uuid("dispensed_by").notNull(),
  dispensedAt: timestamp("dispensed_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").$type<"recorded" | "reversed">().notNull().default("recorded"),
  reversedBy: uuid("reversed_by"),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversalReason: text("reversal_reason"),
  reversalMovementGroupId: uuid("reversal_movement_group_id"),
});

export type PrescriptionDispenseRecord = typeof prescriptionDispense.$inferSelect;
