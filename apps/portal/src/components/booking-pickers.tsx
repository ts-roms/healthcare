"use client";

import { LoaderIcon } from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";
import { dayChip, type Slot, slotsByPartOfDay, slotTime } from "@/lib/booking";

const chip = "rounded-xl border bg-card transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none";
const chosen = "border-primary bg-primary-subtle text-primary";

/** Horizontal list of bookable days. */
export function DayPicker({ days, value, onChange }: { days: string[]; value: string; onChange: (day: string) => void }) {
  return (
    <div role="group" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {days.map((day) => {
        const { weekday, day: n, month } = dayChip(day);
        const selected = day === value;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(day)}
            className={cn(chip, "flex min-w-16 shrink-0 flex-col items-center px-3 py-2", selected && chosen)}
          >
            <span className="text-meta">{weekday}</span>
            <span className="text-lg leading-tight font-semibold">{n}</span>
            <span className="text-meta text-muted-foreground">{month}</span>
          </button>
        );
      })}
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
