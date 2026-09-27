import { notFound, redirect } from "next/navigation";
import { AllergyBadge, PatientHeader, SummarySection, VitalSigns } from "@healthcare/ui/healthcare";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { PatientDetail, PatientSummaryResponse, Visit } from "@/lib/api/types";
import { canTriage, visitStatusLabel } from "@/lib/clinic-mapping";
import { toBannerPatient, toVitalSigns } from "@/lib/patient-mapping";
import { TriageForm } from "./triage-form";

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
  const [patient, summary] = await Promise.all([
    load<PatientDetail>(`/patients/${visit.patientId}`),
    can(session, "clinical.read") ? load<PatientSummaryResponse>(`/patients/${visit.patientId}/summary`) : Promise.resolve(null),
  ]);
  const latest = summary?.latestVitals[0];
  const banner = toBannerPatient(patient, summary?.allergies);

  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader patient={banner} allergiesHidden={!summary} allergiesRecorded={summary ? summary.allergies.status !== "not_reviewed" : true} />
      <PageHeader title={`Triage · ${visit.ticket}`} description={`${facility.name} · ${visitStatusLabel(visit.status)}`} />
      {canTriage(visit.status) ? (
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <TriageForm
            visit={{ id: visit.id, ticket: visit.ticket, chiefComplaint: visit.chiefComplaint ?? "", priority: visit.priority }}
            patientId={visit.patientId}
          />
          <aside className="flex flex-col gap-3 self-start">
            {summary ? (
              <>
                <SummarySection title="Allergies">
                  {banner.allergies.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {banner.allergies.map((a) => (
                        <li key={a.id}>
                          <AllergyBadge allergy={a} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-table text-muted-foreground">
                      {summary.allergies.status === "not_reviewed" ? "Allergies not recorded — ask the patient." : "No known allergies (reviewed)."}
                    </p>
                  )}
                </SummarySection>
                <SummarySection title="Previous vitals">
                  {latest ? <VitalSigns vitals={toVitalSigns(latest)} /> : <p className="text-table text-muted-foreground">No vital signs recorded.</p>}
                </SummarySection>
              </>
            ) : (
              <p className="text-table text-muted-foreground">Allergies and previous vitals need clinical access.</p>
            )}
          </aside>
        </div>
      ) : (
        <p role="status" className="m-4 rounded-md border px-3 py-2 text-body">
          Triage is closed for this visit ({visitStatusLabel(visit.status).toLowerCase()}).
        </p>
      )}
    </div>
  );
}
