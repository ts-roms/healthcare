import Link from "next/link";
import { AlertOctagonIcon } from "lucide-react";
import { clinicalDate, LabFlagBadge } from "@healthcare/ui/healthcare";
import type { PatientLabResult } from "@/lib/api/types";
import { groupResultsByTest, resultValue, uiFlag } from "@/lib/lab-mapping";
import { PerformedBy } from "./send-out-badge";

/** The latest released result per test, for side panels. Values come from the laboratory, flags against its snapshotted range. */
export function LabResultsSummary({ results, limit, href }: { results: PatientLabResult[]; limit: number; href?: string }) {
  const groups = groupResultsByTest(results);
  if (groups.length === 0) return <p className="text-table text-muted-foreground">No released results.</p>;
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-0.5 text-table">
        {groups.slice(0, limit).map(({ testId, testName, latest }) => {
          const flag = uiFlag(latest.flag);
          return (
            <li key={testId} className="flex flex-wrap items-center gap-1.5">
              <span>{testName}</span>
              <span className="font-mono font-semibold">{resultValue(latest)}</span>
              {latest.unit ? <span className="text-meta text-muted-foreground">{latest.unit}</span> : null}
              {latest.critical ? <AlertOctagonIcon className="size-3.5 text-critical" aria-label="Critical" /> : null}
              {flag && flag !== "normal" ? <LabFlagBadge flag={flag} /> : null}
              <span className="text-meta text-muted-foreground">· {clinicalDate(latest.collectedAt ?? latest.releasedAt ?? latest.enteredAt)}</span>
              <PerformedBy laboratory={latest.performingLaboratory} />
            </li>
          );
        })}
      </ul>
      {href && groups.length ? (
        <Link href={href} className="text-meta text-primary hover:underline">
          All results and trends
        </Link>
      ) : null}
    </div>
  );
}
