import { STAFF_ROLES, type StaffRole } from "@healthcare/domain";
import { ActionMetric, AppointmentCard, AttentionList, QueueBoard, type AttentionItem } from "@healthcare/ui/healthcare";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { isCriticalFlag } from "@healthcare/ui/healthcare";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DEMO_NOW, getAppointments, getLabWorklist, getQueue } from "@/lib/data";
import { getRole } from "@/lib/role";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const role = await getRole();
  const label = STAFF_ROLES.find((r) => r.value === role)?.label;
  return (
    <>
      <PageHeader title="Today" description={`Saturday, 27 September 2026 · ${label}`} />
      <div className="p-4">{await dashboardFor(role)}</div>
    </>
  );
}

async function dashboardFor(role: StaffRole) {
  if (role === "lab-tech") return <LabDashboard />;
  if (role === "doctor" || role === "dentist") return <DoctorDashboard />;
  return <FrontDeskDashboard />;
}

async function DoctorDashboard() {
  const [appts, labs] = await Promise.all([getAppointments(), getLabWorklist()]);
  const critical = labs.filter((o) => o.observations.some((x) => isCriticalFlag(x.flag)));
  const attention: AttentionItem[] = [
    {
      id: "crit",
      severity: "critical",
      count: critical.length,
      title: "Critical lab results",
      detail: critical.map((o) => `${o.test} — ${o.patientName}`).join(", "),
      href: "/laboratory/worklist",
    },
    { id: "fu", severity: "warning", count: 5, title: "Patients due for follow-up", detail: "Care-plan reviews overdue this week", href: "/clinic/care-plans" },
    { id: "unsigned", severity: "warning", count: 2, title: "Unsigned encounters", detail: "Oldest from 26 Sep", href: "/clinic/encounters" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-1">
        <ActionMetric value={appts.length + 8} label="Patients" href="/appointments" />
        <ActionMetric value={3} label="Waiting" tone="warning" href="/queue" />
        <ActionMetric value={appts.filter((a) => a.mode === "online").length + 1} label="Online" href="/telemedicine" />
        <ActionMetric value={4} label="Follow-ups" href="/clinic/care-plans" />
      </Card>
      <AttentionList items={attention} />
      <Card>
        <CardHeader>
          <CardTitle>Next patients</CardTitle>
          <CardAction>
            <Link href="/appointments" className="text-meta text-primary hover:underline">
              Full schedule
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="divide-y py-0">
          {appts.map((a) => (
            <Link key={a.id} href={a.mode === "online" ? `/telemedicine/e-5302` : `/clinic/encounters/e-5501`} className="block hover:bg-accent/40">
              <AppointmentCard appointment={a} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

async function LabDashboard() {
  const labs = await getLabWorklist();
  const critical = labs.filter((o) => o.observations.some((x) => isCriticalFlag(x.flag)));
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Card className="p-1">
        <ActionMetric value={128} label="Orders" href="/laboratory/worklist" />
        <ActionMetric value={96} label="Processing" href="/laboratory/worklist" />
        <ActionMetric value={22} label="Awaiting verification" tone="warning" href="/laboratory/worklist" />
        <ActionMetric value={10} label="Critical" tone="critical" href="/laboratory/worklist" />
        <div className="mt-1 border-t px-2 py-2">
          <p className="text-meta tracking-wide text-muted-foreground uppercase">Average TAT</p>
          <p className="tabular text-page font-semibold">1h 42m</p>
        </div>
      </Card>
      <AttentionList
        items={[
          {
            id: "crit",
            severity: "critical",
            count: critical.length,
            title: "Critical results to call",
            detail: critical.map((o) => `${o.accession} ${o.test} — ${o.patientName}`).join(", "),
            href: "/laboratory/worklist",
          },
          {
            id: "rej",
            severity: "warning",
            count: 7,
            title: "Specimens rejected",
            detail: "Hemolyzed ×4, clotted ×2, unlabeled ×1",
            href: "/laboratory/specimens",
          },
          { id: "qc", severity: "info", count: 1, title: "QC due", detail: "Chemistry analyser level 2 control at 12:00", href: "/laboratory/qc" },
        ]}
      />
    </div>
  );
}

async function FrontDeskDashboard() {
  const queue = await getQueue();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Card className="p-1">
          <ActionMetric value={queue.filter((q) => q.status === "waiting").length} label="Waiting" tone="warning" href="/queue" />
          <ActionMetric value={queue.filter((q) => q.status === "vitals").length} label="In triage" href="/queue" />
          <ActionMetric value={queue.filter((q) => q.status === "for-billing").length} label="For billing" href="/billing" />
          <ActionMetric value={6} label="Arrivals expected" href="/appointments" />
        </Card>
        <AttentionList
          items={[
            { id: "phil", severity: "warning", count: 2, title: "PhilHealth eligibility unverified", detail: "Juan Cruz, Ramon Garcia", href: "/patients" },
            { id: "prio", severity: "info", count: 2, title: "Priority lane patients", detail: "Senior citizen, pregnant", href: "/queue" },
          ]}
        />
      </div>
      <QueueBoard entries={queue} now={DEMO_NOW} hideDone />
    </div>
  );
}
