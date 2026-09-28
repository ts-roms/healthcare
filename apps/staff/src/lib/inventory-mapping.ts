import type { PurchaseOrder, PurchaseOrderStatus, ReorderSuggestion } from "./api/types";

/**
 * Display helpers for purchase orders and dispensing. The API enforces every rule (statuses, separation of duties,
 * quantities); these only decide what to offer.
 */

export const PURCHASE_ORDER_STATUS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved",
  partially_received: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
  closed: "Closed short",
};

export type PurchaseOrderAction = "submit" | "approve" | "receive" | "cancel" | "close";

/** The actions a user can take on an order, from its status and their permissions. */
export function purchaseOrderActions(order: Pick<PurchaseOrder, "status" | "submittedByYou">, permissions: readonly string[]): PurchaseOrderAction[] {
  const has = (p: string) => permissions.includes(p);
  const manage = has("inventory.procurement.manage");
  const actions: PurchaseOrderAction[] = [];
  if (manage && order.status === "draft") actions.push("submit");
  // Someone other than the submitter approves (the API refuses the submitter too).
  if (has("inventory.procurement.approve") && order.status === "submitted" && !order.submittedByYou) actions.push("approve");
  if (manage && has("inventory.move") && (order.status === "approved" || order.status === "partially_received")) actions.push("receive");
  if (manage && ["draft", "submitted", "approved"].includes(order.status)) actions.push("cancel");
  if (manage && (order.status === "approved" || order.status === "partially_received")) actions.push("close");
  return actions;
}

/**
 * Order lines drafted from reorder suggestions for one delivery location: the suggested quantity (the configured
 * reorder quantity), or enough to reach twice the reorder level when none is configured, and the last unit cost.
 */
export function linesFromSuggestions(
  suggestions: ReorderSuggestion[],
  locationId: string,
): Array<{ itemId: string; itemName: string; stockUnit: string; quantity: number; unitCost: number | null }> {
  return suggestions
    .filter((s) => s.location.id === locationId)
    .map((s) => ({
      itemId: s.item.id,
      itemName: s.item.name,
      stockUnit: s.item.stockUnit,
      quantity: s.suggestedQuantity ?? Math.max(1, s.reorderLevel * 2 - s.usable - s.onOrder),
      unitCost: s.lastSupplier?.unitCost ?? null,
    }));
}

/** "30 capsules" / "2 bottle" — quantity with its unit, for dispensing summaries. */
export function quantityWithUnit(quantity: number, unit: string): string {
  return `${Number.isInteger(quantity) ? quantity : quantity.toFixed(2)} ${unit}`;
}
