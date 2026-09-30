import { createHmac } from "node:crypto";
import {
  checkoutSessionBody,
  parseSignatureHeader,
  PaymongoPaymentGateway,
  readCheckoutSession,
  readPaidEvent,
  verifySignature,
} from "./paymongo-payment-gateway";

const WEBHOOK_SECRET = "whsk_test_secret";
const request = {
  intentId: "5d9f1a3e-0000-4000-8000-000000000001",
  amount: 125_050,
  currency: "PHP" as const,
  description: "Invoice INV-00000012",
  returnUrl: "https://myhealth.example.ph/billing?payment=returned",
};

function signed(body: string, t: number, which: "te" | "li" = "te", secret = WEBHOOK_SECRET) {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return which === "te" ? `t=${t},te=${sig},li=` : `t=${t},te=,li=${sig}`;
}

describe("PayMongo payment adapter", () => {
  it("asks for one line of the amount due, in centavos, returning to MyHealth either way", () => {
    expect(checkoutSessionBody(request, ["card", "gcash"])).toEqual({
      data: {
        attributes: {
          line_items: [{ name: "Invoice INV-00000012", quantity: 1, amount: 125_050, currency: "PHP" }],
          payment_method_types: ["card", "gcash"],
          success_url: request.returnUrl,
          cancel_url: request.returnUrl,
          description: "Invoice INV-00000012",
          reference_number: request.intentId,
        },
      },
    });
  });

  it("reads the session id and an https checkout URL, and refuses anything else", () => {
    expect(readCheckoutSession({ data: { id: "cs_abc", attributes: { checkout_url: "https://checkout.paymongo.com/cs_abc" } } })).toEqual({
      providerReference: "cs_abc",
      checkoutUrl: "https://checkout.paymongo.com/cs_abc",
    });
    expect(() => readCheckoutSession({ data: { id: "cs_abc", attributes: { checkout_url: "http://evil.example" } } })).toThrow();
    expect(() => readCheckoutSession({ data: {} })).toThrow();
  });

  it("parses the signature header", () => {
    expect(parseSignatureHeader("t=1700000000,te=abc,li=")).toEqual({ timestamp: 1700000000, test: "abc", live: null });
    expect(parseSignatureHeader("te=abc")).toBeNull();
  });

  it("verifies the test or live signature over '<t>.<raw body>' within the tolerance", () => {
    const body = '{"data":{"id":"evt_1"}}';
    const t = 1_800_000_000;
    const base = { rawBody: Buffer.from(body), webhookSecret: WEBHOOK_SECRET, nowSeconds: t + 10, toleranceSeconds: 300 };
    expect(verifySignature({ ...base, header: signed(body, t), live: false })).toBe(true);
    expect(verifySignature({ ...base, header: signed(body, t), live: true })).toBe(false);
    expect(verifySignature({ ...base, header: signed(body, t, "li"), live: true })).toBe(true);
    expect(verifySignature({ ...base, header: signed(body, t, "te", "other-secret"), live: false })).toBe(false);
    expect(verifySignature({ ...base, header: signed(body, t), live: false, rawBody: Buffer.from(body + " ") })).toBe(false);
    expect(verifySignature({ ...base, header: signed(body, t), live: false, nowSeconds: t + 301 })).toBe(false);
    expect(verifySignature({ ...base, header: undefined, live: false })).toBe(false);
    expect(verifySignature({ ...base, header: `t=${t},te=zz,li=`, live: false })).toBe(false);
  });

  it("completes a payment only on checkout_session.payment.paid", () => {
    const event = (type: string) => ({ data: { id: "evt_1", type: "event", attributes: { type, livemode: false, data: { id: "cs_abc" } } } });
    expect(readPaidEvent(event("checkout_session.payment.paid"))).toEqual({ providerReference: "cs_abc", outcome: "succeeded" });
    expect(readPaidEvent(event("payment.paid"))).toBeNull();
    expect(readPaidEvent({})).toBeNull();
  });

  it("creates a checkout with the secret key as Basic username and surfaces only the status on refusal", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
    const ok = new PaymongoPaymentGateway({ secretKey: "sk_test_abc", webhookSecret: WEBHOOK_SECRET, methodTypes: ["gcash"] }, async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: "cs_1", attributes: { checkout_url: "https://checkout.paymongo.com/cs_1" } } }),
      };
    });
    await expect(ok.createCheckout(request)).resolves.toEqual({ providerReference: "cs_1", checkoutUrl: "https://checkout.paymongo.com/cs_1" });
    expect(calls[0]!.url).toBe("https://api.paymongo.com/v1/checkout_sessions");
    expect(calls[0]!.headers["authorization"]).toBe(`Basic ${Buffer.from("sk_test_abc:").toString("base64")}`);

    const refused = new PaymongoPaymentGateway({ secretKey: "sk_test_abc", webhookSecret: WEBHOOK_SECRET, methodTypes: ["gcash"] }, async () => ({
      ok: false,
      status: 400,
      text: async () => '{"errors":[{"detail":"sensitive"}]}',
    }));
    await expect(refused.createCheckout(request)).rejects.toThrow("PayMongo refused the checkout session (HTTP 400)");
  });

  it("reads a verified webhook through the gateway, using the live signature for a live key", async () => {
    const t = 1_800_000_000;
    const body = JSON.stringify({ data: { id: "evt_2", attributes: { type: "checkout_session.payment.paid", data: { id: "cs_live" } } } });
    const gateway = new PaymongoPaymentGateway(
      { secretKey: "sk_live_abc", webhookSecret: WEBHOOK_SECRET, methodTypes: ["card"] },
      async () => ({ ok: true, status: 200, text: async () => "{}" }),
      () => t * 1000,
    );
    await expect(gateway.verifyNotification({ "paymongo-signature": signed(body, t, "li") }, Buffer.from(body))).resolves.toEqual({
      providerReference: "cs_live",
      outcome: "succeeded",
    });
    await expect(gateway.verifyNotification({ "paymongo-signature": signed(body, t, "te") }, Buffer.from(body))).resolves.toBeNull();
  });
});
