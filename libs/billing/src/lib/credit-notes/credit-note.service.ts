import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, DomainEventPublisher, localDate, NotFoundError } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { issueCreditNoteSchema } from "../billing.dto";
import { creditNoteProblem, documentNumber, invoiceBalance, splitCredit } from "../billing.rules";
import {
  billingAccountEntry,
  billingCreditNote,
  billingCreditNoteLine,
  type BillingCreditNoteRecord,
  billingInvoice,
  billingInvoiceItem,
} from "../billing.schema";
import { found, lockPatientAccount, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { InvoiceService } from "../invoices/invoice.service";
import { BILLING_PATIENTS, type BillingPatientDirectory } from "../ports";

const PROBLEM_MESSAGE: Record<string, string> = {
  credit_note_empty: "A credit note needs at least one line",
  credit_note_duplicate_line: "Each invoice line may be credited once per credit note",
  credit_note_line_not_on_invoice: "A credited line is not on this invoice",
  credit_exceeds_line: "A line credits more than is left of the invoice line",
  credit_exceeds_patient_share: "The credit is more than what is left of the patient's share on the invoice",
  amount_invalid: "Enter amounts in centavos",
};

/**
 * Credit notes: the correction of an issued invoice besides void + reissue
 * (libs/billing/CLAUDE.md). A credit note credits lines of an issued invoice,
 * up to what is left of each line and of the patient's share, with a reason
 * and its own number series (`CN-2026-000001`; prefix configurable). It is
 * issued at once and never changes (database trigger). What it credits first
 * reduces what the patient still owes on the invoice; what the patient had
 * already paid becomes credit on their account at the facility, to apply to
 * another invoice or refund (DepositService). Payer coverage is not credited
 * here. Whether the document meets BIR requirements (format, numbering, VAT
 * adjustment) is a compliance dependency.
 */
@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly invoices: InvoiceService,
    private readonly organizations: OrganizationService,
    @Inject(BILLING_PATIENTS) private readonly patients: BillingPatientDirectory,
  ) {}

  async issue(actor: Actor, invoiceId: string, input: z.infer<typeof issueCreditNoteSchema>) {
    const amount = input.lines.reduce((a, l) => a + l.amount, 0);
    const [existing] = await this.db
      .select()
      .from(billingCreditNote)
      .where(and(eq(billingCreditNote.organizationId, actor.organizationId), eq(billingCreditNote.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.invoiceId !== invoiceId || existing.amount !== amount) {
        throw new ConflictError("This idempotency key was already used for a different credit note", undefined, "idempotency_key_reused");
      }
      return this.get(actor, existing.id);
    }
    const id = await this.db.transaction(async (tx) => {
      const invoice = await this.invoices.lock(tx, actor, invoiceId);
      if (invoice.status !== "issued") throw new BusinessRuleError("Credit notes are issued against issued invoices", "invoice_not_issued");
      const items = await tx.select().from(billingInvoiceItem).where(eq(billingInvoiceItem.invoiceId, invoiceId));
      const earlier = await tx
        .select({ itemId: billingCreditNoteLine.invoiceItemId, credited: sql<number>`sum(${billingCreditNoteLine.amount})::bigint` })
        .from(billingCreditNoteLine)
        .innerJoin(billingCreditNote, eq(billingCreditNote.id, billingCreditNoteLine.creditNoteId))
        .where(eq(billingCreditNote.invoiceId, invoiceId))
        .groupBy(billingCreditNoteLine.invoiceItemId);
      const creditedBefore = earlier.reduce((a, e) => a + Number(e.credited), 0);
      const problem = creditNoteProblem(
        input.lines,
        items.map((i) => ({ id: i.id, netAmount: i.netAmount, credited: Number(earlier.find((e) => e.itemId === i.id)?.credited ?? 0) })),
        invoice.patientTotal - creditedBefore,
      );
      if (problem) throw new BusinessRuleError(PROBLEM_MESSAGE[problem] ?? "The credit note cannot be issued", problem);

      const owed = invoiceBalance(invoice.patientTotal, await this.invoices.settlement(tx, invoiceId));
      const split = splitCredit(amount, owed);
      const series = await this.catalog.nextNumber(tx, actor.organizationId, "credit_note");
      const facility = await this.organizations.getFacility(actor.organizationId, invoice.facilityId);
      const year = Number(localDate(new Date(), facility.timezone).slice(0, 4));
      const [created] = await tx
        .insert(billingCreditNote)
        .values({
          organizationId: actor.organizationId,
          facilityId: invoice.facilityId,
          patientId: invoice.patientId,
          invoiceId,
          creditNoteNumber: documentNumber(series.prefix, year, series.value),
          reason: input.reason,
          amount,
          appliedAmount: split.appliedAmount,
          accountCredit: split.accountCredit,
          idempotencyKey: input.idempotencyKey,
          issuedBy: actor.userId,
        })
        .returning();
      const note = found(created, "Credit note");
      await tx.insert(billingCreditNoteLine).values(
        input.lines.map((l) => ({
          organizationId: actor.organizationId,
          creditNoteId: note.id,
          invoiceItemId: l.invoiceItemId,
          description: l.description ?? items.find((i) => i.id === l.invoiceItemId)?.description ?? "Credit",
          amount: l.amount,
        })),
      );
      if (split.accountCredit > 0) {
        await lockPatientAccount(tx, actor.organizationId, invoice.facilityId, invoice.patientId);
        await tx.insert(billingAccountEntry).values({
          organizationId: actor.organizationId,
          facilityId: invoice.facilityId,
          patientId: invoice.patientId,
          kind: "credit",
          amount: split.accountCredit,
          creditNoteId: note.id,
          recordedBy: actor.userId,
        });
      }
      await this.audit.record(tx, actor, {
        action: "billing.credit-note.issue",
        resourceType: "billing_credit_note",
        resourceId: note.id,
        patientId: note.patientId,
        reason: input.reason,
        metadata: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          creditNoteNumber: note.creditNoteNumber,
          amount,
          appliedAmount: split.appliedAmount,
          accountCredit: split.accountCredit,
          lines: input.lines.length,
        },
      });
      await this.events.record(tx, {
        type: "CreditNoteIssued",
        organizationId: note.organizationId,
        aggregateType: "billing_credit_note",
        aggregateId: note.id,
        facilityId: note.facilityId,
        patientId: note.patientId,
        payload: { invoiceId, amount, appliedAmount: split.appliedAmount, accountCredit: split.accountCredit },
      });
      return note.id;
    });
    return this.get(actor, id);
  }

  async get(actor: Actor, creditNoteId: string) {
    const note = await this.detail(actor.organizationId, creditNoteId);
    if (actor.facilityId && note.facilityId !== actor.facilityId) throw new NotFoundError("Credit note");
    await this.audit.recordStandalone(actor, {
      action: "billing.credit-note.view",
      resourceType: "billing_credit_note",
      resourceId: creditNoteId,
      patientId: note.patientId,
    });
    const patients = await this.patients.summaries(actor.organizationId, [note.patientId]);
    return { ...note, patient: patients.get(note.patientId) ?? null };
  }

  /** A credit note with its lines and invoice number (no audit; callers audit). */
  async detail(organizationId: string, creditNoteId: string) {
    const [row] = await this.db
      .select({ note: billingCreditNote, invoiceNumber: billingInvoice.invoiceNumber })
      .from(billingCreditNote)
      .innerJoin(billingInvoice, eq(billingInvoice.id, billingCreditNote.invoiceId))
      .where(and(eq(billingCreditNote.organizationId, organizationId), eq(billingCreditNote.id, creditNoteId)));
    const { note, invoiceNumber } = found(row, "Credit note");
    const lines = await this.db
      .select()
      .from(billingCreditNoteLine)
      .where(eq(billingCreditNoteLine.creditNoteId, creditNoteId))
      .orderBy(asc(billingCreditNoteLine.description));
    return { ...view(note), invoiceNumber, lines: lines.map(publicView) };
  }
}

function view(note: BillingCreditNoteRecord) {
  const { idempotencyKey: _key, ...rest } = note;
  return publicView(rest);
}
