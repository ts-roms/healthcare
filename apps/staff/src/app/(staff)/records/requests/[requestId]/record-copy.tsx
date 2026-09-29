"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@healthcare/ui/primitives";
import type { RecordCopySection, RecordsRequestDetail } from "@/lib/api/types";
import { orderedCopySections, periodText, RECORD_COPY_SECTIONS } from "@/lib/records-mapping";
import { documentLink, prepareCopy } from "../actions";

const LABEL = new Map(RECORD_COPY_SECTIONS.map((s) => [s.key, s.label]));
const day = (d: string) => clinicalDate(`${d}T12:00:00Z`);

/**
 * A copy of the patient's record for the request: the chosen sections over a period, compiled by the API into one PDF
 * stored in the patient's record (it then appears among the documents to share). Starts from what the patient asked for.
 */
export function RecordCopyCard({ request, open }: { request: RecordsRequestDetail; open: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [sections, setSections] = React.useState<Set<RecordCopySection>>(new Set(request.suggestedSections));
  const [periodFrom, setPeriodFrom] = React.useState(request.periodFrom ?? "");
  const [periodTo, setPeriodTo] = React.useState(request.periodTo ?? "");
  const toggle = (key: RecordCopySection) => setSections((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : new Set([...prev, key])));

  const prepare = () =>
    startTransition(async () => {
      const result = await prepareCopy({
        requestId: request.id,
        sections: orderedCopySections(sections),
        periodFrom: periodFrom || undefined,
        periodTo: periodTo || undefined,
      });
      if (result.ok) {
        toast.success("Copy prepared — check it, then share it with the patient below");
        router.refresh();
      } else toast.error(result.message);
    });
  const view = (documentId: string) =>
    startTransition(async () => {
      const result = await documentLink(documentId);
      if (result.ok) window.open(result.data.url, "_blank", "noopener");
      else toast.error(result.message);
    });

  if (!open && request.copies.length === 0) return null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Copy of the record</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {open ? (
          <>
            <p className="text-meta text-muted-foreground">
              Compile the sections the patient needs into one PDF. It is stored in the patient&apos;s record and listed with the documents to share; nothing
              reaches the patient until you share it.
            </p>
            <fieldset className="grid gap-1.5 sm:grid-cols-2">
              <legend className="mb-1 text-table font-medium">What the copy contains</legend>
              {RECORD_COPY_SECTIONS.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-table">
                  <input type="checkbox" className="mt-1 size-4" checked={sections.has(s.key)} onChange={() => toggle(s.key)} />
                  <span>
                    {s.label}
                    <span className="block text-meta text-muted-foreground">{s.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label htmlFor="copy-from">From</Label>
                <Input id="copy-from" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="copy-to">To</Label>
                <Input id="copy-to" type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
              </div>
              <Button disabled={pending || sections.size === 0 || Boolean(periodFrom && periodTo && periodTo < periodFrom)} onClick={prepare}>
                Prepare copy
              </Button>
            </div>
            <p className="text-meta text-muted-foreground">Leave the dates empty for the whole record. Dates are in the facility&apos;s time zone.</p>
          </>
        ) : null}
        {request.copies.length ? (
          <ul className="flex flex-col gap-1.5 text-table">
            {request.copies.map((c) => (
              <li key={c.documentId} className="flex flex-wrap items-center gap-2">
                <span>
                  {clinicalDateTime(c.createdAt)} · {c.sections.map((s) => LABEL.get(s)).join(", ")} ·{" "}
                  <span className="text-muted-foreground">{periodText(c.periodFrom, c.periodTo, day)}</span>
                </span>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => view(c.documentId)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
