"use client";

import { CheckCircle2Icon } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { IssuedTicket } from "@/lib/flow";
import { RECEIPT_CLEAR_MS } from "@/lib/idle";
import { BigButton, useCountdown } from "../bits";

/**
 * QueueTicketPage: the end of a visit to the kiosk. Either the queue ticket (queue number, service, time, status and the
 * instruction the clinic's code returns) or, for a new patient, the registration reference to give at the desk. Nothing
 * about the person is shown, and the screen clears itself so the next person starts from the welcome page.
 */
export function QueueTicketPage({
  facilityName,
  timeZone,
  ticket,
  reference,
  onDone,
}: {
  facilityName: string;
  timeZone: string;
  ticket: IssuedTicket | null;
  reference: string | null;
  onDone: () => void;
}) {
  const left = useCountdown(Math.round(RECEIPT_CLEAR_MS / 1000), onDone);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-primary-subtle p-10 text-center" aria-live="polite">
      <CheckCircle2Icon aria-hidden className="size-20 text-success" />
      {ticket ? (
        <>
          <h1 className="text-4xl font-semibold">You are checked in</h1>
          <section aria-label="Your queue ticket" className="flex w-full max-w-2xl flex-col gap-3 rounded-3xl border-2 border-primary bg-card p-10">
            <p className="text-2xl text-muted-foreground">Your number</p>
            <p className="text-8xl font-bold tracking-wide text-primary-deep">{ticket.ticket}</p>
            <p className="text-3xl font-medium">{ticket.service}</p>
            <p className="text-xl text-muted-foreground">
              {ticket.facilityName} · {formatDateTime(ticket.issuedAt, timeZone)}
            </p>
            <p className="text-xl font-medium text-success">Status: checked in, waiting for your turn</p>
          </section>
          <p className="max-w-2xl text-2xl">{ticket.instructions}</p>
          <p className="text-xl text-muted-foreground">Please remember your number. Watch the screen in the waiting area.</p>
        </>
      ) : (
        <>
          <h1 className="text-4xl font-semibold">We received your details</h1>
          <section aria-label="Your registration reference" className="flex w-full max-w-2xl flex-col gap-3 rounded-3xl border-2 border-primary bg-card p-10">
            <p className="text-2xl text-muted-foreground">Your reference</p>
            <p className="text-7xl font-bold tracking-widest text-primary-deep">{reference}</p>
            <p className="text-xl text-muted-foreground">{facilityName}</p>
            <p className="text-xl font-medium">Status: waiting for reception to check your details</p>
          </section>
          <p className="max-w-2xl text-2xl">
            Please go to the front desk and tell the staff your reference. They will finish your registration and put you in the queue.
          </p>
        </>
      )}
      <BigButton onClick={onDone}>Done</BigButton>
      <p className="text-lg text-muted-foreground">This screen clears itself in {left} seconds.</p>
    </main>
  );
}
