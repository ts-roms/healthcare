"use client";

import * as React from "react";
import { PaperclipIcon } from "lucide-react";
import { toast } from "@healthcare/ui/primitives";
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
    <button
      type="button"
      onClick={open}
      disabled={pending}
      className="inline-flex items-center gap-1 text-meta font-medium text-primary underline-offset-4 hover:underline"
    >
      <PaperclipIcon className="size-3.5" aria-hidden /> {pending ? "Opening…" : "Signed form"}
    </button>
  );
}
