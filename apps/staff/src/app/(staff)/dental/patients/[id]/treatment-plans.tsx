"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, PrinterIcon, Trash2Icon } from "lucide-react";
import type { ToothNotation } from "@healthcare/domain";
import { clinicalDate } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import type { DentalPlanEstimate, DentalProcedureType, DentalTreatmentPlan } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { PLAN_ITEM_STATUS, PLAN_STATUS } from "@/lib/dental-mapping";
import { fileHref } from "@/lib/files";
import { cancelPlanItem, createTreatmentPlan, decideTreatmentPlan, discontinueTreatmentPlan } from "../../actions";
import { emptySelection, itemLabel, ProcedureFields, type ProcedureSelection, selectionComplete, selectionPayload } from "./procedure-fields";

type Draft = ProcedureSelection & { phase: number; note: string };

/**
 * Treatment plans: phased items proposed by the dentist, accepted or declined by the patient item by item, and done
 * when a procedure carries them out. Fees are billing's: an open plan shows a fee estimate of the work still ahead at
 * today's listed prices (and each decided item the estimate recorded with the decision), printable for the patient.
 */
export function TreatmentPlans({
  patientId,
  plans,
  types,
  notation,
  canManage,
  estimates = {},
}: {
  patientId: string;
  plans: DentalTreatmentPlan[];
  types: DentalProcedureType[];
  notation: ToothNotation;
  canManage: boolean;
  /** By plan id, for plans with work still ahead. */
  estimates?: Record<string, DentalPlanEstimate>;
}) {
  const [creating, setCreating] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Treatment plans</CardTitle>
        {canManage && !creating ? (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setCreating(true)}>
            <PlusIcon /> New plan
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {creating ? <NewPlan patientId={patientId} types={types} notation={notation} onDone={() => setCreating(false)} /> : null}
        {plans.length === 0 && !creating ? <p className="text-body text-muted-foreground">No treatment plans.</p> : null}
        {plans.map((plan) => (
          <PlanCard key={plan.id} patientId={patientId} plan={plan} notation={notation} canManage={canManage} estimate={estimates[plan.id]} />
        ))}
      </CardContent>
    </Card>
  );
}

