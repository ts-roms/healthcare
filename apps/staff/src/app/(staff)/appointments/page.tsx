import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCogIcon, ListOrderedIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AppointmentItem, ClinicRoom, Page, PractitionerScheduleRow, ScheduleExceptionRow, WaitlistEntry } from "@/lib/api/types";
import { weekOf } from "@/lib/appointment-day";
import { viewRange } from "@/lib/calendar";
import { shiftDate, todayIn, zonedLocalToIso } from "@/lib/clinic-mapping";
import { AppointmentsDay, type AppointmentsView } from "./appointments-day";

export const metadata = { title: "Appointments" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VIEWS: readonly AppointmentsView[] = ["day", "list", "room", "calendar"];
/** A month is read a page at a time (100 each); more than this is flagged as cut short. */
const MONTH_PAGES = 5;

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; practitionerId?: string; view?: string; appointmentId?: string }>;
}) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Appointments">
        <FacilityRequired action="Schedules are kept per facility." />
      </ModulePage>
    );
  }
  const today = todayIn(facility.timezone);
  const date = params.date && DATE.test(params.date) ? params.date : today;
  const view: AppointmentsView = VIEWS.includes(params.view as AppointmentsView) ? (params.view as AppointmentsView) : "day";
  const [practitioners, visitTypes] = await Promise.all([getPractitioners(), getVisitTypes()]);
  const practitionerId = practitioners.some((p) => p.id === params.practitionerId) ? params.practitionerId : undefined;
  const dayStart = zonedLocalToIso(`${date}T00:00`, facility.timezone);
  const dayEnd = zonedLocalToIso(`${shiftDate(date, 1)}T00:00`, facility.timezone);
  const week = weekOf(date);

  const [page, rooms, schedules, closures, waitlist, weekBooked] = await Promise.all([
    api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, date, practitionerId, pageSize: 100 } }),
    api<ClinicRoom[]>("/clinic/rooms", { query: { facilityId: facility.id } }).catch(() => [] as ClinicRoom[]),
    // Working hours and closures shade the timeline; without them it still shows the bookings.
    api<PractitionerScheduleRow[]>("/clinic/schedules").catch(() => [] as PractitionerScheduleRow[]),
    api<ScheduleExceptionRow[]>("/clinic/schedule-exceptions", { query: { facilityId: facility.id, from: dayStart, to: dayEnd } }).catch(
      () => [] as ScheduleExceptionRow[],
    ),
    api<WaitlistEntry[]>("/waitlist", { query: { facilityId: facility.id } }).catch(() => null),
    // Which other days of the week have bookings (a dot under the day).
    Promise.all(
      week.map((d) =>
        d === date
          ? Promise.resolve(false)
          : api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, date: d, practitionerId, pageSize: 20 } })
              .then((p) => p.items.some((a) => a.status !== "cancelled"))
              .catch(() => false),
      ),
    ),
  ]);
  const weekDays = week.map((d, i) => ({ date: d, booked: d === date ? page.items.some((a) => a.status !== "cancelled") : (weekBooked[i] ?? false) }));
  const canBook = can(session, "appointment.manage") && can(session, "patient.search");

  // The calendar view shows the whole month (the weeks around it) for the same practitioner filter.
  const month = view === "calendar" ? viewRange("month", date, facility.timezone) : null;
  const monthItems: AppointmentItem[] = [];
  let monthTruncated = false;
  if (month) {
    for (let p = 1; p <= MONTH_PAGES; p++) {
      const result = await api<Page<AppointmentItem>>("/appointments", {
        query: { facilityId: facility.id, from: month.from, to: month.to, practitionerId, page: p, pageSize: 100 },
      });
      monthItems.push(...result.items);
      if (!result.hasMore) break;
      if (p === MONTH_PAGES) monthTruncated = true;
    }
  }

  return (
    <ModulePage
      title="Appointments"
      description={facility.name}
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href="/appointments/waitlist">
              <ListOrderedIcon /> Waiting list
              {waitlist && waitlist.length > 0 ? (
                <span className="tabular ml-0.5 rounded-full border px-1.5 text-meta leading-5">
                  <span className="sr-only">(</span>
                  {waitlist.length}
                  <span className="sr-only"> waiting)</span>
                </span>
              ) : null}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/appointments/schedules">
              <CalendarCogIcon /> Schedules
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/appointments/visit-types">
              <Settings2Icon /> Booking settings
            </Link>
          </Button>
          {canBook ? (
            <Button asChild size="sm">
              <Link href={`/appointments/new?date=${date}${practitionerId ? `&practitionerId=${practitionerId}` : ""}`}>
                <PlusIcon /> New appointment
              </Link>
            </Button>
          ) : null}
        </>
      }
    >
      <AppointmentsDay
        items={page.items}
        truncated={page.hasMore}
        date={date}
        today={today}
        week={weekDays}
        view={view}
        practitionerId={practitionerId ?? ""}
        practitioners={practitioners}
        visitTypes={visitTypes}
        schedules={schedules}
        closures={closures}
        dayStart={dayStart}
        dayEnd={dayEnd}
        canManage={can(session, "appointment.manage")}
        canCheckIn={can(session, "clinic.queue.manage")}
        canOpenRecord={can(session, "patient.read")}
        facilityId={facility.id}
        timeZone={facility.timezone}
        rooms={rooms}
        month={month ? { days: month.days, items: monthItems, truncated: monthTruncated } : null}
        // Opened in the side panel, e.g. the appointment just booked.
        initialAppointmentId={params.appointmentId ?? null}
      />
    </ModulePage>
  );
}
