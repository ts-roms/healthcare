import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../primitives/avatar";
import { Badge } from "../primitives/badge";
import { CheckCircle2Icon, ClockIcon, MinusCircleIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "../lib/utils";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Shown Monday first; the index is the stored day of week (0 = Sunday). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * A practitioner as a compact card: photo (or initials), name and specialty, availability (icon + text, never colour
 * alone), the days of the week they are scheduled, today's hours, an optional note (licence) and actions.
 * `week` is seven booleans indexed by day of week (0 = Sunday) and `today` the index of today.
 */
export function PractitionerCard({
  name,
  specialty,
  hours,
  available,
  availableLabel = "Available",
  unavailableLabel = "Unavailable",
  photoUrl,
  week,
  today,
  note,
  actions,
  className,
}: {
  name: string;
  specialty?: string | null;
  hours?: string | null;
  available: boolean;
  availableLabel?: string;
  unavailableLabel?: string;
  photoUrl?: string | null;
  week?: readonly boolean[];
  today?: number;
  note?: { label: string; tone: "warning" | "danger" } | null;
  actions?: React.ReactNode;
  className?: string;
}) {
  const initials = name
    .replace(/^dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <article className={cn("flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-xs transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0", className)} aria-label={name}>
      <header className="flex items-start gap-3">
        <Avatar className="size-12 shrink-0 text-section">
          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
          <AvatarFallback className="bg-primary-subtle text-primary-deep">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-section font-semibold">{name}</h3>
          <p className="truncate text-table text-primary-deep">{specialty || "General practice"}</p>
        </div>
        <Badge variant={available ? "success" : "neutral"} className="shrink-0">
          {available ? <CheckCircle2Icon aria-hidden /> : <MinusCircleIcon aria-hidden />}
          {available ? availableLabel : unavailableLabel}
        </Badge>
      </header>
      {week ? (
        <ul className="flex items-center gap-1.5" aria-label="Scheduled days">
          {WEEK_ORDER.map((d) => {
            const on = week[d] === true;
            return (
              <li
                key={d}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-meta font-semibold",
                  on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  today === d && "ring-2 ring-primary/40 ring-offset-1 ring-offset-card",
                )}
              >
                <span aria-hidden>{DAY_NAMES[d]![0]}</span>
                <span className="sr-only">
                  {DAY_NAMES[d]}
                  {on ? ": scheduled" : ": not scheduled"}
                  {today === d ? " (today)" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {hours ? (
        <p className="flex items-start gap-1.5 text-table text-muted-foreground">
          <ClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{hours}</span>
        </p>
      ) : null}
      {note ? (
        <p className={cn("flex items-center gap-1.5 text-table font-medium", note.tone === "danger" ? "text-danger-foreground" : "text-warning-foreground")}>
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
          {note.label}
        </p>
      ) : null}
      {actions ? <footer className="mt-auto flex items-center gap-2 pt-1">{actions}</footer> : null}
    </article>
  );
}
