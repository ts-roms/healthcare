import type { PhilHealthClaimPackage } from "./claim-package";

/**
 * Where an external specification stands (docs/interoperability/dependencies.md):
 * "dependency" — not obtained, nothing is transmitted; "stubbed" — an adapter exists against a documented but
 * uncertified specification; "implemented"; "certified" — accepted by the external party.
 */
export type SpecificationStatus = "dependency" | "stubbed" | "implemented" | "certified";

export interface IntegrationSpecification {
  system: string;
  name: string;
  status: SpecificationStatus;
  /** The external specification's own version, once obtained. */
  specificationVersion: string | null;
  note: string;
}

/** Reasons or codes returned by the external system; no clinical free text. */
export interface GatewayReason {
  code: string;
  message: string;
}

export type ClaimSubmissionOutcome =
  | { outcome: "accepted"; externalReference: string }
  | { outcome: "rejected"; reasons: GatewayReason[] }
  | { outcome: "failed"; retryable: boolean; error: string }
  | { outcome: "not_configured" };

/**
 * Port for submitting a prepared claim to PhilHealth. An adapter translates the
 * platform's format-neutral claim package into the official eClaims format and
 * transport — which are an integration dependency (no specification on record).
 * Adapters must be idempotent per `idempotencyKey`.
 */
export interface PhilHealthClaimsGateway {
  readonly specification: IntegrationSpecification;
  submitClaim(claim: PhilHealthClaimPackage, idempotencyKey: string): Promise<ClaimSubmissionOutcome>;
}
export const PHILHEALTH_CLAIMS_GATEWAY = Symbol("PHILHEALTH_CLAIMS_GATEWAY");

export const PHILHEALTH_ECLAIMS_SYSTEM = "philhealth-eclaims";

/**
 * The default adapter while no official eClaims specification is available: it
 * transmits nothing and says so. It must not be replaced by a guessed format.
 */
export class UnconfiguredPhilHealthGateway implements PhilHealthClaimsGateway {
  readonly specification: IntegrationSpecification = {
    system: PHILHEALTH_ECLAIMS_SYSTEM,
    name: "PhilHealth eClaims",
    status: "dependency",
    specificationVersion: null,
    note: "The official eClaims specification and access credentials have not been obtained. Claims can be prepared and checked, but not transmitted.",
  };

  submitClaim(): Promise<ClaimSubmissionOutcome> {
    return Promise.resolve({ outcome: "not_configured" });
  }
}
