import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { InstrumentProtocol, SpecimenIdField } from "./instrument-interface.ports";

// Analyzer interfaces (migration 0075; docs/domains/laboratory-instruments.md).

export const labInstrumentInterface = pgTable("lab_instrument_interface", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  instrumentId: uuid("instrument_id").notNull(),
  protocol: text("protocol").$type<InstrumentProtocol>().notNull(),
  specimenIdField: text("specimen_id_field").$type<SpecimenIdField>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type LabInstrumentInterfaceRecord = typeof labInstrumentInterface.$inferSelect;

export const labInstrumentTestCode = pgTable("lab_instrument_test_code", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  instrumentId: uuid("instrument_id").notNull(),
  analyzerCode: text("analyzer_code").notNull(),
  testId: uuid("test_id").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const labInstrumentMessage = pgTable("lab_instrument_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  instrumentId: uuid("instrument_id").notNull(),
  protocol: text("protocol").$type<InstrumentProtocol>().notNull(),
  controlId: text("control_id"),
  content: text("content").notNull(),
  outcome: text("outcome").$type<"read" | "rejected">().notNull(),
  errorCode: text("error_code"),
  resultCount: integer("result_count").notNull().default(0),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  receivedBy: uuid("received_by").notNull(),
});

export const INSTRUMENT_MATCH_PROBLEMS = ["no_specimen_id", "unknown_specimen", "no_test_code", "unmapped_code", "test_not_ordered"] as const;
export type InstrumentMatchProblem = (typeof INSTRUMENT_MATCH_PROBLEMS)[number];
export type InstrumentResultState = "pending" | "accepted" | "dismissed";

export const labInstrumentResult = pgTable("lab_instrument_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  instrumentId: uuid("instrument_id").notNull(),
  messageId: uuid("message_id").notNull(),
  sequence: integer("sequence").notNull(),
  specimenCode: text("specimen_code"),
  analyzerCode: text("analyzer_code"),
  valueRaw: text("value_raw").notNull(),
  unitsRaw: text("units_raw"),
  referenceRaw: text("reference_raw"),
  flagsRaw: text("flags_raw"),
  statusRaw: text("status_raw"),
  observedRaw: text("observed_raw"),
  patientId: uuid("patient_id"),
  specimenId: uuid("specimen_id"),
  orderItemId: uuid("order_item_id"),
  testId: uuid("test_id"),
  matchProblem: text("match_problem").$type<InstrumentMatchProblem>(),
  state: text("state").$type<InstrumentResultState>().notNull(),
  resultId: uuid("result_id"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  dismissReason: text("dismiss_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type LabInstrumentResultRecord = typeof labInstrumentResult.$inferSelect;
