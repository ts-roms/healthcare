"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, DateInput, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { fileOutsideResult, markOutsideResultInError, outsideResultLink } from "@/app/(staff)/patients/outside-result-actions";
import type { OutsideResult } from "@/lib/api/types";
import { BLANK_OUTSIDE_RESULT, type OutsideResultForm, RECEIVED_FROM_LABEL, SOURCE_KIND_LABEL } from "@/lib/outside-result-form";
import { filedUnderLookup, filedUnderText } from "@/lib/patient-merge";

/**
 * Results from outside laboratories and hospitals, filed as the report with its source, day and tests. They are not this
 * laboratory's results: nothing is verified, flagged or trended here, and the platform does not read the report.
 * Entries in error stay listed, struck through.
 */
export function OutsideResultList({
  patientId,
  results,
  canRecord,
  linkedRecords,
}: {
  patientId: string;
  results: OutsideResult[];
  canRecord: boolean;
  linkedRecords?: ReadonlyArray<{ id: string; patientNumber: string }>;
}) {
  const filedUnder = filedUnderLookup(linkedRecords);
  if (results.length === 0) return <p className="text-body text-muted-foreground">No outside results filed.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {results.map((r) => (
        <OutsideResultRow key={r.id} result={r} patientId={patientId} canRecord={canRecord} filedUnder={filedUnderText(filedUnder(r.patientId))} />
      ))}
    </ul>
  );
}

function OutsideResultRow({
  result: r,
  patientId,
  canRecord,
  filedUnder,
}: {
  result: OutsideResult;
  patientId: string;
  canRecord: boolean;
  filedUnder: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"none" | "error">("none");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const inError = r.enteredInError !== null;
  const open = () =>
    startTransition(async () => {
      const result = await outsideResultLink(r.id);
      if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
      else toast.error(result.message);
    });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await markOutsideResultInError({ patientId, outsideResultId: r.id, reason });
      if (result.ok) {
        toast.success("Marked entered in error");
        setMode("none");
        setReason("");
        router.refresh();
      } else toast.error(result.message);
    });
  };
  return (
    <li className="flex flex-col gap-1 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={inError ? "text-body line-through" : "text-body font-medium"}>
          {clinicalDate(r.performedOn)} · {r.tests}
        </span>
        <Badge variant="outline">{SOURCE_KIND_LABEL[r.sourceKind]}</Badge>
        <Badge variant="info">Outside result</Badge>
        {inError ? <Badge variant="danger">Entered in error</Badge> : null}
        {filedUnder ? <span className="text-meta text-muted-foreground">· {filedUnder}</span> : null}
      </div>
      <p className="text-meta text-muted-foreground">
        {[
          `from ${r.sourceName}`,
          RECEIVED_FROM_LABEL[r.receivedFrom],
          `filed ${clinicalDateTime(r.recordedAt)}${r.recordedByName ? ` by ${r.recordedByName}` : ""}`,
          r.facility?.name ?? null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {r.notes ? <p className="text-meta">Note: {r.notes}</p> : null}
      {r.enteredInError ? (
        <p className="text-meta">
          Entered in error: {r.enteredInError.reason}
          {r.enteredInError.byName ? ` (${r.enteredInError.byName}, ${clinicalDateTime(r.enteredInError.at)})` : ""}
        </p>
      ) : null}
      {mode === "none" ? (
        <div className="flex gap-1">
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={open}>
            <ExternalLinkIcon aria-hidden /> Open report
          </Button>
          {canRecord && !inError ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => setMode("error")}>
              Entered in error…
            </Button>
          ) : null}
        </div>
      ) : (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={submit}>
          <Input
            aria-label="Reason"
            placeholder="Reason (e.g. filed on the wrong patient)"
            className="h-7 w-80"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
            Confirm
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setMode("none")}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}

/** Files a report from an outside laboratory or hospital: the file, who performed it, the day and the tests as the report names them. */
export function FileOutsideResult({ patientId }: { patientId: string }) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [form, setForm] = React.useState<OutsideResultForm>(BLANK_OUTSIDE_RESULT);
  const [file, setFile] = React.useState<File | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof OutsideResultForm>(name: K, value: OutsideResultForm[K]) => setForm((f) => ({ ...f, [name]: value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Attach the report (a PDF or a photo).");
    const data = new FormData();
    data.set("file", file);
    data.set("idempotencyKey", key);
    for (const [name, value] of Object.entries(form)) data.set(name, value);
    startTransition(async () => {
      const result = await fileOutsideResult(patientId, data);
      if (result.ok) {
        toast.success("Outside result filed");
        setForm(BLANK_OUTSIDE_RESULT);
        setFile(null);
        setKey(crypto.randomUUID());
        formRef.current?.reset();
        router.refresh();
      } else setError(result.message);
    });
  };
  return (
    <form ref={formRef} className="grid gap-3 sm:grid-cols-6" onSubmit={submit} noValidate>
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor="outside-file">Report (PDF or photo, up to 10 MB)</Label>
        <Input id="outside-file" type="file" accept="application/pdf,image/jpeg,image/png,image/heic" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor="outside-source">Laboratory or hospital, as written on the report</Label>
        <Input id="outside-source" maxLength={200} value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-1">
        <Label htmlFor="outside-kind">Kind</Label>
        <NativeSelect id="outside-kind" value={form.sourceKind} onChange={(e) => set("sourceKind", e.target.value as OutsideResultForm["sourceKind"])}>
          {Object.entries(SOURCE_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="outside-date">Day the test was done</Label>
        <DateInput id="outside-date" value={form.performedOn} onChange={(e) => set("performedOn", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-4">
        <Label htmlFor="outside-tests">Tests, as the report names them</Label>
        <Input id="outside-tests" maxLength={500} placeholder="e.g. CBC, HbA1c" value={form.tests} onChange={(e) => set("tests", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor="outside-from">How it reached the clinic</Label>
        <NativeSelect id="outside-from" value={form.receivedFrom} onChange={(e) => set("receivedFrom", e.target.value as OutsideResultForm["receivedFrom"])}>
          {Object.entries(RECEIVED_FROM_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor="outside-notes">Notes (staff only)</Label>
        <Textarea id="outside-notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Filing…" : "File outside result"}
        </Button>
      </div>
    </form>
  );
}
