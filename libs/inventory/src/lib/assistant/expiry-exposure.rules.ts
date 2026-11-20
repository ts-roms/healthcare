import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `inventory.expiry-exposure` (docs/domains/assistant.md): a lot that will probably expire before it is used, at
 * the pace the item was issued recently. Issues take the earliest expiry first (FEFO), so the lots are used up in expiry
 * order: whatever a lot still holds when its last usable day passes is the expected waste. A pace is never assumed:
 * an item not issued in the window is expected to use nothing. Pure: lots and pace come from `InventoryAssistantQueries`.
 */

export const expiryExposureParameters = z.object({
  /** Days of issues that set the daily pace. */
  windowDays: z.number().int().min(7).max(180),
  /** Only lots whose expiry falls within this many days are flagged (later ones are too uncertain). */
  horizonDays: z.number().int().min(7).max(365),
  /** Expected waste below this is not flagged. */
  minUnits: z.number().int().min(1).max(100_000),
  /** Issues in the window needed for a firm pace (fewer: shown as "Based on limited data"). */
  minIssues: z.number().int().min(1).max(100),
});
export type ExpiryExposureParameters = z.infer<typeof expiryExposureParameters>;

export const EXPIRY_EXPOSURE_RULE: RuleDefinition<ExpiryExposureParameters> = {
  id: "inventory.expiry-exposure",
  version: 1,
  domain: "inventory",
  title: "Stock may expire before it is used",
  description:
    "Uses up the lots in expiry order at the recent pace of issues and flags what a lot will probably still hold when it expires, so it can be moved or used first.",
  surfaces: ["inventory"],
  requires: ["inventory.read"],
  parametersSchema: expiryExposureParameters,
  defaultParameters: { windowDays: 30, horizonDays: 90, minUnits: 1, minIssues: 5 },
  parameterLabels: {
    horizonDays: { label: "Look at lots expiring within", unit: "days", min: 7, max: 365, hint: "Lots expiring later are not flagged yet." },
    windowDays: { label: "Pace measured over the last", unit: "days", min: 7, max: 180, hint: "Issues in this period set the daily pace." },
    minUnits: { label: "Flag from", unit: "units expected to expire", min: 1, max: 100_000, hint: "Smaller expected waste is not shown." },
    minIssues: {
      label: "Issues needed for a firm pace",
      unit: "issues",
      min: 1,
      max: 100,
      hint: "With fewer issues in the period, a suggestion is marked “Based on limited data”.",
    },
  },
};

export interface ExpiryExposureLot {
  lotId: string;
  lotNumber: string | null;
  /** YYYY-MM-DD, the last usable day. */
  expiryDate: string;
  quantity: number;
}

export interface ExpiryExposureInput {
  itemId: string;
  name: string;
  stockUnit: string;
  /** Net quantity issued in the window. */
  issued: number;
  issues: number;
  /** Usable lots with an expiry date (not yet expired). */
  lots: ExpiryExposureLot[];
}

/** Days from `from` to `to` (YYYY-MM-DD), inclusive of `to`'s whole day. */
function daysThrough(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** What each lot is expected to still hold at its expiry, using lots in expiry order at `dailyUse` from `today`. */
export function expectedWaste(lots: readonly ExpiryExposureLot[], dailyUse: number, today: string): Array<ExpiryExposureLot & { waste: number }> {
  const ordered = [...lots].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  let used = 0;
  return ordered.map((lot) => {
    const demand = dailyUse * Math.max(0, daysThrough(today, lot.expiryDate));
    const take = Math.min(lot.quantity, Math.max(0, demand - used));
    used += take;
    return { ...lot, waste: Math.max(0, Math.floor(lot.quantity - take)) };
  });
}

export function expiryExposureSuggestions(inputs: readonly ExpiryExposureInput[], params: ExpiryExposureParameters, today: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const item of inputs) {
    const dailyUse = Math.max(0, item.issued) / params.windowDays;
    for (const lot of expectedWaste(item.lots, dailyUse, today)) {
      const days = daysThrough(today, lot.expiryDate) - 1;
      if (days > params.horizonDays || lot.waste < params.minUnits) continue;
      const lotName = lot.lotNumber ? `lot ${lot.lotNumber}` : "a lot";
      out.push({
        id: suggestionId(EXPIRY_EXPOSURE_RULE.id, EXPIRY_EXPOSURE_RULE.version, `lot:${lot.lotId}`),
        ruleId: EXPIRY_EXPOSURE_RULE.id,
        ruleVersion: EXPIRY_EXPOSURE_RULE.version,
        surface: "inventory",
        severity: days <= 30 && lot.waste === lot.quantity ? "warning" : "advice",
        title: `${item.name}, ${lotName}: about ${lot.waste} ${item.stockUnit} may expire unused on ${lot.expiryDate}`,
        rationale:
          dailyUse > 0
            ? `At the pace of the last ${params.windowDays} days (about ${formatPace(dailyUse)} ${item.stockUnit} a day), using the earliest expiry first, ` +
              `this lot will not be used up in time. Consider moving it where it is used more, or using it first.`
            : `Nothing was issued in the last ${params.windowDays} days, so this lot will expire unless it is used or moved.`,
        evidence: [
          {
            label: `In ${lotName}`,
            resourceType: "inventory_lot",
            resourceId: lot.lotId,
            value: `${lot.quantity} ${item.stockUnit}, expires ${lot.expiryDate}`,
          },
          {
            label: `Issued in ${params.windowDays} days`,
            resourceType: "inventory_item",
            resourceId: item.itemId,
            value: `${Math.max(0, item.issued)} ${item.stockUnit} in ${item.issues} issues`,
          },
        ],
        basis: "statistic",
        strength: item.issues >= params.minIssues || item.issues === 0 ? "matched" : "weak",
        requires: [...EXPIRY_EXPOSURE_RULE.requires],
        action: { label: "See expiring stock", href: "/inventory?show=expiring" },
      });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "warning" ? -1 : 1));
}

function formatPace(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}
