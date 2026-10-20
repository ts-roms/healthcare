import type { AttentionItem } from "@healthcare/ui/healthcare";
import type {
  AppointmentItem,
  ClinicDashboard,
  ClinicLoadDay,
  DueCareActivity,
  LabCriticalAlert,
  LabDashboard,
  LabQualitySummary,
  PractitionerDetail,
  QueueVisit,
} from "./api/types";
import { queueFigures, shiftDate, WAIT_LONG_MINUTES } from "./clinic-mapping";
import { attentionItems, qualityAttentionItems } from "./dashboard-mapping";

/**
 * What the dashboard says today: the rows of "Needs attention" (with the group each belongs to), the next appointments, how
 * busy each day is, the week's bars and the figures in the tiles. Everything is derived from what the API already answers;
 * the thresholds are how the screen is drawn, not rules of the API.
 */

// ---- Needs attention ---------------------------------------------------------------------------------------------------

export type AttentionGroup = "patients" | "lab" | "setup";
export type AttentionTone = "urgent" | "soon" | "info" | "setup";

export interface AttentionRow {
  id: string;
  group: AttentionGroup;
  tone: AttentionTone;
  title: string;
  detail?: string;
  action?: { label: string; href: string };
}

export const ATTENTION_TAG: Record<AttentionTone, string> = { urgent: "Urgent", soon: "Soon", info: "Info", setup: "Setup" };

const TONE_ORDER: Record<AttentionTone, number> = { urgent: 0, soon: 1, info: 2, setup: 3 };

/** Urgent first, then soon, info and set-up; rows of the same tone keep the order they were built in. */
export function sortAttention(rows: readonly AttentionRow[]): AttentionRow[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => TONE_ORDER[a.row.tone] - TONE_ORDER[b.row.tone] || a.i - b.i)
    .map(({ row }) => row);
}

function rowOf(item: AttentionItem, group: AttentionGroup, actionLabel: string): AttentionRow {
  return {
    id: item.id,
    group,
    tone: item.severity === "critical" ? "urgent" : item.severity === "warning" ? "soon" : "info",
    title: item.count && item.count > 1 ? `${item.title} · ${item.count}` : item.title,
    detail: item.detail,
    action: item.href ? { label: actionLabel, href: item.href } : undefined,
  };
}

const PATIENT_ACTION: Record<string, string> = { "long-wait": "Call now", unsigned: "Review", lwbs: "Open queue", overdue: "Open list", due: "Open list" };

/**
 * The patients' side: the queue, unsigned consultations, patients who left and care-plan activities. A wait of
 * `WAIT_LONG_MINUTES` or more names the patient and the ticket, from the visits on the queue when the viewer may see them.
 */
export function patientAttentionRows(input: {
  dashboard: ClinicDashboard;
  due: DueCareActivity[] | null;
  visits: readonly QueueVisit[] | null;
  canOpenEncounters: boolean;
  canOpenQueue: boolean;
  now: Date;
}): AttentionRow[] {
  const rows = attentionItems(input.dashboard, { due: input.due, canOpenEncounters: input.canOpenEncounters, canOpenQueue: input.canOpenQueue }).map((item) =>
    rowOf(item, "patients", PATIENT_ACTION[item.id] ?? "Open"),
  );
  const longest = input.visits ? queueFigures(input.visits, input.now).longestWait : null;
  if (!longest || longest.minutes < WAIT_LONG_MINUTES) return rows;
  const named: AttentionRow = {
    id: "long-wait",
    group: "patients",
    tone: "urgent",
    title: `${longest.patientName} waiting ${longest.minutes} min${longest.priority === "routine" ? "" : ` (${longest.priority} priority)`}`,
    detail: `Waiting room · ticket ${longest.ticket}`,
    action: input.canOpenQueue ? { label: "Call now", href: "/queue" } : undefined,
  };
  return [named, ...rows.filter((r) => r.id !== "long-wait")];
}

