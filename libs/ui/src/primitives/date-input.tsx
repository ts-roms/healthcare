"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "../lib/utils";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(value: string | undefined): Date | undefined {
  if (!value || !ISO.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Sets an input's value the way a user would, so React's onChange (and react-hook-form) see a real change event. */
function commit(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export type DateInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "min" | "max"> & {
  /** Earliest / latest day the calendar offers, as `YYYY-MM-DD`. */
  min?: string;
  max?: string;
};

/**
 * A date field: type `YYYY-MM-DD` or pick from a calendar. It is a real text input, so `name`, `value`/`defaultValue`,
 * `onChange`, `required` and react-hook-form's `register` work as on any input; the value is always `YYYY-MM-DD`.
 */
function DateInput({ className, min, max, disabled, ref, ...props }: DateInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Date | undefined>();
  const minDate = parseIso(min);
  const maxDate = parseIso(max);
  const thisYear = new Date().getFullYear();

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const choose = (date: Date | undefined) => {
    if (!inputRef.current) return;
    commit(inputRef.current, date ? toIso(date) : "");
    setOpen(false);
    inputRef.current.focus();
  };

  return (
    <div className={cn("relative inline-flex h-8 w-full", className)} data-slot="date-input">
      <Input
        ref={setRefs}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        pattern="\d{4}-\d{2}-\d{2}"
        title="Date as YYYY-MM-DD"
        maxLength={10}
        disabled={disabled}
        className="h-full pr-9"
        {...props}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setSelected(parseIso(inputRef.current?.value));
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Choose date"
            className="absolute top-1/2 right-1 size-6 -translate-y-1/2 text-muted-foreground hover:text-primary"
          >
            <CalendarIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? (maxDate && maxDate < new Date() ? maxDate : minDate && minDate > new Date() ? minDate : undefined)}
            onSelect={choose}
            captionLayout="dropdown"
            startMonth={minDate ?? new Date(1900, 0)}
            endMonth={maxDate ?? new Date(thisYear + 20, 11)}
            disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
            autoFocus
          />
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <Button type="button" variant="ghost" size="xs" onClick={() => choose(undefined)}>
              Clear
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={(!!minDate && minDate > new Date()) || (!!maxDate && maxDate < new Date())}
              onClick={() => choose(new Date())}
            >
              Today
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export { DateInput };
