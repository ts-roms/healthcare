import type { Actor, DbExecutor } from "@healthcare/core";

/**
 * Staff display names for "recorded by" lines. The clinic module provides it with the same adapter as the
 * immunization context (apps/api/src/app/adapters/immunization-adapters.ts).
 */
export interface ProcedureStaffNames {
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
}

export const PROCEDURE_STAFF_NAMES = Symbol("PROCEDURE_STAFF_NAMES");

// ---- supplies used, from inventory (migration 0087) -------------------------------------------------------------

export interface ProcedureSupplyItem {
  id: string;
  code: string;
  name: string;
  category: string;
  stockUnit: string;
  controlled: boolean;
  status: "active" | "inactive";
}

export interface ProcedureSupplyLocation {
  id: string;
  facilityId: string;
  code: string;
  name: string;
  status: "active" | "inactive";
}

/** One ledger row the inventory posted for a supply use (quantity positive), with what identifies the lot. */
export interface ProcedureSupplyMovement {
  movementId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  stockUnit: string;
  lotId: string;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
}

/**
 * Stock of supplies used in clinic procedures, implemented over the inventory library by the app
 * (apps/api/src/app/adapters/clinic-adapters.ts). `issue` and `return` run the inventory's own commands inside the
 * transaction the clinic passes: first expiry first out, never expired lots, balances never negative, controlled items
 * need a reason and a reference, only the categories in {@link CLINIC_SUPPLY_CATEGORIES}. A refusal throws and nothing
 * is committed on either side.
 */
export interface ProcedureSupplies {
  items(organizationId: string, itemIds?: string[]): Promise<ProcedureSupplyItem[]>;
  locations(organizationId: string, facilityId: string): Promise<ProcedureSupplyLocation[]>;
  location(organizationId: string, locationId: string): Promise<ProcedureSupplyLocation | undefined>;
  /** Usable (not expired) stock per location and item at a facility, on the facility's local date. */
  usableStock(organizationId: string, facilityId: string): Promise<Array<{ locationId: string; itemId: string; usable: number }>>;
  issue(
    tx: DbExecutor,
    actor: Actor,
    input: {
      locationId: string;
      procedureId: string;
      lines: Array<{ itemId: string; quantity: number; reason?: string; reference?: string }>;
      idempotencyKey: string;
    },
  ): Promise<{ movementGroupId: string; movements: ProcedureSupplyMovement[] }>;
  return(
    tx: DbExecutor,
    actor: Actor,
    input: {
      locationId: string;
      procedureId: string;
      lines: Array<{ itemId: string; lotId: string; quantity: number; reason: string; reference?: string }>;
      idempotencyKey: string;
    },
  ): Promise<{ movementGroupId: string; movements: ProcedureSupplyMovement[] }>;
}

export const PROCEDURE_SUPPLIES = Symbol("PROCEDURE_SUPPLIES");

/** How the stock ledger names where the supplies went: the procedure as source, never a patient identifier. */
export const CLINIC_PROCEDURE_SUPPLY_SOURCE = { type: "clinic_procedure", issuedTo: "Clinic procedure" } as const;

/**
 * Inventory categories a clinic procedure may use: medical supplies, medicines (e.g. a local anaesthetic), PPE and
 * other. Not dental supplies, laboratory reagents or consumables, or vaccines (each has its own workflow).
 */
export const CLINIC_SUPPLY_CATEGORIES = ["medical_supply", "medicine", "ppe", "other"] as const;
