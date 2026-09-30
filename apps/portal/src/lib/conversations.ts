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
    default:
      return fallback;
  }
}

export function charactersLeft(text: string, max = BODY_MAX): number {
  return max - text.length;
}
