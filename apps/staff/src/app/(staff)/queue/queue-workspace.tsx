"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, MegaphoneIcon, RefreshCwIcon, StethoscopeIcon, XIcon } from "lucide-react";
import { clinicalTime, QueueBoard, sexLabel } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { QueueVisit } from "@/lib/api/types";
import {
  canTriage,
  moveNeedsReason,
  QUEUE_BOARD_STATUSES,
  QUEUE_MOVE_LABEL,
  type QueueMove,
  queueMoves,
  toQueueEntry,
  visitStatusLabel,
} from "@/lib/clinic-mapping";
import { callVisit, moveVisit } from "./actions";

/** Until realtime reaches the browser (the socket needs a token the BFF keeps server-side), the board polls. */
const REFRESH_MS = 15_000;

export function QueueWorkspace({
  visits,
  canManage,
  canTriage: mayTriage,
  canOpenRecord,
}: {
  visits: QueueVisit[];
  canManage: boolean;
  canTriage: boolean;
  canOpenRecord: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      // Keep waiting times current; fetch fresh data only while the board is on screen.
      setNow(new Date());
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  const entries = React.useMemo(() => visits.map(toQueueEntry), [visits]);
  const selected = visits.find((v) => v.id === selectedId) ?? null;

  const run = (call: () => Promise<ActionResult<unknown>>, success: string, onDone?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        onDone?.();
      } else {
        toast.error(result.message);
      }
      // Either way, show the queue as the server now has it (a conflict means someone else moved first).
      router.refresh();
    });

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-2 text-meta text-muted-foreground">
          <span>
            {entries.filter((e) => e.status !== "done").length} active · updated {clinicalTime(now.toISOString())}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setNow(new Date());
              router.refresh();
            }}
            aria-label="Refresh the queue"
          >
            <RefreshCwIcon /> Refresh
          </Button>
        </div>
        <div className="overflow-x-auto">
          <QueueBoard entries={entries} now={now} statuses={QUEUE_BOARD_STATUSES} onSelect={(e) => setSelectedId(e.id)} className="min-w-[60rem]" />
        </div>
        {visits.length === 0 ? <p className="text-body text-muted-foreground">No one has arrived yet today.</p> : null}
      </div>

      {selected ? (
        <VisitPanel
          key={`${selected.id}:${selected.version}`}
          visit={selected}
          canManage={canManage}
          canTriage={mayTriage}
          canOpenRecord={canOpenRecord}
          pending={pending}
          onClose={() => setSelectedId(null)}
          onMove={(move, reason) =>
            run(() => moveVisit({ visitId: selected.id, status: move, reason, version: selected.version }), `${selected.ticket}: ${QUEUE_MOVE_LABEL[move]}`)
          }
          onCall={(calledTo) => run(() => callVisit({ visitId: selected.id, calledTo, version: selected.version }), `${selected.ticket} called to ${calledTo}`)}
        />
      ) : (
        <p className="self-start rounded-lg border border-dashed p-4 text-body text-muted-foreground">
          Select a ticket to call the patient or move them along.
        </p>
      )}
    </div>
  );
}

