"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DateInput, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { CareActivityKind, CareGoalStatus, CarePlanDetail } from "@/lib/api/types";
import {
  CATEGORY_LABEL,
  GOAL_STATUS_LABEL,
  KIND_LABEL,
  PLAN_STATUS_LABEL,
  planChangeNeedsReason,
  type PlanTarget,
  planTransitions,
} from "@/lib/care-plan-form";
import { CareActivityItem, type FollowUpContext } from "../../encounters/[id]/care-plans-panel";
import { addCareActivity, addProgressNote, changeCarePlanStatus, updateCareGoal } from "../actions";

const STATUS_ACTION: Record<PlanTarget, string> = {
  active: "Resume",
  on_hold: "Put on hold",
  completed: "Mark completed",
  cancelled: "Cancel plan",
};

export function CarePlanView({
  plan,
  followUp,
  canManage,
  canBook,
  canOpenEncounter,
}: {
  plan: CarePlanDetail;
  followUp: FollowUpContext;
  canManage: boolean;
  canBook: boolean;
  canOpenEncounter: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [changing, setChanging] = React.useState<PlanTarget | null>(null);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const open = plan.status === "active" || plan.status === "on_hold";
  const openActivities = plan.activities.filter((a) => a.status !== "completed" && a.status !== "cancelled");
  const closedActivities = plan.activities.filter((a) => a.status === "completed" || a.status === "cancelled");

  const run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });

  const changeStatus = (to: PlanTarget, why?: string) =>
    run(
      () => changeCarePlanStatus({ carePlanId: plan.id, status: to, reason: why, version: plan.version }),
      `Care plan ${PLAN_STATUS_LABEL[to].toLowerCase()}`,
      () => {
        setChanging(null);
        setReason("");
      },
    );

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{plan.title}</CardTitle>
            <Badge>{CATEGORY_LABEL[plan.category]}</Badge>
            <Badge variant={plan.status === "active" ? "success" : plan.status === "completed" ? "info" : "warning"}>{PLAN_STATUS_LABEL[plan.status]}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-body">
            <p className="text-table text-muted-foreground">
              Since {clinicalDate(plan.startDate)}
              {plan.endDate ? ` · until ${clinicalDate(plan.endDate)}` : ""}
              {plan.sourceEncounterId && canOpenEncounter ? (
                <>
                  {" · "}
                  <Link href={`/clinic/encounters/${plan.sourceEncounterId}`} className="text-primary hover:underline">
                    source encounter
                  </Link>
                </>
              ) : null}
            </p>
            {plan.description ? <p className="whitespace-pre-wrap">{plan.description}</p> : null}
            {plan.statusReason ? <p className="text-table text-muted-foreground">Status reason: {plan.statusReason}</p> : null}
            {plan.problems.length ? (
              <p className="text-table">
                <span className="text-muted-foreground">Problems: </span>
                {plan.problems.map((p) => p.description).join("; ")}
              </p>
            ) : null}
            {canManage && planTransitions(plan.status).length ? (
              <div className="flex flex-wrap gap-2 border-t pt-2">
                {planTransitions(plan.status).map((to) => (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === "cancelled" ? "ghost" : "outline"}
                    disabled={pending}
                    onClick={() => (planChangeNeedsReason(to) ? setChanging(to) : changeStatus(to))}
                  >
                    {STATUS_ACTION[to]}
                    {planChangeNeedsReason(to) ? "…" : ""}
                  </Button>
                ))}
              </div>
            ) : null}
            {changing ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  changeStatus(changing, reason);
                }}
              >
                <div className="grid min-w-64 flex-1 gap-1">
                  <Label htmlFor="plan-reason">Reason *</Label>
                  <Input id="plan-reason" autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <Button type="submit" size="sm" variant={changing === "cancelled" ? "destructive" : "default"} disabled={pending || reason.trim().length < 3}>
                  {STATUS_ACTION[changing]}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChanging(null)}>
                  Back
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Goals</CardTitle>
          </CardHeader>
          <CardContent>
            {plan.goals.length === 0 ? <p className="text-table text-muted-foreground">No goals.</p> : null}
            <ul className="flex flex-col gap-1.5">
              {plan.goals.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 text-table">
                  <span className="font-medium">{g.description}</span>
                  {g.targetMeasure || g.targetValue ? (
                    <span className="text-muted-foreground">{[g.targetMeasure, g.targetValue].filter(Boolean).join(" ")}</span>
                  ) : null}
                  {g.targetDate ? <span className="tabular text-muted-foreground">by {clinicalDate(g.targetDate)}</span> : null}
                  {canManage && open ? (
                    <NativeSelect
                      aria-label={`Status of goal ${g.description}`}
                      className="ml-auto w-40"
                      value={g.status}
                      disabled={pending}
                      onChange={(e) =>
                        run(
                          () => updateCareGoal({ carePlanId: plan.id, goalId: g.id, status: e.target.value as CareGoalStatus }),
                          `Goal: ${GOAL_STATUS_LABEL[e.target.value as CareGoalStatus]}`,
                        )
                      }
                    >
                      {Object.entries(GOAL_STATUS_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Badge className="ml-auto">{GOAL_STATUS_LABEL[g.status]}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activities</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {openActivities.length === 0 ? <p className="text-table text-muted-foreground">No open activities.</p> : null}
            <ul className="flex flex-col gap-1.5">
              {openActivities.map((a) => (
                <CareActivityItem
                  key={a.id}
                  planId={plan.id}
                  planStatus={plan.status}
                  activity={a}
                  followUp={followUp}
                  canManage={canManage}
                  canBook={canBook}
                />
              ))}
            </ul>
            {canManage && open ? <AddActivityForm plan={plan} today={followUp.today} /> : null}
            {closedActivities.length ? (
              <details>
                <summary className="cursor-pointer text-table text-muted-foreground">Completed and cancelled ({closedActivities.length})</summary>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {closedActivities.map((a) => (
                    <CareActivityItem key={a.id} planId={plan.id} planStatus={plan.status} activity={a} followUp={followUp} canManage={false} canBook={false} />
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="self-start">
        <CardHeader>
          <CardTitle>Progress notes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canManage && plan.status !== "cancelled" ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => addProgressNote({ carePlanId: plan.id, note }),
                  "Progress note added",
                  () => setNote(""),
                );
              }}
            >
              <Label htmlFor="progress-note">New note</Label>
              <Textarea id="progress-note" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="submit" size="sm" className="self-end" disabled={pending || !note.trim()}>
                Add note
              </Button>
            </form>
          ) : null}
          {plan.progressNotes.length === 0 ? <p className="text-table text-muted-foreground">No progress notes yet.</p> : null}
          <ol className="flex flex-col gap-2">
            {plan.progressNotes.map((n) => (
              <li key={n.id} className="rounded-md border p-2 text-table">
                <p className="tabular text-meta text-muted-foreground">{clinicalDateTime(n.recordedAt)}</p>
                <p className="whitespace-pre-wrap">{n.note}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function AddActivityForm({ plan, today }: { plan: CarePlanDetail; today: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<CareActivityKind>("follow_up_appointment");
  const [description, setDescription] = React.useState("");
  const [assignee, setAssignee] = React.useState<"patient" | "care_team">("care_team");
  const [dueDate, setDueDate] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const [goalId, setGoalId] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  if (!open) {
    return (
      <div>
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
          <PlusIcon /> Add activity
        </Button>
      </div>
    );
  }
  const repeatDays = repeat.trim() ? Number(repeat) : undefined;
  const repeatValid = repeatDays === undefined || (Number.isInteger(repeatDays) && repeatDays >= 1 && repeatDays <= 730);
  return (
    <form
      className="grid gap-2 rounded-md border p-2 sm:grid-cols-12"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await addCareActivity({
            carePlanId: plan.id,
            kind,
            description,
            assignee,
            dueDate: dueDate || undefined,
            recurrenceIntervalDays: repeatDays,
            goalId: goalId || undefined,
          });
          if (result.ok) {
            toast.success("Activity added");
            setOpen(false);
            setDescription("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <NativeSelect aria-label="Kind" className="sm:col-span-3" value={kind} onChange={(e) => setKind(e.target.value as CareActivityKind)}>
        {Object.entries(KIND_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label="Activity"
        className="sm:col-span-5"
        maxLength={500}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the activity"
      />
      <NativeSelect aria-label="Assignee" className="sm:col-span-2" value={assignee} onChange={(e) => setAssignee(e.target.value as "patient" | "care_team")}>
        <option value="care_team">Care team</option>
        <option value="patient">Patient</option>
      </NativeSelect>
      <NativeSelect
        emptyText="This plan has no goals yet"
        aria-label="Goal"
        className="sm:col-span-2"
        value={goalId}
        onChange={(e) => setGoalId(e.target.value)}
      >
        <option value="">No goal</option>
        {plan.goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.description}
          </option>
        ))}
      </NativeSelect>
      <div className="flex items-center gap-1.5 sm:col-span-5">
        <Label htmlFor="new-act-due" className="text-meta">
          Due
        </Label>
        <DateInput id="new-act-due" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <div className="flex items-center gap-1.5 sm:col-span-4">
        <Label htmlFor="new-act-repeat" className="text-meta whitespace-nowrap">
          Repeat every
        </Label>
        <Input
          id="new-act-repeat"
          inputMode="numeric"
          className="w-16"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          aria-invalid={!repeatValid}
        />
        <span className="text-meta text-muted-foreground">days</span>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !description.trim() || !repeatValid}>
          Add
        </Button>
      </div>
    </form>
  );
}
