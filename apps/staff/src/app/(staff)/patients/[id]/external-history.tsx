"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BanIcon, FileInputIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, toast } from "@healthcare/ui/primitives";
import type { ExternalHistoryEntry } from "@/lib/api/types";
import { markExternalHistoryInError } from "./external-history-actions";

const KIND_LABEL: Record<ExternalHistoryEntry["kind"], string> = {
  condition: "Condition",
  observation: "Observation",
  medication: "Medication",
  document: "Document",
};

/**
 * What other providers recorded, accepted from imports. Labelled as external everywhere: these are not the
 * platform's own diagnoses, results, vital signs or prescriptions.
 */
export function ExternalHistory({ patientId, entries, canCorrect }: { patientId: string; entries: ExternalHistoryEntry[]; canCorrect: boolean }) {
  if (entries.length === 0) return <p className="text-body text-muted-foreground">No external history accepted from imports.</p>;
  return (
    <ul className="flex flex-col divide-y">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 py-2 first:pt-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              <FileInputIcon aria-hidden /> External · {KIND_LABEL[e.kind]}
            </Badge>
            <span className={e.status === "entered_in_error" ? "text-body line-through" : "text-body font-medium"}>{e.display}</span>
            {e.valueText ? <span className="text-body">{e.valueText}</span> : null}
            {e.status === "entered_in_error" ? (
              <Badge variant="neutral">
                <BanIcon aria-hidden /> Entered in error
              </Badge>
            ) : null}
          </span>
          <span className="text-meta text-muted-foreground">
            {[
              e.category?.replace(/_/g, " "),
              e.statusText ? `status: ${e.statusText}` : null,
              e.effectiveText ? `date: ${e.effectiveText}` : null,
              e.code ? `code ${e.code}` : null,
              `from ${e.declaredSource ?? "an undeclared source"}`,
              `accepted ${clinicalDateTime(e.recordedAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {e.enteredInErrorReason ? <span className="text-meta">Reason: {e.enteredInErrorReason}</span> : null}
          {canCorrect && e.status === "active" ? <MarkInError patientId={patientId} entryId={e.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

function MarkInError({ patientId, entryId }: { patientId: string; entryId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!open) {
    return (
      <Button type="button" size="xs" variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        Entered in error…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await markExternalHistoryInError({ patientId, entryId, reason });
          if (result.ok) {
            toast.success("Marked entered in error");
            setOpen(false);
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <Input aria-label="Reason" placeholder="Reason" className="h-7 w-64" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
        Confirm
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
