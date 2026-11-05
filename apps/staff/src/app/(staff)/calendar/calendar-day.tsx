"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DoorOpenIcon,
  MapPinIcon,
  StethoscopeIcon,
  UsersIcon,
} from "lucide-react";
import { Badge, Button, Card } from "@healthcare/ui/primitives";
import type { AppointmentStatusApi, CalendarEventItem } from "@/lib/api/types";
import {
  type CalendarEntry,
  type DayBlock,
  dayHourRange,
  daySpan,
  daySummary,
  durationLabel,
  EVENT_KIND_LABEL,
  layoutDay,
  minuteOfDay,
  stepDate,
  timeLabel,
  viewDays,
} from "@/lib/calendar";

/** Height of one hour on the timeline, in pixels. */
const HOUR_PX = 84;
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

const APPOINTMENT_STATUS: Record<AppointmentStatusApi, { label: string; variant: "info" | "success" | "neutral" | "danger" | "warning" }> = {
  booked: { label: "Booked", variant: "info" },
  confirmed: { label: "Confirmed", variant: "info" },
  checked_in: { label: "Checked in", variant: "success" },
  completed: { label: "Completed", variant: "neutral" },
  cancelled: { label: "Cancelled", variant: "danger" },
  no_show: { label: "No-show", variant: "warning" },
};

interface Column {
  key: string;
  name: string | null;
  entries: CalendarEntry[];
}

/**
 * The day: a mini month to move around, the day's figures and what is next on the left; the hours of the day with each entry
 * drawn where it falls (overlapping entries side by side) in the middle; and the selected entry in full on the right.
 * Appointments are read here; booking and check-in stay on the appointments screens.
 */
