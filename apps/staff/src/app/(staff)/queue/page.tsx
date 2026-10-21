import { redirect } from "next/navigation";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getPractitioners, getRouteTemplates, getServicePoints } from "@/lib/api/clinic";
import { can, getFacilities, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AppointmentItem, Page, QueueVisit, ServicePointSettings } from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { usableTemplates } from "@/lib/route-template";
import type { TodayAppointments } from "./queue-empty";
import { QueueWorkspace } from "./queue-workspace";

export const metadata = { title: "Queue" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ servicePoint?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "clinic.queue.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Queue" />
        <FacilityRequired action="The queue belongs to a facility." />
      </>
    );
  }
  // One service point of the facility (migration 0113), or the whole queue; an unknown id falls back to the whole queue.
  const servicePoints = await getServicePoints(facility.id);
  const selectedServicePoint = params.servicePoint && UUID.test(params.servicePoint) ? servicePoints.find((s) => s.id === params.servicePoint) : undefined;
  // Closed visits too, so the board shows who has already been seen today.
  const visits = await api<QueueVisit[]>("/queue", {
    query: { includeClosed: "true", ...(selectedServicePoint ? { servicePointId: selectedServicePoint.id } : {}) },
  });
  const canManage = can(session, "clinic.queue.manage");
  // Whether a route sending a patient on calls them (migration 0115): the panel says so before the click.
  const routing = servicePoints.length > 0 ? await api<ServicePointSettings>("/clinic/service-point-settings", { query: { facilityId: facility.id } }) : null;
  // Templates for planning a route from the ticket panel (migration 0116); none is not worth failing the queue for.
  const templates = servicePoints.length > 0 && canManage ? usableTemplates(await getRouteTemplates(facility.id).catch(() => [])) : [];
  const facilities = await getFacilities();
  // Names for "Assigned" on the ticket, and today's appointments for the empty board; neither is worth failing the queue for.
  const canSeeAppointments = can(session, "appointment.read");
  const [practitioners, appointments] = await Promise.all([
    canSeeAppointments ? getPractitioners().catch(() => []) : [],
    canSeeAppointments && visits.length === 0
      ? api<Page<AppointmentItem>>("/appointments", { query: { facilityId: facility.id, date: todayIn(facility.timezone), pageSize: 100 } }).catch(() => null)
      : null,
  ]);
  return (
    <QueueWorkspace
      visits={visits}
      servicePoints={servicePoints}
      templates={templates}
      autoCall={routing?.autoCallOnRoute ?? false}
      chrome={{
        facilities: facilities.map((f) => ({ id: f.id, name: f.name })),
        facilityId: facility.id,
        dateLabel: `Today, ${new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: facility.timezone }).format(new Date())}`,
        selectedServicePointId: selectedServicePoint?.id ?? "",
        canOpenDisplay: can(session, "clinic.queue.display"),
        canCheckIn: canManage && can(session, "patient.search"),
      }}
      practitionerNames={Object.fromEntries(practitioners.map((p) => [p.id, p.displayName]))}
      today={todayAppointments(appointments)}
      canManage={canManage}
      canTriage={can(session, "clinic.triage.write")}
      canOpenRecord={can(session, "patient.read")}
      canConsult={can(session, "encounter.write")}
      canOpenEncounter={can(session, "encounter.read")}
      canRecordProcedure={can(session, "procedure.record")}
    />
  );
}

/** How many appointments are booked today (cancelled ones not counted) and who is first, for the empty board. */
function todayAppointments(page: Page<AppointmentItem> | null): TodayAppointments | null {
  if (!page) return null;
  const open = page.items.filter((a) => a.status !== "cancelled" && a.status !== "no_show").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const first = open.find((a) => a.status === "booked" || a.status === "confirmed");
  return {
    count: open.length,
    first: first ? { time: clinicalTime(first.startsAt), patientName: first.patient?.displayName ?? "Patient" } : null,
  };
}
