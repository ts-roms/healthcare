import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabStorageUnit } from "@/lib/api/types";
import { TemperatureBoard } from "./temperature-board";

export const metadata = { title: "Temperature monitoring" };

export default async function TemperaturesPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Temperature monitoring" />
        <FacilityRequired action="Storage units belong to a facility's laboratory." />
      </>
    );
  }
  const units = await api<LabStorageUnit[]>("/laboratory/storage-units", { query: { includeRetired: "true" } });
  return (
    <>
      <PageHeader
        title="Temperature monitoring"
        description={`Refrigerators, freezers, incubators and rooms at ${facility.name}, with the range and reading schedule the laboratory set. A reading outside the range must be explained and opens a nonconformance.`}
      />
      <TemperatureBoard units={units} canRecord={can(session, "lab.qc.enter")} canManage={can(session, "lab.qc.manage")} />
    </>
  );
}
