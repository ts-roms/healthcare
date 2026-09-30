"use client";

import * as React from "react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { ConsentTextStatus, OnlineConsentType } from "@/lib/api/types";
import { publishConsentWording } from "./actions";

const LABEL: Record<OnlineConsentType, string> = {
  telemedicine: "Online consultations",
  data_sharing_hmo: "Sharing with the patient's HMO",
  data_sharing_philhealth: "Sharing with PhilHealth",
  research: "Research",
};

/** One consent's wording: what patients read now, and a form for a new version (versions are never edited). */
export function ConsentWordingEditor({ status }: { status: ConsentTextStatus }) {
  const current = status.current;
  const [title, setTitle] = React.useState(current?.title ?? "");
  const [body, setBody] = React.useState(current?.body ?? "");
  const [acknowledgement, setAcknowledgement] = React.useState(current?.acknowledgement ?? "");
  const [pending, startTransition] = React.useTransition();
  const save = (offered: boolean) =>
    startTransition(async () => {
      const result = await publishConsentWording({ consentType: status.consentType, offered, title, body, acknowledgement });
      if (result.ok) toast.success(offered ? `Version ${result.data.version} is now offered online` : "No longer offered online");
      else toast.error(result.message);
    });
  const id = (name: string) => `${status.consentType}-${name}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{LABEL[status.consentType]}</CardTitle>
        <Badge variant={current?.offered ? "success" : "neutral"} className="ml-auto">
          {current?.offered ? `Offered online · version ${current.version}` : current ? `Not offered · version ${current.version}` : "No wording yet"}
        </Badge>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("title")}>Title patients see</Label>
            <Input id={id("title")} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("body")}>The wording (your organization&apos;s own words)</Label>
            <Textarea id={id("body")} value={body} rows={8} maxLength={20_000} onChange={(e) => setBody(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("ack")}>Statement the patient confirms</Label>
            <Input id={id("ack")} value={acknowledgement} maxLength={500} onChange={(e) => setAcknowledgement(e.target.value)} required />
            <p className="text-meta text-muted-foreground">Shown next to the box the patient ticks, for example &quot;I have read this and I agree.&quot;</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending || !title.trim() || !body.trim() || !acknowledgement.trim()}>
              {pending ? "Saving…" : current ? "Publish as a new version" : "Publish and offer online"}
            </Button>
            {current?.offered ? (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => save(false)}>
                Stop offering online
              </Button>
            ) : null}
          </div>
        </form>
        {status.history.length > 0 ? (
          <details className="mt-3 text-table">
            <summary className="cursor-pointer text-primary">History ({status.history.length})</summary>
            <ul className="mt-2 flex flex-col gap-1 text-meta text-muted-foreground">
              {status.history.map((h) => (
                <li key={h.id}>
                  Version {h.version} · {h.offered ? "offered" : "stopped offering"} · {clinicalDateTime(h.createdAt)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
