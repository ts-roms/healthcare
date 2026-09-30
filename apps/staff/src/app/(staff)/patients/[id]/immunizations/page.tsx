import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { ImmunizationHistory, RecordImmunizationButtons } from "@/components/immunizations/immunization-panel";
import { api } from "@/lib/api/client";
import { loadImmunizationData, loadLinkableDocuments } from "@/lib/api/immunizations";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail } from "@/lib/api/types";

// Never put patient names in the tab title.
export const metadata = { title: "Immunizations" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The patient's immunization history grouped by vaccine, with recording of doses given here (from stock or not), not
 * given, and reported by the patient or another provider. The platform records what was given; it does not say which
 * dose is due — that is the clinician's judgement and the organization's own protocol. Viewing is audited by the API.
 */
export default async function PatientImmunizationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession();
  if (!can(session, "immunization.read")) redirect(`/patients/${id}`);
  const patient = await api<PatientDetail>(`/patients/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  });
  // A retired (merged) record's history is part of its surviving record's.
  if (patient.mergedIntoPatientId) redirect(`/patients/${patient.mergedIntoPatientId}/immunizations`);
  const [data, documents] = await Promise.all([loadImmunizationData(id), loadLinkableDocuments(id)]);
  const records = data.records ?? [];
  const active = patient.status === "active";

  return (
    <>
      <PageHeader
        title="Immunizations"
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
          This is the record of doses given, not given and reported. It does not work out which vaccine or dose is due: follow your clinical judgement and your
          organization&apos;s protocol.
        </p>
        {data.canRecord && active ? (
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordImmunizationButtons
                patientId={id}
                vaccines={data.vaccines}
                lots={data.lots}
                documents={documents}
                canUpload={can(session, "document.upload")}
                facilitySelected={data.facilitySelected}
              />
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ImmunizationHistory patientId={id} records={records} canRecord={data.canRecord} linkedRecords={patient.mergedRecords} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
