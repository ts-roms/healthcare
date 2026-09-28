import type { Provider } from "@nestjs/common";
import type { ExchangeHandlerSet } from "@healthcare/interoperability";
import { PhilHealthEligibilityHandler, philhealthEligibilityGatewayProvider } from "./eligibility";
import { philhealthGatewayProvider } from "./gateway";
import { PhilHealthClaimHandler } from "./philhealth-claim-handler";

export interface PhilHealthExchangeHandlerOptions {
  /** The PhilHealth eClaims adapter (defaults to the unconfigured one). */
  gateway?: Provider;
  /** The PhilHealth eligibility adapter (defaults to the unconfigured one). */
  eligibilityGateway?: Provider;
}

/**
 * PhilHealth's worker side, for `IntegrationWorkerModule.forRoot({ handlerSets: [...] })`: claim submission and
 * eligibility inquiry handlers with their gateways.
 */
export function philhealthExchangeHandlers(options: PhilHealthExchangeHandlerOptions = {}): ExchangeHandlerSet {
  return {
    providers: [options.gateway ?? philhealthGatewayProvider, options.eligibilityGateway ?? philhealthEligibilityGatewayProvider],
    handlers: [PhilHealthClaimHandler, PhilHealthEligibilityHandler],
  };
}
