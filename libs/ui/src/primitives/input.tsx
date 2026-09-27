import * as React from "react";
import { cn } from "../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-body shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20",
        "file:border-0 file:bg-transparent file:text-body file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
