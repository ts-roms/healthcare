import type { RecordsRequestStatus } from "./records-request.schema";

/** Open requests a patient may have at once (a new one waits until the records office answers or they withdraw one). */
export const MAX_OPEN_RECORDS_REQUESTS = 3;

export function recordsRequestOpen(status: RecordsRequestStatus): boolean {
  return status === "submitted" || status === "in_review";
}

/** Days since a request was submitted (the records office sees the age; no response deadline is encoded). */
export function daysWaiting(submittedAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / 86_400_000));
}
