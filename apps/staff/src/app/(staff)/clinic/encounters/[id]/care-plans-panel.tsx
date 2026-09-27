"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CalendarPlusIcon, CheckIcon, ClipboardListIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { clinicalDate } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Textarea,
  toast,
} from "@healthcare/ui/primitives";
import type { CareActivity, CareActivityKind, CarePlanCategory, CarePlanDetail, CarePlanStatus } from "@/lib/api/types";
import {
  ACTIVITY_STATUS_LABEL,
  activityActions,
  type ActivityForm,
  addDays,
  blankActivity,
  blankGoal,
  buildCarePlanPayload,
  CATEGORY_LABEL,
  type GoalForm,
  isOverdue,
  KIND_LABEL,
  PLAN_STATUS_LABEL,
} from "@/lib/care-plan-form";
import { createCarePlan, updateCareActivity } from "../../care-plans/actions";

export interface FollowUpContext {
  patientId: string;
  practitionerId: string;
  /** Where booking returns to (this encounter). */
  returnTo: string;
  today: string;
}

/** Link to the booking page for a follow-up, returning to the encounter; optionally linked to a care-plan activity. */
export function followUpHref(ctx: FollowUpContext, options: { date?: string; reason?: string; carePlanId?: string; activityId?: string } = {}): string {
  const query = new URLSearchParams({ patientId: ctx.patientId, practitionerId: ctx.practitionerId, returnTo: ctx.returnTo });
  for (const [k, v] of Object.entries(options)) if (v) query.set(k, v);
  return `/appointments/new?${query}`;
}

export function CarePlansPanel({
  plans,
  followUp,
  encounterId,
  diagnoses,
  canManage,
  canBook,
}: {
  /** Open care plans with details; null: the user may not read care plans. */
  plans: CarePlanDetail[] | null;
  followUp: FollowUpContext;
  encounterId: string;
  /** Active diagnoses of this encounter, offered as the plan's problems. */
  diagnoses: Array<{ id: string; label: string }>;
  canManage: boolean;
  canBook: boolean;
}) {
  const [creating, setCreating] = React.useState(false);

  if (plans === null) return null;

  return (
    <section aria-labelledby="cp-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 id="cp-heading" className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          Care plans
        </h3>
        {canManage ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => setCreating(true)}>
            <PlusIcon /> New care plan
          </Button>
        ) : null}
      </div>
      {plans.length === 0 ? <p className="text-table text-muted-foreground">No open care plan.</p> : null}
      <ul className="flex flex-col gap-2">
        {plans.map((plan) => {
          const open = plan.activities.filter((a) => a.status !== "completed" && a.status !== "cancelled");
          return (
            <li key={plan.id} className="rounded-md border bg-card px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <ClipboardListIcon className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">{plan.title}</span>
                <Badge>{CATEGORY_LABEL[plan.category]}</Badge>
                <Badge variant={plan.status === "active" ? "success" : "warning"}>{PLAN_STATUS_LABEL[plan.status]}</Badge>
                <Link href={`/clinic/care-plans/${plan.id}`} className="ml-auto text-table text-primary hover:underline">
                  Open plan
                </Link>
              </div>
              {plan.goals.length ? (
                <p className="mt-1 text-table text-muted-foreground">
                  Goals: {plan.goals.map((g) => [g.description, g.targetValue].filter(Boolean).join(" ")).join("; ")}
                </p>
              ) : null}
              <ul className="mt-1.5 flex flex-col gap-1">
                {open.length === 0 ? <li className="text-table text-muted-foreground">No open activities.</li> : null}
                {open.map((a) => (
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
            </li>
          );
        })}
      </ul>
      {creating ? (
        <NewCarePlanDialog
          patientId={followUp.patientId}
          encounterId={encounterId}
          today={followUp.today}
          diagnoses={diagnoses}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  );
}

/** One care-plan activity with its actions (book a follow-up, done, cancel with reason). */
export function CareActivityItem({
  planId,
  planStatus,
  activity: a,
  followUp,
  canManage,
  canBook,
}: {
  planId: string;
  planStatus: CarePlanStatus;
  activity: CareActivity;
  followUp: FollowUpContext;
  canManage: boolean;
  canBook: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const actions = activityActions(a, { planStatus, canManage, canBook });
  const closed = a.status === "completed" || a.status === "cancelled";

  const setStatus = (status: "completed" | "cancelled") =>
    startTransition(async () => {
      const result = await updateCareActivity({ carePlanId: planId, activityId: a.id, status, reason: status === "cancelled" ? reason : undefined });
      if (result.ok) {
        toast.success(status === "completed" ? `Done: ${a.description}` : `Cancelled: ${a.description}`, {
          description: status === "completed" && a.recurrenceIntervalDays ? `The next one is due in ${a.recurrenceIntervalDays} days.` : undefined,
        });
        setCancelling(false);
        setReason("");
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <li className="text-table">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">{KIND_LABEL[a.kind]}</Badge>
        <span className={closed ? "text-muted-foreground" : ""}>{a.description}</span>
        <span className="text-meta text-muted-foreground">{a.assignee === "patient" ? "patient" : "care team"}</span>
        {a.dueDate ? <span className="tabular text-muted-foreground">due {clinicalDate(a.dueDate)}</span> : null}
        {a.recurrenceIntervalDays ? <span className="text-muted-foreground">· every {a.recurrenceIntervalDays} d</span> : null}
        {isOverdue(a, followUp.today) ? (
          <Badge variant="danger">
            <AlertTriangleIcon aria-hidden /> Overdue
          </Badge>
        ) : null}
        {a.status !== "planned" ? <Badge variant={a.status === "completed" ? "success" : "info"}>{ACTIVITY_STATUS_LABEL[a.status]}</Badge> : null}
        <span className="ml-auto flex gap-1">
          {actions.includes("book") ? (
            <Button asChild size="xs" variant="outline">
              <Link
                href={followUpHref(followUp, {
                  date: a.dueDate && a.dueDate >= followUp.today ? a.dueDate : undefined,
                  reason: a.description,
                  carePlanId: planId,
                  activityId: a.id,
                })}
              >
                <CalendarPlusIcon /> Book
              </Link>
            </Button>
          ) : null}
          {actions.includes("complete") ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => setStatus("completed")}>
              <CheckIcon /> Done
            </Button>
          ) : null}
          {actions.includes("cancel") ? (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => setCancelling(true)}>
              Cancel…
            </Button>
          ) : null}
        </span>
      </div>
      {a.statusReason ? <p className="text-meta text-muted-foreground">Reason: {a.statusReason}</p> : null}
      {cancelling ? (
        <form
          className="mt-1 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("cancelled");
          }}
        >
          <div className="grid min-w-56 flex-1 gap-1">
            <Label htmlFor={`act-cancel-${a.id}`}>Why cancel? *</Label>
            <Input id={`act-cancel-${a.id}`} autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
            Cancel activity
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(false)}>
            Keep
          </Button>
        </form>
      ) : null}
    </li>
  );
}

