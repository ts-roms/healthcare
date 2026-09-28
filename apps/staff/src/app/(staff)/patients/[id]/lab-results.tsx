"use client";

import * as React from "react";
import { AlertOctagonIcon, LineChartIcon, PaperclipIcon, PrinterIcon } from "lucide-react";
import { clinicalDate, LabFlagBadge, LabTrendChart } from "@healthcare/ui/healthcare";
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@healthcare/ui/primitives";
import type { LabTrend, PatientLabResult } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import { groupResultsByTest, latestRange, mixedUnits, referenceText, resultValue, trendPoints, uiFlag } from "@/lib/lab-mapping";
import { loadLabTrend, resultAttachmentUrl } from "../../laboratory/actions";

/**
 * The patient's released laboratory results, latest per test, with a trend
 * per analyte. Trends are a display aid; each value keeps the reference range
 * it was read against.
 */
export function PatientLabResults({ patientId, results }: { patientId: string; results: PatientLabResult[] }) {
  const [trend, setTrend] = React.useState<{ testId: string; data: LabTrend } | null>(null);
  const [pending, start] = React.useTransition();
  const groups = groupResultsByTest(results);
  if (groups.length === 0) return <p className="text-body text-muted-foreground">No released laboratory results.</p>;

  const openTrend = (testId: string) =>
    start(async () => {
      if (trend?.testId === testId) return setTrend(null);
      const result = await loadLabTrend(patientId, testId);
      if (result.ok) setTrend({ testId, data: result.data });
      else toast.error(result.message);
    });

  // Attachments are served through short-lived links (the API checks the result is released and audits each).
  const openAttachment = (attachmentId: string) =>
    start(async () => {
      const link = await resultAttachmentUrl(attachmentId);
      if (link.ok) window.open(link.data.url, "_blank", "noopener,noreferrer");
      else toast.error(link.message);
    });

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test</TableHead>
            <TableHead>Latest</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Collected</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ testId, testName, latest, count }) => {
            const flag = uiFlag(latest.flag);
            return (
              <TableRow key={testId} data-state={trend?.testId === testId ? "selected" : undefined}>
                <TableCell>
                  {testName}
                  {latest.versionNumber > 1 ? <span className="block text-meta text-warning-foreground">Corrected: {latest.correctionReason}</span> : null}
                  {(latest.attachments ?? []).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="flex items-center gap-1 text-meta text-primary hover:underline"
                      onClick={() => openAttachment(a.id)}
                    >
                      <PaperclipIcon className="size-3" aria-hidden /> {a.title}
                    </button>
                  ))}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-semibold">{resultValue(latest)}</span>
                    {latest.unit ? <span className="text-meta text-muted-foreground">{latest.unit}</span> : null}
                    {latest.critical ? <AlertOctagonIcon className="size-4 text-critical" aria-label="Critical" /> : null}
                    {flag ? <LabFlagBadge flag={flag} /> : null}
                  </span>
                </TableCell>
                <TableCell className="text-table text-muted-foreground">{referenceText(latest) || "—"}</TableCell>
                <TableCell className="tabular text-table">{clinicalDate(latest.collectedAt ?? latest.releasedAt ?? latest.enteredAt)}</TableCell>
                <TableCell className="text-right">
                  {latest.resultType === "numeric" && count > 1 ? (
                    <Button size="xs" variant="outline" disabled={pending} onClick={() => openTrend(testId)}>
                      <LineChartIcon /> {trend?.testId === testId ? "Hide" : `Trend (${count})`}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-table">
        <span className="flex items-center gap-1 text-muted-foreground">
          <PrinterIcon className="size-3.5" aria-hidden /> Printable reports:
        </span>
        {[...new Map(results.map((r) => [r.orderId, r.orderNumber])).entries()].map(([orderId, orderNumber]) => (
          <a key={orderId} href={fileHref.labReport(orderId)} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
            {orderNumber}
          </a>
        ))}
      </p>
      {trend ? <TrendView trend={trend.data} /> : null}
    </div>
  );
}

function TrendView({ trend }: { trend: LabTrend }) {
  const range = latestRange(trend);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {mixedUnits(trend) ? (
        <p className="text-table text-warning-foreground">Units differ between results, so no chart is drawn. Compare the values below.</p>
      ) : (
        <LabTrendChart data={trendPoints(trend)} name={trend.testName} unit={trend.unit ?? undefined} referenceLow={range.low} referenceHigh={range.high} />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Collected</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Reference (at the time)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...trend.points].reverse().map((p) => {
            const flag = uiFlag(p.flag);
            return (
              <TableRow key={p.resultId}>
                <TableCell className="tabular">{p.collectedAt ? clinicalDate(p.collectedAt) : "—"}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono">{p.valueNumeric ?? p.valueCoded ?? p.valueText}</span>
                    {p.unit ? <span className="text-meta text-muted-foreground">{p.unit}</span> : null}
                    {flag ? <LabFlagBadge flag={flag} /> : null}
                    {p.corrected ? <span className="text-meta text-warning-foreground">corrected</span> : null}
                  </span>
                </TableCell>
                <TableCell className="text-table text-muted-foreground">{referenceText(p) || "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-meta text-muted-foreground">
        A display aid: the shaded band is the latest reference range. Interpretation remains the clinician&apos;s.
      </p>
    </div>
  );
}
