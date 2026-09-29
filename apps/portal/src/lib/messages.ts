import type { PortalMessage } from "./api/types";

/** Where a message invites the patient to go next (the message itself never carries results or clinical detail). */
export function messageAction(message: Pick<PortalMessage, "templateKey">): { href: string; label: string } | null {
  switch (message.templateKey) {
    case "lab.results-available":
      return { href: "/results", label: "See your results" };
    case "dental.record-update":
      return { href: "/dental", label: "See your dental record" };
    case "records.update":
      return { href: "/documents", label: "See your documents" };
    case "appointment.self-service":
    case "appointment.reminder":
      return { href: "/appointments", label: "See your visits" };
    case "appointment.no-show":
    case "care-plan.follow-up-due":
      return { href: "/appointments/book", label: "Book a visit" };
    default:
      return null;
  }
}

/** Who a message is from, in the patient's words. */
export function messageSource(message: Pick<PortalMessage, "templateKey">): string {
  if (message.templateKey === "clinic.message") return "From your clinic";
  if (message.templateKey.startsWith("lab.")) return "Laboratory";
  if (message.templateKey.startsWith("care-plan.")) return "Your care plan";
  if (message.templateKey.startsWith("records.")) return "Records office";
  return "Visits";
}

/** "Today, 9:30 AM", "Yesterday, 4:05 PM" or "Sep 20, 2026" — in the patient's clinic's time zone. */
export function messageTime(createdAt: string, tz: string, now = new Date()): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const at = new Date(createdAt);
  const time = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(at);
  if (day(at) === day(now)) return `Today, ${time}`;
  if (day(at) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: tz }).format(at);
}
