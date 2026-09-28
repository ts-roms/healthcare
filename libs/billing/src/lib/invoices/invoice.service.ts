import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  localDayBounds,
  NotFoundError,
  requireFacilityId,
  systemActor,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { applyDiscountSchema, createInvoiceSchema, listInvoicesSchema, payerStatusSchema, setPayerSchema, voidInvoiceSchema } from "../billing.dto";
import { computeInvoice, depositApplied, discountConflict, documentNumber, invoiceBalance, paidNet, type Settlement } from "../billing.rules";
import {
  billingAccountEntry,
  billingCharge,
  type BillingChargeRecord,
  billingCreditNote,
  billingCreditNoteLine,
  billingCreditNotePayer,
  billingDebitNote,
  billingDebitNoteLine,
  billingDiscountRule,
  billingInvoice,
  billingInvoiceDiscount,
  billingInvoiceItem,
  billingInvoicePayer,
  type BillingInvoiceRecord,
  billingPayer,
  billingPayment,
  billingPaymentIntent,
  billingService,
} from "../billing.schema";
import { assertVersion, found, maskIdNumber, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { ChargeService } from "../charges/charge.service";
import { BILLING_PATIENTS, type BillingPatientDirectory } from "../ports";

/**
 * Invoices. A draft gathers a patient's pending charges at one facility and
 * takes discounts (with eligibility evidence) and payer coverage (HMO LOA,
 * PhilHealth, insurer); every change recomputes the totals. Issuing assigns
 * the number and freezes the invoice (database trigger). Corrections are a
 * void — only once nothing is paid and no credit note was issued — optionally
 * with a new draft carrying the same charges, discounts and coverage (deposit
 * applied to it returns to the patient's account), or a credit note
 * (CreditNoteService).
 */
@Injectable()
export class InvoiceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly charges: ChargeService,
    private readonly organizations: OrganizationService,
    @Inject(BILLING_PATIENTS) private readonly patients: BillingPatientDirectory,
  ) {}

  // ---- drafts -------------------------------------------------------------------------------

  async createDraft(actor: Actor, input: z.infer<typeof createInvoiceSchema>) {
    const facilityId = requireFacilityId(actor);
    const id = await this.db.transaction(async (tx) => {
      const pending = await this.charges.lockPending(tx, actor.organizationId, facilityId, input.patientId, input.chargeIds);
      if (pending.length === 0) throw new BusinessRuleError("The patient has no charges to invoice at this facility", "no_pending_charges");
      if (input.chargeIds && pending.length !== new Set(input.chargeIds).size) {
        throw new BusinessRuleError("Some charges are not pending for this patient at this facility", "charges_not_pending");
      }
      const [created] = await tx
        .insert(billingInvoice)
        .values({ organizationId: actor.organizationId, facilityId, patientId: input.patientId, notes: input.notes ?? null, createdBy: actor.userId })
        .returning();
      const invoice = found(created, "Invoice");
      await this.attachCharges(tx, invoice, pending);
      await this.recompute(tx, invoice.id);
      await this.audit.record(tx, actor, {
        action: "billing.invoice.draft",
        resourceType: "billing_invoice",
        resourceId: invoice.id,
        patientId: invoice.patientId,
        metadata: { charges: pending.length },
      });
      return invoice.id;
    });
    return this.get(actor, id);
  }

  async removeItem(actor: Actor, invoiceId: string, itemId: string, version: number) {
    await this.mutateDraft(actor, invoiceId, version, async (tx, invoice) => {
      const [item] = await tx
        .delete(billingInvoiceItem)
        .where(and(eq(billingInvoiceItem.invoiceId, invoice.id), eq(billingInvoiceItem.id, itemId)))
        .returning();
      const removed = found(item, "Invoice line");
      await tx
        .update(billingCharge)
        .set({ status: "pending", invoiceId: null, updatedAt: new Date(), version: sql`${billingCharge.version} + 1` })
        .where(eq(billingCharge.id, removed.chargeId));
      return { action: "billing.invoice.remove-line", metadata: { chargeId: removed.chargeId } };
    });
    return this.get(actor, invoiceId);
  }

  async applyDiscount(actor: Actor, invoiceId: string, input: z.infer<typeof applyDiscountSchema>) {
    await this.mutateDraft(actor, invoiceId, input.version, async (tx, invoice) => {
      const [rule] = await tx
        .select()
        .from(billingDiscountRule)
        .where(and(eq(billingDiscountRule.organizationId, actor.organizationId), eq(billingDiscountRule.id, input.ruleId)));
      const today = await this.today(actor.organizationId, invoice.facilityId);
      if (!rule || rule.status !== "active" || rule.effectiveFrom > today || (rule.effectiveUntil !== null && rule.effectiveUntil < today)) {
        throw new BusinessRuleError("This discount is not in effect", "discount_not_in_effect");
      }
      if (rule.requiresEvidence && !input.evidenceIdNumber) {
        throw new BusinessRuleError(`${rule.name} needs the ID number that proves eligibility`, "evidence_required");
      }
      const existing = await tx
        .select({ stackable: billingDiscountRule.stackable, ruleId: billingInvoiceDiscount.ruleId })
        .from(billingInvoiceDiscount)
        .innerJoin(billingDiscountRule, eq(billingDiscountRule.id, billingInvoiceDiscount.ruleId))
        .where(eq(billingInvoiceDiscount.invoiceId, invoice.id));
      if (existing.some((e) => e.ruleId === rule.id)) throw new BusinessRuleError("This discount is already applied", "discount_already_applied");
      const conflict = discountConflict(rule, existing);
      if (conflict) throw new BusinessRuleError("This discount cannot be combined with the one already applied", conflict);
      await tx.insert(billingInvoiceDiscount).values({
        organizationId: actor.organizationId,
        invoiceId: invoice.id,
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleName: rule.name,
        rateBp: rule.rateBp,
        evidenceIdNumber: input.evidenceIdNumber ?? null,
        evidenceNote: input.evidenceNote ?? null,
        amount: 0,
        appliedBy: actor.userId,
      });
      return {
        action: "billing.invoice.discount",
        metadata: { ruleCode: rule.code, kind: rule.kind, statutory: rule.statutory, rateBp: rule.rateBp, evidence: Boolean(input.evidenceIdNumber) },
      };
    });
    return this.get(actor, invoiceId);
  }

  async removeDiscount(actor: Actor, invoiceId: string, discountId: string, version: number) {
    await this.mutateDraft(actor, invoiceId, version, async (tx, invoice) => {
      const [removed] = await tx
        .delete(billingInvoiceDiscount)
        .where(and(eq(billingInvoiceDiscount.invoiceId, invoice.id), eq(billingInvoiceDiscount.id, discountId)))
        .returning();
      return { action: "billing.invoice.remove-discount", metadata: { ruleCode: found(removed, "Discount").ruleCode } };
    });
    return this.get(actor, invoiceId);
  }

  async setPayer(actor: Actor, invoiceId: string, input: z.infer<typeof setPayerSchema>) {
    await this.mutateDraft(actor, invoiceId, input.version, async (tx, invoice) => {
      const [payer] = await tx
        .select()
        .from(billingPayer)
        .where(and(eq(billingPayer.organizationId, actor.organizationId), eq(billingPayer.id, input.payerId)));
      if (!payer || payer.status !== "active") throw new NotFoundError("Payer");
      await tx
        .insert(billingInvoicePayer)
        .values({
          organizationId: actor.organizationId,
          invoiceId: invoice.id,
          payerId: payer.id,
          amount: input.amount,
          reference: input.reference ?? null,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [billingInvoicePayer.invoiceId, billingInvoicePayer.payerId],
          set: { amount: input.amount, reference: input.reference ?? null, updatedBy: actor.userId, updatedAt: new Date() },
        });
      return { action: "billing.invoice.payer", metadata: { payerCode: payer.code, payerType: payer.payerType, amount: input.amount } };
    });
    return this.get(actor, invoiceId);
  }

  async removePayer(actor: Actor, invoiceId: string, invoicePayerId: string, version: number) {
    await this.mutateDraft(actor, invoiceId, version, async (tx, invoice) => {
      const [removed] = await tx
        .delete(billingInvoicePayer)
        .where(and(eq(billingInvoicePayer.invoiceId, invoice.id), eq(billingInvoicePayer.id, invoicePayerId)))
        .returning();
      found(removed, "Payer coverage");
      return { action: "billing.invoice.remove-payer", metadata: { payerId: removed?.payerId } };
    });
    return this.get(actor, invoiceId);
  }

  /** Throws a draft away and puts its charges back to pending. */
  async discard(actor: Actor, invoiceId: string, version: number) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lock(tx, actor, invoiceId);
      assertVersion(invoice.version, version, "Invoice");
      if (invoice.status !== "draft") throw new BusinessRuleError("Only drafts can be discarded; void an issued invoice", "invoice_not_draft");
      await tx.delete(billingInvoiceItem).where(eq(billingInvoiceItem.invoiceId, invoiceId));
      await tx.delete(billingInvoiceDiscount).where(eq(billingInvoiceDiscount.invoiceId, invoiceId));
      await tx.delete(billingInvoicePayer).where(eq(billingInvoicePayer.invoiceId, invoiceId));
      await this.releaseCharges(tx, invoiceId);
      await tx.delete(billingInvoice).where(eq(billingInvoice.id, invoiceId));
      await this.audit.record(tx, actor, {
        action: "billing.invoice.discard",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: invoice.patientId,
      });
    });
  }

  // ---- issue and void -----------------------------------------------------------------------

  async issue(actor: Actor, invoiceId: string, version: number) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lock(tx, actor, invoiceId);
      assertVersion(invoice.version, version, "Invoice");
      if (invoice.status !== "draft") throw new BusinessRuleError("The invoice is already issued", "invoice_not_draft");
      const [line] = await tx.select({ id: billingInvoiceItem.id }).from(billingInvoiceItem).where(eq(billingInvoiceItem.invoiceId, invoiceId)).limit(1);
      if (!line) throw new BusinessRuleError("An invoice needs at least one line", "invoice_empty");
      await this.recompute(tx, invoiceId);
      const now = new Date();
      const series = await this.catalog.nextNumber(tx, actor.organizationId, "invoice");
      const year = Number((await this.today(actor.organizationId, invoice.facilityId)).slice(0, 4));
      const [issued] = await tx
        .update(billingInvoice)
        .set({
          status: "issued",
          invoiceNumber: documentNumber(series.prefix, year, series.value),
          issuedAt: now,
          issuedBy: actor.userId,
          updatedAt: now,
          version: sql`${billingInvoice.version} + 1`,
        })
        .where(eq(billingInvoice.id, invoiceId))
        .returning();
      const row = found(issued, "Invoice");
      await this.audit.record(tx, actor, {
        action: "billing.invoice.issue",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: row.patientId,
        metadata: { invoiceNumber: row.invoiceNumber, netTotal: row.netTotal, payerTotal: row.payerTotal, patientTotal: row.patientTotal },
      });
      await this.events.record(tx, invoiceEvent("InvoiceIssued", row));
    });
    return this.get(actor, invoiceId);
  }

  async void(actor: Actor, invoiceId: string, input: z.infer<typeof voidInvoiceSchema>) {
    const replacementId = await this.db.transaction(async (tx) => {
      const invoice = await this.lock(tx, actor, invoiceId);
      assertVersion(invoice.version, input.version, "Invoice");
      if (invoice.status !== "issued") throw new BusinessRuleError("Only issued invoices can be voided", "invoice_not_issued");
      const ledger = await tx
        .select({ kind: billingPayment.kind, amount: billingPayment.amount })
        .from(billingPayment)
        .where(eq(billingPayment.invoiceId, invoiceId));
      if (paidNet(ledger) !== 0) throw new BusinessRuleError("Refund the payments before voiding this invoice", "invoice_has_payments");
      const [credited] = await tx.select({ id: billingCreditNote.id }).from(billingCreditNote).where(eq(billingCreditNote.invoiceId, invoiceId)).limit(1);
      if (credited) throw new BusinessRuleError("A credit note was issued for this invoice; correct it with another credit note", "invoice_has_credit_notes");
      const [debited] = await tx.select({ id: billingDebitNote.id }).from(billingDebitNote).where(eq(billingDebitNote.invoiceId, invoiceId)).limit(1);
      if (debited) throw new BusinessRuleError("A debit note was issued for this invoice; correct it with a credit note", "invoice_has_debit_notes");
      const settled = await tx
        .select({ id: billingInvoicePayer.id })
        .from(billingInvoicePayer)
        .where(and(eq(billingInvoicePayer.invoiceId, invoiceId), eq(billingInvoicePayer.status, "settled")));
      if (settled.length) throw new BusinessRuleError("A payer has already settled this invoice", "invoice_payer_settled");

      let replacement: BillingInvoiceRecord | undefined;
      if (input.reissue) {
        const [created] = await tx
          .insert(billingInvoice)
          .values({
            organizationId: actor.organizationId,
            facilityId: invoice.facilityId,
            patientId: invoice.patientId,
            notes: invoice.notes,
            createdBy: actor.userId,
          })
          .returning();
        replacement = found(created, "Invoice");
        const charges = await tx.select().from(billingCharge).where(eq(billingCharge.invoiceId, invoiceId)).for("update");
        await this.attachCharges(tx, replacement, charges);
        const discounts = await tx
          .select()
          .from(billingInvoiceDiscount)
          .where(eq(billingInvoiceDiscount.invoiceId, invoiceId))
          .orderBy(asc(billingInvoiceDiscount.appliedAt));
        for (const { id: _id, invoiceId: _inv, ...d } of discounts)
          await tx.insert(billingInvoiceDiscount).values({ ...d, invoiceId: replacement.id, appliedBy: actor.userId, appliedAt: new Date() });
        const payers = await tx.select().from(billingInvoicePayer).where(eq(billingInvoicePayer.invoiceId, invoiceId));
        for (const p of payers) {
          await tx.insert(billingInvoicePayer).values({
            organizationId: p.organizationId,
            invoiceId: replacement.id,
            payerId: p.payerId,
            amount: p.amount,
            reference: p.reference,
            updatedBy: actor.userId,
          });
        }
        await this.recompute(tx, replacement.id);
      } else {
        await this.releaseCharges(tx, invoiceId);
      }
      const released = await this.releaseDeposits(tx, actor, invoice);
      const [voided] = await tx
        .update(billingInvoice)
        .set({
          status: "void",
          voidedAt: new Date(),
          voidedBy: actor.userId,
          voidReason: input.reason,
          replacedById: replacement?.id ?? null,
          updatedAt: new Date(),
          version: sql`${billingInvoice.version} + 1`,
        })
        .where(eq(billingInvoice.id, invoiceId))
        .returning();
      const row = found(voided, "Invoice");
      await this.audit.record(tx, actor, {
        action: "billing.invoice.void",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: row.patientId,
        reason: input.reason,
        metadata: { invoiceNumber: row.invoiceNumber, replacementId: replacement?.id ?? null, depositReleased: released },
      });
      await this.events.record(tx, invoiceEvent("InvoiceVoided", row, { replacementId: replacement?.id ?? null }));
      return replacement?.id ?? null;
    });
    return { voided: await this.get(actor, invoiceId), replacement: replacementId ? await this.get(actor, replacementId) : null };
  }

  /** Claim follow-up after issue: submitted, settled (with the amount) or denied. The amounts on the invoice do not change. */
  async updatePayerStatus(actor: Actor, invoiceId: string, invoicePayerId: string, input: z.infer<typeof payerStatusSchema>) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lock(tx, actor, invoiceId);
      if (invoice.status !== "issued") throw new BusinessRuleError("Claims are followed up on issued invoices", "invoice_not_issued");
      const [current] = await tx
        .select()
        .from(billingInvoicePayer)
        .where(and(eq(billingInvoicePayer.invoiceId, invoiceId), eq(billingInvoicePayer.id, invoicePayerId)))
        .for("update");
      const coverage = found(current, "Payer coverage");
      const [creditedToPayer] = await tx
        .select({ total: sql<number>`coalesce(sum(${billingCreditNotePayer.amount}), 0)::bigint` })
        .from(billingCreditNotePayer)
        .where(eq(billingCreditNotePayer.invoicePayerId, invoicePayerId));
      if (input.settledAmount !== undefined && input.settledAmount > coverage.amount - Number(creditedToPayer?.total ?? 0)) {
        throw new BusinessRuleError("The settled amount is more than the coverage on the invoice", "settled_exceeds_coverage");
      }
      await tx
        .update(billingInvoicePayer)
        .set({
          status: input.status,
          settledAmount: input.settledAmount ?? null,
          reference: input.reference ?? coverage.reference,
          statusNote: input.note ?? null,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(billingInvoicePayer.id, invoicePayerId));
      await this.audit.record(tx, actor, {
        action: "billing.claim.status",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: invoice.patientId,
        changes: { status: { from: coverage.status, to: input.status } },
        metadata: { payerId: coverage.payerId, settledAmount: input.settledAmount ?? null },
      });
      await this.events.record(tx, invoiceEvent("ClaimStatusChanged", invoice, { invoicePayerId, status: input.status }));
    });
    return this.get(actor, invoiceId);
  }

  /**
   * An integration (PhilHealth eClaims) reports that the payer acknowledged the claim: the coverage line becomes
   * "submitted" with the external reference. Idempotent — a line already past "pending" is left as it is. Attributed
   * to the user who requested the submission; audited as the system.
   */
  async recordIntegrationClaimSubmitted(input: {
    organizationId: string;
    invoiceId: string;
    invoicePayerId: string;
    reference: string;
    requestedBy: string;
    system: string;
  }) {
    const actor = systemActor(input.organizationId, null, input.system);
    await this.db.transaction(async (tx) => {
      const invoice = await this.lock(tx, actor, input.invoiceId);
      const [current] = await tx
        .select()
        .from(billingInvoicePayer)
        .where(and(eq(billingInvoicePayer.invoiceId, input.invoiceId), eq(billingInvoicePayer.id, input.invoicePayerId)))
        .for("update");
      const coverage = found(current, "Payer coverage");
      if (invoice.status !== "issued" || coverage.status !== "pending") return;
      await tx
        .update(billingInvoicePayer)
        .set({
          status: "submitted",
          reference: input.reference,
          statusNote: `Submitted through ${input.system}`,
          updatedBy: input.requestedBy,
          updatedAt: new Date(),
        })
        .where(eq(billingInvoicePayer.id, input.invoicePayerId));
      await this.audit.record(tx, actor, {
        action: "billing.claim.status",
        resourceType: "billing_invoice",
        resourceId: input.invoiceId,
        patientId: invoice.patientId,
        changes: { status: { from: coverage.status, to: "submitted" } },
        metadata: { payerId: coverage.payerId, via: input.system, requestedBy: input.requestedBy },
      });
      await this.events.record(tx, invoiceEvent("ClaimStatusChanged", invoice, { invoicePayerId: input.invoicePayerId, status: "submitted" }));
    });
  }

  /** Invoice lines with the clinical source of their charge (for claim preparation; no audit — callers audit). */
  async itemSources(organizationId: string, invoiceId: string) {
    return this.db
      .select({ itemId: billingInvoiceItem.id, sourceType: billingCharge.sourceType, sourceId: billingCharge.sourceId })
      .from(billingInvoiceItem)
      .innerJoin(billingCharge, eq(billingCharge.id, billingInvoiceItem.chargeId))
      .where(and(eq(billingInvoiceItem.organizationId, organizationId), eq(billingInvoiceItem.invoiceId, invoiceId)));
  }

  // ---- reads --------------------------------------------------------------------------------

  async get(actor: Actor, invoiceId: string) {
    const view = await this.detail(actor.organizationId, invoiceId);
    await this.audit.recordStandalone(actor, {
      action: "billing.invoice.view",
      resourceType: "billing_invoice",
      resourceId: invoiceId,
      patientId: view.patientId,
    });
    const patients = await this.patients.summaries(actor.organizationId, [view.patientId]);
    return { ...view, patient: patients.get(view.patientId) ?? null };
  }

  /** An invoice with its lines, discounts, payers and ledger (no audit; callers audit). */
  async detail(organizationId: string, invoiceId: string) {
    const [invoice] = await this.db
      .select()
      .from(billingInvoice)
      .where(and(eq(billingInvoice.organizationId, organizationId), eq(billingInvoice.id, invoiceId)));
    const row = found(invoice, "Invoice");
    const [items, discounts, payers, ledger, account, creditNotes, creditLines, creditPayers, debitNotes, debitLines, intents] = await Promise.all([
      this.db
        .select()
        .from(billingInvoiceItem)
        .where(eq(billingInvoiceItem.invoiceId, invoiceId))
        .orderBy(asc(billingInvoiceItem.serviceDate), asc(billingInvoiceItem.description)),
      this.db.select().from(billingInvoiceDiscount).where(eq(billingInvoiceDiscount.invoiceId, invoiceId)).orderBy(asc(billingInvoiceDiscount.appliedAt)),
      this.db
        .select({ coverage: billingInvoicePayer, name: billingPayer.name, payerType: billingPayer.payerType })
        .from(billingInvoicePayer)
        .innerJoin(billingPayer, eq(billingPayer.id, billingInvoicePayer.payerId))
        .where(eq(billingInvoicePayer.invoiceId, invoiceId)),
      this.db.select().from(billingPayment).where(eq(billingPayment.invoiceId, invoiceId)).orderBy(asc(billingPayment.recordedAt)),
      this.db.select().from(billingAccountEntry).where(eq(billingAccountEntry.invoiceId, invoiceId)).orderBy(asc(billingAccountEntry.recordedAt)),
      this.db.select().from(billingCreditNote).where(eq(billingCreditNote.invoiceId, invoiceId)).orderBy(asc(billingCreditNote.issuedAt)),
      this.db
        .select({ line: billingCreditNoteLine })
        .from(billingCreditNoteLine)
        .innerJoin(billingCreditNote, eq(billingCreditNote.id, billingCreditNoteLine.creditNoteId))
        .where(eq(billingCreditNote.invoiceId, invoiceId)),
      this.db
        .select({ payer: billingCreditNotePayer })
        .from(billingCreditNotePayer)
        .innerJoin(billingCreditNote, eq(billingCreditNote.id, billingCreditNotePayer.creditNoteId))
        .where(eq(billingCreditNote.invoiceId, invoiceId)),
      this.db.select().from(billingDebitNote).where(eq(billingDebitNote.invoiceId, invoiceId)).orderBy(asc(billingDebitNote.issuedAt)),
      this.db
        .select({ line: billingDebitNoteLine })
        .from(billingDebitNoteLine)
        .innerJoin(billingDebitNote, eq(billingDebitNote.id, billingDebitNoteLine.debitNoteId))
        .where(eq(billingDebitNote.invoiceId, invoiceId)),
      this.db.select().from(billingPaymentIntent).where(eq(billingPaymentIntent.invoiceId, invoiceId)).orderBy(asc(billingPaymentIntent.createdAt)),
    ]);
    const settlement: Settlement = {
      paid: paidNet(ledger),
      depositApplied: depositApplied(account),
      credited: creditNotes.reduce((a, c) => a + c.appliedAmount, 0),
      debited: debitNotes.reduce((a, d) => a + d.amount, 0),
    };
    const payerCredited = (invoicePayerId: string) =>
      creditPayers.filter((p) => p.payer.invoicePayerId === invoicePayerId).reduce((a, p) => a + p.payer.amount, 0);
    return {
      ...publicView(row),
      items: items.map(publicView),
      // The eligibility ID number is kept for audit and claims; screens show only its last digits.
      discounts: discounts.map(({ evidenceIdNumber, ...d }) => ({ ...publicView(d), evidenceIdMasked: maskIdNumber(evidenceIdNumber) })),
      payers: payers.map((p) => ({ ...publicView(p.coverage), payerName: p.name, payerType: p.payerType, creditedAmount: payerCredited(p.coverage.id) })),
      payments: ledger.map(publicView),
      /** Deposit or account credit applied to this invoice, and released by a void. */
      accountEntries: account.map(({ idempotencyKey: _key, ...e }) => publicView(e)),
      creditNotes: creditNotes.map(({ idempotencyKey: _key, ...c }) => ({
        ...publicView(c),
        lines: creditLines.filter((l) => l.line.creditNoteId === c.id).map((l) => publicView(l.line)),
        payers: creditPayers.filter((p) => p.payer.creditNoteId === c.id).map((p) => publicView(p.payer)),
      })),
      debitNotes: debitNotes.map(({ idempotencyKey: _key, ...d }) => ({
        ...publicView(d),
        lines: debitLines.filter((l) => l.line.debitNoteId === d.id).map((l) => publicView(l.line)),
      })),
      debitedTotal: settlement.debited,
      /** Payments started online (the provider's checkout), whatever their outcome. */
      onlinePayments: intents.map((i) => ({
        id: i.id,
        amount: i.amount,
        status: i.status,
        provider: i.provider,
        paidAmount: i.paidAmount,
        failureCode: i.failureCode,
        createdAt: i.createdAt,
        completedAt: i.completedAt,
      })),
      paidTotal: settlement.paid,
      depositAppliedTotal: settlement.depositApplied,
      creditedTotal: settlement.credited,
      creditNoteTotal: creditNotes.reduce((a, c) => a + c.amount, 0),
      balance: row.status === "issued" ? invoiceBalance(row.patientTotal, settlement) : 0,
    };
  }

  async list(actor: Actor, query: z.infer<typeof listInvoicesSchema>) {
    const facilityId = requireFacilityId(actor);
    const filters: SQL[] = [eq(billingInvoice.organizationId, actor.organizationId), eq(billingInvoice.facilityId, facilityId)];
    if (query.patientId) filters.push(eq(billingInvoice.patientId, query.patientId));
    if (query.status) filters.push(eq(billingInvoice.status, query.status));
    if (query.date) {
      const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
      const { start, end } = localDayBounds(query.date, facility.timezone);
      const when = sql`coalesce(${billingInvoice.issuedAt}, ${billingInvoice.createdAt})`;
      filters.push(gte(when, start), lt(when, end));
    }
    // Qualified by hand: inside a single-table select Drizzle would render the column unqualified.
    const paid = sql<number>`coalesce((SELECT sum(CASE WHEN p.kind = 'payment' THEN p.amount ELSE -p.amount END) FROM billing_payment p WHERE p.invoice_id = "billing_invoice"."id"), 0)::bigint`;
    // Payments, deposit applied (less releases) and credit notes (the part that reduced the balance), less debit notes.
    const settled = sql<number>`(${paid}
      + coalesce((SELECT sum(CASE WHEN a.kind = 'application' THEN a.amount ELSE -a.amount END) FROM billing_account_entry a WHERE a.invoice_id = "billing_invoice"."id" AND a.kind IN ('application', 'release')), 0)
      + coalesce((SELECT sum(c.applied_amount) FROM billing_credit_note c WHERE c.invoice_id = "billing_invoice"."id"), 0)
      - coalesce((SELECT sum(d.amount) FROM billing_debit_note d WHERE d.invoice_id = "billing_invoice"."id"), 0))::bigint`;
    if (query.unpaid) filters.push(eq(billingInvoice.status, "issued"), sql`${billingInvoice.patientTotal} > ${settled}`);
    const rows = await this.db
      .select({ invoice: billingInvoice, paid, settled })
      .from(billingInvoice)
      .where(and(...filters))
      .orderBy(desc(sql`coalesce(${billingInvoice.issuedAt}, ${billingInvoice.createdAt})`))
      .limit(300);
    const patients = await this.patients.summaries(actor.organizationId, [...new Set(rows.map((r) => r.invoice.patientId))]);
    await this.audit.recordStandalone(actor, {
      action: "billing.invoice.list",
      resourceType: "billing_invoice",
      patientId: query.patientId,
      metadata: { facilityId, count: rows.length },
    });
    return rows.map(({ invoice, paid: paidRaw, settled: settledRaw }) => {
      const paidTotal = Number(paidRaw);
      return {
        ...publicView(invoice),
        paidTotal,
        balance: invoice.status === "issued" ? invoice.patientTotal - Number(settledRaw) : 0,
        patient: patients.get(invoice.patientId) ?? null,
      };
    });
  }

  /** A patient's issued (and voided) invoices, for MyHealth: no internal notes or staff names. */
  async patientInvoices(organizationId: string, patientId: string) {
    const rows = await this.db
      .select({ id: billingInvoice.id })
      .from(billingInvoice)
      .where(
        and(eq(billingInvoice.organizationId, organizationId), eq(billingInvoice.patientId, patientId), inArray(billingInvoice.status, ["issued", "void"])),
      )
      .orderBy(desc(billingInvoice.issuedAt))
      .limit(100);
    const invoices = await Promise.all(rows.map((r) => this.detail(organizationId, r.id)));
    return invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      issuedAt: inv.issuedAt,
      grossTotal: inv.grossTotal,
      discountTotal: inv.discountTotal,
      netTotal: inv.netTotal,
      payerTotal: inv.payerTotal,
      patientTotal: inv.patientTotal,
      paidTotal: inv.paidTotal,
      depositAppliedTotal: inv.depositAppliedTotal,
      creditedTotal: inv.creditedTotal,
      debitedTotal: inv.debitedTotal,
      balance: inv.balance,
      items: inv.items.map((i) => ({
        description: i.description,
        serviceDate: i.serviceDate,
        quantity: i.quantity,
        grossAmount: i.grossAmount,
        discountAmount: i.discountAmount,
        netAmount: i.netAmount,
      })),
      discounts: inv.discounts.map((d) => ({ name: d.ruleName, amount: d.amount })),
      payers: inv.payers.map((p) => ({ name: p.payerName, amount: p.amount, status: p.status })),
      payments: inv.payments.map((p) => ({ kind: p.kind, amount: p.amount, method: p.method, receiptNumber: p.receiptNumber, recordedAt: p.recordedAt })),
      depositApplications: inv.accountEntries.map((e) => ({ kind: e.kind as "application" | "release", amount: e.amount, recordedAt: e.recordedAt })),
      creditNotes: inv.creditNotes.map((c) => ({
        id: c.id,
        creditNoteNumber: c.creditNoteNumber,
        issuedAt: c.issuedAt,
        reason: c.reason,
        amount: c.amount,
        appliedAmount: c.appliedAmount,
        accountCredit: c.accountCredit,
      })),
      onlinePayments: inv.onlinePayments.map((o) => ({ id: o.id, amount: o.amount, status: o.status, createdAt: o.createdAt })),
      debitNotes: inv.debitNotes.map((d) => ({
        id: d.id,
        debitNoteNumber: d.debitNoteNumber,
        issuedAt: d.issuedAt,
        reason: d.reason,
        amount: d.amount,
        lines: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, amount: l.amount })),
      })),
    }));
  }

  // ---- internals ----------------------------------------------------------------------------

  /** What settles an invoice (payments, deposit applied, credit notes), read inside the caller's transaction. */
  async settlement(tx: DbExecutor, invoiceId: string): Promise<Settlement> {
    const [ledger, account, credits, debits] = await Promise.all([
      tx.select({ kind: billingPayment.kind, amount: billingPayment.amount }).from(billingPayment).where(eq(billingPayment.invoiceId, invoiceId)),
      tx
        .select({ kind: billingAccountEntry.kind, amount: billingAccountEntry.amount })
        .from(billingAccountEntry)
        .where(eq(billingAccountEntry.invoiceId, invoiceId)),
      tx
        .select({ total: sql<number>`coalesce(sum(${billingCreditNote.appliedAmount}), 0)::bigint` })
        .from(billingCreditNote)
        .where(eq(billingCreditNote.invoiceId, invoiceId)),
      tx
        .select({ total: sql<number>`coalesce(sum(${billingDebitNote.amount}), 0)::bigint` })
        .from(billingDebitNote)
        .where(eq(billingDebitNote.invoiceId, invoiceId)),
    ]);
    return {
      paid: paidNet(ledger),
      depositApplied: depositApplied(account),
      credited: Number(credits[0]?.total ?? 0),
      debited: Number(debits[0]?.total ?? 0),
    };
  }

  /** On a void, deposit or account credit applied to the invoice goes back to the patient's account. Returns the amount. */
  private async releaseDeposits(tx: DbExecutor, actor: Actor, invoice: BillingInvoiceRecord): Promise<number> {
    const entries = await tx.select().from(billingAccountEntry).where(eq(billingAccountEntry.invoiceId, invoice.id));
    const releasedIds = new Set(entries.filter((e) => e.kind === "release").map((e) => e.applicationId));
    const open = entries.filter((e) => e.kind === "application" && !releasedIds.has(e.id));
    for (const application of open) {
      await tx.insert(billingAccountEntry).values({
        organizationId: invoice.organizationId,
        facilityId: invoice.facilityId,
        patientId: invoice.patientId,
        kind: "release",
        amount: application.amount,
        invoiceId: invoice.id,
        applicationId: application.id,
        recordedBy: actor.userId,
      });
    }
    return open.reduce((a, e) => a + e.amount, 0);
  }

  async lock(tx: DbExecutor, actor: Actor, invoiceId: string) {
    const [row] = await tx
      .select()
      .from(billingInvoice)
      .where(and(eq(billingInvoice.organizationId, actor.organizationId), eq(billingInvoice.id, invoiceId)))
      .for("update");
    const invoice = found(row, "Invoice");
    if (actor.facilityId && invoice.facilityId !== actor.facilityId) throw new NotFoundError("Invoice");
    return invoice;
  }

  private async mutateDraft(
    actor: Actor,
    invoiceId: string,
    version: number,
    change: (tx: DbExecutor, invoice: BillingInvoiceRecord) => Promise<{ action: string; metadata?: Record<string, unknown> }>,
  ) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lock(tx, actor, invoiceId);
      assertVersion(invoice.version, version, "Invoice");
      if (invoice.status !== "draft") throw new BusinessRuleError("Issued invoices cannot be changed; void and reissue", "invoice_not_draft");
      const { action, metadata } = await change(tx, invoice);
      await this.recompute(tx, invoiceId);
      await this.audit.record(tx, actor, { action, resourceType: "billing_invoice", resourceId: invoiceId, patientId: invoice.patientId, metadata });
    });
  }

  private async attachCharges(tx: DbExecutor, invoice: BillingInvoiceRecord, charges: BillingChargeRecord[]) {
    if (charges.length === 0) return;
    const services = await tx
      .select({ id: billingService.id, category: billingService.category })
      .from(billingService)
      .where(
        inArray(
          billingService.id,
          charges.map((c) => c.serviceId),
        ),
      );
    const category = new Map(services.map((s) => [s.id, s.category]));
    await tx
      .update(billingCharge)
      .set({ status: "invoiced", invoiceId: invoice.id, updatedAt: new Date(), version: sql`${billingCharge.version} + 1` })
      .where(
        inArray(
          billingCharge.id,
          charges.map((c) => c.id),
        ),
      );
    await tx.insert(billingInvoiceItem).values(
      charges.map((c) => ({
        organizationId: invoice.organizationId,
        invoiceId: invoice.id,
        chargeId: c.id,
        serviceId: c.serviceId,
        category: category.get(c.serviceId) ?? "other",
        description: c.description,
        serviceDate: c.serviceDate,
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        grossAmount: c.unitPrice * c.quantity,
        discountAmount: 0,
        netAmount: c.unitPrice * c.quantity,
      })),
    );
  }

  private async releaseCharges(tx: DbExecutor, invoiceId: string) {
    await tx
      .update(billingCharge)
      .set({ status: "pending", invoiceId: null, updatedAt: new Date(), version: sql`${billingCharge.version} + 1` })
      .where(eq(billingCharge.invoiceId, invoiceId));
  }

  /** Recomputes a draft's discounts and totals from its lines, discounts and payer coverage. */
  private async recompute(tx: DbExecutor, invoiceId: string) {
    const items = await tx.select().from(billingInvoiceItem).where(eq(billingInvoiceItem.invoiceId, invoiceId)).orderBy(asc(billingInvoiceItem.id));
    const discounts = await tx
      .select({ id: billingInvoiceDiscount.id, rateBp: billingInvoiceDiscount.rateBp, categories: billingDiscountRule.categories })
      .from(billingInvoiceDiscount)
      .innerJoin(billingDiscountRule, eq(billingDiscountRule.id, billingInvoiceDiscount.ruleId))
      .where(eq(billingInvoiceDiscount.invoiceId, invoiceId))
      .orderBy(asc(billingInvoiceDiscount.appliedAt), asc(billingInvoiceDiscount.id));
    const totals = computeInvoice(items, discounts);
    for (const [i, item] of items.entries()) {
      const line = totals.lines[i];
      if (line && line.discountAmount !== item.discountAmount) {
        await tx.update(billingInvoiceItem).set({ discountAmount: line.discountAmount, netAmount: line.netAmount }).where(eq(billingInvoiceItem.id, item.id));
      }
    }
    for (const [i, d] of discounts.entries()) {
      await tx
        .update(billingInvoiceDiscount)
        .set({ amount: totals.discountAmounts[i] ?? 0 })
        .where(eq(billingInvoiceDiscount.id, d.id));
    }
    const [coverage] = await tx
      .select({ total: sql<number>`coalesce(sum(${billingInvoicePayer.amount}), 0)::bigint` })
      .from(billingInvoicePayer)
      .where(eq(billingInvoicePayer.invoiceId, invoiceId));
    const payerTotal = Number(coverage?.total ?? 0);
    if (payerTotal > totals.netTotal) {
      throw new BusinessRuleError("Payer coverage is more than the invoice total after discounts", "coverage_exceeds_total", {
        netTotal: totals.netTotal,
        payerTotal,
      });
    }
    await tx
      .update(billingInvoice)
      .set({
        grossTotal: totals.grossTotal,
        discountTotal: totals.discountTotal,
        netTotal: totals.netTotal,
        payerTotal,
        patientTotal: totals.netTotal - payerTotal,
        updatedAt: new Date(),
        version: sql`${billingInvoice.version} + 1`,
      })
      .where(eq(billingInvoice.id, invoiceId));
  }

  private async today(organizationId: string, facilityId: string) {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return localDate(new Date(), facility.timezone);
  }
}

export function invoiceEvent(type: string, row: BillingInvoiceRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "billing_invoice",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { status: row.status, netTotal: row.netTotal, patientTotal: row.patientTotal, ...extra },
  };
}