function NewCarePlanDialog({
  patientId,
  encounterId,
  today,
  diagnoses,
  onClose,
}: {
  patientId: string;
  encounterId: string;
  today: string;
  diagnoses: Array<{ id: string; label: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState<CarePlanCategory>("chronic_disease");
  const [description, setDescription] = React.useState("");
  const [startDate, setStartDate] = React.useState(today);
  // Every active diagnosis is a problem unless unticked (also those that arrive after the dialog opened).
  const [excludedProblems, setExcludedProblems] = React.useState<Set<string>>(() => new Set());
  const [goals, setGoals] = React.useState<GoalForm[]>(() => [blankGoal()]);
  const [activities, setActivities] = React.useState<ActivityForm[]>(() => [blankActivity()]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [attemptKey, setAttemptKey] = React.useState(() => crypto.randomUUID());

  const setGoal = (key: string, change: Partial<GoalForm>) => setGoals((gs) => gs.map((g) => (g.key === key ? { ...g, ...change } : g)));
  const setActivity = (key: string, change: Partial<ActivityForm>) => setActivities((as) => as.map((a) => (a.key === key ? { ...a, ...change } : a)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const built = buildCarePlanPayload({
      title,
      category,
      description,
      startDate,
      endDate: "",
      problems: diagnoses.filter((d) => !excludedProblems.has(d.id)).map((d) => ({ diagnosisId: d.id, description: d.label })),
      goals,
      activities,
    });
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createCarePlan({ patientId, sourceEncounterId: encounterId, plan: built.payload }, attemptKey);
      setAttemptKey(crypto.randomUUID());
      if (result.ok) {
        toast.success(`Care plan created: ${result.data.title}`);
        onClose();
        router.refresh();
      } else setError(result.message);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>New care plan</DialogTitle>
          <DialogDescription>
            Goals and planned activities for this patient, linked to this encounter. Follow-up visits can be booked from the plan.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={pending} className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-6">
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor="cp-title">Title *</Label>
                <Input
                  id="cp-title"
                  autoFocus
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Type 2 diabetes care plan"
                />
              </div>
              <div className="grid gap-1 sm:col-span-2">
                <Label htmlFor="cp-category">Category</Label>
                <NativeSelect id="cp-category" value={category} onChange={(e) => setCategory(e.target.value as CarePlanCategory)}>
                  {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1 sm:col-span-1">
                <Label htmlFor="cp-start">Start</Label>
                <Input id="cp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="grid gap-1 sm:col-span-6">
                <Label htmlFor="cp-description">Description</Label>
                <Textarea id="cp-description" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>

            <section className="flex flex-col gap-1">
              <h4 className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">Problems</h4>
              {diagnoses.length ? (
                diagnoses.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-table">
                    <Checkbox
                      checked={!excludedProblems.has(d.id)}
                      onCheckedChange={(v) =>
                        setExcludedProblems((s) => {
                          const n = new Set(s);
                          if (v) n.delete(d.id);
                          else n.add(d.id);
                          return n;
                        })
                      }
                    />
                    {d.label}
                  </label>
                ))
              ) : (
                <p className="text-table text-muted-foreground">No active diagnosis on this encounter; add one first to link it as a problem.</p>
              )}
            </section>

            <section className="flex flex-col gap-1.5">
              <h4 className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">Goals</h4>
              {goals.map((g, i) => (
                <div key={g.key} className="grid gap-2 sm:grid-cols-12">
                  <Input
                    aria-label={`Goal ${i + 1}`}
                    className="sm:col-span-5"
                    maxLength={500}
                    value={g.description}
                    onChange={(e) => setGoal(g.key, { description: e.target.value })}
                    placeholder="e.g. Glycaemic control"
                  />
                  <Input
                    aria-label={`Goal ${i + 1} measure`}
                    className="sm:col-span-2"
                    maxLength={120}
                    value={g.targetMeasure}
                    onChange={(e) => setGoal(g.key, { targetMeasure: e.target.value })}
                    placeholder="Measure (HbA1c)"
                  />
                  <Input
                    aria-label={`Goal ${i + 1} target`}
                    className="sm:col-span-2"
                    maxLength={120}
                    value={g.targetValue}
                    onChange={(e) => setGoal(g.key, { targetValue: e.target.value })}
                    placeholder="Target (< 7%)"
                  />
                  <Input
                    aria-label={`Goal ${i + 1} target date`}
                    className="sm:col-span-2"
                    type="date"
                    value={g.targetDate}
                    onChange={(e) => setGoal(g.key, { targetDate: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove goal ${i + 1}`}
                    onClick={() => {
                      setGoals((gs) => gs.filter((x) => x.key !== g.key));
                      setActivities((as) => as.map((a) => (a.goalKey === g.key ? { ...a, goalKey: "" } : a)));
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" size="xs" variant="outline" onClick={() => setGoals((gs) => [...gs, blankGoal()])}>
                  <PlusIcon /> Add goal
                </Button>
              </div>
            </section>

            <section className="flex flex-col gap-1.5">
              <h4 className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">Activities</h4>
              {activities.map((a, i) => (
                <div key={a.key} className="grid gap-2 rounded-md border p-2 sm:grid-cols-12">
                  <NativeSelect
                    aria-label={`Activity ${i + 1} kind`}
                    className="sm:col-span-3"
                    value={a.kind}
                    onChange={(e) => {
                      const kind = e.target.value as CareActivityKind;
                      setActivity(a.key, { kind, assignee: kind === "patient_task" || kind === "lifestyle" ? "patient" : "care_team" });
                    }}
                  >
                    {Object.entries(KIND_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    aria-label={`Activity ${i + 1}`}
                    className="sm:col-span-5"
                    maxLength={500}
                    value={a.description}
                    onChange={(e) => setActivity(a.key, { description: e.target.value })}
                    placeholder="e.g. Repeat HbA1c"
                  />
                  <NativeSelect
                    aria-label={`Activity ${i + 1} assignee`}
                    className="sm:col-span-2"
                    value={a.assignee}
                    onChange={(e) => setActivity(a.key, { assignee: e.target.value as "patient" | "care_team" })}
                  >
                    <option value="care_team">Care team</option>
                    <option value="patient">Patient</option>
                  </NativeSelect>
                  <NativeSelect
                    aria-label={`Activity ${i + 1} goal`}
                    className="sm:col-span-2"
                    value={a.goalKey}
                    onChange={(e) => setActivity(a.key, { goalKey: e.target.value })}
                  >
                    <option value="">No goal</option>
                    {goals
                      .filter((g) => g.description.trim())
                      .map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.description}
                        </option>
                      ))}
                  </NativeSelect>
                  <div className="flex flex-wrap items-center gap-1.5 sm:col-span-8">
                    <Label htmlFor={`act-due-${a.key}`} className="text-meta">
                      Due
                    </Label>
                    <Input
                      id={`act-due-${a.key}`}
                      type="date"
                      className="w-40"
                      min={today}
                      value={a.dueDate}
                      onChange={(e) => setActivity(a.key, { dueDate: e.target.value })}
                    />
                    {[14, 30, 90].map((days) => (
                      <Button key={days} type="button" size="xs" variant="ghost" onClick={() => setActivity(a.key, { dueDate: addDays(today, days) })}>
                        +{days} d
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 sm:col-span-3">
                    <Label htmlFor={`act-repeat-${a.key}`} className="text-meta whitespace-nowrap">
                      Repeat every
                    </Label>
                    <Input
                      id={`act-repeat-${a.key}`}
                      inputMode="numeric"
                      className="w-16"
                      value={a.recurrenceIntervalDays}
                      onChange={(e) => setActivity(a.key, { recurrenceIntervalDays: e.target.value })}
                    />
                    <span className="text-meta text-muted-foreground">days</span>
                  </div>
                  <div className="flex justify-end sm:col-span-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove activity ${i + 1}`}
                      onClick={() => setActivities((as) => as.filter((x) => x.key !== a.key))}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
              ))}
              <div>
                <Button type="button" size="xs" variant="outline" onClick={() => setActivities((as) => [...as, blankActivity("laboratory_monitoring")])}>
                  <PlusIcon /> Add activity
                </Button>
              </div>
            </section>
          </fieldset>
          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-table text-danger-foreground">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create care plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
