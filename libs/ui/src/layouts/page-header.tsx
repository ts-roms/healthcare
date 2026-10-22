import * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { DefaultLink, type LinkComponent } from "./link";

export interface Breadcrumb {
  label: string;
  /** Omit on the last (current) crumb. */
  href?: string;
}

/**
 * The top of every page: breadcrumbs (detail pages), the title, ONE line of description (anything longer goes in an
 * `Explain` below), status badges and the page's one or two main actions.
 *
 * `variant="bar"` (default) is the full-width bar the staff screens use today; `variant="plain"` is the redesign: no
 * bar, the page background shows through and the content sits in the page's own column.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  badges,
  variant = "bar",
  Link = DefaultLink,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** Status next to the title (badges with icon and text). */
  badges?: React.ReactNode;
  variant?: "bar" | "plain";
  Link?: LinkComponent;
  className?: string;
}) {
  return (
    <header data-slot="page-header" className={cn("flex flex-wrap items-end gap-3", variant === "bar" ? "border-b bg-card px-4 py-3" : "pb-1", className)}>
      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1 text-table text-muted-foreground">
              {breadcrumbs.map((b, i) => {
                const last = i === breadcrumbs.length - 1;
                return (
                  <li key={`${b.label}-${i}`} className="flex items-center gap-1">
                    {b.href && !last ? (
                      <Link
                        href={b.href}
                        className="rounded-sm hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {b.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? "page" : undefined}>{b.label}</span>
                    )}
                    {last ? null : <ChevronRightIcon className="size-3.5" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn("font-semibold tracking-tight", variant === "bar" ? "text-page" : "text-page-lg")}>{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-0.5 text-table text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
