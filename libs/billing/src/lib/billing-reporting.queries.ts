import { Inject, Injectable } from "@nestjs/common";
import { canonicalPatientId, DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { billingCreditNote, billingDebitNote, billingInvoice, billingInvoiceItem, billingPayment, billingService } from "./billing.schema";

/** A sum of centavos as a JavaScript number (float8 is exact far beyond any clinic's totals). */
const centavos = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(${expression}, 0)::float8`;

/**
 * Billing figures for management reporting over a window, in centavos: invoices issued (and still valid) with their
 * totals, voids, credit and debit notes, money collected and refunded by method, revenue by service category and the
 * top services. Counts and amounts only — no patient. BIR reporting is not implied: these are operational figures.
 */
@Injectable()
export class BillingReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow) {
    const issued = and(
      eq(billingInvoice.organizationId, organizationId),
      eq(billingInvoice.status, "issued"),
      reportingRange(billingInvoice.issuedAt, window),
      reportingFacility(billingInvoice.facilityId, window),
    );
    const payments = and(
      eq(billingPayment.organizationId, organizationId),
      reportingRange(billingPayment.recordedAt, window),
      reportingFacility(billingPayment.facilityId, window),
    );
    const [invoices, voided, notes, collections, byCategory, topServices, invoicedDaily, collectedDaily] = await Promise.all([
      this.db
        .select({
          issued: sql<number>`count(*)::int`,
          grossTotal: centavos(sql`sum(${billingInvoice.grossTotal})`),
          discountTotal: centavos(sql`sum(${billingInvoice.discountTotal})`),
          netTotal: centavos(sql`sum(${billingInvoice.netTotal})`),
          payerTotal: centavos(sql`sum(${billingInvoice.payerTotal})`),
          patientTotal: centavos(sql`sum(${billingInvoice.patientTotal})`),
        })
        .from(billingInvoice)
        .where(issued),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(billingInvoice)
        .where(
          and(
            eq(billingInvoice.organizationId, organizationId),
            reportingRange(billingInvoice.voidedAt, window),
            reportingFacility(billingInvoice.facilityId, window),
          ),
        ),
      Promise.all([
        this.db
          .select({ total: centavos(sql`sum(${billingCreditNote.amount})`) })
          .from(billingCreditNote)
          .where(
            and(
              eq(billingCreditNote.organizationId, organizationId),
              reportingRange(billingCreditNote.issuedAt, window),
              reportingFacility(billingCreditNote.facilityId, window),
            ),
          ),
        this.db
          .select({ total: centavos(sql`sum(${billingDebitNote.amount})`) })
          .from(billingDebitNote)
          .where(
            and(
              eq(billingDebitNote.organizationId, organizationId),
              reportingRange(billingDebitNote.issuedAt, window),
              reportingFacility(billingDebitNote.facilityId, window),
            ),
          ),
      ]),
      this.db
        .select({
          method: billingPayment.method,
          collected: centavos(sql`sum(${billingPayment.amount}) filter (where ${billingPayment.kind} = 'payment')`),
          refunded: centavos(sql`sum(${billingPayment.amount}) filter (where ${billingPayment.kind} = 'refund')`),
          payments: sql<number>`count(*) filter (where ${billingPayment.kind} = 'payment')::int`,
        })
        .from(billingPayment)
        .where(payments)
        .groupBy(billingPayment.method),
      this.db
        .select({
          category: billingInvoiceItem.category,
          net: centavos(sql`sum(${billingInvoiceItem.netAmount})`),
          quantity: sql<number>`sum(${billingInvoiceItem.quantity})::int`,
        })
        .from(billingInvoiceItem)
        .innerJoin(billingInvoice, eq(billingInvoice.id, billingInvoiceItem.invoiceId))
        .where(issued)
        .groupBy(billingInvoiceItem.category),
      this.db
        .select({
          serviceId: billingInvoiceItem.serviceId,
          code: billingService.code,
          name: billingService.name,
          category: billingService.category,
          quantity: sql<number>`sum(${billingInvoiceItem.quantity})::int`,
          net: centavos(sql`sum(${billingInvoiceItem.netAmount})`),
          /** Distinct patients invoiced for the service (the API suppresses small counts). */
          patients: sql<number>`count(distinct ${canonicalPatientId(billingInvoice.patientId)})::int`,
        })
        .from(billingInvoiceItem)
        .innerJoin(billingInvoice, eq(billingInvoice.id, billingInvoiceItem.invoiceId))
        .innerJoin(billingService, eq(billingService.id, billingInvoiceItem.serviceId))
        .where(issued)
        .groupBy(billingInvoiceItem.serviceId, billingService.code, billingService.name, billingService.category)
        .orderBy(desc(sql`sum(${billingInvoiceItem.netAmount})`))
        .limit(10),
      this.db
        .select({ date: reportingDay(billingInvoice.issuedAt, window), invoiced: centavos(sql`sum(${billingInvoice.netTotal})`) })
        .from(billingInvoice)
        .where(issued)
        .groupBy(sql`1`),
      this.db
        .select({
          date: reportingDay(billingPayment.recordedAt, window),
          collected: centavos(sql`sum(case when ${billingPayment.kind} = 'payment' then ${billingPayment.amount} else -${billingPayment.amount} end)`),
        })
        .from(billingPayment)
        .where(payments)
        .groupBy(sql`1`),
    ]);
    const collected = collections.reduce((n, c) => n + c.collected, 0);
    const refunded = collections.reduce((n, c) => n + c.refunded, 0);
    const days = new Map<string, { date: string; invoiced: number; collected: number }>();
    for (const d of invoicedDaily) days.set(d.date, { date: d.date, invoiced: d.invoiced, collected: 0 });
    for (const d of collectedDaily) days.set(d.date, { ...(days.get(d.date) ?? { date: d.date, invoiced: 0, collected: 0 }), collected: d.collected });
    return {
      invoices: {
        ...(invoices[0] ?? { issued: 0, grossTotal: 0, discountTotal: 0, netTotal: 0, payerTotal: 0, patientTotal: 0 }),
        voided: voided[0]?.count ?? 0,
      },
      creditNotesTotal: notes[0][0]?.total ?? 0,
      debitNotesTotal: notes[1][0]?.total ?? 0,
      collectedTotal: collected,
      refundedTotal: refunded,
      /** Collected less refunded. */
      netCollected: collected - refunded,
      collections: collections.filter((c) => c.payments || c.refunded).sort((a, b) => b.collected - a.collected),
      byCategory: byCategory.sort((a, b) => b.net - a.net),
      topServices,
      daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
