"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2Icon, PlusIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import type { LabNonconformanceDetail, NonconformanceEntryKind, NonconformanceSeverity } from "@/lib/api/types";
import { addNonconformanceEntry, closeNonconformance, reclassifyNonconformance } from "../../quality-management-actions";
import { CATEGORY_LABEL, NonconformanceStatusBadge, SEVERITY_LABEL, SeverityBadge, useRun } from "../../quality-ui";

const ENTRY_LABEL: Record<LabNonconformanceDetail["entries"][number]["kind"], string> = {
  note: "Note",
  correction: "Correction (immediate action)",
  root_cause: "Root cause",
  corrective_action: "Corrective action",
  preventive_action: "Preventive action",
  effectiveness_check: "Effectiveness check",
  reclassified: "Reclassified",
  closed: "Closed",
};

export function NonconformanceWorkspace({ record, canEnter, canManage }: { record: LabNonconformanceDetail; canEnter: boolean; canManage: boolean }) {
  const closed = record.status === "closed";
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>What happened</CardTitle>
            <span className="flex flex-wrap gap-1.5">
              <NonconformanceStatusBadge status={record.status} />
              <SeverityBadge severity={record.severity} />
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-table">
            <p className="whitespace-pre-line">{record.description}</p>
            <p className="text-meta text-muted-foreground">
              {CATEGORY_LABEL[record.category]} · occurred {clinicalDateTime(record.occurredAt)} · reported {clinicalDateTime(record.reportedAt)} by{" "}
              {record.reportedByName ?? "the platform"}
              {record.instrumentName ? ` · instrument ${record.instrumentName}` : ""}
              {record.specimenAccession ? ` · specimen ${record.specimenAccession}` : ""}
              {record.temperatureReadingId ? " · from a temperature excursion" : ""}
              {record.eqaResultId ? " · from an unacceptable EQA result" : ""}
            </p>
            {record.temperatureReadingId ? (
              <Link href="/laboratory/temperatures" className="text-meta text-primary hover:underline">
                Temperature monitoring
              </Link>
            ) : null}
            {record.eqaResultId ? (
              <Link href="/laboratory/eqa" className="text-meta text-primary hover:underline">
                Proficiency testing
              </Link>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Investigation trail</CardTitle>
          </CardHeader>
          <CardContent>
            {record.entries.length === 0 ? <p className="text-body text-muted-foreground">Nothing recorded yet.</p> : null}
            <ol className="flex flex-col gap-3">
              {record.entries.map((e) => (
                <li key={e.id} className="border-l-2 pl-3">
                  <p className="text-table font-medium">{ENTRY_LABEL[e.kind]}</p>
                  <p className="text-table whitespace-pre-line">{e.body}</p>
                  <p className="text-meta text-muted-foreground">
                    {clinicalDateTime(e.recordedAt)} — {e.recordedByName}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-4 self-start">
        {!closed && canEnter ? <EntryForm record={record} /> : null}
        {!closed && canManage ? <ManagePanel record={record} /> : null}
        {closed ? (
          <p className="flex items-center gap-1.5 text-table text-muted-foreground">
            <CheckCircle2Icon className="size-4 text-success" aria-hidden /> Closed {record.closedAt ? clinicalDateTime(record.closedAt) : ""}. The record no
            longer changes.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EntryForm({ record }: { record: LabNonconformanceDetail }) {
  const { pending, run } = useRun();
  const [kind, setKind] = React.useState<NonconformanceEntryKind>("note");
  const [body, setBody] = React.useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add to the trail</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addNonconformanceEntry({ id: record.id, kind, body }),
              `${ENTRY_LABEL[kind]} recorded`,
              () => setBody(""),
            );
          }}
        >
          <NativeSelect aria-label="Kind of entry" value={kind} onChange={(e) => setKind(e.target.value as NonconformanceEntryKind)}>
            {(["note", "correction", "root_cause", "corrective_action", "preventive_action", "effectiveness_check"] as const).map((k) => (
              <option key={k} value={k}>
                {ENTRY_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
          <Textarea aria-label="Entry" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          <Button type="submit" size="sm" className="self-start" disabled={pending || body.trim().length < 3}>
            <PlusIcon /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ManagePanel({ record }: { record: LabNonconformanceDetail }) {
  const { pending, run } = useRun();
  const [summary, setSummary] = React.useState("");
  const [severity, setSeverity] = React.useState<NonconformanceSeverity>(record.severity);
  const [reason, setReason] = React.useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => reclassifyNonconformance({ id: record.id, severity, reason, version: record.version }),
              "Reclassified",
              () => setReason(""),
            );
          }}
        >
          <Label htmlFor="nc-reseverity">Severity</Label>
          <NativeSelect id="nc-reseverity" value={severity} onChange={(e) => setSeverity(e.target.value as NonconformanceSeverity)}>
            {Object.entries(SEVERITY_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
          {severity !== record.severity ? (
            <>
              <Input aria-label="Reason" placeholder="Why the severity changes *" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending || reason.trim().length < 3}>
                Reclassify
              </Button>
            </>
          ) : null}
        </form>
        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => closeNonconformance({ id: record.id, summary, version: record.version }), `${record.number} closed`);
          }}
        >
          <Label htmlFor="nc-summary">Close</Label>
          {record.missingToClose.length ? <p className="text-meta text-warning-foreground">Record the {record.missingToClose.join(", ")} first.</p> : null}
          <Textarea id="nc-summary" placeholder="Outcome summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} />
          <Button type="submit" size="sm" className="self-start" disabled={pending || record.missingToClose.length > 0 || summary.trim().length < 3}>
            <CheckCircle2Icon /> Close
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
