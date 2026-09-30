import type { Actor, DbExecutor } from "@healthcare/core";

/**
 * What prescribing needs from the clinic domain, implemented by the app's
 * composition root (the prescription library must not import clinic).
 */
export interface PrescribingContext {
  /** The active practitioner linked to a staff account. */
  prescriber(organizationId: string, userId: string): Promise<{ id: string; profession: string; displayName: string } | undefined>;
  encounter(
    organizationId: string,
    encounterId: string,
  ): Promise<
    { id: string; patientId: string; facilityId: string; status: "in_progress" | "completed" | "entered_in_error"; practitionerId: string } | undefined
  >;
  /** Active allergies and whether the allergy history has been reviewed. */
  allergies(organizationId: string, patientId: string): Promise<AllergyContext>;
  /** Practitioners' display names, for lists of prescriptions. */
  practitionerNames(organizationId: string, practitionerIds: string[]): Promise<Map<string, string>>;
  /** Minimal identification (to check who receives a dispense). Not audited by the adapter. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, { patientNumber: string; displayName: string; sex: string; age: number }>>;
}

export interface AllergyContext {
  status: "has_allergies" | "no_known_allergies" | "not_reviewed";
  allergies: Array<{ id: string; substance: string; category: string; criticality: string; reaction: string | null }>;
}

export const PRESCRIBING_CONTEXT = Symbol("PRESCRIBING_CONTEXT");

/**
 * What dispensing needs from inventory, implemented by the app's composition root. Stock is taken and given back
 * inside the dispensing transaction (the dispense and the stock movement commit together).
 */
export interface DispensingStock {
  /** Medicines and medical supplies with usable (unexpired) stock at the facility's active locations. */
  available(organizationId: string, facilityId: string): Promise<DispensableStock[]>;
  /** Takes stock first-expiry-first-out from a location of the actor's facility for a dispense. */
  take(
    tx: DbExecutor,
    actor: Actor,
    input: { dispenseId: string; locationId: string; itemId: string; quantity: number; reference: string; reason: string },
  ): Promise<DispensedStock>;
  /** Returns the stock a dispense took to the same lots, once. */
  giveBack(tx: DbExecutor, actor: Actor, input: { dispenseId: string; reason: string }): Promise<{ movementGroupId: string }>;
}

export interface DispensableStock {
  locationId: string;
  locationName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  stockUnit: string;
  controlled: boolean;
  quantity: number;
}

export interface DispensedStock {
  movementGroupId: string;
  item: { id: string; name: string; stockUnit: string; controlled: boolean };
  lots: Array<{ lotId: string; lotNumber: string | null; expiryDate: string | null; quantity: number }>;
}

export const DISPENSING_STOCK = Symbol("DISPENSING_STOCK");
