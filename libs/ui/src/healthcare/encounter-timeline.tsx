"use client";

import * as React from "react";
import type { Encounter } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { clinicalDate } from "../lib/format";
import { cn } from "../lib/utils";

/** Compact encounter history (e.g. the "Patient History" column of the doctor workspace). */
export function EncounterTimeline({
  encounters,
  selectedId,
  onSelect,
  className,
}: {
  encounters: Encounter[];
  selectedId?: string;
  onSelect?: (e: Encounter) => void;
  className?: string;
}) {
  const sorted = [...encounters].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol className={cn("flex flex-col", className)}>
      {sorted.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onSelect?.(e)}
            aria-current={e.id === selectedId ? "true" : undefined}
            className={cn(
              "flex w-full flex-col gap-0.5 border-l-2 border-transparent px-2.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent",
              e.id === selectedId && "border-primary bg-primary-subtle",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="tabular text-table font-semibold">{clinicalDate(e.date)}</span>
              <Badge variant="neutral" className="capitalize">
                {e.type}
              </Badge>
              {e.status === "unsigned" || e.status === "in-progress" ? <Badge variant="warning">{e.status === "unsigned" ? "Unsigned" : "Open"}</Badge> : null}
            </span>
            <span className="truncate text-table">{e.reason}</span>
            <span className="truncate text-meta text-muted-foreground">
              {e.provider} · {e.facility}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
