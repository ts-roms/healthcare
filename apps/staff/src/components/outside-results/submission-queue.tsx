"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, DateInput, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { declineSubmission, fileSubmission, submissionReportLink } from "@/app/(staff)/records/outside-results/actions";
import type { OutsideResultSubmission } from "@/lib/api/types";
import { BLANK_OUTSIDE_RESULT, type OutsideResultForm, SOURCE_KIND_LABEL } from "@/lib/outside-result-form";

/**
 * Results patients sent from MyHealth, oldest first. Read the report (Open report), then file it on the patient's record
 * as an outside result in your own words, or decline it with a reason the patient reads. Filing makes it an ordinary
 * outside result, which a clinician then reviews; the platform reads nothing in the report.
 */
export function SubmissionQueue({ items }: { items: OutsideResultSubmission[] }) {
  if (items.length === 0) return <p className="text-body text-muted-foreground">Nothing is waiting for the records office.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {items.map((s) => (
        <SubmissionRow key={s.id} submission={s} />
      ))}
    </ul>
  );
}

function SubmissionRow({ submission: s }: { submission: OutsideResultSubmission }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"none" | "file" | "decline">("none");
  const [form, setForm] = React.useState<OutsideResultForm>({
    ...BLANK_OUTSIDE_RESULT,
    sourceName: s.sourceName,
    tests: s.tests,
    performedOn: s.performedOn ?? "",
    receivedFrom: "patient",
  });
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof OutsideResultForm>(name: K, value: OutsideResultForm[K]) => setForm((f) => ({ ...f, [name]: value }));
  const open = () =>
    startTransition(async () => {
      const result = await submissionReportLink(s.id);
      if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
      else toast.error(result.message);
    });
  const file = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await fileSubmission({ patientId: s.patient.id, submissionId: s.id, form });
      if (result.ok) {
        toast.success("Filed on the patient's record");
        router.refresh();
      } else setError(result.message);
    });
  };
  const decline = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await declineSubmission({ patientId: s.patient.id, submissionId: s.id, reason });
      if (result.ok) {
        toast.success("Declined; the patient will read your reason");
        router.refresh();
      } else setError(result.message);
    });
  };
  return (
    <li className="flex flex-col gap-2 p-3">
      <p className="text-table font-medium">
        <Link href={`/patients/${s.patient.id}/outside-results`} className="text-primary hover:underline">
          {s.patient.displayName}
        </Link>{" "}
        <span className="font-mono text-meta text-muted-foreground">{s.patient.patientNumber}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-body font-medium">{s.tests}</span>
        <Badge variant="info">Sent by the patient</Badge>
      </div>
      <p className="text-meta text-muted-foreground">
        {[`from ${s.sourceName}`, s.performedOn ? `done ${clinicalDate(s.performedOn)}` : "day not given", `sent ${clinicalDateTime(s.submittedAt)}`].join(
          " · ",
        )}
      </p>
      {s.notes ? <p className="text-meta">The patient wrote: {s.notes}</p> : null}
      {mode === "none" ? (
        <div className="flex gap-1">
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={open}>
            <ExternalLinkIcon aria-hidden /> Open report
          </Button>
          <Button type="button" size="xs" onClick={() => setMode("file")}>
            File on the record…
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setMode("decline")}>
            Decline…
          </Button>
        </div>
      ) : null}
      {mode === "file" ? (
        <form className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-6" onSubmit={file} noValidate>
          <p className="text-meta text-muted-foreground sm:col-span-6">Fill this in from the report itself, not from what the patient wrote.</p>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor={`source-${s.id}`}>Laboratory or hospital, as written on the report</Label>
            <Input id={`source-${s.id}`} maxLength={200} value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} />
          </div>
          <div className="grid gap-1 sm:col-span-1">
            <Label htmlFor={`kind-${s.id}`}>Kind</Label>
            <NativeSelect id={`kind-${s.id}`} value={form.sourceKind} onChange={(e) => set("sourceKind", e.target.value as OutsideResultForm["sourceKind"])}>
              {Object.entries(SOURCE_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor={`date-${s.id}`}>Day the test was done</Label>
            <DateInput id={`date-${s.id}`} value={form.performedOn} onChange={(e) => set("performedOn", e.target.value)} />
          </div>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor={`tests-${s.id}`}>Tests, as the report names them</Label>
            <Input id={`tests-${s.id}`} maxLength={500} value={form.tests} onChange={(e) => set("tests", e.target.value)} />
          </div>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor={`notes-${s.id}`}>Notes (staff only)</Label>
            <Textarea id={`notes-${s.id}`} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending}>
              File outside result
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("none")} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {mode === "decline" ? (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={decline}>
          <Input
            aria-label="Reason the patient will read"
            placeholder="Reason the patient will read (e.g. the photo is too blurry; please send a clearer one)"
            className="h-7 w-[28rem] max-w-full"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 5}>
            Decline
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setMode("none")} disabled={pending}>
            Cancel
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </li>
  );
}
