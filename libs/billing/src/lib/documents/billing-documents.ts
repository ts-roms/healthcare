import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { facilityLetterhead, type Letterhead, pdfDate, pdfDateTime, pdfMoney, pesoWords, renderPdf } from "@healthcare/pdf";
import { and, asc, eq, sql } from "drizzle-orm";
import { accountBalance, depositApplied, invoiceBalance, paidNet } from "../billing.rules";
import { billingAccountEntry, billingCreditNote, billingDebitNote, billingPayment } from "../billing.schema";
import { CreditNoteService } from "../credit-notes/credit-note.service";
import { DebitNoteService } from "../credit-notes/debit-note.service";
import { InvoiceService } from "../invoices/invoice.service";
import { BILLING_PATIENTS, type BillingPatientDirectory } from "../ports";

const METHOD: Record<string, string> = { cash: "Cash", card: "Card", e_wallet: "E-wallet", bank_transfer: "Bank transfer", check: "Check", other: "Other" };
const COVERAGE: Record<string, string> = { pending: "Pending", submitted: "Submitted", settled: "Settled", denied: "Denied" };

/**
 * Printable invoices, payment and deposit receipts, and credit notes (PDF),
 * rendered on request from the invoice and ledgers (issued invoices, credit
 * notes and ledger entries are immutable, so the same document can be printed
 * again). Drafts print with a DRAFT watermark and
 * void invoices with VOID. Whether these documents meet BIR requirements for
 * invoices or official receipts is a compliance dependency; they say what
 * they are not.
 */
@Injectable()
export class BillingDocuments {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invoices: InvoiceService,
    private readonly creditNotes: CreditNoteService,
    private readonly debitNotes: DebitNoteService,
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
    const asOf = sql`(SELECT p.recorded_at FROM billing_payment p WHERE p.id = ${payment.id})`;
    const [applied, credited, debited] = await Promise.all([
      this.db
        .select({ kind: billingAccountEntry.kind, amount: billingAccountEntry.amount })
        .from(billingAccountEntry)
        .where(and(eq(billingAccountEntry.invoiceId, payment.invoiceId), sql`${billingAccountEntry.recordedAt} <= ${asOf}`)),
      this.db
        .select({ appliedAmount: billingCreditNote.appliedAmount })
        .from(billingCreditNote)
        .where(and(eq(billingCreditNote.invoiceId, payment.invoiceId), sql`${billingCreditNote.issuedAt} <= ${asOf}`)),
      this.db
        .select({ amount: billingDebitNote.amount })
        .from(billingDebitNote)
        .where(and(eq(billingDebitNote.invoiceId, payment.invoiceId), sql`${billingDebitNote.issuedAt} <= ${asOf}`)),
    ]);
    const balanceAfter = invoiceBalance(invoice.patientTotal, {
      paid: paidNet(before),
      depositApplied: depositApplied(applied),
      credited: credited.reduce((a, c) => a + c.appliedAmount, 0),
      debited: debited.reduce((a, d) => a + d.amount, 0),
    });
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
          ["Balance after this payment", pdfMoney(Math.max(balanceAfter, 0)), true],
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

  /** Acknowledgement receipt of a deposit (advance payment) on the patient's account. */
  async depositReceiptPdf(actor: Actor, entryId: string) {
    const [entry] = await this.db
      .select()
      .from(billingAccountEntry)
      .where(and(eq(billingAccountEntry.organizationId, actor.organizationId), eq(billingAccountEntry.id, entryId)));
    if (!entry || (actor.facilityId && entry.facilityId !== actor.facilityId)) throw new NotFoundError("Deposit");
    if (entry.kind !== "deposit") throw new BusinessRuleError("Receipts are printed for deposits", "not_a_deposit");
    // The account balance right after this deposit.
    const before = await this.db
      .select({ kind: billingAccountEntry.kind, amount: billingAccountEntry.amount })
      .from(billingAccountEntry)
      .where(
        and(
          eq(billingAccountEntry.organizationId, entry.organizationId),
          eq(billingAccountEntry.patientId, entry.patientId),
          eq(billingAccountEntry.facilityId, entry.facilityId),
          sql`${billingAccountEntry.recordedAt} <= (SELECT e.recorded_at FROM billing_account_entry e WHERE e.id = ${entry.id})`,
        ),
      );
    const { letterhead, timeZone, patient } = await this.frame(actor.organizationId, entry.facilityId, entry.patientId);
    const pdf = await renderPdf(
      {
        title: "Acknowledgement Receipt",
        subtitle: "Deposit (advance payment)",
        letterhead,
        printedAt: `Printed ${pdfDateTime(new Date(), timeZone)}`,
        footerNote: "This acknowledgement receipt is not an official receipt.",
      },
      (w) => {
        w.fields([
          ["Receipt number", entry.receiptNumber],
          ["Date", pdfDateTime(entry.recordedAt, timeZone)],
          ["Received from", patient.name],
          ["Patient number", patient.number],
          ["For", "Deposit on the patient's account"],
          ["Payment method", [METHOD[entry.method ?? ""] ?? entry.method, entry.reference].filter(Boolean).join(" · ")],
        ]);
        w.space();
        w.totals([["Amount received", pdfMoney(entry.amount), true]]);
        w.paragraph(pesoWords(entry.amount), { bold: true });
        w.space();
        w.totals([["Deposit and credit balance after this deposit", pdfMoney(accountBalance(before)), true]]);
        w.paragraph("The deposit is applied to the patient's invoices at this facility, or refunded, as the patient and the cashier agree.", { muted: true });
        w.signatures([{ name: " ", role: "Cashier" }]);
      },
    );
    await this.audit.recordStandalone(actor, {
      action: "billing.deposit-receipt.print",
      resourceType: "billing_account_entry",
      resourceId: entryId,
      patientId: entry.patientId,
    });
    return { filename: `${entry.receiptNumber ?? entry.id.slice(0, 8)}.pdf`, pdf };
  }

