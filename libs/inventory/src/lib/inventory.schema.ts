import { bigint, boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0026_inventory.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ITEM_CATEGORIES = ["medicine", "medical_supply", "reagent", "laboratory_consumable", "dental_supply", "ppe", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const MOVEMENT_KINDS = ["receipt", "issue", "transfer_out", "transfer_in", "adjustment", "write_off"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
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
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export type ItemRecord = typeof inventoryItem.$inferSelect;
export type SupplierRecord = typeof inventorySupplier.$inferSelect;
export type LocationRecord = typeof inventoryLocation.$inferSelect;
export type LotRecord = typeof inventoryLot.$inferSelect;
export type MovementRecord = typeof inventoryMovement.$inferSelect;
