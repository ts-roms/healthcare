"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { BillingCharge, BillingPayer, BillingService, DiscountRule, InvoiceDetail, LedgerEntry } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call
// (permissions, facility, invoice state, amounts). Amounts are integer centavos.

const id = z.uuid();
const version = z.number().int().positive();
const centavos = z.number().int().min(0);
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500);
const methods = z.enum(["cash", "card", "e_wallet", "bank_transfer", "check", "other"]);

function invalid(error: z.ZodError): { ok: false; message: string } {
  return { ok: false, message: error.issues[0]?.message ?? "Invalid request." };
}

async function run<T>(schema: z.ZodType, input: unknown, call: () => Promise<T>, paths: string[] = []): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await actionResult(call);
  if (result.ok) for (const path of paths) revalidatePath(path);
  return result;
}

// ---- charges and drafts --------------------------------------------------------------------------

const createInvoiceSchema = z.object({ patientId: id, chargeIds: z.array(id).min(1).optional() });
export async function createInvoice(input: z.input<typeof createInvoiceSchema>) {
  return run(createInvoiceSchema, input, () => api<InvoiceDetail>("/billing/invoices", { method: "POST", body: input }), ["/billing"]);
}

const chargeSchema = z.object({
  patientId: id,
  serviceId: id,
  quantity: z.number().int().min(1).max(1000),
  unitPrice: centavos.optional(),
  priceOverrideReason: reason.optional(),
});
export async function addCharge(input: z.input<typeof chargeSchema>) {
  return run(chargeSchema, input, () => api<BillingCharge>("/billing/charges", { method: "POST", body: input }), ["/billing"]);
}

const cancelChargeSchema = z.object({ chargeId: id, reason, version });
export async function cancelCharge(input: z.input<typeof cancelChargeSchema>) {
  const { chargeId, ...body } = input;
  return run(cancelChargeSchema, input, () => api<BillingCharge>(`/billing/charges/${chargeId}/cancel`, { method: "POST", body }), ["/billing"]);
}

// ---- invoice workspace ---------------------------------------------------------------------------

const lineSchema = z.object({ invoiceId: id, lineId: id, version });
export async function removeLine(input: z.input<typeof lineSchema>) {
  return run(lineSchema, input, () =>
    api<InvoiceDetail>(`/billing/invoices/${input.invoiceId}/items/${input.lineId}`, { method: "DELETE", query: { version: String(input.version) } }),
  );
}

const discountSchema = z.object({
  invoiceId: id,
  ruleId: id,
  evidenceIdNumber: z.string().trim().min(3).max(40).optional(),
  evidenceNote: z.string().trim().max(200).optional(),
  version,
});
export async function applyDiscount(input: z.input<typeof discountSchema>) {
  const { invoiceId, ...body } = input;
  return run(discountSchema, input, () => api<InvoiceDetail>(`/billing/invoices/${invoiceId}/discounts`, { method: "POST", body }));
}

export async function removeDiscount(input: z.input<typeof lineSchema>) {
  return run(lineSchema, input, () =>
    api<InvoiceDetail>(`/billing/invoices/${input.invoiceId}/discounts/${input.lineId}`, { method: "DELETE", query: { version: String(input.version) } }),
  );
}

const payerSchema = z.object({ invoiceId: id, payerId: id, amount: centavos.min(1), reference: z.string().trim().min(1).max(60).optional(), version });
export async function setPayer(input: z.input<typeof payerSchema>) {
  const { invoiceId, ...body } = input;
  return run(payerSchema, input, () => api<InvoiceDetail>(`/billing/invoices/${invoiceId}/payers`, { method: "POST", body }));
}

export async function removePayer(input: z.input<typeof lineSchema>) {
  return run(lineSchema, input, () =>
    api<InvoiceDetail>(`/billing/invoices/${input.invoiceId}/payers/${input.lineId}`, { method: "DELETE", query: { version: String(input.version) } }),
  );
}

const versionSchema = z.object({ invoiceId: id, version });
export async function issueInvoice(input: z.input<typeof versionSchema>) {
  return run(
    versionSchema,
    input,
    () => api<InvoiceDetail>(`/billing/invoices/${input.invoiceId}/issue`, { method: "POST", body: { version: input.version } }),
    ["/billing"],
  );
}

export async function discardInvoice(input: z.input<typeof versionSchema>) {
  return run(versionSchema, input, () => api<null>(`/billing/invoices/${input.invoiceId}/discard`, { method: "POST", body: { version: input.version } }), [
    "/billing",
  ]);
}

const voidSchema = z.object({ invoiceId: id, reason, version, reissue: z.boolean() });
export async function voidInvoice(input: z.input<typeof voidSchema>) {
  const { invoiceId, ...body } = input;
  return run(
    voidSchema,
    input,
    () => api<{ voided: InvoiceDetail; replacement: InvoiceDetail | null }>(`/billing/invoices/${invoiceId}/void`, { method: "POST", body }),
    ["/billing"],
  );
}

