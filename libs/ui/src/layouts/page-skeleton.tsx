import * as React from "react";
import { Skeleton, SkeletonGroup, SkeletonTable } from "../primitives/skeleton";
import { PageShell } from "./page-templates";

/**
 * What a working page looks like while it loads: header, a row of figures and a table. The fallback of a route's
 * `loading.tsx`, so navigation answers at once instead of freezing.
 */
export function PageSkeleton({ stats = 4, rows = 6, columns = 5 }: { stats?: number; rows?: number; columns?: number }) {
  return (
    <PageShell>
      <SkeletonGroup className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        {stats > 0 ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: stats }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : null}
        <SkeletonTable rows={rows} columns={columns} />
      </SkeletonGroup>
    </PageShell>
  );
}
