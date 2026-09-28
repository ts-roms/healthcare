import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { DohFacilityCode, DohRescanOverview, ReportableRule } from "@/lib/api/types";
import { ReportingNav } from "../reporting-nav";
import { ReportingSettings } from "./reporting-settings";

export const metadata = { title: "Reportable conditions" };

export default async function ReportingSettingsPage() {
  const [session, facility] = await Promise.all([getSession(), getSelectedFacility()]);
  if (!can(session, "doh.settings.manage")) redirect("/reporting");
  const [rules, rescans, code] = await Promise.all([
    api<ReportableRule[]>("/doh/rules"),
    api<DohRescanOverview>("/doh/rescans"),
    facility
      ? api<{ facilityCode: DohFacilityCode | null }>(`/doh/facilities/${facility.id}/facility-code`).then((r) => r.facilityCode)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Reportable conditions"
        description="Which diagnoses open a case report, as your organization configures them from the DOH issuances it follows."
        actions={<ReportingNav canConfigure />}
      />
      <ReportingSettings
        rules={rules}
        rescans={rescans.rescans}
        today={rescans.today}
        timeZone={rescans.timeZone}
        facility={facility ? { id: facility.id, name: facility.name, code } : null}
      />
    </>
  );
}
