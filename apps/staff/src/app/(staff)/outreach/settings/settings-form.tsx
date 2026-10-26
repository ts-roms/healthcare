"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, toast } from "@healthcare/ui/primitives";
import type { OutreachSettings } from "@/lib/api/types";
import { saveOutreachSettings } from "../actions";

type QuietChannel = "sms" | "email" | "push";
const QUIET_CHANNELS: Array<{ key: QuietChannel; label: string }> = [
  { key: "sms", label: "Text messages" },
  { key: "push", label: "Push notifications" },
  { key: "email", label: "Email" },
];

/**
 * The frequency cap and quiet hours. A patient already at the cap is skipped (and the record says so); a message that
 * falls in quiet hours is queued and sent when they end. Times are Philippine time. Changing them is for the people who
 * approve campaigns, and every change is recorded in the audit trail.
 */
export function SettingsForm({ settings, canEdit }: { settings: OutreachSettings; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [capOn, setCapOn] = React.useState(settings.frequencyCap !== null);
  const [max, setMax] = React.useState(String(settings.frequencyCap?.maxCampaigns ?? 1));
  const [days, setDays] = React.useState(String(settings.frequencyCap?.windowDays ?? 14));
  const [quietOn, setQuietOn] = React.useState(settings.quietHours.enabled);
  const [start, setStart] = React.useState(settings.quietHours.start ?? "21:00");
  const [end, setEnd] = React.useState(settings.quietHours.end ?? "08:00");
  const [channels, setChannels] = React.useState<QuietChannel[]>(settings.quietHours.channels);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveOutreachSettings({
        frequencyCap: capOn ? { maxCampaigns: Number(max), windowDays: Number(days) } : null,
        quietHours: { enabled: quietOn, start: quietOn ? start : null, end: quietOn ? end : null, channels },
        version: settings.version,
      });
      if (result.ok) {
        toast.success("Limits saved");
        router.refresh();
      } else toast.error(result.message);
    });
  };

  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={submit} aria-label="Outreach limits">
      <Card>
        <CardHeader>
          <CardTitle>How often</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-table">
          <label className="flex items-center gap-2">
            <Checkbox checked={capOn} disabled={!canEdit} onCheckedChange={(v) => setCapOn(v === true)} />
            Limit how many campaigns reach one patient
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span>At most</span>
            <Input
              aria-label="Campaigns"
              className="w-20"
              type="number"
              min={1}
              max={20}
              value={max}
              disabled={!canEdit || !capOn}
              onChange={(e) => setMax(e.target.value)}
            />
            <span>campaign(s) in any</span>
            <Input
              aria-label="Days"
              className="w-24"
              type="number"
              min={1}
              max={365}
              value={days}
              disabled={!canEdit || !capOn}
              onChange={(e) => setDays(e.target.value)}
            />
            <span>days.</span>
          </div>
          <p className="text-meta text-muted-foreground">
            A patient who already received that many outreach campaigns in the period is skipped by the next one, and the campaign&apos;s result says so. It
            does not affect reminders about care, appointments or bills.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>When</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-table">
          <label className="flex items-center gap-2">
            <Checkbox checked={quietOn} disabled={!canEdit} onCheckedChange={(v) => setQuietOn(v === true)} />
            Hold messages during quiet hours
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span>From</span>
            <Input
              aria-label="Quiet hours start"
              className="w-32"
              type="time"
              value={start}
              disabled={!canEdit || !quietOn}
              onChange={(e) => setStart(e.target.value)}
            />
            <span>to</span>
            <Input
              aria-label="Quiet hours end"
              className="w-32"
              type="time"
              value={end}
              disabled={!canEdit || !quietOn}
              onChange={(e) => setEnd(e.target.value)}
            />
            <span>(Manila time)</span>
          </div>
          <fieldset className="grid gap-1" disabled={!canEdit || !quietOn}>
            <legend className="mb-1 text-meta text-muted-foreground">Held until the quiet hours end</legend>
            <div className="flex flex-wrap gap-4">
              {QUIET_CHANNELS.map((c) => (
                <label key={c.key} className="flex items-center gap-2">
                  <Checkbox
                    checked={channels.includes(c.key)}
                    onCheckedChange={(v) => setChannels(v === true ? [...channels, c.key] : channels.filter((x) => x !== c.key))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-meta text-muted-foreground">
            A message that would go out in these hours is queued and sent when they end. An overnight period such as 21:00 to 08:00 is fine. MyHealth inbox
            messages are not held: they wait quietly until the patient opens the app.
          </p>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3 lg:col-span-2">
        {canEdit ? (
          <Button type="submit" size="sm" disabled={pending}>
            Save limits
          </Button>
        ) : (
          <p className="text-meta text-muted-foreground">Only the people who approve campaigns can change these.</p>
        )}
      </div>
    </form>
  );
}
