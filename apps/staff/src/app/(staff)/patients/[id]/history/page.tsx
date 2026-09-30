import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { Button, Card, CardContent } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { HistorySections } from "@/components/history/history-panels";
import { api } from "@/lib/api/client";
import { loadPatientHistory } from "@/lib/api/history";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail } from "@/lib/api/types";

// Never put patient names in the tab title.
export const metadata = { title: "Medical history" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The patient's history: past procedures and surgeries, past conditions diagnosed elsewhere, family history with its
 * review state, and social history with its versions. What was reported or documented — not a diagnosis, never scored.
 * Viewing is audited by the API; substance use and sexual history are shown only to users who also hold
 * encounter.write.
 */
export default async function PatientHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession();
  if (!can(session, "history.read")) redirect(`/patients/${id}`);
  const patient = await api<PatientDetail>(`/patients/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  });
  // A retired (merged) record's history is part of its surviving record's.
  if (patient.mergedIntoPatientId) redirect(`/patients/${patient.mergedIntoPatientId}/history`);
  const { history, canRecord } = await loadPatientHistory(id);
  if (!history) notFound();

  return (
    <>
      <PageHeader
        title="Medical history"
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
          What the patient, a relative or another provider reported, or what you documented from records you saw. Past conditions here are not diagnoses of this
          clinic (those are on the problem list) and are never billed or reported. Nothing here is scored.
        </p>
        <Card>
          <CardContent className="pt-4">
            <HistorySections patientId={id} history={history} canRecord={canRecord && patient.status === "active"} linkedRecords={patient.mergedRecords} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
