import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  CHARGE_UNITS,
  DISCOUNT_KINDS,
  PAYER_STATUSES,
  PAYER_TYPES,
  PAYMENT_METHODS,
  SERVICE_CATEGORIES,
  SERVICE_SOURCE_KINDS,
  TAX_CLASSES,
} from "./billing.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use lower-case letters, digits or hyphens");
const text = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().min(3, "Give a reason").max(500);
/** Integer centavos. */
const centavos = z.number().int().min(0).max(100_000_000_000);
const positiveCentavos = centavos.min(1);
const version = z.number().int().positive();

// ---- catalog ----------------------------------------------------------------------------------

export const createServiceSchema = z
  .object({
    code,
    name: text(200),
    category: z.enum(SERVICE_CATEGORIES),
    sourceKind: z.enum(SERVICE_SOURCE_KINDS).optional(),
    sourceCode: z.string().trim().toLowerCase().min(1).max(60).optional(),
    unitPrice: centavos,
    effectiveFrom: z.iso.date(),
    /** VAT class, for a VAT-registered organization (configuration; see the tax profile). */
    taxClass: z.enum(TAX_CLASSES).optional(),
    /** Per item (default), or per surface treated for a service mapped to a dental procedure. */
    chargeUnit: z.enum(CHARGE_UNITS).default("each"),
  })
  .refine((v) => (v.sourceKind === undefined) === (v.sourceCode === undefined), {
    message: "Give both the source kind and its code, or neither",
    path: ["sourceCode"],
  })
  .refine((v) => v.chargeUnit === "each" || v.sourceKind === "dental_procedure", {
    message: "Only a service charged for a dental procedure can be priced per surface",
    path: ["chargeUnit"],
  });
export class CreateServiceDto extends createZodDto(createServiceSchema) {}

export const updateServiceSchema = z.object({
  name: text(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  /** null clears the class. */
  taxClass: z.enum(TAX_CLASSES).nullable().optional(),
  /** From the next charge on; per surface only for a service mapped to a dental procedure. */
  chargeUnit: z.enum(CHARGE_UNITS).optional(),
  version,
});
export class UpdateServiceDto extends createZodDto(updateServiceSchema) {}

export const addPriceSchema = z.object({ unitPrice: centavos, effectiveFrom: z.iso.date() });
export class AddPriceDto extends createZodDto(addPriceSchema) {}

export const createPayerSchema = z.object({ code, name: text(200), payerType: z.enum(PAYER_TYPES) });
export class CreatePayerDto extends createZodDto(createPayerSchema) {}

export const createDiscountRuleSchema = z.object({
  code,
  name: text(200),
  kind: z.enum(DISCOUNT_KINDS),
  statutory: z.boolean().default(false),
  rateBp: z.number().int().min(1).max(10_000),
  categories: z.array(z.enum(SERVICE_CATEGORIES)).max(SERVICE_CATEGORIES.length).default([]),
  requiresEvidence: z.boolean().default(false),
  stackable: z.boolean().default(false),
  effectiveFrom: z.iso.date(),
  effectiveUntil: z.iso.date().optional(),
});
export class CreateDiscountRuleDto extends createZodDto(createDiscountRuleSchema) {}

const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,12}$/);
export const updateSettingsSchema = z.object({
  invoicePrefix: prefix,
  receiptPrefix: prefix,
  /** Unchanged when omitted. */
  creditNotePrefix: prefix.optional(),
  debitNotePrefix: prefix.optional(),
  /** The last number of each series the organization is authorized to use (null = no limit); unchanged when omitted. */
  lastNumbers: z
    .object({
      invoice: z.number().int().positive().nullable().optional(),
      receipt: z.number().int().positive().nullable().optional(),
      credit_note: z.number().int().positive().nullable().optional(),
      debit_note: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});

/** The organization's tax and document settings, as its registration says (BIR as configuration; nothing is assumed). */
export const updateTaxProfileSchema = z
  .object({
    registeredName: z.string().trim().min(1).max(200).nullable(),
    tin: z
      .string()
      .trim()
      .regex(/^[0-9][0-9-]{7,19}$/, "Digits and hyphens, as registered")
      .nullable(),
    businessAddress: z.string().trim().min(1).max(300).nullable(),
    vatStatus: z.enum(["not_configured", "vat_registered", "non_vat"]),
    /** Basis points (1200 = 12%), only when VAT-registered. */
    vatRateBp: z.number().int().min(1).max(10_000).nullable(),
    permitReference: z.string().trim().min(1).max(120).nullable(),
    documentNote: z.string().trim().max(500).nullable(),
    depositsAcrossFacilities: z.boolean(),
    /** The profile's version (omit the first time). */
    version: version.optional(),
  })
  .refine((v) => (v.vatStatus === "vat_registered") === (v.vatRateBp !== null), {
    message: "A VAT-registered organization enters its VAT rate (and only then)",
    path: ["vatRateBp"],
  });
export class UpdateTaxProfileDto extends createZodDto(updateTaxProfileSchema) {}
export class UpdateSettingsDto extends createZodDto(updateSettingsSchema) {}

// ---- charges ----------------------------------------------------------------------------------

export const listChargesSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(["pending", "invoiced", "cancelled"]).optional(),
});
export class ListChargesDto extends createZodDto(listChargesSchema) {}

