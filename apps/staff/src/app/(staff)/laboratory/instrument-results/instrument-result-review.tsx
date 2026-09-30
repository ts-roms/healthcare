"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleSlashIcon, ClockIcon, LinkIcon, UnlinkIcon } from "lucide-react";
import { clinicalDateTime, StatusBadge, type StatusSpec } from "@healthcare/ui/healthcare";
import { Button, Card, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@healthcare/ui/primitives";
import type { LabInstrumentResultRow } from "@/lib/api/types";
import { MATCH_PROBLEM, sentValue } from "@/lib/instrument-results";
import { acceptInstrumentResult, dismissInstrumentResult } from "../instrument-interface-actions";
import { useRun } from "../quality-ui";

const MATCHED: StatusSpec = { label: "Matched", icon: LinkIcon, variant: "info" };
const UNMATCHED: StatusSpec = { label: "Not matched", icon: UnlinkIcon, variant: "warning" };
const STATE: Record<LabInstrumentResultRow["state"], StatusSpec> = {
  pending: { label: "To review", icon: ClockIcon, variant: "info" },
  accepted: { label: "Accepted", icon: CheckCircle2Icon, variant: "success" },
  dismissed: { label: "Set aside", icon: CircleSlashIcon, variant: "neutral" },
};

export function InstrumentResultReview({ rows, canDecide, decided }: { rows: LabInstrumentResultRow[]; canDecide: boolean; decided: boolean }) {
  const { pending, run } = useRun();
  const [dismissing, setDismissing] = React.useState<{ id: string; reason: string } | null>(null);
  if (rows.length === 0) {
    return (
      <Card className="p-4 text-body text-muted-foreground">
        {decided ? "No instrument results decided yet." : "No instrument results waiting. Results appear here as analyzers send them."}
      </Card>
    );
  }
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Received</TableHead>
            <TableHead>Specimen</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Test</TableHead>
            <TableHead>Sent value</TableHead>
            <TableHead>As sent</TableHead>
            <TableHead>{decided ? "Decision" : "Match"}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="tabular">
                {clinicalDateTime(r.receivedAt)}
                <span className="block text-meta text-muted-foreground">{r.instrumentCode}</span>
              </TableCell>
              <TableCell className="tabular">
                {r.accessionNumber ?? r.specimenCode ?? "—"}
                {r.orderNumber ? <span className="block text-meta text-muted-foreground">{r.orderNumber}</span> : null}
              </TableCell>
              <TableCell>
                {r.patient ? (
                  <>
                    <span className="font-medium">{r.patient.displayName}</span>
                    <span className="block text-meta text-muted-foreground">
                      {r.patient.patientNumber} · {r.patient.sex}, {r.patient.age}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {r.testName ?? <span className="text-muted-foreground">—</span>}
                <span className="block font-mono text-meta text-muted-foreground">{r.analyzerCode ?? "no code"}</span>
              </TableCell>
              <TableCell className="tabular font-medium">
                {sentValue(r)}
                {r.testUnit && r.units && r.units.trim().toLowerCase() !== r.testUnit.trim().toLowerCase() ? (
                  <span className="block text-meta font-normal text-warning-foreground">Catalog unit: {r.testUnit}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-meta text-muted-foreground">
                {[r.flags ? `flag ${r.flags}` : null, r.status ? `status ${r.status}` : null, r.referenceRange ? `range ${r.referenceRange}` : null]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal">
                {decided ? (
                  <>
                    <StatusBadge spec={STATE[r.state]} />
                    <span className="block text-meta text-muted-foreground">
                      {r.decidedByName ?? ""}
                      {r.decidedAt ? ` · ${clinicalDateTime(r.decidedAt)}` : ""}
                      {r.dismissReason ? ` — ${r.dismissReason}` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <StatusBadge spec={r.matchProblem ? UNMATCHED : MATCHED} />
                    {r.matchProblem ? <span className="block text-meta text-muted-foreground">{MATCH_PROBLEM[r.matchProblem]}</span> : null}
                  </>
                )}
              </TableCell>
              <TableCell className="text-right">
                {decided ? (
                  r.state === "accepted" && r.patientId ? (
                    <Link href={`/patients/${r.patientId}#laboratory`} className="text-meta text-primary hover:underline">
                      Open results
                    </Link>
                  ) : null
                ) : canDecide ? (
                  dismissing?.id === r.id ? (
                    <form
                      className="flex flex-wrap items-center justify-end gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(
                          () => dismissInstrumentResult({ resultId: r.id, reason: dismissing.reason }),
                          "Set aside",
                          () => setDismissing(null),
                        );
                      }}
                    >
                      <Input
                        aria-label="Reason"
                        placeholder="Reason"
                        className="h-8 w-40"
                        value={dismissing.reason}
                        maxLength={500}
                        onChange={(e) => setDismissing({ ...dismissing, reason: e.target.value })}
                      />
                      <Button type="submit" size="xs" variant="destructive" disabled={pending || dismissing.reason.trim().length < 3}>
                        Set aside
                      </Button>
                      <Button type="button" size="xs" variant="ghost" onClick={() => setDismissing(null)}>
                        Keep
                      </Button>
                    </form>
                  ) : (
                    <div className="flex justify-end gap-1">
                      {r.matchProblem ? null : (
                        <Button
                          size="xs"
                          disabled={pending}
                          onClick={() => run(() => acceptInstrumentResult(r.id), "Result entered — verify it on the workbench")}
                        >
                          Accept
                        </Button>
                      )}
                      <Button size="xs" variant="outline" disabled={pending} onClick={() => setDismissing({ id: r.id, reason: "" })}>
                        Set aside
                      </Button>
                    </div>
                  )
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
