import { bigint, boolean, date, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0026_inventory.sql, 0052_inventory_procurement.sql, 0057 (dental_procedure source),
// 0061 (costs on every movement, supplier invoices), 0074 (withholding, procurement methods, controlled register) and
// 0081 (the vaccine category and the immunization source); the migrations are the source of truth.

const ts = (name: string) => timestamp(name, { withTimezone: true });
/** Integer centavos (PHP). */
const money = (name: string) => bigint(name, { mode: "number" });

export const ITEM_CATEGORIES = ["medicine", "medical_supply", "reagent", "laboratory_consumable", "dental_supply", "ppe", "vaccine", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const MOVEMENT_KINDS = ["receipt", "issue", "transfer_out", "transfer_in", "adjustment", "write_off", "return"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
/** Workflows that move stock through the inventory contract (the movement names its source). */
export const MOVEMENT_SOURCES = ["prescription_dispense", "lab_reagent_load", "purchase_order_line", "dental_procedure", "immunization"] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];
export const PURCHASE_ORDER_STATUSES = ["draft", "submitted", "approved", "partially_received", "received", "cancelled", "closed"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
type Status = "active" | "inactive";

export const inventoryItem = pgTable("inventory_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").$type<ItemCategory>().notNull(),
  stockUnit: text("stock_unit").notNull(),
  tracksLots: boolean("tracks_lots").notNull().default(true),
  controlled: boolean("controlled").notNull().default(false),
  status: text("status").$type<Status>().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const inventorySupplier = pgTable("inventory_supplier", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  contact: text("contact"),
  status: text("status").$type<Status>().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const inventoryLocation = pgTable("inventory_location", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<Status>().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const inventoryLot = pgTable("inventory_lot", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  itemId: uuid("item_id").notNull(),
  lotNumber: text("lot_number"),
  expiryDate: date("expiry_date", { mode: "string" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const inventoryStockLevel = pgTable("inventory_stock_level", {
  organizationId: uuid("organization_id").notNull(),
  locationId: uuid("location_id").notNull(),
  itemId: uuid("item_id").notNull(),
  reorderLevel: integer("reorder_level").notNull(),
  reorderQuantity: integer("reorder_quantity"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const inventoryBalance = pgTable("inventory_balance", {
  organizationId: uuid("organization_id").notNull(),
  locationId: uuid("location_id").notNull(),
  itemId: uuid("item_id").notNull(),
  lotId: uuid("lot_id").notNull(),
  quantity: integer("quantity").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const inventoryMovement = pgTable("inventory_movement", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  movementGroupId: uuid("movement_group_id").notNull(),
  kind: text("kind").$type<MovementKind>().notNull(),
  locationId: uuid("location_id").notNull(),
  itemId: uuid("item_id").notNull(),
  lotId: uuid("lot_id").notNull(),
  quantity: integer("quantity").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  supplierId: uuid("supplier_id"),
  unitCost: bigint("unit_cost", { mode: "number" }),
  reference: text("reference"),
  issuedTo: text("issued_to"),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key"),
  sourceType: text("source_type").$type<MovementSource>(),
  sourceId: uuid("source_id"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export const inventoryNumberSequence = pgTable("inventory_number_sequence", {
  organizationId: uuid("organization_id").notNull(),
  series: text("series").$type<"purchase_order">().notNull(),
  year: integer("year").notNull(),
  nextValue: integer("next_value").notNull(),
});

export const inventoryPurchaseOrder = pgTable("inventory_purchase_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  poNumber: text("po_number").notNull(),
  supplierId: uuid("supplier_id").notNull(),
  locationId: uuid("location_id").notNull(),
  status: text("status").$type<PurchaseOrderStatus>().notNull().default("draft"),
  expectedDate: date("expected_date", { mode: "string" }),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  submittedBy: uuid("submitted_by"),
  submittedAt: ts("submitted_at"),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  endedBy: uuid("ended_by"),
  endedAt: ts("ended_at"),
  endReason: text("end_reason"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  // 0074: the organization's own procurement method and the reference it asks for.
  procurementMethodId: uuid("procurement_method_id"),
  procurementReference: text("procurement_reference"),
});

export const inventoryPurchaseOrderLine = pgTable("inventory_purchase_order_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  lineNumber: smallint("line_number").notNull(),
  itemId: uuid("item_id").notNull(),
  quantityOrdered: integer("quantity_ordered").notNull(),
  unitCost: bigint("unit_cost", { mode: "number" }),
  quantityReceived: integer("quantity_received").notNull().default(0),
});

export const SUPPLIER_INVOICE_STATUSES = ["recorded", "approved", "paid", "void"] as const;
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];

export const inventorySupplierInvoice = pgTable("inventory_supplier_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  supplierId: uuid("supplier_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  linesTotal: money("lines_total").notNull(),
  vatAmount: money("vat_amount").notNull().default(0),
  total: money("total").notNull(),
  notes: text("notes"),
  status: text("status").$type<SupplierInvoiceStatus>().notNull().default("recorded"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  approvalNote: text("approval_note"),
  paidOn: date("paid_on"),
  paymentReference: text("payment_reference"),
  paidRecordedBy: uuid("paid_recorded_by"),
  paidRecordedAt: ts("paid_recorded_at"),
  voidedBy: uuid("voided_by"),
  voidedAt: ts("voided_at"),
  voidReason: text("void_reason"),
  version: integer("version").notNull().default(1),
  // 0074: what was withheld at payment (entered by staff) under the organization's own code, and the certificate reference.
  withholdingCodeId: uuid("withholding_code_id"),
  withheldAmount: money("withheld_amount").notNull().default(0),
  withholdingReference: text("withholding_reference"),
});

export const inventorySupplierInvoiceLine = pgTable("inventory_supplier_invoice_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  amount: money("amount").notNull(),
});

// ---- Compliance configuration (0074) ------------------------------------------------------------------------------

/** The organization's own withholding codes; the rate is for reference only (staff enter the amount withheld). */
export const inventoryWithholdingCode = pgTable("inventory_withholding_code", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  rateBasisPoints: integer("rate_basis_points"),
  status: text("status").$type<Status>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The organization's own procurement methods; with a reference label, orders under it need that reference. */
export const inventoryProcurementMethod = pgTable("inventory_procurement_method", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  referenceLabel: text("reference_label"),
  status: text("status").$type<Status>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** What a facility prints on its register of controlled items, as recorded (not verified). */
export const inventoryControlledRegisterSetting = pgTable("inventory_controlled_register_setting", {
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").primaryKey(),
  licenceReference: text("licence_reference"),
  responsiblePerson: text("responsible_person"),
  note: text("note"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type WithholdingCodeRecord = typeof inventoryWithholdingCode.$inferSelect;
export type ProcurementMethodRecord = typeof inventoryProcurementMethod.$inferSelect;
export type SupplierInvoiceRecord = typeof inventorySupplierInvoice.$inferSelect;
export type SupplierInvoiceLineRecord = typeof inventorySupplierInvoiceLine.$inferSelect;
export type PurchaseOrderRecord = typeof inventoryPurchaseOrder.$inferSelect;
export type PurchaseOrderLineRecord = typeof inventoryPurchaseOrderLine.$inferSelect;
export type ItemRecord = typeof inventoryItem.$inferSelect;
export type SupplierRecord = typeof inventorySupplier.$inferSelect;
export type LocationRecord = typeof inventoryLocation.$inferSelect;
export type LotRecord = typeof inventoryLot.$inferSelect;
export type MovementRecord = typeof inventoryMovement.$inferSelect;
