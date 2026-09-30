"use client";

import { SuppliesUsed } from "@/components/supplies-used";
import type { DentalSupplyOptions, DentalSupplyUse } from "@/lib/api/types";
import { supplyDraft } from "@/lib/dental-mapping";
import { recordSupplies, returnSupplies } from "../../actions";

/** The supplies a dental procedure used (the shared panel, with the procedure type's template and dental actions). */
export function ProcedureSupplies({
  patientId,
  procedure,
  uses,
  options,
  canRecord,
}: {
  patientId: string;
  procedure: { id: string; procedureTypeId: string; status: "recorded" | "entered_in_error" };
  uses: DentalSupplyUse[];
  options: DentalSupplyOptions | null;
  canRecord: boolean;
}) {
  return (
    <SuppliesUsed
      procedureId={procedure.id}
      active={procedure.status === "recorded"}
      uses={uses}
      options={options}
      template={options ? supplyDraft(options, procedure.procedureTypeId) : []}
      canRecord={canRecord}
      onIssue={(input) => recordSupplies(patientId, procedure.id, input)}
      onReturn={(input) => returnSupplies(patientId, procedure.id, input)}
    />
  );
}
