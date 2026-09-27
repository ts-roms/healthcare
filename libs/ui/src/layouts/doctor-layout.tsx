"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../primitives/tabs";
import { useMediaQuery } from "../lib/use-media-query";
import { cn } from "../lib/utils";

export interface WorkspacePane {
  title: string;
  content: React.ReactNode;
  /** Right-aligned header content (e.g. a small action). */
  action?: React.ReactNode;
}

export interface DoctorLayoutProps {
  /** Patient banner — always visible. */
  header: React.ReactNode;
  left: WorkspacePane;
  center: WorkspacePane;
  right: WorkspacePane;
  /** Sticky bottom action bar: Order Lab, Prescription, Referral… */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Three-column encounter workspace optimised for minimum clicks.
 * ≥1280px: Patient | Current encounter | Clinical context.
 * Narrower: the same three panes become tabs (encounter first).
 * Exactly one copy of each pane is mounted, so note state is never duplicated.
 */
export function DoctorLayout({ header, left, center, right, actions, className }: DoctorLayoutProps) {
  const wide = useMediaQuery("(min-width: 1280px)");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {header}
      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)_20rem] divide-x">
          <Pane pane={left} className="bg-card" />
          <Pane pane={center} className="bg-background" emphasis />
          <Pane pane={right} className="bg-card" />
        </div>
      ) : (
        <Tabs defaultValue="center" className="min-h-0 flex-1 gap-0">
          <TabsList className="bg-card px-2">
            <TabsTrigger value="center">{center.title}</TabsTrigger>
            <TabsTrigger value="left">{left.title}</TabsTrigger>
            <TabsTrigger value="right">{right.title}</TabsTrigger>
          </TabsList>
          {(["center", "left", "right"] as const).map((k) => {
            const pane = { center, left, right }[k];
            return (
              <TabsContent key={k} value={k} forceMount className="min-h-0 overflow-auto p-3 data-[state=inactive]:hidden">
                {pane.content}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t bg-card px-3 py-2">{actions}</div> : null}
    </div>
  );
}

function Pane({ pane, className, emphasis }: { pane: WorkspacePane; className?: string; emphasis?: boolean }) {
  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label={pane.title}>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <h2 className={cn("text-meta font-semibold tracking-wide uppercase", emphasis ? "text-foreground" : "text-muted-foreground")}>{pane.title}</h2>
        {pane.action ? <div className="ml-auto">{pane.action}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{pane.content}</div>
    </section>
  );
}
