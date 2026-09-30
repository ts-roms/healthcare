"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon, ClockIcon, MapPinIcon, StethoscopeIcon, UsersIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { AppointmentItem, CalendarEventItem, Practitioner } from "@/lib/api/types";
import {
  type CalendarEntry,
  type CalendarView,
  entriesByDay,
  EVENT_KIND_LABEL,
  eventInstants,
  localDay,
  localTimeOf,
  toEntries,
  viewDays,
  weekdayOf,
} from "@/lib/calendar";
import { cancelCalendarEvent, createCalendarEvent, updateCalendarEvent } from "./actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_CHIP_LIMIT = 3;
const KINDS = Object.keys(EVENT_KIND_LABEL) as CalendarEventItem["kind"][];

interface EventForm {
  title: string;
  kind: CalendarEventItem["kind"];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  location: string;
  description: string;
  visibility: "facility" | "invitees";
  attendeeUserIds: string[];
}

function blankForm(date: string): EventForm {
  return {
    title: "",
    kind: "meeting",
    startDate: date,
    startTime: "09:00",
    endDate: date,
    endTime: "10:00",
    allDay: false,
    location: "",
    description: "",
    visibility: "facility",
    attendeeUserIds: [],
  };
}

function formOf(event: CalendarEventItem, timeZone: string): EventForm {
  // An all-day event's end is the next midnight: show the last day it covers.
  const lastInstant = new Date(Date.parse(event.endsAt) - 1).toISOString();
  return {
    title: event.title,
    kind: event.kind,
    startDate: localDay(event.startsAt, timeZone),
    startTime: event.allDay ? "09:00" : localTimeOf(event.startsAt, timeZone),
    endDate: event.allDay ? localDay(lastInstant, timeZone) : localDay(event.endsAt, timeZone),
    endTime: event.allDay ? "10:00" : localTimeOf(event.endsAt, timeZone),
    allDay: event.allDay,
    location: event.location ?? "",
    description: event.description ?? "",
    visibility: event.visibility,
    attendeeUserIds: event.attendees.map((a) => a.userId),
  };
}

