import * as React from "react";
import { AlertOctagonIcon, AlertTriangleIcon, BanIcon, ChevronRightIcon, type LucideIcon } from "lucide-react";
import { Badge } from "../primitives/badge";
import { cn } from "../lib/utils";
import { type StatusSpec, StatusBadge } from "./status";

/** One entry of a patient's record timeline, already labelled for display (times in the facility's time zone). */
export interface RecordTimelineItem {
  id: string;
  icon: LucideIcon;
  /** What kind of record this is ("Encounter", "Laboratory"), read out before the title's details. */
  kindLabel: string;
  title: string;
  detail?: string | null;
  /** Machine-readable instant for <time>. */
  dateTime: string;
  /** Display time ("09:42"). */
  time: string;
  facility?: string | null;
  status?: StatusSpec | null;
  /** Laboratory flag: shown with icon and text. */
  flag?: "abnormal" | "critical" | null;
  /** Not valid care (entered in error, cancelled, void): the entry is shown struck through with this label. */
  marker?: string | null;
  href?: string | null;
}

export interface RecordTimelineDay {
  key: string;
  label: string;
  items: RecordTimelineItem[];
}

/**
 * A patient's record over time, grouped by day, newest first — every service line in one stream, each entry
 * opening its source record. Status is never colour alone (icon + text); records not valid as care are marked.
 * Links use `linkComponent` (e.g. Next's Link) or a plain anchor.
 */
export function RecordTimeline({
  days,
  linkComponent: LinkComponent = "a",
  className,
}: {
  days: RecordTimelineDay[];
  linkComponent?: React.ElementType;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3 className="sticky top-0 z-[2] bg-background/95 py-1 text-meta font-semibold tracking-wide text-muted-foreground uppercase">{day.label}</h3>
          <ol className="flex flex-col">
            {day.items.map((item, i) => (
              <RecordTimelineRow key={item.id} item={item} last={i === day.items.length - 1} LinkComponent={LinkComponent} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function RecordTimelineRow({ item, last, LinkComponent }: { item: RecordTimelineItem; last: boolean; LinkComponent: React.ElementType }) {
  const Icon = item.icon;
  const body = (
    <>
      <span className={cn("z-[1] flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", item.marker && "opacity-60")}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <time dateTime={item.dateTime} className="tabular text-meta text-muted-foreground">
            {item.time}
          </time>
          <span className={cn("text-body font-medium", item.marker && "text-muted-foreground line-through")}>{item.title}</span>
          {item.marker ? (
            <Badge variant="neutral">
              <BanIcon aria-hidden /> {item.marker}
            </Badge>
          ) : null}
          {item.flag === "critical" ? (
            <Badge variant="critical">
              <AlertOctagonIcon aria-hidden /> Critical
            </Badge>
          ) : item.flag === "abnormal" ? (
            <Badge variant="warning">
              <AlertTriangleIcon aria-hidden /> Abnormal
            </Badge>
          ) : null}
          {item.status && !item.marker ? <StatusBadge spec={item.status} /> : null}
        </div>
        <p className="text-table text-muted-foreground">
          <span className="sr-only">{item.kindLabel}. </span>
          {[item.detail, item.facility].filter(Boolean).join(" · ")}
        </p>
      </div>
      {item.href ? <ChevronRightIcon className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
    </>
  );
  return (
    <li className="relative">
      {!last ? <span className="absolute top-8 bottom-0 left-[13px] w-px bg-border" aria-hidden /> : null}
      {item.href ? (
        <LinkComponent
          href={item.href}
          className="flex gap-3 rounded-md py-1.5 pr-2 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {body}
        </LinkComponent>
      ) : (
        <div className="flex gap-3 py-1.5 pr-2">{body}</div>
      )}
    </li>
  );
}
