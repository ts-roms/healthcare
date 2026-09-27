import { hba1cTrend } from "@healthcare/domain/fixtures";
import { LabTrendChart } from "@healthcare/ui/healthcare";
import { Badge } from "@healthcare/ui/primitives";
import { CheckCircle2Icon, InfoIcon } from "lucide-react";

export const metadata = { title: "Results" };

/** Patient-facing results: plain language, one result per card, context before numbers. */
export default function ResultsPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-lg font-semibold">Your results</h1>
      <article className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-section-lg font-semibold">HbA1c</h2>
            <p className="text-body text-muted-foreground">Average blood sugar over the last 3 months · 27 Sep 2026</p>
          </div>
          <Badge variant="warning" className="text-body">
            Above target
          </Badge>
        </header>
        <p className="tabular text-page-lg font-semibold">7.1%</p>
        <LabTrendChart data={hba1cTrend} name="HbA1c" unit="%" referenceHigh={7} referenceLow={4} height={200} />
        <p className="flex gap-2 rounded-lg bg-success-subtle p-3 text-body text-success-foreground">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Good progress — down from 8.4% in February. Your goal is below 7.0%.
        </p>
        <p className="flex gap-2 text-body text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Dr. Reyes reviewed this result. Questions? Send a message to your care team.
        </p>
      </article>
    </div>
  );
}
