"use client";

import * as React from "react";
import { PaperclipIcon } from "lucide-react";
import { Button, toast } from "@healthcare/ui/primitives";
import { consentDocumentLink } from "./consent-actions";

/** Opens the signed consent form in a new tab with a short-lived link (each opening is audited by the API). */
export function SignedFormLink({ documentId }: { documentId: string }) {
  const [pending, startTransition] = React.useTransition();
  const open = () =>
    startTransition(async () => {
      // Open the tab synchronously (popup blockers), then point it at the signed URL.
      const tab = window.open("", "_blank");
      const result = await consentDocumentLink(documentId);
      if (result.ok && tab) {
        tab.opener = null;
        tab.location.href = result.data.url;
      } else {
        tab?.close();
        toast.error(result.ok ? "Allow pop-ups to view the signed form." : result.message);
      }
    });
  return (
    <Button type="button" onClick={open} disabled={pending} variant="link" size="xs" className="h-auto gap-1 px-0">
      <PaperclipIcon className="size-3.5" aria-hidden /> {pending ? "Opening…" : "Signed form"}
    </Button>
  );
}
