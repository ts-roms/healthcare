import type { MessageTopic, PatientThread } from "./api/types";

export const TOPIC_LABEL: Record<MessageTopic, string> = {
  general: "General question",
  appointment: "Appointment",
  results: "Test results",
  medication: "Medicines",
  billing: "Bill or payment",
  other: "Other",
};

export const TOPIC_OPTIONS = (Object.keys(TOPIC_LABEL) as MessageTopic[]).map((value) => ({ value, label: TOPIC_LABEL[value] }));

export const MESSAGE_VIEWS = [
  { key: "awaiting", label: "Waiting for us" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;
export type MessageView = (typeof MESSAGE_VIEWS)[number]["key"];

export function messageView(value: string | undefined): MessageView {
  return MESSAGE_VIEWS.find((v) => v.key === value)?.key ?? "awaiting";
}

/** Status of a conversation for the clinic: colour, icon-worthy word and text, never colour alone. */
export function threadStatus(thread: Pick<PatientThread, "status" | "awaitingClinic">): { label: string; variant: "warning" | "success" | "neutral" } {
  if (thread.status === "closed") return { label: "Closed", variant: "neutral" };
  return thread.awaitingClinic ? { label: "Waiting for reply", variant: "warning" } : { label: "Replied", variant: "success" };
}

/** The response target of a conversation waiting for the clinic, in words; null when there is none or it is answered. */
export function dueState(
  thread: Pick<PatientThread, "responseDueAt" | "overdue" | "awaitingClinic">,
  now = new Date(),
): { label: string; overdue: boolean } | null {
  if (!thread.awaitingClinic || !thread.responseDueAt) return null;
  if (thread.overdue) return { label: `${overdueBy(thread.responseDueAt, now)} past target`, overdue: true };
  return { label: `due in ${overdueBy(thread.responseDueAt, now, true)}`, overdue: false };
}

function overdueBy(dueAt: string, now: Date, ahead = false): string {
  const minutes = Math.max(0, Math.round(((ahead ? 1 : -1) * (new Date(dueAt).getTime() - now.getTime())) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Whether a file may be attached to a MyHealth message by the clinic (images and PDFs, at most 10 MB; the API checks too). */
export const MESSAGE_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/heic", "application/pdf"] as const;
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MESSAGE_ATTACHMENTS_MAX = 3;

export function attachmentProblem(files: Array<{ type: string; size: number }>): string | null {
  if (files.length > MESSAGE_ATTACHMENTS_MAX) return `At most ${MESSAGE_ATTACHMENTS_MAX} files with one message.`;
  for (const file of files) {
    if (!(MESSAGE_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return "Only JPEG, PNG or HEIC images and PDF files can be sent.";
    if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) return "Each file must be 10 MB or smaller.";
  }
  return null;
}

/** A file size in words. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How long a conversation has waited, in words ("2 days", "3 hours", "under an hour"). */
export function waitingFor(lastMessageAt: string, now = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(lastMessageAt).getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
