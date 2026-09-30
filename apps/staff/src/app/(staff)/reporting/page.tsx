import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { CaseReportStatus, CaseReportSummary } from "@/lib/api/types";
import { CaseStatus, FoundByCheck } from "./case-status";
import { ReportingNav } from "./reporting-nav";

export const metadata = { title: "Disease reporting" };

const FILTERS: Array<{ key: CaseReportStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending_review", label: "To review" },
  { key: "reported", label: "Reported" },
  { key: "failed", label: "Not sent" },
  { key: "dismissed", label: "Dismissed" },
];

export default async function ReportingPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "doh.report.manage")) redirect("/");
  const show = FILTERS.find((f) => f.key === params.show)?.key ?? "all";
  const cases = await api<CaseReportSummary[]>("/doh/case-reports", { query: { status: show === "all" ? undefined : show } });
  return (
    <>
      <PageHeader
        title="Disease reporting"
        description="Case reports opened when a diagnosis matches your reportable conditions. Review each and report it through DOH's channel."
        actions={<ReportingNav canConfigure={can(session, "doh.settings.manage")} />}
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} asChild size="sm" variant={f.key === show ? "default" : "outline"}>
              <Link href={`/reporting?show=${f.key}`} aria-current={f.key === show ? "page" : undefined}>
                {f.label}
              </Link>
            </Button>
          ))}
        </nav>
        <Card className="py-0">
          {cases.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">
              No case reports. They appear when a recorded diagnosis matches one of your reportable conditions.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detected</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Diagnosis</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link className="underline-offset-2 hover:underline" href={`/reporting/${c.id}`}>
                        {clinicalDateTime(c.detectedAt)}
                      </Link>
                      {c.rescanId ? (
                        <div className="mt-1">
                          <FoundByCheck />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {c.patient ? (
                        <>
                          {c.patient.displayName} <span className="text-muted-foreground">· {c.patient.patientNumber}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{c.category}</TableCell>
                    <TableCell>
                      <span className="font-mono">{c.diagnosisCode}</span> {c.diagnosisDisplay}
                    </TableCell>
                    <TableCell>
                      <CaseStatus status={c.status} />
                      {c.externalReference ? <span className="ml-2 text-meta text-muted-foreground">Ref. {c.externalReference}</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {c.dueAt ? (
                        c.overdue ? (
                          <Badge variant="danger">
                            <TriangleAlertIcon aria-hidden /> Overdue · {clinicalDateTime(c.dueAt)}
                          </Badge>
                        ) : (
                          clinicalDateTime(c.dueAt)
                        )
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
