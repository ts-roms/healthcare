"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, toast } from "@healthcare/ui/primitives";
import type { FacilityBookingRules } from "@/lib/api/types";
import { saveBookingRules } from "../actions";

/**
 * Each facility's online booking rules: how much notice, how far ahead, how many upcoming bookings, how late a patient may
 * still change a visit online, and whether patients may join a waiting list for full days. A facility that has never saved
 * rules uses the platform's defaults. The API validates and audits.
 */
export function BookingRules({ facilities, canConfigure }: { facilities: FacilityBookingRules[]; canConfigure: boolean }) {
  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      <h2 className="text-section font-semibold">Booking rules by clinic</h2>
      {facilities.map((f) => (
        <RulesForm key={`${f.facilityId}:${f.version}`} facility={f} canConfigure={canConfigure} />
      ))}
    </div>
  );
}

function RulesForm({ facility, canConfigure }: { facility: FacilityBookingRules; canConfigure: boolean }) {
  const [rules, setRules] = React.useState(facility.rules);
  const [pending, startTransition] = React.useTransition();
  const num = (key: keyof typeof rules, scale = 1) => ({
    value: Number(rules[key]) / scale,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRules((r) => ({ ...r, [key]: Math.round(Number(e.target.value) * scale) })),
  });
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveBookingRules({ facilityId: facility.facilityId, version: facility.version, ...rules });
      if (result.ok) toast.success(`Booking rules saved for ${facility.facilityName}`);
      else toast.error(result.message);
    });
  };
  const field = "flex flex-col gap-1";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{facility.facilityName}</CardTitle>
        <Badge variant={facility.customized ? "info" : "neutral"} className="ml-auto">
          {facility.customized ? "Own rules" : "Platform defaults"}
        </Badge>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className={field}>
            <Label htmlFor={`lead-${facility.facilityId}`}>Notice needed (hours)</Label>
            <Input id={`lead-${facility.facilityId}`} type="number" min={0} max={168} step={0.5} disabled={!canConfigure} {...num("minLeadMinutes", 60)} />
            <p className="text-meta text-muted-foreground">Patients cannot book a time sooner than this.</p>
          </div>
          <div className={field}>
            <Label htmlFor={`ahead-${facility.facilityId}`}>Book up to (days ahead)</Label>
            <Input id={`ahead-${facility.facilityId}`} type="number" min={1} max={365} disabled={!canConfigure} {...num("maxAdvanceDays")} />
          </div>
          <div className={field}>
            <Label htmlFor={`upcoming-${facility.facilityId}`}>Upcoming online bookings per patient</Label>
            <Input id={`upcoming-${facility.facilityId}`} type="number" min={1} max={20} disabled={!canConfigure} {...num("maxUpcoming")} />
          </div>
          <div className={field}>
            <Label htmlFor={`cutoff-${facility.facilityId}`}>Changes and cancellations close (hours before)</Label>
            <Input
              id={`cutoff-${facility.facilityId}`}
              type="number"
              min={0}
              max={168}
              step={0.5}
              disabled={!canConfigure}
              {...num("changeCutoffMinutes", 60)}
            />
          </div>
          <div className={field}>
            <span className="text-table font-medium">Waiting list</span>
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={rules.waitlistEnabled}
                disabled={!canConfigure}
                onCheckedChange={(checked) => setRules((r) => ({ ...r, waitlistEnabled: checked === true }))}
                aria-label="Patients may join a waiting list for full days"
              />
              Patients may ask to be told when a time opens on a full day
            </label>
            <p className="text-meta text-muted-foreground">Turn on only if the front desk will work the list (Appointments → Waiting list).</p>
          </div>
          <div className={field}>
            <Label htmlFor={`entries-${facility.facilityId}`}>Waiting-list requests per patient</Label>
            <Input
              id={`entries-${facility.facilityId}`}
              type="number"
              min={1}
              max={10}
              disabled={!canConfigure || !rules.waitlistEnabled}
              {...num("maxWaitlistEntries")}
            />
          </div>
          {canConfigure ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save rules"}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
