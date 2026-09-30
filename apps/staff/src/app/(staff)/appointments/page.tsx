import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AppointmentItem, Page } from "@/lib/api/types";
import { shiftDate, todayIn } from "@/lib/clinic-mapping";
import { AppointmentsDay } from "./appointments-day";

export const metadata = { title: "Appointments" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string; practitionerId?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Appointments" />
        <FacilityRequired action="Schedules are kept per facility." />
      </>
    );
  }
  const today = todayIn(facility.timezone);
  const date = params.date && DATE.test(params.date) ? params.date : today;
  const [practitioners, visitTypes] = await Promise.all([getPractitioners(), getVisitTypes()]);
  const practitionerId = practitioners.some((p) => p.id === params.practitionerId) ? params.practitionerId : undefined;
  const page = await api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, date, practitionerId, pageSize: 100 } });
  const href = (d: string) => `/appointments?date=${d}${practitionerId ? `&practitionerId=${practitionerId}` : ""}`;

  return (
    <>
      <PageHeader
        title="Appointments"
        description={`${facility.name} · ${clinicalDate(date)}${date === today ? " (today)" : ""}`}
        actions={
          <>
            <nav aria-label="Change day" className="flex items-center gap-1">
              <Button asChild variant="outline" size="icon-sm">
                <Link href={href(shiftDate(date, -1))} aria-label="Previous day">
                  <ChevronLeftIcon />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={href(today)}>Today</Link>
              </Button>
              <Button asChild variant="outline" size="icon-sm">
                <Link href={href(shiftDate(date, 1))} aria-label="Next day">
                  <ChevronRightIcon />
                </Link>
              </Button>
            </nav>
            <Button asChild variant="outline" size="sm">
              <Link href="/appointments/waitlist">Waiting list</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/appointments/schedules">Schedules</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/appointments/visit-types">
                <GlobeIcon /> Online booking
              </Link>
            </Button>
            {can(session, "appointment.manage") && can(session, "patient.search") ? (
              <Button asChild size="sm">
                <Link href="/patients">
                  <SearchIcon /> Find patient to book
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <AppointmentsDay
        items={page.items}
        truncated={page.hasMore}
        date={date}
        isToday={date === today}
        practitionerId={practitionerId ?? ""}
        practitioners={practitioners}
        visitTypes={visitTypes}
        canManage={can(session, "appointment.manage")}
        canCheckIn={can(session, "clinic.queue.manage")}
        canOpenRecord={can(session, "patient.read")}
        facilityId={facility.id}
        timeZone={facility.timezone}
      />
    </>
  );
}
