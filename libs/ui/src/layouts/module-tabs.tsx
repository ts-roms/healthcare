import * as React from "react";
import { cn } from "../lib/utils";
import { DefaultLink, isActive, type LinkComponent } from "./link";

export interface ModuleTab {
  href: string;
  label: string;
  /** A count beside the label (open items). Hidden when 0 or undefined. */
  count?: number;
  /** The count needs action (overdue, STAT): danger colours, announced as "need attention". */
  alert?: boolean;
  /** Mark it current without matching the path (e.g. a tab that owns several routes). */
  active?: boolean;
}

/**
 * The sub-pages of a module as link tabs under the page header, replacing both the sidebar children and the row of pill
 * buttons in the header. They are links (each tab is a page), so it works in server components; `pathname` decides the
 * current tab (the longest matching `href` wins, so `/billing` is not current on `/billing/invoices`).
 */
export function ModuleTabs({
  tabs,
  pathname,
  label = "Sections",
  Link = DefaultLink,
  className,
}: {
  tabs: ModuleTab[];
  pathname: string;
  /** Names the navigation, e.g. "Billing sections". */
  label?: string;
  Link?: LinkComponent;
  className?: string;
}) {
  const matches = tabs.filter((t) => isActive(pathname, t.href.split("?")[0] ?? t.href));
  const longest = matches.reduce<ModuleTab | undefined>((best, t) => (t.href.length > (best?.href.length ?? -1) ? t : best), undefined);
  return (
    <nav aria-label={label} data-slot="module-tabs" className={cn("flex [scrollbar-width:none] gap-0.5 overflow-x-auto border-b", className)}>
      {tabs.map((t) => {
        const current = t.active ?? t === longest;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-body font-medium whitespace-nowrap transition-colors outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50",
              current ? "border-primary text-primary-deep" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "tabular inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-meta font-semibold",
                  t.alert ? "bg-danger-subtle text-danger-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {t.count}
                <span className="sr-only">{t.alert ? " need attention" : " open"}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
