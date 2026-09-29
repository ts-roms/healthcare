/**
 * What billing needs from other domains, implemented by the app's composition
 * root (apps/api/src/app/adapters/billing-adapters.ts). Billing never reads or
 * writes clinical tables itself (libs/billing/CLAUDE.md).
 */

/** A signed encounter, as billing sees it: which visit type to charge, for whom, where and when. */
export interface BillableEncounter {
  id: string;
  patientId: string;
  facilityId: string;
  visitTypeCode: string | null;
  /** Local service date (YYYY-MM-DD, facility time). */
  serviceDate: string;
}

/** A laboratory order's billable items. */
export interface BillableLabOrder {
  id: string;
  patientId: string;
  facilityId: string;
  serviceDate: string;
  items: Array<{ id: string; testCode: string; testName: string }>;
}

/** A performed dental procedure: its code in the organization's dental catalog, and a description (procedure, tooth, surfaces). */
export interface BillableDentalProcedure {
  id: string;
  patientId: string;
  facilityId: string;
  procedureCode: string;
  description: string;
  serviceDate: string;
  /** Surfaces treated (0 for a whole-tooth or whole-mouth procedure): the quantity of a service charged per surface. */
  surfaceCount: number;
}

export interface BillingSources {
  encounter(organizationId: string, encounterId: string): Promise<BillableEncounter | undefined>;
  labOrder(organizationId: string, orderId: string): Promise<BillableLabOrder | undefined>;
  /** Undefined once the procedure has been marked entered in error. */
  dentalProcedure(organizationId: string, procedureId: string): Promise<BillableDentalProcedure | undefined>;
}
export const BILLING_SOURCES = Symbol("BILLING_SOURCES");

export interface BillingPatientBrief {
  patientNumber: string;
  displayName: string;
  sex: string;
  age: number;
}

/** Minimal patient identification for billing lists (number, name, sex, age). */
export interface BillingPatientDirectory {
  summaries(organizationId: string, patientIds: string[]): Promise<Map<string, BillingPatientBrief>>;
}
export const BILLING_PATIENTS = Symbol("BILLING_PATIENTS");
