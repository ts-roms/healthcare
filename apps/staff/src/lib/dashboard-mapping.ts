import type { AttentionItem } from "@healthcare/ui/healthcare";
import type { ClinicDashboard, DueCareActivity } from "./api/types";

/**
 * Clinic dashboard: what needs attention now, from the API's facility
 * snapshot. Thresholds are operational (queue flow), not clinical rules.
 */

/** Same threshold the queue board highlights waits at. */
export const LONG_WAIT_MINUTES = 45;

export function minutesLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function attentionItems(
  d: ClinicDashboard,
  options: { due: DueCareActivity[] | null; canOpenEncounters: boolean; canOpenQueue: boolean },
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const longest = d.queue.longestCurrentWaitMinutes;
  if (longest !== null && longest > LONG_WAIT_MINUTES) {
    items.push({
      id: "long-wait",
      severity: "warning",
      title: "Long wait in the queue",
      detail: `Longest current wait ${minutesLabel(longest)}`,
      href: options.canOpenQueue ? "/queue" : undefined,
    });
  }
  if (d.encounters.inProgress > 0) {
    items.push({
      id: "unsigned",
      severity: "warning",
      count: d.encounters.inProgress,
      title: d.encounters.inProgress === 1 ? "Unsigned encounter" : "Unsigned encounters",
      detail: "Consultations still in progress at this facility",
      href: options.canOpenEncounters ? "/clinic/encounters" : undefined,
    });
  }
  if (d.queue.walkedOut > 0) {
    items.push({
      id: "lwbs",
      severity: "info",
      count: d.queue.walkedOut,
      title: "Left without being seen today",
      detail: "Consider a call-back",
      href: options.canOpenQueue ? "/queue" : undefined,
    });
  }
  if (options.due) {
    const overdue = options.due.filter((a) => a.overdue);
    if (overdue.length) {
      items.push({
        id: "overdue",
        severity: "warning",
        count: overdue.length,
        title: "Overdue care-plan activities",
        detail: summarize(overdue),
        // Whoever can read the due list can open the recall list.
        href: "/clinic/care-plans",
      });
    }
    const dueSoon = options.due.length - overdue.length;
    if (dueSoon > 0) items.push({ id: "due", severity: "info", count: dueSoon, title: "Care-plan activities due this week", href: "/clinic/care-plans" });
  }
  return items;
}

function summarize(activities: DueCareActivity[]): string {
  const byPlan = new Map<string, number>();
  for (const a of activities) byPlan.set(a.planTitle, (byPlan.get(a.planTitle) ?? 0) + 1);
  return [...byPlan.entries()]
    .slice(0, 3)
    .map(([title, n]) => (n > 1 ? `${title} ×${n}` : title))
    .join(", ");
}
