import * as React from "react";
import { cn } from "../lib/utils";

/** Cards are rounded white panels on the soft page background: tight padding, faint border, barely-there shadow. */
function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section data-slot="card" className={cn("flex flex-col rounded-xl border border-border/70 bg-card text-card-foreground shadow-xs", className)} {...props} />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"header">) {
  return <header data-slot="card-header" className={cn("flex items-center gap-2 border-b px-3 py-2", className)} {...props} />;
}

function CardTitle({ className, children, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 data-slot="card-title" className={cn("text-body leading-none font-semibold", className)} {...props}>
      {children}
    </h2>
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-meta text-muted-foreground", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-action" className={cn("ml-auto flex items-center gap-1", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-3", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return <footer data-slot="card-footer" className={cn("flex items-center gap-2 border-t px-3 py-2", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter };
