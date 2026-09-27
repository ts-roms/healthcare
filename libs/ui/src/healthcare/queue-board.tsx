"use client";

import * as React from "react";
import { differenceInMinutes, parseISO } from "date-fns";
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

export function QueueBoard({
  entries,
  now = new Date(),
  onSelect,
  hideDone = false,
  statuses,
  className,
}: {
  entries: QueueEntry[];
  now?: Date;
  onSelect?: (entry: QueueEntry) => void;
  hideDone?: boolean;
  /** Columns to show, in board order. Defaults to all. */
  statuses?: QueueStatus[];
  className?: string;
}) {
  const shown = statuses ? COLUMNS.filter((c) => statuses.includes(c.status)) : COLUMNS;
  const cols = hideDone ? shown.filter((c) => c.status !== "done") : shown;
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
