import { notFound, redirect } from "next/navigation";
import { VitalSigns } from "@healthcare/ui/healthcare";
import { AllergiesPanel } from "@/components/allergies-panel";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { ApiError } from "@healthcare/web-session";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { PatientDetail, PatientSummaryResponse, RouteStep, ServicePoint, Visit } from "@/lib/api/types";
import { canTriage, visitStatusLabel } from "@/lib/clinic-mapping";
import { toBannerPatient, toVitalSigns } from "@/lib/patient-mapping";
import { minutesSince } from "@/lib/triage-flags";
import { TriageForm } from "./triage-form";
import { TriageHeader } from "./triage-header";

// Never put patient names in the tab title.
export const metadata = { title: "Triage" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load<T>(path: string): Promise<T> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}

export default async function TriagePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "clinic.triage.write")) redirect("/queue");
  if (!facility) {
    return (
      <>
        <PageHeader title="Triage" />
        <FacilityRequired action="Triage is recorded for a visit at a facility." />
      </>
    );
  }
  if (!UUID.test(id)) notFound();
  const visit = await load<Visit>(`/queue/visits/${id}`);
  if (visit.facilityId !== facility.id) notFound();
  // Allergies and alerts must be visible at triage (clinic rules); they need clinical access.
  const [patient, summary, servicePoints, route] = await Promise.all([
    load<PatientDetail>(`/patients/${visit.patientId}`),
    can(session, "clinical.read") ? load<PatientSummaryResponse>(`/patients/${visit.patientId}/summary`) : Promise.resolve(null),
    // Inactive ones too: the visit may already be at a service point that was deactivated since.
    api<ServicePoint[]>("/clinic/service-points", { query: { facilityId: facility.id, includeInactive: "true" } }),
    // The stops already planned (migration 0115), so a repeat triage starts from them.
    api<RouteStep[]>(`/queue/visits/${id}/route`),
  ]);
  const latest = summary?.latestVitals[0];
  const banner = toBannerPatient(patient, summary?.allergies);

  const allergyCount = summary?.allergies.allergies.length ?? 0;
  const aside = summary ? (
    <>
      <section aria-label="Allergies" className="rounded-xl border bg-card p-4">
        <h2 className={`mb-2 text-meta font-semibold tracking-wide uppercase ${allergyCount > 0 ? "text-danger-foreground" : "text-muted-foreground"}`}>
          Allergies{allergyCount > 0 ? ` · ${allergyCount}` : ""}
        </h2>
        <AllergiesPanel patientId={visit.patientId} summary={summary.allergies} canManage={can(session, "allergy.manage")} />
      </section>
      <section aria-label="Previous vitals" className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-meta font-semibold tracking-wide text-muted-foreground uppercase">Previous vitals</h2>
        {latest ? (
          <VitalSigns vitals={toVitalSigns(latest)} />
        ) : (
          <p className="text-table text-muted-foreground">None on record. Today&apos;s readings become the baseline.</p>
        )}
      </section>
    </>
  ) : (
    <p className="text-table text-muted-foreground">Allergies and previous vitals need clinical access.</p>
  );

  return (
    <div className="flex min-h-full flex-col">
      <TriageHeader
        ticket={visit.ticket}
        patient={banner}
        patientHref={`/patients/${visit.patientId}`}
        allergiesHidden={!summary}
        allergiesRecorded={summary ? summary.allergies.status !== "not_reviewed" : true}
        waitingMinutes={minutesSince(visit.checkedInAt)}
        arrivalMode={visit.arrivalMode}
      />
      {canTriage(visit.status) ? (
        <TriageForm
          visit={{
            id: visit.id,
            ticket: visit.ticket,
            chiefComplaint: visit.chiefComplaint ?? "",
            priority: visit.priority,
            servicePointId: visit.servicePointId ?? null,
            plannedStops: route.filter((s) => s.status === "planned").map((s) => s.servicePointId),
          }}
          servicePoints={servicePoints.filter((s) => s.status === "active" || s.id === visit.servicePointId)}
          canConfigureServicePoints={can(session, "clinic.configure")}
          ageYears={patient.age}
          aside={aside}
        />
      ) : (
        <p role="status" className="m-4 rounded-md border px-3 py-2 text-body">
          Triage is closed for this visit ({visitStatusLabel(visit.status).toLowerCase()}).
        </p>
      )}
    </div>
  );
}
