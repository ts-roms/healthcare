import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabCatalogEntry, LabDashboard, LabSpecimenType, LabWorklistRow, ReferenceLaboratory } from "@/lib/api/types";
import { isStage, STAGES } from "@/lib/lab-mapping";
import { LabWorkbench } from "./workbench";

export const metadata = { title: "Lab workbench" };

export default async function WorklistPage({ searchParams }: { searchParams: Promise<{ stage?: string; department?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "lab.order.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Laboratory" />
        <FacilityRequired action="Worklists belong to a facility's laboratory." />
      </>
    );
  }
  // Default to the first stage this user can act on.
  const stage = isStage(params.stage) ? params.stage : (STAGES.find((s) => can(session, s.permission))?.stage ?? "collect");
  const departmentId = params.department && /^[0-9a-f-]{36}$/.test(params.department) ? params.department : undefined;
  const [rows, dashboard, departments, specimenTypes, referenceLabs] = await Promise.all([
    api<LabWorklistRow[]>("/laboratory/worklist", { query: { stage, departmentId } }),
    can(session, "lab.dashboard.read") ? api<LabDashboard>("/laboratory/dashboard") : Promise.resolve(null),
    api<LabCatalogEntry[]>("/laboratory/departments"),
    api<LabSpecimenType[]>("/laboratory/specimen-types"),
    api<ReferenceLaboratory[]>("/laboratory/reference-labs"),
  ]);
  return (
    <LabWorkbench
      key={`${stage}:${departmentId ?? ""}`}
      facilityName={facility.name}
      stage={stage}
      departmentId={departmentId ?? null}
      rows={rows}
      dashboard={dashboard}
      departments={departments}
      specimenTypes={specimenTypes}
      referenceLabs={referenceLabs}
      permissions={{
        collect: can(session, "lab.specimen.collect"),
        receive: can(session, "lab.specimen.receive"),
        reject: can(session, "lab.specimen.reject"),
        enter: can(session, "lab.result.enter"),
        verify: can(session, "lab.result.verify"),
        approve: can(session, "lab.result.approve"),
        release: can(session, "lab.result.release"),
        amend: can(session, "lab.result.amend"),
      }}
    />
  );
}
