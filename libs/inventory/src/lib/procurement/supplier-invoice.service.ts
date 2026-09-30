import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  PgErrorCode,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { invoiceableQuantity, invoiceOverdue, priceVariance, type SupplierInvoiceAction, supplierInvoiceAllows } from "../inventory.rules";
import {
  inventoryItem,
  inventoryPurchaseOrder,
  inventoryPurchaseOrderLine,
  inventorySupplier,
  inventorySupplierInvoice,
  inventorySupplierInvoiceLine,
  inventoryWithholdingCode,
  type SupplierInvoiceRecord,
} from "../inventory.schema";
import { assertVersion, found } from "../inventory-support";
import type {
  approveSupplierInvoiceSchema,
  paySupplierInvoiceSchema,
  recordSupplierInvoiceSchema,
  supplierInvoiceQuerySchema,
  voidSupplierInvoiceSchema,
} from "./procurement.dto";

/**
 * Supplier invoices (docs/domains/inventory.md, "Supplier invoices"): recorded against a purchase order of the selected
 * facility line by line and matched three ways — ordered, received, invoiced. An order line is never invoiced beyond
 * what was received (net of other valid invoices); a price different from the order is shown and needs a note to
 * approve. Approval is by someone other than the recorder; an approved invoice is marked paid with the payment's
 * reference; an unpaid one can be voided with a reason. Content never changes (database guard). Accounts payable,
 * withholding tax and BIR rules are not encoded.
 */
