/**
 * Supplies a clinical record used (a dental or clinic procedure), taken from inventory: pure rules shared by the
 * domains that record them, no I/O. Stock rules themselves (first expiry first out, expired lots, balances, controlled
 * items) belong to inventory and are enforced by its command; these rules only shape what a domain asks for and how
 * much of an issue can still be returned.
 */

export interface SupplyLineRequest {
  itemId: string;
  quantity: number;
}

export interface KnownSupplyItem {
  id: string;
  name: string;
  status: "active" | "inactive";
  /** The inventory category; checked against the domain's categories when given. */
  category?: string;
}

/**
 * Problems with a template or a supply request, keyed by item id ("_" for the whole list). `categories` are the
 * inventory categories the domain may take; `categoryLabel` names them in the message ("a dental supply").
 */
export function supplyLineIssues(
  lines: SupplyLineRequest[],
  items: Map<string, KnownSupplyItem>,
  options: { allowEmpty: boolean; categories: readonly string[]; categoryLabel: string },
): Record<string, string[]> {
  const issues: Record<string, string[]> = {};
  const add = (key: string, message: string) => (issues[key] ??= []).push(message);
  if (!options.allowEmpty && lines.length === 0) add("_", "list at least one supply");
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.itemId)) add(line.itemId, "listed more than once");
    seen.add(line.itemId);
    const item = items.get(line.itemId);
    if (!item) add(line.itemId, "unknown inventory item");
    else if (item.status !== "active") add(line.itemId, `${item.name} is inactive`);
    else if (item.category !== undefined && !options.categories.includes(item.category)) {
      add(line.itemId, `${item.name} is not ${options.categoryLabel} (${item.category.replace("_", " ")})`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) add(line.itemId, "quantity must be a whole number of at least 1");
  }
  return issues;
}

export interface IssuedSupplyLine {
  id: string;
  quantity: number;
}

export interface ReturnedSupplyLine {
  returnsLineId: string;
  quantity: number;
}

/** What is still out per issued line: issued minus everything already returned against it. */
export function outstandingByLine(issued: IssuedSupplyLine[], returned: ReturnedSupplyLine[]): Map<string, number> {
  const out = new Map(issued.map((l) => [l.id, l.quantity]));
  for (const r of returned) {
    const current = out.get(r.returnsLineId);
    if (current !== undefined) out.set(r.returnsLineId, current - r.quantity);
  }
  return out;
}

/** Problems with a return request against what is outstanding, keyed by issued line id. */
export function returnIssues(requested: Array<{ lineId: string; quantity: number }>, outstanding: Map<string, number>): Record<string, string[]> {
  const issues: Record<string, string[]> = {};
  const add = (key: string, message: string) => (issues[key] ??= []).push(message);
  if (requested.length === 0) add("_", "choose what to return");
  const seen = new Set<string>();
  for (const r of requested) {
    if (seen.has(r.lineId)) add(r.lineId, "listed more than once");
    seen.add(r.lineId);
    const left = outstanding.get(r.lineId);
    if (left === undefined) add(r.lineId, "not a supply issued to this procedure");
    else if (r.quantity > left) add(r.lineId, left === 0 ? "already returned in full" : `at most ${left} can be returned`);
  }
  return issues;
}