export const manualChargeSchema = z.object({
  patientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000).default(1),
  /** Only when the service has no price for the date, or with a reason (e.g. a quoted package price). */
  unitPrice: centavos.optional(),
  priceOverrideReason: reason.optional(),
  serviceDate: z.iso.date().optional(),
  description: text(200).optional(),
  /** Use a package the patient bought when it covers the service (not with another price). */
  usePackage: z.boolean().default(true),
});
export class ManualChargeDto extends createZodDto(manualChargeSchema) {}

// ---- packages ---------------------------------------------------------------------------------

export const createPackageSchema = z.object({
  code,
  name: text(200),
  category: z.enum(SERVICE_CATEGORIES),
  /** The package price (a versioned price of the package's own service). */
  unitPrice: centavos,
  effectiveFrom: z.iso.date(),
  /** Days it can be used from the sale, counting that day; none = until used up or cancelled. */
  validityDays: z.number().int().min(1).max(3660).optional(),
  /** VAT class of the package itself, for a VAT-registered organization (configuration). */
  taxClass: z.enum(TAX_CLASSES).optional(),
  items: z
    .array(z.object({ serviceId: z.string().uuid(), quantity: z.number().int().min(1).max(1000).default(1) }))
    .min(1)
    .max(50),
});
export class CreatePackageDto extends createZodDto(createPackageSchema) {}

export const sellPackageSchema = z.object({ packageServiceId: z.string().uuid() });
export class SellPackageDto extends createZodDto(sellPackageSchema) {}

export const cancelEnrollmentSchema = z.object({ reason, version });
export class CancelEnrollmentDto extends createZodDto(cancelEnrollmentSchema) {}

export const cancelChargeSchema = z.object({ reason, version });
export class CancelChargeDto extends createZodDto(cancelChargeSchema) {}

// ---- invoices ---------------------------------------------------------------------------------

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid(),
  /** Pending charges to include; all of the patient's pending charges at this facility when omitted. */
  chargeIds: z.array(z.string().uuid()).min(1).max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});
export class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}

export const listInvoicesSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(["draft", "issued", "void"]).optional(),
  /** Local date (facility time) the invoice was issued, or created for drafts. */
  date: z.iso.date().optional(),
  /** Only invoices the patient still owes on. */
  unpaid: z.coerce.boolean().optional(),
});
export class ListInvoicesDto extends createZodDto(listInvoicesSchema) {}

export const applyDiscountSchema = z.object({
  ruleId: z.string().uuid(),
  evidenceIdNumber: z.string().trim().min(3).max(40).optional(),
  evidenceNote: z.string().trim().max(200).optional(),
  version,
});
export class ApplyDiscountDto extends createZodDto(applyDiscountSchema) {}

/** DELETE requests carry the version in the query string. */
export const removeLineSchema = z.object({ version: z.coerce.number().int().positive() });
export class RemoveLineDto extends createZodDto(removeLineSchema) {}

export const setPayerSchema = z.object({
  payerId: z.string().uuid(),
  amount: positiveCentavos,
  /** LOA / approval / claim number. */
  reference: z.string().trim().min(1).max(60).optional(),
  version,
});
export class SetPayerDto extends createZodDto(setPayerSchema) {}

export const issueInvoiceSchema = z.object({ version });
export class IssueInvoiceDto extends createZodDto(issueInvoiceSchema) {}

export const voidInvoiceSchema = z.object({ reason, version, /** Put the charges on a new draft for correction. */ reissue: z.boolean().default(true) });
export class VoidInvoiceDto extends createZodDto(voidInvoiceSchema) {}

