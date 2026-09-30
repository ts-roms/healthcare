import type { PatientTimelineEntry, PatientTimelineKind } from "./api/types";

type Variant = "success" | "warning" | "danger" | "neutral" | "info" | "critical";
/** Which status icon to show with the label (the component maps it to an icon; never colour alone). */
export type StatusTone = "done" | "active" | "waiting" | "stopped" | "failed" | "neutral";

/** Filter chips: groups of timeline kinds, in the order shown. */
export const TIMELINE_GROUPS = [
  { key: "visits", label: "Visits", kinds: ["appointment", "queue_visit", "triage", "encounter", "vitals", "referral", "medical_certificate"] },
  { key: "allergies", label: "Allergies and consents", kinds: ["allergy", "consent"] },
  { key: "prescriptions", label: "Prescriptions", kinds: ["prescription", "dispense"] },
  { key: "laboratory", label: "Laboratory", kinds: ["lab_order", "specimen", "lab_result_release", "critical_value"] },
  { key: "dental", label: "Dental", kinds: ["dental", "dental_imaging"] },
  { key: "care-plans", label: "Care plans", kinds: ["care_plan"] },
  { key: "billing", label: "Billing", kinds: ["invoice", "payment", "billing_note", "deposit"] },
  { key: "claims", label: "PhilHealth and DOH", kinds: ["philhealth_claim", "philhealth_eligibility", "doh_case_report"] },
  { key: "messages", label: "Messages", kinds: ["communication"] },
  { key: "imported", label: "Imported history", kinds: ["external_history"] },
  { key: "documents", label: "Documents and requests", kinds: ["document", "records_request"] },
  { key: "immunizations", label: "Immunizations", kinds: ["immunization"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; kinds: readonly PatientTimelineKind[] }>;

export type TimelineGroupKey = (typeof TIMELINE_GROUPS)[number]["key"];

export const KIND_LABELS: Record<PatientTimelineKind, string> = {
  appointment: "Appointment",
  queue_visit: "Queue visit",
  triage: "Triage",
  encounter: "Encounter",
  referral: "Referral",
  medical_certificate: "Medical certificate",
  vitals: "Vital signs",
  allergy: "Allergy",
  consent: "Consent",
  prescription: "Prescription",
  dispense: "Dispensing",
  lab_order: "Laboratory order",
  specimen: "Specimen",
  lab_result_release: "Laboratory results",
  critical_value: "Critical result",
  dental: "Dental",
  dental_imaging: "Dental image",
  care_plan: "Care plan",
  invoice: "Invoice",
  payment: "Payment",
  billing_note: "Credit or debit note",
  deposit: "Deposit and credit",
  philhealth_claim: "PhilHealth claim",
  philhealth_eligibility: "PhilHealth answer",
  doh_case_report: "DOH case report",
  communication: "Message",
  external_history: "Imported history",
  document: "Document",
  immunization: "Immunization",
  records_request: "Records request",
};

export interface TimelineFilters {
  groups: TimelineGroupKey[];
  from: string | null;
  to: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUP_KEYS = new Set<string>(TIMELINE_GROUPS.map((g) => g.key));

/** Reads the filters from the page's search params, dropping anything malformed. `to` before `from` is swapped. */
export function parseTimelineFilters(params: { groups?: string | string[]; from?: string | string[]; to?: string | string[] }): TimelineFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const raw = [params.groups].flat().filter((v): v is string => typeof v === "string");
  const wanted = new Set(raw.flatMap((v) => v.split(",")).filter((g) => GROUP_KEYS.has(g)));
  const groups = TIMELINE_GROUPS.map((g) => g.key).filter((k) => wanted.has(k));
  let from = one(params.from) ?? null;
  let to = one(params.to) ?? null;
  if (from && !DATE.test(from)) from = null;
  if (to && !DATE.test(to)) to = null;
  if (from && to && to < from) [from, to] = [to, from];
  return { groups, from, to };
}

/** The API query for the filters (kinds of the chosen groups; all kinds when none is chosen). */
export function timelineApiQuery(filters: TimelineFilters, limit?: number): Record<string, string | number | undefined> {
  const kinds = TIMELINE_GROUPS.filter((g) => filters.groups.includes(g.key)).flatMap((g) => g.kinds);
  return { kinds: kinds.length ? kinds.join(",") : undefined, from: filters.from ?? undefined, to: filters.to ?? undefined, limit };
}

/** The timeline page's URL with these filters. */
export function timelineHref(patientId: string, filters: TimelineFilters): string {
  const params = new URLSearchParams();
  if (filters.groups.length) params.set("groups", filters.groups.join(","));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return `/patients/${patientId}/timeline${query ? `?${query}` : ""}`;
}

/** The filters with one group switched on or off. */
export function toggleGroup(filters: TimelineFilters, group: TimelineGroupKey): TimelineFilters {
  const groups = filters.groups.includes(group) ? filters.groups.filter((g) => g !== group) : [...filters.groups, group];
  return { ...filters, groups: TIMELINE_GROUPS.map((g) => g.key).filter((k) => groups.includes(k)) };
}

/** A local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDateOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * The staff screen an entry opens, from existing routes only; null when there is none (messages, documents).
 * Appointments open the day's schedule of that practitioner, in the facility's time zone.
 */
export function entryHref(entry: PatientTimelineEntry, patientId: string, timeZone: string): string | null {
  const link = entry.link;
  if (!link) return null;
  switch (link.type) {
    case "encounter":
      return `/clinic/encounters/${link.id}`;
    case "telemedicine":
      return `/telemedicine/${link.id}`;
    case "referral":
      return `/clinic/referrals/${link.id}`;
    case "appointment": {
      const params = new URLSearchParams({ date: localDateOf(entry.occurredAt, timeZone) });
      if (entry.sourceIds.practitionerId) params.set("practitionerId", entry.sourceIds.practitionerId);
      return `/appointments?${params.toString()}`;
    }
    case "patient_laboratory":
      return `/patients/${patientId}#laboratory`;
    case "patient_external_history":
      return `/patients/${patientId}#external-history`;
    case "patient_immunizations":
      return `/patients/${patientId}/immunizations`;
    case "patient_record":
      return `/patients/${patientId}`;
    case "dental_record":
      return `/dental/patients/${link.id}`;
    case "care_plan":
      return `/clinic/care-plans/${link.id}`;
    case "invoice":
      return `/billing/invoices/${link.id}`;
    case "billing_account":
      return `/billing/patients/${link.id}`;
    case "doh_case_report":
      return `/reporting/${link.id}`;
    case "records_request":
      return `/records/requests/${link.id}`;
    default:
      return null;
  }
}

const MARKERS: Record<NonNullable<PatientTimelineEntry["marker"]>, string> = {
  entered_in_error: "Entered in error",
  cancelled: "Cancelled",
  void: "Void",
};

/** The label for a record that is not valid care, or null. */
export function markerLabel(entry: Pick<PatientTimelineEntry, "marker">): string | null {
  return entry.marker ? MARKERS[entry.marker] : null;
}

const STATUS: Record<string, { label: string; variant: Variant; tone: StatusTone }> = {
  // Appointments
  booked: { label: "Booked", variant: "info", tone: "waiting" },
  confirmed: { label: "Confirmed", variant: "info", tone: "waiting" },
  checked_in: { label: "Checked in", variant: "info", tone: "active" },
  no_show: { label: "No-show", variant: "warning", tone: "failed" },
  // Encounters
  in_progress: { label: "In progress", variant: "info", tone: "active" },
  "encounter:completed": { label: "Signed", variant: "success", tone: "done" },
  // Referrals
  "referral:sent": { label: "Sent", variant: "info", tone: "waiting" },
  // Prescriptions, care plans, laboratory
  active: { label: "Active", variant: "info", tone: "active" },
  superseded: { label: "Superseded", variant: "neutral", tone: "stopped" },
  released: { label: "Released", variant: "success", tone: "done" },
  completed: { label: "Completed", variant: "success", tone: "done" },
  draft: { label: "Draft", variant: "neutral", tone: "waiting" },
  on_hold: { label: "On hold", variant: "warning", tone: "stopped" },
  proposed: { label: "Proposed", variant: "neutral", tone: "waiting" },
  accepted: { label: "Accepted", variant: "success", tone: "done" },
  declined: { label: "Declined", variant: "neutral", tone: "stopped" },
  discontinued: { label: "Discontinued", variant: "neutral", tone: "stopped" },
  // Billing
  issued: { label: "Issued", variant: "info", tone: "done" },
  payment: { label: "Received", variant: "success", tone: "done" },
  refund: { label: "Refunded", variant: "warning", tone: "stopped" },
  // Communications
  queued: { label: "Queued", variant: "neutral", tone: "waiting" },
  sending: { label: "Sending", variant: "neutral", tone: "waiting" },
  sent: { label: "Sent", variant: "success", tone: "done" },
  delivered: { label: "Delivered", variant: "success", tone: "done" },
  failed: { label: "Not delivered", variant: "danger", tone: "failed" },
  suppressed: { label: "Not sent (preferences)", variant: "neutral", tone: "stopped" },
  // Immunizations
  "immunization:completed": { label: "Given", variant: "success", tone: "done" },
  "immunization:not_done": { label: "Not given", variant: "warning", tone: "stopped" },
  // Queue visits
  "queue_visit:waiting": { label: "Waiting", variant: "info", tone: "waiting" },
  "queue_visit:in_triage": { label: "In triage", variant: "info", tone: "active" },
  "queue_visit:awaiting_consultation": { label: "Awaiting consultation", variant: "info", tone: "waiting" },
  "queue_visit:in_consultation": { label: "In consultation", variant: "info", tone: "active" },
  "queue_visit:left_without_being_seen": { label: "Left without being seen", variant: "warning", tone: "stopped" },
  // Allergies and consents
  "allergy:inactive": { label: "Inactive", variant: "neutral", tone: "stopped" },
  "allergy:resolved": { label: "Resolved", variant: "neutral", tone: "done" },
  "consent:granted": { label: "Granted", variant: "success", tone: "done" },
  "consent:refused": { label: "Refused", variant: "warning", tone: "stopped" },
  "consent:withdrawn": { label: "Withdrawn", variant: "warning", tone: "stopped" },
  // Dispensing
  "dispense:recorded": { label: "Dispensed", variant: "success", tone: "done" },
  "dispense:reversed": { label: "Reversed", variant: "warning", tone: "stopped" },
  // Specimens and critical results
  "specimen:collected": { label: "Collected", variant: "info", tone: "done" },
  "specimen:received": { label: "Received", variant: "info", tone: "done" },
  "specimen:rejected": { label: "Rejected", variant: "danger", tone: "failed" },
  "critical_value:communicated": { label: "Awaiting acknowledgement", variant: "warning", tone: "waiting" },
  "critical_value:acknowledged": { label: "Acknowledged", variant: "success", tone: "done" },
  // Dental images shared in MyHealth
  "dental_imaging:shared": { label: "Shared", variant: "info", tone: "done" },
  "dental_imaging:withdrawn": { label: "Sharing withdrawn", variant: "neutral", tone: "stopped" },
  // Deposit and credit account
  "deposit:deposit": { label: "Received", variant: "success", tone: "done" },
  "deposit:application": { label: "Applied", variant: "info", tone: "done" },
  "deposit:release": { label: "Released", variant: "neutral", tone: "stopped" },
  "deposit:transfer_in": { label: "Moved in", variant: "neutral", tone: "done" },
  "deposit:transfer_out": { label: "Moved out", variant: "neutral", tone: "done" },
  // PhilHealth and DOH (the answer as recorded; the platform decides nothing)
  "philhealth_claim:rejected": { label: "Rejected", variant: "danger", tone: "failed" },
  "philhealth_claim:not_configured": { label: "Not sent", variant: "neutral", tone: "stopped" },
  "philhealth_claim:failed": { label: "Failed", variant: "danger", tone: "failed" },
  "philhealth_eligibility:queued": { label: "Inquiry sent", variant: "neutral", tone: "waiting" },
  "philhealth_eligibility:failed": { label: "Inquiry failed", variant: "danger", tone: "failed" },
  "doh_case_report:failed": { label: "Submission failed", variant: "danger", tone: "failed" },
  "philhealth_eligibility:eligible": { label: "Eligible", variant: "success", tone: "done" },
  "philhealth_eligibility:not_eligible": { label: "Not eligible", variant: "warning", tone: "stopped" },
  "philhealth_eligibility:undetermined": { label: "Undetermined", variant: "neutral", tone: "neutral" },
  "philhealth_eligibility:registered": { label: "Registered", variant: "success", tone: "done" },
  "philhealth_eligibility:not_registered": { label: "Not registered", variant: "warning", tone: "stopped" },
  "philhealth_eligibility:pending": { label: "Pending", variant: "neutral", tone: "waiting" },
  "philhealth_eligibility:unknown": { label: "Unknown", variant: "neutral", tone: "neutral" },
  "doh_case_report:pending_review": { label: "Awaiting review", variant: "warning", tone: "waiting" },
  "doh_case_report:reported": { label: "Reported", variant: "success", tone: "done" },
  "doh_case_report:dismissed": { label: "Dismissed", variant: "neutral", tone: "stopped" },
  "doh_case_report:rejected": { label: "Rejected", variant: "danger", tone: "failed" },
  // Records requests
  "records_request:submitted": { label: "Submitted", variant: "info", tone: "waiting" },
  "records_request:in_review": { label: "In review", variant: "info", tone: "active" },
  "records_request:fulfilled": { label: "Fulfilled", variant: "success", tone: "done" },
  "records_request:withdrawn": { label: "Withdrawn", variant: "neutral", tone: "stopped" },
};

/**
 * The status badge of an entry (label, colour and icon tone), or null when the status says nothing worth a badge
 * (a recorded exam, an available document) or the entry is marked as not valid (the marker is shown instead).
 */
export function entryStatus(entry: Pick<PatientTimelineEntry, "kind" | "status" | "marker">): { label: string; variant: Variant; tone: StatusTone } | null {
  if (!entry.status || entry.marker) return null;
  return STATUS[`${entry.kind}:${entry.status}`] ?? STATUS[entry.status] ?? null;
}

/** "Some records are not shown to you" when kinds were withheld (no counts, no kinds named). */
export function withheldNote(withheld: readonly string[]): string | null {
  return withheld.length ? "Some records are not shown to you because your role does not include access to them." : null;
}

/** Entries grouped by day (in list order, newest first), with the day label from `dayLabel`. */
export function groupByDay<T extends { occurredAt: string }>(
  entries: readonly T[],
  dayLabel: (iso: string) => string,
): Array<{ key: string; label: string; items: T[] }> {
  const days: Array<{ key: string; label: string; items: T[] }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.occurredAt);
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else days.push({ key: `${label}-${days.length}`, label, items: [entry] });
  }
  return days;
}

/** Appends a further page, dropping entries already shown (a page boundary never repeats, but be safe). */
export function appendPage<T extends { id: string }>(shown: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(shown.map((e) => e.id));
  return [...shown, ...next.filter((e) => !seen.has(e.id))];
}
