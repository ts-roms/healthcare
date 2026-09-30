import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/** A soft mint card for the sidebar footer: an icon, a title, one sentence and one action. */
export function SidebarPromo({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: React.ReactNode;
  className?: string;
}) {
  return (
    <aside className={cn("flex flex-col items-center gap-2 rounded-2xl bg-primary-subtle p-4 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-card text-primary" aria-hidden>
        <Icon className="size-6" />
      </span>
      <p className="text-body font-semibold">{title}</p>
      <p className="text-meta text-muted-foreground">{description}</p>
      {action}
    </aside>
  );
}
