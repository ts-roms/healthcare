import type { PortalRecordsRequestStatus, PortalRecordsScope } from "./api/types";

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

export type RequestTone = "waiting" | "done" | "declined" | "closed";

export function requestState(status: PortalRecordsRequestStatus): { tone: RequestTone; text: string } {
  switch (status) {
    case "submitted":
      return { tone: "waiting", text: "Sent — waiting for the records office" };
    case "in_review":
      return { tone: "waiting", text: "The records office is working on it" };
    case "fulfilled":
      return { tone: "done", text: "Answered — your copies are below" };
    case "declined":
      return { tone: "declined", text: "Not granted — see the reason" };
    case "withdrawn":
      return { tone: "closed", text: "You withdrew this request" };
  }
}

export function requestOpen(status: PortalRecordsRequestStatus): boolean {
  return status === "submitted" || status === "in_review";
}
