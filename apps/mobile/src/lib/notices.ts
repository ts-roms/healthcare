import type { Notice } from "./types";

export function unreadCount(notices: readonly Notice[]): number {
  return notices.filter((n) => n.readAt === null).length;
}

/** "Today, 9:30 AM", "Yesterday, 4:05 PM", "Mar 3, 9:30 AM": in the clinic's time zone, not the phone's. */
export function noticeTime(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const zone = validZone(timeZone);
  const time = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(at);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).format(d);
  if (day(at) === day(now)) return `Today, ${time}`;
  if (day(at) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  const date = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: zone }).format(at);
  return `${date}, ${time}`;
}

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return "Asia/Manila";
  }
}
