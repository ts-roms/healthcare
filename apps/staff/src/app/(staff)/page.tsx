import Link from "next/link";
import { CalendarCheckIcon, ClockIcon, SearchIcon, StethoscopeIcon, UserCheckIcon, UserPlusIcon } from "lucide-react";
import { ActionMetric, AgendaList, AppointmentCard, AttentionList, MiniCalendar, QueueBoard, StatCard, type AgendaEntry } from "@healthcare/ui/healthcare";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@healthcare/ui/primitives";
import { LiveQueueRefresh } from "@/components/live-queue";
import { LAB_EVENTS, QUEUE_EVENTS } from "@/lib/live-queue";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getFacilities, getSelectedFacility, getSession } from "@/lib/api/session";
import type {
  AppointmentItem,
  ClinicDashboard,
  DueCareActivity,
  LabCriticalAlert,
  LabDashboard,
  LabQualitySummary,
  Me,
  Page,
  QueueVisit,
} from "@/lib/api/types";
import { QUEUE_BOARD_STATUSES, toAppointment, todayIn, toQueueEntry, upcomingAppointments } from "@/lib/clinic-mapping";
import { attentionItems, minutesLabel, qualityAttentionItems } from "@/lib/dashboard-mapping";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [session, facilities, facility] = await Promise.all([getSession(), getFacilities(), getSelectedFacility()]);
  return (
    <>
      <PageHeader
        title={`Welcome, ${session.user.displayName}`}
        description={`${session.organization.name}${facility ? ` · ${facility.name}` : ""}`}
        actions={
          <>
            {can(session, "patient.search") ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/patients">
                  <SearchIcon /> Find patient
                </Link>
              </Button>
            ) : null}
            {can(session, "patient.register") ? (
              <Button asChild size="sm">
                <Link href="/patients/new">
                  <UserPlusIcon /> Register patient
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {facilities.length > 1 && !facility ? (
        <p className="border-b bg-info-subtle px-4 py-2 text-table text-info-foreground">
          Select your facility in the top bar to see today&apos;s clinic. Registering patients needs one too.
        </p>
      ) : null}
      {facility && can(session, "clinic.dashboard.read") ? <ClinicToday session={session} facility={facility} /> : null}
      {facility ? <LaboratoryToday session={session} /> : null}
    </>
  );
}

/** Live operational view of the selected facility for today (GET /clinic/dashboard and friends). */
async function ClinicToday({ session, facility }: { session: Me; facility: { id: string; name: string; timezone: string } }) {
  const canQueue = can(session, "clinic.queue.read");
  const canAppointments = can(session, "appointment.read");
  const [dashboard, due, queue] = await Promise.all([
    api<ClinicDashboard>("/clinic/dashboard"),
    can(session, "care-plan.read") ? api<DueCareActivity[]>("/care-plans/activities/due", { query: { withinDays: 7 } }) : Promise.resolve(null),
    canQueue ? api<QueueVisit[]>("/queue") : Promise.resolve(null),
  ]);
  const today = todayIn(facility.timezone);
  const agenda = (due ?? [])
    .filter((a) => a.dueDate)
    .slice(0, 5)
    .map((a) => {
      const d = new Date(`${a.dueDate}T00:00:00Z`);
      return {
        id: a.id,
        iso: a.dueDate as string,
        tag: a.overdue ? "Overdue" : "Follow-up",
        title: a.description,
        time: a.patient?.displayName ?? a.planTitle,
        day: String(d.getUTCDate()),
        weekday: new Intl.DateTimeFormat("en-PH", { weekday: "short", timeZone: "UTC" }).format(d),
        href: `/clinic/care-plans/${a.carePlanId}`,
      } satisfies AgendaEntry & { iso: string };
    });
  const attention = attentionItems(dashboard, { due, canOpenEncounters: can(session, "encounter.read"), canOpenQueue: canQueue });

  return (
    <section className="flex flex-col gap-4 p-4" aria-labelledby="today-heading">
      <h2 id="today-heading" className="text-section font-semibold">
        Clinic today <span className="text-table font-normal text-muted-foreground">· {facility.name}</span>
        {canQueue || can(session, "lab.order.read") ? (
          <span className="ml-2 align-middle">
            {/* One socket keeps the clinic figures and the laboratory panel current (each only if the user may see it). */}
            <LiveQueueRefresh events={[...QUEUE_EVENTS, ...LAB_EVENTS]} />
          </span>
        ) : null}
      </h2>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Appointments"
              value={dashboard.appointments.total}
              icon={CalendarCheckIcon}
              href={canAppointments ? "/appointments" : undefined}
              footer={`No-show rate ${Math.round(dashboard.appointments.noShowRate * 100)}%`}
            />
            <StatCard
              label="Waiting"
              value={dashboard.queue.waiting}
              icon={ClockIcon}
              tone={dashboard.queue.waiting ? "warning" : "default"}
              href={canQueue ? "/queue" : undefined}
              footer={`Average wait ${minutesLabel(dashboard.queue.averageWaitMinutes)}`}
            />
            <StatCard
              label="With provider"
              value={dashboard.queue.inConsultation}
              icon={StethoscopeIcon}
              href={canQueue ? "/queue" : undefined}
              footer="In consultation now"
            />
            <StatCard
              label="Seen"
              value={dashboard.encounters.completedToday}
              icon={UserCheckIcon}
              href={can(session, "encounter.read") ? "/clinic/encounters" : undefined}
              footer="Consultations completed today"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <AttentionList items={attention} />
            {canAppointments ? <NextPatients session={session} facility={facility} /> : <div />}
          </div>

          {dashboard.providerWorkload.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Provider workload</CardTitle>
              </CardHeader>
              <CardContent className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Practitioner</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Seen</TableHead>
                      <TableHead className="text-right">Waiting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.providerWorkload.map((w) => (
                      <TableRow key={w.practitionerId}>
                        <TableCell>{w.displayName}</TableCell>
                        <TableCell className="tabular text-right">{w.booked}</TableCell>
                        <TableCell className="tabular text-right">{w.seen}</TableCell>
                        <TableCell className="tabular text-right">{w.waiting}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {queue && queue.length ? (
            <div className="overflow-x-auto">
              <QueueBoard entries={queue.map(toQueueEntry)} statuses={QUEUE_BOARD_STATUSES} hideDone className="min-w-[48rem]" />
            </div>
          ) : null}
        </div>
        <aside className="flex flex-col gap-4" aria-label="Calendar and follow-ups">
          <MiniCalendar today={today} marked={agenda.map((e) => e.iso)} />
          {due ? <AgendaList title="Follow-ups due" entries={agenda} empty="No follow-ups due in the next 7 days." /> : null}
        </aside>
      </div>
    </section>
  );
}

/** Today's upcoming appointments: the user's own if they are a practitioner, else the facility's. */
async function NextPatients({ session, facility }: { session: Me; facility: { id: string; timezone: string } }) {
  const practitioners = await getPractitioners();
  const mine = practitioners.find((p) => p.userId === session.user.id);
  const [page, visitTypes] = await Promise.all([
    api<Page<AppointmentItem>>("/appointments", {
      query: { facilityId: facility.id, date: todayIn(facility.timezone), practitionerId: mine?.id, pageSize: 100 },
    }),
    getVisitTypes(),
  ]);
  const upcoming = upcomingAppointments(page.items).slice(0, 6);
  const practitionerMap = new Map(practitioners.map((p) => [p.id, p]));
  const visitTypeMap = new Map(visitTypes.map((v) => [v.id, v]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{mine ? "Your next patients" : "Next patients"}</CardTitle>
        <CardAction>
          <Link href={mine ? `/appointments?practitionerId=${mine.id}` : "/appointments"} className="text-meta text-primary hover:underline">
            Full schedule
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="divide-y py-0">
        {upcoming.length === 0 ? <p className="py-3 text-table text-muted-foreground">No more appointments today.</p> : null}
        {upcoming.map((a) => (
          <AppointmentCard key={a.id} appointment={toAppointment(a, practitionerMap, visitTypeMap)} showPatient />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The facility laboratory today (GET /laboratory/dashboard), critical results waiting for acknowledgement, and for
 * quality staff what the quality system needs (GET /laboratory/quality/summary).
 */
async function LaboratoryToday({ session }: { session: Me }) {
  const [dashboard, criticals, quality] = await Promise.all([
    can(session, "lab.dashboard.read") ? api<LabDashboard>("/laboratory/dashboard") : Promise.resolve(null),
    can(session, "lab.result.read") ? api<LabCriticalAlert[]>("/laboratory/critical-results") : Promise.resolve([]),
    can(session, "lab.qc.read") ? api<LabQualitySummary>("/laboratory/quality/summary") : Promise.resolve(null),
  ]);
  if (!dashboard && criticals.length === 0 && !quality) return null;
  const workbench = can(session, "lab.order.read") ? "/laboratory/worklist" : undefined;
  return (
    <section className="p-4 pt-0" aria-labelledby="lab-heading">
      <h2 id="lab-heading" className="mb-2 text-section font-semibold">
        Laboratory
      </h2>
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {dashboard ? (
          <Card className="p-1">
            <ActionMetric value={dashboard.pendingCollection} label="To collect" href={workbench && `${workbench}?stage=collect`} />
            <ActionMetric value={dashboard.awaitingEntry} label="Awaiting results" href={workbench && `${workbench}?stage=enter`} />
            <ActionMetric
              value={dashboard.awaitingVerification + dashboard.awaitingApproval}
              label="Awaiting sign-off"
              tone={dashboard.awaitingVerification + dashboard.awaitingApproval ? "warning" : "default"}
              href={workbench && `${workbench}?stage=verify`}
            />
            <ActionMetric value={dashboard.statOpen} label="STAT open" tone={dashboard.statOpen ? "warning" : "default"} href={workbench} />
            <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 border-t px-2 py-2 text-table">
              <dt className="text-muted-foreground">Released today</dt>
              <dd className="tabular text-right font-medium">{dashboard.releasedToday}</dd>
              <dt className="text-muted-foreground">Avg. turnaround</dt>
              <dd className="tabular text-right font-medium">{minutesLabel(dashboard.averageTurnaroundMinutes)}</dd>
              <dt className="text-muted-foreground">Rejected today</dt>
              <dd className="tabular text-right font-medium">{dashboard.rejectedToday}</dd>
            </dl>
          </Card>
        ) : (
          <div />
        )}
        <div className="flex min-w-0 flex-col gap-4">
          <AttentionList
            title="Laboratory"
            items={[
              ...(criticals.length
                ? [
                    {
                      id: "lab-critical",
                      severity: "critical" as const,
                      count: criticals.length,
                      title: "Critical results not yet acknowledged",
                      detail: criticals
                        .slice(0, 3)
                        .map((c) => `${c.testName} — ${c.patient?.patientNumber ?? "patient"}`)
                        .join(", "),
                      href: "/laboratory/critical",
                    },
                  ]
                : []),
              ...(dashboard?.overdue
                ? [
                    {
                      id: "lab-overdue",
                      severity: "warning" as const,
                      count: dashboard.overdue,
                      title: "Tests past their turnaround time",
                      href: workbench,
                    },
                  ]
                : []),
            ]}
          />
          {quality ? <AttentionList title="Laboratory quality" items={qualityAttentionItems(quality)} /> : null}
        </div>
      </div>
    </section>
  );
}
