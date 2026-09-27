import * as React from "react";
import { TestTubeIcon } from "lucide-react";
import type { LabOrderStatus, Specimen } from "@healthcare/domain";
import { clinicalTime } from "../lib/format";
import { cn } from "../lib/utils";
import { labOrderStatusSpec, StatusBadge } from "./status";

export function LabOrderStatusBadge({ status, className }: { status: LabOrderStatus; className?: string }) {
  return <StatusBadge spec={labOrderStatusSpec[status]} className={className} />;
}

/** "Blood | Collected 09:42 | EDTA" — specimen chain-of-custody line. */
export function SpecimenStatus({ specimen, className }: { specimen: Specimen; className?: string }) {
  const parts = [
    specimen.collectedAt ? `Collected ${clinicalTime(specimen.collectedAt)}` : "Not collected",
    specimen.receivedAt ? `Received ${clinicalTime(specimen.receivedAt)}` : null,
    specimen.container ?? null,
  ].filter(Boolean);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-table", className)}>
      <TestTubeIcon className="size-3.5 text-teal" aria-hidden />
      <span className="font-medium capitalize">{specimen.type}</span>
      {parts.map((p) => (
        <React.Fragment key={p}>
          <span className="text-border" aria-hidden>
            |
          </span>
          <span className="tabular text-muted-foreground">{p}</span>
        </React.Fragment>
      ))}
      {specimen.rejectedReason ? <StatusBadge spec={{ ...labOrderStatusSpec.rejected, label: `Rejected: ${specimen.rejectedReason}` }} /> : null}
    </div>
  );
}
