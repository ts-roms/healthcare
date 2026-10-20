import type { PatientDetail, QueueVisit, VisitStatus } from "@/lib/api/types";

/** The sections of the patient record, in order. The first is the default; each is a `?tab=` value. */
export const PROFILE_TABS = [
  { key: "overview", label: "Overview" },
  { key: "clinical", label: "Clinical" },
  { key: "visits", label: "Visits" },
  { key: "labs", label: "Labs" },
  { key: "coverage", label: "Coverage" },
  { key: "portal", label: "Consent & portal" },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]["key"];

/** A tab from the address; anything unknown, repeated or missing is the overview. */
export function parseProfileTab(value: string | string[] | undefined): ProfileTab {
  const one = Array.isArray(value) ? value[0] : value;
  return PROFILE_TABS.find((t) => t.key === one)?.key ?? "overview";
}

export interface RecordCheck {
  key: string;
  /** What is missing, in the words a registrar would use. */
  missing: string;
  done: boolean;
}

export interface RecordCompleteness {
  percent: number;
  done: number;
  total: number;
  /** What is still to ask, in order. */
  missing: string[];
}

/**
 * How much of the registration details are filled in. This is a prompt for the front desk, not a clinical or legal rule: it
 * counts the facts a registrar can ask for at the desk, each once, and says which are missing. Nothing is derived from clinical
 * data, so the figure is the same for every viewer who may open the record.
 */
export function recordCompleteness(
  p: Pick<
    PatientDetail,
    "birthDateIsEstimated" | "civilStatus" | "nationality" | "occupation" | "contacts" | "addresses" | "identifiers" | "relationships" | "consents"
  >,
): RecordCompleteness {
  const checks: RecordCheck[] = [
    { key: "birth", missing: "Exact date of birth", done: !p.birthDateIsEstimated },
    { key: "civil", missing: "Civil status", done: Boolean(p.civilStatus) },
    { key: "nationality", missing: "Nationality", done: Boolean(p.nationality) },
    { key: "occupation", missing: "Occupation", done: Boolean(p.occupation) },
    { key: "mobile", missing: "Mobile number", done: p.contacts.some((c) => c.system === "mobile" && c.value.trim() !== "") },
    { key: "address", missing: "Address", done: p.addresses.length > 0 },
    { key: "emergency", missing: "Emergency contact", done: p.relationships.some((r) => r.isEmergencyContact || r.isLegalGuardian) },
    { key: "identifier", missing: "An ID (PhilHealth PIN, PhilSys, HMO)", done: p.identifiers.length > 0 },
    { key: "consent", missing: "Consent decision", done: p.consents.length > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    done,
    total: checks.length,
    missing: checks.filter((c) => !c.done).map((c) => c.missing),
  };
}

const OPEN_STATUSES: readonly VisitStatus[] = ["waiting", "in_triage", "awaiting_consultation", "in_consultation"];

/** A visit that is still in the queue (not finished, cancelled or left). */
export function isOpenVisit(status: VisitStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * The patient's visits still open, split by the queue day: today's (what the header shows) and those from an earlier day that
 * nobody closed (what the banner asks to be closed). Newest first within each.
 */
export function splitOpenVisits<T extends Pick<QueueVisit, "status" | "queueDate" | "checkedInAt">>(
  visits: readonly T[],
  today: string,
): { today: T[]; earlier: T[] } {
  const open = visits.filter((v) => isOpenVisit(v.status)).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
  return { today: open.filter((v) => v.queueDate === today), earlier: open.filter((v) => v.queueDate < today) };
}

/** How a visit left open from an earlier day can be closed from the record; a consultation under way is closed by signing it. */
export function closeOptionsFor(status: VisitStatus): Array<{ value: "left_without_being_seen" | "cancelled"; label: string }> {
  if (status === "in_consultation") return [];
  const options: Array<{ value: "left_without_being_seen" | "cancelled"; label: string }> = [
    { value: "left_without_being_seen", label: "Patient left without being seen" },
  ];
  // The queue only cancels a visit that has not started triage.
  if (status === "waiting") options.push({ value: "cancelled", label: "Checked in by mistake (cancel)" });
  return options;
}
