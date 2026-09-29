import type { RecordsRequestScope, RecordsRequestStatus } from "./api/types";

export const RECORDS_SCOPE_LABEL: Record<RecordsRequestScope, string> = {
  consultations: "Consultation records",
  laboratory: "Laboratory results",
  prescriptions: "Prescriptions",
  dental: "Dental records",
  imaging: "X-rays and images",
  certificates: "Medical certificates",
  other: "Other",
};

/** Status as colour + icon + text (the icon is chosen by the page). */
export const RECORDS_STATUS: Record<RecordsRequestStatus, { label: string; variant: "info" | "warning" | "success" | "neutral" | "danger" }> = {
  submitted: { label: "New", variant: "warning" },
  in_review: { label: "In review", variant: "info" },
  fulfilled: { label: "Shared", variant: "success" },
  declined: { label: "Declined", variant: "danger" },
  withdrawn: { label: "Withdrawn by the patient", variant: "neutral" },
};

/** "Jan 2026 – Jun 2026"-style period text from the request's dates, or "Any time". */
export function periodText(from: string | null, to: string | null, format: (date: string) => string): string {
  if (!from && !to) return "Any time";
  if (from && to) return `${format(from)} to ${format(to)}`;
  return from ? `From ${format(from)}` : `Up to ${format(to!)}`;
}

/** "Today", "1 day", "5 days". */
export function waitingText(days: number): string {
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
}
