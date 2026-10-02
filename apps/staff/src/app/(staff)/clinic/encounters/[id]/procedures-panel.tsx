"use client";

import * as React from "react";
import { HandIcon, PlusIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { issueProcedureSupplies, returnProcedureSupplies } from "@/app/(staff)/clinic/procedure-actions";
import { ProcedureList } from "@/components/procedures/procedure-list";
import { RecordProcedureForm } from "@/components/procedures/record-procedure-form";
import { SuppliesUsed } from "@/components/supplies-used";
import type { ConsentFormDocument } from "@/lib/api/procedures";
import type { ClinicProcedure, Practitioner, ProcedureDefinition, ProcedureSupplyOptions, SupplyUse } from "@/lib/api/types";
import { draftFromTemplate } from "@/lib/supply-mapping";

export interface EncounterProcedures {
  items: ClinicProcedure[];
  definitions: ProcedureDefinition[];
  practitioners: Practitioner[];
  /** encounter.write (after signing, the API also needs encounter.amend). */
  canRecord: boolean;
  canAmend: boolean;
  currentUserId: string;
  /** Supplies used by these procedures (from inventory), and what the supplies form needs (encounter.write). */
  supplyUses: SupplyUse[];
  supplyOptions: ProcedureSupplyOptions | null;
  /** Signed consent forms uploaded for the patient (document.read); null when they cannot be listed. */
  consentDocuments: ConsentFormDocument[] | null;
}

/**
 * Procedures performed in this consultation (docs/domains/clinic.md, "Procedures"): recorded from the organization's
 * own catalogue with who performed them and the consent obtained; a mistake is marked entered in error with a reason
 * (never edited or deleted). Not for online consultations. Billing charges a procedure its catalogue maps to a
 * service. The supplies a procedure used are issued from inventory under it (and unused ones returned), like dental
 * procedures.
 */
export function ProceduresPanel({
  encounterId,
  patientId,
  status,
  inPerson,
  data,
}: {
  encounterId: string;
  patientId: string;
  status: "in_progress" | "completed" | "entered_in_error";
  inPerson: boolean;
  data: EncounterProcedures | null;
}) {
  const [adding, setAdding] = React.useState(false);
  if (!data) return null;
  const signed = status === "completed";
  const mayAdd = data.canRecord && inPerson && status !== "entered_in_error" && (!signed || data.canAmend) && data.definitions.length > 0;
  return (
    <section className="flex flex-col gap-2" aria-label="Procedures">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          <HandIcon className="size-3.5" aria-hidden /> Procedures
        </h3>
        {mayAdd && !adding ? (
          <Button type="button" size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden /> Record procedure
          </Button>
        ) : null}
      </div>
      {data.items.length ? (
        <ProcedureList
          procedures={data.items}
          patientId={patientId}
          definitions={data.definitions}
          documents={data.consentDocuments}
          canMark={(p) => data.canRecord && !p.enteredInError && (p.recordedBy === data.currentUserId || data.canAmend)}
          canAddConsent={data.canRecord}
          supplies={(p) => (
            <SuppliesUsed
              procedureId={p.id}
              active={!p.enteredInError}
              uses={data.supplyUses}
              options={data.supplyOptions}
              template={
                data.supplyOptions
                  ? draftFromTemplate(
                      data.supplyOptions.items.map((i) => i.id),
                      data.supplyOptions.templates.find((t) => t.definitionId === p.definitionId)?.items,
                    )
                  : []
              }
              canRecord={data.canRecord && data.supplyOptions !== null}
              onIssue={(input) => issueProcedureSupplies(encounterId, p.id, input)}
              onReturn={(input) => returnProcedureSupplies(encounterId, p.id, input)}
            />
          )}
        />
      ) : (
        <p className="text-table text-muted-foreground">No procedure recorded in this consultation.</p>
      )}
      {!inPerson ? <p className="text-meta text-muted-foreground">Procedures are recorded in in-person consultations.</p> : null}
      {inPerson && data.canRecord && !data.definitions.length ? (
        <p className="text-meta text-muted-foreground">No procedures in the catalogue yet: an administrator adds them under Clinic → Procedures.</p>
      ) : null}
      {adding ? (
        <RecordProcedureForm
          target={{ kind: "encounter", id: encounterId, signed }}
          patientId={patientId}
          definitions={data.definitions}
          practitioners={data.practitioners}
          documents={data.consentDocuments}
          onDone={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}
