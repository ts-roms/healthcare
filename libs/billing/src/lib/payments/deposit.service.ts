import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  requireFacilityId,
  filedAsPatient,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { applyDepositSchema, recordDepositSchema, refundAccountSchema } from "../billing.dto";
import { accountBalance, applicationProblem, documentNumber, invoiceBalance, transferPlan } from "../billing.rules";
import { billingAccountEntry, type BillingAccountEntryRecord, billingCreditNote, billingInvoice } from "../billing.schema";
import { found, lockPatientAccount, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { InvoiceService } from "../invoices/invoice.service";
import { BILLING_PATIENTS, type BillingPatientDirectory } from "../ports";

const APPLICATION_MESSAGE: Record<string, string> = {
  amount_invalid: "Enter an amount in centavos",
  application_exceeds_account: "The amount is more than the patient's deposit and credit balance",
  application_exceeds_balance: "The amount is more than the invoice balance",
};

/**
 * The patient's account at a facility: deposits (advance payments) received,
 * credit from credit notes, applied to issued invoices (partly or fully) or
 * refunded. An append-only ledger (database trigger); the balance is derived
 * from it and never goes below zero. Each staff request carries an
 * idempotency key, so a retried request is recorded once. Deposits get a
 * receipt number from the receipt series (an acknowledgement receipt; whether
 * it may serve as a BIR official receipt is a compliance dependency). When the
 * organization lets deposits be used across its facilities, balance held at
 * another facility is moved (a pair of transfer entries) before it is applied
 * or refunded, so each facility's ledger stays whole.
 */
@Injectable()
export class DepositService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly invoices: InvoiceService,
    private readonly organizations: OrganizationService,
    @Inject(BILLING_PATIENTS) private readonly patients: BillingPatientDirectory,
  ) {}

  /** The patient's account at the selected facility: balance and ledger (with the invoice or credit note of each entry). */
  async account(actor: Actor, patientId: string) {
    const facilityId = requireFacilityId(actor);
    const entries = await this.entries(actor.organizationId, patientId, facilityId);
    await this.audit.recordStandalone(actor, {
      action: "billing.account.view",
      resourceType: "billing_account_entry",
      patientId,
      metadata: { facilityId, count: entries.length },
    });
    const shared = (await this.catalog.taxProfile(actor.organizationId)).depositsAcrossFacilities;
    // Shown across the ledgers of records merged into this patient (ADR-0009); applying and refunding use this record's own.
    const facilities = shared ? await this.facilityBalances(this.db, actor.organizationId, patientId, true) : null;
    return {
      patientId,
      facilityId,
      balance: accountBalance(entries),
      /** When deposits can be used across facilities: every facility's balance, and their total. */
      usableAcrossFacilities: shared,
      facilities,
      organizationBalance: facilities ? facilities.reduce((a, f) => a + f.balance, 0) : null,
      entries,
    };
  }

  async deposit(actor: Actor, patientId: string, input: z.infer<typeof recordDepositSchema>) {
    const facilityId = requireFacilityId(actor);
    const existing = await this.byKey(actor.organizationId, input.idempotencyKey);
    if (existing) return this.replay(existing, { kind: "deposit", amount: input.amount, patientId });
    const patients = await this.patients.summaries(actor.organizationId, [patientId]);
    if (!patients.has(patientId)) throw new NotFoundError("Patient");
    const entry = await this.db.transaction(async (tx) => {
      await lockPatientAccount(tx, actor.organizationId, patientId);
      const series = await this.catalog.nextNumber(tx, actor.organizationId, "receipt");
      const year = Number((await this.today(actor.organizationId, facilityId)).slice(0, 4));
      const [created] = await tx
        .insert(billingAccountEntry)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId,
          kind: "deposit",
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          receiptNumber: documentNumber(series.prefix, year, series.value),
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        })
        .returning();
      const row = found(created, "Deposit");
      const balance = await this.balance(tx, actor.organizationId, facilityId, patientId);
      await this.audit.record(tx, actor, {
        action: "billing.deposit.record",
        resourceType: "billing_account_entry",
        resourceId: row.id,
        patientId,
        metadata: { amount: row.amount, method: row.method, receiptNumber: row.receiptNumber },
      });
      await this.events.record(tx, accountEvent("DepositReceived", row, { balance }));
      return row;
    });
    return view(entry);
  }

  /** Applies deposit or credit balance to an issued invoice: never more than the invoice balance or the account balance. */
  async apply(actor: Actor, invoiceId: string, input: z.infer<typeof applyDepositSchema>) {
    const existing = await this.byKey(actor.organizationId, input.idempotencyKey);
    if (existing) return this.replay(existing, { kind: "application", amount: input.amount, invoiceId });
    const entry = await this.db.transaction(async (tx) => {
      const invoice = await this.invoices.lock(tx, actor, invoiceId);
      if (invoice.status !== "issued") throw new BusinessRuleError("Deposits are applied to issued invoices", "invoice_not_issued");
      await lockPatientAccount(tx, actor.organizationId, invoice.patientId);
      const owed = invoiceBalance(invoice.patientTotal, await this.invoices.settlement(tx, invoiceId));
      const available = await this.usable(tx, actor.organizationId, invoice.facilityId, invoice.patientId);
      const problem = applicationProblem(input.amount, owed, available.total);
      if (problem)
        throw new BusinessRuleError(APPLICATION_MESSAGE[problem] ?? "The amount cannot be applied", problem, { balance: owed, available: available.total });
      await this.moveHere(tx, actor, invoice.facilityId, invoice.patientId, input.amount, available);
      const [created] = await tx
        .insert(billingAccountEntry)
        .values({
          organizationId: actor.organizationId,
          facilityId: invoice.facilityId,
          patientId: invoice.patientId,
          kind: "application",
          amount: input.amount,
          invoiceId,
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        })
        .returning();
      const row = found(created, "Deposit application");
      await this.audit.record(tx, actor, {
        action: "billing.deposit.apply",
        resourceType: "billing_invoice",
        resourceId: invoiceId,
        patientId: row.patientId,
        metadata: { entryId: row.id, amount: row.amount, invoiceNumber: invoice.invoiceNumber },
      });
      await this.events.record(tx, accountEvent("DepositApplied", row, { balance: owed - row.amount, accountBalance: available.total - row.amount }));
      return row;
    });
    return view(entry);
  }

  /** Returns unapplied deposit or credit to the patient (billing.refund.issue, with a reason). */
  async refund(actor: Actor, patientId: string, input: z.infer<typeof refundAccountSchema>) {
    const facilityId = requireFacilityId(actor);
    const existing = await this.byKey(actor.organizationId, input.idempotencyKey);
    if (existing) return this.replay(existing, { kind: "refund", amount: input.amount, patientId });
    const entry = await this.db.transaction(async (tx) => {
      await lockPatientAccount(tx, actor.organizationId, patientId);
      const available = await this.usable(tx, actor.organizationId, facilityId, patientId);
      if (input.amount > available.total) {
        throw new BusinessRuleError("The refund is more than the patient's deposit and credit balance", "refund_exceeds_account", {
          available: available.total,
        });
      }
      await this.moveHere(tx, actor, facilityId, patientId, input.amount, available);
      const [created] = await tx
        .insert(billingAccountEntry)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId,
          kind: "refund",
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          recordedBy: actor.userId,
        })
        .returning();
      const row = found(created, "Refund");
      await this.audit.record(tx, actor, {
        action: "billing.deposit.refund",
        resourceType: "billing_account_entry",
        resourceId: row.id,
        patientId,
        reason: input.reason,
        metadata: { amount: row.amount, method: row.method },
      });
      await this.events.record(tx, accountEvent("DepositRefunded", row, { accountBalance: available.total - row.amount }));
      return row;
    });
    return view(entry);
  }

  /** The patient's accounts for MyHealth: per facility with a ledger, balance and entries (no staff, reasons or references). */
  async patientAccounts(organizationId: string, patientId: string) {
    const rows = await this.db
      .select({ entry: billingAccountEntry, invoiceNumber: billingInvoice.invoiceNumber, creditNoteNumber: billingCreditNote.creditNoteNumber })
      .from(billingAccountEntry)
      .leftJoin(billingInvoice, eq(billingInvoice.id, billingAccountEntry.invoiceId))
      .leftJoin(billingCreditNote, eq(billingCreditNote.id, billingAccountEntry.creditNoteId))
      .where(and(eq(billingAccountEntry.organizationId, organizationId), filedAsPatient(billingAccountEntry.patientId, patientId)))
      .orderBy(asc(billingAccountEntry.recordedAt));
    const facilityIds = [...new Set(rows.map((r) => r.entry.facilityId))];
    return Promise.all(
      facilityIds.map(async (facilityId) => {
        const facility = await this.organizations.getFacility(organizationId, facilityId);
        const entries = rows.filter((r) => r.entry.facilityId === facilityId);
        return {
          facilityName: facility.name,
          balance: accountBalance(entries.map((r) => r.entry)),
          entries: entries.map((r) => ({
            kind: r.entry.kind,
            amount: r.entry.amount,
            method: r.entry.method,
            receiptNumber: r.entry.receiptNumber,
            invoiceNumber: r.invoiceNumber,
            creditNoteNumber: r.creditNoteNumber,
            recordedAt: r.entry.recordedAt,
          })),
        };
      }),
    );
  }

  // ---- internals ----------------------------------------------------------------------------

  private async entries(organizationId: string, patientId: string, facilityId: string) {
    const rows = await this.db
      .select({ entry: billingAccountEntry, invoiceNumber: billingInvoice.invoiceNumber, creditNoteNumber: billingCreditNote.creditNoteNumber })
      .from(billingAccountEntry)
      .leftJoin(billingInvoice, eq(billingInvoice.id, billingAccountEntry.invoiceId))
      .leftJoin(billingCreditNote, eq(billingCreditNote.id, billingAccountEntry.creditNoteId))
      .where(
        and(
          eq(billingAccountEntry.organizationId, organizationId),
          filedAsPatient(billingAccountEntry.patientId, patientId),
          eq(billingAccountEntry.facilityId, facilityId),
        ),
      )
      .orderBy(asc(billingAccountEntry.recordedAt));
    return rows.map((r) => ({ ...view(r.entry), invoiceNumber: r.invoiceNumber, creditNoteNumber: r.creditNoteNumber }));
  }

  /**
   * What can be used at a facility: its own balance, plus — when the organization lets deposits be used across its
   * facilities — the other facilities' balances.
   */
  private async usable(tx: DbExecutor, organizationId: string, facilityId: string, patientId: string) {
    const here = await this.balance(tx, organizationId, facilityId, patientId);
    const shared = (await this.catalog.taxProfile(organizationId)).depositsAcrossFacilities;
    const others = shared ? (await this.facilityBalances(tx, organizationId, patientId)).filter((f) => f.facilityId !== facilityId) : [];
    return { here, others, total: here + others.reduce((a, o) => a + o.balance, 0) };
  }

  /**
   * Moves balance from the patient's accounts at other facilities to this one when its own balance does not cover
   * `amount`: a transfer_out there and a transfer_in here per facility, sharing a transfer id (audited).
   */
  private async moveHere(
    tx: DbExecutor,
    actor: Actor,
    facilityId: string,
    patientId: string,
    amount: number,
    available: { here: number; others: Array<{ facilityId: string; balance: number }> },
  ) {
    if (available.here >= amount) return;
    for (const move of transferPlan(amount - available.here, available.others)) {
      const transferId = randomUUID();
      const common = { organizationId: actor.organizationId, patientId, amount: move.amount, transferId, recordedBy: actor.userId };
      await tx.insert(billingAccountEntry).values([
        { ...common, facilityId: move.facilityId, kind: "transfer_out", counterpartFacilityId: facilityId },
        { ...common, facilityId, kind: "transfer_in", counterpartFacilityId: move.facilityId },
      ]);
      await this.audit.record(tx, actor, {
        action: "billing.deposit.transfer",
        resourceType: "billing_account_entry",
        resourceId: transferId,
        patientId,
        metadata: { from: move.facilityId, to: facilityId, amount: move.amount },
      });
    }
  }

  /** The patient's balance at each facility where they have an account (with `linked`, also of records merged into it). */
  private async facilityBalances(executor: DbExecutor, organizationId: string, patientId: string, linked = false) {
    const rows = await executor
      .select({ facilityId: billingAccountEntry.facilityId, kind: billingAccountEntry.kind, amount: billingAccountEntry.amount })
      .from(billingAccountEntry)
      .where(
        and(
          eq(billingAccountEntry.organizationId, organizationId),
          linked ? filedAsPatient(billingAccountEntry.patientId, patientId) : eq(billingAccountEntry.patientId, patientId),
        ),
      );
    const ids = [...new Set(rows.map((r) => r.facilityId))];
    return Promise.all(
      ids.map(async (id) => ({
        facilityId: id,
        facilityName: (await this.organizations.getFacility(organizationId, id)).name,
        balance: accountBalance(rows.filter((r) => r.facilityId === id)),
      })),
    );
  }

  private async balance(tx: DbExecutor, organizationId: string, facilityId: string, patientId: string) {
    const entries = await tx
      .select({ kind: billingAccountEntry.kind, amount: billingAccountEntry.amount })
      .from(billingAccountEntry)
      .where(
        and(
          eq(billingAccountEntry.organizationId, organizationId),
          eq(billingAccountEntry.patientId, patientId),
          eq(billingAccountEntry.facilityId, facilityId),
        ),
      );
    return accountBalance(entries);
  }

  private async byKey(organizationId: string, idempotencyKey: string) {
    const [row] = await this.db
      .select()
      .from(billingAccountEntry)
      .where(and(eq(billingAccountEntry.organizationId, organizationId), eq(billingAccountEntry.idempotencyKey, idempotencyKey)));
    return row;
  }

  /** A retried request returns the recorded entry; a different transaction with the same key is refused. */
  private replay(
    existing: BillingAccountEntryRecord,
    expected: { kind: BillingAccountEntryRecord["kind"]; amount: number; patientId?: string; invoiceId?: string },
  ) {
    const same =
      existing.kind === expected.kind &&
      existing.amount === expected.amount &&
      (expected.patientId === undefined || existing.patientId === expected.patientId) &&
      (expected.invoiceId === undefined || existing.invoiceId === expected.invoiceId);
    if (!same) throw new ConflictError("This idempotency key was already used for a different transaction", undefined, "idempotency_key_reused");
    return view(existing);
  }

  private async today(organizationId: string, facilityId: string) {
    const facility = await this.organizations.getFacility(organizationId, facilityId);
    return localDate(new Date(), facility.timezone);
  }
}

function view(entry: BillingAccountEntryRecord) {
  const { idempotencyKey: _key, ...rest } = entry;
  return publicView(rest);
}

function accountEvent(type: string, row: BillingAccountEntryRecord, extra: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "billing_account_entry",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { kind: row.kind, amount: row.amount, invoiceId: row.invoiceId, ...extra },
  };
}
