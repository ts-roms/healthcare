import * as React from "react";
import type { AuditEntry } from "@healthcare/domain";
import { clinicalDateTime } from "../lib/format";
import { cn } from "../lib/utils";

/** Who did what, when — shown on records, results and signed documents. */
export function AuditHistory({ entries, className }: { entries: AuditEntry[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col divide-y text-table", className)}>
      {[...entries]
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((e) => (
          <li key={e.id} className="grid grid-cols-[9rem_1fr] gap-2 py-1.5">
            <time dateTime={e.at} className="tabular text-muted-foreground">
              {clinicalDateTime(e.at)}
            </time>
            <p>
              <span className="font-medium">{e.actor}</span> <span className="text-muted-foreground">{e.action}</span> {e.target}
              {e.detail ? <span className="text-muted-foreground"> — {e.detail}</span> : null}
            </p>
          </li>
        ))}
    </ol>
  );
}
