import type { MergeDifference, MergePortalHandling, MergeWorkItem, MergeWorkKind } from "@/lib/api/types";

/**
 * Patient merge screens (docs/domains/patient.md, "link, don't move"): labels, links and the checks the merge form
 * runs before calling the API (which enforces every rule again).
 */

/** Which record a row was filed under: a patient number when it is a record merged into this one, else null. */
export function filedUnderLookup(linked: ReadonlyArray<{ id: string; patientNumber: string }> | null | undefined) {
  const numbers = new Map((linked ?? []).map((r) => [r.id, r.patientNumber]));
  return (patientId: string | null | undefined): string | null => (patientId ? (numbers.get(patientId) ?? null) : null);
}

/** "Filed under P00000002" — shown as text next to rows of a record merged into this one (never colour alone). */
export function filedUnderText(patientNumber: string | null | undefined): string | null {
  return patientNumber ? `Filed under ${patientNumber}` : null;
}

export const MERGE_WORK_LABELS: Record<MergeWorkKind, string> = {
  encounter_in_progress: "Consultation in progress",
  online_consultation_in_progress: "Online consultation in progress",
  queue_visit: "In the queue",
  upcoming_appointment: "Upcoming appointment",
  lab_order_open: "Laboratory order not finished",
  draft_invoice: "Draft invoice",
  uninvoiced_charge: "Charge not yet invoiced",
  account_balance: "Deposit or credit balance",
  care_plan_active: "Active care plan",
};

/** What to do about each kind of work before merging. */
export const MERGE_WORK_ACTIONS: Record<MergeWorkKind, string> = {
  encounter_in_progress: "Sign or mark the consultation entered in error.",
  online_consultation_in_progress: "End or escalate the online consultation.",
  queue_visit: "Finish or cancel the visit in the queue.",
  upcoming_appointment: "Cancel it and book it again under the surviving record.",
  lab_order_open: "Release the results or cancel the remaining tests.",
  draft_invoice: "Issue or cancel the draft invoice.",
  uninvoiced_charge: "Invoice or cancel the charge.",
  account_balance: "Apply the balance to an invoice or refund it.",
  care_plan_active: "It stays under the retired number; consider closing it and starting one on the surviving record.",
};

/** The existing screen that resolves a work item. */
export function mergeWorkHref(item: Pick<MergeWorkItem, "link">, retiredPatientId: string): string | null {
  const link = item.link;
  if (!link) return null;
  switch (link.type) {
    case "encounter":
      return `/clinic/encounters/${link.id}`;
    case "visit":
      return `/queue/visits/${link.id}`;
    case "appointment":
      return "/appointments";
    case "lab_order":
      return `/patients/${retiredPatientId}#laboratory`;
    case "invoice":
      return `/billing/invoices/${link.id}`;
    case "billing_patient":
      return `/billing/patients/${link.id}`;
    case "care_plan":
      return `/clinic/care-plans/${link.id}`;
    default:
      return null;
  }
}

export const PORTAL_HANDLING_TEXT: Record<MergePortalHandling, string> = {
  none: "The record to retire has no MyHealth account.",
  moved_to_survivor: "Its MyHealth account moves to the surviving record (the patient signs in again). The surviving record's portal consent governs access.",
  retired_disabled: "Both records have a MyHealth account: the retired record's account is disabled (reason: merged). The surviving account is kept.",
  survivor_kept: "The retired record's MyHealth account is already disabled; the surviving account is kept.",
};

export function differenceLabel(d: Pick<MergeDifference, "code" | "field">): string {
  if (d.code === "deceased_status") return "Deceased status differs";
  return `${d.field} differs`;
}

export interface MergeFormInput {
  reason: string;
  /** The retired record's patient number as typed by the person confirming. */
  confirmation: string;
  acknowledged: readonly string[];
}

export type MergeFormErrors = Partial<Record<"reason" | "confirmation" | "acknowledged", string>>;

/** Checks the merge form: a reason, every flagged difference acknowledged, and the retired number typed exactly. */
export function checkMergeForm(input: MergeFormInput, retiredNumber: string, differences: ReadonlyArray<Pick<MergeDifference, "code">>): MergeFormErrors {
  const errors: MergeFormErrors = {};
  if (input.reason.trim().length < 5) errors.reason = "Give a reason of at least 5 characters.";
  const ack = new Set(input.acknowledged);
  if (differences.some((d) => !ack.has(d.code))) errors.acknowledged = "Review and tick every flagged difference.";
  if (input.confirmation.trim().toUpperCase() !== retiredNumber.toUpperCase()) errors.confirmation = `Type ${retiredNumber} to confirm.`;
  return errors;
}
