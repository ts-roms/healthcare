"use client";

import * as React from "react";
import { Button } from "@healthcare/ui/primitives";
import type { PatientTimelineEntry, PatientTimelinePage } from "@/lib/api/types";
import { appendPage, type TimelineFilters } from "@/lib/timeline-mapping";
import { PatientTimelineView } from "@/components/patient-timeline-view";
import { loadMoreTimeline } from "./timeline-actions";

/** The timeline's entries with "Load more" (further pages come from the API by cursor). */
export function TimelineList({ patientId, filters, initial }: { patientId: string; filters: TimelineFilters; initial: PatientTimelinePage }) {
  const [entries, setEntries] = React.useState<PatientTimelineEntry[]>(initial.items);
  const [cursor, setCursor] = React.useState<string | null>(initial.nextCursor);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const more = () =>
    startTransition(async () => {
      if (!cursor) return;
      setError(null);
      const result = await loadMoreTimeline(patientId, filters, cursor);
      if (result.ok) {
        setEntries((shown) => appendPage(shown, result.data.items));
        setCursor(result.data.nextCursor);
      } else setError(result.message);
    });

  if (entries.length === 0) {
    return (
      <p className="text-body text-muted-foreground">Nothing recorded{filters.groups.length || filters.from || filters.to ? " for these filters" : ""}.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <PatientTimelineView entries={entries} patientId={patientId} timeZone={initial.timeZone} />
      {cursor ? (
        <Button variant="outline" size="sm" className="self-start" onClick={more} disabled={pending}>
          {pending ? "Loading…" : "Load more"}
        </Button>
      ) : (
        <p className="text-meta text-muted-foreground">End of the record{filters.from || filters.to ? " for these dates" : ""}.</p>
      )}
      {error ? (
        <p role="alert" className="text-table text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
