import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import type { CareActivityKind, DueCareActivity } from "@/lib/api/types";
import { KIND_LABEL } from "@/lib/care-plan-form";
import { todayIn } from "@/lib/clinic-mapping";
import { RecallActions } from "./recall-actions";

export const metadata = { title: "Recall list" };

const HORIZONS = [7, 30, 90] as const;

/** Patient recall: open care-plan activities that are overdue or due soon, across the organization's active plans. */
export default async function RecallListPage({ searchParams }: { searchParams: Promise<{ within?: string; kind?: string }> }) {
  const [params, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "care-plan.read")) redirect("/");
  const withinDays = HORIZONS.find((h) => String(h) === params.within) ?? 7;
  const kind = params.kind && params.kind in KIND_LABEL ? (params.kind as CareActivityKind) : undefined;
  const rows = await api<DueCareActivity[]>("/care-plans/activities/due", { query: { withinDays, kind } });
  const overdue = rows.filter((r) => r.overdue);
  const today = todayIn(facility?.timezone ?? "Asia/Manila");
  const href = (change: { within?: number; kind?: string }) => {
    const q = new URLSearchParams({ within: String(change.within ?? withinDays) });
    const k = "kind" in change ? change.kind : kind;
    if (k) q.set("kind", k);
    return `/clinic/care-plans?${q}`;
  };
  const canManage = can(session, "care-plan.manage");
  const canBook = can(session, "appointment.manage");

  return (
    <>
      <PageHeader
        title="Recall list"
        description={`Care-plan activities overdue or due in the next ${withinDays} days · ${overdue.length} overdue`}
        actions={
          <nav aria-label="Horizon" className="flex gap-1">
            {HORIZONS.map((h) => (
              <Button key={h} asChild size="sm" variant={h === withinDays ? "default" : "outline"}>
                <Link href={href({ within: h })}>{h} days</Link>
              </Button>
            ))}
          </nav>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="Activity type" className="flex flex-wrap gap-1">
          <Button asChild size="xs" variant={kind ? "ghost" : "secondary"}>
            <Link href={href({ kind: undefined })}>All</Link>
          </Button>
          {(Object.keys(KIND_LABEL) as CareActivityKind[]).map((k) => (
            <Button key={k} asChild size="xs" variant={kind === k ? "secondary" : "ghost"}>
              <Link href={href({ kind: k })}>{KIND_LABEL[k]}</Link>
            </Button>
          ))}
        </nav>
        <Card className="py-0">
          {rows.length === 0 ? <p className="p-4 text-body text-muted-foreground">Nothing is due in this period.</p> : null}
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Due</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Care plan</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular">
                      {r.dueDate ? clinicalDate(r.dueDate) : "—"}
                      {r.overdue ? (
                        <Badge variant="danger" className="ml-1.5">
                          <AlertTriangleIcon aria-hidden /> Overdue
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {can(session, "patient.read") ? (
                        <Link href={`/patients/${r.patientId}`} className="font-medium text-primary hover:underline">
                          {r.patient?.displayName ?? "Patient"}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.patient?.displayName ?? "Patient"}</span>
                      )}
                      {r.patient ? <span className="block font-mono text-meta text-muted-foreground">{r.patient.patientNumber}</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{KIND_LABEL[r.kind]}</Badge> {r.description}
                      <span className="block text-meta text-muted-foreground">
                        {r.assignee === "patient" ? "Patient task" : "Care team"}
                        {r.recurrenceIntervalDays ? ` · every ${r.recurrenceIntervalDays} days` : ""}
                        {r.lastReminderAt ? ` · patient reminded ${clinicalDate(r.lastReminderAt)}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link href={`/clinic/care-plans/${r.carePlanId}`} className="text-primary hover:underline">
                        {r.planTitle}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <RecallActions
                        activity={{
                          id: r.id,
                          carePlanId: r.carePlanId,
                          patientId: r.patientId,
                          kind: r.kind,
                          status: r.status,
                          description: r.description,
                          dueDate: r.dueDate,
                        }}
                        today={today}
                        canManage={canManage}
                        canBook={canBook}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Card>
        <p className="text-meta text-muted-foreground">
          Shows planned and in-progress activities of active care plans across the organization. Contact patients according to their communication preferences
          and consent.
        </p>
      </div>
    </>
  );
}
