import * as React from "react";
import { cn } from "../lib/utils";

/**
 * A placeholder shaped like what is loading. Decorative (hidden from assistive technology): wrap a group in
 * `SkeletonGroup`, which announces "Loading" once.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-muted bg-[linear-gradient(90deg,transparent_25%,var(--accent)_50%,transparent_75%)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}

/** The live region around skeletons: busy, with one spoken "Loading". */
function SkeletonGroup({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** Lines of text; the last is shorter. */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** A card with a title line and some text. */
function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs", className)}>
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={lines} />
    </div>
  );
}

/** A table: a header row and `rows` rows of `columns` cells. */
function SkeletonTable({ rows = 6, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <div className="grid gap-4 border-b bg-muted/40 px-4 py-3" style={grid}>
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-4 border-b px-4 py-3.5 last:border-b-0" style={grid}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5", (r + c) % 3 === 0 ? "w-full" : "w-3/4")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export { Skeleton, SkeletonCard, SkeletonGroup, SkeletonTable, SkeletonText };
