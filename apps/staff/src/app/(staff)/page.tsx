import Link from "next/link";
import { FileTextIcon, ReceiptIcon, UserCheckIcon, UserPlusIcon } from "lucide-react";
import { DashboardPage as DashboardTemplate } from "@healthcare/ui/layouts";
import { StatTile } from "@healthcare/ui/healthcare";
import { Button, Callout } from "@healthcare/ui/primitives";
import { NextLink } from "@/components/next-link";
import { LiveQueueRefresh } from "@/components/live-queue";
import { LAB_EVENTS, QUEUE_EVENTS } from "@/lib/live-queue";
import { api } from "@/lib/api/client";
import { getVisitTypes } from "@/lib/api/clinic";
import { can, getFacilities, getSelectedFacility, getSession } from "@/lib/api/session";
import type {
  AppointmentItem,
  BillingWorklistRow,
  DailyBillingReport,
  InvoiceSummary,
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
import { peso } from "@/lib/billing-mapping";
import { billingFigures, queueLanes } from "@/lib/dashboard-billing";
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
import { LabToday } from "./_dashboard/lab-today";
import { LoadCalendar } from "./_dashboard/load-calendar";
import { BalancesOwed, CollectedToday, QueueNow, ToInvoice } from "./_dashboard/billing-today";
import { NeedsAttention } from "./_dashboard/needs-attention";
import { NextUp } from "./_dashboard/next-up";
import { WeekChart } from "./_dashboard/week-chart";

export const metadata = { title: "Dashboard" };

/** One figure of the day as the stat row shows it. */
interface DashboardTile {
  key: string;
  label: string;
  value: string | number;
  unit?: string;
  sub: string;
  href?: string;
  alert?: boolean;
}

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
  // The cashier's part of the day: what waits to be invoiced, what is owed, what was collected (the report needs its own permission).
  const canBilling = Boolean(facility) && can(session, "billing.charge.read");
  const canBillingReport = canBilling && can(session, "billing.report.read");

  const [dashboard, lastWeek, due, visits, monthLoad, weekLoad, practitioners, labDashboard, criticals, quality, worklist, unpaid, billingReport] =
    await Promise.all([
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
      when(canBilling, () => api<BillingWorklistRow[]>("/billing/worklist")),
      when(canBilling, () => api<InvoiceSummary[]>("/billing/invoices", { query: { unpaid: "true" } })),
      when(canBillingReport, () => api<DailyBillingReport>("/billing/reports/daily", { query: { date: today } }).catch(() => null)),
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

  const tiles: DashboardTile[] = [];
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

  const money = canBilling ? billingFigures({ worklist, unpaid, report: billingReport }) : null;
  if (money) {
    // The cashier has no clinic tiles: the day in money. Others who also bill see what waits to be invoiced beside the clinic's figures.
    tiles.push({
      key: "to-invoice",
      label: "To invoice",
      value: money.toInvoice.patients,
      sub: money.toInvoice.patients === 0 ? "nothing waiting" : `${peso(money.toInvoice.amount)} in charges`,
      href: "/billing",
      alert: money.toInvoice.patients > 0 && !dashboard,
    });
    if (!dashboard) {
      tiles.push({
        key: "owed",
        label: "Balances owed",
        value: peso(money.owed.amount),
        sub: money.owed.invoices === 0 ? "no unpaid invoices" : `${money.owed.invoices} unpaid ${money.owed.invoices === 1 ? "invoice" : "invoices"}`,
        href: "/billing/invoices",
      });
      if (money.collected) {
        tiles.push({
          key: "collected",
          label: "Collected today",
          value: peso(money.collected.amount),
          sub: `${money.collected.payments} ${money.collected.payments === 1 ? "payment" : "payments"}`,
          href: "/billing/reports",
        });
      }
      if (money.issuedToday !== null) {
        tiles.push({ key: "issued", label: "Invoices today", value: money.issuedToday, sub: "issued", href: "/billing/invoices" });
      }
    }
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
  const hasSide = Boolean(nextUp || monthLoad || weekLoad || canBilling);
  const dateLabel = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone }).format(now);

  // What is urgent right now, first and in the danger treatment: STAT samples not yet collected, critical results waiting to be acknowledged.
  const statToCollect = labDashboard?.statPendingCollection ?? 0;
  const criticalCount = criticals?.length ?? 0;
  const urgent =
    statToCollect > 0 || criticalCount > 0 ? (
      <div className="flex flex-col gap-2">
        {statToCollect > 0 ? (
          <Callout
            tone="danger"
            title={`${statToCollect} STAT lab ${statToCollect === 1 ? "sample is" : "samples are"} not yet collected`}
            actions={
              canWorkbench ? (
                <Button asChild variant="destructive" size="sm">
                  <Link href="/laboratory/worklist?stage=collect">Open worklist</Link>
                </Button>
              ) : undefined
            }
          >
            STAT orders waiting to be collected.
          </Callout>
        ) : null}
        {criticalCount > 0 ? (
          <Callout
            tone="danger"
            title={`${criticalCount} critical ${criticalCount === 1 ? "result is" : "results are"} waiting to be acknowledged`}
            actions={
              can(session, "lab.result.read") ? (
                <Button asChild variant="destructive" size="sm">
                  <Link href="/laboratory/critical">Open critical results</Link>
                </Button>
              ) : undefined
            }
          >
            Document who was told, then the ordering side acknowledges.
          </Callout>
        ) : null}
      </div>
    ) : undefined;

  return (
    <DashboardTemplate
      title={`${greeting(now, timeZone)}, ${session.user.displayName}`}
      Link={NextLink}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
        </span>
      }
      actions={
        <>
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
          {canBillingReport ? (
            <Button asChild variant="outline">
              <Link href="/billing/reports">
                <FileTextIcon /> End-of-day report
              </Link>
            </Button>
          ) : null}
          {canBilling && can(session, "billing.invoice.issue") ? (
            <Button asChild variant={can(session, "clinic.queue.manage") ? "outline" : "default"}>
              <Link href="/billing">
                <ReceiptIcon /> Create invoice
              </Link>
            </Button>
          ) : null}
        </>
      }
      alert={
        <>
          {facilities.length > 1 && !facility ? (
            <Callout tone="info">Select your facility in the top bar to see today&apos;s clinic. Registering patients needs one too.</Callout>
          ) : null}
          {urgent}
        </>
      }
      tiles={
        tiles.length > 0
          ? tiles.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={tile.value}
                unit={tile.unit}
                hint={tile.sub}
                href={tile.href}
                tone={tile.alert ? "alert" : "default"}
                Link={NextLink}
              />
            ))
          : undefined
      }
    >
      <div className={`grid items-start gap-4 ${hasSide ? "xl:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-4">
          {showAttention ? <NeedsAttention rows={attention} /> : null}
          {dashboard && canQueue ? <QueueNow lanes={queueLanes(dashboard.queue.byStatus)} href="/queue" /> : null}
          {canBilling ? <ToInvoice rows={worklist ?? []} canInvoice={can(session, "billing.invoice.issue")} /> : null}
          {labDashboard ? <LabToday dashboard={labDashboard} workbench={canWorkbench ? "/laboratory/worklist" : undefined} /> : null}
        </div>
        {hasSide ? (
          <div className="flex min-w-0 flex-col gap-4">
            {nextUp ? (
              <NextUp
                rows={nextUp}
                title={mine ? "Your next patients" : "Next up"}
                scheduleHref={mine ? `/appointments?practitionerId=${mine.id}` : "/appointments"}
                canOpenRecord={can(session, "patient.read")}
              />
            ) : null}
            {canBilling ? <BalancesOwed invoices={unpaid ?? []} /> : null}
            {billingReport ? <CollectedToday report={billingReport} /> : null}
            {monthLoad ? (
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
            ) : null}
            {weekLoad ? <WeekChart bars={weekBars(weekLoad.days, today)} followUps={due ? due.filter((a) => !a.overdue).length : null} /> : null}
          </div>
        ) : null}
      </div>
    </DashboardTemplate>
  );
}
