"use client";

import * as React from "react";
import Link from "next/link";
import { BellRingIcon, CheckCircle2Icon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { bookingMessage, longDate } from "@/lib/booking";
import { joinWaitlist } from "./actions";

/**
 * Shown when the chosen day has no open times and the clinic takes waiting-list requests: the patient asks to be told
 * when a time opens. Nothing is booked for them; the message says a time may have opened and to sign in and book it.
 */
export function WaitlistOffer({
  facilityId,
  visitTypeId,
  practitionerId,
  date,
  maxEntries,
}: {
  facilityId: string;
  visitTypeId: string;
  practitionerId?: string;
  date: string;
  maxEntries: number;
}) {
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "done"; date: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const [pending, startTransition] = React.useTransition();
  const ask = () =>
    startTransition(async () => {
      const result = await joinWaitlist({ facilityId, visitTypeId, practitionerId, earliestDate: date, latestDate: date });
      setState(result.ok ? { kind: "done", date } : { kind: "error", text: bookingMessage(result.code, result.message) });
    });
  if (state.kind === "done" && state.date === date) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-subtle p-3 text-body text-success-foreground">
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>
          You are on the waiting list for {longDate(date)}. If a time opens we will text or email you to book it; times go to whoever books first. See or remove
          your requests under{" "}
          <Link href="/appointments" className="font-medium underline">
            Visits
          </Link>
          .
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <p className="text-body">
        This day is full. We can tell you if a time opens on {longDate(date)}. You can be on this clinic&apos;s waiting list up to {maxEntries}{" "}
        {maxEntries === 1 ? "time" : "times"}.
      </p>
      <Button type="button" variant="outline" className="self-start" onClick={ask} disabled={pending}>
        <BellRingIcon /> {pending ? "Adding you…" : "Tell me if a time opens"}
      </Button>
      {state.kind === "error" ? (
        <p role="alert" className="text-body text-destructive">
          {state.text}
        </p>
      ) : null}
    </div>
  );
}
