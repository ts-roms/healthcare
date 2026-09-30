import { type KnownSupplyItem, type SupplyLineRequest, supplyLineIssues as sharedSupplyLineIssues } from "@healthcare/core";

/**
 * Supplies a dental procedure used: the shared rules of `libs/core` (supplies/supply-use.ts) with dentistry's
 * categories. Stock rules themselves belong to inventory and are enforced by its command.
 */

/**
 * Inventory item categories dentistry uses as procedure supplies. Laboratory reagents and consumables are not (they
 * belong to the laboratory's workflows).
 */
export const DENTAL_SUPPLY_CATEGORIES = ["dental_supply", "medical_supply", "medicine", "ppe", "other"] as const;

export type { SupplyLineRequest };
export type KnownItem = KnownSupplyItem;
export { outstandingByLine, returnIssues } from "@healthcare/core";
export type { IssuedSupplyLine as IssuedLine, ReturnedSupplyLine as ReturnedLine } from "@healthcare/core";

/** Problems with a template or a supply request, keyed by item id ("_" for the whole list). */
export function supplyLineIssues(lines: SupplyLineRequest[], items: Map<string, KnownItem>, options: { allowEmpty: boolean }): Record<string, string[]> {
  return sharedSupplyLineIssues(lines, items, { ...options, categories: DENTAL_SUPPLY_CATEGORIES, categoryLabel: "a dental supply" });
}
