"use client";

import Link from "next/link";
import { NotebookTextIcon } from "lucide-react";
import { HistorySections } from "@/components/history/history-panels";
import type { PatientHistory } from "@/lib/api/types";

/**
 * Medical, family and social history in the encounter workspace: review what is on file and record what the patient
 * tells you during the consultation (entries are linked to it). Entries in error and earlier social history versions
 * are on the full history page.
 */
export function HistoryPanel({
  encounterId,
  patientId,
  history,
  canRecord,
  open,
}: {
  encounterId: string;
  patientId: string;
  /** null: the user may not read the history. */
  history: PatientHistory | null;
  canRecord: boolean;
  /** The consultation is not entered in error. */
  open: boolean;
}) {
  if (!history) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Medical, family and social history">
      <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        <NotebookTextIcon className="size-3.5" aria-hidden /> Medical, family and social history
      </h3>
      <HistorySections patientId={patientId} history={history} canRecord={canRecord && open} encounterId={encounterId} compact />
      <Link href={`/patients/${patientId}/history`} className="text-table text-primary hover:underline">
        Full history (entries in error, earlier versions)
      </Link>
    </section>
  );
}
