"use client";

import * as React from "react";
import { differenceInMinutes, parseISO } from "date-fns";
import { TriangleAlertIcon } from "lucide-react";
import type { QueueEntry, QueueStatus } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { cn } from "../lib/utils";

const COLUMNS: { status: QueueStatus; label: string }[] = [
  { status: "waiting", label: "Waiting" },
  { status: "vitals", label: "Triage / Vitals" },
  { status: "ready", label: "Ready for provider" },
  { status: "with-provider", label: "With provider" },
  { status: "for-billing", label: "For billing" },
  { status: "done", label: "Done" },
];

/** The wait timer runs only while the patient is still waiting for the provider. */
const WAITING_COLUMNS: QueueStatus[] = ["waiting", "vitals", "ready"];

const PRIORITY_LABEL = { senior: "Senior", pwd: "PWD", pregnant: "Pregnant", urgent: "Urgent", emergency: "Emergency" } as const;
const PRIORITY_VARIANT = { senior: "info", pwd: "info", pregnant: "info", urgent: "danger", emergency: "critical" } as const;

/** Minutes from which a wait is shown as "a while" (amber) and "long" (red) on the comfortable board. */
export interface WaitThresholds {
  warn: number;
  long: number;
}
const DEFAULT_WAIT_THRESHOLDS: WaitThresholds = { warn: 15, long: 30 };

/** How long a ticket has waited: colour, a warning icon when long, and always the number of minutes (never colour alone). */
export function WaitPill({ minutes, thresholds = DEFAULT_WAIT_THRESHOLDS, className }: { minutes: number; thresholds?: WaitThresholds; className?: string }) {
  const tone = minutes >= thresholds.long ? "danger" : minutes >= thresholds.warn ? "warning" : "success";
  return (
    <Badge variant={tone} className={cn("tabular", className)} title={`Waiting ${minutes} minutes`}>
      {tone === "danger" ? <TriangleAlertIcon aria-hidden /> : null}
      {minutes} min
    </Badge>
  );
}

