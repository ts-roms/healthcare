import * as React from "react";
import { SearchXIcon, TriangleAlertIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Something went wrong or was not found: what happened in plain words, what to do next, and a reference to quote to
 * support. Never the technical message (it can carry details a user should not see). Use `tone="notFound"` for a
 * missing page or record, `compact` inside a card or panel.
 */
function ErrorState({
  title = "Something went wrong",
  description = "This page could not be shown. Try again; if it keeps happening, tell your administrator.",
  reference,
  actions,
  tone = "error",
  icon,
  compact = false,
  as: Heading = "h2",
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** A reference (request id or error digest) to quote to support. */
  reference?: string | null;
  actions?: React.ReactNode;
  tone?: "error" | "notFound";
  icon?: LucideIcon;
  compact?: boolean;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const Icon = icon ?? (tone === "notFound" ? SearchXIcon : TriangleAlertIcon);
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      data-slot="error-state"
      className={cn("flex animate-in flex-col items-center gap-2 text-center duration-300 zoom-in-95 fade-in", compact ? "px-6 py-6" : "px-6 py-16", className)}
    >
      <span
        className={cn(
          "mb-1 grid size-14 place-items-center rounded-2xl",
          tone === "error" ? "bg-danger-subtle text-danger-foreground" : "bg-primary-subtle text-primary",
        )}
        aria-hidden
      >
        <Icon className="size-7" />
      </span>
      <Heading className="text-section-lg font-semibold">{title}</Heading>
      {description ? <p className="max-w-md text-body text-muted-foreground">{description}</p> : null}
      {reference ? (
        <p className="text-meta text-muted-foreground">
          Reference: <code className="select-all">{reference}</code>
        </p>
      ) : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export { ErrorState };
