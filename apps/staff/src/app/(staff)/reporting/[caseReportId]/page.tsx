import { notFound, redirect } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { CaseReportDetail } from "@/lib/api/types";
import { ReportingNav } from "../reporting-nav";
import { CaseReview } from "./case-review";

export const metadata = { title: "Case report" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CaseReportPage({ params }: { params: Promise<{ caseReportId: string }> }) {
  const [{ caseReportId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "doh.report.manage")) redirect("/");
  if (!UUID.test(caseReportId)) notFound();
  const detail = await api<CaseReportDetail>(`/doh/case-reports/${caseReportId}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const p = detail.report.patient;
  return (
    <>
      <PageHeader
        title={`${detail.category} — case report`}
        description={`${p.familyName.toUpperCase()}, ${p.givenName} · ${p.patientNumber}`}
        actions={<ReportingNav canConfigure={can(session, "doh.settings.manage")} />}
      />
      <CaseReview detail={detail} />
    </>
  );
}
