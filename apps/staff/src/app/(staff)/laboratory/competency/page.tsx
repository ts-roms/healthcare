import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabCatalogEntry, LabCompetencyOverview, LabTest } from "@/lib/api/types";
import { CompetencyBoard } from "./competency-board";

export const metadata = { title: "Staff competency" };

export default async function CompetencyPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Staff competency" />
        <FacilityRequired action="Competency is recorded per facility." />
      </>
    );
  }
  const [overview, tests, departments] = await Promise.all([
    api<LabCompetencyOverview>("/laboratory/competency"),
    api<LabTest[]>("/laboratory/tests"),
    api<LabCatalogEntry[]>("/laboratory/departments"),
  ]);
  return (
    <>
      <PageHeader
        title="Staff competency"
        description={`Competency assessments of staff who enter results at ${facility.name}, per test or section. Areas and intervals follow your laboratory's programme.`}
      />
      <CompetencyBoard overview={overview} tests={tests} departments={departments} currentUserId={session.user.id} canAssess={can(session, "lab.qc.manage")} />
    </>
  );
}
