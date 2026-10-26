import type { PortalOutsideResultStatus, PortalRecordsKind, PortalRecordsRequestStatus, PortalRecordsScope, PortalReferral } from "./api/types";
import { formatCalendarDate } from "./greeting";

/** What a patient may ask copies of, in their words. */
export const SCOPE_TEXT: Record<PortalRecordsScope, string> = {
  consultations: "Consultation records",
  laboratory: "Laboratory results",
  prescriptions: "Prescriptions",
  dental: "Dental records",
  imaging: "X-rays and images",
  certificates: "Medical certificates",
  other: "Something else",
};

/** The kinds of request a patient may send, in their words (the rights of the Data Privacy Act, as the clinic answers them). */
export const KIND_TEXT: Record<PortalRecordsKind, { label: string; help: string; details: string }> = {
  access: { label: "Copies of my records", help: "The clinic shares copies with you here.", details: "Details" },
  rectification: {
    label: "Correct something in my records",
    help: "Say what is wrong and what it should be. The clinic checks and tells you what it changed.",
    details: "What is wrong, and what it should be",
  },
  erasure: {
    label: "Remove or block some of my data",
    help: "Say which data and why. Medical records may have to be kept by law; the clinic tells you what it can do.",
    details: "Which data, and why",
  },
  objection: {
    label: "Object to a use of my data",
    help: "Say which use you object to (for example reminders or outreach). You can also change your message settings and consents yourself.",
    details: "Which use, and why",
  },
};

export type RequestTone = "waiting" | "done" | "declined" | "closed";

export function requestState(status: PortalRecordsRequestStatus, kind: PortalRecordsKind = "access"): { tone: RequestTone; text: string } {
  switch (status) {
    case "submitted":
      return { tone: "waiting", text: "Sent — waiting for the records office" };
    case "in_review":
      return { tone: "waiting", text: "The records office is working on it" };
    case "fulfilled":
      return { tone: "done", text: kind === "access" ? "Answered — your copies are below" : "Answered — see what the clinic did below" };
    case "declined":
      return { tone: "declined", text: "Not granted — see the reason" };
    case "withdrawn":
      return { tone: "closed", text: "You withdrew this request" };
  }
}

export function requestOpen(status: PortalRecordsRequestStatus): boolean {
  return status === "submitted" || status === "in_review";
}

export type ReferralTone = "waiting" | "done" | "declined" | "closed";

/** Where a referral stands, in the patient's words (no clinical detail). */
export function referralState(status: PortalReferral["status"]): { tone: ReferralTone; text: string } {
  switch (status) {
    case "sent":
      return { tone: "waiting", text: "Sent — bring the letter when you go" };
    case "accepted":
      return { tone: "waiting", text: "Accepted by the doctor you were referred to" };
    case "completed":
      return { tone: "done", text: "Completed — your doctor has the outcome" };
    case "declined":
      return { tone: "declined", text: "Not accepted — your doctor will advise you" };
    case "cancelled":
      return { tone: "closed", text: "Cancelled by your doctor" };
  }
}

/** "October 1, 2026" for an instant: its calendar date in the clinic's time zone. */
export function issuedOn(iso: string, timeZone = "Asia/Manila"): string {
  return formatCalendarDate(new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso)));
}

export type OutsideResultTone = "waiting" | "done" | "declined" | "closed";

/** Where a result the patient sent stands, in their words. */
export function outsideResultState(status: PortalOutsideResultStatus): { tone: OutsideResultTone; text: string } {
  switch (status) {
    case "submitted":
      return { tone: "waiting", text: "Sent — waiting for the records office to read it" };
    case "filed":
      return { tone: "done", text: "Added to your record. Your doctor will read it at your next visit." };
    case "declined":
      return { tone: "declined", text: "The records office could not add it" };
    case "withdrawn":
      return { tone: "closed", text: "You took it back" };
  }
}

export const OUTSIDE_RESULT_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic"];
export const OUTSIDE_RESULT_MAX_BYTES = 10 * 1024 * 1024;

/** Why a file cannot be sent (null when it can). */
export function outsideResultFileProblem(file: { type: string; size: number }): string | null {
  if (file.size === 0) return "The file is empty.";
  if (!OUTSIDE_RESULT_FILE_TYPES.includes(file.type)) return "Send a PDF or a photo (JPEG, PNG or HEIC).";
  if (file.size > OUTSIDE_RESULT_MAX_BYTES) return "The file is larger than 10 MB. Send a smaller photo or a PDF.";
  return null;
}
