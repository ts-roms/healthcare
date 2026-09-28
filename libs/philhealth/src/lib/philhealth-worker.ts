import type { Provider } from "@nestjs/common";
import type { ExchangeHandlerSet } from "@healthcare/interoperability";
import { PhilHealthEligibilityHandler, philhealthEligibilityGatewayProvider } from "./eligibility";
import { philhealthGatewayProvider } from "./gateway";
import { PhilHealthClaimHandler } from "./philhealth-claim-handler";
import { PhilHealthYakapHandler, philhealthYakapGatewayProvider } from "./yakap";

export interface PhilHealthExchangeHandlerOptions {
  /** The PhilHealth eClaims adapter (defaults to the unconfigured one). */
  gateway?: Provider;
  /** The PhilHealth eligibility adapter (defaults to the unconfigured one). */
  eligibilityGateway?: Provider;
  /** The PhilHealth YAKAP adapter (defaults to the unconfigured one). */
  yakapGateway?: Provider;
}

/**
 * PhilHealth's worker side, for `IntegrationWorkerModule.forRoot({ handlerSets: [...] })`: claim submission,
 * eligibility inquiry and YAKAP encounter package handlers with their gateways.
 */
export function philhealthExchangeHandlers(options: PhilHealthExchangeHandlerOptions = {}): ExchangeHandlerSet {
  return {
    providers: [
      options.gateway ?? philhealthGatewayProvider,
      options.eligibilityGateway ?? philhealthEligibilityGatewayProvider,
      options.yakapGateway ?? philhealthYakapGatewayProvider,
    ],
    handlers: [PhilHealthClaimHandler, PhilHealthEligibilityHandler, PhilHealthYakapHandler],
  };
}
