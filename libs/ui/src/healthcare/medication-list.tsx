import * as React from "react";
import { PillIcon } from "lucide-react";
import type { Medication } from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { cn } from "../lib/utils";

export function MedicationList({ medications, dense = false, className }: { medications: Medication[]; dense?: boolean; className?: string }) {
  if (medications.length === 0) {
    return <p className={cn("text-table text-muted-foreground", className)}>No active medications recorded.</p>;
  }
  return (
    <ul className={cn("flex flex-col", dense ? "gap-1" : "divide-y", className)}>
      {medications.map((m) => (
        <li key={m.id} className={cn("flex items-start gap-2", dense ? "" : "py-1.5 first:pt-0 last:pb-0")}>
          <PillIcon className="mt-0.5 size-3.5 shrink-0 text-teal" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-body font-medium">{m.name}</span>
              <span className="tabular text-table text-muted-foreground">
                {m.dose} {m.route ? `${m.route} ` : ""}
                {m.frequency}
              </span>
            </div>
            {!dense && m.prescriber ? <p className="text-meta text-muted-foreground">{m.prescriber}</p> : null}
          </div>
          {m.status !== "active" ? <Badge variant="neutral">{m.status}</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
