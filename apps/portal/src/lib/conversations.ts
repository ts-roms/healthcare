import type { MessageTopic, PortalThread } from "./api/types";

export const TOPICS: readonly { value: MessageTopic; label: string }[] = [
  { value: "general", label: "A general question" },
  { value: "appointment", label: "My appointment" },
  { value: "results", label: "My test results" },
  { value: "medication", label: "My medicines" },
  { value: "billing", label: "A bill or payment" },
  { value: "other", label: "Something else" },
];

export const TOPIC_LABEL: Record<MessageTopic, string> = Object.fromEntries(TOPICS.map((t) => [t.value, t.label])) as Record<MessageTopic, string>;

export const BODY_MAX = 2000;
export const SUBJECT_MAX = 100;

/** Files a patient may send with a message: photos and PDFs, 10 MB each, three with one message, ten a day (the API checks too). */
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/heic", "application/pdf"] as const;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_MAX = 3;

export function attachmentProblem(files: Array<{ type: string; size: number }>): string | null {
  if (files.length > ATTACHMENTS_MAX) return `You can send up to ${ATTACHMENTS_MAX} files with one message.`;
  for (const file of files) {
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return "Only photos (JPEG, PNG, HEIC) and PDF files can be sent.";
    if (file.size > ATTACHMENT_MAX_BYTES) return "Each file must be 10 MB or smaller.";
  }
  return null;
}

/** A file size in words. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shown wherever the patient writes: this is not a way to reach the clinic in an emergency. */
export const NOT_FOR_EMERGENCIES =
  "Messages are read during clinic hours, not all day, and are not for urgent problems. In an emergency call 911 or go to the nearest emergency room.";

/** Where a conversation stands, in the patient's words. */
export function threadState(thread: Pick<PortalThread, "status" | "lastMessageFrom" | "unread">): string {
  if (thread.status === "closed") return "Closed";
  if (thread.unread) return "New reply";
  return thread.lastMessageFrom === "patient" ? "Waiting for the clinic" : "Replied";
}

/** Messages for the API's refusals, in the patient's words. */
export function conversationMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "too_many_open_threads":
      return "You already have several open conversations. Wait for the clinic to answer one, then start a new one.";
    case "message_rate_limited":
      return "You have sent many messages in the last hour. Try again later, or call the clinic.";
    case "thread_closed":
      return "The clinic closed this conversation. Start a new message if you still need help.";
    case "messaging_not_available":
      return "Messages cannot be sent from this record. Please call the clinic.";
    case "upload_rate_limited":
      return "You have sent many files today. Try again tomorrow, or call the clinic.";
    case "upload_quarantined":
      return "One of the files could not be accepted because it may be unsafe. Remove it and try again, or call the clinic.";
    case "scan_unavailable":
      return "Files cannot be checked right now. Try again in a few minutes, or send your message without the file.";
    case "attachment_not_allowed":
      return "One of the files could not be attached. Remove it and try again.";
    case "storage_upload_failed":
      return "A file could not be uploaded. Check your connection and try again.";
    default:
      return fallback;
  }
}

export function charactersLeft(text: string, max = BODY_MAX): number {
  return max - text.length;
}
