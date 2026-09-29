"use client";

import { ChevronLeftIcon, ChevronRightIcon, LoaderIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@healthcare/ui/lib/utils";
import { dayChip, dayPages, type Slot, slotsByPartOfDay, slotTime } from "@/lib/booking";

const chip = "rounded-xl border bg-card transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none";
const chosen = "border-primary bg-primary-subtle text-primary";

/** Bookable days a week at a time, with earlier and later weeks up to the clinic's booking horizon. */
export function DayPicker({ days, value, onChange }: { days: string[]; value: string; onChange: (day: string) => void }) {
  const pages = dayPages(days);
  const [page, setPage] = React.useState(() =>
    Math.max(
      0,
      pages.findIndex((p) => p.includes(value)),
    ),
  );
  const shown = pages[page] ?? [];
  const turn = (to: number) => {
    setPage(to);
    const first = pages[to]?.[0];
    if (first) onChange(first);
  };
  const nav = "flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={nav} onClick={() => turn(page - 1)} disabled={page === 0} aria-label="Earlier days">
        <ChevronLeftIcon className="size-5" aria-hidden />
      </button>
      <div role="group" aria-label="Day" className="grid min-w-0 flex-1 grid-cols-7 gap-1">
        {shown.map((day) => {
          const { weekday, day: n, month } = dayChip(day);
          const selected = day === value;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(day)}
              className={cn(chip, "flex min-w-0 flex-col items-center px-0.5 py-2", selected && chosen)}
            >
              <span className="text-meta">{weekday}</span>
              <span className="text-lg leading-tight font-semibold">{n}</span>
              <span className="text-meta text-muted-foreground">{month}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className={nav} onClick={() => turn(page + 1)} disabled={page >= pages.length - 1} aria-label="Later days">
        <ChevronRightIcon className="size-5" aria-hidden />
      </button>
    </div>
  );
}

/** Open times of one day, grouped into morning and afternoon; shows the doctor when several are on duty. */
export function SlotPicker({
  slots,
  timeZone,
  loading,
  value,
  onChange,
  showPractitioner,
}: {
  slots: Slot[] | null;
  timeZone: string;
  loading: boolean;
  value: Slot | null;
  onChange: (slot: Slot) => void;
  showPractitioner: boolean;
}) {
  if (loading || slots === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-body text-muted-foreground">
        <LoaderIcon className="size-4 animate-spin" aria-hidden /> Finding open times…
      </p>
    );
  }
  if (slots.length === 0)
    return <p className="rounded-xl border border-dashed p-4 text-body text-muted-foreground">No open times on this day. Try another day.</p>;
  return (
    <div className="flex flex-col gap-3">
      {slotsByPartOfDay(slots, timeZone).map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex flex-col gap-2">
          <p className="text-meta font-medium text-muted-foreground">{group.label}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {group.slots.map((slot) => {
              const selected = value?.startsAt === slot.startsAt && value.practitionerId === slot.practitionerId;
              return (
                <button
                  key={`${slot.startsAt}:${slot.practitionerId}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange(slot)}
                  className={cn(chip, "flex flex-col items-center px-2 py-2", selected && chosen)}
                >
                  <span className="font-semibold tabular-nums">{slotTime(slot.startsAt, timeZone)}</span>
                  {showPractitioner ? <span className="w-full truncate text-meta text-muted-foreground">{slot.practitionerName}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