function NewPlan({ patientId, types, notation, onDone }: { patientId: string; types: DentalProcedureType[]; notation: ToothNotation; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [items, setItems] = React.useState<Draft[]>([{ ...emptySelection, phase: 1, note: "" }]);
  const [key] = React.useState(() => crypto.randomUUID());
  const [pending, startTransition] = React.useTransition();
  const complete = items.every((i) =>
    selectionComplete(
      i,
      types.find((t) => t.id === i.procedureTypeId),
    ),
  );
  const submit = () =>
    startTransition(async () => {
      const result = await createTreatmentPlan(
        {
          patientId,
          title,
          items: items.map((i) => ({
            ...selectionPayload(
              i,
              types.find((t) => t.id === i.procedureTypeId),
            ),
            phase: i.phase,
            note: i.note.trim() || undefined,
          })),
        },
        key,
      );
      if (result.ok) {
        toast.success("Treatment plan proposed");
        onDone();
        router.refresh();
      } else toast.error(result.message);
    });
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-title">Title</Label>
        <Input id="plan-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Restorative phase and hygiene" />
      </div>
      {items.map((item, index) => (
        <div key={index} className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="flex w-20 flex-col gap-1.5">
            <Label htmlFor={`plan-item-${index}-phase`}>Phase</Label>
            <NativeSelect
              id={`plan-item-${index}-phase`}
              value={item.phase}
              onChange={(e) => setItems((list) => list.map((x, i) => (i === index ? { ...x, phase: Number(e.target.value) } : x)))}
            >
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex-1">
            <ProcedureFields
              id={`plan-item-${index}`}
              types={types}
              notation={notation}
              value={item}
              onChange={(v) => setItems((list) => list.map((x, i) => (i === index ? { ...x, ...v } : x)))}
            />
          </div>
          <div className="flex w-48 flex-col gap-1.5">
            <Label htmlFor={`plan-item-${index}-note`}>Note</Label>
            <Input
              id={`plan-item-${index}-note`}
              value={item.note}
              maxLength={500}
              onChange={(e) => setItems((list) => list.map((x, i) => (i === index ? { ...x, note: e.target.value } : x)))}
            />
          </div>
          {items.length > 1 ? (
            <Button size="sm" variant="ghost" aria-label={`Remove item ${index + 1}`} onClick={() => setItems((list) => list.filter((_, i) => i !== index))}>
              <Trash2Icon />
            </Button>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setItems((list) => [...list, { ...emptySelection, phase: list.at(-1)?.phase ?? 1, note: "" }])}>
          <PlusIcon /> Add item
        </Button>
        <Button size="sm" onClick={submit} disabled={pending || !title.trim() || !complete}>
          Propose plan
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PlanCard({
  patientId,
  plan,
  notation,
  canManage,
  estimate,
}: {
  patientId: string;
  plan: DentalTreatmentPlan;
  notation: ToothNotation;
  canManage: boolean;
  estimate?: DentalPlanEstimate;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const awaiting = plan.items.filter((i) => i.status === "proposed");
  const [accepted, setAccepted] = React.useState<Set<string>>(() => new Set(awaiting.map((i) => i.id)));
  const [note, setNote] = React.useState("");
  const [stopReason, setStopReason] = React.useState<string | null>(null);
  const open = plan.status === "proposed" || plan.status === "accepted" || plan.status === "in_progress";
  const status = PLAN_STATUS[plan.status];

  const act = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <section className="rounded-md border" aria-label={`Treatment plan ${plan.title}`}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h3 className="font-semibold">{plan.title}</h3>
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="ml-auto text-meta text-muted-foreground">
          {clinicalDate(plan.createdAt)}
          {plan.practitionerName ? ` · ${plan.practitionerName}` : ""}
        </span>
      </div>
      <ul className="divide-y text-table">
        {plan.items.map((item) => {
          const itemStatus = PLAN_ITEM_STATUS[item.status];
          const line = estimate?.items.find((e) => e.itemId === item.id);
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              {canManage && awaiting.length && item.status === "proposed" ? (
                <Checkbox
                  checked={accepted.has(item.id)}
                  onCheckedChange={(v) =>
                    setAccepted((s) => {
                      const next = new Set(s);
                      if (v) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                  aria-label={`Patient accepts ${item.procedure?.name ?? "item"}`}
                />
              ) : null}
              <span className="w-16 text-meta text-muted-foreground">Phase {item.phase}</span>
              <span className="min-w-0 flex-1">
                {itemLabel(item.procedure?.name ?? "Procedure", item.tooth, item.surfaces, notation)}
                {item.note ? <span className="text-muted-foreground"> · {item.note}</span> : null}
                {item.decisionEstimateOn ? (
                  <span className="block text-meta text-muted-foreground">
                    Estimate at decision: {item.decisionEstimate == null ? "no listed price" : peso(item.decisionEstimate)} (
                    {clinicalDate(item.decisionEstimateOn)})
                  </span>
                ) : null}
              </span>
              {line?.part ? (
                <span className="text-right tabular-nums" title={line.listed ? `${line.listed.serviceCode} · ${line.listed.serviceName}` : undefined}>
                  {line.listed ? peso(line.listed.unitPrice) : <span className="text-meta text-warning-foreground">No listed price</span>}
                </span>
              ) : null}
              <Badge variant={itemStatus.variant}>{itemStatus.label}</Badge>
              {canManage && open && (item.status === "proposed" || item.status === "accepted") ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => act(() => cancelPlanItem(patientId, plan.id, item.id, plan.version), "Item cancelled")}
                >
                  Cancel item
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {estimate ? <EstimateSummary planId={plan.id} estimate={estimate} /> : null}
      {plan.decisionNote ? (
        <p className="border-t px-3 py-1.5 text-meta text-muted-foreground">
          {plan.decisionChannel === "portal" ? "Decided by the patient in MyHealth" : "Patient's decision"}
          {plan.decidedAt ? ` (${clinicalDate(plan.decidedAt)})` : ""}
          {plan.decisionChannel === "portal" ? `, confirming: “${plan.decisionNote}”` : `: ${plan.decisionNote}`}
        </p>
      ) : null}
      {plan.discontinuedReason ? <p className="border-t px-3 py-1.5 text-meta text-muted-foreground">Discontinued: {plan.discontinuedReason}</p> : null}
      {canManage && awaiting.length ? (
        <div className="flex flex-wrap items-end gap-2 border-t px-3 py-2">
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <Label htmlFor={`decision-${plan.id}`}>Patient&apos;s decision (ticked items accepted, others declined)</Label>
            <Input
              id={`decision-${plan.id}`}
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How the patient decided, e.g. options and fees explained; consent form signed"
            />
          </div>
          <Button
            size="sm"
            disabled={pending || note.trim().length < 3}
            onClick={() =>
              act(
                () => decideTreatmentPlan(patientId, plan.id, { acceptedItemIds: [...accepted], note, version: plan.version }),
                accepted.size ? "Decision recorded" : "Plan declined",
              )
            }
          >
            Record decision
          </Button>
        </div>
      ) : null}
      {canManage && (plan.status === "accepted" || plan.status === "in_progress") ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          {stopReason === null ? (
            <Button size="xs" variant="ghost" onClick={() => setStopReason("")}>
              Discontinue plan…
            </Button>
          ) : (
            <>
              <Input
                aria-label="Why is the plan discontinued?"
                className="h-7 w-72"
                placeholder="Reason (e.g. patient transferred to another clinic)"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
              />
              <Button
                size="xs"
                variant="destructive"
                disabled={pending || stopReason.trim().length < 5}
                onClick={() => act(() => discontinueTreatmentPlan(patientId, plan.id, stopReason, plan.version), "Plan discontinued")}
              >
                Discontinue
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setStopReason(null)}>
                Keep plan
              </Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The fee estimate of the work still ahead: totals at today's listed prices, what it is not, and the printable copy. */
function EstimateSummary({ planId, estimate }: { planId: string; estimate: DentalPlanEstimate }) {
  const { totals } = estimate;
  return (
    <div className="flex flex-col gap-1 border-t bg-muted/40 px-3 py-2" aria-label="Fee estimate">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-medium">Fee estimate</span>
        {totals.awaitingDecision ? <span className="text-meta">Awaiting decision {peso(totals.awaitingDecision)}</span> : null}
        {totals.accepted ? <span className="text-meta">Accepted, not yet done {peso(totals.accepted)}</span> : null}
        <span className="font-semibold tabular-nums">Total {peso(totals.remaining)}</span>
        <Button asChild size="xs" variant="outline" className="ml-auto">
          <a href={fileHref.dentalEstimate(planId)} target="_blank" rel="noreferrer">
            <PrinterIcon /> Print estimate
          </a>
        </Button>
      </div>
      {totals.unpricedItems ? (
        <p className="text-meta text-warning-foreground">
          {totals.unpricedItems} item{totals.unpricedItems === 1 ? " has" : "s have"} no listed price and {totals.unpricedItems === 1 ? "is" : "are"} not in the
          total — map the procedure code to a billing service with a price (billing settings).
        </p>
      ) : null}
      <p className="text-meta text-muted-foreground">
        Listed prices on {clinicalDate(estimate.pricedOn)}. {estimate.disclaimer}
      </p>
      {estimate.note ? <p className="text-meta text-muted-foreground">{estimate.note}</p> : null}
    </div>
  );
}
