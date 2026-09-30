import { boolean, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0085_clinic_procedures.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** The organization's procedure catalogue: its own codes, no national code set assumed. */
export const clinicProcedureDefinition = pgTable("clinic_procedure_definition", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  codeSystem: text("code_system"),
  externalCode: text("external_code"),
  requiresBodySite: boolean("requires_body_site").notNull().default(false),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

/** A procedure performed in a consultation (immutable except entered in error). */
export const clinicProcedure = pgTable("clinic_procedure", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  definitionId: uuid("definition_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  codeSystem: text("code_system"),
  externalCode: text("external_code"),
  performedAt: ts("performed_at").notNull(),
  performerPractitionerId: uuid("performer_practitioner_id").notNull(),
  bodySite: text("body_site"),
  quantity: smallint("quantity").notNull().default(1),
  notes: text("notes"),
  lateEntryReason: text("late_entry_reason"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  enteredInErrorAt: ts("entered_in_error_at"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export type ProcedureDefinitionRecord = typeof clinicProcedureDefinition.$inferSelect;
export type ClinicProcedureRecord = typeof clinicProcedure.$inferSelect;
