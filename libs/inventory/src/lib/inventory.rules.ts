/**
 * Inventory rules: pure, no I/O. Quantities are whole stock units.
 */

export interface LotStock {
  lotId: string;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
}

export interface Allocation {
  lotId: string;
  quantity: number;
}

/** Whether a lot has expired on a given local date (the expiry date itself is the last usable day). */
export function isExpired(expiryDate: string | null, today: string): boolean {
  return expiryDate !== null && expiryDate < today;
}

/**
 * First-expiry-first-out: take the requested quantity from the usable lots with the earliest expiry first (lots
 * without an expiry last). Expired lots are never picked. Returns the allocation, or the shortfall when the usable
 * stock is not enough.
 */
export function allocateFefo(lots: LotStock[], quantity: number, today: string): { ok: true; allocations: Allocation[] } | { ok: false; available: number } {
  const usable = lots
    .filter((l) => l.quantity > 0 && !isExpired(l.expiryDate, today))
    .sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") || (a.lotNumber ?? "").localeCompare(b.lotNumber ?? ""));
  const available = usable.reduce((sum, l) => sum + l.quantity, 0);
  if (available < quantity) return { ok: false, available };
  const allocations: Allocation[] = [];
  let remaining = quantity;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.quantity, remaining);
    allocations.push({ lotId: lot.lotId, quantity: take });
    remaining -= take;
  }
  return { ok: true, allocations };
}

export type ExpiryStatus = "expired" | "expiring" | "ok" | "no_expiry";

/** Expired, expiring within `warnDays`, or fine. */
export function expiryStatus(expiryDate: string | null, today: string, warnDays: number): ExpiryStatus {
  if (!expiryDate) return "no_expiry";
  if (expiryDate < today) return "expired";
  const limit = addDays(today, warnDays);
  return expiryDate <= limit ? "expiring" : "ok";
}

export type StockStatus = "out" | "low" | "ok";

/** Out of stock, at or below the reorder level, or fine (no level set: only "out" is flagged). */
export function stockStatus(onHand: number, reorderLevel: number | null): StockStatus {
  if (onHand === 0) return "out";
  if (reorderLevel !== null && onHand <= reorderLevel) return "low";
  return "ok";
}

/** True when a movement takes the location's stock from above the reorder level to at or below it. */
export function crossedReorderLevel(before: number, after: number, reorderLevel: number | null): boolean {
  return reorderLevel !== null && before > reorderLevel && after <= reorderLevel;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---- purchase orders -------------------------------------------------------------------------------

export type PurchaseOrderAction = "edit" | "submit" | "approve" | "receive" | "cancel" | "close";

const ALLOWED: Record<PurchaseOrderAction, readonly string[]> = {
  edit: ["draft"],
  submit: ["draft"],
  approve: ["submitted"],
  receive: ["approved", "partially_received"],
  // Nothing has arrived yet: the order is withdrawn.
  cancel: ["draft", "submitted", "approved"],
  // Some or none has arrived and no more is expected: the order is closed short.
  close: ["approved", "partially_received"],
};

/** Whether an action applies to a purchase order in this status. */
export function purchaseOrderAllows(status: string, action: PurchaseOrderAction): boolean {
  return ALLOWED[action].includes(status);
}

/** PO-YYYY-NNNNNN. */
export function purchaseOrderNumber(year: number, value: number): string {
  return `PO-${year}-${String(value).padStart(6, "0")}`;
}

/** After a delivery: everything ordered has arrived, or part of it. */
export function statusAfterReceipt(lines: Array<{ quantityOrdered: number; quantityReceived: number }>): "received" | "partially_received" {
  return lines.every((l) => l.quantityReceived >= l.quantityOrdered) ? "received" : "partially_received";
}

/**
 * Reorder suggestion for an item at a location: needed when usable stock plus what is already on order is at or below
 * the reorder level. The suggested quantity is the configured reorder quantity (none configured: left to the buyer).
 */
export function reorderSuggestion(
  usable: number,
  onOrder: number,
  reorderLevel: number,
  reorderQuantity: number | null,
): { needed: boolean; suggestedQuantity: number | null } {
  const needed = usable + onOrder <= reorderLevel;
  return { needed, suggestedQuantity: needed ? reorderQuantity : null };
}

// ---- Supplier invoices ----------------------------------------------------------------------------------------------

export type SupplierInvoiceAction = "approve" | "pay" | "void";

/** recorded → approved → paid; recorded or approved → void. Paid and voided invoices do not change. */
export function supplierInvoiceAllows(status: "recorded" | "approved" | "paid" | "void", action: SupplierInvoiceAction): boolean {
  if (action === "approve") return status === "recorded";
  if (action === "pay") return status === "approved";
  return status === "recorded" || status === "approved";
}

/** What an order line may still be invoiced for: received and not already on a valid invoice. */
export function invoiceableQuantity(line: { quantityReceived: number; quantityInvoiced: number }): number {
  return Math.max(0, line.quantityReceived - line.quantityInvoiced);
}

/** Invoiced price less the order's price, per stock unit (centavos); null when the order had no price. */
export function priceVariance(orderUnitCost: number | null, invoicedUnitPrice: number): number | null {
  return orderUnitCost === null ? null : invoicedUnitPrice - orderUnitCost;
}

/** An open invoice is overdue after its due date (local day of the facility). */
export function invoiceOverdue(invoice: { status: string; dueDate: string | null }, today: string): boolean {
  return (invoice.status === "recorded" || invoice.status === "approved") && invoice.dueDate !== null && invoice.dueDate < today;
}

// ---- Compliance configuration (0071) ----------------------------------------------------------------------------------

/**
 * Whether an order may be submitted under the organization's own procurement methods: once it has defined any, an
 * order names one, and a method with a reference label needs that reference. Null when the order may be submitted.
 * The methods and what they require are the organization's configuration, not a procurement rule of the platform.
 */
export function procurementProblem(
  hasActiveMethods: boolean,
  method: { status: string; referenceLabel: string | null } | null,
  reference: string | null,
): { code: "procurement_method_required" | "procurement_method_inactive" | "procurement_reference_required"; message: string } | null {
  if (!method) {
    return hasActiveMethods ? { code: "procurement_method_required", message: "Choose the procurement method this order is made under" } : null;
  }
  if (method.status !== "active") return { code: "procurement_method_inactive", message: "That procurement method is no longer in use" };
  if (method.referenceLabel && !reference?.trim()) {
    return { code: "procurement_reference_required", message: `Enter the ${method.referenceLabel.toLowerCase()} for this procurement method` };
  }
  return null;
}

/** A register line: a movement of a controlled item with the running balance of that item at that location. */
export interface RegisterLine<M> {
  movement: M;
  /** Quantity in (positive) or out (negative), in the stock unit. */
  quantity: number;
  balance: number;
}

/**
 * Running balances for a register: movements (oldest first) of one item at one location, starting from the balance
 * the item had there before the period (`opening`).
 */
export function registerBalances<M extends { quantity: number }>(opening: number, movements: M[]): { lines: Array<RegisterLine<M>>; closing: number } {
  let balance = opening;
  const lines = movements.map((movement) => {
    balance += movement.quantity;
    return { movement, quantity: movement.quantity, balance };
  });
  return { lines, closing: balance };
}
