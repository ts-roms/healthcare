"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "../lib/utils";

/** MRN display with one-click copy — identifiers get copied into forms and phone calls constantly. */
export function PatientIdentifier({ mrn, label = "Patient", className }: { mrn: string; label?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(mrn);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "group tabular inline-flex items-center gap-1 rounded-sm font-mono text-table text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      aria-label={`Copy ${label.toLowerCase()} number ${mrn}`}
    >
      <span className="font-sans">{label}</span> #{mrn}
      {copied ? <CheckIcon className="size-3 text-success" aria-hidden /> : <CopyIcon className="size-3 opacity-0 group-hover:opacity-100" aria-hidden />}
    </button>
  );
}