@Injectable()
export class SupplierInvoiceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** An order's lines with what was ordered, received and already invoiced — what the next invoice may cover. */
  async invoicing(actor: Actor, purchaseOrderId: string) {
    const order = await this.order(this.db, actor, purchaseOrderId);
    const lines = await this.orderLines(this.db, order.id);
    return {
      purchaseOrderId: order.id,
      poNumber: order.poNumber,
      supplierId: order.supplierId,
      lines: lines.map((l) => ({ ...l, invoiceable: invoiceableQuantity(l) })),
    };
  }

  async record(actor: Actor, purchaseOrderId: string, input: z.infer<typeof recordSupplierInvoiceSchema>) {
    if (input.dueDate && input.dueDate < input.invoiceDate) throw new BusinessRuleError("The due date is before the invoice date", "invalid_due_date");
    try {
      const id = await this.db.transaction(async (tx) => {
        // Serializes invoicing of one order, so two invoices cannot both take the same received quantity.
        const order = await this.order(tx, actor, purchaseOrderId, true);
        const lines = await this.orderLines(tx, order.id);
        const beyond: Array<{ purchaseOrderLineId: string; invoiceable: number; requested: number }> = [];
        for (const requested of input.lines) {
          const line = lines.find((l) => l.purchaseOrderLineId === requested.purchaseOrderLineId);
          if (!line) throw new BusinessRuleError("A line is not on this purchase order", "line_not_on_order");
          const invoiceable = invoiceableQuantity(line);
          if (requested.quantity > invoiceable) beyond.push({ purchaseOrderLineId: line.purchaseOrderLineId, invoiceable, requested: requested.quantity });
        }
        if (beyond.length) {
          throw new BusinessRuleError("An invoice covers only goods received and not yet invoiced", "invoiced_beyond_received", beyond);
        }
        const linesTotal = input.lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
        const [row] = await tx
          .insert(inventorySupplierInvoice)
          .values({
            organizationId: actor.organizationId,
            facilityId: order.facilityId,
            purchaseOrderId: order.id,
            supplierId: order.supplierId,
            invoiceNumber: input.invoiceNumber,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate ?? null,
            linesTotal,
            vatAmount: input.vatAmount,
            total: linesTotal + input.vatAmount,
            notes: input.notes || null,
            recordedBy: actor.userId,
          })
          .returning();
        const invoice = found(row, "Supplier invoice");
        await tx.insert(inventorySupplierInvoiceLine).values(
          input.lines.map((l) => ({
            organizationId: actor.organizationId,
            invoiceId: invoice.id,
            purchaseOrderId: order.id,
            purchaseOrderLineId: l.purchaseOrderLineId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.quantity * l.unitPrice,
          })),
        );
        const variances = input.lines.filter((l) => {
          const v = priceVariance(lines.find((x) => x.purchaseOrderLineId === l.purchaseOrderLineId)?.orderUnitCost ?? null, l.unitPrice);
          return v !== null && v !== 0;
        }).length;
        await this.audit.record(tx, actor, {
          action: "inventory.supplier-invoice.record",
          resourceType: "inventory_supplier_invoice",
          resourceId: invoice.id,
          metadata: {
            purchaseOrderId: order.id,
            poNumber: order.poNumber,
            invoiceNumber: invoice.invoiceNumber,
            total: invoice.total,
            lines: input.lines.length,
            variances,
          },
        });
        await this.events.record(tx, this.event("InventorySupplierInvoiceRecorded", invoice, { variances }));
        return invoice.id;
      });
      return this.get(actor, id);
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError("This supplier invoice number is already recorded", undefined, "duplicate_invoice_number");
      }
      throw error;
    }
  }

  /** Approval by someone other than the recorder; a price different from the order needs a note. */
  async approve(actor: Actor, invoiceId: string, input: z.infer<typeof approveSupplierInvoiceSchema>) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lockFor(tx, actor, invoiceId, "approve", input.version);
      if (invoice.recordedBy === actor.userId) throw new BusinessRuleError("Someone other than the person who recorded an invoice approves it", "same_person");
      const detail = await this.lines(tx, [invoice.id]);
      if (detail.some((l) => l.variance !== null && l.variance !== 0) && !input.note) {
        throw new BusinessRuleError("Say why a price different from the order is accepted", "approval_note_required");
      }
      const updated = await this.update(tx, invoice, {
        status: "approved",
        approvedBy: actor.userId,
        approvedAt: new Date(),
        approvalNote: input.note ?? null,
      });
      await this.audit.record(tx, actor, {
        action: "inventory.supplier-invoice.approve",
        resourceType: "inventory_supplier_invoice",
        resourceId: invoice.id,
        reason: input.note,
        metadata: { invoiceNumber: invoice.invoiceNumber, total: invoice.total },
      });
      await this.events.record(tx, this.event("InventorySupplierInvoiceApproved", updated));
    });
    return this.get(actor, invoiceId);
  }

  async pay(actor: Actor, invoiceId: string, input: z.infer<typeof paySupplierInvoiceSchema>) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lockFor(tx, actor, invoiceId, "pay", input.version);
      if (input.paidOn < invoice.invoiceDate) throw new BusinessRuleError("The payment date is before the invoice date", "paid_before_invoice");
      if (input.paidOn > (await this.today(actor))) throw new BusinessRuleError("The payment date is in the future", "paid_in_future");
      const withholding = input.withholding;
      if (withholding) {
        // The organization's own code; the amount is what its accountant determined (entered, never computed here).
        const [code] = await tx
          .select()
          .from(inventoryWithholdingCode)
          .where(and(eq(inventoryWithholdingCode.organizationId, actor.organizationId), eq(inventoryWithholdingCode.id, withholding.codeId)));
        if (!code || code.status !== "active") throw new BusinessRuleError("Choose an active withholding code", "withholding_code_inactive");
        if (withholding.amount > invoice.total) throw new BusinessRuleError("More is withheld than the invoice total", "withheld_above_total");
      }
      const updated = await this.update(tx, invoice, {
        status: "paid",
        paidOn: input.paidOn,
        paymentReference: input.paymentReference,
        paidRecordedBy: actor.userId,
        paidRecordedAt: new Date(),
        withholdingCodeId: withholding?.codeId ?? null,
        withheldAmount: withholding?.amount ?? 0,
        withholdingReference: withholding?.reference ?? null,
      });
      await this.audit.record(tx, actor, {
        action: "inventory.supplier-invoice.pay",
        resourceType: "inventory_supplier_invoice",
        resourceId: invoice.id,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          paidOn: input.paidOn,
          paymentReference: input.paymentReference,
          withholdingCodeId: withholding?.codeId ?? null,
          withheldAmount: withholding?.amount ?? 0,
        },
      });
      await this.events.record(tx, this.event("InventorySupplierInvoicePaid", updated));
    });
    return this.get(actor, invoiceId);
  }

  async void(actor: Actor, invoiceId: string, input: z.infer<typeof voidSupplierInvoiceSchema>) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lockFor(tx, actor, invoiceId, "void", input.version);
      const updated = await this.update(tx, invoice, { status: "void", voidedBy: actor.userId, voidedAt: new Date(), voidReason: input.reason });
      await this.audit.record(tx, actor, {
        action: "inventory.supplier-invoice.void",
        resourceType: "inventory_supplier_invoice",
        resourceId: invoice.id,
        reason: input.reason,
        metadata: { invoiceNumber: invoice.invoiceNumber, total: invoice.total },
      });
      await this.events.record(tx, this.event("InventorySupplierInvoiceVoided", updated));
    });
    return this.get(actor, invoiceId);
  }

  async list(actor: Actor, query: z.infer<typeof supplierInvoiceQuerySchema>) {
    const today = await this.today(actor);
    const status = query.status;
    const rows = await this.db
      .select()
      .from(inventorySupplierInvoice)
      .where(
        and(
          eq(inventorySupplierInvoice.organizationId, actor.organizationId),
          eq(inventorySupplierInvoice.facilityId, requireFacilityId(actor)),
          query.purchaseOrderId ? eq(inventorySupplierInvoice.purchaseOrderId, query.purchaseOrderId) : undefined,
          status === "open" || status === "overdue"
            ? inArray(inventorySupplierInvoice.status, ["recorded", "approved"])
            : status
              ? eq(inventorySupplierInvoice.status, status)
              : undefined,
          status === "overdue" ? sql`${inventorySupplierInvoice.dueDate} < ${today}::date` : undefined,
        ),
      )
      .orderBy(desc(inventorySupplierInvoice.recordedAt))
      .limit(200);
    return this.views(actor, rows, today);
  }

  async get(actor: Actor, invoiceId: string) {
    const invoice = await this.find(this.db, actor, invoiceId);
    const [view] = await this.views(actor, [invoice], await this.today(actor));
    const lines = await this.lines(this.db, [invoice.id]);
    return { ...view!, lines };
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private async order(executor: DbExecutor, actor: Actor, purchaseOrderId: string, lock = false) {
    const query = executor
      .select()
      .from(inventoryPurchaseOrder)
      .where(
        and(
          eq(inventoryPurchaseOrder.organizationId, actor.organizationId),
          eq(inventoryPurchaseOrder.facilityId, requireFacilityId(actor)),
          eq(inventoryPurchaseOrder.id, purchaseOrderId),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    return found(row, "Purchase order");
  }

  /** Each line of an order with what was ordered, received and invoiced on valid (not voided) invoices. */
  private async orderLines(executor: DbExecutor, purchaseOrderId: string) {
    const rows = await executor
      .select({
        purchaseOrderLineId: inventoryPurchaseOrderLine.id,
        lineNumber: inventoryPurchaseOrderLine.lineNumber,
        itemId: inventoryPurchaseOrderLine.itemId,
        itemName: inventoryItem.name,
        stockUnit: inventoryItem.stockUnit,
        quantityOrdered: inventoryPurchaseOrderLine.quantityOrdered,
        quantityReceived: inventoryPurchaseOrderLine.quantityReceived,
        orderUnitCost: inventoryPurchaseOrderLine.unitCost,
        quantityInvoiced: sql<number>`coalesce((select sum(il.quantity) from ${inventorySupplierInvoiceLine} il
          join ${inventorySupplierInvoice} i on i.id = il.invoice_id
          where il.purchase_order_line_id = ${inventoryPurchaseOrderLine.id} and i.status <> 'void'), 0)::int`,
      })
      .from(inventoryPurchaseOrderLine)
      .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryPurchaseOrderLine.itemId))
      .where(eq(inventoryPurchaseOrderLine.purchaseOrderId, purchaseOrderId))
      .orderBy(asc(inventoryPurchaseOrderLine.lineNumber));
    return rows;
  }

  private async lines(executor: DbExecutor, invoiceIds: string[]) {
    const rows = await executor
      .select({ line: inventorySupplierInvoiceLine, orderLine: inventoryPurchaseOrderLine, item: inventoryItem })
      .from(inventorySupplierInvoiceLine)
      .innerJoin(inventoryPurchaseOrderLine, eq(inventoryPurchaseOrderLine.id, inventorySupplierInvoiceLine.purchaseOrderLineId))
      .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryPurchaseOrderLine.itemId))
      .where(inArray(inventorySupplierInvoiceLine.invoiceId, invoiceIds))
      .orderBy(asc(inventoryPurchaseOrderLine.lineNumber));
    return rows.map(({ line, orderLine, item }) => ({
      id: line.id,
      invoiceId: line.invoiceId,
      purchaseOrderLineId: line.purchaseOrderLineId,
      lineNumber: orderLine.lineNumber,
      itemId: item.id,
      itemName: item.name,
      stockUnit: item.stockUnit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      quantityOrdered: orderLine.quantityOrdered,
      quantityReceived: orderLine.quantityReceived,
      orderUnitCost: orderLine.unitCost,
      /** Invoiced price less the order's price per stock unit (centavos); null when the order had no price. */
      variance: priceVariance(orderLine.unitCost, line.unitPrice),
    }));
  }

  private async views(actor: Actor, invoices: SupplierInvoiceRecord[], today: string) {
    if (invoices.length === 0) return [];
    const codeIds = [...new Set(invoices.map((i) => i.withholdingCodeId).filter((id): id is string => Boolean(id)))];
    const [suppliers, orders, codes] = await Promise.all([
      this.db
        .select({ id: inventorySupplier.id, code: inventorySupplier.code, name: inventorySupplier.name })
        .from(inventorySupplier)
        .where(and(eq(inventorySupplier.organizationId, actor.organizationId), inArray(inventorySupplier.id, [...new Set(invoices.map((i) => i.supplierId))]))),
      this.db
        .select({ id: inventoryPurchaseOrder.id, poNumber: inventoryPurchaseOrder.poNumber })
        .from(inventoryPurchaseOrder)
        .where(inArray(inventoryPurchaseOrder.id, [...new Set(invoices.map((i) => i.purchaseOrderId))])),
      codeIds.length
        ? this.db
            .select({ id: inventoryWithholdingCode.id, code: inventoryWithholdingCode.code, description: inventoryWithholdingCode.description })
            .from(inventoryWithholdingCode)
            .where(and(eq(inventoryWithholdingCode.organizationId, actor.organizationId), inArray(inventoryWithholdingCode.id, codeIds)))
        : Promise.resolve([]),
    ]);
    return invoices.map((i) => {
      const { organizationId: _o, ...rest } = i;
      return {
        ...rest,
        recordedAt: i.recordedAt.toISOString(),
        approvedAt: i.approvedAt?.toISOString() ?? null,
        paidRecordedAt: i.paidRecordedAt?.toISOString() ?? null,
        voidedAt: i.voidedAt?.toISOString() ?? null,
        supplier: suppliers.find((s) => s.id === i.supplierId) ?? null,
        poNumber: orders.find((o) => o.id === i.purchaseOrderId)?.poNumber ?? null,
        overdue: invoiceOverdue(i, today),
        withholdingCode: codes.find((c) => c.id === i.withholdingCodeId) ?? null,
        /** Centavos paid to the supplier: the total less what was withheld (once paid). */
        netPaid: i.status === "paid" ? i.total - i.withheldAmount : null,
        recordedByYou: i.recordedBy === actor.userId,
      };
    });
  }

  private async find(executor: DbExecutor, actor: Actor, invoiceId: string, lock = false): Promise<SupplierInvoiceRecord> {
    const query = executor
      .select()
      .from(inventorySupplierInvoice)
      .where(
        and(
          eq(inventorySupplierInvoice.organizationId, actor.organizationId),
          eq(inventorySupplierInvoice.facilityId, requireFacilityId(actor)),
          eq(inventorySupplierInvoice.id, invoiceId),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    return found(row, "Supplier invoice");
  }

  private async lockFor(tx: DbExecutor, actor: Actor, invoiceId: string, action: SupplierInvoiceAction, version: number) {
    const invoice = await this.find(tx, actor, invoiceId, true);
    assertVersion(invoice.version, version, "Supplier invoice");
    if (!supplierInvoiceAllows(invoice.status, action)) {
      throw new BusinessRuleError(
        `A ${invoice.status} invoice cannot be ${action === "pay" ? "paid" : action === "void" ? "voided" : "approved"}`,
        "invalid_invoice_status",
      );
    }
    return invoice;
  }

  private async update(tx: DbExecutor, invoice: SupplierInvoiceRecord, set: Partial<typeof inventorySupplierInvoice.$inferInsert>) {
    const [row] = await tx
      .update(inventorySupplierInvoice)
      .set({ ...set, version: invoice.version + 1 })
      .where(
        and(eq(inventorySupplierInvoice.id, invoice.id), eq(inventorySupplierInvoice.version, invoice.version), ne(inventorySupplierInvoice.status, "void")),
      )
      .returning();
    return found(row, "Supplier invoice");
  }

  private async today(actor: Actor) {
    const facility = await this.organizations.getFacility(actor.organizationId, requireFacilityId(actor));
    return localDate(new Date(), facility.timezone);
  }

  private event(type: string, invoice: SupplierInvoiceRecord, extra: Record<string, unknown> = {}) {
    return {
      type,
      organizationId: invoice.organizationId,
      aggregateType: "inventory_supplier_invoice",
      aggregateId: invoice.id,
      facilityId: invoice.facilityId,
      payload: { purchaseOrderId: invoice.purchaseOrderId, supplierId: invoice.supplierId, total: invoice.total, ...extra },
    };
  }
}
