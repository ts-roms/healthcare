"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon, CheckIcon } from "lucide-react";
import { Button, Input, toast } from "@healthcare/ui/primitives";
import type { CareActivityKind, CareActivityStatus } from "@/lib/api/types";
import { activityActions } from "@/lib/care-plan-form";
import { updateCareActivity } from "./actions";

/** Book / Done / Cancel for one recall row; booking returns here and links the appointment to the activity. */
export function RecallActions({
  activity: a,
  today,
  canManage,
  canBook,
}: {
  activity: {
    id: string;
    carePlanId: string;
    patientId: string;
    kind: CareActivityKind;
    status: CareActivityStatus;
    description: string;
    dueDate: string | null;
  };
  today: string;
  canManage: boolean;
  canBook: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  // The recall list only shows activities of active plans.
  const actions = activityActions({ ...a, assignee: "care_team" }, { planStatus: "active", canManage, canBook });

  const set = (status: "completed" | "cancelled") =>
    startTransition(async () => {
      const result = await updateCareActivity({ carePlanId: a.carePlanId, activityId: a.id, status, reason: status === "cancelled" ? reason : undefined });
      if (result.ok) {
        toast.success(status === "completed" ? `Done: ${a.description}` : `Cancelled: ${a.description}`);
        setCancelling(false);
        router.refresh();
      } else toast.error(result.message);
    });

  if (cancelling) {
    return (
      <form
        className="flex items-center justify-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          set("cancelled");
        }}
      >
        <Input
          aria-label="Reason for cancelling"
          autoFocus
          className="h-7 w-48"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
        />
        <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
          Cancel activity
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setCancelling(false)}>
          Keep
        </Button>
      </form>
    );
  }
  const query = new URLSearchParams({
    patientId: a.patientId,
    returnTo: "/clinic/care-plans",
    reason: a.description,
    carePlanId: a.carePlanId,
    activityId: a.id,
  });
  if (a.dueDate && a.dueDate >= today) query.set("date", a.dueDate);
  return (
    <span className="flex justify-end gap-1">
      {actions.includes("book") ? (
        <Button asChild size="xs" variant="outline">
          <Link href={`/appointments/new?${query}`}>
            <CalendarPlusIcon /> Book
          </Link>
        </Button>
      ) : null}
      {actions.includes("complete") ? (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => set("completed")}>
          <CheckIcon /> Done
        </Button>
      ) : null}
      {actions.includes("cancel") ? (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => setCancelling(true)}>
          Cancel…
        </Button>
      ) : null}
    </span>
  );
}
