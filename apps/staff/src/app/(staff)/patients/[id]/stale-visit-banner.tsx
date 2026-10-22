"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClockAlertIcon } from "lucide-react";
import { Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { moveVisit } from "@/app/(staff)/queue/actions";
import { closeOptionsFor } from "@/lib/patient-profile";
import type { VisitStatus } from "@/lib/api/types";

export interface StaleVisit {
  id: string;
  version: number;
  status: VisitStatus;
  statusLabel: string;
  ticket: string;
  /** The queue day, already written for people ("20 Oct 2026"). */
  dayLabel: string;
  encounterId: string | null;
}

/**
 * A visit left open from an earlier day. It keeps the patient out of today's queue and shows as "in the queue" on the
 * record until somebody closes it, so staff can close it here with the reason. The queue's own rules decide what is allowed;
 * the options only mirror them. Nothing is moved to today.
 */
export function StaleVisitBanner({ visits, canManage }: { visits: StaleVisit[]; canManage: boolean }) {
  if (visits.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-warning-foreground">
      <p className="flex items-center gap-2 text-body font-semibold">
        <ClockAlertIcon className="size-4" aria-hidden />
        {visits.length === 1 ? "A visit from an earlier day is still open" : `${visits.length} visits from earlier days are still open`}
      </p>
      <ul className="flex flex-col gap-3">
        {visits.map((visit) => (
          <li key={visit.id}>
            <StaleVisitRow visit={visit} canManage={canManage} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StaleVisitRow({ visit, canManage }: { visit: StaleVisit; canManage: boolean }) {
  const router = useRouter();
  const options = closeOptionsFor(visit.status);
  const [open, setOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState<string>(options[0]?.value ?? "");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const close = () =>
    startTransition(async () => {
      const result = await moveVisit({
        visitId: visit.id,
        status: outcome as "cancelled" | "left_without_being_seen",
        reason: reason.trim() || `Closed from the patient record: the visit of ${visit.dayLabel} was never closed.`,
        version: visit.version,
      });
      if (result.ok) {
        toast.success("Visit closed.");
        setOpen(false);
        router.refresh();
        return;
      }
      toast.error(result.message);
      // Someone else may have moved it meanwhile: show what is true now.
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-table">
        <span>
          <b className="font-semibold">{visit.dayLabel}</b> · ticket <span className="font-mono">{visit.ticket}</span> · {visit.statusLabel.toLowerCase()}
        </span>
        {visit.status === "in_consultation" && visit.encounterId ? (
          <Link href={`/clinic/encounters/${visit.encounterId}`} className="font-medium underline underline-offset-2">
            Open the consultation to finish it
          </Link>
        ) : null}
        {canManage && options.length > 0 && !open ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            Close visit
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="grid max-w-2xl gap-2 rounded-lg border border-warning/40 bg-card p-3 text-foreground sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`close-outcome-${visit.id}`}>Close as</Label>
            <NativeSelect id={`close-outcome-${visit.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`close-reason-${visit.id}`}>Note (optional)</Label>
            <Input id={`close-reason-${visit.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || !outcome} onClick={close}>
              {pending ? "Closing…" : "Close visit"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Keep open
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
