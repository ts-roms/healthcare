"use client";

import * as React from "react";
import type { LabFlag, LabObservation } from "@healthcare/domain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../primitives/table";
import { cn } from "../lib/utils";
import { referenceRange } from "./lab-result";
import { isCriticalFlag, LabFlagText } from "./status";

/** Auto-flag a numeric value against its range. Critical thresholds are ±50% beyond range for the demo. */
export function autoFlag(o: LabObservation, raw: string): LabFlag {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n)) return o.flag;
  const { referenceLow: lo, referenceHigh: hi } = o;
  if (hi !== undefined && n > hi) return n > hi * 1.5 ? "critical-high" : "high";
  if (lo !== undefined && n < lo) return n < lo * 0.5 ? "critical-low" : "low";
  return "normal";
}

export interface LabResultTableProps {
  observations: LabObservation[];
  /** When set, the Result column becomes editable (lab workbench entry mode). */
  onChange?: (observations: LabObservation[]) => void;
  className?: string;
}

export function LabResultTable({ observations, onChange, className }: LabResultTableProps) {
  const editable = !!onChange;
  const inputs = React.useRef<(HTMLInputElement | null)[]>([]);

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          <TableHead>Test</TableHead>
          <TableHead className="text-right">Result</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead>Range</TableHead>
          <TableHead>Flag</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {observations.map((o, i) => {
          const critical = isCriticalFlag(o.flag);
          return (
            <TableRow key={o.id} className={cn(critical && "bg-critical-subtle hover:bg-critical-subtle")}>
              <TableCell className="font-medium">{o.name}</TableCell>
              <TableCell className="text-right">
                {editable ? (
                  <input
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    aria-label={`${o.name} result`}
                    value={String(o.value)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = observations.map((x) => (x.id === o.id ? { ...x, value: raw, flag: autoFlag(x, raw) } : x));
                      onChange(next);
                    }}
                    onKeyDown={(e) => {
                      // Enter moves down the column, like a spreadsheet.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        inputs.current[i + (e.shiftKey ? -1 : 1)]?.focus();
                      }
                    }}
                    className={cn(
                      "tabular h-7 w-24 rounded-sm border border-input bg-card px-1.5 text-right font-semibold outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
                      o.flag !== "normal" && "text-warning-foreground",
                      critical && "border-critical text-critical",
                    )}
                  />
                ) : (
                  <span
                    className={cn("font-semibold", o.flag !== "normal" && "text-warning-foreground", critical && "text-critical dark:text-danger-foreground")}
                  >
                    {o.value === "" ? "—" : o.value}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{o.unit ?? ""}</TableCell>
              <TableCell className="text-muted-foreground">{referenceRange(o)}</TableCell>
              <TableCell>
                <LabFlagText flag={o.flag} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
