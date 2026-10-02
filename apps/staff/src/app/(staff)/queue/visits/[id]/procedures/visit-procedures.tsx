"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { ProcedureList } from "@/components/procedures/procedure-list";
import { RecordProcedureForm } from "@/components/procedures/record-procedure-form";
import type { ConsentFormDocument } from "@/lib/api/procedures";
import type { ClinicProcedure, Practitioner, ProcedureDefinition } from "@/lib/api/types";

export function VisitProcedures({
  visitId,
  patientId,
  procedures,
  definitions,
  practitioners,
  documents,
  canRecord,
  canAmend,
  currentUserId,
  encounterId,
}: {
  visitId: string;
  patientId: string;
  procedures: ClinicProcedure[];
  definitions: ProcedureDefinition[];
  practitioners: Practitioner[];
  documents: ConsentFormDocument[] | null;
  /** procedure.record, on an open in-person visit of an active patient. */
  canRecord: boolean;
  canAmend: boolean;
  currentUserId: string;
  encounterId: string | null;
}) {
  const [adding, setAdding] = React.useState(false);
  const offered = definitions.filter((d) => d.allowedOutsideConsultation);
  return (
    <section className="flex flex-col gap-2" aria-label="Procedures in this visit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold">Recorded in this visit</h2>
        <div className="flex gap-2">
          {encounterId ? (
            <Button asChild size="xs" variant="ghost">
              <Link href={`/clinic/encounters/${encounterId}`}>Open consultation</Link>
            </Button>
          ) : null}
          {canRecord && offered.length > 0 && !adding ? (
            <Button type="button" size="xs" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden /> Record procedure
            </Button>
          ) : null}
        </div>
      </div>
      {procedures.length ? (
        <ProcedureList
          procedures={procedures}
          patientId={patientId}
          definitions={definitions}
          documents={documents}
          canMark={(p) => canRecord && !p.enteredInError && (p.recordedBy === currentUserId || canAmend)}
          canAddConsent={canRecord}
        />
      ) : (
        <p className="text-table text-muted-foreground">No procedure recorded in this visit outside a consultation.</p>
      )}
      {canRecord && !offered.length ? (
        <p className="text-meta text-muted-foreground">
          No catalogue entry may be recorded outside a consultation: an administrator allows it per procedure under Clinic → Procedures.
        </p>
      ) : null}
      {adding ? (
        <RecordProcedureForm
          target={{ kind: "visit", id: visitId }}
          patientId={patientId}
          definitions={definitions}
          practitioners={practitioners}
          documents={documents}
          onDone={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}
