"use client";

import * as React from "react";
import { ArrowRightIcon, CheckCircle2Icon, CircleDotIcon, CircleIcon, ListOrderedIcon, SkipForwardIcon } from "lucide-react";
import { clinicalTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import { RouteStopsEditor } from "@/components/route-stops-editor";
import type { QueueVisit, RouteStep, ServicePoint } from "@/lib/api/types";
import { canRouteVisit, currentRouteStep, nextRouteStep, routeComplete } from "@/lib/clinic-mapping";

/**
 * The visit's route on the ticket panel (migration 0115): the stops in order with the current one marked, **Done here,
 * send on**, **Skip step…** with a reason, and the planned stops to change. The API decides everything; the buttons
 * only mirror its rules so staff are not offered what it would refuse.
 */
export function RoutePanel({
  visit,
  servicePoints,
  canManage,
  autoCall,
  pending,
  onAdvance,
  onSkip,
  onPlan,
}: {
  visit: QueueVisit;
  servicePoints: ServicePoint[];
  canManage: boolean;
  /** The facility calls the patient automatically when a route sends them on. */
  autoCall: boolean;
  pending: boolean;
  onAdvance: (note?: string) => void;
  onSkip: (stepId: string, reason: string) => void;
  onPlan: (servicePointIds: string[]) => void;
}) {
  const route = visit.route;
  const current = currentRouteStep(route);
  const next = nextRouteStep(route);
  const complete = routeComplete(route);
  const routable = canManage && canRouteVisit(visit.status) && servicePoints.length > 0;
  const [mode, setMode] = React.useState<"none" | "done" | "skip" | "plan">("none");
  const [note, setNote] = React.useState("");
  const [skipId, setSkipId] = React.useState(next?.id ?? current?.id ?? "");
  const [reason, setReason] = React.useState("");
  const [stops, setStops] = React.useState<string[]>(() => route.filter((s) => s.status === "planned").map((s) => s.servicePointId));
  const skippable = route.filter((s) => s.status === "current" || s.status === "planned");
  const after = current?.servicePointId ?? visit.servicePointId;

  if (route.length === 0 && !routable) return null;

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="text-table font-medium">Route</span>
        {complete ? <Badge variant="success">Complete</Badge> : null}
      </div>
      {route.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-1" aria-label="Route">
          {route.map((step, index) => (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 ? <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              <StepChip step={step} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-table text-muted-foreground">No route planned.</p>
      )}
      {next && !complete ? (
        <p className="text-meta text-muted-foreground">
          Next: {next.servicePoint?.name ?? "service point"}
          {autoCall ? ` — the patient will be called to ${next.servicePoint?.location ?? next.servicePoint?.name ?? "it"}` : ""}
        </p>
      ) : null}
      {routable ? (
        <div className="flex flex-wrap gap-2">
          {route.length > 0 && !complete ? (
            <Button size="sm" disabled={pending} onClick={() => setMode(mode === "done" ? "none" : "done")} aria-pressed={mode === "done"}>
              <CheckCircle2Icon /> Done here, send on
            </Button>
          ) : null}
          {skippable.length > 0 ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setMode(mode === "skip" ? "none" : "skip")} aria-pressed={mode === "skip"}>
              <SkipForwardIcon /> Skip step…
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setMode(mode === "plan" ? "none" : "plan")} aria-pressed={mode === "plan"}>
            <ListOrderedIcon /> {route.length > 0 ? "Change next stops…" : "Plan route…"}
          </Button>
        </div>
      ) : null}
      {mode === "done" ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAdvance(note.trim() || undefined);
          }}
        >
          <Label htmlFor="route-note">Note (optional)</Label>
          <Input id="route-note" value={note} maxLength={500} placeholder="e.g. CBC sample taken" onChange={(e) => setNote(e.target.value)} />
          <p className="text-meta text-muted-foreground">
            {next
              ? `Marks ${current?.servicePoint?.name ?? "this step"} done and sends the patient to ${next.servicePoint?.name ?? "the next stop"}${autoCall ? ", calling them there" : ""}.`
              : `Marks ${current?.servicePoint?.name ?? "this step"} done; it is the last stop, so the patient stays here.`}
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {next ? "Send on" : "Mark done"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {mode === "skip" ? (
        <form
          className="flex flex-col gap-2 rounded-md border border-warning/40 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (skipId && reason.trim().length >= 3) onSkip(skipId, reason.trim());
          }}
        >
          <Label htmlFor="route-skip-step">Step to skip *</Label>
          <NativeSelect id="route-skip-step" value={skipId} placeholder="Choose…" emptyText="Nothing to skip" onChange={(e) => setSkipId(e.target.value)}>
            {skippable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.servicePoint?.name ?? "Service point"}
                {s.status === "current" ? " (here now)" : ""}
              </option>
            ))}
          </NativeSelect>
          <Label htmlFor="route-skip-reason">Reason *</Label>
          <Textarea
            id="route-skip-reason"
            value={reason}
            maxLength={500}
            placeholder="Recorded on the step and in the audit trail"
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-meta text-muted-foreground">Skipping the step the patient is at sends them on to the next planned stop.</p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending || !skipId || reason.trim().length < 3}>
              Skip step
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {mode === "plan" ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (stops.length > 0) onPlan(stops);
          }}
        >
          <p className="text-meta text-muted-foreground">
            The stops after {after ? (servicePoints.find((s) => s.id === after)?.name ?? "the current one") : "the consultation line"}, in order. Replaces the
            planned stops; what is done stays.
          </p>
          <RouteStopsEditor id="route-plan-stop" servicePoints={servicePoints} stops={stops} after={after} disabled={pending} onChange={setStops} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || stops.length === 0}>
              Save route
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** One stop: its name and state — colour, icon and text together, never colour alone. */
function StepChip({ step }: { step: RouteStep }) {
  const name = step.servicePoint?.name ?? "Service point";
  const title = step.note ? `${name}: ${step.note}` : step.completedAt ? `${name}, ${clinicalTime(step.completedAt)}` : name;
  switch (step.status) {
    case "done":
      return (
        <Badge variant="success" title={title}>
          <CheckCircle2Icon aria-hidden /> {name}
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="neutral" title={title} className="line-through">
          <SkipForwardIcon aria-hidden /> {name}
        </Badge>
      );
    case "current":
      return (
        <Badge variant="info" title={title} aria-current="step">
          <CircleDotIcon aria-hidden /> {name} · here
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" title={title}>
          <CircleIcon aria-hidden /> {name}
        </Badge>
      );
  }
}
