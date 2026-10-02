"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { OutreachCampaign, OutreachChannel, OutreachSegment } from "@/lib/api/types";
import { CAMPAIGN_STATUS, CHANNEL_LABEL } from "@/lib/outreach-mapping";
import { saveCampaign } from "./actions";

const BODY_LIMIT: Record<OutreachChannel, number> = { sms: 320, push: 160, email: 2000, in_app: 2000 };

export function CampaignList({
  campaigns,
  segments,
  canManage,
  canApprove,
  currentUserId,
}: {
  campaigns: OutreachCampaign[];
  segments: OutreachSegment[];
  canManage: boolean;
  canApprove: boolean;
  currentUserId: string;
}) {
  const [creating, setCreating] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Campaigns</CardTitle>
        {canManage && !creating ? (
          <Button size="sm" onClick={() => setCreating(true)} disabled={segments.length === 0}>
            New campaign
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {segments.length === 0 && canManage ? <p className="text-table text-muted-foreground">Define a segment first.</p> : null}
        {campaigns.length === 0 ? <p className="text-table text-muted-foreground">No campaigns yet.</p> : null}
        <ul className="flex flex-col divide-y">
          {campaigns.map((c) => {
            const status = CAMPAIGN_STATUS[c.status];
            const waitingOnMe = c.status === "submitted" && canApprove && c.createdBy !== currentUserId && c.submittedBy !== currentUserId;
            return (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-table">
                <div className="min-w-0">
                  <p className="font-medium">
                    <Link href={`/outreach/campaigns/${c.id}`} className="text-primary hover:underline">
                      {c.name}
                    </Link>{" "}
                    <Badge variant={status.tone}>{status.label}</Badge> {waitingOnMe ? <Badge variant="info">Your approval</Badge> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {c.segmentName} · {c.channels.map((ch) => CHANNEL_LABEL[ch]).join(", ")}
                    {c.sendAt ? ` · send ${clinicalDateTime(c.sendAt)}` : c.status === "approved" ? " · sends within a minute" : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        {creating ? <CampaignForm campaign={null} segments={segments} onDone={() => setCreating(false)} /> : null}
      </CardContent>
    </Card>
  );
}

export function CampaignForm({ campaign, segments, onDone }: { campaign: OutreachCampaign | null; segments: OutreachSegment[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(campaign?.name ?? "");
  const [segmentId, setSegmentId] = React.useState(campaign?.segmentId ?? segments[0]?.id ?? "");
  const [channels, setChannels] = React.useState<OutreachChannel[]>(campaign?.channels ?? ["sms"]);
  const [subject, setSubject] = React.useState(campaign?.subject ?? "");
  const [body, setBody] = React.useState(campaign?.body ?? "");
  const [sendAt, setSendAt] = React.useState(campaign?.sendAt ? campaign.sendAt.slice(0, 16) : "");
  const limit = Math.min(...channels.map((ch) => BODY_LIMIT[ch]), 2000);
  const needsSubject = channels.includes("email") || channels.includes("in_app");
  const valid =
    name.trim().length >= 2 &&
    segmentId &&
    channels.length > 0 &&
    body.trim().length >= 10 &&
    body.trim().length <= limit &&
    (!needsSubject || subject.trim().length >= 2);

  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-label={campaign ? "Change campaign" : "New campaign"}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveCampaign(
            { segmentId, name, channels, subject, body, sendAt },
            campaign ? { id: campaign.id, version: campaign.version } : null,
          );
          if (result.ok) {
            toast.success(campaign ? "Campaign changed" : "Campaign drafted");
            onDone();
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="cp-name">Name</Label>
          <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cp-segment">Segment</Label>
          <NativeSelect id="cp-segment" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} emptyText="No active segments">
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <fieldset className="grid gap-1">
        <legend className="text-table font-medium">Channels</legend>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(CHANNEL_LABEL) as OutreachChannel[]).map((ch) => (
            <label key={ch} className="flex items-center gap-2 text-table">
              <Checkbox
                checked={channels.includes(ch)}
                onCheckedChange={(v) => setChannels(v === true ? [...channels, ch] : channels.filter((x) => x !== ch))}
              />
              {CHANNEL_LABEL[ch]}
            </label>
          ))}
        </div>
      </fieldset>
      {needsSubject ? (
        <div className="grid gap-1">
          <Label htmlFor="cp-subject">Subject (email and MyHealth)</Label>
          <Input id="cp-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
        </div>
      ) : null}
      <div className="grid gap-1">
        <Label htmlFor="cp-body">Message</Label>
        <Textarea id="cp-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} />
        <p className="text-meta text-muted-foreground">
          {body.trim().length} / {limit} characters for the chosen channels. Plain text; no diagnosis, result or anything about a person&apos;s health. Emails
          get an opt-out link added automatically.
        </p>
      </div>
      <div className="grid max-w-72 gap-1">
        <Label htmlFor="cp-send">Send at (optional; otherwise as soon as approved)</Label>
        <Input id="cp-send" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !valid}>
          {campaign ? "Save changes" : "Save draft"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
