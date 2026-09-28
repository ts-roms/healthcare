import { bigint, boolean, date, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0026_inventory.sql and 0052_inventory_procurement.sql (the migrations are the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ITEM_CATEGORIES = ["medicine", "medical_supply", "reagent", "laboratory_consumable", "dental_supply", "ppe", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const MOVEMENT_KINDS = ["receipt", "issue", "transfer_out", "transfer_in", "adjustment", "write_off", "return"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
/** Workflows that move stock through the inventory contract (the movement names its source). */
export const MOVEMENT_SOURCES = ["prescription_dispense", "lab_reagent_load", "purchase_order_line"] as const;
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

export type PurchaseOrderRecord = typeof inventoryPurchaseOrder.$inferSelect;
export type PurchaseOrderLineRecord = typeof inventoryPurchaseOrderLine.$inferSelect;
export type ItemRecord = typeof inventoryItem.$inferSelect;
export type SupplierRecord = typeof inventorySupplier.$inferSelect;
export type LocationRecord = typeof inventoryLocation.$inferSelect;
export type LotRecord = typeof inventoryLot.$inferSelect;
export type MovementRecord = typeof inventoryMovement.$inferSelect;
