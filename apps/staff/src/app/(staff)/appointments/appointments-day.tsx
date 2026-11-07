"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  CalendarXIcon,
  ChevronDownIcon,
  Clock3Icon,
  DoorOpenIcon,
  ListIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MousePointerClickIcon,
  UsersIcon,
  UserXIcon,
} from "lucide-react";
import { AppointmentCard, AppointmentStatusBadge, clinicalDate, clinicalDateTime, clinicalTime } from "@healthcare/ui/healthcare";
import { Button, Card, Checkbox, Input, Label, NativeSelect, Popover, PopoverContent, PopoverTrigger, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { AppointmentItem, ClinicRoom, Practitioner, PractitionerScheduleRow, ScheduleExceptionRow, VisitType } from "@/lib/api/types";
import {
  closuresOn,
  dayFigures,
  durationText,
  holdsTime,
  initialsOf,
  minutesInZone,
  minutesToClock,
  placeAppointments,
  slotCount,
  timelineRange,
  unavailableBands,
  workingBlocks,
} from "@/lib/appointment-day";
import { localDay, stepDate } from "@/lib/calendar";
import { type AppointmentAction, appointmentActions, groupByPractitioner, groupByRoom, shiftDate, toAppointment, weekdayOf } from "@/lib/clinic-mapping";
import { type AppointmentPatientContext, appointmentPatientContext, cancelAppointment, checkInAppointment, confirmAppointment, markNoShow } from "./actions";
import { RescheduleForm } from "./reschedule-form";

/** `day`: a timeline per practitioner; `list` and `room`: the day as lists by practitioner or by room. */
export type AppointmentsView = "day" | "list" | "room" | "calendar";

/** In the order the switch shows them. */
const VIEW_LABEL: Record<AppointmentsView, string> = { day: "Day", calendar: "Calendar", list: "List", room: "By room" };
const VIEW_ICON: Record<AppointmentsView, React.ComponentType<{ "aria-hidden"?: boolean }>> = {
  day: Clock3Icon,
  calendar: CalendarDaysIcon,
  list: ListIcon,
  room: DoorOpenIcon,
};
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type Run = (call: () => Promise<ActionResult<unknown>>, success: string | ((data: unknown) => string), onOk?: () => void) => void;

export function AppointmentsDay({
  items,
  truncated,
  date,
  today,
  week,
  view,
  practitionerId,
  practitioners,
  visitTypes,
  schedules,
  closures,
  dayStart,
  dayEnd,
  canManage,
  canCheckIn,
  canOpenRecord,
  facilityId,
  timeZone,
  rooms,
  month,
  initialAppointmentId,
}: {
  items: AppointmentItem[];
  truncated: boolean;
  date: string;
  today: string;
  /** Monday to Sunday around `date`, and whether each day has bookings. */
  week: { date: string; booked: boolean }[];
  view: AppointmentsView;
  practitionerId: string;
  practitioners: Practitioner[];
  visitTypes: VisitType[];
  schedules: PractitionerScheduleRow[];
  closures: ScheduleExceptionRow[];
  /** The instants `date` starts and ends in the facility's zone. */
  dayStart: string;
  dayEnd: string;
  canManage: boolean;
  canCheckIn: boolean;
  canOpenRecord: boolean;
  facilityId: string;
  timeZone: string;
  rooms: ClinicRoom[];
  /** The calendar view: the weeks around `date`'s month and their appointments (same practitioner filter). */
  month: { days: string[]; items: AppointmentItem[]; truncated: boolean } | null;
  /** The appointment to open in the side panel first (e.g. the one just booked); otherwise the next one up. */
  initialAppointmentId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [now, setNow] = React.useState(() => new Date());
  // Re-evaluates time-based actions (a no-show is offered once the appointment has started) and the now line.
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const isToday = date === today;
  const practitionerMap = React.useMemo(() => new Map(practitioners.map((p) => [p.id, p])), [practitioners]);
  const visitTypeMap = React.useMemo(() => new Map(visitTypes.map((v) => [v.id, v])), [visitTypes]);
  const figures = dayFigures(items, now);

  // Each practitioner's day: working blocks, closures, and the slots still open.
  const shown = practitionerId ? practitioners.filter((p) => p.id === practitionerId) : practitioners;
  const days = shown
    .map((p) => {
      const blocks = workingBlocks(schedules, p.id, facilityId, date);
      const own = items.filter((a) => a.practitionerId === p.id);
      return { practitioner: p, blocks, closures: closuresOn(closures, p.id, dayStart, dayEnd, timeZone), items: own };
    })
    .filter((d) => d.blocks.length > 0 || d.items.length > 0);
  const slots = days.reduce(
    (sum, d) => {
      const booked = d.items.filter(holdsTime).map((a) => ({ start: minutesInZone(a.startsAt, timeZone), end: minutesInZone(a.endsAt, timeZone) }));
      const c = slotCount(d.blocks, d.closures, booked);
      return { open: sum.open + c.open, total: sum.total + c.total };
    },
    { open: 0, total: 0 },
  );

  // The appointment in the side panel: the one picked, else the next one up, else the first of the day.
  const [picked, setPicked] = React.useState<string | null>(initialAppointmentId ?? null);
  const selected = items.find((a) => a.id === picked) ?? month?.items.find((a) => a.id === picked) ?? figures.nextUp ?? items[0] ?? null;
  // Check-in is offered only on the appointment's own day (in the calendar view it may be another day than `date`).
  const selectedIsToday = selected ? localDay(selected.startsAt, timeZone) === today : false;
  const step = (direction: -1 | 1) => (view === "calendar" ? stepDate("month", date, direction) : shiftDate(date, direction));

  const href = (next: { date?: string; practitionerId?: string; view?: AppointmentsView }) => {
    const d = next.date ?? date;
    const p = next.practitionerId ?? practitionerId;
    const v = next.view ?? view;
    return `/appointments?date=${d}${p ? `&practitionerId=${p}` : ""}${v !== "day" ? `&view=${v}` : ""}`;
  };

  const run: Run = (call, success, onOk) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(typeof success === "string" ? success : success(result.data));
        onOk?.();
      } else toast.error(result.message);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-row flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <nav aria-label="Change day" className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={href({ date: step(-1) })} aria-label={view === "calendar" ? "Previous month" : "Previous day"}>
              <ChevronLeftIcon />
            </Link>
          </Button>
          <h2 className="min-w-36 text-center text-section font-semibold" aria-live="polite">
            {view === "calendar" ? monthTitle(date) : longDate(date)}
          </h2>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={href({ date: step(1) })} aria-label={view === "calendar" ? "Next month" : "Next day"}>
              <ChevronRightIcon />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="ml-1">
            <Link href={href({ date: today })} aria-current={isToday ? "date" : undefined}>
              Today
            </Link>
          </Button>
        </nav>
        {view === "calendar" ? null : (
          <ol aria-label="This week" className="flex items-center gap-1 border-l pl-3">
            {week.map((d) => {
              const current = d.date === date;
              return (
                <li key={d.date}>
                  <Link
                    href={href({ date: d.date })}
                    aria-current={current ? "date" : undefined}
                    aria-label={`${longDate(d.date)}${d.booked ? ", has appointments" : ""}`}
                    className={`flex w-11 flex-col items-center rounded-lg py-1 text-center transition-colors ${
                      current ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <span className={`text-meta ${current ? "" : "text-muted-foreground"}`}>{WEEKDAY[weekdayOf(d.date)]}</span>
                    <span className="tabular text-section leading-tight font-semibold">{Number(d.date.slice(8))}</span>
                    <span
                      aria-hidden
                      className={`mt-0.5 size-1 rounded-full ${d.booked ? (current ? "bg-primary-foreground" : "bg-primary") : "bg-transparent"}`}
                    />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <nav aria-label="View" className="flex items-center rounded-lg border bg-muted/40 p-0.5">
            {(Object.keys(VIEW_LABEL) as AppointmentsView[]).map((v) => {
              const Icon = VIEW_ICON[v];
              return (
                <Link
                  key={v}
                  href={href({ view: v })}
                  aria-current={view === v ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-table font-medium transition-colors [&_svg]:size-4 ${
                    view === v ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon aria-hidden />
                  {VIEW_LABEL[v]}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <Label htmlFor="practitioner-filter" className="text-muted-foreground">
              Practitioner
            </Label>
            <NativeSelect
              emptyText="No practitioners set up"
              id="practitioner-filter"
              value={practitionerId}
              onChange={(e) => router.push(href({ practitionerId: e.target.value }))}
            >
              <option value="">All practitioners</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </Card>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Scheduled"
          value={String(figures.scheduled)}
          detail={figures.bookedMinutes ? `${durationText(figures.bookedMinutes)} booked` : "Nothing booked"}
        />
        <Figure label="Checked in" value={String(figures.checkedIn)} detail={figures.checkedIn ? `of ${figures.scheduled}` : "—"} />
        <Figure
          label="Open slots"
          value={slots.total ? String(slots.open) : "—"}
          detail={slots.total ? `of ${slots.total} ${isToday ? "today" : "this day"}` : "No published hours"}
        />
        <Figure
          label="Next up"
          value={figures.nextUp ? clinicalTime(figures.nextUp.startsAt) : "—"}
          detail={figures.nextUp ? (figures.nextUp.patient?.displayName ?? "Patient") : isToday ? "No one else today" : "Nothing booked"}
        />
      </dl>

      {truncated ? (
        <p role="status" className="text-table text-warning-foreground">
          Showing the first 100 appointments. Choose a practitioner to see the rest.
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {view === "calendar" && month ? (
            <MonthCalendar
              days={month.days}
              items={month.items}
              truncated={month.truncated}
              date={date}
              today={today}
              practitioners={practitionerMap}
              visitTypes={visitTypeMap}
              timeZone={timeZone}
              selectedId={selected?.id ?? null}
              onSelect={setPicked}
              dayHref={(d) => href({ date: d, view: "day" })}
            />
          ) : view === "day" ? (
            days.length === 0 ? (
              <Card className="p-6 text-body text-muted-foreground">No one is scheduled and nothing is booked on this day.</Card>
            ) : (
              <SharedTimeline
                days={days}
                visitTypes={visitTypeMap}
                timeZone={timeZone}
                nowMinutes={isToday ? minutesInZone(now.toISOString(), timeZone) : null}
                selectedId={selected?.id ?? null}
                onSelect={setPicked}
              />
            )
          ) : (
            <DayLists
              items={items}
              byRoom={view === "room"}
              rooms={rooms}
              practitioners={practitionerMap}
              visitTypes={visitTypeMap}
              selectedId={selected?.id ?? null}
              onSelect={setPicked}
            />
          )}
        </div>
        <aside aria-label="Selected appointment" className="lg:sticky lg:top-4">
          {selected ? (
            <AppointmentPanel
              key={selected.id}
              appointment={selected}
              practitioners={practitioners}
              practitionerName={practitionerMap.get(selected.practitionerId)?.displayName ?? "Practitioner"}
              visitType={visitTypeMap.get(selected.visitTypeId)}
              mapped={toAppointment(selected, practitionerMap, visitTypeMap)}
              actions={appointmentActions(selected, {
                now,
                isToday: selectedIsToday,
                canManage,
                canCheckIn,
                online: visitTypeMap.get(selected.visitTypeId)?.modality === "telemedicine",
              })}
              canOpenRecord={canOpenRecord}
              facilityId={facilityId}
              timeZone={timeZone}
              pending={pending}
              run={run}
            />
          ) : (
            <Card className="flex flex-col items-center gap-2 p-6 text-center text-body text-muted-foreground">
              <MousePointerClickIcon className="size-5" aria-hidden />
              Nothing booked on this day.
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="gap-1 px-4 py-3">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="tabular text-2xl leading-tight font-bold">{value}</dd>
      <dd className="truncate text-meta text-muted-foreground" title={detail}>
        {detail}
      </dd>
    </Card>
  );
}

/** Height of one hour on the timeline, per density; the viewer's choice is remembered in this browser only. */
const HOUR_HEIGHTS = { compact: 56, normal: 80, large: 120 } as const;
type HourHeight = keyof typeof HOUR_HEIGHTS;
const HOUR_HEIGHT_KEY = "appointments.hourHeight";
/** Narrowest an appointment gets when several overlap; past that the timeline scrolls sideways. */
const LANE_MIN_PX = 190;

type PractitionerDay = {
  practitioner: Practitioner;
  blocks: ReturnType<typeof workingBlocks>;
  closures: ReturnType<typeof closuresOn>;
  items: AppointmentItem[];
};

/**
 * Every practitioner's appointments on one shared timeline. Each appointment names its practitioner; chips at the top
 * narrow it to one or more practitioners. Appointments at the same time sit side by side (sideways scrolling when many
 * overlap). Working hours, breaks and closures are shaded once a single practitioner is chosen. It scrolls inside the
 * card and opens at the current time (today) or at the first booking.
 */
function SharedTimeline({
  days,
  visitTypes,
  timeZone,
  nowMinutes,
  selectedId,
  onSelect,
}: {
  days: PractitionerDay[];
  visitTypes: Map<string, VisitType>;
  timeZone: string;
  nowMinutes: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const density = React.useSyncExternalStore(subscribeHourHeight, readHourHeight, () => "normal" as const);
  const hourPx = HOUR_HEIGHTS[density];

  // Chosen practitioners; none chosen means everyone.
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(() => new Set());
  const onDuty = days;
  const visible = chosen.size === 0 ? onDuty : onDuty.filter((d) => chosen.has(d.practitioner.id));

  const nameOf = new Map(onDuty.map((d) => [d.practitioner.id, d.practitioner.displayName]));
  const items = visible.flatMap((d) => d.items);
  const placed = placeAppointments(items, timeZone);
  const single = visible.length === 1 ? visible[0] : undefined;
  const range = timelineRange(
    visible.flatMap((d) => d.blocks),
    placed,
  );
  const bands = single ? unavailableBands(single.blocks, single.closures, range) : [];
  const y = (minutes: number) => ((minutes - range.start) / 60) * hourPx;
  const total = y(range.end);
  const hours = Array.from({ length: (range.end - range.start) / 60 + 1 }, (_, i) => range.start + i * 60);
  const nowAt = nowMinutes !== null && nowMinutes >= range.start && nowMinutes <= range.end ? nowMinutes : null;
  const maxLanes = Math.max(1, ...placed.map((p) => p.lanes));

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const firstBooking = Math.min(Infinity, ...placed.map((p) => p.start));
  const firstBlock = Math.min(Infinity, ...visible.flatMap((d) => d.blocks.map((b) => b.start)));
  const focusMinute = nowAt ?? (Number.isFinite(firstBooking) ? firstBooking : Number.isFinite(firstBlock) ? firstBlock : range.start);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: Math.max(0, ((focusMinute - range.start) / 60) * hourPx - hourPx / 2) });
    // Only when the day, the practitioners shown, the first booking or the hour height change — not as the now line moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start, range.end, firstBooking, nowAt !== null, hourPx, chosen]);

  const bookedOf = (d: PractitionerDay) => d.items.filter(holdsTime).length;
  const booked = visible.reduce((n, d) => n + bookedOf(d), 0);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <header className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <h3 className="font-semibold">Schedule</h3>
            <p className="text-meta text-muted-foreground">
              {booked} booked ·{" "}
              {chosen.size === 0 ? `all ${onDuty.length} practitioner${onDuty.length === 1 ? "" : "s"}` : `${visible.length} of ${onDuty.length} practitioners`}
            </p>
          </div>
          <ul className="flex flex-wrap items-center gap-3 text-meta text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-primary" /> In person
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-chart-4" /> Telehealth
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-border" /> Unavailable
            </li>
          </ul>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <PractitionerFilter
              options={onDuty.map((d) => ({ id: d.practitioner.id, name: d.practitioner.displayName, booked: bookedOf(d) }))}
              chosen={chosen}
              onChange={setChosen}
            />
            <div role="radiogroup" aria-label="Hour height" className="flex items-center rounded-lg border p-0.5 text-meta">
              {(Object.keys(HOUR_HEIGHTS) as HourHeight[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={density === d}
                  onClick={() => writeHourHeight(d)}
                  className={`rounded-md px-2 py-1 capitalize ${density === d ? "bg-primary-subtle font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
        {single ? (
          <p className="text-meta text-muted-foreground">
            {single.blocks.length
              ? `Works ${single.blocks.map((b) => `${minutesToClock(b.start)}–${minutesToClock(b.end)}`).join(", ")} on this day`
              : "No published hours on this day"}
          </p>
        ) : null}
      </header>
      <div
        ref={scrollRef}
        role="region"
        aria-label={`Schedule, ${minutesToClock(range.start)} to ${minutesToClock(range.end)}`}
        tabIndex={0}
        className="max-h-[min(72vh,46rem)] [scrollbar-width:thin] overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="relative pt-3 pr-3 pl-14" style={{ minWidth: `calc(3.5rem + ${maxLanes * LANE_MIN_PX}px)` }}>
          <div className="relative" style={{ height: total + 12 }}>
            {hours.map((h) => (
              <React.Fragment key={h}>
                <div className="absolute inset-x-0 border-t" style={{ top: y(h) }} />
                {h < range.end && hourPx >= 80 ? (
                  <div className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: y(h + 30) }} />
                ) : null}
                <span className="tabular absolute -left-14 w-12 -translate-y-1/2 pr-1 text-right text-meta text-muted-foreground" style={{ top: y(h) }}>
                  {minutesToClock(h)}
                </span>
              </React.Fragment>
            ))}
            {bands.map((b, i) => (
              <div
                key={i}
                className="absolute inset-x-0 overflow-hidden bg-muted/40 px-2 py-1 text-meta text-muted-foreground"
                style={{
                  top: y(b.start),
                  height: y(b.end) - y(b.start),
                  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 8px, var(--color-border) 8px 9px)",
                }}
              >
                {y(b.end) - y(b.start) >= 20 ? b.label : null}
              </div>
            ))}
            {nowAt !== null ? (
              <div aria-hidden className="pointer-events-none absolute inset-x-0 z-[15] border-t-2 border-danger" style={{ top: y(nowAt) }}>
                <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-danger" />
              </div>
            ) : null}
            {placed.length === 0 ? (
              <p className="absolute inset-x-0 top-6 text-center text-body text-muted-foreground">
                Nothing booked for {single ? single.practitioner.displayName : "these practitioners"}.
              </p>
            ) : null}
            {placed.map(({ item: a, start, end, lane, lanes }) => {
              const online = visitTypes.get(a.visitTypeId)?.modality === "telemedicine";
              const inactive = !holdsTime(a);
              const height = Math.max(y(end) - y(start) - 2, 18);
              const minutes = end - start;
              const doctor = nameOf.get(a.practitionerId) ?? "Practitioner";
              const details = [visitTypes.get(a.visitTypeId)?.name, `${minutes} min`, a.reason].filter(Boolean).join(" · ");
              const isSelected = a.id === selectedId;
              const tall = height >= 40;
              const patient = a.patient?.displayName ?? "Patient";
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect(a.id)}
                  aria-pressed={isSelected}
                  aria-label={`${clinicalTime(a.startsAt)}, ${patient}, with ${doctor}, ${details}, ${STATUS_TEXT[a.status]}`}
                  title={`${clinicalTime(a.startsAt)} ${patient} · ${doctor} · ${details} · ${STATUS_TEXT[a.status]}`}
                  className={`absolute flex gap-2 overflow-hidden rounded-md border-l-4 px-2 text-left text-meta transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    tall ? "items-start py-1" : "items-center py-0"
                  } ${online ? "border-chart-4 bg-chart-4/10" : "border-primary bg-primary-subtle"} ${
                    isSelected ? "z-[16] shadow-md ring-2 ring-primary" : "z-10 hover:shadow-sm"
                  } ${inactive ? "opacity-60" : ""}`}
                  style={{ top: y(start) + 1, height, left: `calc(${(lane / lanes) * 100}% + 0.25rem)`, width: `calc(${100 / lanes}% - 0.5rem)` }}
                >
                  <span className="tabular shrink-0 font-semibold">{clinicalTime(a.startsAt)}</span>
                  {tall ? (
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-semibold ${inactive ? "line-through" : ""}`}>{patient}</span>
                      <span className="block truncate text-muted-foreground">
                        <span className="font-medium text-foreground">{doctor}</span> · {details}
                      </span>
                    </span>
                  ) : (
                    // Short blocks have room for one line: the practitioner and details follow the name.
                    <span className="min-w-0 flex-1 truncate">
                      <span className={`font-semibold ${inactive ? "line-through" : ""}`}>{patient}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        <span className="font-medium text-foreground">{doctor}</span> · {details}
                      </span>
                    </span>
                  )}
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center self-center rounded-full bg-card text-[9px] font-semibold text-primary"
                    title={doctor}
                  >
                    {initialsOf(doctor)}
                  </span>
                  <span aria-hidden className={`size-2 shrink-0 self-center rounded-full ${STATUS_DOT[a.status]}`} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Which practitioners the schedule shows: everyone, or any mix, picked from a dropdown with a search (for clinics with
 * many practitioners on duty). Each entry shows how many patients are booked with them that day.
 */
function PractitionerFilter({
  options,
  chosen,
  onChange,
}: {
  options: { id: string; name: string; booked: number }[];
  chosen: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  const label =
    chosen.size === 0
      ? "All practitioners"
      : chosen.size === 1
        ? (options.find((o) => chosen.has(o.id))?.name ?? "1 practitioner")
        : `${chosen.size} practitioners`;
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <Popover onOpenChange={(open) => (open ? null : setQuery(""))}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-64" aria-label={`Practitioners shown: ${label}`}>
          <UsersIcon />
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search practitioners" aria-label="Search practitioners" autoFocus />
        <ul className="flex max-h-72 [scrollbar-width:thin] flex-col overflow-y-auto" aria-label="Practitioners">
          <li>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted">
              <Checkbox checked={chosen.size === 0} onCheckedChange={() => onChange(new Set())} />
              <span className="flex-1 font-medium">All practitioners</span>
              <span className="tabular text-meta text-muted-foreground">{options.reduce((n, o) => n + o.booked, 0)}</span>
            </label>
          </li>
          {shown.map((o) => (
            <li key={o.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-muted">
                <Checkbox checked={chosen.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[10px] font-semibold text-primary"
                >
                  {initialsOf(o.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="tabular text-meta text-muted-foreground" title={`${o.booked} booked`}>
                  {o.booked}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-2 py-1.5 text-meta text-muted-foreground">No practitioner matches “{query}”.</li> : null}
        </ul>
        {chosen.size > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(new Set())}>
            Show all practitioners
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Appointments listed in a month cell before "+N more". */
const MONTH_CELL_LIMIT = 3;

/**
 * The month as a calendar: the weeks around the month, each day with its appointments (time, patient and the
 * practitioner's initials; in person or telehealth by colour). An appointment opens in the side panel; the date, or
 * "+N more", opens that day's timeline.
 */
function MonthCalendar({
  days,
  items,
  truncated,
  date,
  today,
  practitioners,
  visitTypes,
  timeZone,
  selectedId,
  onSelect,
  dayHref,
}: {
  days: string[];
  items: AppointmentItem[];
  truncated: boolean;
  date: string;
  today: string;
  practitioners: Map<string, Practitioner>;
  visitTypes: Map<string, VisitType>;
  timeZone: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dayHref: (date: string) => string;
}) {
  const byDay = new Map<string, AppointmentItem[]>();
  for (const a of [...items].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    const d = localDay(a.startsAt, timeZone);
    byDay.set(d, [...(byDay.get(d) ?? []), a]);
  }
  const month = date.slice(0, 7);
  const monthTotal = items.filter((a) => holdsTime(a) && localDay(a.startsAt, timeZone).startsWith(month)).length;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3">
        <h3 className="font-semibold">{monthTitle(date)}</h3>
        <p className="text-meta text-muted-foreground">{monthTotal} booked this month</p>
        <ul className="ml-auto flex flex-wrap items-center gap-3 text-meta text-muted-foreground" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm bg-primary" /> In person
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm bg-chart-4" /> Telehealth
          </li>
        </ul>
      </header>
      {truncated ? (
        <p role="status" className="border-b px-4 py-2 text-table text-warning-foreground">
          This month has more than 500 appointments; only the first 500 are shown. Choose a practitioner to see them all.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7">
          {WEEKDAY.map((w) => (
            <div key={w} className="border-b px-2 py-1.5 text-meta font-semibold text-muted-foreground">
              {w}
            </div>
          ))}
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d.startsWith(month);
            const isToday = d === today;
            const isChosen = d === date;
            const extra = list.length - MONTH_CELL_LIMIT;
            return (
              <div
                key={d}
                className={`flex min-h-28 min-w-0 flex-col gap-1 border-b p-1.5 ${i % 7 === 0 ? "" : "border-l"} ${inMonth ? "" : "bg-muted/40"} ${
                  isChosen ? "ring-2 ring-primary ring-inset" : ""
                }`}
              >
                <Link
                  href={dayHref(d)}
                  aria-label={`${longDate(d)}: ${list.length} appointment${list.length === 1 ? "" : "s"}. Open the day.`}
                  className={`tabular flex size-7 items-center justify-center self-start rounded-full text-meta font-semibold hover:bg-muted ${
                    isToday ? "bg-primary text-primary-foreground hover:bg-primary" : inMonth ? "" : "text-muted-foreground"
                  }`}
                >
                  {Number(d.slice(8))}
                </Link>
                {list.slice(0, MONTH_CELL_LIMIT).map((a) => {
                  const online = visitTypes.get(a.visitTypeId)?.modality === "telemedicine";
                  const doctor = practitioners.get(a.practitionerId)?.displayName ?? "Practitioner";
                  const patient = a.patient?.displayName ?? "Patient";
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onSelect(a.id)}
                      aria-pressed={a.id === selectedId}
                      aria-label={`${clinicalTime(a.startsAt)}, ${patient}, with ${doctor}, ${STATUS_TEXT[a.status]}`}
                      title={`${clinicalTime(a.startsAt)} ${patient} · ${doctor} · ${STATUS_TEXT[a.status]}`}
                      className={`flex min-w-0 items-center gap-1 rounded border-l-2 px-1 py-0.5 text-left text-[11px] leading-4 ${
                        online ? "border-chart-4 bg-chart-4/10" : "border-primary bg-primary-subtle"
                      } ${a.id === selectedId ? "ring-2 ring-primary" : "hover:brightness-95"} ${holdsTime(a) ? "" : "line-through opacity-60"}`}
                    >
                      <span className="tabular shrink-0 font-semibold">{clinicalTime(a.startsAt)}</span>
                      <span className="min-w-0 flex-1 truncate">{patient}</span>
                      <span aria-hidden className="shrink-0 text-[9px] font-semibold text-primary">
                        {initialsOf(doctor)}
                      </span>
                    </button>
                  );
                })}
                {extra > 0 ? (
                  <Link href={dayHref(d)} className="px-1 text-[11px] font-semibold text-primary hover:underline">
                    +{extra} more
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/** "November 2026" for the month of a YYYY-MM-DD date. */
function monthTitle(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Status as a dot on a block (the words are in the block's label and tooltip, and in the panel). */
const STATUS_DOT: Record<AppointmentItem["status"], string> = {
  booked: "bg-muted-foreground/50",
  confirmed: "bg-primary",
  checked_in: "bg-info",
  completed: "bg-success",
  cancelled: "bg-muted-foreground/30",
  no_show: "bg-warning",
};

const STATUS_TEXT: Record<AppointmentItem["status"], string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};
// The hour height lives in this browser's storage (a per-viewer convenience); the page works without it.
let hourHeightFallback: HourHeight = "normal";
const hourHeightListeners = new Set<() => void>();
function subscribeHourHeight(listener: () => void): () => void {
  hourHeightListeners.add(listener);
  return () => hourHeightListeners.delete(listener);
}
function readHourHeight(): HourHeight {
  try {
    const saved = window.localStorage.getItem(HOUR_HEIGHT_KEY);
    if (saved && saved in HOUR_HEIGHTS) return saved as HourHeight;
  } catch {
    // Storage unavailable (private window): keep the choice for this page only.
  }
  return hourHeightFallback;
}
function writeHourHeight(value: HourHeight): void {
  hourHeightFallback = value;
  try {
    window.localStorage.setItem(HOUR_HEIGHT_KEY, value);
  } catch {
    // Not remembered; the choice still applies now.
  }
  for (const listener of hourHeightListeners) listener();
}

/** The day as lists, by practitioner or by room; picking a row opens it in the panel. */
function DayLists({
  items,
  byRoom,
  rooms,
  practitioners,
  visitTypes,
  selectedId,
  onSelect,
}: {
  items: AppointmentItem[];
  byRoom: boolean;
  rooms: ClinicRoom[];
  practitioners: Map<string, Practitioner>;
  visitTypes: Map<string, VisitType>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const groups = byRoom
    ? groupByRoom(items, rooms).map((g) => ({ key: g.roomId ?? "none", title: g.name, items: g.items }))
    : groupByPractitioner(items, practitioners).map((g) => ({ key: g.practitionerId, title: g.practitioner?.displayName ?? "Practitioner", items: g.items }));
  if (groups.length === 0) {
    return (
      <Card className="p-6 text-body text-muted-foreground">
        {byRoom && rooms.length === 0 ? "No rooms set up at this facility." : "No appointments on this day."}
      </Card>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <Card key={g.key} className="gap-0 py-0">
          <header className="flex items-center border-b px-4 py-3">
            <h3 className="font-semibold">{g.title}</h3>
            <span className="ml-auto text-meta text-muted-foreground">
              {g.items.length === 0 ? "nothing booked" : `${g.items.filter((a) => a.status !== "cancelled").length} scheduled`}
            </span>
          </header>
          <ul className="divide-y px-3">
            {g.items.length === 0 ? <li className="py-2 text-meta text-muted-foreground">Free all day.</li> : null}
            {g.items.map((a) => (
              <li key={a.id} className={a.id === selectedId ? "-mx-3 bg-primary-subtle/60 px-3" : undefined}>
                <AppointmentCard
                  appointment={toAppointment(a, practitioners, visitTypes)}
                  action={
                    <Button variant="ghost" size="xs" aria-pressed={a.id === selectedId} onClick={() => onSelect(a.id)}>
                      View
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}

const BOOKING_CHANNEL: Record<string, string> = {
  front_desk: "At the front desk",
  phone: "By phone",
  online: "Online",
  follow_up: "As a follow-up from a consultation",
};

/** The selected appointment: who, when, why, the patient's number and last visits, and what the desk can do next. */
function AppointmentPanel({
  appointment: a,
  practitioners,
  practitionerName,
  visitType,
  mapped,
  actions,
  canOpenRecord,
  facilityId,
  timeZone,
  pending,
  run,
}: {
  appointment: AppointmentItem;
  practitioners: Practitioner[];
  practitionerName: string;
  visitType: VisitType | undefined;
  mapped: ReturnType<typeof toAppointment>;
  actions: AppointmentAction[];
  canOpenRecord: boolean;
  facilityId: string;
  timeZone: string;
  pending: boolean;
  run: Run;
}) {
  const [mode, setMode] = React.useState<"idle" | "details" | "reschedule" | "cancel">("idle");
  const [reason, setReason] = React.useState("");
  const [context, setContext] = React.useState<AppointmentPatientContext | null>(null);
  const [contextState, setContextState] = React.useState<"loading" | "ready" | "unavailable">(canOpenRecord ? "loading" : "unavailable");

  // The patient's number and last visits (audited reads), only for staff who may open the record.
  React.useEffect(() => {
    if (!canOpenRecord) return;
    let live = true;
    void appointmentPatientContext({ patientId: a.patientId, before: a.startsAt }).then((result) => {
      if (!live) return;
      if (result.ok) {
        setContext(result.data);
        setContextState("ready");
      } else setContextState("unavailable");
    });
    return () => {
      live = false;
    };
  }, [a.patientId, a.startsAt, canOpenRecord]);

  const who = a.patient?.displayName ?? "Patient";
  const name = a.patient ? displayOrder(a.patient.displayName) : "Patient";
  const minutes = Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000);
  const online = visitType?.modality === "telemedicine";
  const act = (action: AppointmentAction) => {
    if (action === "confirm") run(() => confirmAppointment({ appointmentId: a.id, version: a.version }), `Confirmed ${who}`);
    if (action === "no_show") run(() => markNoShow({ appointmentId: a.id, version: a.version }), `Marked ${who} as no-show`);
    if (action === "check_in")
      run(
        () => checkInAppointment({ appointmentId: a.id }),
        (visit) => `Checked in ${who} — ticket ${(visit as { ticket: string }).ticket}`,
      );
  };
  const primary: AppointmentAction | null = actions.includes("check_in") ? "check_in" : actions.includes("confirm") ? "confirm" : null;

  return (
    <Card className="gap-0 py-0">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="font-semibold">Appointment</h2>
        <span className="ml-auto">
          <AppointmentStatusBadge status={mapped.status} />
        </span>
      </header>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar initials={initialsOf(who)} size="lg" />
          <div className="min-w-0">
            <p className="text-section leading-tight font-semibold break-words">{name}</p>
            {a.patient ? (
              <p className="text-meta text-muted-foreground">
                {a.patient.patientNumber} · {a.patient.sex === "female" ? "F" : a.patient.sex === "male" ? "M" : a.patient.sex} · {a.patient.age} yrs
              </p>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-body">
          <dt className="text-muted-foreground">When</dt>
          <dd>
            {shortDate(a.startsAt, timeZone)} · {clinicalTime(a.startsAt)} – {clinicalTime(a.endsAt)}
          </dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>
            {visitType?.name ?? "Visit"} · {online ? "Online" : "In person"}
          </dd>
          <dt className="text-muted-foreground">With</dt>
          <dd>{practitionerName}</dd>
          {a.room ? (
            <>
              <dt className="text-muted-foreground">Room</dt>
              <dd>{a.room.name}</dd>
            </>
          ) : null}
          {canOpenRecord ? (
            <>
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="tabular">{contextState === "loading" ? "…" : (context?.contact ?? "No number on file")}</dd>
            </>
          ) : null}
        </dl>

        {a.status === "cancelled" ? <CancellationNote appointment={a} /> : null}

        <div className="rounded-lg border bg-muted/40 px-3 py-2">
          <p className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">Reason</p>
          <p className="text-body break-words">{a.reason?.trim() ? a.reason : "None given"}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {primary ? (
            <Button className="col-span-2" size="lg" disabled={pending} onClick={() => act(primary)}>
              {primary === "check_in" ? "Check in" : "Confirm"}
            </Button>
          ) : null}
          {canOpenRecord ? (
            <Button asChild variant="outline">
              <Link href={`/patients/${a.patientId}`}>Open record</Link>
            </Button>
          ) : null}
          {actions.includes("reschedule") ? (
            <Button variant="outline" aria-expanded={mode === "reschedule"} onClick={() => setMode(mode === "reschedule" ? "idle" : "reschedule")}>
              Reschedule
            </Button>
          ) : null}
          <Button variant="outline" aria-expanded={mode === "details"} onClick={() => setMode(mode === "details" ? "idle" : "details")}>
            {mode === "details" ? "Hide details" : "View details"}
          </Button>
          {actions.includes("cancel") ? (
            <Button
              variant="outline"
              className="text-danger hover:text-danger"
              aria-expanded={mode === "cancel"}
              onClick={() => {
                setReason("");
                setMode(mode === "cancel" ? "idle" : "cancel");
              }}
            >
              <CalendarXIcon /> Cancel
            </Button>
          ) : null}
          {actions.includes("no_show") ? (
            <Button variant="ghost" className="col-span-2" disabled={pending} onClick={() => act("no_show")}>
              <UserXIcon /> Mark as no-show
            </Button>
          ) : null}
        </div>

        {mode === "details" ? (
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 rounded-lg border p-3 text-body">
            <dt className="text-muted-foreground">Date</dt>
            <dd>{clinicalDate(a.startsAt)}</dd>
            <dt className="text-muted-foreground">Length</dt>
            <dd>{durationText(minutes)}</dd>
            <dt className="text-muted-foreground">Room</dt>
            <dd>{a.room?.name ?? "Not assigned"}</dd>
            <dt className="text-muted-foreground">Booked</dt>
            <dd>{a.bookedByPatient ? "Online by the patient (MyHealth)" : (BOOKING_CHANNEL[a.bookingChannel] ?? a.bookingChannel.replaceAll("_", " "))}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{STATUS_TEXT[a.status]}</dd>
          </dl>
        ) : null}

        {mode === "reschedule" ? (
          <RescheduleForm
            appointment={a}
            facilityId={facilityId}
            timeZone={timeZone}
            practitioners={practitioners}
            pending={pending}
            run={(call, success) => run(call, success, () => setMode("idle"))}
            onClose={() => setMode("idle")}
          />
        ) : null}

        {mode === "cancel" ? (
          <form
            className="flex flex-col gap-2 rounded-lg border border-warning/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => cancelAppointment({ appointmentId: a.id, version: a.version, reason: reason.trim() }),
                `Cancelled ${who}`,
                () => setMode("idle"),
              );
            }}
          >
            <Label htmlFor={`cancel-${a.id}`}>Reason for cancelling *</Label>
            <Input
              id={`cancel-${a.id}`}
              autoFocus
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Patient called to cancel"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={pending || reason.trim().length < 3}>
                Cancel appointment
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")}>
                Keep
              </Button>
            </div>
          </form>
        ) : null}

        {canOpenRecord ? (
          <section aria-labelledby={`previous-${a.id}`} className="flex flex-col gap-2">
            <h3 id={`previous-${a.id}`} className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
              Previous visits
            </h3>
            {contextState === "loading" ? <p className="text-meta text-muted-foreground">Loading…</p> : null}
            {contextState === "unavailable" ? <p className="text-meta text-muted-foreground">Open the record to see past visits.</p> : null}
            {contextState === "ready" && context?.previousVisits.length === 0 ? (
              <p className="text-meta text-muted-foreground">No earlier visits recorded.</p>
            ) : null}
            {context?.previousVisits.map((v) => (
              <Link
                key={v.id}
                href={`/patients/${a.patientId}`}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-body hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate">{v.title}</span>
                  {v.detail ? <span className="block truncate text-meta text-muted-foreground">{v.detail}</span> : null}
                </span>
                <span className="shrink-0 text-meta text-muted-foreground">{clinicalDate(v.occurredAt)}</span>
              </Link>
            ))}
            {context?.clinicalHidden ? (
              <p className="text-meta text-muted-foreground">Consultation notes and lab requests are not shown for your role.</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Who cancelled the appointment, when and why: the patient in MyHealth (no staff user, the patient's own change) or the
 * named staff member. The system's own wording for a MyHealth cancellation is not repeated as a reason.
 */
function CancellationNote({ appointment: a }: { appointment: AppointmentItem }) {
  const byPatient = !a.cancelledBy && a.updatedByPatient === true;
  const who = byPatient ? "the patient in MyHealth" : (a.cancelledByName ?? (a.cancelledBy ? "a staff member" : "the clinic"));
  const reason = a.cancellationReason?.trim();
  const showReason = reason && !(byPatient && /^cancelled by the patient/i.test(reason));
  return (
    <div role="note" className="flex gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-warning-foreground">
      <CalendarXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-body">
        <p>
          Cancelled by <span className="font-semibold">{who}</span>
          {a.cancelledAt ? <span className="text-meta"> · {clinicalDateTime(a.cancelledAt)}</span> : null}
        </p>
        {showReason ? <p className="text-meta break-words">“{reason}”</p> : null}
      </div>
    </div>
  );
}

function Avatar({ initials, size = "md" }: { initials: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary-subtle font-semibold text-primary ${size === "lg" ? "size-11 text-body" : "size-8 text-meta"}`}
    >
      {initials}
    </span>
  );
}

/** "SANTOS, Maria Reyes" → "Maria Reyes Santos" for the panel heading. */
function displayOrder(displayName: string): string {
  const [family, given] = displayName.split(",").map((s) => s.trim());
  if (!given || !family) return displayName;
  const familyName = family.charAt(0) + family.slice(1).toLowerCase();
  return `${given} ${familyName.replace(/(^|[\s-])(\w)/g, (_, p: string, c: string) => p + c.toUpperCase())}`;
}

/** "Sat, 5 Dec 2026" for a YYYY-MM-DD date. */
function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** "Sat 5 Dec" for an instant in the facility's zone. */
function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(iso)).replace(",", "");
}
