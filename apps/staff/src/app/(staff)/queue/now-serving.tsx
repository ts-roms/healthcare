"use client";

import { MegaphoneIcon } from "lucide-react";
import { clinicalTime } from "@healthcare/ui/healthcare";
import type { QueueVisit } from "@/lib/api/types";

/**
 * The tickets the desk is calling now, with where each was called to. Choosing one opens its panel, where it can be
 * called again or closed as a no-show. Waiting-room screens show the same calls without names.
 */
export function NowServing({ visits, selectedId, onSelect }: { visits: QueueVisit[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-label="Now serving" className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
      <h2 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        <MegaphoneIcon className="size-3.5" aria-hidden /> Now serving
      </h2>
      {visits.length === 0 ? (
        <p className="text-table text-muted-foreground">No one is being called.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {visits.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                aria-pressed={selectedId === v.id}
                className="flex items-baseline gap-2 rounded-lg border bg-background px-3 py-1.5 text-left text-table hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary-subtle"
              >
                <span className="font-mono text-body font-semibold text-primary">{v.ticket}</span>
                <span>
                  {v.calledTo}
                  <span className="text-muted-foreground"> · {v.patient?.displayName ?? "Patient"}</span>
                  {v.calledAt ? <span className="text-muted-foreground"> · {clinicalTime(v.calledAt)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
