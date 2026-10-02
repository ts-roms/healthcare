import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { Button } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { PatientProcedures } from "./patient-procedures";
import { api } from "@/lib/api/client";
import { loadConsentFormDocuments } from "@/lib/api/procedures";
import { can, getSession } from "@/lib/api/session";
import type { ClinicProcedure, PatientDetail, ProcedureDefinition } from "@/lib/api/types";

// Never put patient names in the tab title.
export const metadata = { title: "Procedures" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every procedure performed on the patient at the clinic (in consultations and under queue visits without one;
 * records merged into this one included; entries in error marked), with the consent recorded against each. Viewing is
 * audited by the API. Procedures are recorded from the encounter workspace or the visit's Procedures page.
 */
export default async function PatientProceduresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession();
  if (!can(session, "encounter.read")) redirect(`/patients/${id}`);
  const patient = await api<PatientDetail>(`/patients/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  });
  if (patient.mergedIntoPatientId) redirect(`/patients/${patient.mergedIntoPatientId}/procedures`);
  const [procedures, definitions, documents] = await Promise.all([
    api<ClinicProcedure[]>(`/patients/${id}/procedures`),
    api<ProcedureDefinition[]>("/clinic/procedure-definitions", { query: { includeInactive: "true" } }).catch(() => [] as ProcedureDefinition[]),
    loadConsentFormDocuments(id),
  ]);

  return (
    <>
      <PageHeader
        title="Procedures"
        description={
          <>
            {patient.displayName} · <span className="font-mono">{patient.patientNumber}</span>
            {patient.mergedRecords?.length ? ` · includes records of ${patient.mergedRecords.map((r) => r.patientNumber).join(", ")}` : ""}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/patients/${id}`}>
              <ArrowLeftIcon aria-hidden /> Patient record
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="flex items-start gap-2 text-table text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Procedures done at the clinic, in consultations and outside them. New ones are recorded from the consultation&apos;s encounter workspace or, for
          procedures your clinic allows outside a consultation, from the visit on the queue.
        </p>
        <PatientProcedures
          patientId={id}
          procedures={procedures}
          definitions={definitions}
          documents={documents}
          canAddConsent={(can(session, "encounter.write") || can(session, "procedure.record")) && patient.status === "active"}
          canAmend={can(session, "encounter.amend")}
          currentUserId={session.user.id}
          canMarkOwn={can(session, "encounter.write") || can(session, "procedure.record")}
        />
      </div>
    </>
  );
}
