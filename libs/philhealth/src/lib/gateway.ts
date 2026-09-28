import type { Provider } from "@nestjs/common";
import type { ExchangeOutcome, ExchangeReason, IntegrationSpecification } from "@healthcare/interoperability";
import type { PhilHealthClaimPackage } from "./claim-package";

export type GatewayReason = ExchangeReason;
export type ClaimSubmissionOutcome = ExchangeOutcome;

/**
 * Port for submitting a prepared claim to PhilHealth. An adapter translates the
 * platform's format-neutral claim package into the official eClaims format and
 * transport — which are an integration dependency (no specification on record).
 * Adapters must be idempotent per `idempotencyKey`. The API reads `specification`;
 * the integration worker calls `submitClaim`.
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

/** The configured adapter: the unconfigured one until an adapter exists (used by both the API and the worker). */
export const philhealthGatewayProvider: Provider = { provide: PHILHEALTH_CLAIMS_GATEWAY, useClass: UnconfiguredPhilHealthGateway };
