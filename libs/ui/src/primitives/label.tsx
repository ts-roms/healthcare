"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "../lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("flex items-center gap-1.5 text-table font-medium text-foreground select-none peer-disabled:opacity-50", className)}
      {...props}
    />
  );
}

export { Label };
