import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `inventory.days-of-cover` (docs/domains/assistant.md): an item whose usable stock, with what is already on
 * order, would not last the supplier's lead time at the pace it was issued over the last weeks. A statistic over the
 * organization's own ledger — no reorder level is assumed (the level a person set stays a separate, explicit control).
 * Pure: the figures are loaded by `InventoryAssistantQueries`.
 */

export const daysOfCoverParameters = z.object({
  /** How many past days of issues set the daily pace. */
  windowDays: z.number().int().min(7).max(180),
  /** Days the organization waits for a delivery: cover shorter than this is flagged. */
  leadTimeDays: z.number().int().min(1).max(120),
  /** Days of stock a new order should cover. */
  targetCoverDays: z.number().int().min(1).max(365),
  /** Issues in the window needed before the pace counts as established (fewer: shown as a weak signal). */
  minIssues: z.number().int().min(2).max(100),
});
export type DaysOfCoverParameters = z.infer<typeof daysOfCoverParameters>;

export const DAYS_OF_COVER_RULE: RuleDefinition<DaysOfCoverParameters> = {
  id: "inventory.days-of-cover",
  version: 1,
  domain: "inventory",
  title: "Stock may run out before a delivery arrives",
  description:
    "Compares the usable stock (and open orders) with the pace of issues over the last weeks, and suggests a quantity to cover the days the organization chose.",
  surfaces: ["inventory"],
  requires: ["inventory.read"],
  parametersSchema: daysOfCoverParameters,
  defaultParameters: { windowDays: 30, leadTimeDays: 14, targetCoverDays: 30, minIssues: 5 },
  parameterLabels: {
    leadTimeDays: { label: "Delivery time", unit: "days", min: 1, max: 120, hint: "Stock that will not last this long at the recent pace is flagged." },
    targetCoverDays: { label: "Order enough for", unit: "days", min: 1, max: 365, hint: "The suggested quantity covers this many days at the recent pace." },
    windowDays: { label: "Pace measured over the last", unit: "days", min: 7, max: 180, hint: "Issues in this period set the daily pace." },
    minIssues: {
      label: "Issues needed for a firm pace",
      unit: "issues",
      min: 2,
      max: 100,
      hint: "With fewer issues in the period, a suggestion is marked “Based on limited data”.",
    },
  },
};

export interface DaysOfCoverInput {
  itemId: string;
  code: string;
  name: string;
  stockUnit: string;
  /** Unexpired stock at the facility's active locations. */
  usable: number;
  /** Ordered and not yet received on orders open for delivery. */
  onOrder: number;
  /** Net quantity issued in the window (returns netted off). */
  issued: number;
  /** Issue movements in the window. */
  issues: number;
}

export function daysOfCoverSuggestions(inputs: readonly DaysOfCoverInput[], params: DaysOfCoverParameters): Suggestion[] {
  const out: Suggestion[] = [];
  for (const item of inputs) {
    if (item.issued <= 0 || item.issues < 2) continue;
    const dailyUse = item.issued / params.windowDays;
    const coverDays = (item.usable + item.onOrder) / dailyUse;
    if (coverDays >= params.leadTimeDays) continue;
    const quantity = Math.ceil(dailyUse * params.targetCoverDays) - (item.usable + item.onOrder);
    if (quantity <= 0) continue;
    const days = Math.floor(coverDays);
    out.push({
      id: suggestionId(DAYS_OF_COVER_RULE.id, DAYS_OF_COVER_RULE.version, `item:${item.itemId}`),
      ruleId: DAYS_OF_COVER_RULE.id,
      ruleVersion: DAYS_OF_COVER_RULE.version,
      surface: "inventory",
      severity: item.usable === 0 || coverDays < params.leadTimeDays / 2 ? "warning" : "advice",
      title: `${item.name}: about ${days} ${days === 1 ? "day" : "days"} of stock left`,
      rationale:
        `At the pace of the last ${params.windowDays} days (about ${formatPace(dailyUse)} ${item.stockUnit} a day), what is usable` +
        `${item.onOrder > 0 ? " and on order" : ""} lasts less than your ${params.leadTimeDays}-day delivery time. ` +
        `Ordering ${quantity} ${item.stockUnit} would cover ${params.targetCoverDays} days at that pace.`,
      evidence: [
        { label: "Usable stock", resourceType: "inventory_item", resourceId: item.itemId, value: `${item.usable} ${item.stockUnit}` },
        {
          label: `Issued in ${params.windowDays} days`,
          resourceType: "inventory_item",
          resourceId: item.itemId,
          value: `${item.issued} ${item.stockUnit} in ${item.issues} issues`,
        },
        ...(item.onOrder > 0
          ? [{ label: "On open orders", resourceType: "inventory_item", resourceId: item.itemId, value: `${item.onOrder} ${item.stockUnit}` }]
          : []),
      ],
      basis: "statistic",
      strength: item.issues >= params.minIssues ? "matched" : "weak",
      requires: [...DAYS_OF_COVER_RULE.requires],
      action: { label: "Open purchase orders", href: "/inventory/purchase-orders" },
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "warning" ? -1 : 1));
}

function formatPace(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}
