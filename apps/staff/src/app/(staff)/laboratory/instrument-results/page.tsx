import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@healthcare/ui/primitives";
import { FacilityRequired } from "@/components/facility-required";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabInstrumentResultRow } from "@/lib/api/types";
import { InstrumentResultReview } from "./instrument-result-review";

export const metadata = { title: "Instrument results" };

/**
 * Results analyzers sent through the instrument gateway. Each waits here until someone accepts it — it is then entered
 * as the test's result and verified and approved as usual — or sets it aside with a reason.
 */
export default async function InstrumentResultsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "lab.result.read")) redirect("/");
  if (!facility) {
    return (
      <>
        <PageHeader title="Instrument results" />
        <FacilityRequired action="Instrument results belong to a facility's laboratory." />
      </>
    );
  }
  const view = params.view === "decided" ? "decided" : "pending";
  const rows = await api<LabInstrumentResultRow[]>("/laboratory/instrument-results", { query: { state: view } });
  return (
    <>
      <PageHeader
        title="Instrument results"
        description={`Results analyzers at ${facility.name} sent. Accept a matched result to enter it (it is then verified and approved as usual), or set it aside with a reason. Flags and status codes are shown as the analyzer sent them.`}
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="View" className="flex gap-1">
          {(["pending", "decided"] as const).map((v) => (
            <Button key={v} asChild size="sm" variant={view === v ? "default" : "outline"}>
              <Link
                href={v === "pending" ? "/laboratory/instrument-results" : "/laboratory/instrument-results?view=decided"}
                aria-current={view === v ? "page" : undefined}
              >
                {v === "pending" ? "To review" : "Recently decided"}
              </Link>
            </Button>
          ))}
        </nav>
        <InstrumentResultReview rows={rows} canDecide={can(session, "lab.result.enter")} decided={view === "decided"} />
      </div>
    </>
  );
}
