import { ModulePage } from "@/components/module-page";
import { SettingsStack } from "@/components/settings-page";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabInstrument, LabQcBoard, LabQcMaterial, LabTest } from "@/lib/api/types";
import { QcWorkspace } from "./qc-workspace";

export const metadata = { title: "Quality control" };

export default async function QualityControlPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Quality control">
        <FacilityRequired action="QC runs belong to a facility's instruments." />
      </ModulePage>
    );
  }
  const [board, materials, instruments, tests] = await Promise.all([
    api<LabQcBoard>("/laboratory/qc/status"),
    api<LabQcMaterial[]>("/laboratory/qc/materials"),
    api<LabInstrument[]>("/laboratory/instruments"),
    api<LabTest[]>("/laboratory/tests"),
  ]);
  return (
    <ModulePage
      title="Quality control"
      description={`Internal QC at ${facility.name}: control values against each lot's target, evaluated with this facility's Westgard rules.`}
      details={["Decision support for the laboratory's review."]}
    >
      <SettingsStack>
        <QcWorkspace
          board={board}
          materials={materials}
          instruments={instruments}
          tests={tests.filter((t) => t.resultType === "numeric")}
          canEnter={can(session, "lab.qc.enter")}
          canManage={can(session, "lab.qc.manage")}
        />
      </SettingsStack>
    </ModulePage>
  );
}
