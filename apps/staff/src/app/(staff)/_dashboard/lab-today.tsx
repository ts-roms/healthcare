import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";
import type { LabDashboard } from "@/lib/api/types";
import { minutesLabel } from "@/lib/dashboard-mapping";

/** The laboratory today in four steps a sample goes through, with the day's turnaround, releases and rejections. */
export function LabToday({ dashboard, workbench }: { dashboard: LabDashboard; workbench?: string }) {
  const toSignOff = dashboard.awaitingVerification + dashboard.awaitingApproval;
  const steps = [
    {
      n: 1,
      label: "To collect",
      value: dashboard.pendingCollection,
      sub: dashboard.awaitingReceipt ? `${dashboard.awaitingReceipt} awaiting receipt` : "none awaiting receipt",
      href: workbench && `${workbench}?stage=collect`,
    },
    { n: 2, label: "Awaiting results", value: dashboard.awaitingEntry, sub: "results to enter", href: workbench && `${workbench}?stage=enter` },
    {
      n: 3,
      label: "Awaiting sign-off",
      value: toSignOff,
      sub: `${dashboard.awaitingVerification} to verify · ${dashboard.awaitingApproval} to approve`,
      href: workbench && `${workbench}?stage=verify`,
      alert: toSignOff > 0,
    },
    {
      n: 4,
      label: "Released today",
      value: dashboard.releasedToday,
      sub: dashboard.overdue ? `${dashboard.overdue} past turnaround` : "none past turnaround",
      href: workbench,
    },
  ];
  return (
    <section aria-label="Laboratory" className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="text-section-lg font-semibold">Laboratory</h2>
        {dashboard.statOpen > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-danger-subtle px-2 py-0.5 text-table font-semibold text-danger-foreground">
            <TriangleAlertIcon className="size-3.5" aria-hidden /> {dashboard.statOpen} STAT open
          </span>
        ) : null}
        <p className="ml-auto text-table text-muted-foreground">
          Avg turnaround <b className="font-semibold text-foreground">{minutesLabel(dashboard.averageTurnaroundMinutes)}</b> · Released today{" "}
          <b className="font-semibold text-foreground">{dashboard.releasedToday}</b> · Rejected{" "}
          <b className="font-semibold text-foreground">{dashboard.rejectedToday}</b>
        </p>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => {
          const body = (
            <>
              <span className="block text-meta text-muted-foreground">
                {step.n} · {step.label}
              </span>
              <span className="tabular mt-1 block text-3xl font-semibold">{step.value}</span>
              <span className={cn("mt-0.5 block text-meta", step.alert ? "font-medium text-warning-foreground" : "text-muted-foreground")}>{step.sub}</span>
            </>
          );
          const className = "block rounded-lg border bg-muted/40 px-4 py-3 outline-none";
          return (
            <li key={step.n}>
              {step.href ? (
                <Link href={step.href} className={cn(className, "hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50")}>
                  {body}
                </Link>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
