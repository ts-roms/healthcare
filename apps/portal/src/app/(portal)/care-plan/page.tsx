import { CheckIcon, ClipboardListIcon, TargetIcon, UserIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { portalApi } from "@/lib/api/client";
import type { PortalCarePlan } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/greeting";

export const metadata = { title: "Care plan" };

export default async function CarePlanPage() {
  const plans = await portalApi<PortalCarePlan[]>("/portal/care-plans");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Your care plan</h1>
        <p className="text-body text-muted-foreground">Goals you and your care team agreed on, and what comes next.</p>
      </div>
      {plans.length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title="No active care plan">
          If your doctor sets up a care plan with you, it appears here.
        </EmptyState>
      ) : (
        plans.map((plan) => {
          const yours = plan.activities.filter((a) => a.assignee === "patient");
          const team = plan.activities.filter((a) => a.assignee === "care_team");
          return (
            <section key={plan.id} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
              <div>
                <h2 className="text-section-lg font-semibold">{plan.title}</h2>
                <p className="text-meta text-muted-foreground">Since {formatCalendarDate(plan.startDate)}</p>
              </div>
              {plan.goals.length ? (
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <TargetIcon className="size-4" aria-hidden /> Goals
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {plan.goals.map((g) => (
                      <li key={g.id} className="text-body">
                        {g.status === "achieved" ? <CheckIcon className="mr-1 inline size-4 text-success" aria-label="Achieved" /> : null}
                        {g.description}
                        {g.targetMeasure || g.targetValue ? (
                          <span className="text-muted-foreground"> — {[g.targetMeasure, g.targetValue].filter(Boolean).join(" ")}</span>
                        ) : null}
                        {g.targetDate ? <span className="text-muted-foreground"> by {formatCalendarDate(g.targetDate)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Activities title="What you can do" icon={UserIcon} items={yours} />
              <Activities title="Coming up with your care team" icon={UsersIcon} items={team} />
            </section>
          );
        })
      )}
    </div>
  );
}

function Activities({ title, icon: Icon, items }: { title: string; icon: typeof UserIcon; items: PortalCarePlan["activities"] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Icon className="size-4" aria-hidden /> {title}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3 text-body">
            <span>{a.description}</span>
            {a.dueDate ? <span className="shrink-0 text-meta text-muted-foreground">{formatCalendarDate(a.dueDate)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
