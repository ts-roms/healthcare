import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { ApiError } from "@healthcare/web-session";
import { LabTrendChart } from "@healthcare/ui/healthcare";
import { ResultMeaning } from "@/components/result-meaning";
import { portalApi } from "@/lib/api/client";
import type { PortalTrend } from "@/lib/api/types";
import { resultDate, resultValue, usualRange } from "@/lib/records";

export const metadata = { title: "Result" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResultPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  if (!UUID.test(testId)) notFound();
  let trend: PortalTrend;
  try {
    trend = await portalApi<PortalTrend>(`/portal/results/trend?testId=${testId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  if (trend.points.length === 0) notFound();
  const latest = trend.points.at(-1)!;
  const numeric = trend.points.filter((p) => p.valueNumeric !== null && (p.collectedAt ?? p.releasedAt));
  const sameUnit = new Set(trend.points.map((p) => p.unit ?? "")).size === 1;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/results" className="flex items-center gap-1 text-body font-medium text-primary">
        <ChevronLeftIcon className="size-4" aria-hidden /> All results
      </Link>
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h1 className="text-page font-semibold">{trend.testName}</h1>
        <p className="tabular text-page-lg font-semibold">
          {resultValue(latest)} {latest.unit ? <span className="text-body font-normal text-muted-foreground">{latest.unit}</span> : null}
        </p>
        <ResultMeaning result={latest} />
        <p className="text-meta text-muted-foreground">
          {usualRange(latest) ?? ""} · {resultDate(latest.collectedAt ?? latest.releasedAt)}
          {latest.corrected ? " · updated by the laboratory" : ""}
          {latest.performingLaboratory ? ` · tested at ${latest.performingLaboratory}` : ""}
        </p>
      </div>

      {numeric.length > 1 && sameUnit ? (
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <h2 className="text-section-lg font-semibold">Over time</h2>
          <LabTrendChart
            data={numeric.map((p) => ({ date: (p.collectedAt ?? p.releasedAt)!, value: p.valueNumeric! }))}
            name={trend.testName}
            unit={trend.unit ?? undefined}
            referenceLow={latest.refLow ?? undefined}
            referenceHigh={latest.refHigh ?? undefined}
          />
          <p className="text-meta text-muted-foreground">
            The shaded band is the usual range. A single value outside it is not always a concern — ask your doctor.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-section-lg font-semibold">History</h2>
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {[...trend.points].reverse().map((p) => (
            <li key={p.id} className="flex flex-col gap-1 p-3">
              <p className="flex items-baseline justify-between gap-2">
                <span className="tabular font-semibold">
                  {resultValue(p)} {p.unit ?? ""}
                </span>
                <span className="text-meta text-muted-foreground">{resultDate(p.collectedAt ?? p.releasedAt)}</span>
              </p>
              <ResultMeaning result={p} />
              {usualRange(p) ? <p className="text-meta text-muted-foreground">{usualRange(p)} (at the time)</p> : null}
              {p.performingLaboratory ? <p className="text-meta text-muted-foreground">Tested at {p.performingLaboratory}</p> : null}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-meta text-muted-foreground">
        Questions about a result? Talk to your doctor or contact the clinic. This page does not give medical advice.
      </p>
    </div>
  );
}