/** The laboratory's side: critical results, tests past their turnaround, samples not yet collected and the quality system. */
export function labAttentionRows(input: {
  dashboard: LabDashboard | null;
  criticals: readonly LabCriticalAlert[];
  quality: LabQualitySummary | null;
  canOpenWorkbench: boolean;
}): AttentionRow[] {
  const workbench = input.canOpenWorkbench ? "/laboratory/worklist" : undefined;
  const rows: AttentionRow[] = [];
  if (input.criticals.length) {
    rows.push(
      rowOf(
        {
          id: "lab-critical",
          severity: "critical",
          count: input.criticals.length,
          title: "Critical results not yet acknowledged",
          detail: input.criticals
            .slice(0, 3)
            .map((c) => `${c.testName} — ${c.patient?.patientNumber ?? "patient"}`)
            .join(", "),
          href: "/laboratory/critical",
        },
        "lab",
        "Acknowledge",
      ),
    );
  }
  if (input.dashboard?.overdue) {
    rows.push(
      rowOf(
        { id: "lab-overdue", severity: "warning", count: input.dashboard.overdue, title: "Tests past their turnaround time", href: workbench },
        "lab",
        "Open lab",
      ),
    );
  }
  const toCollect = input.dashboard?.pendingCollection ?? 0;
  if (toCollect > 0) {
    rows.push({
      id: "lab-collect",
      group: "lab",
      tone: "soon",
      title: `${toCollect} lab ${toCollect === 1 ? "sample" : "samples"} not yet collected`,
      detail: "Ordered and waiting to be collected",
      action: workbench ? { label: "Open lab", href: `${workbench}?stage=collect` } : undefined,
    });
  }
  if (input.quality) {
    for (const item of qualityAttentionItems(input.quality)) {
      // A licence that was never recorded is set-up work, listed under Setup.
      if (item.id === "quality-licence" && input.quality.licence.state === "missing") continue;
      rows.push(rowOf(item, "lab", "Open"));
    }
  }
  return rows;
}

const SETUP: Pick<AttentionRow, "group" | "tone"> = { group: "setup", tone: "setup" };

/** Names for a sentence: "Dr. A", "Dr. A and Dr. B", "Dr. A, Dr. B and Dr. C", then "and 2 more". */
function nameList(names: readonly string[]): string {
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/**
 * What is not set up yet: a laboratory licence that was never recorded and active practitioners without a staff account
 * (they cannot document or prescribe) or without a licence number (printed on certificates and referrals). One row per
 * kind: the practitioner by name when there is one, otherwise the count with the first names.
 */
export function setupAttentionRows(input: { practitioners: readonly PractitionerDetail[] | null; quality: LabQualitySummary | null }): AttentionRow[] {
  const rows: AttentionRow[] = [];
  if (input.quality?.licence.state === "missing") {
    rows.push({
      id: "setup-lab-licence",
      ...SETUP,
      title: "Laboratory licence not recorded",
      detail: "Record it so its expiry can be tracked",
      action: { label: "Add licence", href: "/laboratory/licence" },
    });
  }
  const active = (input.practitioners ?? []).filter((p) => p.status === "active");
  const kinds: Array<{ id: string; missing: PractitionerDetail[]; one: string; many: string; detail: string; action: string }> = [
    {
      id: "setup-account",
      missing: active.filter((p) => !p.userId),
      one: "has no staff account",
      many: "have no staff account",
      detail: "Can't document or prescribe",
      action: "Link account",
    },
    {
      id: "setup-licence",
      missing: active.filter((p) => !p.licenseNumber),
      one: "has no licence number recorded",
      many: "have no licence number recorded",
      detail: "Printed on medical certificates and referral letters",
      action: "Add licence",
    },
  ];
  for (const kind of kinds) {
    const [first] = kind.missing;
    if (!first) continue;
    rows.push(
      kind.missing.length === 1
        ? {
            id: kind.id,
            ...SETUP,
            title: `${first.displayName} ${kind.one}`,
            detail: kind.detail,
            action: { label: kind.action, href: `/doctors/${first.id}` },
          }
        : {
            id: kind.id,
            ...SETUP,
            title: `${kind.missing.length} practitioners ${kind.many}`,
            detail: nameList(kind.missing.map((p) => p.displayName)),
            action: { label: "Review", href: "/doctors" },
          },
    );
  }
  return rows;
}

// ---- Next up -----------------------------------------------------------------------------------------------------------

export interface NextUpRow {
  id: string;
  patientId: string;
  /** "10:15" in the facility's zone. */
  time: string;
  patientName: string;
  provider: string;
  reason: string;
  status: "checked_in" | "late" | "expected";
  lateMinutes: number;
}

const timeIn = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));

