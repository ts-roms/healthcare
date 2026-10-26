import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { FileOutsideResult, OutsideResultList } from "@/components/outside-results/outside-results-panel";
import { api } from "@/lib/api/client";
import { loadOutsideResults } from "@/lib/api/outside-results";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail } from "@/lib/api/types";

// Never put patient names in the tab title.
export const metadata = { title: "Outside results" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reports from other laboratories and hospitals filed on the patient's record, each with its source, the day it was
 * done and the tests as the report names them. They are not this laboratory's results and the platform does not read
 * or interpret them. Viewing is audited by the API.
 */
export default async function PatientOutsideResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession();
  if (!can(session, "outside-result.read")) redirect(`/patients/${id}`);
  const patient = await api<PatientDetail>(`/patients/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  });
  // A retired (merged) record's filings are part of its surviving record's.
  if (patient.mergedIntoPatientId) redirect(`/patients/${patient.mergedIntoPatientId}/outside-results`);
  const results = (await loadOutsideResults(id)) ?? [];
  const canRecord = can(session, "outside-result.record") && can(session, "document.upload");
  const active = patient.status === "active";

  return (
    <ModulePage
      title="Outside results"
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
    >
      <p className="flex items-start gap-2 text-table text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        These are reports from other laboratories and hospitals, kept as received. They are not results of this laboratory: nothing here is verified, flagged,
        converted or added to its trends, and the report is not read by the system. The clinician reads the report itself.
      </p>
      {canRecord && active ? (
        <Card>
          <CardHeader>
            <CardTitle>File a report</CardTitle>
          </CardHeader>
          <CardContent>
            <FileOutsideResult patientId={id} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Filed reports</CardTitle>
        </CardHeader>
        <CardContent>
          <OutsideResultList
            patientId={id}
            results={results}
            canRecord={canRecord}
            canReview={can(session, "outside-result.review")}
            linkedRecords={patient.mergedRecords}
          />
        </CardContent>
      </Card>
    </ModulePage>
  );
}
