import { mean, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `inventory.usage-spike` (docs/domains/assistant.md): an item issued far more in the last 7 days than in a usual
 * week. It may be a change in demand, a mistaken entry, or loss: the suggestion only points to the movements. A week
 * counts as unusual when it is above the mean of earlier weeks plus `spread` typical swings (the standard deviation,
 * never taken below a tenth of the mean, so a perfectly steady item still has a margin). Pure: weekly totals come from
 * `InventoryAssistantQueries`.
 */

export const usageSpikeParameters = z.object({
  /** Earlier weeks compared against (the current week is not one of them). */
  weeks: z.number().int().min(4).max(26),
  /** How many typical swings above the usual week count as unusual. */
  spread: z.number().int().min(2).max(6),
  /** Fewer issued in the last 7 days than this: never flagged (small items swing a lot). */
  minIssued: z.number().int().min(1).max(100_000),
});
export type UsageSpikeParameters = z.infer<typeof usageSpikeParameters>;

export const USAGE_SPIKE_RULE: RuleDefinition<UsageSpikeParameters> = {
  id: "inventory.usage-spike",
  version: 1,
  domain: "inventory",
  title: "An item was issued much more than usual",
  description: "Compares what was issued in the last 7 days with the usual week over the weeks before, and points to the movements when it is far above.",
  surfaces: ["inventory"],
  requires: ["inventory.read"],
  parametersSchema: usageSpikeParameters,
  defaultParameters: { weeks: 8, spread: 3, minIssued: 20 },
  parameterLabels: {
    weeks: { label: "Compare with the previous", unit: "weeks", min: 4, max: 26, hint: "The usual week is worked out from these weeks." },
    spread: {
      label: "Flag above the usual week by",
      unit: "typical swings",
      min: 2,
      max: 6,
      hint: "Higher means fewer, bigger surprises are flagged.",
    },
    minIssued: {
      label: "Ignore weeks with fewer than",
      unit: "units issued",
      min: 1,
      max: 100_000,
      hint: "Small quantities swing too much to read anything into.",
    },
  },
  reads: "Each item's issues and returns at the facility, totalled per week over the weeks you set. Quantities only.",
  knownFalsePositives: [
    "A planned busy week, such as a vaccination drive or a medical mission, looks like a spike.",
    "Stock moved to another place but recorded as an issue instead of a transfer, or several days of issues entered at once.",
    "A newly stocked item, or one issued only now and then, has mostly empty earlier weeks; such suggestions are marked as based on limited data.",
  ],
  blindSpots: [
    "A slow, steady rise: each busier week raises the usual week a little.",
    "Losses recorded as write-offs, which are not issues.",
    "A week with fewer units issued than the minimum you set.",
  ],
};

export interface UsageSpikeInput {
  itemId: string;
  name: string;
  stockUnit: string;
  /** Issued (net of returns) per 7-day period, oldest first; the last entry is the most recent 7 days. */
  weekly: number[];
}

export function usageSpikeSuggestions(inputs: readonly UsageSpikeInput[], params: UsageSpikeParameters): Suggestion[] {
  const out: Suggestion[] = [];
  for (const item of inputs) {
    if (item.weekly.length < 2) continue;
    const current = item.weekly[item.weekly.length - 1]!;
    const history = item.weekly.slice(0, -1).slice(-params.weeks);
    if (current < params.minIssued || history.length < 4) continue;
    const usual = mean(history, 4);
    if (usual === null) continue;
    const sd = Math.sqrt(history.reduce((sum, v) => sum + (v - usual) ** 2, 0) / Math.max(1, history.length - 1));
    const swing = Math.max(sd, usual * 0.1, 1);
    const limit = usual + params.spread * swing;
    if (current <= limit) continue;
    const times = usual > 0 ? current / usual : null;
    out.push({
      id: suggestionId(USAGE_SPIKE_RULE.id, USAGE_SPIKE_RULE.version, `item:${item.itemId}`),
      ruleId: USAGE_SPIKE_RULE.id,
      ruleVersion: USAGE_SPIKE_RULE.version,
      surface: "inventory",
      severity: "advice",
      title: `${item.name}: ${current} ${item.stockUnit} issued in the last 7 days${times !== null && times >= 1.5 ? `, about ${formatTimes(times)} the usual week` : ""}`,
      rationale:
        `A usual week over the ${history.length} weeks before was about ${Math.round(usual)} ${item.stockUnit}. ` +
        `Check the movements: it may be more patients, a mistaken entry, or stock that went missing.`,
      evidence: [
        { label: "Issued in the last 7 days", resourceType: "inventory_item", resourceId: item.itemId, value: `${current} ${item.stockUnit}` },
        {
          label: `Usual week (${history.length} weeks before)`,
          resourceType: "inventory_item",
          resourceId: item.itemId,
          value: `about ${Math.round(usual)} ${item.stockUnit}`,
        },
      ],
      basis: "statistic",
      strength: history.filter((w) => w > 0).length >= 4 ? "matched" : "weak",
      requires: [...USAGE_SPIKE_RULE.requires],
      action: { label: "Review movements", href: "/inventory/movements" },
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function formatTimes(value: number): string {
  return value >= 10 ? `${Math.round(value)} times` : `${value.toFixed(1)} times`;
}
