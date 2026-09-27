import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, type Letterhead, pdfDate, pdfDateTime, pdfMoney, pesoWords, renderPdf } from "@healthcare/pdf";
import { and, asc, eq, sql } from "drizzle-orm";
import { paidNet } from "../billing.rules";
import { billingPayment } from "../billing.schema";
import { InvoiceService } from "../invoices/invoice.service";
import { BILLING_PATIENTS, type BillingPatientDirectory } from "../ports";

const METHOD: Record<string, string> = { cash: "Cash", card: "Card", e_wallet: "E-wallet", bank_transfer: "Bank transfer", check: "Check", other: "Other" };
const COVERAGE: Record<string, string> = { pending: "Pending", submitted: "Submitted", settled: "Settled", denied: "Denied" };

/**
 * Printable invoices and payment receipts (PDF), rendered on request from the
 * invoice and ledger (issued invoices and payments are immutable, so the same
 * document can be printed again). Drafts print with a DRAFT watermark and
 * void invoices with VOID. Whether these documents meet BIR requirements for
 * invoices or official receipts is a compliance dependency; they say what
 * they are not.
 */
@Injectable()
export class BillingDocuments {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invoices: InvoiceService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    @Inject(BILLING_PATIENTS) private readonly patients: BillingPatientDirectory,
  ) {}

  async invoicePdf(actor: Actor, invoiceId: string) {
    const invoice = await this.invoices.detail(actor.organizationId, invoiceId);
    const pdf = await this.renderInvoice(actor.organizationId, invoice, "staff");
    await this.audit.recordStandalone(actor, {
      action: "billing.invoice.print",
      resourceType: "billing_invoice",
      resourceId: invoiceId,
      patientId: invoice.patientId,
    });
    return { filename: `${invoice.invoiceNumber ?? `draft-${invoice.id.slice(0, 8)}`}.pdf`, pdf };
  }

  /** The patient's copy from MyHealth: their own issued (or void) invoice. */
  async patientInvoicePdf(organizationId: string, patientId: string, invoiceId: string, auditContext: PatientAuditContext) {
    const invoice = await this.invoices.detail(organizationId, invoiceId).catch(() => undefined);
    if (!invoice || invoice.patientId !== patientId || invoice.status === "draft") throw new NotFoundError("Invoice");
    const pdf = await this.renderInvoice(organizationId, invoice, "patient");
    await this.audit.recordStandalone(auditContext, { action: "portal.invoice-download", resourceType: "billing_invoice", resourceId: invoiceId, patientId });
    return { filename: `${invoice.invoiceNumber}.pdf`, pdf };
  }

  async receiptPdf(actor: Actor, paymentId: string) {
    const [payment] = await this.db
      .select()
      .from(billingPayment)
      .where(and(eq(billingPayment.organizationId, actor.organizationId), eq(billingPayment.id, paymentId)));
    if (!payment) throw new NotFoundError("Payment");
    if (payment.kind !== "payment") throw new BusinessRuleError("Receipts are printed for payments, not refunds", "not_a_payment");
    const invoice = await this.invoices.detail(actor.organizationId, payment.invoiceId);
    // The balance right after this payment (later payments and refunds are not on this receipt).
    const before = await this.db
      .select({ kind: billingPayment.kind, amount: billingPayment.amount })
      .from(billingPayment)
      // Compared in SQL: JavaScript dates drop the microseconds PostgreSQL keeps.
      .where(
        and(
          eq(billingPayment.invoiceId, payment.invoiceId),
          sql`${billingPayment.recordedAt} <= (SELECT p.recorded_at FROM billing_payment p WHERE p.id = ${payment.id})`,
        ),
      )
      .orderBy(asc(billingPayment.recordedAt));
    const { letterhead, timeZone, patient } = await this.frame(actor.organizationId, invoice.facilityId, invoice.patientId);
    const pdf = await renderPdf(
      {
        title: "Acknowledgement Receipt",
        letterhead,
        printedAt: `Printed ${pdfDateTime(new Date(), timeZone)}`,
        footerNote: "This acknowledgement receipt is not an official receipt.",
      },
      (w) => {
        w.fields([
          ["Receipt number", payment.receiptNumber],
          ["Date", pdfDateTime(payment.recordedAt, timeZone)],
          ["Received from", patient.name],
          ["Patient number", patient.number],
          ["For invoice", invoice.invoiceNumber],
          ["Payment method", [METHOD[payment.method] ?? payment.method, payment.reference].filter(Boolean).join(" · ")],
        ]);
        w.space();
        w.totals([["Amount received", pdfMoney(payment.amount), true]]);
        w.paragraph(pesoWords(payment.amount), { bold: true });
        w.space();
        w.totals([
          ["Patient's share on the invoice", pdfMoney(invoice.patientTotal)],
          ["Balance after this payment", pdfMoney(Math.max(invoice.patientTotal - paidNet(before), 0)), true],
        ]);
        w.signatures([{ name: " ", role: "Cashier" }]);
      },
    );
    await this.audit.recordStandalone(actor, {
      action: "billing.receipt.print",
      resourceType: "billing_payment",
      resourceId: paymentId,
      patientId: payment.patientId,
    });
    return { filename: `${payment.receiptNumber ?? payment.id.slice(0, 8)}.pdf`, pdf };
  }

  private async renderInvoice(organizationId: string, invoice: Awaited<ReturnType<InvoiceService["detail"]>>, copy: "staff" | "patient") {
    const { letterhead, timeZone, patient } = await this.frame(organizationId, invoice.facilityId, invoice.patientId);
    const issued = invoice.status !== "draft";
    return renderPdf(
      {
        title: invoice.status === "draft" ? "Invoice (draft)" : "Invoice",
        subtitle: copy === "patient" ? "Patient's copy from MyHealth" : undefined,
        letterhead,
        watermark: invoice.status === "draft" ? "DRAFT" : invoice.status === "void" ? "VOID" : undefined,
        printedAt: `Printed ${pdfDateTime(new Date(), timeZone)}`,
        footerNote: "This invoice is not an official receipt. Amounts in Philippine pesos (PHP).",
      },
      (w) => {
        w.fields([
          ["Invoice number", invoice.invoiceNumber ?? "Not yet issued"],
          ["Date", issued && invoice.issuedAt ? pdfDateTime(invoice.issuedAt, timeZone) : pdfDateTime(invoice.createdAt, timeZone)],
          ["Patient", patient.name],
          ["Patient number", patient.number],
          ["Status", invoice.status === "void" ? `Void: ${invoice.voidReason ?? ""}` : issued ? (invoice.balance > 0 ? "Balance due" : "Paid") : "Draft"],
        ]);
        w.space();
        w.table(
          [
            { header: "Date", width: 1.3 },
            { header: "Service", width: 3.2 },
            { header: "Qty", width: 0.6, align: "right" },
            { header: "Unit price", width: 1.5, align: "right" },
            { header: "Discount", width: 1.4, align: "right" },
            { header: "Amount", width: 1.5, align: "right" },
          ],
          invoice.items.map((i) => [
            pdfDate(i.serviceDate),
            i.description,
            String(i.quantity),
            pdfMoney(i.unitPrice),
            i.discountAmount ? `-${pdfMoney(i.discountAmount)}` : "",
            pdfMoney(i.netAmount),
          ]),
        );
        if (invoice.discounts.length) {
          w.heading("Discounts");
          w.table(
            [
              { header: "Discount", width: 4 },
              { header: "Rate", width: 1, align: "right" },
              { header: "Eligibility ID", width: 2 },
              { header: "Amount", width: 1.5, align: "right" },
            ],
            invoice.discounts.map((d) => [d.ruleName, `${d.rateBp / 100}%`, d.evidenceIdMasked ?? "", `-${pdfMoney(d.amount)}`]),
          );
        }
        if (invoice.payers.length) {
          w.heading("Covered by");
          w.table(
            [
              { header: "Payer", width: 3 },
              { header: "Reference", width: 2 },
              { header: "Status", width: 1.5 },
              { header: "Amount", width: 1.5, align: "right" },
            ],
            invoice.payers.map((p) => [p.payerName, p.reference ?? "", COVERAGE[p.status] ?? p.status, pdfMoney(p.amount)]),
          );
        }
        w.space();
        const totals: Array<[string, string, boolean?]> = [
          ["Gross", pdfMoney(invoice.grossTotal)],
          ["Discounts", `-${pdfMoney(invoice.discountTotal)}`],
          ["Net", pdfMoney(invoice.netTotal), true],
          ["Covered by payers", `-${pdfMoney(invoice.payerTotal)}`],
          ["Patient's share", pdfMoney(invoice.patientTotal), true],
        ];
        if (issued) totals.push(["Paid", `-${pdfMoney(invoice.paidTotal)}`], ["Balance", pdfMoney(invoice.balance), true]);
        w.totals(totals);
        if (invoice.payments.length) {
          w.heading("Payments");
          w.table(
            [
              { header: "Date", width: 2 },
              { header: "Receipt", width: 2 },
              { header: "Method", width: 2.5 },
              { header: "Amount", width: 1.5, align: "right" },
            ],
            invoice.payments.map((p) => [
              pdfDateTime(p.recordedAt, timeZone),
              p.kind === "refund" ? "Refund" : (p.receiptNumber ?? ""),
              [METHOD[p.method] ?? p.method, p.reference].filter(Boolean).join(" · "),
              p.kind === "refund" ? `+${pdfMoney(p.amount)}` : `-${pdfMoney(p.amount)}`,
            ]),
          );
        }
      },
    );
  }

  private async frame(
    organizationId: string,
    facilityId: string,
    patientId: string,
  ): Promise<{ letterhead: Letterhead; timeZone: string; patient: { name: string; number: string } }> {
    const [organization, facility, briefs] = await Promise.all([
      this.organizations.getOrganization(organizationId),
      this.organizations.getFacility(organizationId, facilityId),
      this.patients.summaries(organizationId, [patientId]),
    ]);
    const brief = briefs.get(patientId);
    return {
      letterhead: facilityLetterhead(organization.name, facility),
      timeZone: facility.timezone,
      patient: { name: brief?.displayName ?? "Patient", number: brief?.patientNumber ?? "" },
    };
  }
}
