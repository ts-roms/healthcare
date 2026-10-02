"use client";

import * as React from "react";
import { PaperclipIcon } from "lucide-react";
import { Button, toast } from "@healthcare/ui/primitives";
import type { PatientThreadAttachment } from "@/lib/api/types";
import { fileSize } from "@/lib/messaging-mapping";
import { attachmentLink } from "../actions";

/** Files carried with a message; each opens behind a short-lived link the API audits. */
export function AttachmentList({ threadId, attachments }: { threadId: string; attachments: PatientThreadAttachment[] }) {
  const [pending, startTransition] = React.useTransition();
  const open = (documentId: string) =>
    startTransition(async () => {
      const result = await attachmentLink(threadId, documentId);
      if (!result.ok) return void toast.error(result.message);
      window.open(result.data.url, "_blank", "noopener");
    });
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Attached files">
      {attachments.map((a) => (
        <li key={a.documentId}>
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => open(a.documentId)}>
            <PaperclipIcon aria-hidden className="size-3" />
            {a.fileName} <span className="text-muted-foreground">({fileSize(a.sizeBytes)})</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
