"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, ClockIcon, MapPinCheckIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import { checkInOnline } from "@/app/(portal)/appointments/actions";
import type { PortalAppointment } from "@/lib/api/types";

/**
 * Online check-in for an in-person visit, where the clinic offers it (docs/domains/clinic.md, "Automatic no-shows and
 * online check-in"): the patient says they have arrived and joins the queue for triage. The API decides the window.
 */
export function CheckIn({ visit }: { visit: PortalAppointment }) {
  const router = useRouter();
  const [justCheckedIn, setTicket] = React.useState<string | null>(null);
  const ticket = visit.queueTicket ?? justCheckedIn;
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  if (visit.modality !== "in_person") return null;
  if (ticket) {
    return (
      <p role="status" className="flex items-center gap-1.5 px-1 text-meta font-medium text-success-foreground">
        <CheckCircle2Icon className="size-4" aria-hidden /> You are checked in. Your number is {ticket} — please wait to be called.
      </p>
    );
  }
  if (visit.checkInOpensAt) {
    const opens = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: visit.timeZone }).format(new Date(visit.checkInOpensAt));
    return (
      <p className="flex items-center gap-1.5 px-1 text-meta text-muted-foreground">
        <ClockIcon className="size-3.5" aria-hidden /> You can check in here from {opens} on the day.
      </p>
    );
  }
  if (!visit.canCheckIn) return null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        className="self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await checkInOnline(visit.id);
            if (result.ok) {
              setTicket(result.data.ticket);
              router.refresh();
            } else setError(result.message);
          })
        }
      >
        <MapPinCheckIcon aria-hidden /> I’m at the clinic — check in
      </Button>
      <p className="px-1 text-meta text-muted-foreground">Only when you are at the clinic. You will join the queue for the nurse.</p>
      {error ? (
        <p role="alert" className="px-1 text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
