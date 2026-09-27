import * as React from "react";
import type { LabObservation } from "@healthcare/domain";
import { cn } from "../lib/utils";
import { isCriticalFlag, LabFlagText } from "./status";

export function referenceRange(o: Pick<LabObservation, "referenceLow" | "referenceHigh" | "referenceText">) {
  if (o.referenceText) return o.referenceText;
  if (o.referenceLow !== undefined && o.referenceHigh !== undefined) return `${o.referenceLow}–${o.referenceHigh}`;
  if (o.referenceHigh !== undefined) return `< ${o.referenceHigh}`;
  if (o.referenceLow !== undefined) return `> ${o.referenceLow}`;
  return "—";
}

/** Single result, e.g. for timelines and summary panels: "HbA1c 7.1 % ↑ High (< 5.7)". */
export function LabResult({ observation, className }: { observation: LabObservation; className?: string }) {
  const critical = isCriticalFlag(observation.flag);
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 text-body", critical && "rounded-md bg-critical-subtle px-2 py-1", className)}>
      <span className="text-muted-foreground">{observation.name}</span>
      <span
        className={cn(
          "tabular font-semibold",
          observation.flag !== "normal" && "text-warning-foreground",
          critical && "text-critical dark:text-danger-foreground",
        )}
      >
        {observation.value === "" ? "—" : observation.value}
        {observation.unit ? <span className="ml-0.5 text-meta font-normal text-muted-foreground">{observation.unit}</span> : null}
      </span>
      {observation.flag !== "normal" ? <LabFlagText flag={observation.flag} className="text-meta" /> : null}
      <span className="text-meta text-muted-foreground">({referenceRange(observation)})</span>
    </div>
  );
}
