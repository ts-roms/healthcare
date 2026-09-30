import Link from "next/link";
import { redirect } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PatientThread } from "@/lib/api/types";
import { MESSAGE_VIEWS, messageView, threadStatus, TOPIC_LABEL, waitingFor } from "@/lib/messaging-mapping";

export const metadata = { title: "Patient messages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conversations patients start in MyHealth, the ones waiting for a reply first (longest wait on top). Messages are read
 * during clinic hours; patients are told MyHealth is not for emergencies. Opening a conversation is audited.
 */
export default async function PatientMessagesPage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string; patientId?: string }> }) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  if (!can(session, "patient.message.read")) redirect("/");
  const view = messageView(params.view);
  const mine = params.mine === "1";
  const patientId = params.patientId && UUID.test(params.patientId) ? params.patientId : undefined;
  const threads = await api<PatientThread[]>("/patient-messages", { query: { filter: view, assignedToMe: mine ? "true" : undefined, patientId } });
  const link = (next: { view?: string; mine?: boolean }) => {
    const q = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "awaiting") q.set("view", v);
    if (next.mine ?? mine) q.set("mine", "1");
    if (patientId) q.set("patientId", patientId);
    return q.size ? `/messages?${q}` : "/messages";
  };
  return (
    <>
      <PageHeader
        title="Patient messages"
        description="Conversations patients start in MyHealth. Read during clinic hours and reply in plain words. Patients are told this is not for emergencies; if a message describes one, call the patient."
      />
      <div className="flex flex-col gap-3 p-4">
        <nav aria-label="View" className="flex flex-wrap items-center gap-1">
          {MESSAGE_VIEWS.map((v) => (
            <Button key={v.key} asChild size="sm" variant={view === v.key ? "default" : "outline"}>
              <Link href={link({ view: v.key })} aria-current={view === v.key ? "page" : undefined}>
                {v.label}
              </Link>
            </Button>
          ))}
          <Button asChild size="sm" variant={mine ? "default" : "outline"} className="ml-2">
            <Link href={link({ mine: !mine })} aria-pressed={mine}>
              Assigned to me
            </Link>
          </Button>
          {patientId ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/messages">Clear patient filter</Link>
            </Button>
          ) : null}
        </nav>
        <Card className="py-0">
          {threads.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">{view === "awaiting" ? "Nothing is waiting for a reply." : "No conversations."}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {threads.map((t) => {
                  const status = threadStatus(t);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        {t.patientName} <span className="text-muted-foreground">· {t.patientNumber}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{t.subject}</span>
                        <span className="block text-meta text-muted-foreground">
                          {TOPIC_LABEL[t.topic]} · {t.messageCount} {t.messageCount === 1 ? "message" : "messages"} · {clinicalDateTime(t.lastMessageAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {t.awaitingClinic ? <span className="block text-meta text-muted-foreground">waiting {waitingFor(t.lastMessageAt)}</span> : null}
                      </TableCell>
                      <TableCell className="text-meta">{t.assignedTo?.displayName ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="xs" variant="outline">
                          <Link href={`/messages/${t.id}`}>{t.awaitingClinic ? "Reply" : "Open"}</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
