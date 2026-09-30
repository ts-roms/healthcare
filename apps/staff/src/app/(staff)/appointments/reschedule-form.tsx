"use client";

import * as React from "react";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Button, Checkbox, DateInput, Input, Label, NativeSelect } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { AppointmentItem, Availability, Practitioner } from "@/lib/api/types";
import { todayIn, zonedLocalToIso } from "@/lib/clinic-mapping";
import { rescheduleAppointment, rescheduleSlots } from "./actions";

/**
 * Moves an appointment to another open slot (the same or another practitioner at this facility), or — deliberately —
 * to a time outside the published schedule. A reason is always recorded.
 */
export function RescheduleForm({
  appointment,
  facilityId,
  timeZone,
  practitioners,
  pending,
  run,
  onClose,
}: {
  appointment: AppointmentItem;
  facilityId: string;
  timeZone: string;
  practitioners: Practitioner[];
  pending: boolean;
  run: (call: () => Promise<ActionResult<unknown>>, success: string) => void;
  onClose: () => void;
}) {
  const today = todayIn(timeZone);
  const currentDay = todayIn(timeZone, new Date(appointment.startsAt));
  const [practitionerId, setPractitionerId] = React.useState(appointment.practitionerId);
  const [date, setDate] = React.useState(currentDay < today ? today : currentDay);
  const [availability, setAvailability] = React.useState<Availability | null>(null);
  const [slotError, setSlotError] = React.useState<string | null>(null);
  const [loading, startLoading] = React.useTransition();
  const [slot, setSlot] = React.useState("");
  const [outside, setOutside] = React.useState(false);
  const [outsideTime, setOutsideTime] = React.useState("");
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    startLoading(async () => {
      const result = await rescheduleSlots({ practitionerId, facilityId, visitTypeId: appointment.visitTypeId, date });
      if (result.ok) {
        setAvailability(result.data);
        setSlotError(null);
      } else {
        setAvailability(null);
        setSlotError(result.message);
      }
    });
  }, [practitionerId, date, facilityId, appointment.visitTypeId]);

  const startsAt = outside ? (outsideTime ? zonedLocalToIso(`${date}T${outsideTime}`, timeZone) : "") : slot;
  const who = appointment.patient?.displayName ?? "appointment";
  const id = (name: string) => `reschedule-${appointment.id}-${name}`;
  return (
    <form
      className="mb-2 flex flex-col gap-2 rounded-md border border-info/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            rescheduleAppointment({
              appointmentId: appointment.id,
              version: appointment.version,
              startsAt,
              practitionerId: practitionerId === appointment.practitionerId ? undefined : practitionerId,
              reason: reason.trim(),
              outsideSchedule: outside,
            }),
          `Moved ${who}`,
        );
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor={id("practitioner")}>Practitioner</Label>
          <NativeSelect
            id={id("practitioner")}
            value={practitionerId}
            onChange={(e) => {
              setSlot("");
              setPractitionerId(e.target.value);
            }}
          >
            {practitioners
              .filter((p) => p.status === "active" || p.id === appointment.practitionerId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={id("date")}>Day</Label>
          <DateInput
            id={id("date")}
            min={today}
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              setSlot("");
              setDate(e.target.value);
            }}
          />
        </div>
      </div>
      {!outside ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-table font-medium">Open slots</legend>
          {loading ? <p className="text-meta text-muted-foreground">Looking for open slots…</p> : null}
          {!loading && slotError ? <p className="text-meta text-danger">{slotError}</p> : null}
          {!loading && availability && availability.slots.length === 0 ? (
            <p className="text-meta text-muted-foreground">No open slot that day. Choose another day or practitioner.</p>
          ) : null}
          {!loading && availability ? (
            <div className="flex flex-wrap gap-1">
              {availability.slots.map((s) => (
                <Button key={s.startsAt} type="button" size="xs" variant={slot === s.startsAt ? "default" : "outline"} onClick={() => setSlot(s.startsAt)}>
                  {clinicalTime(s.startsAt)}
                </Button>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : (
        <div className="grid gap-1 sm:max-w-48">
          <Label htmlFor={id("time")}>Time</Label>
          <Input id={id("time")} type="time" required value={outsideTime} onChange={(e) => setOutsideTime(e.target.value)} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Checkbox id={id("outside")} checked={outside} onCheckedChange={(v) => setOutside(v === true)} />
        <Label htmlFor={id("outside")}>A time outside the published schedule (overbooking is still refused)</Label>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={id("reason")}>Reason *</Label>
        <Input
          id={id("reason")}
          value={reason}
          maxLength={500}
          placeholder="e.g. Patient asked for an afternoon slot"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !startsAt || reason.trim().length < 3}>
          Move appointment
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Keep
        </Button>
      </div>
    </form>
  );
}
