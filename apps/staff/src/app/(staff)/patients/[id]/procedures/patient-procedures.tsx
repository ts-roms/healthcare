"use client";

import { ProcedureList } from "@/components/procedures/procedure-list";
import type { ConsentFormDocument } from "@/lib/api/procedures";
import type { ClinicProcedure, ProcedureDefinition } from "@/lib/api/types";

export function PatientProcedures({
  patientId,
  procedures,
  definitions,
  documents,
  canAddConsent,
  canAmend,
  canMarkOwn,
  currentUserId,
}: {
  patientId: string;
  procedures: ClinicProcedure[];
  definitions: ProcedureDefinition[];
  documents: ConsentFormDocument[] | null;
  canAddConsent: boolean;
  canAmend: boolean;
  canMarkOwn: boolean;
  currentUserId: string;
}) {
  if (!procedures.length) return <p className="text-table text-muted-foreground">No procedure recorded.</p>;
  return (
    <ProcedureList
      procedures={procedures}
      patientId={patientId}
      definitions={definitions}
      documents={documents}
      canMark={(p) => !p.enteredInError && ((canMarkOwn && p.recordedBy === currentUserId) || canAmend)}
      canAddConsent={canAddConsent}
      showFiledUnder
    />
  );
}