  async creditNotePdf(actor: Actor, creditNoteId: string) {
    const note = await this.creditNotes.detail(actor.organizationId, creditNoteId);
    if (actor.facilityId && note.facilityId !== actor.facilityId) throw new NotFoundError("Credit note");
    const pdf = await this.renderCreditNote(actor.organizationId, note, "staff");
    await this.audit.recordStandalone(actor, {
      action: "billing.credit-note.print",
      resourceType: "billing_credit_note",
      resourceId: creditNoteId,
      patientId: note.patientId,
    });
    return { filename: `${note.creditNoteNumber}.pdf`, pdf };
  }

  /** The patient's copy of a credit note from MyHealth. */
  async patientCreditNotePdf(organizationId: string, patientId: string, creditNoteId: string, auditContext: PatientAuditContext) {
    const note = await this.creditNotes.detail(organizationId, creditNoteId).catch(() => undefined);
    if (!note || note.patientId !== patientId) throw new NotFoundError("Credit note");
    const pdf = await this.renderCreditNote(organizationId, note, "patient");
    await this.audit.recordStandalone(auditContext, {
      action: "portal.credit-note-download",
      resourceType: "billing_credit_note",
      resourceId: creditNoteId,
      patientId,
    });
    return { filename: `${note.creditNoteNumber}.pdf`, pdf };
  }

  async debitNotePdf(actor: Actor, debitNoteId: string) {
    const note = await this.debitNotes.detail(actor.organizationId, debitNoteId);
    if (actor.facilityId && note.facilityId !== actor.facilityId) throw new NotFoundError("Debit note");
    const pdf = await this.renderDebitNote(actor.organizationId, note, "staff");
    await this.audit.recordStandalone(actor, {
      action: "billing.debit-note.print",
      resourceType: "billing_debit_note",
      resourceId: debitNoteId,
      patientId: note.patientId,
    });
    return { filename: `${note.debitNoteNumber}.pdf`, pdf };
  }

  /** The patient's copy of a debit note from MyHealth. */
  async patientDebitNotePdf(organizationId: string, patientId: string, debitNoteId: string, auditContext: PatientAuditContext) {
    const note = await this.debitNotes.detail(organizationId, debitNoteId).catch(() => undefined);
    if (!note || note.patientId !== patientId) throw new NotFoundError("Debit note");
    const pdf = await this.renderDebitNote(organizationId, note, "patient");
    await this.audit.recordStandalone(auditContext, {
      action: "portal.debit-note-download",
      resourceType: "billing_debit_note",
      resourceId: debitNoteId,
      patientId,
    });
    return { filename: `${note.debitNoteNumber}.pdf`, pdf };
  }

  private async renderDebitNote(organizationId: string, note: Awaited<ReturnType<DebitNoteService["detail"]>>, copy: "staff" | "patient") {
    const { letterhead, timeZone, patient } = await this.frame(organizationId, note.facilityId, note.patientId);
    return renderPdf(
      {
        title: "Debit Note",
        subtitle: copy === "patient" ? "Patient's copy from MyHealth" : undefined,
        letterhead,
        printedAt: `Printed ${pdfDateTime(new Date(), timeZone)}`,
        footerNote: "Amounts in Philippine pesos (PHP). Whether this debit note meets BIR requirements is subject to confirmation.",
      },
      (w) => {
        w.fields([
          ["Debit note number", note.debitNoteNumber],
          ["Date", pdfDateTime(note.issuedAt, timeZone)],
          ["Patient", patient.name],
          ["Patient number", patient.number],
          ["For invoice", note.invoiceNumber],
          ["Reason", note.reason],
        ]);
        w.space();
        w.table(
          [
            { header: "Added", width: 4.5 },
            { header: "Qty", width: 0.6, align: "right" },
            { header: "Unit price", width: 1.5, align: "right" },
            { header: "Amount", width: 1.5, align: "right" },
          ],
          note.lines.map((l) => [l.description, String(l.quantity), pdfMoney(l.unitPrice), pdfMoney(l.amount)]),
        );
        w.space();
        w.totals([["Added to the invoice", pdfMoney(note.amount), true]]);
        w.paragraph(pesoWords(note.amount), { bold: true });
        w.signatures([{ name: " ", role: "Authorized signature" }]);
      },
    );
  }

