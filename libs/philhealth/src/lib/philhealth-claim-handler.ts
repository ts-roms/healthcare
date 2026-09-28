import { Inject, Injectable } from "@nestjs/common";
import type { ExchangeHandler, ExchangeOutcome } from "@healthcare/interoperability";
import type { PhilHealthClaimPackage } from "./claim-package";
import { PHILHEALTH_CLAIMS_GATEWAY, PHILHEALTH_ECLAIMS_SYSTEM, type PhilHealthClaimsGateway } from "./gateway";

export const SUBMIT_CLAIM = "submit_claim";

/** Worker side: sends a prepared claim package through the configured eClaims gateway. */
@Injectable()
export class PhilHealthClaimHandler implements ExchangeHandler {
  readonly system = PHILHEALTH_ECLAIMS_SYSTEM;
  readonly operation = SUBMIT_CLAIM;

  constructor(@Inject(PHILHEALTH_CLAIMS_GATEWAY) private readonly gateway: PhilHealthClaimsGateway) {}

  send(payload: unknown, idempotencyKey: string): Promise<ExchangeOutcome> {
    return this.gateway.submitClaim(payload as PhilHealthClaimPackage, idempotencyKey);
  }
}
