import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutRequest, CheckoutSession, PaymentGateway, PaymentProviderSpecification, ProviderPaymentEvent } from "@healthcare/billing";

/**
 * PayMongo adapter for the billing payment port (docs/domains/billing.md, "Online payment — PayMongo"): a hosted
 * Checkout Session per payment intent, and the signed `checkout_session.payment.paid` webhook completing it. Card and
 * e-wallet details are entered on PayMongo's page and never reach the platform.
 *
 * Built from PayMongo's public documentation as quoted by secondary sources (the documentation site was not reachable
 * from the build environment): `POST /v1/checkout_sessions` with HTTP Basic auth (secret key as username, blank
 * password), amounts in centavos, `data.id` and `data.attributes.checkout_url` in the response; webhooks signed in the
 * `Paymongo-Signature` header as `t=<timestamp>,te=<test signature>,li=<live signature>`, each an HMAC-SHA256 of
 * `<timestamp>.<raw body>` with the webhook's secret. Verify against PayMongo's test mode before taking live payments.
 */

/** Payment method types PayMongo's Checkout Session accepts; the merchant account must have each one enabled. */
export const PAYMONGO_METHOD_TYPES = ["card", "gcash", "grab_pay", "paymaya", "billease", "dob", "qrph"] as const;
export type PaymongoMethodType = (typeof PAYMONGO_METHOD_TYPES)[number];

export interface PaymongoConfig {
  secretKey: string;
  webhookSecret: string;
  methodTypes: PaymongoMethodType[];
  /** Defaults to https://api.paymongo.com/v1 (overridable for tests). */
  apiBase?: string;
  /** Oldest notification accepted, in seconds (replay protection). */
  toleranceSeconds?: number;
}

type Fetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const DEFAULT_API_BASE = "https://api.paymongo.com/v1";
const DEFAULT_TOLERANCE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;

/** The Checkout Session request body: one line for the amount due, returning the patient to MyHealth either way. */
export function checkoutSessionBody(request: CheckoutRequest, methodTypes: readonly PaymongoMethodType[]) {
  return {
    data: {
      attributes: {
        line_items: [{ name: request.description, quantity: 1, amount: request.amount, currency: request.currency }],
        payment_method_types: [...methodTypes],
        success_url: request.returnUrl,
        cancel_url: request.returnUrl,
        description: request.description,
        reference_number: request.intentId,
      },
    },
  };
}

/** Reads the session id and the hosted page's address from PayMongo's response; throws when either is missing. */
export function readCheckoutSession(body: unknown): CheckoutSession {
  const data = (body as { data?: { id?: unknown; attributes?: { checkout_url?: unknown } } } | null)?.data;
  const id = data?.id;
  const url = data?.attributes?.checkout_url;
  if (typeof id !== "string" || !id || typeof url !== "string" || !/^https:\/\//.test(url)) {
    throw new Error("PayMongo returned no checkout session id or checkout URL");
  }
  return { providerReference: id, checkoutUrl: url };
}

/** Parses `t=…,te=…,li=…`; null when the timestamp is missing. */
export function parseSignatureHeader(header: string): { timestamp: number; test: string | null; live: string | null } | null {
  const parts = new Map<string, string>();
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at > 0) parts.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const timestamp = Number(parts.get("t"));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return { timestamp, test: parts.get("te") || null, live: parts.get("li") || null };
}

/**
 * Verifies a webhook signature: the live signature for a live secret key (`sk_live_`), else the test signature, must
 * equal HMAC-SHA256(`<t>.<raw body>`) under the webhook secret, and the timestamp must be recent.
 */
export function verifySignature(input: {
  header: string | undefined;
  rawBody: Buffer;
  webhookSecret: string;
  live: boolean;
  nowSeconds: number;
  toleranceSeconds: number;
}): boolean {
  if (!input.header) return false;
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return false;
  if (Math.abs(input.nowSeconds - parsed.timestamp) > input.toleranceSeconds) return false;
  const given = input.live ? parsed.live : parsed.test;
  if (!given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac("sha256", input.webhookSecret).update(`${parsed.timestamp}.`).update(input.rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
}

/**
 * Reads a verified event. Only `checkout_session.payment.paid` completes a payment: the session id is the provider
 * reference. The amount collected is the session's single line (the intent's amount), so none is read from the event.
 * Anything else is not about a checkout this platform started (null).
 */
export function readPaidEvent(body: unknown): ProviderPaymentEvent | null {
  const attributes = (body as { data?: { attributes?: { type?: unknown; data?: { id?: unknown } } } } | null)?.data?.attributes;
  if (attributes?.type !== "checkout_session.payment.paid") return null;
  const sessionId = attributes.data?.id;
  if (typeof sessionId !== "string" || !sessionId) return null;
  return { providerReference: sessionId, outcome: "succeeded" };
}

export class PaymongoPaymentGateway implements PaymentGateway {
  readonly specification: PaymentProviderSpecification = {
    provider: "paymongo",
    name: "PayMongo",
    status: "configured",
    note: "Online payment through PayMongo's hosted checkout. Card and e-wallet details are entered on PayMongo's page.",
  };
  private readonly apiBase: string;
  private readonly live: boolean;

  constructor(
    private readonly config: PaymongoConfig,
    private readonly fetchFn: Fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    this.live = config.secretKey.startsWith("sk_live_");
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const response = await this.fetchFn(`${this.apiBase}/checkout_sessions`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.secretKey}:`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(checkoutSessionBody(request, this.config.methodTypes)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    // The provider's error body may echo request details; only the status is surfaced.
    if (!response.ok) throw new Error(`PayMongo refused the checkout session (HTTP ${response.status})`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("PayMongo returned an unreadable checkout session");
    }
    return readCheckoutSession(body);
  }

  verifyNotification(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<ProviderPaymentEvent | null> {
    const header = headers["paymongo-signature"];
    const authentic = verifySignature({
      header: Array.isArray(header) ? header[0] : header,
      rawBody,
      webhookSecret: this.config.webhookSecret,
      live: this.live,
      nowSeconds: Math.floor(this.now() / 1000),
      toleranceSeconds: this.config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    });
    if (!authentic) return Promise.resolve(null);
    try {
      return Promise.resolve(readPaidEvent(JSON.parse(rawBody.toString("utf8"))));
    } catch {
      return Promise.resolve(null);
    }
  }
}
