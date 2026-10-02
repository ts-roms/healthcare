import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { PatientHeader } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { loadConsentFormDocuments } from "@/lib/api/procedures";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { ClinicProcedure, PatientDetail, PatientSummaryResponse, Practitioner, ProcedureDefinition, QueueVisit } from "@/lib/api/types";
import { visitStatusLabel } from "@/lib/clinic-mapping";
import { toBannerPatient } from "@/lib/patient-mapping";
import { VisitProcedures } from "./visit-procedures";

// Never put patient names in the tab title.
export const metadata = { title: "Procedures" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load<T>(path: string): Promise<T> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
const optional = <T,>(path: string): Promise<T | null> =>
  api<T>(path).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  });

/**
 * Procedures performed under a queue visit without a consultation (docs/domains/clinic.md, "Procedures"): a dressing,
 * an injection or a nebulization a nurse carries out when the catalogue entry allows it outside a consultation
 * (procedure.record). The visit must be open and in person at the selected facility; the API decides.
 */
export default async function VisitProceduresPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, facility] = await Promise.all([params, getSession(), getSelectedFacility()]);
  if (!can(session, "encounter.read")) redirect("/queue");
  if (!facility) {
    return (
      <>
        <PageHeader title="Procedures" />
        <FacilityRequired action="Procedures are recorded for a visit at a facility." />
      </>
    );
  }
  if (!UUID.test(id)) notFound();
  const visit = await load<QueueVisit>(`/queue/visits/${id}`);
  if (visit.facilityId !== facility.id) notFound();
  const canRecord = can(session, "procedure.record");
  const [patient, summary, procedures, definitions, practitioners, documents] = await Promise.all([
    load<PatientDetail>(`/patients/${visit.patientId}`),
    can(session, "clinical.read") ? optional<PatientSummaryResponse>(`/patients/${visit.patientId}/summary`) : Promise.resolve(null),
    load<ClinicProcedure[]>(`/visits/${id}/procedures`),
    optional<ProcedureDefinition[]>("/clinic/procedure-definitions"),
    can(session, "appointment.read") ? optional<Practitioner[]>("/clinic/practitioners") : Promise.resolve(null),
    loadConsentFormDocuments(visit.patientId),
  ]);
  const open = !["completed", "cancelled", "left_without_being_seen"].includes(visit.status);
  const banner = toBannerPatient(patient, summary?.allergies);

  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader patient={banner} allergiesHidden={!summary} allergiesRecorded={summary ? summary.allergies.status !== "not_reviewed" : true} />
      <PageHeader
        title={`Procedures · ${visit.ticket}`}
        description={`${facility.name} · ${visitStatusLabel(visit.status)}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/queue">
              <ArrowLeftIcon aria-hidden /> Queue
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="flex items-start gap-2 text-table text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {visit.encounterId
            ? "This visit has a consultation: procedures done in it are recorded in the encounter workspace. Only procedures your clinic allows outside a consultation are recorded here."
            : "Procedures done in this visit without a doctor's consultation, for catalogue entries your clinic allows outside one. Consent is recorded with the procedure when the entry requires it."}
        </p>
        <VisitProcedures
          visitId={id}
          patientId={visit.patientId}
          procedures={procedures}
          definitions={definitions ?? []}
          practitioners={practitioners ?? []}
          documents={documents}
          canRecord={canRecord && open && visit.modality === "in_person" && patient.status === "active"}
          canAmend={can(session, "encounter.amend")}
          currentUserId={session.user.id}
          encounterId={visit.encounterId}
        />
      </div>
    </div>
  );
}
