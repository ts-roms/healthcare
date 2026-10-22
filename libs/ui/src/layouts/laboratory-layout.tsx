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
  /** An urgent banner under the title (STAT samples not yet collected). */
  notice?: React.ReactNode;
  className?: string;
}

/**
 * Lab workbench: dense toolbar, worklist, and a persistent detail panel.
 * Side-by-side on wide screens so technicians keep list context while entering results.
 */
export function LaboratoryLayout({ title = "Laboratory", toolbar, list, detail, status, notice, className }: LaboratoryLayoutProps) {
  return (
    <div className={cn("mx-auto flex h-full min-h-0 w-full max-w-[90rem] flex-col gap-3 p-4 md:p-6", className)}>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-page-lg font-semibold tracking-tight">{title}</h1>
        {status ? <div className="flex flex-wrap items-center gap-3 text-table text-muted-foreground">{status}</div> : null}
      </header>
      {notice}
      <div className="flex shrink-0 flex-wrap items-center gap-2">{toolbar}</div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(12rem,1fr)_auto] gap-4 xl:grid-cols-[minmax(0,1fr)_27rem] xl:grid-rows-1">
        <div className="min-h-0 overflow-auto rounded-xl border bg-card">{list}</div>
        {detail ? <aside className="min-h-0 overflow-auto rounded-xl border bg-card">{detail}</aside> : null}
      </div>
    </div>
  );
}
