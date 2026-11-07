"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Textarea } from "@healthcare/ui/primitives";
import type { PreRegistrationSettings } from "@/lib/api/types";
import { useServerAction } from "@/lib/use-server-action";
import { savePreRegistrationSettings } from "./actions";

/**
 * Whether MyHealth offers pre-registration before a first visit, the organization's own privacy notice for it, and how
 * long a request waits for review (migration 0150). Changing the notice makes a new version; requests record the one
 * accepted.
 */
export function PreRegistrationSettingsCard({ settings }: { settings: PreRegistrationSettings }) {
  const [enabled, setEnabled] = React.useState(settings.enabled);
  const [notice, setNotice] = React.useState(settings.noticeText ?? "");
  const [days, setDays] = React.useState(String(settings.retentionDays));
  const { pending, run } = useServerAction();
  const daysNumber = Number(days);
  const valid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 30 && (!enabled || notice.trim().length >= 20);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre-registration from MyHealth</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                savePreRegistrationSettings({
                  enabled,
                  noticeText: notice.trim() ? notice.trim() : null,
                  retentionDays: daysNumber,
                  version: settings.version || undefined,
                }),
              "Pre-registration settings saved",
            );
          }}
        >
          <p className="text-meta text-muted-foreground">
            People who are not yet patients can send their details from the MyHealth app before their first visit. Their request appears here, marked MyHealth,
            and is only a patient record once you approve it after checking their identification. MyHealth access still starts with an activation code from the
            clinic.
          </p>
          <div className="flex items-center gap-2">
            <Checkbox id="prereg-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <Label htmlFor="prereg-enabled">Offer pre-registration in MyHealth</Label>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="prereg-notice">Privacy notice shown before the form (your organization&apos;s own wording)</Label>
            <Textarea id="prereg-notice" rows={5} value={notice} maxLength={5000} onChange={(e) => setNotice(e.target.value)} />
            <p className="text-meta text-muted-foreground">
              {settings.noticeVersion > 0 ? `Current version: ${settings.noticeVersion}. ` : ""}Changing it makes a new version; each request records the
              version the person accepted. What it must say is your data protection officer&apos;s decision.
            </p>
          </div>
          <div className="grid max-w-xs gap-1">
            <Label htmlFor="prereg-days">Keep an unreviewed request for (days, 1 to 30)</Label>
            <Input id="prereg-days" inputMode="numeric" value={days} maxLength={2} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div>
            <Button type="submit" size="sm" disabled={pending || !valid}>
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
