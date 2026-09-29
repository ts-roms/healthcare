import type { Actor, DbExecutor } from "@healthcare/core";

/**
 * What dentistry needs from other domains, implemented by the app's composition root
 * (apps/api/src/app/adapters/dental-adapters.ts). The dental library never reads clinic or patient tables: a dental
 * visit is a clinic encounter with a dentist, reached through this port.
 */

export interface DentalEncounter {
  id: string;
  patientId: string;
  facilityId: string;
  practitionerId: string;
  status: "in_progress" | "completed" | "entered_in_error";
}

export interface DentalPractitioner {
  id: string;
  displayName: string;
  profession: string;
}

export interface DentalPatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

/** A dentist's encounter on a day at a facility (the dental worklist). */
export interface DentalVisit {
  encounterId: string;
  patientId: string;
  practitionerId: string;
  practitionerName: string;
  status: DentalEncounter["status"];
  startedAt: Date;
  chiefComplaint: string | null;
}

export interface DentalContext {
  encounter(organizationId: string, encounterId: string): Promise<DentalEncounter | undefined>;
  /** The active practitioner linked to a staff account. */
  practitionerForUser(organizationId: string, userId: string): Promise<DentalPractitioner | undefined>;
  practitionerNames(organizationId: string, practitionerIds: string[]): Promise<Map<string, string>>;
  /** Display names of staff users (who recorded, who corrected). */
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
  /** Minimal identification; missing ids are omitted. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, DentalPatientBrief>>;
  /** Encounters of dentists at a facility on a local date. */
  dentalVisits(organizationId: string, facilityId: string, date: string): Promise<DentalVisit[]>;
}

export const DENTAL_CONTEXT = Symbol("DENTAL_CONTEXT");

// ---- supplies (inventory) ---------------------------------------------------------------------------

/** An inventory item as dentistry sees it (templates, the supplies picker). */
export interface DentalSupplyItem {
  id: string;
  code: string;
  name: string;
  category: string;
  stockUnit: string;
  controlled: boolean;
  status: "active" | "inactive";
}

export interface DentalSupplyLocation {
  id: string;
  facilityId: string;
  code: string;
  name: string;
  status: "active" | "inactive";
}

/** One ledger row the inventory posted for a supply use (quantity positive), with what identifies the lot. */
export interface DentalSupplyMovement {
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

export interface DentalSupplyIssue {
  locationId: string;
  procedureId: string;
  lines: Array<{ itemId: string; quantity: number; reason?: string; reference?: string }>;
  idempotencyKey: string;
}

export interface DentalSupplyReturn {
  locationId: string;
  procedureId: string;
  lines: Array<{ itemId: string; lotId: string; quantity: number; reason: string; reference?: string }>;
  idempotencyKey: string;
}

/**
 * Stock of dental supplies, implemented over the inventory library by the app (apps/api/src/app/adapters/
 * dental-adapters.ts). `issue` and `return` run the inventory's own commands inside the transaction dentistry passes
 * (one database, one transaction): first expiry first out, never expired lots, balances never negative, controlled
 * items need a reason and a reference. A refusal throws and nothing is committed on either side.
 */
export interface DentalSupplies {
  items(organizationId: string, itemIds?: string[]): Promise<DentalSupplyItem[]>;
  locations(organizationId: string, facilityId: string): Promise<DentalSupplyLocation[]>;
  location(organizationId: string, locationId: string): Promise<DentalSupplyLocation | undefined>;
  /** Usable (not expired) stock per location and item at a facility, on the facility's local date. */
  usableStock(organizationId: string, facilityId: string): Promise<Array<{ locationId: string; itemId: string; usable: number }>>;
  issue(tx: DbExecutor, actor: Actor, input: DentalSupplyIssue): Promise<{ movementGroupId: string; movements: DentalSupplyMovement[] }>;
  return(tx: DbExecutor, actor: Actor, input: DentalSupplyReturn): Promise<{ movementGroupId: string; movements: DentalSupplyMovement[] }>;
}

export const DENTAL_SUPPLIES = Symbol("DENTAL_SUPPLIES");

/** How the stock ledger names where dental supplies went: the procedure as source, never a patient identifier. */
export const DENTAL_SUPPLY_SOURCE = { type: "dental_procedure", issuedTo: "Dental procedure" } as const;

// ---- fees (billing's price list) --------------------------------------------------------------------

/** A procedure's listed price as billing would charge it on a date (the service mapped to the procedure code). */
export interface DentalListedFee {
  serviceCode: string;
  serviceName: string;
  /** Centavos, as on the price list (VAT-inclusive where VAT applies). */
  unitPrice: number;
  /** The price is per surface treated (billing charges the surfaces, at least one); otherwise per procedure. */
  perSurface: boolean;
}

/**
 * Listed prices for fee estimates, read from billing's price list by the app (apps/api/src/app/adapters/
 * dental-adapters.ts) with the mapping charge capture uses (service source `dental_procedure`, the procedure code).
 * Dentistry keeps no prices of its own; discounts, packages and payer coverage are billing's and are not applied.
 */
export interface DentalFees {
  /** By lower-cased procedure code; codes with no active mapped service or no price on the date are left out. */
  listedFees(organizationId: string, procedureCodes: readonly string[], onDate: string): Promise<Map<string, DentalListedFee>>;
}

export const DENTAL_FEES = Symbol("DENTAL_FEES");
