import * as React from "react";
import { cn } from "../lib/utils";
import { Label } from "./label";

/**
 * One group of related fields: its title and one-line description on the left (above on a phone), the fields on the
 * right. Stack several in a card or a `<form>`; they separate themselves with a rule.
 */
function FormSection({
  title,
  description,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & { title: React.ReactNode; description?: React.ReactNode }) {
  const id = React.useId();
  return (
    <section
      data-slot="form-section"
      aria-labelledby={id}
      className={cn("grid gap-3 border-b py-5 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-6", className)}
      {...props}
    >
      <div>
        <h3 id={id} className="text-body font-semibold">
          {title}
        </h3>
        {description ? <p className="mt-1 text-table text-muted-foreground">{description}</p> : null}
      </div>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  );
}

/**
 * One setting: what it does on the left, its control (`Switch`, `NativeSelect`, `Input`) on the right. With `htmlFor` the
 * title is the control's label; otherwise label the control yourself (`aria-label` / `aria-labelledby`).
 */
function SettingRow({
  title,
  description,
  htmlFor,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="setting-row" className={cn("flex items-center justify-between gap-5 border-b py-3.5 first:pt-0 last:border-b-0 last:pb-0", className)}>
      <div className="min-w-0">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-body font-semibold">
            {title}
          </Label>
        ) : (
          <p className="text-body font-semibold">{title}</p>
        )}
        {description ? <p className="mt-0.5 text-table text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * The sticky bar at the bottom of a settings form: a short message (unsaved changes, last saved) and the actions
 * (`Cancel`, `Save`). Keeps the phone's safe area clear.
 */
function SaveBar({ message, className, children }: { message?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div
      data-slot="save-bar"
      role="region"
      aria-label="Save changes"
      className={cn(
        "sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 shadow-lg",
        className,
      )}
    >
      <p className="min-w-0 text-table text-muted-foreground">{message}</p>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export { FormSection, SettingRow, SaveBar };
