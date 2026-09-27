import type { ClaimSources } from "./claim-package";

/**
 * What the PhilHealth claims module needs from other domains, implemented by the
 * app's composition root (apps/api/src/app/adapters/philhealth-adapters.ts).
 * This library never reads or writes billing, patient or clinic tables.
 */
export interface PhilHealthClaimSources {
  /** The invoice, the patient and the billed encounters' diagnoses; undefined when the invoice does not exist. */
  forInvoice(organizationId: string, invoiceId: string): Promise<ClaimSources | undefined>;
}
export const PHILHEALTH_CLAIM_SOURCES = Symbol("PHILHEALTH_CLAIM_SOURCES");

/** Tells billing that PhilHealth acknowledged a claim (billing records the reference and the status). */
export interface PhilHealthBillingSink {
  claimSubmitted(input: { organizationId: string; invoiceId: string; invoicePayerId: string; reference: string; requestedBy: string }): Promise<void>;
}
export const PHILHEALTH_BILLING_SINK = Symbol("PHILHEALTH_BILLING_SINK");
