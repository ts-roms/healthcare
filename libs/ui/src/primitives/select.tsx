import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Native select styled to match inputs. Native is faster for keyboard-heavy
 * staff workflows (type-ahead, no portal) and works everywhere.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        data-slot="native-select"
        className="h-8 w-full appearance-none rounded-md border border-input bg-card py-1 pr-7 pl-2.5 text-body shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
