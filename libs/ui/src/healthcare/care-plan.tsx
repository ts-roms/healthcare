import * as React from "react";
import { CheckCircle2Icon, CircleDashedIcon, CircleDotIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import type { CarePlan as CarePlanData, CarePlanGoal } from "@healthcare/domain";
import { clinicalDate } from "../lib/format";
import { cn } from "../lib/utils";

const GOAL: Record<CarePlanGoal["status"], { icon: LucideIcon; label: string; tone: string }> = {
  "not-started": { icon: CircleDashedIcon, label: "Not started", tone: "text-muted-foreground" },
  "in-progress": { icon: CircleDotIcon, label: "In progress", tone: "text-info" },
  achieved: { icon: CheckCircle2Icon, label: "Achieved", tone: "text-success" },
  missed: { icon: XCircleIcon, label: "Missed", tone: "text-danger" },
};

/** Segmented progress: achieved / in progress / missed / not started, with a text summary. */
export function CarePlanProgress({ goals, className }: { goals: CarePlanGoal[]; className?: string }) {
  const count = (s: CarePlanGoal["status"]) => goals.filter((g) => g.status === s).length;
  const segs = [
    { s: "achieved", cls: "bg-success" },
    { s: "in-progress", cls: "bg-info" },
    { s: "missed", cls: "bg-danger" },
    { s: "not-started", cls: "bg-muted-foreground/25" },
  ] as const;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {segs.map(({ s, cls }) => (count(s) ? <div key={s} className={cls} style={{ width: `${(count(s) / goals.length) * 100}%` }} /> : null))}
      </div>
      <p className="tabular text-meta text-muted-foreground">
        {count("achieved")}/{goals.length} achieved · {count("in-progress")} in progress
        {count("missed") ? <span className="font-medium text-danger-foreground"> · {count("missed")} missed</span> : null}
      </p>
    </div>
  );
}

export function CarePlan({ plan, className }: { plan: CarePlanData; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div>
        <p className="text-body font-semibold">{plan.title}</p>
        <p className="text-meta text-muted-foreground">
          Since {clinicalDate(plan.startedOn)}
          {plan.reviewOn ? ` · Review ${clinicalDate(plan.reviewOn)}` : ""}
        </p>
      </div>
      <CarePlanProgress goals={plan.goals} />
      <ul className="flex flex-col gap-1">
        {plan.goals.map((g) => {
          const m = GOAL[g.status];
          const Icon = m.icon;
          return (
            <li key={g.id} className="flex items-start gap-2 text-table">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", m.tone)} aria-label={m.label} />
              <span className="min-w-0 flex-1">
                <span className={cn(g.status === "achieved" && "text-muted-foreground line-through")}>{g.description}</span>
                {g.target ? <span className="text-muted-foreground"> · {g.target}</span> : null}
              </span>
              {g.due && g.status !== "achieved" ? <span className="tabular text-meta text-muted-foreground">{clinicalDate(g.due)}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
