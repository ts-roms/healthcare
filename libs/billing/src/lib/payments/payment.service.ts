import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  localDayBounds,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { recordPaymentSchema, refundSchema } from "../billing.dto";
import { documentNumber, paidNet, refundable } from "../billing.rules";
import { billingInvoice, billingInvoiceDiscount, billingInvoicePayer, billingPayment, type BillingPaymentRecord } from "../billing.schema";
import { found, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { InvoiceService } from "../invoices/invoice.service";

/**
 * The payment ledger: patient payments against issued invoices and refunds of
 * them. Append-only (database trigger); each real-world transaction carries an
 * idempotency key, so a retried request is recorded once. Overpayment is
 * refused (change is given at the counter, not recorded as credit).
 * Receipt numbers are a configurable series; whether they may serve as BIR
 * official receipts is a compliance dependency.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly invoices: InvoiceService,
    private readonly organizations: OrganizationService,
  ) {}

  async record(actor: Actor, invoiceId: string, input: z.infer<typeof recordPaymentSchema>) {
    const existing = await this.byKey(actor.organizationId, input.idempotencyKey);
    if (existing) return this.replay(existing, { invoiceId, kind: "payment", amount: input.amount });
    const payment = await this.db.transaction(async (tx) => {
      const invoice = await this.invoices.lock(tx, actor, invoiceId);
      if (invoice.status !== "issued") throw new BusinessRuleError("Payments are recorded on issued invoices", "invoice_not_issued");
      const ledger = await tx
        .select({ kind: billingPayment.kind, amount: billingPayment.amount })
        .from(billingPayment)
        .where(eq(billingPayment.invoiceId, invoiceId));
      const balance = invoice.patientTotal - paidNet(ledger);
      if (input.amount > balance) {
        throw new BusinessRuleError("The payment is more than the patient's balance", "payment_exceeds_balance", { balance });
      }
      const series = await this.catalog.nextNumber(tx, actor.organizationId, "receipt");
      const year = new Date().getFullYear();
      const [created] = await tx
        .insert(billingPayment)
        .values({
          organizationId: actor.organizationId,
          facilityId: invoice.facilityId,
          invoiceId,
          patientId: invoice.patientId,
          kind: "payment",
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          receiptNumber: documentNumber(series.prefix, year, series.value),
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        })
        .returning();
      const row = found(created, "Payment");
      await this.audit.record(tx, actor, {
        action: "billing.payment.record",
        resourceType: "billing_payment",
        resourceId: row.id,
        patientId: row.patientId,
        metadata: { invoiceId, amount: row.amount, method: row.method, receiptNumber: row.receiptNumber },
      });
      await this.events.record(tx, paymentEvent("PaymentCompleted", row, { balance: balance - row.amount }));
      return row;
    });
    return publicView(payment);
  }

  async refund(actor: Actor, paymentId: string, input: z.infer<typeof refundSchema>) {
    const existing = await this.byKey(actor.organizationId, input.idempotencyKey);
    if (existing) return this.replay(existing, { refundOfId: paymentId, kind: "refund", amount: input.amount });
    const refund = await this.db.transaction(async (tx) => {
      const [original] = await tx
        .select()
        .from(billingPayment)
        .where(and(eq(billingPayment.organizationId, actor.organizationId), eq(billingPayment.id, paymentId)));
      const payment = found(original, "Payment");
      if (payment.kind !== "payment") throw new BusinessRuleError("Only payments can be refunded", "not_a_payment");
      // Serialize refunds of one invoice.
      await this.invoices.lock(tx, actor, payment.invoiceId);
      const previous = await tx.select({ amount: billingPayment.amount }).from(billingPayment).where(eq(billingPayment.refundOfId, paymentId));
      const left = refundable(payment, previous);
      if (input.amount > left)
        throw new BusinessRuleError("The refund is more than what is left of the payment", "refund_exceeds_payment", { refundable: left });
      const [created] = await tx
        .insert(billingPayment)
        .values({
          organizationId: actor.organizationId,
          facilityId: payment.facilityId,
          invoiceId: payment.invoiceId,
          patientId: payment.patientId,
          kind: "refund",
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          refundOfId: paymentId,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        })
        .returning();
      const row = found(created, "Refund");
      await this.audit.record(tx, actor, {
        action: "billing.refund.issue",
        resourceType: "billing_payment",
        resourceId: row.id,
        patientId: row.patientId,
        reason: input.reason,
        metadata: { invoiceId: row.invoiceId, refundOf: paymentId, amount: row.amount, method: row.method },
      });
      await this.events.record(tx, paymentEvent("RefundIssued", row));
      return row;
    });
    return publicView(refund);
  }

  /**
   * One facility's day: invoices issued (still valid) and voided, discounts given (statutory
   * ones separately, for reporting), collections by method, refunds, and what
   * patients and payers still owe on invoices issued that day.
   */
  async dailyReport(actor: Actor, date: string) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const { start, end } = localDayBounds(date, facility.timezone);
    const scope = and(eq(billingInvoice.organizationId, actor.organizationId), eq(billingInvoice.facilityId, facilityId));
    const [issued] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        gross: sql<number>`coalesce(sum(${billingInvoice.grossTotal}), 0)::bigint`,
        discounts: sql<number>`coalesce(sum(${billingInvoice.discountTotal}), 0)::bigint`,
        net: sql<number>`coalesce(sum(${billingInvoice.netTotal}), 0)::bigint`,
        payer: sql<number>`coalesce(sum(${billingInvoice.payerTotal}), 0)::bigint`,
        patient: sql<number>`coalesce(sum(${billingInvoice.patientTotal}), 0)::bigint`,
      })
      .from(billingInvoice)
      .where(and(scope, eq(billingInvoice.status, "issued"), gte(billingInvoice.issuedAt, start), lt(billingInvoice.issuedAt, end)));
    const [voided] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(billingInvoice)
      .where(and(scope, gte(billingInvoice.voidedAt, start), lt(billingInvoice.voidedAt, end)));
    const discounts = await this.db
      .select({
        code: billingInvoiceDiscount.ruleCode,
        name: billingInvoiceDiscount.ruleName,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`sum(${billingInvoiceDiscount.amount})::bigint`,
      })
      .from(billingInvoiceDiscount)
      .innerJoin(billingInvoice, eq(billingInvoice.id, billingInvoiceDiscount.invoiceId))
      .where(and(scope, eq(billingInvoice.status, "issued"), gte(billingInvoice.issuedAt, start), lt(billingInvoice.issuedAt, end)))
      .groupBy(billingInvoiceDiscount.ruleCode, billingInvoiceDiscount.ruleName);
    const ledger = await this.db
      .select({
        kind: billingPayment.kind,
        method: billingPayment.method,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`sum(${billingPayment.amount})::bigint`,
      })
      .from(billingPayment)
      .where(
        and(
          eq(billingPayment.organizationId, actor.organizationId),
          eq(billingPayment.facilityId, facilityId),
          gte(billingPayment.recordedAt, start),
          lt(billingPayment.recordedAt, end),
        ),
      )
      .groupBy(billingPayment.kind, billingPayment.method);
    const [payerPending] = await this.db
      .select({ amount: sql<number>`coalesce(sum(${billingInvoicePayer.amount}), 0)::bigint` })
      .from(billingInvoicePayer)
      .innerJoin(billingInvoice, eq(billingInvoice.id, billingInvoicePayer.invoiceId))
      .where(and(scope, eq(billingInvoice.status, "issued"), sql`${billingInvoicePayer.status} IN ('pending', 'submitted')`));
    const receivable = await this.invoices.list(actor, { unpaid: true });
    const num = (v: unknown) => Number(v ?? 0);
    const collections = ledger.filter((l) => l.kind === "payment").map((l) => ({ method: l.method, count: l.count, amount: num(l.amount) }));
    const refunds = ledger.filter((l) => l.kind === "refund").map((l) => ({ method: l.method, count: l.count, amount: num(l.amount) }));
    await this.audit.recordStandalone(actor, { action: "billing.report.daily", resourceType: "billing_invoice", metadata: { facilityId, date } });
    return {
      date,
      facilityId,
      invoices: {
        issued: issued?.count ?? 0,
        voided: voided?.count ?? 0,
        grossTotal: num(issued?.gross),
        discountTotal: num(issued?.discounts),
        netTotal: num(issued?.net),
        payerTotal: num(issued?.payer),
        patientTotal: num(issued?.patient),
      },
      discounts: discounts.map((d) => ({ ...d, amount: num(d.amount) })),
      collections,
      collectedTotal: collections.reduce((a, c) => a + c.amount, 0),
      refunds,
      refundedTotal: refunds.reduce((a, c) => a + c.amount, 0),
      receivables: {
        /** What patients still owe on issued invoices at this facility (all dates). */
        patientBalance: receivable.reduce((a, r) => a + r.balance, 0),
        invoices: receivable.length,
        /** Payer coverage not yet settled or denied (all dates). */
        payerPending: num(payerPending?.amount),
      },
    };
  }

  private async byKey(organizationId: string, idempotencyKey: string) {
    const [row] = await this.db
      .select()
      .from(billingPayment)
      .where(and(eq(billingPayment.organizationId, organizationId), eq(billingPayment.idempotencyKey, idempotencyKey)));
    return row;
  }

  /** A retried request returns the recorded transaction; a different transaction with the same key is refused. */
  private replay(existing: BillingPaymentRecord, expected: { invoiceId?: string; refundOfId?: string; kind: "payment" | "refund"; amount: number }) {
    const same =
      existing.kind === expected.kind &&
      existing.amount === expected.amount &&
      (expected.invoiceId === undefined || existing.invoiceId === expected.invoiceId) &&
      (expected.refundOfId === undefined || existing.refundOfId === expected.refundOfId);
    if (!same) throw new ConflictError("This idempotency key was already used for a different transaction", undefined, "idempotency_key_reused");
    return publicView(existing);
  }
}

function paymentEvent(type: string, row: BillingPaymentRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "billing_payment",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { invoiceId: row.invoiceId, amount: row.amount, method: row.method, ...extra },
  };
}
