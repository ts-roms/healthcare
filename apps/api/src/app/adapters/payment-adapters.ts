import type { Provider } from "@nestjs/common";
import { PAYMENT_GATEWAY } from "@healthcare/billing";
import type { AppConfig } from "@healthcare/core";
import { PaymongoPaymentGateway } from "./paymongo-payment-gateway";

/**
 * The payment provider adapter for this deployment: PayMongo when its secret key is configured (the configuration
 * check requires its webhook secret and payment methods too); otherwise undefined, and billing keeps its unconfigured
 * adapter (no online payment).
 */
export function paymongoGatewayProvider(config: AppConfig): Provider | undefined {
  if (!config.PAYMONGO_SECRET_KEY || !config.PAYMONGO_WEBHOOK_SECRET || !config.PAYMONGO_PAYMENT_METHODS) return undefined;
  return {
    provide: PAYMENT_GATEWAY,
    useValue: new PaymongoPaymentGateway({
      secretKey: config.PAYMONGO_SECRET_KEY,
      webhookSecret: config.PAYMONGO_WEBHOOK_SECRET,
      methodTypes: config.PAYMONGO_PAYMENT_METHODS,
      apiBase: config.PAYMONGO_API_BASE,
    }),
  };
}
