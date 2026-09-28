import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  APP_CONFIG,
  BadRequestError,
  type AppConfig,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  systemActor,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq } from "drizzle-orm";
import { documentNumber, invoiceBalance, onlinePaymentSplit } from "../billing.rules";
import { billingAccountEntry, billingPayment, billingPaymentIntent, type BillingPaymentIntentRecord } from "../billing.schema";
import { found, lockPatientAccount, publicView } from "../billing-support";
import { BillingCatalogService } from "../catalog/billing-catalog.service";
import { InvoiceService } from "../invoices/invoice.service";
import { PAYMENT_GATEWAY, type PaymentGateway } from "./payment-gateway";

const SYSTEM = "online-payment";

/**
 * Online payment of an issued invoice from MyHealth, through the payment
 * provider port. Offered only when an adapter is configured (the default one
 * is not: no provider has been chosen). The patient starts a payment intent
 * (idempotent per key) and is sent to the provider's hosted checkout; the
 * provider's verified notification completes it once: the payment is recorded
 * in the ledger with a receipt number (no staff user; the intent is the
 * source), and whatever exceeds the balance at that moment — the invoice was
 * paid at the counter meanwhile — becomes a deposit on the patient's account.
 */
@Injectable()
export class OnlinePaymentService {
  private readonly logger = new Logger(OnlinePaymentService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly catalog: BillingCatalogService,
    private readonly invoices: InvoiceService,
    private readonly organizations: OrganizationService,
  ) {}

  availability() {
    const spec = this.gateway.specification;
    return { available: spec.status === "configured", provider: spec.provider, name: spec.name, note: spec.note };
  }

