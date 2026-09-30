export const MESSAGE_TOPICS = ["general", "appointment", "results", "medication", "billing", "other"] as const;
export type MessageTopic = (typeof MESSAGE_TOPICS)[number];

export const THREAD_STATUSES = ["open", "closed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export type MessageSender = "patient" | "staff";

/** What a patient may have going at once, and how fast they may write, so the clinic's queue stays readable. */
export const MAX_OPEN_PATIENT_THREADS = 5;
export const MAX_PATIENT_MESSAGES_PER_HOUR = 10;
export const MESSAGE_BODY_MAX = 2000;
export const MESSAGE_SUBJECT_MAX = 100;

/** Shown wherever a patient writes: this is not a way to reach the clinic in an emergency. */
export const NOT_FOR_EMERGENCIES =
  "Messages are read during clinic hours, not all day, and are not for urgent problems. In an emergency call 911 or go to the nearest emergency room.";

/** The patient has not yet read the clinic's latest message. */
export function unreadByPatient(thread: { lastMessageFrom: MessageSender; lastMessageAt: Date; patientReadThrough: Date | null }): boolean {
  return thread.lastMessageFrom === "staff" && (!thread.patientReadThrough || thread.patientReadThrough < thread.lastMessageAt);
}

/** The conversation is waiting for the clinic: open, and the patient wrote last. */
export function awaitingClinic(thread: { status: ThreadStatus; lastMessageFrom: MessageSender }): boolean {
  return thread.status === "open" && thread.lastMessageFrom === "patient";
}

/**
 * Whether the clinic is told about a patient's message: the first message of a conversation, or one that follows the
 * clinic's own reply. Several messages in a row are one notice.
 */
export function shouldNotifyClinic(previousFrom: MessageSender | null): boolean {
  return previousFrom !== "patient";
}

export type ThreadQueueFilter = "awaiting" | "open" | "closed" | "all";

/** The clinic's queue: waiting conversations oldest first (longest wait on top), the rest newest first. */
export function compareForQueue(
  a: { status: ThreadStatus; lastMessageFrom: MessageSender; lastMessageAt: Date },
  b: { status: ThreadStatus; lastMessageFrom: MessageSender; lastMessageAt: Date },
): number {
  const aw = awaitingClinic(a);
  const bw = awaitingClinic(b);
  if (aw !== bw) return aw ? -1 : 1;
  return aw ? a.lastMessageAt.getTime() - b.lastMessageAt.getTime() : b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
}
