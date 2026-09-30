import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { RecordsRequest } from "@/lib/api/types";
import { periodText, RECORDS_SCOPE_LABEL, RECORDS_STATUS, waitingText } from "@/lib/records-mapping";

export const metadata = { title: "Records requests" };

const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Answered" },
  { key: "all", label: "All" },
] as const;

/** Patients' requests for copies of their records (MyHealth): open ones oldest first. Opening one is audited. */
export default async function RecordsRequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "patient.records-request.manage")) redirect("/");
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "open";
  const requests = await api<RecordsRequest[]>("/records-requests", { query: { status: view } });
  return (
    <>
      <PageHeader
        title="Records requests"
        description="Patients ask in MyHealth for copies of their records. Check the request, then share documents from the patient's record or decline with a reason the patient will read. Follow your organization's Data Privacy Act procedures for what to release and when."
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="View" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Button key={v.key} asChild size="sm" variant={view === v.key ? "default" : "outline"}>
              <Link href={v.key === "open" ? "/records/requests" : `/records/requests?view=${v.key}`} aria-current={view === v.key ? "page" : undefined}>
                {v.label}
              </Link>
            </Button>
          ))}
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <Link href="/records/requests/settings">Your procedure</Link>
          </Button>
        </nav>
        <Card className="py-0">
          {requests.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">{view === "open" ? "No open requests." : "No requests."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Asked for</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">{r.requestNumber}</span>
                      <span className="block text-meta text-muted-foreground">
                        {clinicalDateTime(r.submittedAt)}
                        {r.status === "submitted" || r.status === "in_review" ? ` · waiting ${waitingText(r.daysWaiting).toLowerCase()}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.patient ? (
                        <>
                          {r.patient.displayName} <span className="text-muted-foreground">· {r.patient.patientNumber}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-meta">
                      {r.scope.map((s) => RECORDS_SCOPE_LABEL[s]).join(", ")}
                      <span className="block text-muted-foreground">{periodText(r.periodFrom, r.periodTo, (d) => clinicalDate(`${d}T12:00:00Z`))}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={RECORDS_STATUS[r.status].variant}>{RECORDS_STATUS[r.status].label}</Badge>
                      {r.overdue ? (
                        <Badge variant="danger" className="ml-1">
                          <TriangleAlertIcon aria-hidden /> Past {day(r.respondBy!)}
                        </Badge>
                      ) : r.respondBy && (r.status === "submitted" || r.status === "in_review") ? (
                        <span className="block text-meta text-muted-foreground">Respond by {day(r.respondBy)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="xs" variant="outline">
                        <Link href={`/records/requests/${r.id}`}>{r.status === "submitted" || r.status === "in_review" ? "Review" : "Open"}</Link>
                      </Button>
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
