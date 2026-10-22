import { Inject, Injectable, Logger } from "@nestjs/common";
import { BusinessRuleError, DATABASE, type Database, systemActor } from "@healthcare/core";
import { and, eq } from "drizzle-orm";
import { billingCharge, billingInvoice } from "../billing.schema";
import { ChargeService } from "../charges/charge.service";
import { InvoiceService } from "../invoices/invoice.service";
import { invoiceBalance } from "../billing.rules";

const SYSTEM = "prepayment";

/** Where a prepaid online visit stands. `not_required`: nothing is charged for it (no service mapped to the visit type, or no price). */
export type PrepaymentState = "not_required" | "unpaid" | "paid";

export interface PrepaymentStatus {
  state: PrepaymentState;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** What the patient has to pay on the invoice (centavos). */
  amount: number;
  /** What is still owed (centavos); 0 once paid. */
  balance: number;
}

export interface PrepaymentRequest {
  organizationId: string;
  facilityId: string;
  patientId: string;
  appointmentId: string;
  visitTypeCode: string;
  /** Local date (facility time) of the visit, which decides the price in force. */
  serviceDate: string;
}

const NOT_REQUIRED: PrepaymentStatus = { state: "not_required", invoiceId: null, invoiceNumber: null, amount: 0, balance: 0 };

/**
 * Prepaid online consultations (migration 0126; libs/billing/CLAUDE.md: payment before telemedicine is a facility policy,
 * configuration). When asked, the visit is charged from its appointment and invoiced and issued at once, with no staff
 * member involved; the patient pays it online (the payment provider port, when configured) or at the cashier like any
 * invoice, and the consultation's waiting room opens when the balance is zero. Idempotent per appointment. The signed
 * consultation does not charge the visit type again (ChargeService.captureEncounter). Refunding a visit that did not take
 * place is the cashier's, with the ordinary refund or void.
 */
@Injectable()
export class PrepaymentService {
  private readonly logger = new Logger(PrepaymentService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly charges: ChargeService,
    private readonly invoices: InvoiceService,
  ) {}

  /** Charges and invoices the visit if that has not happened yet, and says where payment stands. */
  async ensure(request: PrepaymentRequest): Promise<PrepaymentStatus> {
    const existing = await this.status(request.organizationId, request.appointmentId);
    // Invoiced already (paid or not): that is the answer. A charge without an invoice (an earlier attempt stopped half way, or the
    // invoice was voided) is invoiced now.
    if (existing.invoiceId) return existing;

    const chargeId = await this.charges.captureAppointment(request);
    if (!chargeId) return NOT_REQUIRED;
    const actor = systemActor(request.organizationId, request.facilityId, SYSTEM);
    try {
      const draft = await this.invoices.createDraft(actor, { patientId: request.patientId, chargeIds: [chargeId] });
      await this.invoices.issue(actor, draft.id, draft.version);
    } catch (error) {
      // A concurrent request invoiced the same charge first: its invoice is the answer.
      if (!(error instanceof BusinessRuleError) || !["no_pending_charges", "charges_not_pending", "invoice_not_draft"].includes(error.code)) throw error;
      this.logger.debug(`Prepayment for appointment ${request.appointmentId} was invoiced concurrently`);
    }
    return this.status(request.organizationId, request.appointmentId);
  }

  /** Where payment for the appointment's online visit stands. */
  async status(organizationId: string, appointmentId: string): Promise<PrepaymentStatus> {
    const [charge] = await this.db
      .select({
        id: billingCharge.id,
        status: billingCharge.status,
        invoiceId: billingCharge.invoiceId,
        unitPrice: billingCharge.unitPrice,
        quantity: billingCharge.quantity,
      })
      .from(billingCharge)
      .where(and(eq(billingCharge.organizationId, organizationId), eq(billingCharge.sourceType, "appointment"), eq(billingCharge.sourceId, appointmentId)));
    if (!charge || charge.status === "cancelled") return NOT_REQUIRED;
    // Charged but not invoiced yet (or its invoice was voided): unpaid, for the full price.
    if (!charge.invoiceId)
      return { state: "unpaid", invoiceId: null, invoiceNumber: null, amount: charge.unitPrice * charge.quantity, balance: charge.unitPrice * charge.quantity };
    const [invoice] = await this.db.select().from(billingInvoice).where(eq(billingInvoice.id, charge.invoiceId));
    if (!invoice || invoice.status === "void")
      return { state: "unpaid", invoiceId: null, invoiceNumber: null, amount: charge.unitPrice * charge.quantity, balance: charge.unitPrice * charge.quantity };
    if (invoice.status === "draft") {
      return { state: "unpaid", invoiceId: invoice.id, invoiceNumber: null, amount: invoice.patientTotal, balance: invoice.patientTotal };
    }
    const balance = invoiceBalance(invoice.patientTotal, await this.invoices.settlement(this.db, invoice.id));
    return {
      state: balance <= 0 ? "paid" : "unpaid",
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.patientTotal,
      balance: Math.max(balance, 0),
    };
  }
}
