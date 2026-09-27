import { cookies } from "next/headers";
import Link from "next/link";
import { SearchIcon, UserPlusIcon } from "lucide-react";
import { ActionMetric, AppointmentCard, AttentionList, isCriticalFlag, QueueBoard, type AttentionItem } from "@healthcare/ui/healthcare";
import { Button, Card, CardAction, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { COOKIES } from "@/lib/api/config";
import { can, getFacilities, getSession } from "@/lib/api/session";
import { DEMO_NOW, getAppointments, getLabWorklist, getQueue } from "@/lib/demo-data";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [session, facilities, jar] = await Promise.all([getSession(), getFacilities(), cookies()]);
  const facility = facilities.find((f) => f.id === jar.get(COOKIES.facility)?.value);
  return (
    <>
      <PageHeader
        title={`Welcome, ${session.user.displayName}`}
        description={`${session.organization.name}${facility ? ` · ${facility.name}` : ""}`}
        actions={
          <>
            {can(session, "patient.search") ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/patients">
                  <SearchIcon /> Find patient
                </Link>
              </Button>
            ) : null}
            {can(session, "patient.register") ? (
              <Button asChild size="sm">
                <Link href="/patients/new">
                  <UserPlusIcon /> Register patient
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {facilities.length > 1 && !facility ? (
        <p className="border-b bg-info-subtle px-4 py-2 text-table text-info-foreground">
          Select your facility in the top bar. Registering patients needs one.
        </p>
      ) : null}
      {can(session, "patient.read") ? (
        <section className="p-4" aria-labelledby="preview-heading">
          <div className="mb-2 flex items-baseline gap-2">
            <h2 id="preview-heading" className="text-section font-semibold">
              Clinical dashboards
            </h2>
            <span className="rounded-sm border border-warning/40 bg-warning-subtle px-1.5 text-meta font-medium text-warning-foreground">Demo data</span>
            <span className="text-meta text-muted-foreground">Preview until appointments, queue and laboratory are connected (Phase 2+).</span>
          </div>
          <Tabs defaultValue="doctor">
            <TabsList>
              <TabsTrigger value="doctor">Doctor</TabsTrigger>
              <TabsTrigger value="lab">Laboratory</TabsTrigger>
              <TabsTrigger value="front-desk">Front desk</TabsTrigger>
            </TabsList>
            <TabsContent value="doctor" className="pt-2">
              <DoctorDashboard />
            </TabsContent>
            <TabsContent value="lab" className="pt-2">
              <LabDashboard />
            </TabsContent>
            <TabsContent value="front-desk" className="pt-2">
              <FrontDeskDashboard />
            </TabsContent>
          </Tabs>
        </section>
      ) : null}
    </>
  );
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
