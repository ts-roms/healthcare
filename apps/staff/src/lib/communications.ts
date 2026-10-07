import type { NotificationCategory, NotificationChannel, NotificationStatus } from "./api/types";

/**
 * The communication log page's filters and wording (docs/domains/notification.md, "Communication log"). The API
 * decides and audits; these read the URL, build the API query and put statuses and reasons into words. Dates are local
 * days in the Philippines; a period is at most 92 days; a facility narrows to messages sent from it (migration 0106).
 */

export const CHANNEL_LABEL: Record<NotificationChannel, string> = { sms: "Text message", email: "Email", push: "Push", in_app: "MyHealth inbox" };

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  clinical: "Care",
  administrative: "Appointments and admin",
  outreach: "Reminders and outreach",
  security: "Account security",
};

/** Why a message was not sent (the recipient directory's and the patient policy's reasons), in words. */
export const SUPPRESSION_REASON_LABEL: Record<string, string> = {
  opted_out: "The patient turned this off",
  no_outreach_opt_in: "The patient has not agreed to reminders and outreach",
  patient_deceased: "The patient has died",
  patient_merged: "Record merged into another",
  patient_inactive: "Record inactive",
  no_mobile_number: "No mobile number on record",
  no_email_address: "No email address on record",
  no_push_device: "No phone or browser set up for push",
  no_portal_account: "No active MyHealth account",
  patient_not_found: "Patient not found",
  invalid_channel: "Channel not allowed for this message",
};

export function suppressionReasonText(reason: string | null): string {
  if (!reason) return "Not sent";
  return SUPPRESSION_REASON_LABEL[reason] ?? reason.replaceAll("_", " ");
}

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

/** A delivery status as words and a tone (the page adds an icon: never colour alone). */
export function statusView(status: NotificationStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case "delivered":
      return { label: "Delivered", tone: "success" };
    case "sent":
      return { label: "Sent", tone: "success" };
    case "queued":
      return { label: "Waiting to send", tone: "info" };
    case "sending":
      return { label: "Sending", tone: "info" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "suppressed":
      return { label: "Not sent", tone: "warning" };
    default:
      return { label: "Cancelled", tone: "neutral" };
  }
}

export const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Any status" },
  { value: "not_sent", label: "Not sent, failed or cancelled" },
  { value: "suppressed", label: "Not sent (consent or preferences)" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Waiting to send" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export interface CommunicationFilters {
  from: string;
  to: string;
  channel: string;
  category: string;
  status: string;
  template: string;
  patient: string;
  facility: string;
  page: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATE = /^[a-z0-9.-]{1,60}$/;
export const MAX_DAYS = 92;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Filters from the URL. The period defaults to the last 7 days; one that ends before it starts is swapped, and one
 * longer than 92 days keeps its end and starts 91 days before it (with a note).
 */
export function readCommunicationFilters(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { filters: CommunicationFilters; adjusted: boolean } {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const pick = (key: string, pattern: RegExp) => {
    const value = one(key) ?? "";
    return pattern.test(value) ? value : "";
  };
  let to = pick("to", DATE) || today;
  let from = pick("from", DATE) || addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  let adjusted = false;
  if (daysBetween(from, to) >= MAX_DAYS) {
    from = addDays(to, -(MAX_DAYS - 1));
    adjusted = true;
  }
  const page = Number.parseInt(one("page") ?? "1", 10);
  const channel = one("channel") ?? "";
  const category = one("category") ?? "";
  const status = one("status") ?? "";
  return {
    filters: {
      from,
      to,
      channel: channel in CHANNEL_LABEL ? channel : "",
      category: category in CATEGORY_LABEL ? category : "",
      status: STATUS_FILTERS.some((s) => s.value === status) ? status : "",
      template: pick("template", TEMPLATE),
      patient: pick("patient", UUID),
      facility: pick("facility", UUID),
      page: Number.isFinite(page) && page > 0 ? page : 1,
    },
    adjusted,
  };
}

/** The API query for the log (or its CSV export, without paging). */
export function communicationApiQuery(filters: CommunicationFilters, pageSize = 50): Record<string, string | number | undefined> {
  return {
    from: filters.from,
    to: filters.to,
    channel: filters.channel || undefined,
    category: filters.category || undefined,
    status: filters.status || undefined,
    templateKey: filters.template || undefined,
    patientId: filters.patient || undefined,
    facilityId: filters.facility || undefined,
    page: filters.page,
    pageSize,
  };
}

/** The URL of the same search on another page (or, with `base`, of the CSV export). */
export function communicationHref(filters: CommunicationFilters, page: number, base = "/communications"): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page: String(page) }))
    if (value && !(key === "page" && (value === "1" || base !== "/communications"))) params.set(key, String(value));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** "3 of 120 not sent (2.5%)": a share with its count, or null with nothing to compare. */
export function shareText(part: number, total: number): string | null {
  if (total === 0) return null;
  const pct = (part / total) * 100;
  return `${part} of ${total} (${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%)`;
}
