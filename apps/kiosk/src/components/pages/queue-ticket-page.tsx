"use client";

import { CheckCircle2Icon, PrinterIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { printStatus } from "@/app/actions";
import { safely } from "@/lib/safe-action";
import { formatDateTime } from "@/lib/format";
import type { IssuedTicket } from "@/lib/flow";
import { RECEIPT_CLEAR_MS } from "@/lib/idle";
import { PRINT_POLL_MS, type PrintState, printIsFinal, printView } from "@/lib/print-status";
import { BigButton, useCountdown } from "../bits";

/**
 * Asks how the ticket's print job is going until it is printed or can no longer print, and says so in words. The ticket's
 * number is on screen either way: a printer problem only ever sends the person to the desk.
 */
function PrintMessage({ jobId }: { jobId: string }) {
  const [state, setState] = useState<PrintState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await safely(() => printStatus(jobId));
      if (cancelled) return;
      const next = result.ok ? result.data.status : null;
      setState(next);
      setElapsed(Date.now() - startedAt.current);
      if (!printIsFinal(next) && Date.now() - startedAt.current < 60_000) timer = setTimeout(() => void poll(), PRINT_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const view = printView(true, state, elapsed);
  if (!view) return null;
  const Icon = view.kind === "problem" ? TriangleAlertIcon : PrinterIcon;
  return (
    <p role="status" className={`flex max-w-2xl items-center justify-center gap-3 text-2xl ${view.kind === "problem" ? "font-medium text-danger" : ""}`}>
      <Icon aria-hidden className="size-8 shrink-0" />
      {view.text}
    </p>
  );
}

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
          {ticket.printJobId ? <PrintMessage jobId={ticket.printJobId} /> : null}
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
