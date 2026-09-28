/**
 * Supplies a dental procedure used: pure rules, no I/O. Stock rules themselves (first expiry first out, expired lots,
 * balances, controlled items) belong to inventory and are enforced by its command; these rules only shape what
 * dentistry asks for and how much of an issue can still be returned.
 */

export interface SupplyLineRequest {
  itemId: string;
  quantity: number;
}

export interface KnownItem {
  id: string;
  name: string;
  status: "active" | "inactive";
}

/** Problems with a template or a supply request, keyed by item id ("_" for the whole list). */
export function supplyLineIssues(lines: SupplyLineRequest[], items: Map<string, KnownItem>, options: { allowEmpty: boolean }): Record<string, string[]> {
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
    if (!Number.isInteger(line.quantity) || line.quantity < 1) add(line.itemId, "quantity must be a whole number of at least 1");
  }
  return issues;
}

export interface IssuedLine {
  id: string;
  quantity: number;
}

export interface ReturnedLine {
  returnsLineId: string;
  quantity: number;
}

/** What is still out per issued line: issued minus everything already returned against it. */
export function outstandingByLine(issued: IssuedLine[], returned: ReturnedLine[]): Map<string, number> {
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
