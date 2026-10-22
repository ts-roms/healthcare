"use client";

import * as React from "react";
import { CalendarClockIcon } from "lucide-react";
import {
  Button,
  Checkbox,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
} from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import { useServerAction } from "@/lib/use-server-action";
import { addSchedule, retireSchedule } from "../appointments/schedules/actions";
import { WEEKDAYS } from "../appointments/schedules/labels";

export interface ScheduleRow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  roomName: string | null;
}

/** Monday first, as clinics read a week; the stored day of week is 0 = Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Sets a practitioner's weekly hours without leaving the page: the current hours (each can be retired) and a form that
 * adds the same hours to several days at once. It uses the same actions as the Schedules page (clinic.configure is
 * checked by the API on every call); retiring only stops new bookings, appointments already booked stay.
 */
export function SetSchedule({
  practitionerId,
  practitionerName,
  facilityId,
  today,
  rooms,
  rows,
  label = "Set schedule",
  variant = "outline",
  className,
}: {
  practitionerId: string;
  practitionerName: string;
  facilityId: string;
  today: string;
  rooms: Array<{ id: string; name: string }>;
  rows: ScheduleRow[];
  label?: string;
  variant?: "outline" | "secondary";
  className?: string;
}) {
  const { pending, run } = useServerAction({ refreshOnFailure: true });
  const [open, setOpen] = React.useState(false);
  const blank = { days: [] as number[], startTime: "08:00", endTime: "12:00", slotMinutes: "15", roomId: "", validFrom: today, validUntil: "" };
  const [form, setForm] = React.useState(blank);
  const set =
    (key: "startTime" | "endTime" | "slotMinutes" | "roomId" | "validFrom" | "validUntil") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleDay = (day: number, on: boolean) => setForm((f) => ({ ...f, days: on ? [...f.days, day] : f.days.filter((d) => d !== day) }));

  const current = [...rows].sort(
    (a, b) =>
      WEEK_ORDER.indexOf(a.dayOfWeek as (typeof WEEK_ORDER)[number]) - WEEK_ORDER.indexOf(b.dayOfWeek as (typeof WEEK_ORDER)[number]) ||
      a.startTime.localeCompare(b.startTime),
  );

  return (
    <>
      <Button
        size="sm"
        variant={variant}
        className={className}
        onClick={() => {
          setForm(blank);
          setOpen(true);
        }}
      >
        <CalendarClockIcon /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Schedule · {practitionerName}</DialogTitle>
            <DialogDescription>
              The weekly hours patients and staff can book into at this facility. New hours apply from the first day you choose.
            </DialogDescription>
          </DialogHeader>

          <section aria-label="Current hours" className="flex flex-col gap-1.5">
            <h3 className="text-table font-semibold">Current hours</h3>
            {current.length === 0 ? (
              <p className="text-table text-muted-foreground">No hours set at this facility yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {current.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2 text-table">
                    <span className="w-24 font-medium">{WEEKDAYS[row.dayOfWeek]}</span>
                    <span className="tabular-nums">
                      {hhmm(row.startTime)}–{hhmm(row.endTime)}
                    </span>
                    <span className="text-muted-foreground">
                      {row.slotMinutes}-min slots{row.roomName ? ` · ${row.roomName}` : ""}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="ml-auto"
                      disabled={pending}
                      aria-label={`Retire ${WEEKDAYS[row.dayOfWeek]} ${hhmm(row.startTime)}–${hhmm(row.endTime)}`}
                      onClick={() => run(() => retireSchedule(row.id), "Hours retired")}
                    >
                      Retire
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (form.days.length === 0) return run(async () => ({ ok: false, message: "Choose at least one day." }), "");
              run(
                async () => {
                  // One schedule per chosen day; stop at the first the API refuses and say which.
                  for (const day of [...form.days].sort(
                    (a, b) => WEEK_ORDER.indexOf(a as (typeof WEEK_ORDER)[number]) - WEEK_ORDER.indexOf(b as (typeof WEEK_ORDER)[number]),
                  )) {
                    const result = await addSchedule({
                      practitionerId,
                      facilityId,
                      roomId: form.roomId,
                      dayOfWeek: day,
                      startTime: form.startTime,
                      endTime: form.endTime,
                      slotMinutes: form.slotMinutes,
                      validFrom: form.validFrom,
                      validUntil: form.validUntil,
                    });
                    if (!result.ok) return { ok: false, message: `${WEEKDAYS[day]}: ${result.message}` };
                  }
                  return { ok: true };
                },
                form.days.length === 1 ? "Hours added" : `Hours added for ${form.days.length} days`,
                () => setForm(blank),
              );
            }}
          >
            <h3 className="text-table font-semibold">Add hours</h3>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Days</legend>
              {WEEK_ORDER.map((day) => {
                const on = form.days.includes(day);
                return (
                  <label
                    key={day}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-table select-none",
                      on ? "border-primary bg-primary-subtle font-semibold text-primary-deep" : "bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Checkbox checked={on} onCheckedChange={(v) => toggleDay(day, v === true)} aria-label={WEEKDAYS[day]} />
                    {WEEKDAYS[day].slice(0, 3)}
                  </label>
                );
              })}
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor={`set-${practitionerId}-start`}>From</Label>
                <Input id={`set-${practitionerId}-start`} type="time" required value={form.startTime} onChange={set("startTime")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`set-${practitionerId}-end`}>To</Label>
                <Input id={`set-${practitionerId}-end`} type="time" required value={form.endTime} onChange={set("endTime")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`set-${practitionerId}-slot`}>Slot length (minutes)</Label>
                <Input id={`set-${practitionerId}-slot`} type="number" min={5} max={240} required value={form.slotMinutes} onChange={set("slotMinutes")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`set-${practitionerId}-room`}>Room (optional)</Label>
                <NativeSelect emptyText="No rooms set up" id={`set-${practitionerId}-room`} value={form.roomId} onChange={set("roomId")}>
                  <option value="">No room</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`set-${practitionerId}-from`}>First day</Label>
                <DateInput id={`set-${practitionerId}-from`} required value={form.validFrom} onChange={set("validFrom")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`set-${practitionerId}-until`}>Last day (optional)</Label>
                <DateInput id={`set-${practitionerId}-until`} min={form.validFrom} value={form.validUntil} onChange={set("validUntil")} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Add hours"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
