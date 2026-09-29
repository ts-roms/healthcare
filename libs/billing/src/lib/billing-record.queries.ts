import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, timelineFacility, timelineInstant, timelineRange, type TimelineWindow, filedAsPatient } from "@healthcare/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { accountBalance } from "./billing.rules";
import { billingAccountEntry, billingCharge, billingInvoice, billingPayment } from "./billing.schema";

/**
 * Billing read queries for the patient timeline (composed in apps/api): issued invoices and recorded payments and
 * refunds, newest first within a page window, with numbers, statuses and amounts only (no notes, reasons or
 * references). Draft invoices are not part of the record until issued. Not audited here: the caller audits.
 */
@Injectable()
export class BillingRecordQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Billing work filed under exactly this record id that a patient merge would strand (composed in apps/api): draft
   * invoices, charges not yet invoiced, and a deposit or credit balance at any facility. Numbers and amounts only.
   */
  async mergeWorkInProgress(organizationId: string, patientId: string) {
    const [drafts, pending, entries] = await Promise.all([
      this.db
        .select({ id: billingInvoice.id, createdAt: billingInvoice.createdAt, facilityId: billingInvoice.facilityId })
        .from(billingInvoice)
        .where(and(eq(billingInvoice.organizationId, organizationId), eq(billingInvoice.patientId, patientId), eq(billingInvoice.status, "draft"))),
      this.db
        .select({ id: billingCharge.id, description: billingCharge.description, capturedAt: billingCharge.capturedAt })
        .from(billingCharge)
        .where(and(eq(billingCharge.organizationId, organizationId), eq(billingCharge.patientId, patientId), eq(billingCharge.status, "pending"))),
      this.db
        .select({ facilityId: billingAccountEntry.facilityId, kind: billingAccountEntry.kind, amount: billingAccountEntry.amount })
        .from(billingAccountEntry)
        .where(and(eq(billingAccountEntry.organizationId, organizationId), eq(billingAccountEntry.patientId, patientId))),
    ]);
    const facilities = [...new Set(entries.map((e) => e.facilityId))];
    const balances = facilities
      .map((facilityId) => ({ facilityId, balance: accountBalance(entries.filter((e) => e.facilityId === facilityId)) }))
      .filter((b) => b.balance !== 0);
    return { drafts, pending, balances };
  }

  /** Invoices when issued, with their current status (a voided invoice stays in the history, marked void). */
  timelineInvoices(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = billingInvoice.issuedAt;
    return this.db
      .select({
        id: billingInvoice.id,
        patientId: billingInvoice.patientId,
        at: timelineInstant(at),
        facilityId: billingInvoice.facilityId,
        invoiceNumber: billingInvoice.invoiceNumber,
        status: billingInvoice.status,
        netTotal: billingInvoice.netTotal,
      })
      .from(billingInvoice)
      .where(
        and(
          eq(billingInvoice.organizationId, organizationId),
          filedAsPatient(billingInvoice.patientId, patientId),
          isNotNull(at),
          timelineFacility(billingInvoice.facilityId, window),
          timelineRange("invoice", at, billingInvoice.id, window),
        ),
      )
      .orderBy(desc(at), desc(billingInvoice.id))
      .limit(window.limit);
  }

  /** Payments and refunds when recorded, with the invoice they belong to. */
  timelinePayments(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = billingPayment.recordedAt;
    return this.db
      .select({
        id: billingPayment.id,
        patientId: billingPayment.patientId,
        at: timelineInstant(at),
        facilityId: billingPayment.facilityId,
        invoiceId: billingPayment.invoiceId,
        invoiceNumber: billingInvoice.invoiceNumber,
        kind: billingPayment.kind,
        amount: billingPayment.amount,
        method: billingPayment.method,
        receiptNumber: billingPayment.receiptNumber,
      })
      .from(billingPayment)
      .innerJoin(billingInvoice, eq(billingInvoice.id, billingPayment.invoiceId))
      .where(
        and(
          eq(billingPayment.organizationId, organizationId),
          filedAsPatient(billingPayment.patientId, patientId),
          timelineFacility(billingPayment.facilityId, window),
          timelineRange("payment", at, billingPayment.id, window),
        ),
      )
      .orderBy(desc(at), desc(billingPayment.id))
      .limit(window.limit);
  }
}
