"use client";

import * as React from "react";
import { DownloadIcon } from "lucide-react";
import { openCertificate, openReferralLetter, openSharedDocument } from "./actions";

/** Opens a certificate, a referral letter or a shared document through a short-lived link (each opening is recorded by the clinic). */
export function OpenFile({ kind, id, label }: { kind: "certificate" | "referral" | "shared"; id: string; label: string }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const open = () => {
    // Open the tab now (a later window.open would be blocked), then point it at the link.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      setError(null);
      const result = kind === "certificate" ? await openCertificate(id) : kind === "referral" ? await openReferralLetter(id) : await openSharedDocument(id);
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
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-meta font-medium hover:bg-muted disabled:opacity-60"
      >
        <DownloadIcon className="size-4" aria-hidden /> {label}
      </button>
      {error ? (
        <span role="alert" className="text-meta text-danger-foreground">
          {error}
        </span>
      ) : null}
    </span>
  );
}
