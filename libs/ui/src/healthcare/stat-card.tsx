import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * A headline figure with an icon chip and a tinted footer for one supporting fact
 * (e.g. "Average wait 12 min"). The footer states facts from the data; it never invents a trend.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  footer,
  href,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  footer?: React.ReactNode;
  href?: string;
  tone?: "default" | "warning";
  className?: string;
}) {
  const Comp = href ? "a" : "div";
  return (
    <Comp
      href={href}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        href && "transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-table text-muted-foreground">{label}</p>
          <p className={cn("tabular mt-1 text-page-lg font-semibold", tone === "warning" && "text-warning-foreground")}>{value}</p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-deep text-primary-foreground" aria-hidden>
          <Icon className="size-5" />
        </span>
      </div>
      {footer ? <div className="mt-auto bg-primary-subtle px-4 py-2 text-table text-primary-deep">{footer}</div> : null}
    </Comp>
  );
}