  private async renderCreditNote(organizationId: string, note: Awaited<ReturnType<CreditNoteService["detail"]>>, copy: "staff" | "patient") {
    const { letterhead, timeZone, patient } = await this.frame(organizationId, note.facilityId, note.patientId);
    return renderPdf(
      {
        title: "Credit Note",
        subtitle: copy === "patient" ? "Patient's copy from MyHealth" : undefined,
        letterhead,
        printedAt: `Printed ${pdfDateTime(new Date(), timeZone)}`,
        footerNote: "Amounts in Philippine pesos (PHP). Whether this credit note meets BIR requirements is subject to confirmation.",
      },
      (w) => {
        w.fields([
          ["Credit note number", note.creditNoteNumber],
          ["Date", pdfDateTime(note.issuedAt, timeZone)],
          ["Patient", patient.name],
          ["Patient number", patient.number],
          ["For invoice", note.invoiceNumber],
          ["Reason", note.reason],
        ]);
        w.space();
        w.table(
          [
            { header: "Credited", width: 6 },
            { header: "Amount", width: 1.5, align: "right" },
          ],
          note.lines.map((l) => [l.description, pdfMoney(l.amount)]),
        );
        w.space();
        const totals: Array<[string, string, boolean?]> = [["Total credited", pdfMoney(note.amount), true]];
        for (const p of note.payers) totals.push([`Taken off ${p.payerName}'s coverage`, pdfMoney(p.amount)]);
        if (note.appliedAmount) totals.push(["Taken off the invoice balance", pdfMoney(note.appliedAmount)]);
        if (note.accountCredit) totals.push(["Credited to the patient's account (already paid)", pdfMoney(note.accountCredit)]);
        w.totals(totals);
        w.paragraph(pesoWords(note.amount), { bold: true });
        if (note.accountCredit) {
          w.paragraph("Credit on the patient's account can be applied to another invoice at this facility or refunded.", { muted: true });
        }
        w.signatures([{ name: " ", role: "Authorized signature" }]);
      },
    );
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
        // The seller's details as the organization configured them, captured when the invoice was issued.
        if (issued && (invoice.sellerRegisteredName || invoice.sellerTin)) {
          w.fields([
            ["Registered name", invoice.sellerRegisteredName],
            ["TIN", invoice.sellerTin],
            ["Business address", invoice.sellerAddress],
            ["VAT status", invoice.taxStatus === "vat_registered" ? "VAT-registered" : invoice.taxStatus === "non_vat" ? "Non-VAT" : null],
            ["Permit", invoice.permitReference],
          ]);
          w.space();
        }
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
        if (issued) {
          totals.push(["Paid", `-${pdfMoney(invoice.paidTotal)}`]);
          if (invoice.depositAppliedTotal) totals.push(["Deposit applied", `-${pdfMoney(invoice.depositAppliedTotal)}`]);
          if (invoice.debitedTotal) totals.push(["Debit notes", `+${pdfMoney(invoice.debitedTotal)}`]);
          if (invoice.creditedTotal) totals.push(["Credit notes", `-${pdfMoney(invoice.creditedTotal)}`]);
          totals.push(["Balance", pdfMoney(invoice.balance), true]);
        }
        w.totals(totals);
        if (invoice.taxStatus === "vat_registered" && invoice.vatRateBp !== null) {
          w.heading("VAT breakdown");
          w.totals([
            ["VATable sales", pdfMoney(invoice.vatableSales)],
            [`VAT (${invoice.vatRateBp / 100}%)`, pdfMoney(invoice.vatAmount)],
            ["VAT-exempt sales", pdfMoney(invoice.vatExemptSales)],
            ["Zero-rated sales", pdfMoney(invoice.zeroRatedSales)],
          ]);
        }
        if (issued && invoice.documentNote) w.paragraph(invoice.documentNote, { muted: true });
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
        if (invoice.debitNotes.length) {
          w.heading("Debit notes");
          w.table(
            [
              { header: "Date", width: 2 },
              { header: "Debit note", width: 2 },
              { header: "Reason", width: 2.5 },
              { header: "Amount", width: 1.5, align: "right" },
            ],
            invoice.debitNotes.map((d) => [pdfDateTime(d.issuedAt, timeZone), d.debitNoteNumber, d.reason, `+${pdfMoney(d.amount)}`]),
          );
        }
        if (invoice.creditNotes.length) {
          w.heading("Credit notes");
          w.table(
            [
              { header: "Date", width: 2 },
              { header: "Credit note", width: 2 },
              { header: "Reason", width: 2.5 },
              { header: "Amount", width: 1.5, align: "right" },
            ],
            invoice.creditNotes.map((c) => [pdfDateTime(c.issuedAt, timeZone), c.creditNoteNumber, c.reason, `-${pdfMoney(c.amount)}`]),
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