export function DayView({
  date,
  today,
  nowIso,
  entries,
  timeZone,
  byRoom,
  canManage,
  canOpenAppointments,
  practitionerNames,
  onEditEvent,
  onCancelEvent,
  onNewEvent,
}: {
  date: string;
  today: string;
  /** The server's time when the page was rendered (the client keeps it moving), so the first paint matches on both sides. */
  nowIso: string;
  entries: CalendarEntry[];
  timeZone: string;
  byRoom: boolean;
  canManage: boolean;
  canOpenAppointments: boolean;
  practitionerNames: Map<string, string>;
  onEditEvent: (event: CalendarEventItem) => void;
  onCancelEvent: (event: CalendarEventItem) => void;
  onNewEvent: () => void;
}) {
  const [now, setNow] = React.useState(() => Date.parse(nowIso));
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [pickedKey, setPickedKey] = React.useState<string | null>(null);

  const allDay = entries.filter((e) => e.allDay);
  const timed = entries.filter((e) => !e.allDay);
  const summary = React.useMemo(() => daySummary(entries, date, timeZone), [entries, date, timeZone]);

  const columns = React.useMemo<Column[]>(() => {
    if (!byRoom) return [{ key: "day", name: null, entries: timed }];
    const rooms = new Map<string, Column>();
    for (const entry of timed) {
      const room = entry.appointment?.room ?? null;
      const key = room?.id ?? "none";
      const column = rooms.get(key) ?? { key, name: room?.name ?? "Events and no room", entries: [] };
      column.entries.push(entry);
      rooms.set(key, column);
    }
    return [...rooms.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : (a.name ?? "").localeCompare(b.name ?? "")));
  }, [byRoom, timed]);
  const laidOut = React.useMemo(() => columns.map((c) => ({ ...c, blocks: layoutDay(c.entries, date, timeZone) })), [columns, date, timeZone]);
  const { startHour, endHour } = React.useMemo(() => dayHourRange(laidOut.flatMap((c) => c.blocks)), [laidOut]);

  const nowMinute = date === today ? minuteOfDay(new Date(now).toISOString(), date, timeZone) : null;
  // What is shown in the panel: the entry picked, else the one under way or next, else the first of the day.
  const upcoming = timed.filter((e) => !e.cancelled && (nowMinute === null || daySpan(e, date, timeZone).end > nowMinute));
  const selected = entries.find((e) => e.key === pickedKey) ?? upcoming[0] ?? timed[0] ?? allDay[0] ?? null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[16.5rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1fr)_20rem]">
      <div className="order-2 flex flex-col gap-4 lg:order-1 lg:row-span-2 xl:row-span-1">
        <MiniMonth date={date} today={today} />
        <DaySummaryCard summary={summary} />
        <UpNext
          entries={upcoming.slice(0, 4)}
          selectedKey={selected?.key ?? null}
          timeZone={timeZone}
          onPick={setPickedKey}
          nowMinute={nowMinute}
          date={date}
        />
      </div>

      <Card className="order-1 overflow-hidden p-0 lg:order-2">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-section font-semibold">
            Entries <span className="ml-1 text-table font-normal text-muted-foreground">{entries.length === 1 ? "1 entry" : `${entries.length} entries`}</span>
          </h2>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={onNewEvent}>
              New event
            </Button>
          ) : null}
        </div>

        {allDay.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b bg-muted/40 px-4 py-2" aria-label="All-day events">
            {allDay.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setPickedKey(entry.key)}
                aria-pressed={selected?.key === entry.key}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-table hover:bg-accent ${
                  selected?.key === entry.key ? "border-primary ring-2 ring-primary/30" : "border-info/25 bg-info-subtle text-info-foreground"
                } ${entry.cancelled ? "line-through opacity-60" : ""}`}
              >
                <UsersIcon className="size-3.5" aria-hidden /> All day · {entry.title}
              </button>
            ))}
          </div>
        ) : null}

        {entries.length === 0 ? <p className="px-4 py-10 text-center text-body text-muted-foreground">Nothing is scheduled for this day.</p> : null}

        <div className="overflow-x-auto">
          <div className="min-w-[32rem] pt-3">
            {byRoom ? (
              <div className="flex border-b pl-14 text-meta font-medium text-muted-foreground">
                {laidOut.map((c) => (
                  <div key={c.key} className="min-w-0 flex-1 truncate border-l px-2 py-1.5">
                    {c.name}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="relative" style={{ height: (endHour - startHour) * HOUR_PX + 8 }}>
              {Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).map((hour) => (
                <div key={hour} className="absolute right-0 left-0 border-t border-border/70" style={{ top: (hour - startHour) * HOUR_PX + 4 }}>
                  <span className="absolute -top-2.5 left-1 w-12 bg-card pr-2 text-right text-meta whitespace-nowrap text-muted-foreground tabular-nums">
                    {hourLabel(hour)}
                  </span>
                </div>
              ))}
              <div className="absolute inset-y-0 right-3 left-14 flex">
                {laidOut.map((column) => (
                  <div key={column.key} className={`relative min-w-0 flex-1 ${byRoom ? "border-l" : ""}`}>
                    {column.blocks.map((block) => (
                      <TimelineBlock
                        key={block.entry.key}
                        block={block}
                        startHour={startHour}
                        timeZone={timeZone}
                        selected={selected?.key === block.entry.key}
                        practitionerName={block.entry.appointment ? (practitionerNames.get(block.entry.appointment.practitionerId) ?? null) : null}
                        onPick={() => setPickedKey(block.entry.key)}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {nowMinute !== null && nowMinute >= startHour * 60 && nowMinute <= endHour * 60 ? (
                <div
                  className="pointer-events-none absolute right-0 left-0 z-10 flex items-center"
                  style={{ top: ((nowMinute - startHour * 60) / 60) * HOUR_PX + 4 }}
                >
                  <span className="ml-1 rounded bg-danger px-1 py-0.5 text-meta font-medium text-white tabular-nums">
                    {timeLabel(new Date(now).toISOString(), timeZone)}
                  </span>
                  <span className="h-px flex-1 bg-danger" />
                  <span className="sr-only">Current time</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <div className="order-3 xl:col-start-3 xl:row-start-1">
        <DetailPanel
          entry={selected}
          date={date}
          timeZone={timeZone}
          practitionerName={selected?.appointment ? (practitionerNames.get(selected.appointment.practitionerId) ?? null) : null}
          canOpenAppointments={canOpenAppointments}
          onEditEvent={onEditEvent}
          onCancelEvent={onCancelEvent}
        />
      </div>
    </div>
  );
}

function hourLabel(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function TimelineBlock({
  block,
  startHour,
  timeZone,
  selected,
  practitionerName,
  onPick,
}: {
  block: DayBlock;
  startHour: number;
  timeZone: string;
  selected: boolean;
  practitionerName: string | null;
  onPick: () => void;
}) {
  const { entry } = block;
  const top = ((block.start - startHour * 60) / 60) * HOUR_PX + 4;
  const height = Math.max(((block.end - block.start) / 60) * HOUR_PX - 2, 22);
  const roomy = height >= 40;
  const isEvent = entry.source === "event";
  const Icon = isEvent ? UsersIcon : StethoscopeIcon;
  const range = `${timeLabel(entry.startsAt, timeZone)} – ${timeLabel(entry.endsAt, timeZone)}`;
  const status = entry.appointment ? APPOINTMENT_STATUS[entry.appointment.status] : null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={`${range}, ${entry.title}${entry.cancelled ? " (cancelled)" : ""}`}
      className={`absolute flex flex-col gap-0.5 overflow-hidden rounded-lg border px-2.5 text-left text-meta leading-tight ${height < 60 ? "justify-center py-0.5" : "justify-start py-1.5"} transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
        isEvent ? "border-info/30 bg-info-subtle text-info-foreground" : "border-primary/25 bg-primary-subtle text-foreground"
      } ${selected ? "z-[5] border-primary ring-2 ring-primary" : ""} ${entry.cancelled ? "opacity-60" : ""}`}
      style={{ top, height, left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`, width: `calc(${100 / block.lanes}% - 4px)` }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className={`truncate font-medium ${entry.cancelled ? "line-through" : ""}`}>{entry.title}</span>
        <span className="ml-auto shrink-0 tabular-nums">{durationLabel(block.end - block.start)}</span>
      </span>
      {roomy ? (
        <span className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-muted-foreground">
          <span className="shrink-0 tabular-nums">{range}</span>
          {status ? <span className="shrink-0 font-medium text-foreground">{status.label}</span> : null}
          {entry.cancelled && !status ? <span className="shrink-0 font-medium text-foreground">Cancelled</span> : null}
          {practitionerName ? <span className="min-w-0 truncate">{practitionerName}</span> : null}
          {entry.detail && !entry.appointment ? <span className="min-w-0 truncate">{entry.detail}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

function MiniMonth({ date, today }: { date: string; today: string }) {
  const days = viewDays("month", date);
  const month = date.slice(0, 7);
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-table font-semibold">{title}</h2>
        <nav aria-label="Change month" className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={`/calendar?view=day&date=${stepDate("month", date, -1)}`} aria-label="Previous month">
              <ChevronLeftIcon />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={`/calendar?view=day&date=${stepDate("month", date, 1)}`} aria-label="Next month">
              <ChevronRightIcon />
            </Link>
          </Button>
        </nav>
      </div>
      <div role="group" aria-label={title} className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAY_LETTERS.map((d, i) => (
          <span key={i} aria-hidden className="pb-1 text-meta font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const selected = day === date;
          return (
            <Link
              key={day}
              href={`/calendar?view=day&date=${day}`}
              aria-label={`Open ${day}${day === today ? " (today)" : ""}`}
              aria-current={selected ? "date" : undefined}
              className={`mx-auto flex size-8 items-center justify-center rounded-full text-table tabular-nums hover:bg-accent ${
                selected
                  ? "bg-primary font-semibold text-primary-foreground hover:bg-primary"
                  : day === today
                    ? "font-semibold text-primary ring-1 ring-primary"
                    : inMonth
                      ? ""
                      : "text-muted-foreground/60"
              }`}
            >
              {Number(day.slice(8))}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function DaySummaryCard({ summary }: { summary: ReturnType<typeof daySummary> }) {
  const total = summary.appointmentMinutes + summary.eventMinutes;
  const share = total > 0 ? (summary.appointmentMinutes / total) * 100 : 0;
  return (
    <Card className="p-4">
      <div className="flex items-end justify-between">
        <h2 className="text-table font-semibold">Day total</h2>
        <p className="text-3xl font-semibold tabular-nums">{total === 0 ? "0 h" : durationLabel(total)}</p>
      </div>
      <div
        role="img"
        aria-label={`${durationLabel(summary.appointmentMinutes)} of appointments and ${durationLabel(summary.eventMinutes)} of events`}
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted"
      >
        <span className="bg-primary" style={{ width: `${share}%` }} />
        <span className="bg-info" style={{ width: `${total > 0 ? 100 - share : 0}%` }} />
      </div>
      <dl className="mt-3 grid gap-1.5 text-table">
        <SummaryRow swatch="bg-primary" label="Appointments" value={`${summary.appointments} · ${durationLabel(summary.appointmentMinutes)}`} />
        <SummaryRow swatch="bg-info" label="Events" value={`${summary.events} · ${durationLabel(summary.eventMinutes)}`} />
        {summary.cancelled > 0 ? <SummaryRow swatch="bg-muted-foreground/50" label="Cancelled or no-show" value={String(summary.cancelled)} /> : null}
      </dl>
    </Card>
  );
}

function SummaryRow({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <span className={`size-2.5 rounded-sm ${swatch}`} aria-hidden /> {label}
      </dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function UpNext({
  entries,
  selectedKey,
  timeZone,
  onPick,
  nowMinute,
  date,
}: {
  entries: CalendarEntry[];
  selectedKey: string | null;
  timeZone: string;
  onPick: (key: string) => void;
  nowMinute: number | null;
  date: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-table font-semibold">{nowMinute === null ? "First of the day" : "Up next"}</h2>
      {entries.length === 0 ? <p className="mt-2 text-meta text-muted-foreground">Nothing more today.</p> : null}
      <ul className="mt-2 flex flex-col divide-y">
        {entries.map((entry) => {
          const underway = nowMinute !== null && daySpan(entry, date, timeZone).start <= nowMinute;
          return (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => onPick(entry.key)}
                aria-pressed={selectedKey === entry.key}
                className="flex w-full items-center gap-3 rounded-md py-2 text-left hover:bg-accent aria-pressed:bg-accent"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
                  {entry.source === "event" ? <UsersIcon className="size-4" aria-hidden /> : <StethoscopeIcon className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-table font-medium">{entry.title}</span>
                  <span className="block truncate text-meta text-muted-foreground">
                    {timeLabel(entry.startsAt, timeZone)}
                    {underway ? " · under way" : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DetailPanel({
  entry,
  date,
  timeZone,
  practitionerName,
  canOpenAppointments,
  onEditEvent,
  onCancelEvent,
}: {
  entry: CalendarEntry | null;
  date: string;
  timeZone: string;
  practitionerName: string | null;
  canOpenAppointments: boolean;
  onEditEvent: (event: CalendarEventItem) => void;
  onCancelEvent: (event: CalendarEventItem) => void;
}) {
  if (!entry) {
    return (
      <Card className="p-5">
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <CalendarClockIcon className="size-5" aria-hidden /> Select an entry to see its details.
        </p>
      </Card>
    );
  }
  const span = entry.allDay ? null : daySpan(entry, date, timeZone);
  const duration = span ? durationLabel(span.end - span.start) : "All day";
  const time = entry.allDay ? "All day" : `${timeLabel(entry.startsAt, timeZone)} – ${timeLabel(entry.endsAt, timeZone)}`;
  const event = entry.event;
  const appointment = entry.appointment;
  const status = appointment ? APPOINTMENT_STATUS[appointment.status] : null;
  return (
    <Card className="p-5" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        {event ? EVENT_KIND_LABEL[event.kind] : "Appointment"}
        {status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
        {event?.status === "cancelled" ? <Badge variant="danger">Cancelled</Badge> : null}
      </p>
      <h2 className="mt-1 text-section font-semibold">{entry.title}</h2>
      {appointment && practitionerName ? <p className="text-body text-muted-foreground">with {practitionerName}</p> : null}
      {event?.location ? (
        <p className="mt-0.5 flex items-center gap-1.5 text-body text-muted-foreground">
          <MapPinIcon className="size-4" aria-hidden /> {event.location}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <div className="rounded-lg bg-muted/60 p-3">
          <dt className="text-meta text-muted-foreground">Duration</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums">{duration}</dd>
        </div>
        <div className="rounded-lg bg-muted/60 p-3">
          <dt className="text-meta text-muted-foreground">Time</dt>
          <dd className="mt-0.5 text-table font-semibold whitespace-nowrap">{time}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 border-t pt-4 text-body">
        {appointment?.room ? (
          <p className="flex items-center gap-2">
            <DoorOpenIcon className="size-4 text-muted-foreground" aria-hidden /> {appointment.room.name}
          </p>
        ) : null}
        {appointment?.reason ? (
          <div>
            <p className="text-meta font-medium text-muted-foreground">Reason for the visit</p>
            <p className="whitespace-pre-wrap">{appointment.reason}</p>
          </div>
        ) : null}
        {appointment?.bookedByPatient ? (
          <p className="flex items-center gap-2 text-table text-muted-foreground">
            <CheckCircle2Icon className="size-4" aria-hidden /> Booked online by the patient
          </p>
        ) : null}
        {event ? (
          <>
            <p className="flex items-center gap-2 text-table text-muted-foreground">
              <ClockIcon className="size-4" aria-hidden /> Organized by {event.organizerName}
              {event.visibility === "invitees" ? " · invitees only" : ""}
            </p>
            {event.description ? (
              <div>
                <p className="text-meta font-medium text-muted-foreground">Notes</p>
                <p className="whitespace-pre-wrap">{event.description}</p>
              </div>
            ) : null}
            {event.attendees.length > 0 ? (
              <div>
                <p className="text-meta font-medium text-muted-foreground">Invited</p>
                <p>{event.attendees.map((a) => a.displayName).join(", ")}</p>
              </div>
            ) : null}
            {event.status === "cancelled" && event.cancelReason ? (
              <p role="status" className="rounded-md bg-danger-subtle p-2 text-table text-danger-foreground">
                Cancelled: {event.cancelReason}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {event && event.editable && event.status === "scheduled" ? (
          <>
            <Button onClick={() => onEditEvent(event)}>Edit event</Button>
            <Button variant="outline" onClick={() => onCancelEvent(event)}>
              Cancel event…
            </Button>
          </>
        ) : null}
        {appointment && canOpenAppointments ? (
          <Button asChild>
            <Link href={`/appointments?date=${date}`}>Open in appointments</Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