const claimSchema = z.object({
  invoiceId: id,
  coverageId: id,
  status: z.enum(["submitted", "settled", "denied"]),
  settledAmount: centavos.optional(),
  reference: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().max(500).optional(),
});
export async function updateClaim(input: z.input<typeof claimSchema>) {
  const { invoiceId, coverageId, ...body } = input;
  return run(claimSchema, input, () => api<InvoiceDetail>(`/billing/invoices/${invoiceId}/payers/${coverageId}/status`, { method: "POST", body }));
}

// ---- payments ------------------------------------------------------------------------------------

const paymentSchema = z.object({
  invoiceId: id,
  amount: centavos.min(1),
  method: methods,
  reference: z.string().trim().min(1).max(60).optional(),
  idempotencyKey: z.string().min(8).max(100),
});
export async function recordPayment(input: z.input<typeof paymentSchema>) {
  const { invoiceId, ...body } = input;
  return run(paymentSchema, input, () => api<LedgerEntry>(`/billing/invoices/${invoiceId}/payments`, { method: "POST", body }), ["/billing"]);
}

const refundSchema = z.object({
  paymentId: id,
  amount: centavos.min(1),
  method: methods,
  reason,
  reference: z.string().trim().min(1).max(60).optional(),
  idempotencyKey: z.string().min(8).max(100),
});
export async function refundPayment(input: z.input<typeof refundSchema>) {
  const { paymentId, ...body } = input;
  return run(refundSchema, input, () => api<LedgerEntry>(`/billing/payments/${paymentId}/refund`, { method: "POST", body }), ["/billing"]);
}

// ---- settings ------------------------------------------------------------------------------------

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lowercase letters, digits or hyphens.");
const date = z.iso.date();
const categories = z.enum(["consultation", "procedure", "laboratory", "dental", "telemedicine", "supply", "other"]);

const serviceSchema = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  category: categories,
  sourceKind: z.enum(["visit_type", "lab_test"]).optional(),
  sourceCode: z.string().trim().min(1).max(60).optional(),
  unitPrice: centavos,
  effectiveFrom: date,
});
export async function createService(input: z.input<typeof serviceSchema>) {
  return run(serviceSchema, input, () => api<BillingService>("/billing/services", { method: "POST", body: input }), ["/billing/settings"]);
}

const priceSchema = z.object({ serviceId: id, unitPrice: centavos, effectiveFrom: date });
export async function addPrice(input: z.input<typeof priceSchema>) {
  const { serviceId, ...body } = input;
  return run(priceSchema, input, () => api(`/billing/services/${serviceId}/prices`, { method: "POST", body }), ["/billing/settings"]);
}

const serviceStatusSchema = z.object({ serviceId: id, status: z.enum(["active", "inactive"]), version });
export async function setServiceStatus(input: z.input<typeof serviceStatusSchema>) {
  const { serviceId, ...body } = input;
  return run(serviceStatusSchema, input, () => api<BillingService>(`/billing/services/${serviceId}`, { method: "PATCH", body }), ["/billing/settings"]);
}

const payerCreateSchema = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  payerType: z.enum(["hmo", "philhealth", "insurance", "company", "other"]),
});
export async function createPayer(input: z.input<typeof payerCreateSchema>) {
  return run(payerCreateSchema, input, () => api<BillingPayer>("/billing/payers", { method: "POST", body: input }), ["/billing/settings"]);
}

const ruleSchema = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["senior_citizen", "pwd", "employee", "promotional", "other"]),
  statutory: z.boolean(),
  rateBp: z.number().int().min(1).max(10_000),
  categories: z.array(categories),
  requiresEvidence: z.boolean(),
  stackable: z.boolean(),
  effectiveFrom: date,
});
export async function createDiscountRule(input: z.input<typeof ruleSchema>) {
  return run(ruleSchema, input, () => api<DiscountRule>("/billing/discount-rules", { method: "POST", body: input }), ["/billing/settings"]);
}

const ruleIdSchema = z.object({ ruleId: id });
export async function deactivateDiscountRule(input: z.input<typeof ruleIdSchema>) {
  return run(ruleIdSchema, input, () => api<DiscountRule>(`/billing/discount-rules/${input.ruleId}/deactivate`, { method: "POST" }), ["/billing/settings"]);
}

const prefixSchema = z.object({ invoicePrefix: z.string().trim().min(1).max(12), receiptPrefix: z.string().trim().min(1).max(12) });
export async function updatePrefixes(input: z.input<typeof prefixSchema>) {
  return run(prefixSchema, input, () => api("/billing/settings", { method: "PUT", body: input }), ["/billing/settings"]);
}
