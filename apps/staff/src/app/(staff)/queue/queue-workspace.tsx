"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, HandIcon, MegaphoneIcon, SendIcon, StethoscopeIcon, XIcon } from "lucide-react";
import { clinicalTime, QueueBoard, SENIOR_AGE, sexLabel, WaitPill } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { ActionResult } from "@/lib/api/action-result";
import type { QueueVisit, RouteTemplate, ServicePoint } from "@/lib/api/types";
import {
  canRouteVisit,
  canStartConsultation,
  checkedInOnline,
  canTriage,
  moveNeedsReason,
  QUEUE_BOARD_STATUSES,
  QUEUE_MOVE_LABEL,
  type QueueMove,
  queueFigures,
  queueMoves,
  SERVICE_POINT_KIND_LABEL,
  toQueueEntry,
  visitStatusLabel,
  WAIT_LONG_MINUTES,
  WAIT_WARN_MINUTES,
} from "@/lib/clinic-mapping";
import { useQueueUpdates } from "@/components/live-queue";
import { StartConsultationButton } from "../clinic/encounters/start-consultation-button";
import { advanceRoute, callVisit, moveVisit, planRoute, routeVisit, skipRouteStep } from "./actions";
import { EmptyQueue, type TodayAppointments } from "./queue-empty";
import { QueueHeader, type QueueChrome } from "./queue-header";
import { QueueStats } from "./queue-stats";
import { RoutePanel } from "./route-panel";

const WAIT_THRESHOLDS = { warn: WAIT_WARN_MINUTES, long: WAIT_LONG_MINUTES };
/** Statuses in which the patient is still waiting for the provider (the panel shows the wait). */
const STILL_WAITING = ["waiting", "in_triage", "awaiting_consultation"];
/** The ticket panel beside the board (20rem); below this screen size it sits under the board. */
const PANEL_CLASS = "xl:w-[20rem] xl:shrink-0";