function VisitPanel({
  visit,
  canManage,
  canTriage: mayTriage,
  canOpenRecord,
  pending,
  onClose,
  onMove,
  onCall,
}: {
  visit: QueueVisit;
  canManage: boolean;
  canTriage: boolean;
  canOpenRecord: boolean;
  pending: boolean;
  onClose: () => void;
  onMove: (move: QueueMove, reason?: string) => void;
  onCall: (calledTo: string) => void;
}) {
  const [calledTo, setCalledTo] = React.useState(visit.calledTo ?? "");
  const [closing, setClosing] = React.useState<QueueMove | null>(null);
  const [reason, setReason] = React.useState("");
  const moves = queueMoves(visit.status);
  const open = moves.length > 0;

  return (
    <Card className="self-start" aria-label={`Ticket ${visit.ticket}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="font-mono">{visit.ticket}</span>
          {visit.priority !== "routine" ? (
            <Badge variant={visit.priority === "emergency" ? "critical" : "danger"}>{visit.priority === "emergency" ? "Emergency" : "Urgent"}</Badge>
          ) : null}
        </CardTitle>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        <div>
          <p className="font-semibold">{visit.patient?.displayName ?? "Patient"}</p>
          {visit.patient ? (
            <p className="text-table text-muted-foreground">
              <span className="font-mono">{visit.patient.patientNumber}</span> · {visit.patient.age} y · {sexLabel(visit.patient.sex)}
            </p>
          ) : null}
          {canOpenRecord ? (
            <Link href={`/patients/${visit.patientId}`} className="inline-flex items-center gap-1 text-table text-primary hover:underline">
              Open patient record <ExternalLinkIcon className="size-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-table">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{visitStatusLabel(visit.status)}</dd>
          <dt className="text-muted-foreground">Arrived</dt>
          <dd>
            {clinicalTime(visit.checkedInAt)} · {visit.arrivalMode === "appointment" ? "appointment" : "walk-in"}
          </dd>
          {visit.chiefComplaint ? (
            <>
              <dt className="text-muted-foreground">Complaint</dt>
              <dd>{visit.chiefComplaint}</dd>
            </>
          ) : null}
          {visit.calledTo ? (
            <>
              <dt className="text-muted-foreground">Called to</dt>
              <dd>
                {visit.calledTo}
                {visit.calledAt ? ` at ${clinicalTime(visit.calledAt)}` : ""}
              </dd>
            </>
          ) : null}
        </dl>

        {mayTriage && canTriage(visit.status) ? (
          <Button asChild size="sm" variant={visit.status === "awaiting_consultation" ? "outline" : "default"}>
            <Link href={`/queue/visits/${visit.id}/triage`}>
              <StethoscopeIcon /> {visit.status === "awaiting_consultation" ? "Update triage" : "Triage & vitals"}
            </Link>
          </Button>
        ) : null}
        {canManage && open ? (
          <>
            <form
              className="flex items-end gap-2 border-t pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (calledTo.trim()) onCall(calledTo.trim());
              }}
            >
              <div className="grid flex-1 gap-1">
                <Label htmlFor="called-to">Call patient to</Label>
                <Input id="called-to" value={calledTo} maxLength={60} placeholder="e.g. Triage 1, Room 3" onChange={(e) => setCalledTo(e.target.value)} />
              </div>
              <Button type="submit" disabled={pending || !calledTo.trim()}>
                <MegaphoneIcon /> Call
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {moves
                .filter((m) => !moveNeedsReason(m))
                .map((m) => (
                  <Button key={m} variant="outline" size="sm" disabled={pending} onClick={() => onMove(m)}>
                    {QUEUE_MOVE_LABEL[m]}
                  </Button>
                ))}
              {moves.filter(moveNeedsReason).map((m) => (
                <Button key={m} variant="ghost" size="sm" disabled={pending} onClick={() => setClosing(m)} aria-pressed={closing === m}>
                  {QUEUE_MOVE_LABEL[m]}…
                </Button>
              ))}
            </div>
            {closing ? (
              <form
                className="flex flex-col gap-2 rounded-md border border-warning/40 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onMove(closing, reason.trim());
                }}
              >
                <Label htmlFor="close-reason">Reason for “{QUEUE_MOVE_LABEL[closing]}” *</Label>
                <Textarea
                  id="close-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Recorded in the audit trail"
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" size="sm" disabled={pending || reason.trim().length < 3}>
                    {QUEUE_MOVE_LABEL[closing]}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setClosing(null)}>
                    Keep in queue
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
        {visit.status === "in_consultation" ? <p className="text-table text-muted-foreground">With the provider. The encounter closes the visit.</p> : null}
      </CardContent>
    </Card>
  );
}
