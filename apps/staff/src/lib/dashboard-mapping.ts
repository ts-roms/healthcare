import type { AttentionItem } from "@healthcare/ui/healthcare";
import type { ClinicDashboard, DueCareActivity, LabQualitySummary } from "./api/types";

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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Laboratory quality: what the quality manager should look at, from GET /laboratory/quality/summary. Critical when
 * patient results or specimens are at stake now (results refused, a unit out of range, a critical nonconformance).
 */
export function qualityAttentionItems(q: LabQualitySummary): AttentionItem[] {
  const items: AttentionItem[] = [];
  const nc = q.nonconformances;
  if (nc.open) {
    items.push({
      id: "quality-nc",
      severity: nc.critical ? "critical" : nc.major ? "warning" : "info",
      count: nc.open,
      title: "Open nonconformances",
      detail: [
        nc.critical ? `${nc.critical} critical` : null,
        nc.major ? `${nc.major} major` : null,
        nc.investigating ? `${nc.investigating} under investigation` : null,
      ]
        .filter(Boolean)
        .join(", "),
      href: "/laboratory/nonconformances",
    });
  }
  if (q.qc.resultsBlocked) {
    items.push({
      id: "quality-qc-blocked",
      severity: "critical",
      count: q.qc.resultsBlocked,
      title: "Tests that cannot take patient results now",
      detail: "QC, instrument status or an expired reagent lot",
      href: "/laboratory/qc",
    });
  }
  if (q.qc.rejected || q.qc.missing) {
    items.push({
      id: "quality-qc",
      severity: q.qc.rejected ? "warning" : "info",
      count: q.qc.rejected + q.qc.missing,
      title: "QC to review",
      detail: [q.qc.rejected ? `${q.qc.rejected} rejected` : null, q.qc.missing ? `${q.qc.missing} not run in the window` : null].filter(Boolean).join(", "),
      href: "/laboratory/qc",
    });
  }
  if (q.temperatures.outOfRangeNow) {
    items.push({
      id: "quality-temp-out",
      severity: "critical",
      count: q.temperatures.outOfRangeNow,
      title: "Storage units out of range at the last reading",
      href: "/laboratory/temperatures",
    });
  }
  if (q.temperatures.readingsDue) {
    items.push({
      id: "quality-temp-due",
      severity: "warning",
      count: q.temperatures.readingsDue,
      title: "Temperature readings due",
      href: "/laboratory/temperatures",
    });
  }
  if (q.instruments.outOfService || q.instruments.calibrationOverdue) {
    items.push({
      id: "quality-instruments",
      severity: q.instruments.calibrationOverdue ? "warning" : "info",
      count: q.instruments.outOfService + q.instruments.calibrationOverdue,
      title: "Instruments",
      detail: [
        q.instruments.calibrationOverdue ? `${q.instruments.calibrationOverdue} calibration overdue` : null,
        q.instruments.outOfService ? `${q.instruments.outOfService} out of service` : null,
      ]
        .filter(Boolean)
        .join(", "),
      href: "/laboratory/instruments",
    });
  }
  if (q.reagents.low) {
    items.push({
      id: "quality-reagents-low",
      severity: "warning",
      count: q.reagents.low,
      title: "Reagent lots running low",
      detail: "a tenth of their tests or less left",
      href: "/laboratory/reagents",
    });
  }
  if (q.eqa.overdue || q.eqa.awaitingEvaluation) {
    items.push({
      id: "quality-eqa",
      severity: q.eqa.overdue ? "warning" : "info",
      count: q.eqa.overdue + q.eqa.awaitingEvaluation,
      title: "Proficiency testing",
      detail: [
        q.eqa.overdue ? `${plural(q.eqa.overdue, "round", "rounds")} past due, nothing reported` : null,
        q.eqa.awaitingEvaluation ? `${plural(q.eqa.awaitingEvaluation, "round", "rounds")} awaiting the provider's evaluation` : null,
      ]
        .filter(Boolean)
        .join(", "),
      href: "/laboratory/eqa",
    });
  }
  const c = q.competency;
  // Unassessed staff matter only when result entry depends on it.
  const competency = c.due + c.notYetCompetent + (c.required ? c.staffNotAssessed : 0);
  if (competency) {
    items.push({
      id: "quality-competency",
      severity: c.required ? "warning" : "info",
      count: competency,
      title: "Staff competency",
      detail: [
        c.due ? `${plural(c.due, "reassessment", "reassessments")} due` : null,
        c.notYetCompetent ? `${c.notYetCompetent} not yet competent` : null,
        c.required && c.staffNotAssessed ? `${plural(c.staffNotAssessed, "person", "people")} not assessed` : null,
      ]
        .filter(Boolean)
        .join(", "),
      href: "/laboratory/competency",
    });
  }
  return items;
}
