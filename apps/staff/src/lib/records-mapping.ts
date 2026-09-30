import type { RecordCopySection, RecordsRequestScope, RecordsRequestStatus } from "./api/types";

export const RECORDS_SCOPE_LABEL: Record<RecordsRequestScope, string> = {
  consultations: "Consultation records",
  laboratory: "Laboratory results",
  prescriptions: "Prescriptions",
  dental: "Dental records",
  imaging: "X-rays and images",
  certificates: "Medical certificates",
  other: "Other",
};

/** The sections a copy of the record may contain, in the copy's order. */
export const RECORD_COPY_SECTIONS: Array<{ key: RecordCopySection; label: string; hint: string }> = [
  { key: "allergies", label: "Allergies", hint: "The current list, whatever the period" },
  { key: "consultations", label: "Consultations", hint: "Signed notes, diagnoses and vital signs" },
  { key: "laboratory", label: "Laboratory results", hint: "Released results only" },
  { key: "prescriptions", label: "Prescriptions", hint: "Including cancelled and replaced ones, marked" },
  { key: "care_plans", label: "Care plans", hint: "Goals and activities" },
  { key: "dental", label: "Dental treatment", hint: "Procedures done and treatment plans" },
  { key: "certificates", label: "Medical certificates", hint: "A list; each certificate is its own document" },
  { key: "documents", label: "Documents on file", hint: "A list; share the files themselves separately" },
  { key: "immunizations", label: "Immunizations", hint: "Doses given, not given, reported and imported" },
];

/** The chosen sections in the copy's order (the API orders them the same way). */
export function orderedCopySections(chosen: Iterable<RecordCopySection>): RecordCopySection[] {
  const set = new Set(chosen);
  return RECORD_COPY_SECTIONS.map((s) => s.key).filter((k) => set.has(k));
}

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

/** Document categories, as the retention settings name them (the API's categories). */
export const DOCUMENT_CATEGORY_LABEL: Record<string, string> = {
  consent_form: "Consent forms",
  identification: "Identification",
  medical_certificate: "Medical certificates",
  laboratory_report: "Laboratory reports",
  imaging: "X-rays and images",
  referral_letter: "Referral letters",
  prescription: "Prescriptions",
  clinical_attachment: "Clinical attachments",
  billing: "Billing documents",
  other: "Other documents",
  record_copy: "Copies of the record",
};