export const payerStatusSchema = z
  .object({
    status: z.enum(PAYER_STATUSES).exclude(["pending"]),
    settledAmount: centavos.optional(),
    reference: z.string().trim().min(1).max(60).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.status === "settled") === (v.settledAmount !== undefined), {
    message: "A settled claim needs the settled amount (and only a settled one)",
    path: ["settledAmount"],
  });
export class PayerStatusDto extends createZodDto(payerStatusSchema) {}

// ---- payments ---------------------------------------------------------------------------------

export const recordPaymentSchema = z.object({
  amount: positiveCentavos,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().min(1).max(60).optional(),
  /** One per real-world payment, so a retried request is recorded once. */
  idempotencyKey: z.string().trim().min(8).max(100),
});
export class RecordPaymentDto extends createZodDto(recordPaymentSchema) {}

export const refundSchema = z.object({
  amount: positiveCentavos,
  method: z.enum(PAYMENT_METHODS),
  reason,
  reference: z.string().trim().min(1).max(60).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export class RefundDto extends createZodDto(refundSchema) {}

export const dailyReportSchema = z.object({ date: z.iso.date() });
export class DailyReportDto extends createZodDto(dailyReportSchema) {}

// ---- patient account (deposits and credit) -------------------------------------------------------

const idempotencyKey = z.string().trim().min(8).max(100);

export const recordDepositSchema = z.object({
  amount: positiveCentavos,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().min(1).max(60).optional(),
  /** One per real-world deposit, so a retried request is recorded once. */
  idempotencyKey,
});
export class RecordDepositDto extends createZodDto(recordDepositSchema) {}

export const applyDepositSchema = z.object({ amount: positiveCentavos, idempotencyKey });
export class ApplyDepositDto extends createZodDto(applyDepositSchema) {}

export const refundAccountSchema = z.object({
  amount: positiveCentavos,
  method: z.enum(PAYMENT_METHODS),
  reason,
  reference: z.string().trim().min(1).max(60).optional(),
  idempotencyKey,
});
export class RefundAccountDto extends createZodDto(refundAccountSchema) {}

// ---- credit notes -----------------------------------------------------------------------------

export const issueCreditNoteSchema = z.object({
  reason,
  lines: z
    .array(
      z
        .object({
          /** The invoice line credited, or… */
          invoiceItemId: z.string().uuid().optional(),
          /** …the debit note line credited. */
          debitNoteLineId: z.string().uuid().optional(),
          amount: positiveCentavos,
          /** The credited line's description when omitted. */
          description: text(200).optional(),
        })
        .refine((l) => (l.invoiceItemId === undefined) !== (l.debitNoteLineId === undefined), {
          message: "Credit an invoice line or a debit note line",
          path: ["invoiceItemId"],
        }),
    )
    .min(1)
    .max(200),
  /** Parts of the total that reduce what payers are expected to cover (the rest is the patient's). */
  payers: z
    .array(z.object({ invoicePayerId: z.string().uuid(), amount: positiveCentavos }))
    .max(20)
    .default([]),
  idempotencyKey,
});
export class IssueCreditNoteDto extends createZodDto(issueCreditNoteSchema) {}

// ---- debit notes ------------------------------------------------------------------------------

export const issueDebitNoteSchema = z.object({
  reason,
  lines: z
    .array(
      z
        .object({
          /** A billable service (its price on the date when no unit price is given), or a described adjustment. */
          serviceId: z.string().uuid().optional(),
          description: text(200).optional(),
          quantity: z.number().int().min(1).max(1000).default(1),
          unitPrice: positiveCentavos.optional(),
        })
        .refine((l) => l.serviceId !== undefined || (l.description !== undefined && l.unitPrice !== undefined), {
          message: "Give a service, or a description with a unit price",
          path: ["serviceId"],
        }),
    )
    .min(1)
    .max(200),
  idempotencyKey,
});
export class IssueDebitNoteDto extends createZodDto(issueDebitNoteSchema) {}

// ---- online payment ---------------------------------------------------------------------------

export const startOnlinePaymentSchema = z.object({
  amount: positiveCentavos,
  /** One per attempt, so a retried request starts one payment. */
  idempotencyKey,
  /** MyHealth's page the provider returns the patient to (one of the platform's origins). */
  returnUrl: z.string().url().max(500),
});
export class StartOnlinePaymentDto extends createZodDto(startOnlinePaymentSchema) {}
