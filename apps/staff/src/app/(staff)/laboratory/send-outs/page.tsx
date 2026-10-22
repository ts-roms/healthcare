import { ModulePage } from "@/components/module-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { LabDashboard, LabSendOut, LabSendOutDispatchSummary, ReferenceLabSubmissionStatus } from "@/lib/api/types";
import { SendOutsView } from "./send-outs";

export const metadata = { title: "Send-outs" };

const VIEWS = [
  { view: "to_dispatch", label: "To dispatch", count: (d: LabDashboard) => d.sendOutsToDispatch },
  { view: "awaiting", label: "Awaiting results", count: (d: LabDashboard) => d.sendOutsAwaitingResults },
  { view: "closed", label: "Closed", count: () => null },
] as const;
type View = (typeof VIEWS)[number]["view"];

export default async function SendOutsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [session, facility, params] = await Promise.all([getSession(), getSelectedFacility(), searchParams]);
  if (!can(session, "lab.order.read")) redirect("/");
  if (!facility) {
    return (
      <ModulePage title="Send-outs">
        <FacilityRequired action="Send-outs belong to a facility's laboratory." />
      </ModulePage>
    );
  }
  const view: View = VIEWS.some((v) => v.view === params.view) ? (params.view as View) : "awaiting";
  const [rows, dispatches, dashboard, integration] = await Promise.all([
    api<LabSendOut[]>("/laboratory/send-outs", { query: { view } }),
    api<LabSendOutDispatchSummary[]>("/laboratory/send-out-dispatches"),
    can(session, "lab.dashboard.read") ? api<LabDashboard>("/laboratory/dashboard") : Promise.resolve(null),
    api<ReferenceLabSubmissionStatus["integration"]>("/integrations/reference-laboratories"),
  ]);
  return (
    <ModulePage
      title="Send-outs"
      description={`${facility.name} · tests referred to reference laboratories.`}
      details={["Dispatch with a manifest, record the results coming back, then enter and sign them off as usual."]}
      actions={
        <Link href="/laboratory/catalog#reference-laboratories" className="text-meta text-primary hover:underline">
          Reference laboratories and referred tests
        </Link>
      }
    >
      <nav aria-label="Send-out view" className="mb-3 flex flex-wrap gap-1">
        {VIEWS.map((v) => {
          const count = dashboard ? v.count(dashboard) : null;
          return (
            <Link
              key={v.view}
              href={`/laboratory/send-outs?view=${v.view}`}
              aria-current={v.view === view ? "page" : undefined}
              className={`rounded-md border px-2.5 py-1 text-table ${v.view === view ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
            >
              {v.label}
              {count !== null ? <span className="tabular ml-1.5 opacity-80">{count}</span> : null}
            </Link>
          );
        })}
        {dashboard?.sendOutsOverdue ? (
          <span className="self-center text-meta font-semibold text-critical">{dashboard.sendOutsOverdue} past the expected turnaround</span>
        ) : null}
      </nav>
      <SendOutsView
        key={view}
        view={view}
        rows={rows}
        dispatches={dispatches}
        integration={integration}
        permissions={{ handle: can(session, "lab.specimen.receive"), reject: can(session, "lab.specimen.reject") }}
      />
    </ModulePage>
  );
}
