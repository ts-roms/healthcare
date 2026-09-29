import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabEqaScheme, LabEqaSurvey, LabTest } from "@/lib/api/types";
import { EqaBoard } from "./eqa-board";

export const metadata = { title: "Proficiency testing" };

export default async function EqaPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Proficiency testing" />
        <FacilityRequired action="EQA rounds are recorded per facility." />
      </>
    );
  }
  const [schemes, surveys, tests] = await Promise.all([
    api<LabEqaScheme[]>("/laboratory/eqa/schemes"),
    api<LabEqaSurvey[]>("/laboratory/eqa/surveys"),
    api<LabTest[]>("/laboratory/tests"),
  ]);
  return (
    <>
      <PageHeader
        title="Proficiency testing (EQA)"
        description={`External quality assessment rounds at ${facility.name}: the results reported and the provider's evaluation, as the provider gave it. An unacceptable result opens a nonconformance.`}
      />
      <EqaBoard schemes={schemes} surveys={surveys} tests={tests} canEnter={can(session, "lab.qc.enter")} canManage={can(session, "lab.qc.manage")} />
    </>
  );
}
