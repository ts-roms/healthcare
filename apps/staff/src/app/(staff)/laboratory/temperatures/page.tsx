import { ModulePage } from "@/components/module-page";
import { SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
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
      <ModulePage title="Temperature monitoring">
        <FacilityRequired action="Storage units belong to a facility's laboratory." />
      </ModulePage>
    );
  }
  const units = await api<LabStorageUnit[]>("/laboratory/storage-units", { query: { includeRetired: "true" } });
  return (
    <ModulePage
      title="Temperature monitoring"
      description={`Refrigerators, freezers, incubators and rooms at ${facility.name}, with the range and reading schedule the laboratory set.`}
      details={["A reading outside the range must be explained and opens a nonconformance."]}
    >
      <SettingsStack>
        <TemperatureBoard units={units} canRecord={can(session, "lab.qc.enter")} canManage={can(session, "lab.qc.manage")} />
      </SettingsStack>
    </ModulePage>
  );
}
