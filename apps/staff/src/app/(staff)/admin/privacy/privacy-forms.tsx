"use client";

import * as React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, DateTimeInput, Input, Label, Textarea } from "@healthcare/ui/primitives";
import type { PrivacyDataCategory, PrivacySetting } from "@/lib/api/types";
import { PRIVACY_CATEGORY_LABEL } from "@/lib/privacy-mapping";
import { useServerAction } from "@/lib/use-server-action";
import { recordIncident, savePrivacySetting } from "./actions";

const CATEGORIES = Object.keys(PRIVACY_CATEGORY_LABEL) as PrivacyDataCategory[];

/** "2026-10-20T14:05" (the browser's local wall clock) → an ISO instant. */
function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function NewIncidentForm() {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [discoveredAt, setDiscoveredAt] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState("");
  const [categories, setCategories] = React.useState<Set<PrivacyDataCategory>>(new Set());
  const [affected, setAffected] = React.useState("");
  const { pending, run } = useServerAction();
  const reset = () => {
    setOpen(false);
    setTitle("");
    setDescription("");
    setDiscoveredAt("");
    setOccurredAt("");
    setCategories(new Set());
    setAffected("");
  };
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Record an incident…
      </Button>
    );
  }
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label="Record an incident"
      onSubmit={(e) => {
        e.preventDefault();
        const discovered = localToIso(discoveredAt);
        if (!discovered) return;
        run(
          () =>
            recordIncident({
              title,
              description,
              discoveredAt: discovered,
              occurredAt: localToIso(occurredAt),
              dataCategories: [...categories],
              affectedEstimate: affected.trim() === "" ? undefined : Number(affected),
            }),
          "Incident recorded — the notification window has started",
          reset,
        );
      }}
    >
      <h2 className="text-body font-semibold sm:col-span-2">Record an incident</h2>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="incident-title">Title *</Label>
        <Input
          id="incident-title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Laptop with exported list lost"
        />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="incident-description">What happened, as known now *</Label>
        <Textarea id="incident-description" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="incident-discovered">Discovered at *</Label>
        <DateTimeInput id="incident-discovered" required value={discoveredAt} onValueChange={setDiscoveredAt} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="incident-occurred">Occurred at (if known)</Label>
        <DateTimeInput id="incident-occurred" value={occurredAt} onValueChange={setOccurredAt} />
      </div>
      <fieldset className="grid gap-1 sm:col-span-2">
        <legend className="mb-1 text-table font-medium">Kinds of personal data involved *</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-2 text-table">
              <Checkbox
                checked={categories.has(c)}
                onCheckedChange={(checked) =>
                  setCategories((prev) => {
                    const next = new Set(prev);
                    if (checked === true) next.add(c);
                    else next.delete(c);
                    return next;
                  })
                }
              />
              {PRIVACY_CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1">
        <Label htmlFor="incident-affected">People affected (estimate)</Label>
        <Input id="incident-affected" inputMode="numeric" maxLength={9} value={affected} onChange={(e) => setAffected(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex gap-2 self-end sm:col-span-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending || categories.size === 0 || title.trim().length < 3 || description.trim().length < 10 || !discoveredAt}
        >
          Record incident
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PrivacySettingForm({ setting }: { setting: PrivacySetting }) {
  const [hours, setHours] = React.useState(String(setting.breachNotificationHours));
  const [dpoName, setDpoName] = React.useState(setting.dpoName ?? "");
  const [dpoContact, setDpoContact] = React.useState(setting.dpoContact ?? "");
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => savePrivacySetting({ breachNotificationHours: Number(hours), dpoName, dpoContact, version: setting.version }), "Privacy settings saved");
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="privacy-hours">Notify within (hours from discovery)</Label>
            <Input id="privacy-hours" inputMode="numeric" maxLength={3} value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))} />
            <p className="text-meta text-muted-foreground">
              Your organization&apos;s own window; the NPC&apos;s circular is the reference your Data Protection Officer confirms. New incidents take the value
              set at the time they are recorded.
            </p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="privacy-dpo-name">Data Protection Officer</Label>
            <Input id="privacy-dpo-name" maxLength={120} value={dpoName} onChange={(e) => setDpoName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="privacy-dpo-contact">How patients reach the DPO</Label>
            <Input
              id="privacy-dpo-contact"
              maxLength={300}
              placeholder="e.g. dpo@clinic.ph · (02) 8xxx xxxx"
              value={dpoContact}
              onChange={(e) => setDpoContact(e.target.value)}
            />
            <p className="text-meta text-muted-foreground">Shown to patients in MyHealth under Privacy and consents when set.</p>
          </div>
          <Button type="submit" size="sm" className="self-start" disabled={pending || !hours || Number(hours) < 1 || Number(hours) > 720}>
            Save settings
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
