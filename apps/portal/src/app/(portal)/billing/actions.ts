"use server";

import { headers } from "next/headers";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";

/**
 * Starts paying an invoice online and returns the payment provider's checkout address. The API checks the amount,
 * the invoice and that the return address is one of the platform's own; it refuses when no provider is configured.
 */
export async function startOnlinePayment(input: { invoiceId: string; amount: number; idempotencyKey: string }): Promise<Result<{ checkoutUrl: string }>> {
  if (!UUID.test(input.invoiceId) || !Number.isSafeInteger(input.amount) || input.amount < 1) return { ok: false, message: "Invalid payment." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001"}`;
  return run(async () => {
    const intent = await portalApi<{ checkoutUrl: string | null }>(`/portal/billing/${input.invoiceId}/online-payments`, {
      method: "POST",
      body: { amount: input.amount, idempotencyKey: input.idempotencyKey, returnUrl: `${origin}/billing?payment=returned` },
    });
    if (!intent.checkoutUrl) throw new Error("The payment provider did not return a checkout page.");
    return { checkoutUrl: intent.checkoutUrl };
  });
}
