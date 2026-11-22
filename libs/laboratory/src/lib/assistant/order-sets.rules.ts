import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `laboratory.order-sets` (docs/domains/assistant.md): in a consultation in progress, the organization's own order
 * sets whose triggers match it — a diagnosis whose code starts with a set's prefix (in its coding system, if one is
 * named), or the visit's type. The link opens the laboratory order form with the set's tests chosen; the doctor checks
 * them and places the order, or not. The sets and their triggers are the organization's configuration: no guideline
 * is shipped. A set whose tests were all ordered in this consultation is not offered again.
 */

export const orderSetsParameters = z.object({
  /** The most order sets offered in one consultation. */
  maxSets: z.number().int().min(1).max(5),
});
export type OrderSetsParameters = z.infer<typeof orderSetsParameters>;

export const ORDER_SETS_RULE: RuleDefinition<OrderSetsParameters> = {
  id: "laboratory.order-sets",
  version: 1,
  domain: "laboratory",
  title: "An order set for this consultation",
  description:
    "Offers your organization's order sets whose diagnosis codes or visit type match the consultation in progress. Its link opens the lab order form with the set's tests chosen; the doctor checks them and places the order.",
  surfaces: ["encounter"],
  requires: ["encounter.read", "lab.order.create"],
  parametersSchema: orderSetsParameters,
  defaultParameters: { maxSets: 3 },
  parameterLabels: {
    maxSets: { label: "Offer at most", unit: "order sets per consultation", min: 1, max: 5 },
  },
  reads:
    "The consultation in progress (its diagnosis codes, its visit type and the tests ordered in it) and your organization's active order sets with their triggers. Never notes or results.",
  knownFalsePositives: [
    "A short diagnosis-code prefix matches far more diagnoses than intended.",
    "A visit-type trigger offers the set at every visit of that type.",
    "Tests done in an earlier consultation, or ordered there and still waiting for a result, are offered again: only this consultation's orders are read.",
  ],
  blindSpots: ["Diagnoses without a code, and consultations without a visit type.", "Sets beyond the number you allow per consultation."],
};

export interface OrderSetCandidate {
  id: string;
  name: string;
  note: string | null;
  items: Array<{ name: string; testIds: string[] }>;
  triggers: Array<{ kind: "diagnosis_code" | "visit_type"; value: string; codeSystemKey: string | null }>;
}

export interface OrderSetContext {
  encounterId: string;
  /** The visit type's code (from the queue visit or the appointment), if known. */
  visitTypeCode: string | null;
  /** Active diagnoses of the consultation. */
  diagnoses: Array<{ codeSystemKey: string | null; code: string | null }>;
  /** Tests already ordered in this consultation (panels expanded). */
  orderedTestIds: string[];
}

/** Why a set matches the consultation, in a few words; null when it does not. */
export function orderSetReason(set: OrderSetCandidate, ctx: OrderSetContext): string | null {
  for (const trigger of set.triggers) {
    if (trigger.kind === "visit_type" && ctx.visitTypeCode && ctx.visitTypeCode.toLowerCase() === trigger.value) return "this visit type";
    if (trigger.kind === "diagnosis_code") {
      const match = ctx.diagnoses.find(
        (d) =>
          d.code &&
          d.code.replace(/\s+/g, "").toUpperCase().startsWith(trigger.value) &&
          (trigger.codeSystemKey === null || trigger.codeSystemKey === d.codeSystemKey),
      );
      if (match) return `the diagnosis ${match.code!.trim()}`;
    }
  }
  return null;
}

export function orderSetSuggestions(sets: readonly OrderSetCandidate[], ctx: OrderSetContext | null, params: OrderSetsParameters): Suggestion[] {
  if (!ctx) return [];
  const ordered = new Set(ctx.orderedTestIds);
  const out: Suggestion[] = [];
  for (const set of sets) {
    if (out.length >= params.maxSets) break;
    const reason = orderSetReason(set, ctx);
    if (!reason) continue;
    const pending = set.items.filter((item) => item.testIds.some((id) => !ordered.has(id)));
    if (pending.length === 0) continue;
    out.push({
      id: suggestionId(ORDER_SETS_RULE.id, ORDER_SETS_RULE.version, `encounter:${ctx.encounterId}:set:${set.id}`),
      ruleId: ORDER_SETS_RULE.id,
      ruleVersion: ORDER_SETS_RULE.version,
      surface: "encounter",
      severity: "info",
      title: `Order set for ${reason}: ${set.name}`,
      rationale:
        `${set.note ? `${set.note.replace(/[.\s]+$/, "")}. ` : ""}Your organization offers this set for ${reason}. ` +
        "Its link opens the lab order form with these tests chosen; check each one before ordering.",
      evidence: set.items.map((item) => ({
        label: item.name,
        resourceType: "lab_order_set",
        resourceId: set.id,
        value: pending.includes(item) ? "to order" : "already ordered in this consultation",
      })),
      basis: "rule",
      strength: "matched",
      requires: [...ORDER_SETS_RULE.requires],
      action: { label: "Open in the lab order form", href: `/clinic/encounters/${ctx.encounterId}?orderSet=${set.id}#lab-orders` },
    });
  }
  return out;
}
