import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Nothing here yet: what it is, why it is empty and the one thing to do next. Use `compact` inside a card or tab
 * panel, `as="h2"` when the page has no heading above it.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  compact = false,
  as: Heading = "h3",
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
  as?: "h2" | "h3" | "h4";
  className?: string;
}) {
  return (
    <div data-slot="empty-state" className={cn("flex flex-col items-center gap-2 text-center", compact ? "px-6 py-6" : "px-6 py-10", className)}>
      {Icon ? (
        <span className="mb-1 grid size-13 place-items-center rounded-2xl bg-primary-subtle text-primary" aria-hidden>
          <Icon className="size-6" />
        </span>
      ) : null}
      <Heading className="text-section font-semibold">{title}</Heading>
      {description ? <p className="max-w-md text-body text-muted-foreground">{description}</p> : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { EmptyState };
