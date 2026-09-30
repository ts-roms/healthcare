"use client";

import Link from "next/link";
import { SyringeIcon } from "lucide-react";
import { ImmunizationHistory, RecordImmunizationButtons } from "@/components/immunizations/immunization-panel";
import type { ImmunizationRecord, Vaccine, VaccineStockLot } from "@/lib/api/types";

export interface EncounterImmunizations {
  /** Doses recorded in this consultation. */
  thisVisit: ImmunizationRecord[];
  /** The patient's whole history (latest first). */
  history: ImmunizationRecord[];
  vaccines: Vaccine[];
  lots: VaccineStockLot[] | null;
  canRecord: boolean;
  facilitySelected: boolean;
}

/**
 * Immunizations in the encounter workspace: record a dose given (or not given) in this consultation, optionally from
 * stock, and see the history alongside. The history says what was recorded, never which dose is due.
 */
export function ImmunizationsPanel({
  encounterId,
  patientId,
  open,
  data,
}: {
  encounterId: string;
  patientId: string;
  /** The consultation is in progress or signed (not entered in error). */
  open: boolean;
  data: EncounterImmunizations | null;
}) {
  if (!data) return null;
  const earlier = data.history.filter((r) => r.encounterId !== encounterId && !r.enteredInError).slice(0, 5);
  return (
    <section className="flex flex-col gap-2" aria-label="Immunizations">
      <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        <SyringeIcon className="size-3.5" aria-hidden /> Immunizations
      </h3>
      {data.thisVisit.length ? (
        <ImmunizationHistory patientId={patientId} records={data.thisVisit} canRecord={data.canRecord} grouped={false} encounterId={encounterId} />
      ) : (
        <p className="text-table text-muted-foreground">No dose recorded in this consultation.</p>
      )}
      {data.canRecord && open ? (
        <RecordImmunizationButtons
          patientId={patientId}
          vaccines={data.vaccines}
          lots={data.lots}
          documents={null}
          facilitySelected={data.facilitySelected}
          encounterId={encounterId}
          reported={false}
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-meta font-medium text-muted-foreground">Earlier</p>
        {earlier.length ? (
          <ImmunizationHistory patientId={patientId} records={earlier} canRecord={false} grouped={false} />
        ) : (
          <p className="text-table text-muted-foreground">No earlier immunizations recorded.</p>
        )}
        <Link href={`/patients/${patientId}/immunizations`} className="text-table text-primary hover:underline">
          Full immunization history
        </Link>
      </div>
    </section>
  );
}
