"use client";

import * as React from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";

export interface ReportLink {
  url: string;
  contentType: string;
  /** Whether the link shows the file in the page; false for a type a browser cannot display (it would download). */
  inline: boolean;
}

/**
 * Shows a report on the page instead of downloading it: a PDF in a frame, a photo as an image. The link is short-lived
 * (each one is recorded as an access to the report) and is fetched when the preview is opened. A file the browser cannot
 * display (for example a HEIC photo) says so and points to Open report. Render it inside a wrapping row: the button joins
 * the row and the preview takes the full line beneath.
 */
export function ReportPreview({ load, label = "Preview" }: { load: () => Promise<ActionResult<ReportLink>>; label?: string }) {
  const [link, setLink] = React.useState<ReportLink | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const toggle = () => {
    if (open) return setOpen(false);
    startTransition(async () => {
      const result = await load();
      if (result.ok) {
        setLink(result.data);
        setOpen(true);
      } else toast.error(result.message);
    });
  };
  return (
    <div className="contents">
      <Button type="button" size="xs" variant="outline" disabled={pending} aria-expanded={open} onClick={toggle}>
        {open ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />} {open ? "Hide preview" : label}
      </Button>
      {open && link ? (
        <div className="flex w-full basis-full flex-col gap-1">
          {!link.inline ? (
            <p className="rounded-md border bg-muted/40 p-3 text-meta text-muted-foreground">
              This kind of file cannot be shown here. Use Open report to download it.
            </p>
          ) : link.contentType === "application/pdf" ? (
            <iframe src={link.url} title="Report preview" className="h-[70vh] w-full rounded-md border bg-background" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private file, not an optimizable asset
            <img src={link.url} alt="The report, as sent" className="max-h-[70vh] w-auto max-w-full rounded-md border bg-background object-contain" />
          )}
          <p className="text-meta text-muted-foreground">The preview link expires after 5 minutes: hide and show it again to refresh.</p>
        </div>
      ) : null}
    </div>
  );
}
