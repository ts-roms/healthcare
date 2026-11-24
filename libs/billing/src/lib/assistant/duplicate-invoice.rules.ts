import { localDate, localTime, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `billing.possible-duplicate-invoice` (docs/domains/assistant.md): two issued invoices at a facility for the same
 * patient, with the same total and the same services, issued within some hours of each other. It may be two real visits;
 * it may also be the same visit billed twice. The suggestion names the invoice numbers (never the patient), links to the
 * later one and changes nothing: an issued invoice is corrected only by void and reissue or a credit note.
 */

export const duplicateInvoiceParameters = z.object({
  /** Two invoices issued within this many hours of each other are compared. */
  withinHours: z.number().int().min(1).max(168),
  /** Days of issued invoices looked at. */
  lookbackDays: z.number().int().min(1).max(90),
});
export type DuplicateInvoiceParameters = z.infer<typeof duplicateInvoiceParameters>;

export const DUPLICATE_INVOICE_RULE: RuleDefinition<DuplicateInvoiceParameters> = {
  id: "billing.possible-duplicate-invoice",
  version: 1,
  domain: "billing",
  title: "Invoices that may have been issued twice",
  description:
    "Finds two issued invoices for the same patient with the same total and the same services, issued within some hours of each other. It changes nothing.",
  surfaces: ["billing"],
  requires: ["billing.charge.read"],
  parametersSchema: duplicateInvoiceParameters,
  defaultParameters: { withinHours: 24, lookbackDays: 14 },
  parameterLabels: {
    withinHours: { label: "Compare invoices issued within", unit: "hours of each other", min: 1, max: 168 },
    lookbackDays: { label: "Look at invoices from the last", unit: "days", min: 1, max: 90 },
  },
  reads:
    "The facility's invoices issued in the period and not void: the patient (records merged into theirs included), net total, services and issue time. Only invoice numbers are shown.",
  knownFalsePositives: ["Two real visits with the same services and total within the hours you set, such as a daily injection or dressing."],
  blindSpots: [
    "The same visit billed twice with a different total (a discount on one) or different services.",
    "Invoices at another facility, or issued further apart than the hours you set.",
    "A service charged twice inside one invoice.",
  ],
};

export interface InvoicePair {
  first: { id: string; number: string; issuedAt: string };
  second: { id: string; number: string; issuedAt: string };
  /** Centavos */
  netTotal: number;
  services: number;
}

function peso(centavos: number): string {
  return `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `timeZone`: the facility's, for the issue times shown. */
export function duplicateInvoiceSuggestions(pairs: readonly InvoicePair[], timeZone: string): Suggestion[] {
  const at = (iso: string) => `issued ${localDate(new Date(iso), timeZone)} ${localTime(new Date(iso), timeZone)}`;
  return pairs.map((pair) => {
    const hours = Math.abs(Date.parse(pair.second.issuedAt) - Date.parse(pair.first.issuedAt)) / 3_600_000;
    const apart = hours < 1 ? "less than an hour" : `${Math.round(hours)} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
    return {
      id: suggestionId(DUPLICATE_INVOICE_RULE.id, DUPLICATE_INVOICE_RULE.version, `pair:${pair.first.id}:${pair.second.id}`),
      ruleId: DUPLICATE_INVOICE_RULE.id,
      ruleVersion: DUPLICATE_INVOICE_RULE.version,
      surface: "billing",
      severity: "advice",
      title: `Invoices ${pair.first.number} and ${pair.second.number} may be the same visit billed twice`,
      rationale:
        `Same patient, same total (${peso(pair.netTotal)}) and the same ${pair.services === 1 ? "service" : `${pair.services} services`}, issued ${apart} apart. ` +
        "If it is one visit, void one and reissue, or issue a credit note; if they are two visits, dismiss this.",
      evidence: [
        {
          label: `Invoice ${pair.first.number}`,
          resourceType: "billing_invoice",
          resourceId: pair.first.id,
          value: at(pair.first.issuedAt),
        },
        {
          label: `Invoice ${pair.second.number}`,
          resourceType: "billing_invoice",
          resourceId: pair.second.id,
          value: at(pair.second.issuedAt),
        },
        { label: "Total of each", resourceType: "billing_invoice", resourceId: pair.second.id, value: peso(pair.netTotal) },
      ],
      basis: "rule",
      strength: "matched",
      requires: [...DUPLICATE_INVOICE_RULE.requires],
      action: { label: `Open invoice ${pair.second.number}`, href: `/billing/invoices/${pair.second.id}` },
    };
  });
}
