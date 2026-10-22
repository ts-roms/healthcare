import { StaffSettingsPage } from "@/components/settings-page";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { api } from "@/lib/api/client";
import { can, getSession } from "@/lib/api/session";
import type { PrivacyIncidentDetail } from "@/lib/api/types";
import { notificationClock, PRIVACY_ASSESSMENT, PRIVACY_CATEGORY_LABEL, PRIVACY_ENTRY_LABEL } from "@/lib/privacy-mapping";
import { IncidentWorkbench } from "./incident-workbench";

export const metadata = { title: "Privacy incident" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PrivacyIncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const [{ incidentId }, session] = await Promise.all([params, getSession()]);
  if (!can(session, "privacy.incident.manage")) redirect("/");
  if (!UUID.test(incidentId)) notFound();
  let incident: PrivacyIncidentDetail;
  try {
    incident = await api<PrivacyIncidentDetail>(`/privacy/incidents/${incidentId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const clock = notificationClock(incident);
  return (
    <StaffSettingsPage
      group="Security & privacy"
      title={`${incident.incidentNumber} · ${incident.title}`}
      description="Everything recorded about this incident, in order."
      details={["Nothing here is edited or deleted; add what happened next."]}
      actions={
        <Link className="text-table text-primary hover:underline" href="/admin/privacy">
          Back to the register
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>The incident</CardTitle>
              <Badge variant={incident.status === "closed" ? "neutral" : PRIVACY_ASSESSMENT[incident.assessment].variant} className="ml-auto">
                {incident.status === "closed" ? "Closed" : PRIVACY_ASSESSMENT[incident.assessment].label}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-table">
              <p className="whitespace-pre-line">{incident.description}</p>
              <p>
                <span className="text-muted-foreground">Discovered: </span>
                {clinicalDateTime(incident.discoveredAt)}
                {incident.occurredAt ? ` · occurred ${clinicalDateTime(incident.occurredAt)}` : ""}
              </p>
              <p>
                <span className="text-muted-foreground">Data involved: </span>
                {incident.dataCategories.map((c) => PRIVACY_CATEGORY_LABEL[c]).join(", ")}
              </p>
              {incident.affectedEstimate !== null ? (
                <p>
                  <span className="text-muted-foreground">People affected (estimate): </span>
                  {incident.affectedEstimate}
                </p>
              ) : null}
              <p className={incident.notificationOverdue ? "font-medium text-danger-foreground" : undefined}>
                <span className="text-muted-foreground">Notify by: </span>
                {incident.notificationOverdue ? <TriangleAlertIcon className="mr-1 inline size-3.5" aria-hidden /> : null}
                {clinicalDateTime(incident.notifyBy)}
                {clock ? ` (${clock})` : ""}
              </p>
              {incident.assessmentReason ? (
                <p>
                  <span className="text-muted-foreground">Assessment: </span>
                  {PRIVACY_ASSESSMENT[incident.assessment].label} — {incident.assessmentReason}
                </p>
              ) : null}
              {incident.npcNotifiedAt ? (
                <p>
                  <span className="text-muted-foreground">NPC notified: </span>
                  {clinicalDateTime(incident.npcNotifiedAt)} · {incident.npcReference}
                </p>
              ) : null}
              {incident.subjectsNotifiedAt ? (
                <p>
                  <span className="text-muted-foreground">Affected people told: </span>
                  {clinicalDateTime(incident.subjectsNotifiedAt)} · {incident.subjectsNotificationMethod}
                </p>
              ) : null}
              {incident.closureNote ? (
                <p>
                  <span className="text-muted-foreground">Closed {incident.closedAt ? clinicalDateTime(incident.closedAt) : ""}: </span>
                  {incident.closureNote}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>What was done</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2 text-table">
                {incident.entries.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3">
                    <span className="text-meta text-muted-foreground">
                      {clinicalDateTime(e.recordedAt)} · {PRIVACY_ENTRY_LABEL[e.kind]}
                    </span>
                    <p className="whitespace-pre-line">{e.note}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <IncidentWorkbench incident={incident} />
      </div>
    </StaffSettingsPage>
  );
}
