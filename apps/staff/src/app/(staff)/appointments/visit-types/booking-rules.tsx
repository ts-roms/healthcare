"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { FacilityBookingRules } from "@/lib/api/types";
import { saveBookingRules } from "../actions";

/**
 * Each facility's online booking rules: how much notice, how far ahead, how many upcoming bookings, how late a patient may
 * still change a visit online, whether patients may join a waiting list for full days, whether unattended appointments are
 * marked as no-shows at the end of the day, and whether patients may check in online. A facility that has never saved
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
          <div className={field}>
            <span className="text-table font-medium">Automatic no-shows</span>
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={rules.autoNoShow}
                disabled={!canConfigure}
                onCheckedChange={(checked) => setRules((r) => ({ ...r, autoNoShow: checked === true }))}
                aria-label="Mark unattended appointments as no-shows at the end of the day"
              />
              Mark appointments nobody attended as no-shows at the end of the day
            </label>
            <p className="text-meta text-muted-foreground">
              Booked or confirmed appointments that ended without a check-in. The patient gets the usual “we missed you” message.
            </p>
          </div>
          <div className={field}>
            <Label htmlFor={`noshow-${facility.facilityId}`}>Mark them after</Label>
            <NativeSelect
              id={`noshow-${facility.facilityId}`}
              value={String(rules.autoNoShowHour)}
              disabled={!canConfigure || !rules.autoNoShow}
              onChange={(e) => setRules((r) => ({ ...r, autoNoShowHour: Number(e.target.value) }))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-meta text-muted-foreground">Clinic time, on the appointment’s own day.</p>
          </div>
          <div className={field}>
            <span className="text-table font-medium">Online check-in</span>
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={rules.onlineCheckIn}
                disabled={!canConfigure}
                onCheckedChange={(checked) => setRules((r) => ({ ...r, onlineCheckIn: checked === true }))}
                aria-label="Patients may check in online for in-person appointments"
              />
              Patients may check in from MyHealth when they arrive
            </label>
            <p className="text-meta text-muted-foreground">They join the queue waiting for triage, marked “Checked in online”.</p>
          </div>
          <div className={field}>
            <Label htmlFor={`opens-${facility.facilityId}`}>Check-in opens (minutes before)</Label>
            <Input
              id={`opens-${facility.facilityId}`}
              type="number"
              min={0}
              max={240}
              disabled={!canConfigure || !rules.onlineCheckIn}
              {...num("checkInOpensMinutes")}
            />
          </div>
          <div className={field}>
            <Label htmlFor={`closes-${facility.facilityId}`}>Check-in closes (minutes after the start)</Label>
            <Input
              id={`closes-${facility.facilityId}`}
              type="number"
              min={0}
              max={120}
              disabled={!canConfigure || !rules.onlineCheckIn}
              {...num("checkInClosesMinutes")}
            />
            <p className="text-meta text-muted-foreground">Later, the patient checks in at the desk.</p>
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

const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
/** "6:00 PM" for an hour of the day. */
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
