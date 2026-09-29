"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitMergeIcon, Undo2Icon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { MergeHistoryEntry, PatientMergeLink } from "@/lib/api/types";
import { unmergePatient } from "./merge-actions";

const ACTION_LABEL: Record<MergeHistoryEntry["action"], string> = { merged: "Merged", unmerged: "Unmerged", repointed: "Re-pointed" };

/**
 * On a surviving record: the records merged into it (their care is shown here, marked with their number), the merge
 * history, and — for users who may merge — undoing a merge with a reason. Records filed under this record after the
 * merge stay here when a merge is undone.
 */
export function MergedRecords({
  survivorId,
  records,
  history,
  canUnmerge,
}: {
  survivorId: string;
  records: PatientMergeLink[];
  history: MergeHistoryEntry[] | null;
  canUnmerge: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [undoing, setUndoing] = React.useState<PatientMergeLink | null>(null);
  const [reason, setReason] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!undoing) return;
    start(async () => {
      const result = await unmergePatient(undoing.id, survivorId, reason);
      if (result.ok) {
        toast.success(`${undoing.patientNumber} is a separate record again`);
        setUndoing(null);
        setReason("");
        router.refresh();
      } else toast.error(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-3 text-body">
      {records.length ? (
        <>
          <p>
            This record includes the records of the patient numbers below: their care is shown on every screen of this record, marked with the number it was
            filed under.
          </p>
          <ul className="flex flex-col gap-1.5">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  <GitMergeIcon aria-hidden /> Merged
                </Badge>
                <Link href={`/patients/${r.id}`} className="font-mono text-primary hover:underline">
                  {r.patientNumber}
                </Link>
                <span className="text-muted-foreground">{r.displayName}</span>
                {r.mergedAt ? <span className="tabular text-meta text-muted-foreground">since {clinicalDateTime(r.mergedAt)}</span> : null}
                {canUnmerge ? (
                  <Button size="xs" variant="ghost" className="ml-auto" disabled={pending} onClick={() => setUndoing(r)}>
                    <Undo2Icon aria-hidden /> Unmerge…
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {undoing ? (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border p-3">
          <Label htmlFor="unmerge-reason">
            Why is <span className="font-mono">{undoing.patientNumber}</span> a different patient? *
          </Label>
          <Textarea id="unmerge-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-meta text-muted-foreground">
            {undoing.patientNumber} gets its previous status back with everything filed under it. What was recorded on this record since the merge stays here —
            check it and correct anything that belongs to the other patient.
          </p>
          <span className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || reason.trim().length < 5}>
              Unmerge {undoing.patientNumber}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setUndoing(null)}>
              Cancel
            </Button>
          </span>
        </form>
      ) : null}
      {history?.length ? (
        <details>
          <summary className="cursor-pointer text-table text-primary">Merge history ({history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-table">
            {history.map((h) => (
              <li key={h.id}>
                <span className="tabular text-muted-foreground">{clinicalDateTime(h.performedAt)}</span> · {ACTION_LABEL[h.action]}{" "}
                <span className="font-mono">{h.retired.patientNumber}</span> {h.action === "unmerged" ? "from" : "into"}{" "}
                <span className="font-mono">{h.survivor.patientNumber}</span> by {h.performedBy.name ?? "a staff member"} — {h.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
