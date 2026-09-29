import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { RecordsRequestDetail } from "@/lib/api/types";
import { periodText, RECORDS_SCOPE_LABEL, RECORDS_STATUS, waitingText } from "@/lib/records-mapping";
import { RequestAnswer } from "./request-answer";

export const metadata = { title: "Records request" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);

export default async function RecordsRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const [{ requestId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "patient.records-request.manage")) redirect("/");
  if (!UUID.test(requestId)) notFound();
  let request: RecordsRequestDetail;
  try {
    request = await api<RecordsRequestDetail>(`/records-requests/${requestId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const open = request.status === "submitted" || request.status === "in_review";
  return (
    <>
      <PageHeader title={`Records request ${request.requestNumber}`} description="What the patient asked for in MyHealth, and your answer." />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>The request</CardTitle>
            <Badge variant={RECORDS_STATUS[request.status].variant} className="ml-auto">
              {RECORDS_STATUS[request.status].label}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p>
              <span className="text-muted-foreground">Patient: </span>
              {request.patient ? (
                <Link className="text-primary hover:underline" href={`/patients/${request.patientId}`}>
                  {request.patient.displayName} · {request.patient.patientNumber}
                </Link>
              ) : (
                "—"
              )}
            </p>
            <p>
              <span className="text-muted-foreground">Submitted: </span>
              {clinicalDateTime(request.submittedAt)}
              {open ? ` · waiting ${waitingText(request.daysWaiting).toLowerCase()}` : ""}
            </p>
            <p>
              <span className="text-muted-foreground">Asked for: </span>
              {request.scope.map((s) => RECORDS_SCOPE_LABEL[s]).join(", ")}
            </p>
            <p>
              <span className="text-muted-foreground">Period: </span>
              {periodText(request.periodFrom, request.periodTo, day)}
            </p>
            {request.details ? (
              <p>
                <span className="text-muted-foreground">Details: </span>
                {request.details}
              </p>
            ) : null}
            {request.purpose ? (
              <p>
                <span className="text-muted-foreground">Purpose: </span>
                {request.purpose}
              </p>
            ) : null}
            {request.responseNote ? (
              <p>
                <span className="text-muted-foreground">{request.status === "declined" ? "Reason given: " : "Note to the patient: "}</span>
                {request.responseNote}
              </p>
            ) : null}
            {request.shared.length ? (
              <div>
                <p className="text-muted-foreground">Shared:</p>
                <ul className="list-inside list-disc">
                  {request.shared.map((d) => (
                    <li key={d.documentId}>
                      {d.title}
                      {d.status !== "available" ? " (no longer available)" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-meta text-muted-foreground">
              Confirm the requester before releasing records, as your organization&apos;s Data Privacy Act procedures require. The patient reads your note or
              reason in MyHealth and is told by SMS or email that you answered (without details).
            </p>
          </CardContent>
        </Card>
        {open ? (
          <RequestAnswer request={request} />
        ) : (
          <Card>
            <CardContent className="py-4 text-table text-muted-foreground">
              {request.status === "withdrawn" ? "The patient withdrew this request." : `Answered ${clinicalDateTime(request.closedAt!)}.`}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
