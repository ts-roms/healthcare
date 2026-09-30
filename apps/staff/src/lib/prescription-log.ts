/**
 * The prescription list page's filters (docs/domains/prescription.md, "Prescription list"): read from the URL and
 * turned into the API query. Dates are local days in the Philippines; a period is at most 92 days. The API decides
 * and audits.
 */

export interface PrescriptionLogFilters {
  from: string;
  to: string;
  status: "" | "active" | "cancelled" | "superseded";
  prescriber: string;
  mine: boolean;
  number: string;
  page: number;
}

export const PRESCRIPTION_STATUS_LABEL: Record<"active" | "cancelled" | "superseded", string> = {
  active: "Active",
  cancelled: "Cancelled",
  superseded: "Replaced",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^RX\d{1,8}$/;
export const MAX_DAYS = 92;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Filters from the URL: the period defaults to today (a doctor's day); a reversed one is swapped and one longer than
 * 92 days keeps its end and starts 91 days before it (`adjusted`). A number is upper-cased; anything else is ignored.
 */
export function readPrescriptionFilters(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { filters: PrescriptionLogFilters; adjusted: boolean } {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  let to = DATE.test(one("to")) ? one("to") : today;
  let from = DATE.test(one("from")) ? one("from") : to;
  if (from > to) [from, to] = [to, from];
  let adjusted = false;
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_DAYS) {
    from = addDays(to, -(MAX_DAYS - 1));
    adjusted = true;
  }
  const status = one("status");
  const number = one("number").trim().toUpperCase();
  const page = Number.parseInt(one("page") || "1", 10);
  return {
    filters: {
      from,
      to,
      status: status === "active" || status === "cancelled" || status === "superseded" ? status : "",
      prescriber: UUID.test(one("prescriber")) ? one("prescriber") : "",
      mine: one("mine") === "1",
      number: NUMBER.test(number) ? number : "",
      page: Number.isFinite(page) && page > 0 ? page : 1,
    },
    adjusted,
  };
}

export function prescriptionApiQuery(f: PrescriptionLogFilters, pageSize = 50): Record<string, string | number | undefined> {
  return {
    from: f.from,
    to: f.to,
    status: f.status || undefined,
    prescriberPractitionerId: f.mine ? undefined : f.prescriber || undefined,
    mine: f.mine ? "true" : undefined,
    number: f.number || undefined,
    page: f.page,
    pageSize,
  };
}

/** The URL of the same search on another page. */
export function prescriptionLogHref(f: PrescriptionLogFilters, page: number): string {
  const params = new URLSearchParams();
  params.set("from", f.from);
  params.set("to", f.to);
  if (f.status) params.set("status", f.status);
  if (f.mine) params.set("mine", "1");
  else if (f.prescriber) params.set("prescriber", f.prescriber);
  if (f.number) params.set("number", f.number);
  if (page > 1) params.set("page", String(page));
  return `/clinic/prescriptions?${params.toString()}`;
}
