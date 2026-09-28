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
import { documentNumber, invoiceBalance, refundable } from "../billing.rules";
import {
  billingAccountEntry,
  billingCreditNote,
  billingDebitNote,
  billingInvoice,
  billingInvoiceDiscount,
  billingInvoicePayer,
  billingPayment,
  type BillingPaymentRecord,
} from "../billing.schema";
import { found, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { InvoiceService } from "../invoices/invoice.service";

/**
 * The payment ledger: patient payments against issued invoices and refunds of
 * them. Append-only (database trigger); each real-world transaction carries an
 * idempotency key, so a retried request is recorded once. Overpayment is
 * refused (change is given at the counter; money paid ahead is a deposit, DepositService).
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
      const balance = invoiceBalance(invoice.patientTotal, await this.invoices.settlement(tx, invoiceId));
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
   * ones separately, for reporting), collections by method, refunds, deposits
   * received, applied and refunded, credit notes issued, and what patients and
   * payers still owe (and deposits held) across all dates.
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
    const account = await this.db
      .select({
        kind: billingAccountEntry.kind,
        method: billingAccountEntry.method,
        count: sql<number>`count(*)::int`,
        amount: sql<number>`sum(${billingAccountEntry.amount})::bigint`,
      })
      .from(billingAccountEntry)
      .where(
        and(
          eq(billingAccountEntry.organizationId, actor.organizationId),
          eq(billingAccountEntry.facilityId, facilityId),
          gte(billingAccountEntry.recordedAt, start),
          lt(billingAccountEntry.recordedAt, end),
        ),
      )
      .groupBy(billingAccountEntry.kind, billingAccountEntry.method);
    const [held] = await this.db
      .select({
        amount: sql<number>`coalesce(sum(CASE WHEN ${billingAccountEntry.kind} IN ('deposit', 'credit', 'release') THEN ${billingAccountEntry.amount} ELSE -${billingAccountEntry.amount} END), 0)::bigint`,
      })
      .from(billingAccountEntry)
      .where(and(eq(billingAccountEntry.organizationId, actor.organizationId), eq(billingAccountEntry.facilityId, facilityId)));
    const [credits] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${billingCreditNote.amount}), 0)::bigint`,
        applied: sql<number>`coalesce(sum(${billingCreditNote.appliedAmount}), 0)::bigint`,
        accountCredit: sql<number>`coalesce(sum(${billingCreditNote.accountCredit}), 0)::bigint`,
        payerAmount: sql<number>`coalesce(sum(${billingCreditNote.payerAmount}), 0)::bigint`,
      })
      .from(billingCreditNote)
      .where(
        and(
          eq(billingCreditNote.organizationId, actor.organizationId),
          eq(billingCreditNote.facilityId, facilityId),
          gte(billingCreditNote.issuedAt, start),
          lt(billingCreditNote.issuedAt, end),
        ),
      );
    const [debits] = await this.db
      .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${billingDebitNote.amount}), 0)::bigint` })
      .from(billingDebitNote)
      .where(
        and(
          eq(billingDebitNote.organizationId, actor.organizationId),
          eq(billingDebitNote.facilityId, facilityId),
          gte(billingDebitNote.issuedAt, start),
          lt(billingDebitNote.issuedAt, end),
        ),
      );
    const receivable = await this.invoices.list(actor, { unpaid: true });
    const num = (v: unknown) => Number(v ?? 0);
    const collections = ledger.filter((l) => l.kind === "payment").map((l) => ({ method: l.method, count: l.count, amount: num(l.amount) }));
    const refunds = ledger.filter((l) => l.kind === "refund").map((l) => ({ method: l.method, count: l.count, amount: num(l.amount) }));
    const byMethod = (kind: string) =>
      account.filter((a) => a.kind === kind && a.method !== null).map((a) => ({ method: a.method as string, count: a.count, amount: num(a.amount) }));
    const kindTotal = (kind: string) => account.filter((a) => a.kind === kind).reduce((a, c) => a + num(c.amount), 0);
    const depositsReceived = byMethod("deposit");
    const depositRefunds = byMethod("refund");
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
      deposits: {
        /** Deposits received that day (money in, besides invoice payments). */
        received: depositsReceived,
        receivedTotal: depositsReceived.reduce((a, c) => a + c.amount, 0),
        /** Deposit or credit applied to invoices that day, less what voids released. */
        appliedTotal: kindTotal("application") - kindTotal("release"),
        refunds: depositRefunds,
        refundedTotal: depositRefunds.reduce((a, c) => a + c.amount, 0),
        /** Unapplied deposit and credit the facility holds for patients (all dates). */
        held: num(held?.amount),
      },
      creditNotes: {
        count: credits?.count ?? 0,
        amount: num(credits?.amount),
        appliedAmount: num(credits?.applied),
        accountCredit: num(credits?.accountCredit),
        payerAmount: num(credits?.payerAmount),
      },
      debitNotes: { count: debits?.count ?? 0, amount: num(debits?.amount) },
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
