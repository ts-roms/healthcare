import type { ExchangeReviewItem } from "@/lib/api/types";

/** Human names for the systems and operations the integration worker knows. Unknown ones show their technical name. */
const OPERATIONS: Record<string, string> = {
  "philhealth-eclaims submit_claim": "PhilHealth claim",
  "philhealth-eligibility check_eligibility": "PhilHealth eligibility check",
  "doh-reporting submit_case_report": "DOH case report",
  "philhealth-yakap submit_encounter": "PhilHealth YAKAP encounter package",
};

export function operationLabel(e: Pick<ExchangeReviewItem, "system" | "operation">): string {
  return OPERATIONS[`${e.system} ${e.operation}`] ?? `${e.system} · ${e.operation.replace(/_/g, " ")}`;
}

/** Where to fix the cause and prepare the request again. */
export function sourceLink(e: Pick<ExchangeReviewItem, "resourceType" | "resourceId"> & { patientId?: string | null }): { href: string; label: string } | null {
  switch (e.resourceType) {
    case "encounter":
      return e.patientId ? { href: `/patients/${e.patientId}/yakap/${e.resourceId}`, label: "Open YAKAP package" } : null;
    case "billing_invoice":
      return { href: `/billing/invoices/${e.resourceId}`, label: "Open invoice" };
    case "doh_case_report":
      return { href: `/reporting/${e.resourceId}`, label: "Open case report" };
    case "patient":
      return { href: `/patients/${e.resourceId}`, label: "Open patient record" };
    default:
      return null;
  }
}
