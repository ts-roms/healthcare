import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, InfoIcon, ListIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import { DeliveryStatus } from "@/components/communications/delivery-status";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PatientDetail, PatientNotification } from "@/lib/api/types";
import { CATEGORY_LABEL, CHANNEL_LABEL } from "@/lib/communications";

// Never put patient names in the tab title.
export const metadata = { title: "Communications" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A patient's communication history: every message the platform sent or held back (latest 200, including records
 * merged into this one), with its delivery status and the patient's communication preferences — never the content.
 * Viewing is audited by the API.
 */
export default async function PatientCommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const session = await getSession();
  if (!can(session, "notification.read")) redirect(`/patients/${id}`);
  const patient = await api<PatientDetail>(`/patients/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  });
  if (patient.mergedIntoPatientId) redirect(`/patients/${patient.mergedIntoPatientId}/communications`);
  const history = await api<PatientNotification[]>("/notifications", { query: { patientId: id } });

  return (
    <>
      <PageHeader
        title="Communications"
        description={
          <>
            {patient.displayName} · <span className="font-mono">{patient.patientNumber}</span>
            {patient.mergedRecords?.length ? ` · includes records of ${patient.mergedRecords.map((r) => r.patientNumber).join(", ")}` : ""}
          </>
        }
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/communications?patient=${id}`}>
                <ListIcon aria-hidden /> In the communication log
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/patients/${id}`}>
                <ArrowLeftIcon aria-hidden /> Patient record
              </Link>
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <p className="flex items-start gap-2 text-table text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Reminders, notices and MyHealth alerts sent to this patient, and those held back by their consent or preferences. Messages outside MyHealth never
          carry clinical detail; their content is not shown here. Conversations are under Patient messages.
        </p>
        <section aria-label="Communication preferences" className="rounded-md border bg-card p-3">
          <h2 className="mb-1 text-table font-semibold">Communication preferences</h2>
          {patient.communicationPreferences.length ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-table">
              {patient.communicationPreferences.map((c) => (
                <li key={`${c.channel}-${c.category}`}>
                  {CHANNEL_LABEL[c.channel as keyof typeof CHANNEL_LABEL] ?? c.channel} ·{" "}
                  {CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category}:{" "}
                  <span className={c.optedIn ? "" : "text-muted-foreground"}>{c.optedIn ? "on" : "off"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-table text-muted-foreground">
              None recorded: care and appointment messages are allowed; reminders and outreach need the patient&apos;s agreement.
            </p>
          )}
        </section>
        {history.length === 0 ? (
          <p className="text-table text-muted-foreground">No messages to this patient yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap">
                    {clinicalDateTime(m.createdAt)}
                    {m.sentAt ? <span className="block text-meta text-muted-foreground">sent {clinicalDateTime(m.sentAt)}</span> : null}
                    {m.readAt ? <span className="block text-meta text-muted-foreground">read {clinicalDateTime(m.readAt)}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {m.templateLabel}
                    <span className="block text-meta text-muted-foreground">
                      {CATEGORY_LABEL[m.category]}
                      {m.createdBy ? " · requested by staff" : " · automatic"}
                      {m.recipientPatientId && m.recipientPatientId !== id ? " · filed under a merged record" : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    {CHANNEL_LABEL[m.channel]}
                    {m.destinationMasked ? <span className="block font-mono text-meta text-muted-foreground">{m.destinationMasked}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <DeliveryStatus status={m.status} reason={m.suppressionReason} />
                    {m.status === "failed" ? (
                      <span className="text-meta text-muted-foreground">
                        after {m.attemptCount} attempts{m.lastError ? ` — ${m.lastError}` : ""}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
