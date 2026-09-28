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
export type ChargeSourceType = "encounter" | "lab_order_item" | "manual" | "package";
export type SequenceKind = "invoice" | "receipt" | "credit_note" | "debit_note";
export const TAX_CLASSES = ["vatable", "vat_exempt", "zero_rated"] as const;
export type TaxClass = (typeof TAX_CLASSES)[number];
export type VatStatus = "not_configured" | "vat_registered" | "non_vat";
export type AccountEntryKind = "deposit" | "credit" | "application" | "release" | "refund" | "transfer_in" | "transfer_out";

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
  /** A package: its contents are in billing_package_item. */
  isPackage: boolean("is_package").notNull().default(false),
  packageValidityDays: integer("package_validity_days"),
  /** VAT class (null: not classified); configuration, see billing_organization_profile. */
  taxClass: text("tax_class").$type<TaxClass>(),
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
    kind: text("kind").$type<SequenceKind>().notNull(),
    prefix: text("prefix").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
    /** Last number the organization is authorized to use (none = no limit configured). */
    lastValue: bigint("last_value", { mode: "number" }),
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
  /** Covered by this package enrollment (charged at zero). */
  packageEnrollmentId: uuid("package_enrollment_id"),
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
  // Tax snapshot taken on issue from the organization's profile.
  taxStatus: text("tax_status").$type<VatStatus>(),
  vatRateBp: integer("vat_rate_bp"),
  sellerRegisteredName: text("seller_registered_name"),
  sellerTin: text("seller_tin"),
  sellerAddress: text("seller_address"),
  permitReference: text("permit_reference"),
  documentNote: text("document_note"),
  vatableSales: money("vatable_sales").notNull().default(0),
  vatAmount: money("vat_amount").notNull().default(0),
  vatExemptSales: money("vat_exempt_sales").notNull().default(0),
  zeroRatedSales: money("zero_rated_sales").notNull().default(0),
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
  taxClass: text("tax_class").$type<TaxClass>(),
  vatAmount: money("vat_amount").notNull().default(0),
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
  /** Staff who recorded it; none for a payment completed online (see paymentIntentId). */
  recordedBy: uuid("recorded_by"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  paymentIntentId: uuid("payment_intent_id"),
});

export const billingCreditNote = pgTable("billing_credit_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  creditNoteNumber: text("credit_note_number").notNull(),
  reason: text("reason").notNull(),
  amount: money("amount").notNull(),
  appliedAmount: money("applied_amount").notNull(),
  accountCredit: money("account_credit").notNull(),
  payerAmount: money("payer_amount").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  issuedBy: uuid("issued_by").notNull(),
  issuedAt: ts("issued_at").notNull().defaultNow(),
});

export const billingCreditNoteLine = pgTable("billing_credit_note_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  creditNoteId: uuid("credit_note_id").notNull(),
  /** The invoice line credited, or… */
  invoiceItemId: uuid("invoice_item_id"),
  /** …the debit note line credited. */
  debitNoteLineId: uuid("debit_note_line_id"),
  description: text("description").notNull(),
  amount: money("amount").notNull(),
});

/** The part of a credit note that reduces what a payer is expected to cover. */
export const billingCreditNotePayer = pgTable("billing_credit_note_payer", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  creditNoteId: uuid("credit_note_id").notNull(),
  invoicePayerId: uuid("invoice_payer_id").notNull(),
  amount: money("amount").notNull(),
});

export const billingDebitNote = pgTable("billing_debit_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  debitNoteNumber: text("debit_note_number").notNull(),
  reason: text("reason").notNull(),
  amount: money("amount").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  issuedBy: uuid("issued_by").notNull(),
  issuedAt: ts("issued_at").notNull().defaultNow(),
});

export const billingDebitNoteLine = pgTable("billing_debit_note_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  debitNoteId: uuid("debit_note_id").notNull(),
  serviceId: uuid("service_id"),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  amount: money("amount").notNull(),
});

/** The patient's account at a facility: deposits and credit, applied to invoices or refunded (append-only). */
export const billingAccountEntry = pgTable("billing_account_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  kind: text("kind").$type<AccountEntryKind>().notNull(),
  amount: money("amount").notNull(),
  method: text("method").$type<(typeof PAYMENT_METHODS)[number]>(),
  reference: text("reference"),
  receiptNumber: text("receipt_number"),
  invoiceId: uuid("invoice_id"),
  creditNoteId: uuid("credit_note_id"),
  applicationId: uuid("application_id"),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key"),
  recordedBy: uuid("recorded_by"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  paymentIntentId: uuid("payment_intent_id"),
  /** Balance moved between facilities: both entries share it. */
  transferId: uuid("transfer_id"),
  counterpartFacilityId: uuid("counterpart_facility_id"),
});

export const billingPackageItem = pgTable("billing_package_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  packageServiceId: uuid("package_service_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  quantity: integer("quantity").notNull(),
});

export const billingPackageEnrollment = pgTable("billing_package_enrollment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  packageServiceId: uuid("package_service_id").notNull(),
  status: text("status").$type<"active" | "cancelled">().notNull().default("active"),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }),
  cancelReason: text("cancel_reason"),
  soldBy: uuid("sold_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type PaymentIntentStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired";

/** A payment started online (MyHealth) and completed by the payment provider's notification. */
export const billingPaymentIntent = pgTable("billing_payment_intent", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  amount: money("amount").notNull(),
  status: text("status").$type<PaymentIntentStatus>().notNull().default("pending"),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference"),
  checkoutUrl: text("checkout_url"),
  requestedVia: text("requested_via").$type<"portal">().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  paidAmount: money("paid_amount"),
  failureCode: text("failure_code"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export type BillingChargeRecord = typeof billingCharge.$inferSelect;
export type BillingInvoiceRecord = typeof billingInvoice.$inferSelect;
export type BillingPaymentRecord = typeof billingPayment.$inferSelect;
export type BillingCreditNoteRecord = typeof billingCreditNote.$inferSelect;
export type BillingAccountEntryRecord = typeof billingAccountEntry.$inferSelect;
export type BillingDebitNoteRecord = typeof billingDebitNote.$inferSelect;
export type BillingPackageEnrollmentRecord = typeof billingPackageEnrollment.$inferSelect;
export type BillingPaymentIntentRecord = typeof billingPaymentIntent.$inferSelect;

/** The organization's own tax and document settings (BIR as configuration) and billing options. */
export const billingOrganizationProfile = pgTable("billing_organization_profile", {
  organizationId: uuid("organization_id").primaryKey(),
  registeredName: text("registered_name"),
  tin: text("tin"),
  businessAddress: text("business_address"),
  vatStatus: text("vat_status").$type<VatStatus>().notNull().default("not_configured"),
  vatRateBp: integer("vat_rate_bp"),
  permitReference: text("permit_reference"),
  documentNote: text("document_note"),
  depositsAcrossFacilities: boolean("deposits_across_facilities").notNull().default(false),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
