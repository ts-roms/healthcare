"use client";

import * as React from "react";
import { DateInput } from "./date-input";
import { Input } from "./input";
import { cn } from "../lib/utils";

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function split(value: string): { date: string; time: string } {
  const m = DATE_TIME.exec(value);
  return { date: m?.[1] ?? "", time: m?.[2] ?? "" };
}

export interface DateTimeInputProps {
  /** `YYYY-MM-DDTHH:mm` (local time, as `datetime-local` used), or "" when not set. */
  value: string;
  onValueChange: (value: string) => void;
  /** Earliest local date-time; its date limits the calendar. */
  min?: string;
  max?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A date (calendar picker) and a time (24-hour) that together make one `YYYY-MM-DDTHH:mm` value; empty until both are given. */
function DateTimeInput({ value, onValueChange, min, max, id, required, disabled, className, "aria-label": ariaLabel }: DateTimeInputProps) {
  const [parts, setParts] = React.useState(() => split(value));

  // Follow the parent when it changes the value (reset, prefill); keep half-entered parts while it still says "".
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    const combined = parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
    if (combined !== value && !(value === "" && (parts.date || parts.time))) setParts(split(value));
  }

  const update = (next: { date: string; time: string }) => {
    setParts(next);
    onValueChange(next.date && next.time ? `${next.date}T${next.time}` : "");
  };

  return (
    <div className={cn("flex gap-2", className)} data-slot="date-time-input">
      <DateInput
        id={id}
        aria-label={ariaLabel ? `${ariaLabel}: date` : undefined}
        required={required}
        disabled={disabled}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        value={parts.date}
        onChange={(e) => update({ ...parts, date: e.target.value })}
      />
      <Input
        type="time"
        aria-label={ariaLabel ? `${ariaLabel}: time` : "Time"}
        required={required}
        disabled={disabled}
        className="w-28 shrink-0 [&::-webkit-calendar-picker-indicator]:opacity-60"
        value={parts.time}
        onChange={(e) => update({ ...parts, time: e.target.value })}
      />
    </div>
  );
}

export { DateTimeInput };
