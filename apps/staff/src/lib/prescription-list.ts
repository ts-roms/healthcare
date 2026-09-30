/** Filters of the facility's prescription list (`/clinic/prescriptions`), read from the address and kept within what the API accepts. */

export const MAX_PRESCRIPTION_LIST_DAYS = 92;

export const PRESCRIPTION_STATUS_FILTERS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "superseded", label: "Replaced" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type PrescriptionStatusFilter = (typeof PRESCRIPTION_STATUS_FILTERS)[number]["value"];

export interface PrescriptionListFilters {
  from: string;
  to: string;
  status: PrescriptionStatusFilter;
  /** Only the signed-in practitioner's prescriptions. */
  mine: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today by default; a reversed period is swapped and one longer than 92 days is shortened (and says so). */
export function readPrescriptionListFilters(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { filters: PrescriptionListFilters; adjusted: boolean } {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const date = (key: string) => {
    const value = one(key) ?? "";
    // A real calendar day: "2026-02-30" is refused, not rolled over to March.
    return DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : "";
  };
  let to = date("to") || today;
  let from = date("from") || to;
  if (from > to) [from, to] = [to, from];
  let adjusted = false;
  if (daysBetween(from, to) >= MAX_PRESCRIPTION_LIST_DAYS) {
    from = addDays(to, -(MAX_PRESCRIPTION_LIST_DAYS - 1));
    adjusted = true;
  }
  const status = one("status") ?? "";
  return {
    filters: {
      from,
      to,
      status: PRESCRIPTION_STATUS_FILTERS.some((s) => s.value === status) ? (status as PrescriptionStatusFilter) : "",
      mine: one("mine") === "true",
    },
    adjusted,
  };
}

/** The API query for these filters (`GET /prescriptions/issued`). */
export function prescriptionListQuery(filters: PrescriptionListFilters): Record<string, string> {
  return {
    from: filters.from,
    to: filters.to,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.mine ? { mine: "true" } : {}),
  };
}

/** The page's address for these filters. */
export function prescriptionListHref(filters: PrescriptionListFilters): string {
  return `/clinic/prescriptions?${new URLSearchParams(prescriptionListQuery(filters)).toString()}`;
}

/** "Amoxicillin 500 mg capsule × 21 capsules" */
export function prescribedLine(item: {
  genericName: string;
  strength: string | null;
  dosageForm: string | null;
  quantity: number;
  quantityUnit: string;
}): string {
  const name = [item.genericName, item.strength, item.dosageForm].filter(Boolean).join(" ");
  return `${name} × ${item.quantity} ${item.quantityUnit}`;
}
