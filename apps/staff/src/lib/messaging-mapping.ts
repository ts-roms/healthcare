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

/** How long a conversation has waited, in words ("2 days", "3 hours", "under an hour"). */
export function waitingFor(lastMessageAt: string, now = new Date()): string {
  const hours = Math.floor((now.getTime() - new Date(lastMessageAt).getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
