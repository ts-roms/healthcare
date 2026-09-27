import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { getPatientForAction, getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { ApiError, userMessage } from "@healthcare/web-session";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { Availability } from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { safeNextPath } from "@healthcare/web-session";
import { BookingForm } from "./booking-form";

export const metadata = { title: "Book appointment" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Search = {
  patientId?: string;
  practitionerId?: string;
  visitTypeId?: string;
  date?: string;
  /** Where to go after booking (same-origin path only), e.g. back to the encounter. */
  returnTo?: string;
  /** A care-plan follow-up activity to link to the booked appointment. */
  carePlanId?: string;
  activityId?: string;
  reason?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BookAppointmentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "appointment.manage")) redirect("/appointments");
  if (!facility) {
    return (
      <>
        <PageHeader title="Book appointment" />
        <FacilityRequired action="Appointments are booked at a facility." />
      </>
    );
  }
  const [patient, practitioners, visitTypes] = await Promise.all([getPatientForAction(params.patientId), getPractitioners(), getVisitTypes()]);
  const today = todayIn(facility.timezone);
  const practitionerId = practitioners.find((p) => p.id === params.practitionerId)?.id ?? "";
  const visitTypeId = visitTypes.find((v) => v.id === params.visitTypeId)?.id ?? (visitTypes.length === 1 ? (visitTypes[0]?.id ?? "") : "");
  const date = params.date && DATE.test(params.date) && params.date >= today ? params.date : today;

  // Slots come from the practitioner's published schedule minus bookings and closures (the API decides).
  let availability: Availability | null = null;
  let availabilityError: string | null = null;
  if (practitionerId && visitTypeId) {
    try {
      availability = await api<Availability>("/appointments/availability", { query: { practitionerId, facilityId: facility.id, visitTypeId, date } });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      availabilityError = userMessage(e);
    }
  }

  return (
    <>
      <PageHeader title="Book appointment" description={`At ${facility.name}. Only open slots in the practitioner's schedule are offered.`} />
      <BookingForm
        facilityId={facility.id}
        today={today}
        patient={{ id: patient.id, displayName: patient.displayName, patientNumber: patient.patientNumber, status: patient.status }}
        practitioners={practitioners.map((p) => ({ id: p.id, name: p.displayName }))}
        visitTypes={visitTypes.map((v) => ({
          id: v.id,
          name: `${v.name} · ${v.defaultDurationMinutes} min${v.modality === "telemedicine" ? " · online" : ""}`,
        }))}
        selection={{ practitionerId, visitTypeId, date }}
        context={{
          returnTo: safeNextPath(params.returnTo, ""),
          activity:
            params.carePlanId && params.activityId && UUID.test(params.carePlanId) && UUID.test(params.activityId)
              ? { carePlanId: params.carePlanId, activityId: params.activityId }
              : null,
          reason: (params.reason ?? "").slice(0, 500),
        }}
        slots={availability?.slots ?? null}
        availabilityError={availabilityError}
      />
    </>
  );
}
