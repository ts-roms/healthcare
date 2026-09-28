import type { Provider } from "@nestjs/common";
import type { PAYMENT_METHODS } from "../billing.schema";

/**
 * Port for a payment provider (cards, e-wallets, online banking). No provider
 * has been chosen: that is an integration dependency, and the default adapter
 * below takes no payment. An adapter creates a hosted checkout (card data never
 * reaches the platform) and verifies the provider's notifications; no
 * provider-specific logic lives in the billing domain (libs/billing/CLAUDE.md).
 */
export interface PaymentProviderSpecification {
  /** The adapter's name, stored on each payment intent (lowercase, digits, hyphens). */
  provider: string;
  name: string;
  /** "dependency": no provider configured — online payment is not offered. */
  status: "dependency" | "configured";
  note: string;
}

export interface CheckoutRequest {
  /** The platform's payment intent; adapters pass it to the provider as their idempotency key. */
  intentId: string;
  amount: number;
  currency: "PHP";
  /** Shown to the patient on the checkout page (invoice number; no clinical detail). */
  description: string;
  /** Where the provider sends the patient back to (MyHealth). */
  returnUrl: string;
}

export interface CheckoutSession {
  providerReference: string;
  checkoutUrl: string;
}

/** What a verified provider notification says about one checkout. */
export interface ProviderPaymentEvent {
  providerReference: string;
  outcome: "succeeded" | "failed" | "cancelled" | "expired";
  /** Amount collected in centavos (defaults to the intent's amount). */
  amount?: number;
  method?: (typeof PAYMENT_METHODS)[number];
  /** The provider's transaction reference, kept on the payment. */
  externalReference?: string;
  failureCode?: string;
}

export interface PaymentGateway {
  readonly specification: PaymentProviderSpecification;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies a notification (signature over the raw body) and reads it; null when it is not authentic or not about a payment. */
  verifyNotification(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<ProviderPaymentEvent | null>;
}
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

/** The default adapter while no payment provider is chosen: it takes no payment and says so. */
export class UnconfiguredPaymentGateway implements PaymentGateway {
  readonly specification: PaymentProviderSpecification = {
    provider: "unconfigured",
    name: "Online payment",
    status: "dependency",
    note: "No payment provider has been chosen or contracted. Patients pay at the clinic's cashier.",
  };

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(new Error("No payment provider is configured"));
  }

  verifyNotification(): Promise<ProviderPaymentEvent | null> {
    return Promise.resolve(null);
  }
}

export const paymentGatewayProvider: Provider = { provide: PAYMENT_GATEWAY, useClass: UnconfiguredPaymentGateway };
