import type { ClaimSourcePatient, ClaimSources } from "./claim-package";
import type { YakapConsultation, YakapEncounterSource } from "./yakap";

/**
 * What the PhilHealth claims module needs from other domains, implemented by the
 * app's composition root (apps/api/src/app/adapters/philhealth-adapters.ts).
 * This library never reads or writes billing, patient or clinic tables.
 */
export interface PhilHealthClaimSources {
  /** The invoice, the patient and the billed encounters' diagnoses; undefined when the invoice does not exist. */
  forInvoice(organizationId: string, invoiceId: string): Promise<ClaimSources | undefined>;
  /** The patient's identity and PhilHealth PIN (eligibility checks); undefined when the patient does not exist. */
  patient(organizationId: string, patientId: string): Promise<ClaimSourcePatient | undefined>;
}
export const PHILHEALTH_CLAIM_SOURCES = Symbol("PHILHEALTH_CLAIM_SOURCES");

/** Tells billing that PhilHealth acknowledged a claim (billing records the reference and the status). */
export interface PhilHealthBillingSink {
  claimSubmitted(input: { organizationId: string; invoiceId: string; invoicePayerId: string; reference: string; requestedBy: string }): Promise<void>;
}
export const PHILHEALTH_BILLING_SINK = Symbol("PHILHEALTH_BILLING_SINK");

/**
 * What YAKAP needs from the clinic, prescriptions, laboratory and the patient record, implemented by the app's
 * composition root. This library never reads those domains' tables.
 */
export interface PhilHealthYakapSources {
  /** One consultation with the patient's identity, diagnoses, prescriptions and laboratory orders; undefined when it does not exist. */
  encounter(organizationId: string, encounterId: string): Promise<YakapEncounterSource | undefined>;
  /** The patient's consultations, newest first (not entered in error). */
  consultations(organizationId: string, patientId: string): Promise<YakapConsultation[]>;
}
export const PHILHEALTH_YAKAP_SOURCES = Symbol("PHILHEALTH_YAKAP_SOURCES");
