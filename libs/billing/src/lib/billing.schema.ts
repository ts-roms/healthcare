import { bigint, boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
/** Integer centavos (PHP). */
const money = (name: string) => bigint(name, { mode: "number" });

export const SERVICE_CATEGORIES = ["consultation", "procedure", "laboratory", "dental", "telemedicine", "supply", "other"] as const;
export const PAYER_TYPES = ["hmo", "philhealth", "insurance", "company", "other"] as const;
export const DISCOUNT_KINDS = ["senior_citizen", "pwd", "employee", "promotional", "other"] as const;
export const PAYMENT_METHODS = ["cash", "card", "e_wallet", "bank_transfer", "check", "other"] as const;
export const PAYER_STATUSES = ["pending", "submitted", "settled", "denied"] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type ChargeStatus = "pending" | "invoiced" | "cancelled";
export type InvoiceStatus = "draft" | "issued" | "void";
export type ChargeSourceType = "encounter" | "lab_order_item" | "manual";

export const billingService = pgTable("billing_service", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").$type<ServiceCategory>().notNull(),
  sourceKind: text("source_kind").$type<"visit_type" | "lab_test">(),
  sourceCode: text("source_code"),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const billingServicePrice = pgTable("billing_service_price", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  unitPrice: money("unit_price").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveUntil: date("effective_until", { mode: "string" }),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const billingPayer = pgTable("billing_payer", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  payerType: text("payer_type").$type<(typeof PAYER_TYPES)[number]>().notNull(),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const billingDiscountRule = pgTable("billing_discount_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<(typeof DISCOUNT_KINDS)[number]>().notNull(),
  statutory: boolean("statutory").notNull().default(false),
  rateBp: integer("rate_bp").notNull(),
  categories: text("categories").array().$type<ServiceCategory[]>().notNull().default([]),
  requiresEvidence: boolean("requires_evidence").notNull().default(false),
  stackable: boolean("stackable").notNull().default(false),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveUntil: date("effective_until", { mode: "string" }),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const billingSequence = pgTable(
  "billing_sequence",
  {
    organizationId: uuid("organization_id").notNull(),
    kind: text("kind").$type<"invoice" | "receipt">().notNull(),
    prefix: text("prefix").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.kind] })],
);

export const billingCharge = pgTable("billing_charge", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  sourceType: text("source_type").$type<ChargeSourceType>().notNull(),
  sourceId: uuid("source_id"),
  sourceGroupId: uuid("source_group_id"),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: money("unit_price").notNull(),
  priceId: uuid("price_id"),
  serviceDate: date("service_date", { mode: "string" }).notNull(),
  status: text("status").$type<ChargeStatus>().notNull().default("pending"),
  invoiceId: uuid("invoice_id"),
  cancelReason: text("cancel_reason"),
  capturedBy: uuid("captured_by"),
  capturedAt: ts("captured_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const billingInvoice = pgTable("billing_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  invoiceNumber: text("invoice_number"),
  status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
  grossTotal: money("gross_total").notNull().default(0),
  discountTotal: money("discount_total").notNull().default(0),
  netTotal: money("net_total").notNull().default(0),
  payerTotal: money("payer_total").notNull().default(0),
  patientTotal: money("patient_total").notNull().default(0),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  issuedAt: ts("issued_at"),
  issuedBy: uuid("issued_by"),
  voidedAt: ts("voided_at"),
  voidedBy: uuid("voided_by"),
  voidReason: text("void_reason"),
  replacedById: uuid("replaced_by_id"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const billingInvoiceItem = pgTable("billing_invoice_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  chargeId: uuid("charge_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  category: text("category").$type<ServiceCategory>().notNull(),
  description: text("description").notNull(),
  serviceDate: date("service_date", { mode: "string" }).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  grossAmount: money("gross_amount").notNull(),
  discountAmount: money("discount_amount").notNull().default(0),
  netAmount: money("net_amount").notNull(),
});

export const billingInvoiceDiscount = pgTable("billing_invoice_discount", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  ruleId: uuid("rule_id").notNull(),
  ruleCode: text("rule_code").notNull(),
  ruleName: text("rule_name").notNull(),
  rateBp: integer("rate_bp").notNull(),
  evidenceIdNumber: text("evidence_id_number"),
  evidenceNote: text("evidence_note"),
  amount: money("amount").notNull(),
  appliedBy: uuid("applied_by").notNull(),
  appliedAt: ts("applied_at").notNull().defaultNow(),
});

export const billingInvoicePayer = pgTable("billing_invoice_payer", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  payerId: uuid("payer_id").notNull(),
  amount: money("amount").notNull(),
  reference: text("reference"),
  status: text("status").$type<(typeof PAYER_STATUSES)[number]>().notNull().default("pending"),
  settledAmount: money("settled_amount"),
  statusNote: text("status_note"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
});

export const billingPayment = pgTable("billing_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  kind: text("kind").$type<"payment" | "refund">().notNull(),
  amount: money("amount").notNull(),
  method: text("method").$type<(typeof PAYMENT_METHODS)[number]>().notNull(),
  reference: text("reference"),
  receiptNumber: text("receipt_number"),
  refundOfId: uuid("refund_of_id"),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export type BillingChargeRecord = typeof billingCharge.$inferSelect;
export type BillingInvoiceRecord = typeof billingInvoice.$inferSelect;
export type BillingPaymentRecord = typeof billingPayment.$inferSelect;
