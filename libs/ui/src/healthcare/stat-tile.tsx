import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { DefaultLink, type LinkComponent } from "../layouts/link";

/**
 * A headline figure on a dashboard or list header: label, value, one hint and, when the figure leads somewhere, a link.
 * `tone="alert"` is for figures that need action (overdue, STAT, unacknowledged): danger colours plus an icon and
 * "Needs attention" text, never colour alone. The hint states a fact from the data; it never invents a trend.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  href,
  tone = "default",
  Link = DefaultLink,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "alert";
  Link?: LinkComponent;
  className?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-table font-medium text-muted-foreground">
        {tone === "alert" ? (
          <>
            <TriangleAlertIcon className="size-4 shrink-0 text-danger-foreground" aria-hidden />
            <span className="sr-only">Needs attention: </span>
          </>
        ) : null}
        {label}
      </p>
      <p className={cn("tabular text-[1.75rem] leading-tight font-bold tracking-tight", tone === "alert" && "text-danger-foreground")}>
        {value}
        {unit ? <small className="ml-1 text-body font-medium text-muted-foreground">{unit}</small> : null}
      </p>
      {hint ? <p className="text-table text-muted-foreground">{hint}</p> : null}
    </>
  );
  const classes = cn(
    "flex flex-col gap-1 rounded-xl border bg-card px-4 py-4 text-card-foreground shadow-xs",
    tone === "alert" && "border-danger/45 bg-gradient-to-b from-danger-subtle to-card",
    href && "transition-shadow outline-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50",
    className,
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div data-slot="stat-tile" className={classes}>
      {body}
    </div>
  );
}
