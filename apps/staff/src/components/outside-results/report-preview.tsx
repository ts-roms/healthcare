"use client";

import * as React from "react";
import { EyeIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";

export interface ReportLink {
  url: string;
  contentType: string;
  /** Whether the link shows the file in the page; false for a type a browser cannot display (it would download). */
  inline: boolean;
}

/**
 * Shows a report in a modal instead of downloading it: a PDF in a frame, a photo as an image. A fresh link is fetched
 * each time it opens (the links are short-lived and each one is recorded as an access to the report). A file the browser
 * cannot display (for example a HEIC photo) says so and points to Open report.
 */
export function ReportPreview({
  load,
  title = "Report",
  label = "Preview",
}: {
  load: () => Promise<ActionResult<ReportLink>>;
  /** What the modal is called, so the reader knows whose report it is (a test name; never put the patient in a tab title). */
  title?: string;
  label?: string;
}) {
  const [link, setLink] = React.useState<ReportLink | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const show = () =>
    startTransition(async () => {
      const result = await load();
      if (result.ok) {
        setLink(result.data);
        setOpen(true);
      } else toast.error(result.message);
    });
  return (
    <>
      <Button type="button" size="xs" variant="outline" disabled={pending} onClick={show}>
        <EyeIcon aria-hidden /> {pending ? "Opening…" : label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Drop the link with the modal: it expires in 5 minutes and is fetched again next time.
          if (!next) setLink(null);
        }}
      >
        <DialogContent className="flex h-[90vh] max-h-[90vh] flex-col sm:max-w-5xl">
          <DialogHeader className="pr-6">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>As sent. The system has not read it. The link expires after 5 minutes; close and open it again to refresh.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
            {link && !link.inline ? (
              <p className="p-4 text-body text-muted-foreground">This kind of file cannot be shown here. Close this and use Open report to download it.</p>
            ) : link && link.contentType === "application/pdf" ? (
              <iframe src={link.url} title={title} className="h-full w-full bg-background" />
            ) : link ? (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to a private file, not an optimizable asset
              <img src={link.url} alt={title} className="mx-auto h-full w-auto max-w-full object-contain" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
