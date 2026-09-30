import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-meta font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        neutral: "border-border bg-muted text-muted-foreground",
        outline: "text-foreground",
        info: "border-info/25 bg-info-subtle text-info-foreground",
        success: "border-success/25 bg-success-subtle text-success-foreground",
        warning: "border-warning/40 bg-warning-subtle text-warning-foreground",
        danger: "border-danger/25 bg-danger-subtle text-danger-foreground",
        critical: "border-transparent bg-critical text-critical-foreground",
        teal: "border-teal/25 bg-secondary text-secondary-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
export type { BadgeProps };
