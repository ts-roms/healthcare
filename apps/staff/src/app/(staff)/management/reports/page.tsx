import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getFacilities, getSession } from "@/lib/api/session";
import type { ManagementReportRun, ManagementReportSchedule, StaffUser } from "@/lib/api/types";
import { EXPORT_TABLES } from "@/lib/management-mapping";
import { ScheduleEditor } from "./schedule-editor";

export const metadata = { title: "Scheduled reports" };

const RUN_STATUS: Record<ManagementReportRun["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  producing: { label: "Producing…", tone: "neutral" },
  produced: { label: "Produced", tone: "success" },
  partial: { label: "Partly withheld", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

const tableLabel = (key: string) => EXPORT_TABLES.find((t) => t.key === key)?.label ?? key;

/** Weekly and monthly management reports: who gets which dashboard tables, and the reports produced so far. */
export default async function ScheduledReportsPage() {
  const session = await getSession();
  if (!can(session, "management.dashboard.read")) redirect("/");
  const manage = can(session, "management.report.manage");
  // Recipients are chosen from the staff list (user.read); without it, schedules can still be read, paused and resumed.
  const [schedules, runs, facilities, users] = await Promise.all([
    api<ManagementReportSchedule[]>("/management/report-schedules"),
    api<ManagementReportRun[]>("/management/reports"),
    getFacilities(),
    manage && can(session, "user.read") ? api<StaffUser[]>("/users") : Promise.resolve<StaffUser[] | null>(null),
  ]);
  const facilityName = (id: string | null) => (id === null ? "All facilities" : (facilities.find((f) => f.id === id)?.name ?? "A facility"));
  const scheduleName = (id: string) => schedules.find((s) => s.id === id)?.name ?? "Removed schedule";

  return (
    <>
      <PageHeader
        title="Scheduled reports"
        description="The management dashboard's tables as CSV files, produced once a week or month with the permissions of whoever set the schedule up. Recipients are told without figures."
        actions={
          <Link href="/management" className="text-table text-primary hover:underline">
            Management dashboard
          </Link>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <ScheduleEditor
          schedules={schedules}
          facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
          users={users?.filter((u) => u.membershipStatus === "active").map((u) => ({ id: u.id, name: u.displayName, email: u.email })) ?? null}
          canManage={manage}
          currentUserId={session.user.id}
        />

        <Card>
          <CardHeader>
            <CardTitle>Produced reports</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-table text-muted-foreground">
                Nothing produced yet. A schedule&apos;s first report follows the end of its first full week or month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead>Produced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const status = RUN_STATUS[run.status];
                    return (
                      <TableRow key={run.id}>
                        <TableCell>{scheduleName(run.scheduleId)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {clinicalDate(`${run.periodFrom}T12:00:00Z`)} – {clinicalDate(`${run.periodTo}T12:00:00Z`)}
                        </TableCell>
                        <TableCell>{facilityName(run.facilityId)}</TableCell>
                        <TableCell>
                          <Badge variant={status.tone}>{status.label}</Badge>
                          {run.withheld.length > 0 ? (
                            <p className="text-meta text-muted-foreground">Withheld: {run.withheld.map((w) => tableLabel(w.table)).join(", ")}</p>
                          ) : null}
                          {run.error ? <p className="text-meta text-danger">{run.error}</p> : null}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-x-3 gap-y-1">
                            {run.files.map((f) =>
                              f.storedAt ? (
                                <a key={f.table} href={`/management/reports/${run.id}/files/${f.table}`} download className="text-primary hover:underline">
                                  {tableLabel(f.table)}
                                </a>
                              ) : (
                                <span key={f.table} className="text-muted-foreground">
                                  {tableLabel(f.table)} (not produced)
                                </span>
                              ),
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{run.producedAt ? clinicalDateTime(run.producedAt) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <p className="text-meta text-muted-foreground">
          Files keep the dashboard&apos;s rules: patient counts under five show as “&lt;5”, and revenue tables open only for people with billing report access
          for every facility of the report. Every download is recorded in the audit trail. Operational figures, not official or BIR reports.
        </p>
      </div>
    </>
  );
}
