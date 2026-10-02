"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheckIcon, TimerIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalWaitlistOffer } from "@/lib/api/types";
import { bookingMessage, longDate, slotTime } from "@/lib/booking";
import { acceptOffer, declineOffer } from "./actions";

/** "until 3:45 PM" or "until 2 Oct, 3:45 PM" in the clinic's time zone. */
function untilText(expiresAt: string, timeZone: string): string {
  const at = new Date(expiresAt);
  const sameDay =
    new Intl.DateTimeFormat("en-PH", { timeZone, dateStyle: "medium" }).format(at) ===
    new Intl.DateTimeFormat("en-PH", { timeZone, dateStyle: "medium" }).format(new Date());
  return sameDay
    ? `until ${new Intl.DateTimeFormat("en-PH", { timeZone, timeStyle: "short" }).format(at)}`
    : `until ${new Intl.DateTimeFormat("en-PH", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(at)}`;
}

/**
 * Times the clinic is holding for the patient from the waiting list (migration 0096): accept to book it (first
 * acceptance wins), or decline and stay on the list. The clinic's rules for online bookings still apply.
 */
export function OfferList({ offers }: { offers: PortalWaitlistOffer[] }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const act = (call: () => Promise<{ ok: true } | { ok: false; code?: string; message: string }>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await call();
      if (!result.ok) setError(bookingMessage(result.code, result.message));
      else onDone?.();
      router.refresh();
    });
  return (
    <section className="flex flex-col gap-3" aria-labelledby="offers-heading">
      <h2 id="offers-heading" className="text-section-lg font-semibold">
        A time is being held for you
      </h2>
      <p className="text-body text-muted-foreground">
        From your waiting-list request. Accept to book it — the first to accept gets it — or decline to stay on the list.
      </p>
      <ul className="flex flex-col gap-2">
        {offers.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            <span className="flex items-start gap-2">
              <CalendarCheckIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">
                  {longDate(o.startsAt.slice(0, 10))}, {slotTime(o.startsAt, o.timeZone)}
                </span>
                <span className="text-meta text-muted-foreground">
                  {o.visitTypeName} · {o.practitionerName} · {o.facilityName}
                </span>
                <span className="flex items-center gap-1 text-meta text-muted-foreground">
                  <TimerIcon className="size-3.5" aria-hidden /> Held {untilText(o.expiresAt, o.timeZone)}
                </span>
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  act(
                    () => acceptOffer(o.id),
                    () => router.push("/appointments?booked=1"),
                  )
                }
                disabled={pending}
              >
                Accept and book
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => act(() => declineOffer(o.id))} disabled={pending}>
                Decline
              </Button>
            </span>
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
