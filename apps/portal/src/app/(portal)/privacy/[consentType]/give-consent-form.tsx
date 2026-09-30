"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Label } from "@healthcare/ui/primitives";
import type { ConsentType } from "@/lib/api/types";
import { consentMessage } from "@/lib/consents";
import { giveConsent } from "../actions";

/** The patient confirms the clinic's own statement, then gives the consent. Recorded with the version they read. */
export function GiveConsentForm({ consentType, wordingId, acknowledgement }: { consentType: ConsentType; wordingId: string; acknowledgement: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await giveConsent(consentType, wordingId);
      if (result.ok) router.push("/privacy");
      else {
        setError(consentMessage(result.code, result.message));
        // The wording changed while reading: show the new one.
        if (result.code === "consent_wording_changed") router.refresh();
      }
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <Checkbox id="acknowledge" checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} className="mt-0.5" />
        <Label htmlFor="acknowledge" className="text-body leading-snug font-normal">
          {acknowledgement}
        </Label>
      </div>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={!agreed || pending}>
          {pending ? "Saving…" : "Give my consent"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.push("/privacy")} disabled={pending}>
          Not now
        </Button>
      </div>
    </form>
  );
}