export function CalendarBoard({
  view,
  date,
  today,
  events,
  appointments,
  appointmentsTruncated,
  practitioners,
  canManage,
  canOpenAppointments,
  facilityId,
  timeZone,
}: {
  view: CalendarView;
  date: string;
  today: string;
  events: CalendarEventItem[];
  appointments: AppointmentItem[];
  appointmentsTruncated: boolean;
  practitioners: Practitioner[];
  canManage: boolean;
  canOpenAppointments: boolean;
  facilityId: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<{ event: CalendarEventItem | null; date: string } | null>(null);
  const [viewing, setViewing] = React.useState<CalendarEventItem | null>(null);
  const [showAppointments, setShowAppointments] = React.useState(true);

  const practitionerNames = React.useMemo(() => new Map(practitioners.map((p) => [p.id, p.displayName])), [practitioners]);
  const entries = React.useMemo(
    () =>
      toEntries(events, showAppointments ? appointments : [], (a) => ({
        title: a.patient?.displayName ?? "Appointment",
        detail: practitionerNames.get(a.practitionerId) ?? null,
      })),
    [events, appointments, showAppointments, practitionerNames],
  );
  const byDay = React.useMemo(() => entriesByDay(entries, timeZone), [entries, timeZone]);
  const days = viewDays(view, date);
  const month = date.slice(0, 7);

  const run = (call: () => Promise<ActionResult<unknown>>, success: string, done: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        done();
        router.refresh();
      } else {
        toast.error(result.message);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {canManage ? (
          <Button size="sm" onClick={() => setEditing({ event: null, date })}>
            <CalendarPlusIcon /> New event
          </Button>
        ) : null}
        {canOpenAppointments ? (
          <label className="flex items-center gap-2 text-table">
            <Checkbox checked={showAppointments} onCheckedChange={(v) => setShowAppointments(v === true)} aria-label="Show appointments" />
            Show appointments
          </label>
        ) : null}
        <span className="ml-auto flex items-center gap-3 text-meta text-muted-foreground">
          <span className="flex items-center gap-1">
            <UsersIcon className="size-3.5" aria-hidden /> Event
          </span>
          <span className="flex items-center gap-1">
            <StethoscopeIcon className="size-3.5" aria-hidden /> Appointment
          </span>
        </span>
      </div>
      {appointmentsTruncated ? (
        <p role="status" className="text-table text-warning-foreground">
          Showing the first 500 appointments of this period. Use a shorter view to see the rest.
        </p>
      ) : null}

      {view === "month" ? (
        <div role="grid" aria-label="Month" className="overflow-x-auto">
          <div className="grid min-w-[42rem] grid-cols-7 border-t border-l">
            {WEEKDAYS.map((d) => (
              <div key={d} role="columnheader" className="border-r border-b bg-muted px-2 py-1 text-meta font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const items = byDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  role="gridcell"
                  className={`min-h-28 border-r border-b p-1 ${day.slice(0, 7) === month ? "" : "bg-muted/40 text-muted-foreground"}`}
                >
                  <Link
                    href={`/calendar?view=day&date=${day}`}
                    aria-label={`Open ${day}`}
                    aria-current={day === today ? "date" : undefined}
                    className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-meta hover:underline ${day === today ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    {Number(day.slice(8))}
                  </Link>
                  <ul className="flex flex-col gap-0.5">
                    {items.slice(0, MONTH_CHIP_LIMIT).map((entry) => (
                      <li key={entry.key}>
                        <EntryChip entry={entry} timeZone={timeZone} compact onOpenEvent={setViewing} />
                      </li>
                    ))}
                  </ul>
                  {items.length > MONTH_CHIP_LIMIT ? (
                    <Link href={`/calendar?view=day&date=${day}`} className="mt-0.5 block px-1 text-meta text-primary hover:underline">
                      +{items.length - MONTH_CHIP_LIMIT} more
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={`grid gap-3 ${view === "week" ? "md:grid-cols-2 xl:grid-cols-7" : ""}`}>
          {days.map((day) => {
            const items = byDay.get(day) ?? [];
            return (
              <Card key={day} className="p-3">
                <h2 className={`text-table font-medium ${day === today ? "text-primary" : ""}`}>
                  {WEEKDAYS[weekdayOf(day)]} {Number(day.slice(8))}
                  {day === today ? " (today)" : ""}
                </h2>
                {items.length === 0 ? <p className="mt-2 text-meta text-muted-foreground">Nothing scheduled.</p> : null}
                <ul className="mt-2 flex flex-col gap-1">
                  {items.map((entry) => (
                    <li key={entry.key}>
                      <EntryChip entry={entry} timeZone={timeZone} onOpenEvent={setViewing} />
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        {viewing ? (
          <EventDetail
            event={viewing}
            timeZone={timeZone}
            pending={pending}
            onEdit={() => {
              setEditing({ event: viewing, date });
              setViewing(null);
            }}
            onCancel={(reason) =>
              run(
                () => cancelCalendarEvent({ eventId: viewing.id, version: viewing.version, reason }),
                "Event cancelled",
                () => setViewing(null),
              )
            }
          />
        ) : null}
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <EventFormDialog
            key={editing.event?.id ?? "new"}
            initial={editing.event ? formOf(editing.event, timeZone) : blankForm(editing.date)}
            editing={editing.event}
            practitioners={practitioners}
            timeZone={timeZone}
            pending={pending}
            onSubmit={(form) => {
              const instants = eventInstants(form, timeZone);
              if (!instants) {
                toast.error("The event must end after it starts.");
                return;
              }
              const fields = {
                title: form.title,
                kind: form.kind,
                ...instants,
                allDay: form.allDay,
                location: form.location,
                description: form.description,
                visibility: form.visibility,
                attendeeUserIds: form.attendeeUserIds,
              };
              const event = editing.event;
              run(
                () => (event ? updateCalendarEvent({ eventId: event.id, version: event.version, ...fields }) : createCalendarEvent({ facilityId, ...fields })),
                event ? "Event updated" : "Event added",
                () => setEditing(null),
              );
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function EntryChip({
  entry,
  timeZone,
  compact = false,
  onOpenEvent,
}: {
  entry: CalendarEntry;
  timeZone: string;
  compact?: boolean;
  onOpenEvent: (event: CalendarEventItem) => void;
}) {
  const time = entry.allDay ? "All day" : localTimeOf(entry.startsAt, timeZone);
  const isEvent = entry.source === "event";
  const Icon = isEvent ? UsersIcon : StethoscopeIcon;
  const className = `flex w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left text-meta hover:bg-accent ${
    isEvent ? "border-info/25 bg-info-subtle text-info-foreground" : "bg-card"
  } ${entry.cancelled ? "line-through opacity-60" : ""}`;
  const content = (
    <>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="shrink-0 tabular-nums">{time}</span>
      <span className="truncate">{entry.title}</span>
      {entry.cancelled ? <span className="sr-only">(cancelled)</span> : null}
      {!compact && entry.detail ? <span className="ml-auto hidden truncate text-muted-foreground xl:inline">{entry.detail}</span> : null}
    </>
  );
  if (entry.event) {
    const event = entry.event;
    return (
      <button type="button" className={className} onClick={() => onOpenEvent(event)}>
        {content}
      </button>
    );
  }
  const day = localDay(entry.startsAt, timeZone);
  return (
    <Link className={className} href={`/appointments?date=${day}`}>
      {content}
    </Link>
  );
}

function EventDetail({
  event,
  timeZone,
  pending,
  onEdit,
  onCancel,
}: {
  event: CalendarEventItem;
  timeZone: string;
  pending: boolean;
  onEdit: () => void;
  onCancel: (reason: string) => void;
}) {
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const when = event.allDay
    ? `All day, ${localDay(event.startsAt, timeZone)}${localDay(new Date(Date.parse(event.endsAt) - 1).toISOString(), timeZone) !== localDay(event.startsAt, timeZone) ? ` to ${localDay(new Date(Date.parse(event.endsAt) - 1).toISOString(), timeZone)}` : ""}`
    : `${localDay(event.startsAt, timeZone)} ${localTimeOf(event.startsAt, timeZone)} – ${localTimeOf(event.endsAt, timeZone)}`;
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{event.title}</DialogTitle>
        <DialogDescription>
          {EVENT_KIND_LABEL[event.kind]} · organized by {event.organizerName}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 text-body">
        <p className="flex items-center gap-2">
          <ClockIcon className="size-4" aria-hidden /> {when}
        </p>
        {event.location ? (
          <p className="flex items-center gap-2">
            <MapPinIcon className="size-4" aria-hidden /> {event.location}
          </p>
        ) : null}
        {event.description ? <p className="whitespace-pre-wrap">{event.description}</p> : null}
        {event.attendees.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1">
            <UsersIcon className="size-4" aria-hidden /> {event.attendees.map((a) => a.displayName).join(", ")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Badge variant={event.status === "cancelled" ? "neutral" : "info"}>{event.status === "cancelled" ? "Cancelled" : "Scheduled"}</Badge>
          {event.visibility === "invitees" ? <Badge variant="outline">Invitees only</Badge> : null}
        </div>
        {event.status === "cancelled" && event.cancelReason ? <p className="text-table text-muted-foreground">Reason: {event.cancelReason}</p> : null}
      </div>
      {event.editable && event.status === "scheduled" ? (
        cancelling ? (
          <div className="grid gap-2">
            <Label htmlFor="cancel-event-reason">Why is it cancelled?</Label>
            <Textarea id="cancel-event-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelling(false)} disabled={pending}>
                Keep event
              </Button>
              <Button variant="destructive" onClick={() => onCancel(reason)} disabled={pending || reason.trim().length < 3}>
                Cancel event
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(true)}>
              Cancel event…
            </Button>
            <Button onClick={onEdit}>Edit</Button>
          </DialogFooter>
        )
      ) : null}
    </DialogContent>
  );
}

function EventFormDialog({
  initial,
  editing,
  practitioners,
  timeZone,
  pending,
  onSubmit,
}: {
  initial: EventForm;
  editing: CalendarEventItem | null;
  practitioners: Practitioner[];
  timeZone: string;
  pending: boolean;
  onSubmit: (form: EventForm) => void;
}) {
  const [form, setForm] = React.useState(initial);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const invitable = practitioners.filter((p) => p.userId);
  const toggle = (userId: string, on: boolean) =>
    set("attendeeUserIds", on ? [...new Set([...form.attendeeUserIds, userId])] : form.attendeeUserIds.filter((id) => id !== userId));
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription>Times are in the facility&apos;s time zone ({timeZone}). Do not put patient details in an event.</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor="event-title">Title</Label>
          <Input id="event-title" value={form.title} onChange={(e) => set("title", e.target.value)} required minLength={2} maxLength={200} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="event-kind">Type</Label>
          <NativeSelect id="event-kind" value={form.kind} onChange={(e) => set("kind", e.target.value as EventForm["kind"])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 text-table">
          <Checkbox checked={form.allDay} onCheckedChange={(v) => set("allDay", v === true)} /> All day
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="event-start-date">Starts</Label>
            <Input
              id="event-start-date"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
              required
            />
          </div>
          {form.allDay ? null : (
            <div className="grid gap-1">
              <Label htmlFor="event-start-time">Start time</Label>
              <Input id="event-start-time" type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} required />
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor="event-end-date">Ends</Label>
            <Input id="event-end-date" type="date" value={form.endDate} min={form.startDate} onChange={(e) => set("endDate", e.target.value)} required />
          </div>
          {form.allDay ? null : (
            <div className="grid gap-1">
              <Label htmlFor="event-end-time">End time</Label>
              <Input id="event-end-time" type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} required />
            </div>
          )}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="event-location">Location (optional)</Label>
          <Input id="event-location" value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={200} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="event-description">Notes (optional)</Label>
          <Textarea id="event-description" value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} maxLength={2000} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="event-visibility">Who can see it</Label>
          <NativeSelect id="event-visibility" value={form.visibility} onChange={(e) => set("visibility", e.target.value as EventForm["visibility"])}>
            <option value="facility">Everyone with calendar access at this facility</option>
            <option value="invitees">Only me and the people invited</option>
          </NativeSelect>
        </div>
        {invitable.length > 0 ? (
          <fieldset className="grid gap-1">
            <legend className="text-table font-medium">Invite clinicians</legend>
            <div className="grid max-h-32 gap-1 overflow-y-auto">
              {invitable.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-table">
                  <Checkbox checked={form.attendeeUserIds.includes(p.userId!)} onCheckedChange={(v) => toggle(p.userId!, v === true)} />
                  {p.displayName}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <DialogFooter>
          <Button type="submit" disabled={pending || form.title.trim().length < 2}>
            {editing ? "Save changes" : "Add event"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
