import { RECORD_COPY_SECTIONS, type RecordCopySection, type RecordsRequestScope, type RecordsRequestStatus } from "./records-request.schema";

/** Open requests a patient may have at once (a new one waits until the records office answers or they withdraw one). */
export const MAX_OPEN_RECORDS_REQUESTS = 3;

export function recordsRequestOpen(status: RecordsRequestStatus): boolean {
  return status === "submitted" || status === "in_review";
}

/** Days since a request was submitted (the records office sees the age; no response deadline is encoded). */
export function daysWaiting(submittedAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / 86_400_000));
}

const SECTIONS_FOR_SCOPE: Record<RecordsRequestScope, RecordCopySection[]> = {
  consultations: ["allergies", "consultations", "care_plans"],
  laboratory: ["laboratory"],
  prescriptions: ["prescriptions"],
  dental: ["dental"],
  imaging: ["documents"],
  certificates: ["certificates"],
  // Whatever else the patient described: the records office chooses.
  other: [],
};

/** The sections a copy of the record starts from for what the patient asked (the records office may change them). */
export function copySectionsForScope(scope: readonly RecordsRequestScope[]): RecordCopySection[] {
  const wanted = new Set(scope.flatMap((s) => SECTIONS_FOR_SCOPE[s] ?? []));
  return RECORD_COPY_SECTIONS.filter((s) => wanted.has(s));
}
