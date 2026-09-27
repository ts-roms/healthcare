import * as React from "react";
import { AlertOctagonIcon, AlertTriangleIcon, ChevronRightIcon, InfoIcon, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Dashboards answer "what do I need to do next?" — metrics are compact
 * numbers that link to the work, and the attention list is the main event.
 */
export function ActionMetric({
  value,
  label,
  href,
  tone = "default",
  className,
}: {
  value: React.ReactNode;
  label: string;
  href?: string;
  tone?: "default" | "warning" | "critical";
  className?: string;
}) {
  const Comp = href ? "a" : "div";
  return (
    <Comp
      href={href}
      className={cn(
        "flex items-baseline gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        href && "hover:bg-accent",
        className,
      )}
    >
      <span
        className={cn(
          "tabular min-w-10 text-right text-page-lg font-semibold",
          tone === "warning" && "text-warning-foreground",
          tone === "critical" && "text-critical dark:text-danger",
        )}
      >
        {value}
      </span>
      <span className="text-body text-muted-foreground">{label}</span>
    </Comp>
  );
}

export interface AttentionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail?: string;
  href?: string;
  count?: number;
}

const SEV: Record<AttentionItem["severity"], { icon: LucideIcon; cls: string; label: string }> = {
  critical: { icon: AlertOctagonIcon, cls: "text-critical dark:text-danger", label: "Critical" },
  warning: { icon: AlertTriangleIcon, cls: "text-warning-foreground", label: "Warning" },
  info: { icon: InfoIcon, cls: "text-info", label: "Info" },
};

export function AttentionList({ items, title = "Attention required", className }: { items: AttentionItem[]; title?: string; className?: string }) {
  const order = { critical: 0, warning: 1, info: 2 };
  const sorted = [...items].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <section className={cn("flex flex-col rounded-lg border bg-card", className)} aria-label={title}>
      <h2 className="flex items-center gap-1.5 border-b px-3 py-2 text-body font-semibold">
        <AlertTriangleIcon className="size-4 text-warning" aria-hidden />
        {title}
      </h2>
      {sorted.length === 0 ? (
        <p className="px-3 py-4 text-body text-muted-foreground">Nothing needs your attention.</p>
      ) : (
        <ul className="divide-y">
          {sorted.map((item) => {
            const s = SEV[item.severity];
            const Icon = s.icon;
            const Comp = item.href ? "a" : "div";
            return (
              <li key={item.id}>
                <Comp href={item.href} className={cn("flex items-center gap-2.5 px-3 py-2", item.href && "hover:bg-accent/60")}>
                  <Icon className={cn("size-4 shrink-0", s.cls)} aria-label={s.label} />
                  {item.count !== undefined ? <span className={cn("tabular w-6 text-right text-section font-semibold", s.cls)}>{item.count}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium">{item.title}</span>
                    {item.detail ? <span className="block truncate text-meta text-muted-foreground">{item.detail}</span> : null}
                  </span>
                  {item.href ? <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden /> : null}
                </Comp>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
