"use client";

import * as React from "react";
import { PaperclipIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalThreadAttachment } from "@/lib/api/types";
import { fileSize } from "@/lib/conversations";
import { openAttachment } from "../conversation-actions";

/** Files sent with a message, each opened through a short-lived link (the clinic records each opening). */
export function AttachmentLinks({ threadId, attachments }: { threadId: string; attachments: PortalThreadAttachment[] }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const open = (documentId: string) => {
    // Open the tab now (a later window.open would be blocked), then point it at the link.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      setError(null);
      const result = await openAttachment(threadId, documentId);
      if (result.ok) {
        if (tab) tab.location.href = result.data.url;
        else window.location.assign(result.data.url);
      } else {
        tab?.close();
        setError(result.message);
      }
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-wrap gap-2" aria-label="Files in this message">
        {attachments.map((a) => (
          <li key={a.documentId}>
            <Button type="button" size="sm" variant="outline" className="h-8" disabled={pending} onClick={() => open(a.documentId)}>
              <PaperclipIcon className="size-4" aria-hidden /> {a.fileName} <span className="text-muted-foreground">({fileSize(a.sizeBytes)})</span>
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
