"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { Button, Checkbox } from "@healthcare/ui/primitives";
import type { PortalDentalPlan } from "@/lib/api/types";
import { decisionSummary, feeText, selectionEstimate } from "@/lib/dental";
import { decideDentalPlan } from "./actions";

/**
 * The patient's decision on the items of a plan awaiting it: tick the treatments to go ahead with (the others are
 * declined), confirm the clinic's own statement, then send. Nothing is recorded until "Send my decision".
 */
export function PlanDecision({ plan, acknowledgement }: { plan: PortalDentalPlan; acknowledgement: string }) {
  const router = useRouter();
  const awaiting = plan.items.filter((i) => i.decision === "awaiting");
  const [accepted, setAccepted] = React.useState<Set<string>>(() => new Set());
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const toggle = (id: string) => setAccepted((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id])));

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-subtle/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await decideDentalPlan({
            planId: plan.id,
            acceptedItemIds: [...accepted],
            awaitingItemIds: awaiting.map((i) => i.id),
            estimateAwaitingDecision: plan.estimate?.awaitingDecision ?? null,
            estimateAwaitingDecisionHigh: plan.estimate?.awaitingDecisionHigh ?? null,
          });
          if (result.ok) router.refresh();
          else
            setError(
              result.code === "plan_changed"
                ? "Your dentist changed this plan since you opened it. The page shows the latest version."
                : result.code === "estimate_changed"
                  ? "The clinic's prices changed since you opened this plan. The page shows the new estimate."
                  : result.message,
            );
          if (!result.ok && (result.code === "plan_changed" || result.code === "estimate_changed")) router.refresh();
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Your decision</legend>
        <p className="text-meta text-muted-foreground">Tick the treatments you want to go ahead with. Anything you leave unticked is declined.</p>
        {awaiting.map((item) => (
          <label key={item.id} className="flex items-start gap-2 text-body">
            <Checkbox className="mt-1" checked={accepted.has(item.id)} onCheckedChange={() => toggle(item.id)} />
            <span>
              {item.procedureName}
              {plan.estimate ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {item.estimatedFee == null ? "price: ask the clinic" : `about ${feeText(item.estimatedFee, item.estimatedFeeHigh)}`}
                  {item.mayBecome?.length ? ` (may turn out to be ${item.mayBecome.join(" or ")})` : ""}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-body font-medium">{decisionSummary(awaiting, accepted)}</p>
      {plan.estimate && accepted.size ? <SelectionEstimate {...selectionEstimate(awaiting, accepted)} /> : null}
      <label className="flex items-start gap-2 rounded-md bg-card p-2 text-body">
        <Checkbox className="mt-1" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
        <span>{acknowledgement}</span>
      </label>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || !confirmed} className="h-10 gap-2 px-4">
        <CheckIcon className="size-4" aria-hidden /> Send my decision
      </Button>
      <p className="text-meta text-muted-foreground">You can still talk to your dentist before deciding. Your decision is shared with your clinic.</p>
    </form>
  );
}

function SelectionEstimate({ total, totalHigh, unpriced }: { total: number; totalHigh: number; unpriced: number }) {
  return (
    <p className="text-body">
      Estimated fee of what you accept: <span className="font-semibold">{feeText(total, totalHigh)}</span>
      {unpriced ? (
        <span className="text-muted-foreground"> plus {unpriced === 1 ? "one treatment" : `${unpriced} treatments`} without a listed price</span>
      ) : null}
    </p>
  );
}