/**
 * Appointments that have not ended yet, soonest first: checked in, late (booked or confirmed and the time has passed) or
 * still expected.
 */
export function nextUpRows(
  items: readonly AppointmentItem[],
  now: Date,
  timeZone: string,
  names: { practitioner: (id: string) => string; visitType: (id: string) => string | undefined },
  limit = 5,
): NextUpRow[] {
  return items
    .filter((a) => (a.status === "booked" || a.status === "confirmed" || a.status === "checked_in") && Date.parse(a.endsAt) >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit)
    .map((a) => {
      const late = a.status === "checked_in" ? 0 : Math.floor((now.getTime() - Date.parse(a.startsAt)) / 60_000);
      return {
        id: a.id,
        patientId: a.patientId,
        time: timeIn(a.startsAt, timeZone),
        patientName: a.patient?.displayName ?? "Patient",
        provider: names.practitioner(a.practitionerId),
        reason: a.reason ?? names.visitType(a.visitTypeId) ?? "Appointment",
        status: a.status === "checked_in" ? "checked_in" : late >= 1 ? "late" : "expected",
        lateMinutes: Math.max(0, late),
      };
    });
}

// ---- The month and the week --------------------------------------------------------------------------------------------

export type LoadLevel = "none" | "light" | "busy" | "full";

/** From this share of a day's slots held, a day is drawn as busy and as nearly full. Display thresholds only. */
export const LOAD_BUSY_FROM = 0.4;
export const LOAD_FULL_FROM = 0.8;

/** How full a day is: no schedule and no booking is `none`; bookings beyond the schedule count as full. */
export function loadLevel(day: Pick<ClinicLoadDay, "booked" | "slots">): LoadLevel {
  if (day.slots === 0) return day.booked > 0 ? "full" : "none";
  const share = day.booked / day.slots;
  return share >= LOAD_FULL_FROM ? "full" : share >= LOAD_BUSY_FROM ? "busy" : "light";
}

/** The Monday on or before a date. */
export function weekStartOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, dow === 0 ? -6 : 1 - dow);
}

export interface WeekBar {
  date: string;
  /** "Mon", or "Today". */
  label: string;
  count: number;
  today: boolean;
}

/** Monday to Saturday of the week with the appointments of each day (Sunday too when it has any or a schedule). */
export function weekBars(days: readonly ClinicLoadDay[], today: string): WeekBar[] {
  const start = weekStartOf(today);
  const weekdays = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  return weekdays
    .map((date) => ({ date, day: days.find((d) => d.date === date) }))
    .filter(({ date, day }) => date !== weekdays[6] || (day && (day.scheduled > 0 || day.slots > 0)))
    .map(({ date, day }) => ({
      date,
      label: date === today ? "Today" : new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)),
      count: day?.scheduled ?? 0,
      today: date === today,
    }));
}

/** Slots still free in a day: those the schedules offer less the ones held, never below none. */
export function openSlots(day: Pick<ClinicLoadDay, "booked" | "slots">): number {
  return Math.max(0, day.slots - day.booked);
}

// ---- Tiles and header --------------------------------------------------------------------------------------------------

/** Who arrived (checked in or seen) and who did not come, from the day's appointments by status. */
export function appointmentFigures(d: ClinicDashboard): { total: number; arrived: number; noShow: number } {
  const by = d.appointments.byStatus;
  return { total: d.appointments.total, arrived: (by["checked_in"] ?? 0) + (by["completed"] ?? 0), noShow: by["no_show"] ?? 0 };
}

/** "2 more than last Wed", "1 fewer than last Wed", "same as last Wed"; null without last week's figure. */
export function seenComparison(seenToday: number, seenLastWeek: number | null, weekday: string): string | null {
  if (seenLastWeek === null) return null;
  const diff = seenToday - seenLastWeek;
  if (diff === 0) return `Same as last ${weekday}`;
  return `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than last ${weekday}`;
}

/** "Good morning", "Good afternoon" or "Good evening" by the facility's local hour. */
export function greeting(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
