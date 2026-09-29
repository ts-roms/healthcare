import Link from "next/link";
import { ChevronRightIcon, FlaskConicalIcon, FileDownIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ResultMeaning } from "@/components/result-meaning";
import { portalApi } from "@/lib/api/client";
import { getMe } from "@/lib/api/session";
import type { PortalResult } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import { latestPerTest, resultDate, resultValue, usualRange } from "@/lib/records";

export const metadata = { title: "Results" };

/** Only results the laboratory has released and allows patients to see are listed (the API decides). */
export default async function ResultsPage() {
  // Dates and times are shown in the patient\'s clinic\'s time zone.
  const { timeZone } = await getMe();
  const results = await portalApi<PortalResult[]>("/portal/results");
  const groups = latestPerTest(results);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page-lg font-semibold">Your results</h1>
        <p className="text-body text-muted-foreground">
          Results appear here after the laboratory releases them. Your doctor will explain what they mean for you.
        </p>
      </div>
      {groups.length === 0 ? (
        <EmptyState icon={FlaskConicalIcon} title="No results to show yet">
          When the laboratory finishes a test and releases it to you, it will appear here. Some tests are explained by your doctor in person first.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map(({ latest, count }) => (
            <li key={latest.testId}>
              <Link
                href={`/results/${latest.testId}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{latest.testName}</span>
                    <span className="text-meta text-muted-foreground">{resultDate(latest.collectedAt ?? latest.releasedAt, timeZone)}</span>
                  </p>
                  <p className="tabular text-section-lg font-semibold">
                    {resultValue(latest)} {latest.unit ? <span className="text-body font-normal text-muted-foreground">{latest.unit}</span> : null}
                  </p>
                  <ResultMeaning result={latest} />
                  <p className="text-meta text-muted-foreground">
                    {usualRange(latest) ?? ""}
                    {count > 1 ? ` · ${count} results over time` : ""}
                    {latest.corrected ? " · updated by the laboratory" : ""}
                    {latest.performingLaboratory ? ` · tested at ${latest.performingLaboratory}` : ""}
                  </p>
                </div>
                <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {results.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-section-lg font-semibold">Printable reports</h2>
          <ul className="flex flex-col gap-2">
            {[...new Map(results.map((r) => [r.orderId, r])).values()].map((r) => (
              <li key={r.orderId}>
                <a
                  href={fileHref.labReport(r.orderId)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border bg-card p-3 text-body hover:bg-accent"
                >
                  <FileDownIcon className="size-4 text-primary" aria-hidden />
                  <span className="flex-1">Report {r.orderNumber}</span>
                  <span className="text-meta text-muted-foreground">{resultDate(r.collectedAt ?? r.releasedAt, timeZone)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
