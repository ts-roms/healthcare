"use client";

import * as React from "react";
import Link from "next/link";
import { CircleCheckIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { cn } from "@healthcare/ui/lib/utils";
import { ATTENTION_TAG, type AttentionGroup, type AttentionRow, type AttentionTone } from "@/lib/dashboard-today";

const FILTERS: { value: "all" | AttentionGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "patients", label: "Patients" },
  { value: "lab", label: "Lab" },
  { value: "setup", label: "Setup" },
];

const TAG_CLASS: Record<AttentionTone, string> = {
  urgent: "bg-danger-subtle text-danger-foreground",
  soon: "bg-warning-subtle text-warning-foreground",
  info: "bg-info-subtle text-info-foreground",
  setup: "bg-muted text-muted-foreground",
};

/**
 * What needs someone now: the day's urgent and soon things for patients and the laboratory, and what is not set up yet,
 * each with a button to where it is dealt with. The chips narrow the list to one group. The tag says how pressing a row
 * is in words as well as colour.
 */
export function NeedsAttention({ rows }: { rows: AttentionRow[] }) {
  const [filter, setFilter] = React.useState<"all" | AttentionGroup>("all");
  const shown = filter === "all" ? rows : rows.filter((r) => r.group === filter);
  return (
    <section aria-label="Needs attention" className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-section-lg font-semibold">Needs attention</h2>
        {rows.length > 0 ? (
          <span className="tabular rounded-full bg-danger-subtle px-2 text-table font-semibold text-danger-foreground" aria-label={`${rows.length} items`}>
            {rows.length}
          </span>
        ) : null}
        <div role="group" aria-label="Show" className="ml-auto flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full px-3.5 py-1 text-table font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                filter === f.value ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-muted/60 px-4 py-6 text-body text-muted-foreground">
          <CircleCheckIcon className="size-5 text-success-foreground" aria-hidden />
          {rows.length === 0 ? "Nothing needs attention right now." : "Nothing here right now."}
        </p>
      ) : (
        <ul className="mt-3 divide-y border-t">
          {shown.map((row) => (
            <li key={row.id} className="flex items-center gap-4 py-3.5">
              <span className={cn("w-20 shrink-0 rounded-md py-1 text-center text-meta font-semibold tracking-wide uppercase", TAG_CLASS[row.tone])}>
                {ATTENTION_TAG[row.tone]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold">{row.title}</span>
                {row.detail ? <span className="block text-table text-muted-foreground">{row.detail}</span> : null}
              </span>
              {row.action ? (
                <Button asChild variant="secondary" size="sm" className="shrink-0">
                  <Link href={row.action.href}>{row.action.label}</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
