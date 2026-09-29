import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { LabNonconformanceDetail } from "@/lib/api/types";
import { NonconformanceWorkspace } from "./nonconformance-workspace";

export const metadata = { title: "Nonconformance" };

export default async function NonconformancePage({ params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  if (!can(session, "lab.qc.read")) redirect("/");
  const record = await api<LabNonconformanceDetail>(`/laboratory/nonconformances/${id}`);
  return (
    <>
      <PageHeader
        title={`${record.number} · ${record.title}`}
        description="Investigation trail, corrective and preventive action. Entries are kept as recorded."
      />
      <NonconformanceWorkspace record={record} canEnter={can(session, "lab.qc.enter")} canManage={can(session, "lab.qc.manage")} />
    </>
  );
}
