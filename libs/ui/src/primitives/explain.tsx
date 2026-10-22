import * as React from "react";
import { InfoIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * A longer explanation kept out of the way: the page header keeps one sentence, anything more goes here. A native
 * `<details>`, so it works without script, by keyboard and in server components.
 */
function Explain({ summary = "How this works", className, children }: { summary?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <details
      data-slot="explain"
      className={cn(
        "group rounded-xl border border-border/70 bg-card text-body open:bg-primary-subtle/40 [&_summary::-webkit-details-marker]:hidden",
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 font-medium text-primary-deep outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <InfoIcon className="size-4 shrink-0" aria-hidden />
        {summary}
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3 text-muted-foreground">{children}</div>
    </details>
  );
}

export { Explain };
