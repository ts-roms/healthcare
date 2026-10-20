import Link from "next/link";
import { UserCheckIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { LiveQueueRefresh } from "@/components/live-queue";
import { LAB_EVENTS, QUEUE_EVENTS } from "@/lib/live-queue";
import { api } from "@/lib/api/client";
import { getVisitTypes } from "@/lib/api/clinic";
import { can, getFacilities, getSelectedFacility, getSession } from "@/lib/api/session";
import type {
  AppointmentItem,
  ClinicDashboard,
  ClinicLoad,
  DueCareActivity,
  LabCriticalAlert,
  LabDashboard,
  LabQualitySummary,
  Page,
  PractitionerDetail,
  QueueVisit,
} from "@/lib/api/types";
import { queueFigures, shiftDate, todayIn, WAIT_LONG_MINUTES } from "@/lib/clinic-mapping";
import { minutesLabel } from "@/lib/dashboard-mapping";
import {
  appointmentFigures,
  greeting,
  labAttentionRows,
  nextUpRows,
  patientAttentionRows,
  seenComparison,
  setupAttentionRows,
  sortAttention,
  weekBars,
  weekStartOf,
} from "@/lib/dashboard-today";
import { monthOf, monthRange, shiftMonth } from "@/lib/doctor-profile";
import { FigureTiles, type FigureTile } from "./_dashboard/figure-tiles";
import { LabToday } from "./_dashboard/lab-today";
import { LoadCalendar } from "./_dashboard/load-calendar";
import { NeedsAttention } from "./_dashboard/needs-attention";
import { NextUp } from "./_dashboard/next-up";
import { WeekChart } from "./_dashboard/week-chart";

export const metadata = { title: "Dashboard" };

/** Runs a request only when the viewer may see what it answers. */
const when = <T,>(allowed: boolean, request: () => Promise<T>): Promise<T | null> => (allowed ? request() : Promise.resolve(null));

/**
 * The staff dashboard: a greeting with the two things a desk does first, today's figures, what needs attention (patients,
 * laboratory and set-up), the next appointments, the laboratory in four steps, how busy the month and the week are. Each
 * part shows only what the viewer's permissions allow.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [session, facilities, facility, params] = await Promise.all([getSession(), getFacilities(), getSelectedFacility(), searchParams]);
  const now = new Date();
  const timeZone = facility?.timezone ?? "Asia/Manila";
  const today = todayIn(timeZone, now);
  const month = monthOf(params.month, today);
  const monthDays = monthRange(month);
  const weekStart = weekStartOf(today);

  const canClinic = Boolean(facility) && can(session, "clinic.dashboard.read");
  const canQueue = canClinic && can(session, "clinic.queue.read");
  const canAppointments = Boolean(facility) && can(session, "appointment.read");
  const configure = can(session, "clinic.configure");
  const canWorkbench = can(session, "lab.order.read");

  const [dashboard, lastWeek, due, visits, monthLoad, weekLoad, practitioners, labDashboard, criticals, quality] = await Promise.all([
    when(canClinic, () => api<ClinicDashboard>("/clinic/dashboard")),
    when(canClinic, () => api<ClinicDashboard>("/clinic/dashboard", { query: { date: shiftDate(today, -7) } }).catch(() => null)),
    when(canClinic && can(session, "care-plan.read"), () => api<DueCareActivity[]>("/care-plans/activities/due", { query: { withinDays: 7 } })),
    when(canQueue, () => api<QueueVisit[]>("/queue")),
    when(canClinic, () => api<ClinicLoad>("/clinic/dashboard/load", { query: { from: monthDays.first, to: monthDays.next } }).catch(() => null)),
    when(canClinic, () => api<ClinicLoad>("/clinic/dashboard/load", { query: { from: weekStart, to: shiftDate(weekStart, 7) } }).catch(() => null)),
    when(canAppointments || configure, () => api<PractitionerDetail[]>("/clinic/practitioners")),
    when(Boolean(facility) && can(session, "lab.dashboard.read"), () => api<LabDashboard>("/laboratory/dashboard")),
    when(Boolean(facility) && can(session, "lab.result.read"), () => api<LabCriticalAlert[]>("/laboratory/critical-results")),
    when(Boolean(facility) && can(session, "lab.qc.read"), () => api<LabQualitySummary>("/laboratory/quality/summary")),
  ]);

  // Today's appointments: the viewer's own when they are a practitioner, else the facility's.
  const mine = practitioners?.find((p) => p.userId === session.user.id);
  const [appointments, visitTypes] = await Promise.all([
    when(canAppointments && facility !== null, () =>
      api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility?.id, date: today, practitionerId: mine?.id, pageSize: 100 } }),
    ),
    when(canAppointments, () => getVisitTypes()),
  ]);

  const attention = sortAttention([
    ...(dashboard ? patientAttentionRows({ dashboard, due, visits, canOpenEncounters: can(session, "encounter.read"), canOpenQueue: canQueue, now }) : []),
    ...labAttentionRows({ dashboard: labDashboard, criticals: criticals ?? [], quality, canOpenWorkbench: canWorkbench }),
    ...setupAttentionRows({ practitioners: configure ? practitioners : null, quality }),
  ]);
  const showAttention = canClinic || labDashboard !== null || quality !== null || (criticals?.length ?? 0) > 0;

  const tiles: FigureTile[] = [];
  if (dashboard) {
    const appts = appointmentFigures(dashboard);
    const longest = visits ? (queueFigures(visits, now).longestWait ?? null) : null;
    const longestMinutes = longest?.minutes ?? dashboard.queue.longestCurrentWaitMinutes;
    tiles.push(
      {
        key: "appointments",
        label: "Appointments",
        value: appts.total,
        sub: `${appts.arrived} arrived · ${appts.noShow} no-show`,
        href: canAppointments ? "/appointments" : undefined,
      },
      {
        key: "waiting",
        label: "Waiting",
        value: dashboard.queue.waiting,
        sub: `Avg wait ${minutesLabel(dashboard.queue.averageWaitMinutes)}`,
        href: canQueue ? "/queue" : undefined,
      },
      {
        key: "longest",
        label: "Longest wait",
        value: longestMinutes ?? "—",
        unit: longestMinutes === null ? undefined : "min",
        sub: longestMinutes === null ? "no one waiting" : longest ? `${longest.patientName} · ${longest.ticket}` : "waiting now",
        href: canQueue ? "/queue" : undefined,
        alert: longestMinutes !== null && longestMinutes >= WAIT_LONG_MINUTES,
      },
      {
        key: "with-provider",
        label: "With provider",
        value: dashboard.queue.inConsultation,
        sub: "in consultation now",
        href: canQueue ? "/queue" : undefined,
      },
      {
        key: "seen",
        label: "Seen",
        value: dashboard.encounters.completedToday,
        sub:
          seenComparison(
            dashboard.encounters.completedToday,
            lastWeek?.encounters.completedToday ?? null,
            new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`)),
          ) ?? "consultations completed today",
        href: can(session, "encounter.read") ? "/clinic/encounters" : undefined,
      },
    );
  }

  const practitionerName = new Map((practitioners ?? []).map((p) => [p.id, p.displayName]));
  const visitTypeName = new Map((visitTypes ?? []).map((v) => [v.id, v.name]));
  const nextUp = appointments
    ? nextUpRows(appointments.items, now, timeZone, {
        practitioner: (id) => practitionerName.get(id) ?? "Practitioner",
        visitType: (id) => visitTypeName.get(id),
      })
    : null;
  const todayDay = weekLoad?.days.find((d) => d.date === today) ?? null;
  // The right-hand column is there only when something is in it; without, the left column takes the whole width.
  const hasSide = Boolean(nextUp || monthLoad || weekLoad);
  const dateLabel = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone }).format(now);

  return (
    <>
      <header className="flex flex-wrap items-start gap-3 border-b bg-card px-6 py-5">
        <div className="min-w-0">
          <h1 className="text-page-lg font-semibold tracking-tight">
            {greeting(now, timeZone)}, {session.user.displayName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-table text-muted-foreground">
            <span>{dateLabel}</span>
            <span aria-hidden>·</span>
            <span>{session.organization.name}</span>
            {facility ? (
              <>
                <span aria-hidden>·</span>
                <span>{facility.name}</span>
              </>
            ) : null}
            {canQueue || canWorkbench ? (
              <span className="rounded-full border border-success/25 bg-success-subtle px-2 py-0.5">
                {/* One socket keeps the figures and the laboratory current (each only if the viewer may see it). */}
                <LiveQueueRefresh events={[...QUEUE_EVENTS, ...LAB_EVENTS]} />
              </span>
            ) : null}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {can(session, "patient.register") ? (
            <Button asChild variant="outline">
              <Link href="/patients/new">
                <UserPlusIcon /> Register patient
              </Link>
            </Button>
          ) : null}
          {can(session, "clinic.queue.manage") && can(session, "patient.search") ? (
            <Button asChild>
              <Link href="/patients">
                <UserCheckIcon /> Check in patient
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 md:p-6">
        {facilities.length > 1 && !facility ? (
          <p className="rounded-lg bg-info-subtle px-4 py-2 text-table text-info-foreground">
            Select your facility in the top bar to see today&apos;s clinic. Registering patients needs one too.
          </p>
        ) : null}
        {tiles.length > 0 ? <FigureTiles tiles={tiles} /> : null}
        <div className={`grid items-start gap-4 ${hasSide ? "xl:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
          {showAttention ? (
            <div className="min-w-0 xl:col-start-1">
              <NeedsAttention rows={attention} />
            </div>
          ) : null}
          {nextUp ? (
            <div className="min-w-0 xl:col-start-2">
              <NextUp
                rows={nextUp}
                title={mine ? "Your next patients" : "Next up"}
                scheduleHref={mine ? `/appointments?practitionerId=${mine.id}` : "/appointments"}
                canOpenRecord={can(session, "patient.read")}
              />
            </div>
          ) : null}
          {labDashboard ? (
            <div className="min-w-0 xl:col-start-1">
              <LabToday dashboard={labDashboard} workbench={canWorkbench ? "/laboratory/worklist" : undefined} />
            </div>
          ) : null}
          {monthLoad ? (
            <div className="min-w-0 xl:col-start-2">
              <LoadCalendar
                month={month}
                today={today}
                days={monthLoad.days}
                todayDay={todayDay}
                previousHref={`/?month=${shiftMonth(month, -1)}`}
                nextHref={`/?month=${shiftMonth(month, 1)}`}
                todayHref="/"
                openDayHref={canAppointments ? `/appointments?date=${today}` : undefined}
              />
            </div>
          ) : null}
          {weekLoad ? (
            <div className="min-w-0 xl:col-start-2">
              <WeekChart bars={weekBars(weekLoad.days, today)} followUps={due ? due.filter((a) => !a.overdue).length : null} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
