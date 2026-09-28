import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, DomainEventPublisher, localDate, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { issueDebitNoteSchema } from "../billing.dto";
import { debitNoteProblem, documentNumber, invoiceBalance } from "../billing.rules";
import { billingDebitNote, billingDebitNoteLine, type BillingDebitNoteRecord, billingInvoice } from "../billing.schema";
import { found, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { InvoiceService } from "../invoices/invoice.service";
import { BILLING_PATIENTS, type BillingPatientDirectory } from "../ports";

const PROBLEM_MESSAGE: Record<string, string> = {
  debit_note_empty: "A debit note needs at least one line",
  quantity_invalid: "Quantities are whole numbers from 1 to 1000",
  amount_invalid: "Enter amounts in centavos",
};

/**
 * Debit notes: what is added to an issued invoice after it was issued — a
 * service given or charged too low — with a reason and its own number series
 * (`DN-2026-000001`; prefix configurable). A line is a billable service (at its
 * listed price on the day, unless another is given) or an adjustment in
 * words. Issued at once and immutable (database trigger); it adds to what the
 * patient owes on the invoice. A mistaken debit note is corrected with a
 * credit note on its lines. Whether the document meets BIR requirements is a
 * compliance dependency.
 */
@Injectable()
export class DebitNoteService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly invoices: InvoiceService,
    private readonly organizations: OrganizationService,
    @Inject(BILLING_PATIENTS) private readonly patients: BillingPatientDirectory,
  ) {}

  async issue(actor: Actor, invoiceId: string, input: z.infer<typeof issueDebitNoteSchema>) {
    const [existing] = await this.db
      .select()
      .from(billingDebitNote)
      .where(and(eq(billingDebitNote.organizationId, actor.organizationId), eq(billingDebitNote.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.invoiceId !== invoiceId) {
        throw new ConflictError("This idempotency key was already used for a different debit note", undefined, "idempotency_key_reused");
      }
      return this.get(actor, existing.id);
    }
    const id = await this.db.transaction(async (tx) => {
      const invoice = await this.invoices.lock(tx, actor, invoiceId);
      if (invoice.status !== "issued") throw new BusinessRuleError("Debit notes are issued against issued invoices", "invoice_not_issued");
      const facility = await this.organizations.getFacility(actor.organizationId, invoice.facilityId);
      const today = localDate(new Date(), facility.timezone);
      const lines = [];
      for (const l of input.lines) {
        if (!l.serviceId) {
          lines.push({ serviceId: null, description: l.description as string, quantity: l.quantity, unitPrice: l.unitPrice as number });
          continue;
        }
        const service = await this.catalog.requireService(tx, actor.organizationId, l.serviceId);
        const price = await this.catalog.priceOn(tx, service.id, today);
        const unitPrice = l.unitPrice ?? price?.unitPrice;
        if (unitPrice === undefined) throw new BusinessRuleError(`${service.name} has no price for today; enter one`, "price_required");
        lines.push({ serviceId: service.id, description: l.description ?? service.name, quantity: l.quantity, unitPrice });
      }
      const problem = debitNoteProblem(lines);
      if (problem) throw new BusinessRuleError(PROBLEM_MESSAGE[problem] ?? "The debit note cannot be issued", problem);
      const amount = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
      const series = await this.catalog.nextNumber(tx, actor.organizationId, "debit_note");
      const [created] = await tx
        .insert(billingDebitNote)
        .values({
          organizationId: actor.organizationId,
          facilityId: invoice.facilityId,
          patientId: invoice.patientId,
          invoiceId,
          debitNoteNumber: documentNumber(series.prefix, Number(today.slice(0, 4)), series.value),
          reason: input.reason,
          amount,
          idempotencyKey: input.idempotencyKey,
          issuedBy: actor.userId,
        })
        .returning();
      const note = found(created, "Debit note");
      await tx
        .insert(billingDebitNoteLine)
        .values(lines.map((l) => ({ organizationId: actor.organizationId, debitNoteId: note.id, ...l, amount: l.unitPrice * l.quantity })));
      const balance = invoiceBalance(invoice.patientTotal, await this.invoices.settlement(tx, invoiceId));
      await this.audit.record(tx, actor, {
        action: "billing.debit-note.issue",
        resourceType: "billing_debit_note",
        resourceId: note.id,
        patientId: note.patientId,
        reason: input.reason,
        metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber, debitNoteNumber: note.debitNoteNumber, amount, lines: lines.length },
      });
      await this.events.record(tx, {
        type: "DebitNoteIssued",
        organizationId: note.organizationId,
        aggregateType: "billing_debit_note",
        aggregateId: note.id,
        facilityId: note.facilityId,
        patientId: note.patientId,
        payload: { invoiceId, amount, balance },
      });
      return note.id;
    });
    return this.get(actor, id);
  }

  async get(actor: Actor, debitNoteId: string) {
    const note = await this.detail(actor.organizationId, debitNoteId);
    if (actor.facilityId && note.facilityId !== actor.facilityId) throw new NotFoundError("Debit note");
    await this.audit.recordStandalone(actor, {
      action: "billing.debit-note.view",
      resourceType: "billing_debit_note",
      resourceId: debitNoteId,
      patientId: note.patientId,
    });
    const patients = await this.patients.summaries(actor.organizationId, [note.patientId]);
    return { ...note, patient: patients.get(note.patientId) ?? null };
  }

  /** A debit note with its lines and invoice number (no audit; callers audit). */
  async detail(organizationId: string, debitNoteId: string) {
    const [row] = await this.db
      .select({ note: billingDebitNote, invoiceNumber: billingInvoice.invoiceNumber })
      .from(billingDebitNote)
      .innerJoin(billingInvoice, eq(billingInvoice.id, billingDebitNote.invoiceId))
      .where(and(eq(billingDebitNote.organizationId, organizationId), eq(billingDebitNote.id, debitNoteId)));
    const { note, invoiceNumber } = found(row, "Debit note");
    const lines = await this.db
      .select()
      .from(billingDebitNoteLine)
      .where(eq(billingDebitNoteLine.debitNoteId, debitNoteId))
      .orderBy(asc(billingDebitNoteLine.id));
    return { ...view(note), invoiceNumber, lines: lines.map(publicView) };
  }
}

function view(note: BillingDebitNoteRecord) {
  const { idempotencyKey: _key, ...rest } = note;
  return publicView(rest);
}
