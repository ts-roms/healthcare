"use client";

import { SearchIcon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import { QUEUE_VIEW_LABEL, type QueueView } from "@/lib/clinic-mapping";

/** Search the board by ticket, name, patient number, complaint or place, and narrow it to who is being called or checked in themselves. */
export function QueueTools({
  query,
  view,
  shown,
  total,
  onQuery,
  onView,
}: {
  query: string;
  view: QueueView;
  shown: number;
  total: number;
  onQuery: (query: string) => void;
  onView: (view: QueueView) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <div className="relative w-full max-w-sm">
        <Label htmlFor="queue-search" className="sr-only">
          Search the queue
        </Label>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="queue-search"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search ticket, name, patient number…"
          className="pl-8"
          autoComplete="off"
        />
      </div>
      <div role="group" aria-label="Show" className="flex gap-1">
        {(Object.keys(QUEUE_VIEW_LABEL) as QueueView[]).map((v) => (
          <Button key={v} size="sm" variant={view === v ? "default" : "outline"} aria-pressed={view === v} onClick={() => onView(v)}>
            {QUEUE_VIEW_LABEL[v]}
          </Button>
        ))}
      </div>
      {shown !== total ? (
        <p role="status" className="text-table text-muted-foreground">
          Showing {shown} of {total}
        </p>
      ) : null}
    </div>
  );
}
