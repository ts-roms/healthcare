import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PatientThreadDetail } from "@/lib/api/types";
import { threadStatus, TOPIC_LABEL } from "@/lib/messaging-mapping";
import { ThreadActions } from "./thread-actions";

export const metadata = { title: "Conversation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PatientThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const [{ threadId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "patient.message.read")) redirect("/");
  if (!UUID.test(threadId)) notFound();
  let thread: PatientThreadDetail;
  try {
    thread = await api<PatientThreadDetail>(`/patient-messages/${threadId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const status = threadStatus(thread);
  return (
    <>
      <PageHeader
        title={thread.subject}
        description={`${TOPIC_LABEL[thread.topic]} · started by the ${thread.startedBy === "patient" ? "patient" : "clinic"}`}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
            <Badge variant={status.variant} className="ml-auto">
              {status.label}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ol className="flex flex-col gap-3" aria-label="Messages">
              {thread.messages.map((m) => (
                <li
                  key={m.id}
                  className={`flex max-w-[90%] flex-col gap-1 rounded-lg border p-3 ${m.sender === "staff" ? "self-end bg-primary-subtle" : "self-start bg-card"}`}
                >
                  <p className="flex items-baseline justify-between gap-3 text-meta text-muted-foreground">
                    <span className="font-medium">
                      {m.sender === "staff" ? (m.senderName ?? "Clinic") : `${thread.patientName}${m.viaGuardian ? " (written by a parent or guardian)" : ""}`}
                    </span>
                    <time dateTime={m.createdAt}>{clinicalDateTime(m.createdAt)}</time>
                  </p>
                  <p className="text-body whitespace-pre-line">{m.body}</p>
                </li>
              ))}
            </ol>
            <ThreadActions thread={thread} canManage={can(session, "patient.message.manage")} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Patient</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <Link className="text-primary hover:underline" href={`/patients/${thread.patientId}`}>
              {thread.patientName} · {thread.patientNumber}
            </Link>
            <Link className="text-primary hover:underline" href={`/messages?patientId=${thread.patientId}&view=all`}>
              All conversations with this patient
            </Link>
            <p className="text-meta text-muted-foreground">
              Assigned to: {thread.assignedTo?.displayName ?? "no one"}
              {thread.closedAt ? ` · closed ${clinicalDateTime(thread.closedAt)}` : ""}
            </p>
            <p className="text-meta text-muted-foreground">
              Patients are told MyHealth is not for emergencies and that messages are read during clinic hours. A reply sends the patient a text or email saying
              a message is waiting — never what it says.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
