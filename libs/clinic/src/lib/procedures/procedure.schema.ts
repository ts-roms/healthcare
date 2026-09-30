import { boolean, date, integer, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0085_clinic_procedures.sql and 0088_clinic_procedure_supplies.sql (the migrations are the source of truth).

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

// ---- supplies used, from inventory (0088) ----------------------------------------------------------------------

/** The supplies a catalogue entry usually uses (configuration; staff confirm what was used each time). */
export const clinicProcedureSupplyTemplateItem = pgTable(
  "clinic_procedure_supply_template_item",
  {
    organizationId: uuid("organization_id").notNull(),
    definitionId: uuid("definition_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    position: smallint("position").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.definitionId, table.inventoryItemId] })],
);

export type ProcedureSupplyUseKind = "issue" | "return";

/** One confirmation of supplies used, or a return of unused ones (append-only). */
export const clinicProcedureSupplyUse = pgTable("clinic_procedure_supply_use", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  procedureId: uuid("procedure_id").notNull(),
  kind: text("kind").$type<ProcedureSupplyUseKind>().notNull(),
  locationId: uuid("location_id").notNull(),
  reason: text("reason"),
  movementGroupId: uuid("movement_group_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});
export type ProcedureSupplyUseRecord = typeof clinicProcedureSupplyUse.$inferSelect;

/** What was issued or returned, by item and lot (append-only). */
export const clinicProcedureSupplyUseLine = pgTable("clinic_procedure_supply_use_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  supplyUseId: uuid("supply_use_id").notNull(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  inventoryLotId: uuid("inventory_lot_id").notNull(),
  inventoryMovementId: uuid("inventory_movement_id").notNull(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull(),
  stockUnit: text("stock_unit").notNull(),
  lotNumber: text("lot_number"),
  expiryDate: date("expiry_date", { mode: "string" }),
  quantity: integer("quantity").notNull(),
  returnsLineId: uuid("returns_line_id"),
});
export type ProcedureSupplyUseLineRecord = typeof clinicProcedureSupplyUseLine.$inferSelect;
