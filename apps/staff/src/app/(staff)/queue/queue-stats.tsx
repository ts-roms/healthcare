import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@healthcare/ui/lib/utils";
import { type QueueFigures, WAIT_LONG_MINUTES } from "@/lib/clinic-mapping";

/** The four figures above the board: how many are in the queue, how long they have waited, and who is with a provider. */
export function QueueStats({ figures }: { figures: QueueFigures }) {
  const longest = figures.longestWait;
  const long = longest !== null && longest.minutes >= WAIT_LONG_MINUTES;
  return (
    <section aria-label="Queue figures" className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="In queue" value={figures.inQueue} sub={`${figures.done} done`} />
      <Stat
        label="Avg wait"
        value={figures.averageWaitMinutes ?? "–"}
        unit={figures.averageWaitMinutes === null ? undefined : "min"}
        sub={`${figures.waiting} waiting`}
      />
      <Stat
        label="Longest wait"
        value={longest?.minutes ?? "–"}
        unit={longest ? "min" : undefined}
        sub={longest ? longest.patientName : "no one waiting"}
        tone={long ? "long" : undefined}
      />
      <Stat label="With provider" value={figures.withProvider} sub="in consultation" />
    </section>
  );
}

function Stat({ label, value, unit, sub, tone }: { label: string; value: number | string; unit?: string; sub: string; tone?: "long" }) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card px-4 py-3", tone === "long" && "border-danger/30 bg-danger-subtle")}>
      <p className="flex items-center gap-1 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        {tone === "long" ? <TriangleAlertIcon className="size-3.5 text-danger-foreground" aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1.5">
        <span className="tabular text-3xl font-semibold">{value}</span>
        {unit ? <span className="text-table text-muted-foreground">{unit}</span> : null}
      </p>
      <p className="truncate text-meta text-muted-foreground">{sub}</p>
    </div>
  );
}
