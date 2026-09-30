import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { ApiError } from "@healthcare/web-session";
import { api } from "@/lib/api/client";
import { getPractitioners } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AppointmentItem, CalendarEventItem, Page } from "@/lib/api/types";
import { CALENDAR_VIEWS, type CalendarView, stepDate, viewRange } from "@/lib/calendar";
import { todayIn } from "@/lib/clinic-mapping";
import { CalendarBoard } from "./calendar-board";

export const metadata = { title: "Calendar" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Appointments are read a page at a time; a month rarely needs more than a few. */
const APPOINTMENT_PAGES = 5;

async function loadAppointments(facilityId: string, from: string, to: string): Promise<{ items: AppointmentItem[]; truncated: boolean }> {
  const items: AppointmentItem[] = [];
  for (let page = 1; page <= APPOINTMENT_PAGES; page++) {
    const result = await api<Page<AppointmentItem>>("/appointments", { query: { facilityId, from, to, page, pageSize: 100 } });
    items.push(...result.items);
    if (!result.hasMore) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "calendar.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Calendar" />
        <FacilityRequired action="Calendars are kept per facility." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const date = params.date && DATE.test(params.date) ? params.date : today;
  const view: CalendarView = CALENDAR_VIEWS.find((v) => v === params.view) ?? "month";
  const { from, to } = viewRange(view, date, facility.timezone);
  const showAppointments = can(session, "appointment.read");
  const [events, appointments, practitioners] = await Promise.all([
    api<CalendarEventItem[]>("/calendar/events", { query: { facilityId: facility.id, from, to } }),
    showAppointments ? loadAppointments(facility.id, from, to) : Promise.resolve({ items: [], truncated: false }),
    // Attendees are picked among clinicians; without access to the list an event is still possible, without invitees.
    getPractitioners().catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 403) return [];
      throw error;
    }),
  ]);
  const href = (v: CalendarView, d: string) => `/calendar?view=${v}&date=${d}`;
  const title =
    view === "month"
      ? new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" })
      : clinicalDate(date);

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`${facility.name} · ${title}`}
        actions={
          <>
            <nav aria-label="Change period" className="flex items-center gap-1">
              <Button asChild variant="outline" size="icon-sm">
                <Link href={href(view, stepDate(view, date, -1))} aria-label={`Previous ${view}`}>
                  <ChevronLeftIcon />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={href(view, today)}>Today</Link>
              </Button>
              <Button asChild variant="outline" size="icon-sm">
                <Link href={href(view, stepDate(view, date, 1))} aria-label={`Next ${view}`}>
                  <ChevronRightIcon />
                </Link>
              </Button>
            </nav>
            <nav aria-label="Calendar view" className="flex items-center gap-1">
              {CALENDAR_VIEWS.map((v) => (
                <Button key={v} asChild variant={v === view ? "default" : "outline"} size="sm">
                  <Link href={href(v, date)} aria-current={v === view ? "page" : undefined}>
                    {v[0]!.toUpperCase() + v.slice(1)}
                  </Link>
                </Button>
              ))}
            </nav>
          </>
        }
      />
      <CalendarBoard
        view={view}
        date={date}
        today={today}
        events={events}
        appointments={appointments.items}
        appointmentsTruncated={appointments.truncated}
        practitioners={practitioners}
        canManage={can(session, "calendar.manage")}
        canOpenAppointments={showAppointments}
        facilityId={facility.id}
        timeZone={facility.timezone}
      />
    </>
  );
}
