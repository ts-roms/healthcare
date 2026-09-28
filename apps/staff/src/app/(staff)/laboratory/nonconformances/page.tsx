import Link from "next/link";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabInstrument, LabNonconformance } from "@/lib/api/types";
import { NonconformanceList } from "./nonconformance-list";

export const metadata = { title: "Nonconformances" };

export default async function NonconformancesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "lab.qc.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Nonconformances" />
        <FacilityRequired action="Nonconformances are recorded per facility." />
      </>
    );
  }
  const show = params.show === "closed" || params.show === "all" ? params.show : "open";
  const [records, instruments] = await Promise.all([
    api<LabNonconformance[]>("/laboratory/nonconformances", { query: { status: show } }),
    api<LabInstrument[]>("/laboratory/instruments"),
  ]);
  return (
    <>
      <PageHeader
        title="Nonconformances"
        description="Incidents and nonconformities with their investigation and corrective action. Temperature excursions and unacceptable EQA results open one automatically."
        actions={
          <span className="flex gap-3 text-meta">
            {(["open", "closed", "all"] as const).map((s) => (
              <Link key={s} href={`/laboratory/nonconformances?show=${s}`} className={s === show ? "font-semibold" : "text-primary hover:underline"}>
                {s === "open" ? "Open" : s === "closed" ? "Closed" : "All"}
              </Link>
            ))}
          </span>
        }
      />
      <NonconformanceList records={records} instruments={instruments} canReport={can(session, "lab.qc.enter")} />
    </>
  );
}
