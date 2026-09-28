import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabAvailableReagentLot, LabCatalogEntry, LabInstrument, LabReagentLoad, LabTest } from "@/lib/api/types";
import { InstrumentRegister } from "./instrument-register";

export const metadata = { title: "Laboratory instruments" };

export default async function InstrumentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Instruments" />
        <FacilityRequired action="Instruments belong to a facility's laboratory." />
      </>
    );
  }
  const includeRetired = params.show === "retired";
  const canLog = can(session, "lab.qc.enter");
  const [instruments, departments, reagents, available, tests] = await Promise.all([
    api<LabInstrument[]>("/laboratory/instruments", { query: { includeRetired: includeRetired ? "true" : undefined } }),
    api<LabCatalogEntry[]>("/laboratory/departments"),
    api<LabReagentLoad[]>("/laboratory/reagents"),
    // Lots to load come from inventory stock at this facility.
    canLog ? api<LabAvailableReagentLot[]>("/laboratory/reagents/available") : Promise.resolve([]),
    canLog ? api<LabTest[]>("/laboratory/tests") : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Instruments"
        description={`Analyzers and equipment at ${facility.name}, with their maintenance and calibration log. An instrument out of service cannot be used for QC or patient results.`}
      />
      <InstrumentRegister
        instruments={instruments}
        departments={departments}
        reagents={reagents}
        availableLots={available}
        tests={tests}
        includeRetired={includeRetired}
        canLog={canLog}
        canManage={can(session, "lab.qc.manage")}
      />
    </>
  );
}