  /** The patient starts paying (part of) an issued invoice of theirs; returns where to send them. */
  async start(
    context: { organizationId: string; patientId: string; audit: PatientAuditContext },
    invoiceId: string,
    input: { amount: number; idempotencyKey: string; returnUrl: string },
  ) {
    if (this.gateway.specification.status !== "configured") {
      throw new BusinessRuleError("Online payment is not available yet; please pay at the clinic", "integration_not_configured");
    }
    this.checkReturnUrl(input.returnUrl);
    const [existing] = await this.db
      .select()
      .from(billingPaymentIntent)
      .where(and(eq(billingPaymentIntent.organizationId, context.organizationId), eq(billingPaymentIntent.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.invoiceId !== invoiceId || existing.amount !== input.amount || existing.patientId !== context.patientId) {
        throw new ConflictError("This idempotency key was already used for a different payment", undefined, "idempotency_key_reused");
      }
      return view(existing);
    }
    const actor = systemActor(context.organizationId, null, SYSTEM);
    const intent = await this.db.transaction(async (tx) => {
      const invoice = await this.invoices.lock(tx, actor, invoiceId);
      if (invoice.patientId !== context.patientId) throw new NotFoundError("Invoice");
      if (invoice.status !== "issued") throw new BusinessRuleError("Only issued invoices can be paid", "invoice_not_issued");
      const balance = invoiceBalance(invoice.patientTotal, await this.invoices.settlement(tx, invoiceId));
      if (input.amount > balance) throw new BusinessRuleError("The payment is more than the balance", "payment_exceeds_balance", { balance });
      const [created] = await tx
        .insert(billingPaymentIntent)
        .values({
          organizationId: context.organizationId,
          facilityId: invoice.facilityId,
          invoiceId,
          patientId: context.patientId,
          amount: input.amount,
          provider: this.gateway.specification.provider,
          requestedVia: "portal",
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      const row = found(created, "Payment");
      await this.audit.record(tx, context.audit, {
        action: "portal.online-payment.start",
        resourceType: "billing_payment_intent",
        resourceId: row.id,
        patientId: context.patientId,
        metadata: { invoiceId, amount: row.amount, provider: row.provider },
      });
      return { row, invoiceNumber: invoice.invoiceNumber };
    });
    // The provider is called outside the transaction; a failure closes the intent so it can be retried with a new key.
    try {
      const session = await this.gateway.createCheckout({
        intentId: intent.row.id,
        amount: intent.row.amount,
        currency: "PHP",
        description: `Invoice ${intent.invoiceNumber ?? ""}`.trim(),
        returnUrl: input.returnUrl,
      });
      const [updated] = await this.db
        .update(billingPaymentIntent)
        .set({ providerReference: session.providerReference, checkoutUrl: session.checkoutUrl, updatedAt: new Date() })
        .where(eq(billingPaymentIntent.id, intent.row.id))
        .returning();
      return view(found(updated, "Payment"));
    } catch (error) {
      this.logger.warn(`Checkout for payment intent ${intent.row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.db
        .update(billingPaymentIntent)
        .set({ status: "failed", failureCode: "checkout_failed", completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(billingPaymentIntent.id, intent.row.id), eq(billingPaymentIntent.status, "pending")));
      throw new BusinessRuleError("The payment provider could not start the payment; please try again or pay at the clinic", "checkout_failed");
    }
  }

  /**
   * A notification from the provider. Only authentic ones (the adapter verifies them) change anything, and each
   * intent completes once — a repeated notification is acknowledged without effect.
   */
  async notify(headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined): Promise<{ received: true }> {
    if (!rawBody) throw new BadRequestError("A notification body is required", "notification_not_verified");
    const event = await this.gateway.verifyNotification(headers, rawBody);
    if (!event) throw new BadRequestError("The notification could not be verified", "notification_not_verified");
    const [intent] = await this.db
      .select()
      .from(billingPaymentIntent)
      .where(and(eq(billingPaymentIntent.provider, this.gateway.specification.provider), eq(billingPaymentIntent.providerReference, event.providerReference)));
    if (!intent) throw new NotFoundError("Payment");
    const actor = systemActor(intent.organizationId, intent.facilityId, SYSTEM);
    await this.db.transaction(async (tx) => {
      const invoice = await this.invoices.lock(tx, actor, intent.invoiceId);
      const [current] = await tx.select().from(billingPaymentIntent).where(eq(billingPaymentIntent.id, intent.id)).for("update");
      if (!current || current.status !== "pending") return;
      const now = new Date();
      if (event.outcome !== "succeeded") {
        await tx
          .update(billingPaymentIntent)
          .set({ status: event.outcome, failureCode: event.failureCode ?? null, completedAt: now, updatedAt: now })
          .where(eq(billingPaymentIntent.id, intent.id));
        await this.audit.record(tx, actor, {
          action: "billing.online-payment.complete",
          resourceType: "billing_payment_intent",
          resourceId: intent.id,
          patientId: intent.patientId,
          metadata: { outcome: event.outcome, failureCode: event.failureCode ?? null },
        });
        return;
      }
      const collected = event.amount ?? intent.amount;
      const method = event.method ?? "other";
      const balance = invoice.status === "issued" ? invoiceBalance(invoice.patientTotal, await this.invoices.settlement(tx, intent.invoiceId)) : 0;
      const split = onlinePaymentSplit(collected, balance);
      const facility = await this.organizations.getFacility(intent.organizationId, intent.facilityId);
      const year = Number(localDate(now, facility.timezone).slice(0, 4));
      let paymentId: string | null = null;
      if (split.payment > 0) {
        const series = await this.catalog.nextNumber(tx, intent.organizationId, "receipt");
        const [payment] = await tx
          .insert(billingPayment)
          .values({
            organizationId: intent.organizationId,
            facilityId: intent.facilityId,
            invoiceId: intent.invoiceId,
            patientId: intent.patientId,
            kind: "payment",
            amount: split.payment,
            method,
            reference: event.externalReference ?? event.providerReference,
            receiptNumber: documentNumber(series.prefix, year, series.value),
            idempotencyKey: `online:${intent.id}`,
            recordedBy: null,
            paymentIntentId: intent.id,
          })
          .returning();
        const row = found(payment, "Payment");
        paymentId = row.id;
        await this.events.record(tx, {
          type: "PaymentCompleted",
          organizationId: row.organizationId,
          aggregateType: "billing_payment",
          aggregateId: row.id,
          facilityId: row.facilityId,
          patientId: row.patientId,
          payload: { invoiceId: row.invoiceId, amount: row.amount, method: row.method, balance: balance - row.amount, online: true },
        });
      }
      if (split.deposit > 0) {
        await lockPatientAccount(tx, intent.organizationId, intent.facilityId, intent.patientId);
        const series = await this.catalog.nextNumber(tx, intent.organizationId, "receipt");
        await tx.insert(billingAccountEntry).values({
          organizationId: intent.organizationId,
          facilityId: intent.facilityId,
          patientId: intent.patientId,
          kind: "deposit",
          amount: split.deposit,
          method,
          reference: event.externalReference ?? event.providerReference,
          receiptNumber: documentNumber(series.prefix, year, series.value),
          idempotencyKey: `online-excess:${intent.id}`,
          recordedBy: null,
          paymentIntentId: intent.id,
        });
      }
      await tx
        .update(billingPaymentIntent)
        .set({ status: "succeeded", paidAmount: collected, completedAt: now, updatedAt: now })
        .where(eq(billingPaymentIntent.id, intent.id));
      await this.audit.record(tx, actor, {
        action: "billing.online-payment.complete",
        resourceType: "billing_payment_intent",
        resourceId: intent.id,
        patientId: intent.patientId,
        metadata: { outcome: "succeeded", collected, paymentId, toDeposit: split.deposit, provider: intent.provider },
      });
    });
    return { received: true };
  }

  /** One of the patient's own payment intents (the return page in MyHealth). */
  async patientIntent(organizationId: string, patientId: string, intentId: string) {
    const [row] = await this.db
      .select()
      .from(billingPaymentIntent)
      .where(and(eq(billingPaymentIntent.organizationId, organizationId), eq(billingPaymentIntent.id, intentId)));
    if (!row || row.patientId !== patientId) throw new NotFoundError("Payment");
    return view(row);
  }

  /** Online payments of an invoice (staff invoice workspace; no audit — callers audit). */
  async forInvoice(organizationId: string, invoiceId: string) {
    const rows = await this.db
      .select()
      .from(billingPaymentIntent)
      .where(and(eq(billingPaymentIntent.organizationId, organizationId), eq(billingPaymentIntent.invoiceId, invoiceId)))
      .orderBy(desc(billingPaymentIntent.createdAt));
    return rows.map(view);
  }

  private checkReturnUrl(url: string) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new BadRequestError("The return address is not a URL", "return_url_invalid");
    }
    if (!this.config.CORS_ORIGINS.includes(origin)) throw new BadRequestError("The return address is not one of the platform's apps", "return_url_invalid");
  }
}

function view(row: BillingPaymentIntentRecord) {
  const { idempotencyKey: _key, ...rest } = row;
  return publicView(rest);
}
