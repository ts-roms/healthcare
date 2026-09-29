import type { Actor, DbExecutor } from "@healthcare/core";

/**
 * What the laboratory needs from other domains, implemented by the app's
 * composition root (the laboratory library imports neither patient nor clinic).
 */
export interface LaboratoryContext {
  /** Minimal identification for worklists; missing ids are omitted. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, LabPatientBrief>>;
  /** Sex and birth date, to select age- and sex-specific reference ranges. */
  patientDemographics(organizationId: string, patientId: string): Promise<{ sex: string; birthDate: string } | undefined>;
  /** The active practitioner linked to a staff account (the ordering provider). */
  practitionerForUser(organizationId: string, userId: string): Promise<{ id: string; displayName: string } | undefined>;
  practitionerNames(organizationId: string, practitionerIds: string[]): Promise<Map<string, string>>;
  /** Display names of staff users (who collected, entered, verified, approved). */
  staffNames(organizationId: string, userIds: string[]): Promise<Map<string, string>>;
  /** Staff who enter results at the facility (holders of lab.result.enter), for competency records. */
  laboratoryStaff(organizationId: string, facilityId: string): Promise<Array<{ id: string; displayName: string }>>;
  /** An inventory lot (reagents are inventory items), to record which lot is loaded on an instrument. */
  inventoryLot(organizationId: string, lotId: string): Promise<LabInventoryLot | undefined>;
  /**
   * Takes a quantity of a reagent lot from a storage location of the actor's facility for a load, inside the load's
   * transaction (an inventory issue whose source is the load).
   */
  takeReagentStock(
    tx: DbExecutor,
    actor: Actor,
    input: { loadId: string; locationId: string; itemId: string; lotId: string; quantity: number; instrumentCode: string },
  ): Promise<{ movementGroupId: string }>;
  /** An inventory item, to configure a reagent's yield (tests per stock unit). */
  inventoryItem(
    organizationId: string,
    itemId: string,
  ): Promise<{ itemId: string; code: string; name: string; category: string; stockUnit: string; status: "active" | "inactive" } | undefined>;
  /** What the stock taken by reagent loads cost (by stock movement group; centavos; null when a lot has no cost). */
  reagentStockCosts(organizationId: string, movementGroupIds: string[]): Promise<Map<string, number | null>>;
  /** Reagent lots with stock at the facility (what can be loaded), earliest expiry first. */
  reagentLotsInStock(organizationId: string, facilityId: string): Promise<Array<LabInventoryLot & { quantity: number; stockUnit: string }>>;
  encounter(
    organizationId: string,
    encounterId: string,
  ): Promise<{ id: string; patientId: string; facilityId: string; status: "in_progress" | "completed" | "entered_in_error"; modality: string } | undefined>;
}

export interface LabInventoryLot {
  lotId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** The inventory item category; only "reagent" lots are loaded on instruments. */
  category: string;
  itemStatus: "active" | "inactive";
  lotNumber: string | null;
  expiryDate: string | null;
}

export interface LabPatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

export const LABORATORY_CONTEXT = Symbol("LABORATORY_CONTEXT");
