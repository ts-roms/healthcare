import * as React from "react";
import { cn } from "../lib/utils";

export interface LaboratoryLayoutProps {
  title?: string;
  /** Scan/search/filters row. */
  toolbar: React.ReactNode;
  /** Worklist table. */
  list: React.ReactNode;
  /** Selected specimen/result entry panel. */
  detail?: React.ReactNode;
  /** Right side of the title row (counters, shift, analyser status). */
  status?: React.ReactNode;
  className?: string;
}

/**
 * Lab workbench: dense toolbar, worklist, and a persistent detail panel.
 * Side-by-side on wide screens so technicians keep list context while entering results.
 */
export function LaboratoryLayout({ title = "Laboratory", toolbar, list, detail, status, className }: LaboratoryLayoutProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-3 py-2">
        <h1 className="text-section-lg font-semibold tracking-wide uppercase">{title}</h1>
        {status ? <div className="flex items-center gap-3 text-table text-muted-foreground">{status}</div> : null}
        <div className="flex w-full flex-wrap items-center gap-2">{toolbar}</div>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_27rem] xl:grid-rows-1">
        <div className="min-h-0 overflow-auto bg-card">{list}</div>
        {detail ? <aside className="min-h-0 overflow-auto border-t bg-background xl:border-t-0 xl:border-l">{detail}</aside> : null}
      </div>
    </div>
  );
}
