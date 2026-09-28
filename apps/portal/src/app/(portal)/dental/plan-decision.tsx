"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import type { PortalDentalPlan } from "@/lib/api/types";
import { decisionSummary } from "@/lib/dental";
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
          const result = await decideDentalPlan({ planId: plan.id, acceptedItemIds: [...accepted], awaitingItemIds: awaiting.map((i) => i.id) });
          if (result.ok) router.refresh();
          else
            setError(
              result.code === "plan_changed" ? "Your dentist changed this plan since you opened it. The page shows the latest version." : result.message,
            );
          if (!result.ok && result.code === "plan_changed") router.refresh();
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Your decision</legend>
        <p className="text-meta text-muted-foreground">Tick the treatments you want to go ahead with. Anything you leave unticked is declined.</p>
        {awaiting.map((item) => (
          <label key={item.id} className="flex items-start gap-2 text-body">
            <input type="checkbox" className="mt-1 size-4" checked={accepted.has(item.id)} onChange={() => toggle(item.id)} />
            <span>{item.procedureName}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-body font-medium">{decisionSummary(awaiting, accepted)}</p>
      <label className="flex items-start gap-2 rounded-md bg-card p-2 text-body">
        <input type="checkbox" className="mt-1 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{acknowledgement}</span>
      </label>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !confirmed}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-body font-medium text-primary-foreground disabled:opacity-60"
      >
        <CheckIcon className="size-4" aria-hidden /> Send my decision
      </button>
      <p className="text-meta text-muted-foreground">You can still talk to your dentist before deciding. Your decision is shared with your clinic.</p>
    </form>
  );
}
