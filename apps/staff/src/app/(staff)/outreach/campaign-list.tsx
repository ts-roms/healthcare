"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { OutreachCampaign, OutreachChannel, OutreachDeliveryMode, OutreachSegment, OutreachSeries } from "@/lib/api/types";
import {
  CAMPAIGN_STATUS,
  CHANNEL_LABEL,
  DELIVERY_MODE_HELP,
  DELIVERY_MODE_LABEL,
  fillWording,
  PLACEHOLDERS,
  unknownPlaceholders,
  WEEKDAY_NAMES,
  worstCaseLength,
} from "@/lib/outreach-mapping";
import { saveCampaign, saveSeries } from "./actions";

const BODY_LIMIT: Record<OutreachChannel, number> = { sms: 320, push: 160, email: 2000, in_app: 2000 };

export function CampaignList({
  campaigns,
  segments,
  canManage,
  canApprove,
  currentUserId,
  clinicName,
}: {
  campaigns: OutreachCampaign[];
  segments: OutreachSegment[];
  canManage: boolean;
  canApprove: boolean;
  currentUserId: string;
  /** The organization's name, which fills {{clinicName}}. */
  clinicName: string;
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
        {creating ? <CampaignForm campaign={null} segments={segments} clinicName={clinicName} onDone={() => setCreating(false)} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * A campaign, or — with Repeat — a recurring campaign (`series`, or a new one): the same wording, with a schedule instead of a
 * send time. A recurring campaign is approved once by a second person and then creates each occurrence at its time.
 */
export function CampaignForm({
  campaign,
  series = null,
  segments,
  clinicName,
  onDone,
}: {
  campaign: OutreachCampaign | null;
  series?: OutreachSeries | null;
  segments: OutreachSegment[];
  clinicName: string;
  onDone: () => void;
}) {
  // The wording and settings come from the campaign or the recurring campaign being changed.
  const source = campaign ?? series;
  const [cadence, setCadence] = React.useState<"none" | "weekly" | "monthly">(series?.cadence ?? "none");
  const [weekday, setWeekday] = React.useState(String(series?.weekday ?? 1));
  const [dayOfMonth, setDayOfMonth] = React.useState(String(series?.dayOfMonth ?? 1));
  const [sendTime, setSendTime] = React.useState(series?.sendTime ?? "09:00");
  const [startsOn, setStartsOn] = React.useState(series?.startsOn ?? "");
  const [endsOn, setEndsOn] = React.useState(series?.endsOn ?? "");
  const repeating = cadence !== "none";
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(source?.name ?? "");
  const [segmentId, setSegmentId] = React.useState(source?.segmentId ?? segments[0]?.id ?? "");
  const [channels, setChannels] = React.useState<OutreachChannel[]>(source?.channels ?? ["sms"]);
  const [subject, setSubject] = React.useState(source?.subject ?? "");
  const [body, setBody] = React.useState(source?.body ?? "");
  const [sendAt, setSendAt] = React.useState(campaign?.sendAt ? campaign.sendAt.slice(0, 16) : "");
  const [includeBookingLink, setIncludeBookingLink] = React.useState(source?.includeBookingLink ?? false);
  const [deliveryMode, setDeliveryMode] = React.useState<OutreachDeliveryMode>(source?.deliveryMode ?? "all");
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const limit = Math.min(...channels.map((ch) => BODY_LIMIT[ch]), 2000);
  // Length counts the longest first name a message could carry, so what is approved always fits.
  const length = worstCaseLength(body.trim(), clinicName);
  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  const insert = (token: string) => {
    const field = bodyRef.current;
    const at = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? at;
    setBody(`${body.slice(0, at)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const needsSubject = channels.includes("email") || channels.includes("in_app");
  const valid =
    name.trim().length >= 2 &&
    segmentId &&
    channels.length > 0 &&
    body.trim().length >= 10 &&
    length <= limit &&
    unknown.length === 0 &&
    (!repeating || startsOn.length === 10) &&
    (!needsSubject || subject.trim().length >= 2);

  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-4"
      aria-label={campaign || series ? "Change campaign" : "New campaign"}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = repeating
            ? await saveSeries(
                {
                  segmentId,
                  name,
                  channels,
                  subject,
                  body,
                  includeBookingLink,
                  deliveryMode,
                  cadence,
                  weekday: cadence === "weekly" ? Number(weekday) : null,
                  dayOfMonth: cadence === "monthly" ? Number(dayOfMonth) : null,
                  sendTime,
                  startsOn,
                  endsOn,
                },
                series ? { id: series.id, version: series.version } : null,
              )
            : await saveCampaign(
                { segmentId, name, channels, subject, body, sendAt, includeBookingLink, deliveryMode },
                campaign ? { id: campaign.id, version: campaign.version } : null,
              );
          if (result.ok) {
            toast.success(campaign || series ? "Changed" : repeating ? "Recurring campaign drafted" : "Campaign drafted");
            onDone();
            router.refresh();
          } else {
            // The API names which channel the wording does not fit; show that rather than the general refusal.
            const detail = Array.isArray(result.details) ? (result.details[0] as { message?: string } | undefined)?.message : undefined;
            toast.error(detail ?? result.message);
          }
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
        <Textarea id="cp-body" ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={2000} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Fill in for each patient">
          {PLACEHOLDERS.map((p) => (
            <Button key={p.token} type="button" size="xs" variant="outline" onClick={() => insert(p.token)}>
              {p.label}
            </Button>
          ))}
        </div>
        {unknown.length > 0 ? (
          <p role="alert" className="text-meta text-danger-foreground">
            {unknown.map((u) => `{{${u}}}`).join(", ")} cannot be filled in. You can use {PLACEHOLDERS.map((p) => p.token).join(" or ")}.
          </p>
        ) : null}
        {body.trim().length >= 10 ? (
          <p className="rounded-md bg-muted/50 p-2 text-meta">
            <span className="font-medium">How it reads for Maria: </span>
            {needsSubject && subject.trim() ? <span className="font-medium">{fillWording(subject.trim(), "Maria", clinicName)} — </span> : null}
            {fillWording(body.trim(), "Maria", clinicName)}
          </p>
        ) : null}
        <p className="text-meta text-muted-foreground">
          {length} / {limit} characters for the chosen channels (counted with the longest first name). Plain text; no diagnosis, result or anything about a
          person&apos;s health. Emails get an opt-out link added automatically.
        </p>
      </div>
      <div className="grid max-w-xl gap-1">
        <Label htmlFor="cp-mode">How to send</Label>
        <NativeSelect id="cp-mode" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as OutreachDeliveryMode)}>
          {(Object.keys(DELIVERY_MODE_LABEL) as OutreachDeliveryMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {DELIVERY_MODE_LABEL[mode]}
            </option>
          ))}
        </NativeSelect>
        <p className="text-meta text-muted-foreground">{DELIVERY_MODE_HELP[deliveryMode]}</p>
      </div>
      <label className="flex items-start gap-2 text-table">
        <Checkbox checked={includeBookingLink} onCheckedChange={(v) => setIncludeBookingLink(v === true)} className="mt-0.5" />
        <span>
          End the message with a link to book a visit in MyHealth
          <span className="block text-meta text-muted-foreground">
            The link is added after your wording (about 65 characters, counted against each channel&apos;s limit) and holds nothing about the patient: they sign
            in to book.
          </span>
        </span>
      </label>
      {!campaign ? (
        <fieldset className="grid gap-2 rounded-md border p-3">
          <legend className="px-1 text-table font-medium">Repeat</legend>
          <div className="grid max-w-xs gap-1">
            <Label htmlFor="cp-repeat">How often</Label>
            <NativeSelect id="cp-repeat" value={cadence} onChange={(e) => setCadence(e.target.value as "none" | "weekly" | "monthly")}>
              <option value="none">Send once</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </NativeSelect>
          </div>
          {repeating ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                {cadence === "weekly" ? (
                  <div className="grid gap-1">
                    <Label htmlFor="cp-weekday">On</Label>
                    <NativeSelect id="cp-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                      {WEEKDAY_NAMES.map((name, i) => (
                        <option key={name} value={String(i)}>
                          {name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : (
                  <div className="grid gap-1">
                    <Label htmlFor="cp-dom">On day of the month</Label>
                    <Input id="cp-dom" type="number" min={1} max={28} className="w-24" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
                  </div>
                )}
                <div className="grid gap-1">
                  <Label htmlFor="cp-time">At (Manila time)</Label>
                  <Input id="cp-time" type="time" className="w-32" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="cp-start">First day</Label>
                  <Input id="cp-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="cp-end">Last day (optional)</Label>
                  <Input id="cp-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                </div>
              </div>
              <p className="text-meta text-muted-foreground">
                A second person approves the whole series once; each occurrence is then sent at its time to whoever matches the segment that day (each
                patient&apos;s opt-in, the frequency cap and quiet hours still apply). To change the wording or the schedule later, pause it, take it back to a
                draft and have it approved again. An occurrence the system misses by more than six hours is skipped, not sent late.
              </p>
            </>
          ) : null}
        </fieldset>
      ) : null}
      {!repeating ? (
        <div className="grid max-w-72 gap-1">
          <Label htmlFor="cp-send">Send at (optional; otherwise as soon as approved)</Label>
          <Input id="cp-send" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !valid}>
          {campaign || series ? "Save changes" : "Save draft"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
