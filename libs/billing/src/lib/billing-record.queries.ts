import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, timelineFacility, timelineInstant, timelineRange, type TimelineWindow } from "@healthcare/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { billingInvoice, billingPayment } from "./billing.schema";

/**
 * Billing read queries for the patient timeline (composed in apps/api): issued invoices and recorded payments and
 * refunds, newest first within a page window, with numbers, statuses and amounts only (no notes, reasons or
 * references). Draft invoices are not part of the record until issued. Not audited here: the caller audits.
 */
@Injectable()
export class BillingRecordQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Invoices when issued, with their current status (a voided invoice stays in the history, marked void). */
  timelineInvoices(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = billingInvoice.issuedAt;
    return this.db
      .select({
        id: billingInvoice.id,
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
          eq(billingInvoice.patientId, patientId),
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
          eq(billingPayment.patientId, patientId),
          timelineFacility(billingPayment.facilityId, window),
          timelineRange("payment", at, billingPayment.id, window),
        ),
      )
      .orderBy(desc(at), desc(billingPayment.id))
      .limit(window.limit);
  }
}
