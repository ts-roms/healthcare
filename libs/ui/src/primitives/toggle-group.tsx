"use client";

import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "../lib/utils";

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn("flex flex-wrap gap-1", className)} {...props} />;
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-table font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "data-[state=on]:border-primary data-[state=on]:bg-primary-subtle data-[state=on]:text-primary [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