export function QueueBoard({
  entries,
  now = new Date(),
  onSelect,
  hideDone = false,
  statuses,
  className,
  layout = "compact",
  selectedId,
  waitThresholds = DEFAULT_WAIT_THRESHOLDS,
}: {
  entries: QueueEntry[];
  now?: Date;
  onSelect?: (entry: QueueEntry) => void;
  hideDone?: boolean;
  /** Columns to show, in board order. Defaults to all. */
  statuses?: QueueStatus[];
  className?: string;
  /**
   * `compact` (default, the dashboard's panel): small cards, every column the same. `comfortable` (the queue screen): fills the
   * height it is given, columns scroll on their own, larger cards with the wait and tags, and "Done" folded into a count.
   */
  layout?: "compact" | "comfortable";
  /** The ticket open in the screen's side panel, outlined on the board. */
  selectedId?: string | null;
  waitThresholds?: WaitThresholds;
}) {
  const shown = statuses ? COLUMNS.filter((c) => statuses.includes(c.status)) : COLUMNS;
  const cols = hideDone ? shown.filter((c) => c.status !== "done") : shown;
  if (layout === "comfortable") {
    return (
      <ComfortableBoard
        cols={cols}
        entries={entries}
        now={now}
        onSelect={onSelect}
        selectedId={selectedId ?? null}
        thresholds={waitThresholds}
        className={className}
      />
    );
  }
  return (
    <div className={cn("grid gap-2", className)} style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(12rem, 1fr))` }}>
      {cols.map((col) => {
        const items = entries.filter((e) => e.status === col.status);
        return (
          <section key={col.status} className="flex min-w-0 flex-col rounded-lg border bg-muted/50" aria-label={col.label}>
            <header className="flex items-center justify-between border-b px-2.5 py-1.5">
              <h3 className="text-table font-semibold">{col.label}</h3>
              <span className="tabular text-meta text-muted-foreground">{items.length}</span>
            </header>
            <ol className="flex flex-col gap-1.5 p-1.5">
              {items.map((e) => {
                const wait = differenceInMinutes(now, parseISO(e.arrivedAt));
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(e)}
                      className="flex w-full flex-col gap-0.5 rounded-md border bg-card px-2 py-1.5 text-left outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-table font-bold">{e.ticket}</span>
                        {e.priority ? <Badge variant={PRIORITY_VARIANT[e.priority]}>{PRIORITY_LABEL[e.priority]}</Badge> : null}
                        {WAITING_COLUMNS.includes(col.status) ? (
                          <span className={cn("tabular ml-auto text-meta", wait > 45 ? "font-semibold text-warning-foreground" : "text-muted-foreground")}>
                            {wait > 45 ? "⚠ " : ""}
                            {wait}m
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-body font-medium">{e.patientName}</span>
                      <span className="truncate text-meta text-muted-foreground">{e.station}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function ComfortableBoard({
  cols,
  entries,
  now,
  onSelect,
  selectedId,
  thresholds,
  className,
}: {
  cols: { status: QueueStatus; label: string }[];
  entries: QueueEntry[];
  now: Date;
  onSelect?: (entry: QueueEntry) => void;
  selectedId: string | null;
  thresholds: WaitThresholds;
  className?: string;
}) {
  const working = cols.filter((c) => c.status !== "done");
  const hasDone = cols.some((c) => c.status === "done");
  return (
    <div
      className={cn("grid min-h-0 gap-3", className)}
      style={{ gridTemplateColumns: `repeat(${working.length}, minmax(10rem, 1fr))${hasDone ? " 8rem" : ""}` }}
    >
      {working.map((col) => {
        const items = entries.filter((e) => e.status === col.status);
        const timed = WAITING_COLUMNS.includes(col.status);
        return (
          <section key={col.status} className="flex min-h-0 min-w-0 flex-col rounded-xl border bg-muted/50" aria-label={col.label}>
            <header className="flex items-center justify-between px-3 py-2.5">
              <h3 className="text-body font-semibold">{col.label}</h3>
              <span className="tabular rounded-full bg-card px-2 text-table font-semibold text-muted-foreground">{items.length}</span>
            </header>
            <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {items.map((e) => {
                const wait = Math.max(0, differenceInMinutes(now, parseISO(e.arrivedAt)));
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(e)}
                      aria-pressed={selectedId === e.id}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                        selectedId === e.id && "border-primary ring-2 ring-primary/25",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-section font-bold">{e.ticket}</span>
                        {timed ? <WaitPill minutes={wait} thresholds={thresholds} className="ml-auto" /> : null}
                      </span>
                      <span className="line-clamp-2 text-section leading-snug font-semibold break-words">{e.patientName}</span>
                      <span className="truncate text-table text-muted-foreground">{e.detail ?? e.station}</span>
                      <span className="flex flex-wrap gap-1 pt-0.5">
                        {e.arrival ? <Badge variant="neutral">{e.arrival === "appointment" ? "Appointment" : "Walk-in"}</Badge> : null}
                        {e.priority ? (
                          <Badge variant={PRIORITY_VARIANT[e.priority]}>
                            {e.priority === "urgent" || e.priority === "emergency" ? PRIORITY_LABEL[e.priority] : `Priority · ${PRIORITY_LABEL[e.priority]}`}
                          </Badge>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {hasDone ? <DoneColumn entries={entries.filter((e) => e.status === "done")} onSelect={onSelect} selectedId={selectedId} /> : null}
    </div>
  );
}

/** Seen and closed tickets, folded into a count so the working columns keep the room; the list opens on request. */
function DoneColumn({ entries, onSelect, selectedId }: { entries: QueueEntry[]; onSelect?: (entry: QueueEntry) => void; selectedId: string | null }) {
  const [open, setOpen] = React.useState(false);
  const last = [...entries].sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt))[0];
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-xl border bg-muted/50 p-3" aria-label="Done">
      <h3 className="text-body font-semibold">Done</h3>
      <p className="tabular text-3xl font-semibold">{entries.length}</p>
      {last ? <p className="text-table text-muted-foreground">Last: {last.ticket}</p> : null}
      {entries.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 self-start rounded text-table text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {open ? "Hide list" : "View list"}
        </button>
      ) : null}
      {open ? (
        <ol className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect?.(e)}
                aria-pressed={selectedId === e.id}
                className={cn(
                  "flex w-full flex-col rounded-md border bg-card px-2 py-1 text-left text-table outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                  selectedId === e.id && "border-primary",
                )}
              >
                <span className="font-mono font-semibold">{e.ticket}</span>
                <span className="truncate text-muted-foreground">{e.patientName}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
