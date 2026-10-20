"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, DateTimeInput, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import type { PrivacyIncidentDetail } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { addIncidentEntry, assessIncident, closeIncident, recordNpcNotification, recordSubjectsNotification } from "../actions";

function localToIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The steps the Data Protection Officer records against an open incident; each is append-only on the API. */
export function IncidentWorkbench({ incident }: { incident: PrivacyIncidentDetail }) {
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  const [entryKind, setEntryKind] = React.useState<"note" | "containment">("note");
  const [entry, setEntry] = React.useState("");
  const [assessment, setAssessment] = React.useState<"notifiable" | "not_notifiable">("notifiable");
  const [reason, setReason] = React.useState("");
  const [npcAt, setNpcAt] = React.useState("");
  const [npcRef, setNpcRef] = React.useState("");
  const [subjectsAt, setSubjectsAt] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [closure, setClosure] = React.useState("");
  const base = { incidentId: incident.id, version: incident.version };

  if (incident.status === "closed") {
    return (
      <Card className="self-start">
        <CardContent className="py-4 text-table text-muted-foreground">This incident is closed. Record a new incident if something else happens.</CardContent>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add what was done</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => addIncidentEntry({ ...base, kind: entryKind, note: entry }),
                "Recorded",
                () => setEntry(""),
              );
            }}
          >
            <div className="grid gap-1 sm:w-56">
              <Label htmlFor="entry-kind">Kind</Label>
              <NativeSelect id="entry-kind" value={entryKind} onChange={(e) => setEntryKind(e.target.value as "note" | "containment")}>
                <option value="note">Note</option>
                <option value="containment">Containment step</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="entry-note">What was done or found</Label>
              <Textarea id="entry-note" rows={2} maxLength={4000} value={entry} onChange={(e) => setEntry(e.target.value)} />
            </div>
            <Button type="submit" size="sm" className="self-start" disabled={pending || entry.trim().length < 3}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {incident.assessment === "pending" ? (
        <Card>
          <CardHeader>
            <CardTitle>Assess</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => assessIncident({ ...base, assessment, reason }), "Assessment recorded");
              }}
            >
              <p className="text-meta text-muted-foreground">
                Whether the incident must be notified to the NPC and the affected people is your Data Protection Officer&apos;s decision under the Data Privacy
                Act and the NPC&apos;s current rules; the platform records it.
              </p>
              <div className="grid gap-1 sm:w-56">
                <Label htmlFor="assessment">Outcome</Label>
                <NativeSelect id="assessment" value={assessment} onChange={(e) => setAssessment(e.target.value as "notifiable" | "not_notifiable")}>
                  <option value="notifiable">Notifiable</option>
                  <option value="not_notifiable">Not notifiable</option>
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="assessment-reason">Reason</Label>
                <Textarea id="assessment-reason" rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button type="submit" size="sm" className="self-start" disabled={pending || reason.trim().length < 10}>
                Record assessment
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {!incident.npcNotifiedAt && incident.assessment !== "not_notifiable" ? (
        <Card>
          <CardHeader>
            <CardTitle>NPC notified</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const at = localToIso(npcAt);
                if (!at) return;
                run(() => recordNpcNotification({ ...base, notifiedAt: at, reference: npcRef }), "NPC notification recorded");
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor="npc-at">When</Label>
                <DateTimeInput id="npc-at" required value={npcAt} onValueChange={setNpcAt} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="npc-ref">NPC reference or how it was sent</Label>
                <Input id="npc-ref" maxLength={200} value={npcRef} onChange={(e) => setNpcRef(e.target.value)} />
              </div>
              <Button type="submit" size="sm" className="self-start" disabled={pending || !npcAt || npcRef.trim().length < 1}>
                Record NPC notification
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {!incident.subjectsNotifiedAt && incident.assessment !== "not_notifiable" ? (
        <Card>
          <CardHeader>
            <CardTitle>Affected people told</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const at = localToIso(subjectsAt);
                if (!at) return;
                run(() => recordSubjectsNotification({ ...base, notifiedAt: at, method }), "Notification of the affected people recorded");
              }}
            >
              <div className="grid gap-1">
                <Label htmlFor="subjects-at">When</Label>
                <DateTimeInput id="subjects-at" required value={subjectsAt} onValueChange={setSubjectsAt} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="subjects-method">How (letter, SMS, MyHealth notice, public notice …)</Label>
                <Input id="subjects-method" maxLength={500} value={method} onChange={(e) => setMethod(e.target.value)} />
              </div>
              <Button type="submit" size="sm" className="self-start" disabled={pending || !subjectsAt || method.trim().length < 3}>
                Record
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Close</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => closeIncident({ ...base, note: closure }), "Incident closed");
            }}
          >
            <p className="text-meta text-muted-foreground">
              {incident.assessment === "pending"
                ? "Record the assessment first. An incident is closed only once assessed."
                : "What was concluded and what changed. If a notifiable incident was not notified, say why."}
            </p>
            <Textarea id="closure" aria-label="Closure note" rows={3} maxLength={4000} value={closure} onChange={(e) => setClosure(e.target.value)} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={pending || incident.assessment === "pending" || closure.trim().length < 10}
            >
              Close incident
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
