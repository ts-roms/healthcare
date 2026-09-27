import * as React from "react";
import { cn } from "../lib/utils";

export interface TelemedicineLayoutProps {
  video: React.ReactNode;
  patient: React.ReactNode;
  notes: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Video consultation as a clinical workspace: the record never leaves the screen. */
export function TelemedicineLayout({ video, patient, notes, actions, className }: TelemedicineLayoutProps) {
  return (
    <div
      className={cn("grid h-full min-h-0 grid-rows-[auto_auto_auto] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,3fr)_minmax(0,2fr)]", className)}
    >
      <div className="min-h-64 bg-black lg:min-h-0">{video}</div>
      <aside className="min-h-0 overflow-auto border-l bg-card p-3 lg:row-span-2">{patient}</aside>
      <section className="flex min-h-0 flex-col border-t bg-background" aria-label="Consultation notes">
        <div className="min-h-0 flex-1 overflow-auto p-3">{notes}</div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-1.5 border-t bg-card px-3 py-2">{actions}</div> : null}
      </section>
    </div>
  );
}