export function QueueWorkspace({
  visits,
  servicePoints = [],
  templates = [],
  autoCall = false,
  chrome,
  practitionerNames = {},
  today = null,
  canManage,
  canTriage: mayTriage,
  canOpenRecord,
  canConsult,
  canOpenEncounter,
  canRecordProcedure = false,
}: {
  visits: QueueVisit[];
  /** The facility's active service points (migration 0113); none = the single consultation line. */
  servicePoints?: ServicePoint[];
  /** Route templates a nurse may apply while planning a route (migration 0116). */
  templates?: RouteTemplate[];
  /** The facility calls the patient automatically when a route sends them on (migration 0115). */
  autoCall?: boolean;
  /** The header's facility, day and buttons. */
  chrome: QueueChrome;
  /** Display names of the practitioners, by id, for "Assigned" on the ticket. */
  practitionerNames?: Record<string, string>;
  /** Today's appointments, for the empty board. */
  today?: TodayAppointments | null;
  canManage: boolean;
  canTriage: boolean;
  canOpenRecord: boolean;
  /** encounter.write: may start a consultation. */
  canConsult: boolean;
  /** encounter.read: may open a consultation. */
  canOpenEncounter: boolean;
  /** procedure.record: may record a procedure under the visit without a consultation. */
  canRecordProcedure?: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [now, setNow] = React.useState(() => new Date());

  // Live updates over the realtime socket, polling as a fallback; the tick keeps waiting times current.
  const live = useQueueUpdates(() => setNow(new Date()));

  const entries = React.useMemo(() => visits.map(toQueueEntry), [visits]);
  const figures = React.useMemo(() => queueFigures(visits, now), [visits, now]);
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
    <div className="flex h-full min-h-0 flex-col">
      <QueueHeader
        chrome={chrome}
        servicePoints={servicePoints}
        live={live}
        updated={clinicalTime(now.toISOString())}
        onRefresh={() => {
          setNow(new Date());
          router.refresh();
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {visits.length === 0 ? (
          <EmptyQueue canCheckIn={chrome.canCheckIn} today={today} />
        ) : (
          <>
            <QueueStats figures={figures} />
            <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
              <div className="min-h-[22rem] min-w-0 flex-1 overflow-x-auto xl:min-h-0">
                <QueueBoard
                  layout="comfortable"
                  entries={entries}
                  now={now}
                  statuses={QUEUE_BOARD_STATUSES}
                  selectedId={selectedId}
                  waitThresholds={WAIT_THRESHOLDS}
                  onSelect={(e) => setSelectedId(e.id)}
                  className="h-full min-w-[50rem]"
                />
              </div>
              {selected ? (
                <VisitPanel
                  key={`${selected.id}:${selected.version}`}
                  visit={selected}
                  now={now}
                  servicePoints={servicePoints}
                  templates={templates}
                  practitionerNames={practitionerNames}
                  autoCall={autoCall}
                  canManage={canManage}
                  canTriage={mayTriage}
                  canOpenRecord={canOpenRecord}
                  canConsult={canConsult}
                  canOpenEncounter={canOpenEncounter}
                  canRecordProcedure={canRecordProcedure}
                  pending={pending}
                  onClose={() => setSelectedId(null)}
                  onMove={(move, reason) =>
                    run(
                      () => moveVisit({ visitId: selected.id, status: move, reason, version: selected.version }),
                      `${selected.ticket}: ${QUEUE_MOVE_LABEL[move]}`,
                    )
                  }
                  onCall={(calledTo) =>
                    run(() => callVisit({ visitId: selected.id, calledTo, version: selected.version }), `${selected.ticket} called to ${calledTo}`)
                  }
                  onRoute={(servicePointId, name) =>
                    run(() => routeVisit({ visitId: selected.id, servicePointId, version: selected.version }), `${selected.ticket} sent to ${name}`)
                  }
                  onAdvance={(note) => run(() => advanceRoute({ visitId: selected.id, note, version: selected.version }), `${selected.ticket} sent on`)}
                  onSkip={(stepId, reason) =>
                    run(() => skipRouteStep({ visitId: selected.id, stepId, reason, version: selected.version }), `${selected.ticket}: step skipped`)
                  }
                  onPlan={(servicePointIds) =>
                    run(() => planRoute({ visitId: selected.id, servicePointIds, version: selected.version }), `${selected.ticket}: route saved`)
                  }
                />
              ) : (
                <p className={`self-start rounded-xl border border-dashed p-4 text-body text-muted-foreground ${PANEL_CLASS}`}>
                  Select a ticket to call the patient or move them along.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The label of a move on its button: where the patient goes, in the board's words. */
function moveButtonLabel(visit: QueueVisit, move: QueueMove): string {
  if (move === "in_triage") return visit.status === "waiting" ? "Move to Triage / Vitals" : "Send back to Triage / Vitals";
  return `Move to ${QUEUE_MOVE_LABEL[move]}`;
}

function VisitPanel({
  visit,
  now,
  servicePoints,
  templates,
  practitionerNames,
  autoCall,
  canManage,
  canTriage: mayTriage,
  canOpenRecord,
  canConsult,
  canOpenEncounter,
  canRecordProcedure,
  pending,
  onClose,
  onMove,
  onCall,
  onRoute,
  onAdvance,
  onSkip,
  onPlan,
}: {
  visit: QueueVisit;
  now: Date;
  servicePoints: ServicePoint[];
  templates: RouteTemplate[];
  practitionerNames: Record<string, string>;
  autoCall: boolean;
  canManage: boolean;
  canTriage: boolean;
  canOpenRecord: boolean;
  canConsult: boolean;
  canOpenEncounter: boolean;
  canRecordProcedure: boolean;
  pending: boolean;
  onClose: () => void;
  onMove: (move: QueueMove, reason?: string) => void;
  onCall: (calledTo: string) => void;
  onRoute: (servicePointId: string, name: string) => void;
  onAdvance: (note?: string) => void;
  onSkip: (stepId: string, reason: string) => void;
  onPlan: (servicePointIds: string[]) => void;
}) {
  const [calledTo, setCalledTo] = React.useState(visit.calledTo ?? "");
  const [sendTo, setSendTo] = React.useState("");
  const sendToPoint = servicePoints.find((s) => s.id === sendTo);
  // Where the patient may be sent from here: the facility's other active service points (never the one they are at).
  const routable = canManage && canRouteVisit(visit.status) && servicePoints.length > 0;
  const [closing, setClosing] = React.useState<QueueMove | null>(null);
  const [reason, setReason] = React.useState("");
  const moves = queueMoves(visit.status);
  const open = moves.length > 0;
  const waiting = STILL_WAITING.includes(visit.status);
  const waitMinutes = Math.max(0, Math.floor((now.getTime() - new Date(visit.checkedInAt).getTime()) / 60_000));
  const assigned = visit.assignedPractitionerId ? (practitionerNames[visit.assignedPractitionerId] ?? "Assigned provider") : "Any provider";
  const plainMoves = moves.filter((m) => !moveNeedsReason(m));

  return (
    <aside aria-label={`Ticket ${visit.ticket}`} className={`flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-4 ${PANEL_CLASS}`}>
      <div className="flex items-start gap-2">
        <span className="font-mono text-3xl font-semibold text-primary">{visit.ticket}</span>
        {visit.priority !== "routine" ? (
          <Badge className="mt-2" variant={visit.priority === "emergency" ? "critical" : "danger"}>
            {visit.priority === "emergency" ? "Emergency" : "Urgent"}
          </Badge>
        ) : visit.patient && visit.patient.age >= SENIOR_AGE ? (
          <Badge className="mt-2" variant="info">
            Senior
          </Badge>
        ) : null}
        {waiting ? <WaitPill minutes={waitMinutes} thresholds={WAIT_THRESHOLDS} className="mt-2 ml-auto" /> : null}
        <Button variant="ghost" size="icon-sm" className={waiting ? undefined : "ml-auto"} onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-col gap-3 text-body">
        <div>
          <p className="text-section font-semibold">{visit.patient?.displayName ?? "Patient"}</p>
          {visit.patient ? (
            <p className="text-table text-muted-foreground">
              <span className="font-mono">{visit.patient.patientNumber}</span> · {visit.patient.age} y · {sexLabel(visit.patient.sex)}
            </p>
          ) : null}
          {visit.chiefComplaint ? <p className="text-table text-muted-foreground">{visit.chiefComplaint}</p> : null}
          {canOpenRecord ? (
            <span className="flex flex-wrap gap-x-3">
              <Link href={`/patients/${visit.patientId}/360`} className="inline-flex items-center gap-1 text-table text-primary hover:underline">
                Patient 360 <ExternalLinkIcon className="size-3.5" aria-hidden />
              </Link>
              <Link href={`/patients/${visit.patientId}`} className="inline-flex items-center gap-1 text-table text-primary hover:underline">
                Open patient record <ExternalLinkIcon className="size-3.5" aria-hidden />
              </Link>
            </span>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-table">
          <div>
            <dt className="text-meta text-muted-foreground">Stage</dt>
            <dd className="font-medium">{visitStatusLabel(visit.status)}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Arrived</dt>
            <dd className="font-medium">{clinicalTime(visit.checkedInAt)}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Visit</dt>
            <dd className="font-medium">
              {visit.arrivalMode === "appointment" ? "Appointment" : "Walk-in"}
              {checkedInOnline(visit) ? " · online check-in" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Assigned</dt>
            <dd className="font-medium">{assigned}</dd>
          </div>
          {visit.servicePoint ? (
            <div className="col-span-2">
              <dt className="text-meta text-muted-foreground">Service point</dt>
              <dd className="font-medium">
                {visit.servicePoint.name} <span className="font-normal text-muted-foreground">· {SERVICE_POINT_KIND_LABEL[visit.servicePoint.kind]}</span>
              </dd>
            </div>
          ) : null}
          {visit.calledTo ? (
            <div className="col-span-2">
              <dt className="text-meta text-muted-foreground">Called to</dt>
              <dd className="font-medium">
                {visit.calledTo}
                {visit.calledAt ? ` at ${clinicalTime(visit.calledAt)}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>

        {visit.encounterId && canOpenEncounter ? (
          <Button asChild size="sm">
            <Link href={`/clinic/encounters/${visit.encounterId}`}>
              <StethoscopeIcon /> Open consultation
            </Link>
          </Button>
        ) : canConsult && canStartConsultation(visit.status) ? (
          <StartConsultationButton visit={visit} />
        ) : null}
        {mayTriage && canTriage(visit.status) ? (
          <Button asChild size="sm" variant={visit.status === "awaiting_consultation" ? "outline" : "default"}>
            <Link href={`/queue/visits/${visit.id}/triage`}>
              <StethoscopeIcon /> {visit.status === "awaiting_consultation" ? "Update triage" : "Triage & vitals"}
            </Link>
          </Button>
        ) : null}
        {canRecordProcedure && !["completed", "cancelled", "left_without_being_seen"].includes(visit.status) && visit.modality === "in_person" ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/queue/visits/${visit.id}/procedures`}>
              <HandIcon /> Procedures
            </Link>
          </Button>
        ) : null}
        {open ? (
          <RoutePanel
            visit={visit}
            servicePoints={servicePoints}
            templates={templates}
            canManage={canManage}
            autoCall={autoCall}
            pending={pending}
            onAdvance={onAdvance}
            onSkip={onSkip}
            onPlan={onPlan}
          />
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
            {routable ? (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sendToPoint) onRoute(sendToPoint.id, sendToPoint.name);
                }}
              >
                <div className="grid flex-1 gap-1">
                  <Label htmlFor="send-to">Send to</Label>
                  <NativeSelect
                    id="send-to"
                    value={sendTo}
                    placeholder="Choose…"
                    emptyText="No service points set up"
                    onChange={(e) => setSendTo(e.target.value)}
                  >
                    {servicePoints
                      .filter((s) => s.id !== visit.servicePointId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {SERVICE_POINT_KIND_LABEL[s.kind]}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
                <Button type="submit" variant="outline" disabled={pending || !sendToPoint}>
                  <SendIcon /> Send
                </Button>
              </form>
            ) : null}
            <div className="flex flex-col gap-2">
              {plainMoves.map((m, i) => (
                <Button key={m} variant={i === 0 ? "secondary" : "outline"} size="sm" className="w-full" disabled={pending} onClick={() => onMove(m)}>
                  {moveButtonLabel(visit, m)}
                </Button>
              ))}
              <div className="flex flex-wrap gap-2">
                {moves.filter(moveNeedsReason).map((m) => (
                  <Button key={m} variant="ghost" size="sm" disabled={pending} onClick={() => setClosing(m)} aria-pressed={closing === m}>
                    {QUEUE_MOVE_LABEL[m]}…
                  </Button>
                ))}
              </div>
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

        <section aria-label="Timeline" className="border-t pt-3">
          <h3 className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">Timeline</h3>
          <ol className="mt-2 grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 text-table">
            <li className="contents">
              <span className="tabular text-muted-foreground">{clinicalTime(visit.checkedInAt)}</span>
              <span>
                {checkedInOnline(visit)
                  ? "Checked in online in MyHealth"
                  : visit.arrivalMode === "appointment"
                    ? "Checked in for the appointment"
                    : "Checked in at the front desk"}
              </span>
            </li>
            {visit.calledTo && visit.calledAt ? (
              <li className="contents">
                <span className="tabular text-muted-foreground">{clinicalTime(visit.calledAt)}</span>
                <span>Called to {visit.calledTo}</span>
              </li>
            ) : null}
            {waiting || visit.status === "in_consultation" ? (
              <li className="contents">
                <span className="text-muted-foreground">now</span>
                <span>{waiting ? `${visitStatusLabel(visit.status)} for ${waitMinutes} min` : visitStatusLabel(visit.status)}</span>
              </li>
            ) : null}
          </ol>
        </section>
      </div>
    </aside>
  );
}
