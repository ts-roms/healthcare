import type { Actor, DbExecutor } from "@healthcare/core";

/** A lot of a vaccine in stock at a location of the facility (what staff choose to take a dose from). */
export interface VaccineStockLot {
  locationId: string;
  locationName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  stockUnit: string;
  lotId: string;
  lotNumber: string | null;
  /** YYYY-MM-DD, or null for an item without expiry. */
  expiryDate: string | null;
  quantity: number;
}

/** What was taken for a dose (one lot). */
export interface TakenVaccineStock {
  movementGroupId: string;
  itemId: string;
  itemName: string;
  lotNumber: string | null;
  expiryDate: string | null;
}

/**
 * What immunizations need from other domains, implemented by the app's composition root
 * (apps/api/src/app/adapters/immunization-adapters.ts): staff names, and vaccine stock from inventory taken and given
 * back inside the immunization's own transaction (inventory source `immunization`, once per record). The item
 * categories a dose may be taken from are the clinic's (`VACCINE_CATEGORIES`).
 */
export interface ImmunizationContext {
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
  /** Unexpired vaccine lots with stock at the facility's active locations. */
  vaccineStock(organizationId: string, facilityId: string): Promise<VaccineStockLot[]>;
  /** Takes the dose from the lot at the location, in the caller's transaction. */
  takeStock(
    tx: DbExecutor,
    actor: Actor,
    input: { immunizationId: string; locationId: string; lotId: string; quantity: number; reference: string },
  ): Promise<TakenVaccineStock>;
  /** Gives back everything the record took, to the same lots, in the caller's transaction (once). */
  returnStock(tx: DbExecutor, actor: Actor, input: { immunizationId: string; reason: string }): Promise<{ movementGroupId: string }>;
}

export const IMMUNIZATION_CONTEXT = Symbol("IMMUNIZATION_CONTEXT");

/** Inventory item categories a dose may be taken from (owned by the clinic; migration 0079 adds `vaccine`). */
export const VACCINE_CATEGORIES = ["vaccine"] as const;
