import { notFound, redirect } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { PatientHeader } from "@healthcare/ui/healthcare";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { AllergySummary, CarePlanDetail, PatientDetail } from "@/lib/api/types";
import { todayIn } from "@/lib/clinic-mapping";
import { toBannerPatient } from "@/lib/patient-mapping";
import { CarePlanView } from "./care-plan-view";

// Never put patient names in the tab title.
export const metadata = { title: "Care plan" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load<T>(path: string): Promise<T> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}

export default async function CarePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "care-plan.read")) redirect("/");
  if (!UUID.test(id)) notFound();
  const plan = await load<CarePlanDetail>(`/care-plans/${id}`);
  const [patient, allergies] = await Promise.all([
    load<PatientDetail>(`/patients/${plan.patientId}`),
    can(session, "clinical.read") ? load<AllergySummary>(`/patients/${plan.patientId}/allergies`) : Promise.resolve(null),
  ]);
  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader
        patient={toBannerPatient(patient, allergies ?? undefined)}
        allergiesHidden={!allergies}
        allergiesRecorded={allergies ? allergies.status !== "not_reviewed" : true}
      />
      <CarePlanView
        key={plan.id}
        plan={plan}
        followUp={{
          patientId: plan.patientId,
          practitionerId: plan.authorPractitionerId ?? "",
          returnTo: `/clinic/care-plans/${plan.id}`,
          today: todayIn(facility?.timezone ?? "Asia/Manila"),
        }}
        canManage={can(session, "care-plan.manage")}
        canBook={can(session, "appointment.manage")}
        canOpenEncounter={can(session, "encounter.read")}
      />
    </div>
  );
}
