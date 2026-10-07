"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import { submissionMessage } from "@/lib/health-history";
import { stopReportedMedicine } from "./actions";

/** "I stopped taking this" for a medicine the patient reported in MyHealth (once; with the date as known). */
export function StopMedicine({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [when, setWhen] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        I stopped taking this
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      aria-label={`Stopped taking ${name}`}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await stopReportedMedicine(id, when);
          if (!result.ok) return setError(submissionMessage(result.code, result.message));
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`stop-${id}`}>When did you stop? (optional)</Label>
        <Input id={`stop-${id}`} value={when} inputMode="numeric" placeholder="2026-05" onChange={(e) => setWhen(e.target.value)} />
        <p className="text-meta text-muted-foreground">Year, month or day: 2019, 2019-05 or 2019-05-12.</p>
      </div>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Yes, I stopped"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
