"use client";

import * as React from "react";
import { BellRingIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalWaitlistEntry } from "@/lib/api/types";
import { longDate } from "@/lib/booking";
import { leaveWaitlist } from "./actions";

/** The patient's waiting-list requests, each of which they can take back. */
export function WaitlistList({ entries }: { entries: PortalWaitlistEntry[] }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const remove = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await leaveWaitlist(id);
      if (!result.ok) setError(result.message);
    });
  return (
    <section className="flex flex-col gap-3" aria-labelledby="waitlist-heading">
      <h2 id="waitlist-heading" className="text-section-lg font-semibold">
        Waiting list
      </h2>
      <p className="text-body text-muted-foreground">
        We will text or email you if a time opens on these days. Nothing is booked for you: book the time yourself.
      </p>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <BellRingIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                {e.earliestDate === e.latestDate ? longDate(e.earliestDate) : `${longDate(e.earliestDate)} to ${longDate(e.latestDate)}`}
              </span>
              <span className="text-meta text-muted-foreground">
                {e.visitTypeName ?? "Any visit"} · {e.facilityName}
                {e.practitionerName ? ` · ${e.practitionerName}` : ""}
              </span>
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => remove(e.id)} disabled={pending}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
