"use client";

import { useEffect, useState } from "react";
import { Button, type ButtonProps, Input, Label, NativeSelect } from "@healthcare/ui/primitives";
import { MONTHS } from "@/lib/birth-date";

/** A button big enough for a thumb, a shaky hand or a walking frame's grip: at least 4rem tall. */
export function BigButton({ className = "", ...props }: ButtonProps) {
  return <Button size="lg" className={`min-h-16 px-8 text-2xl ${className}`} {...props} />;
}

/** A label above its input, with a message that screen readers read out when it appears. */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xl font-medium">
        {label}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-base text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-lg font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A tall drop-down: the design system's select sizes its inner element, so the size is set through the wrapper. */
export const BigSelect = ({ className = "", ...props }: React.ComponentProps<typeof NativeSelect>) => (
  <NativeSelect
    className={`w-full [&_select]:h-16 [&_select]:rounded-xl [&_select]:pr-12 [&_select]:pl-4 [&_select]:text-2xl [&_svg]:right-4 [&_svg]:size-6 ${className}`}
    {...props}
  />
);

/** A tall text box. Browsers are told not to remember what is typed here. */
export const BigInput = (props: React.ComponentProps<typeof Input>) => (
  <Input autoComplete="off" autoCorrect="off" spellCheck={false} className="h-16 text-2xl" {...props} />
);

export interface DateFieldProps {
  idPrefix: string;
  label: string;
  value: { day: string; month: string; year: string };
  onChange: (value: { day: string; month: string; year: string }) => void;
  error?: string;
}

/** Day, month and year as three plain fields. Nothing here is a date picker: they are slow and easy to get wrong. */
export function DateField({ idPrefix, label, value, onChange, error }: DateFieldProps) {
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={error ? `${idPrefix}-error` : undefined}>
      <legend className="mb-1.5 text-xl font-medium">{label}</legend>
      <div className="grid grid-cols-[6rem_1fr_8rem] gap-3">
        <BigInput
          id={`${idPrefix}-day`}
          aria-label="Day"
          placeholder="Day"
          inputMode="numeric"
          maxLength={2}
          value={value.day}
          onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, "") })}
          aria-invalid={Boolean(error)}
        />
        <BigSelect
          id={`${idPrefix}-month`}
          aria-label="Month"
          placeholder="Month"
          value={value.month}
          onChange={(e) => onChange({ ...value, month: e.target.value })}
          aria-invalid={Boolean(error)}
        >
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1)}>
              {name}
            </option>
          ))}
        </BigSelect>
        <BigInput
          id={`${idPrefix}-year`}
          aria-label="Year"
          placeholder="Year"
          inputMode="numeric"
          maxLength={4}
          value={value.year}
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, "") })}
          aria-invalid={Boolean(error)}
        />
      </div>
      {error && (
        <p id={`${idPrefix}-error`} role="alert" className="text-lg font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Counts down to zero from `seconds` and then calls `onDone` once. Used by the screens that clear themselves. */
export function useCountdown(seconds: number, onDone: () => void): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, onDone]);
  return left;
}

/** One new key per tap target, reused when the same thing is tapped again, so a retry never makes a second ticket. */
export function newKey(): string {
  return crypto.randomUUID();
}
