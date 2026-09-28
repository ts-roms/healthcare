"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, LinkIcon, UserPlusIcon, XIcon } from "lucide-react";
import { Badge, Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import { acceptEntry, matchPatient, registerPatientFromImport, rejectEntry, rejectImport } from "../actions";

type Result = { ok: true } | { ok: false; message: string; code?: string; details?: unknown };

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = (call: () => Promise<Result>, success: string, onFailure?: (result: Extract<Result, { ok: false }>) => boolean) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else if (!onFailure?.(result)) toast.error(result.message);
    });
  return { pending, run };
}

/** Accept (written by the owning domain for the matched patient) or reject with a reason. */
export function EntryActions({
  importId,
  entryId,
  canAccept,
  acceptHint,
  acceptLabel,
}: {
  importId: string;
  entryId: string;
  canAccept: boolean;
  acceptHint: string | null;
  acceptLabel: string;
}) {
  const { pending, run } = useAction();
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (rejecting) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => rejectEntry({ importId, entryId, reason }), "Entry rejected");
        }}
      >
        <Input
          aria-label="Reason for rejecting"
          placeholder="Reason"
          className="h-7 w-56"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" size="xs" variant="destructive" disabled={pending || reason.trim().length < 3}>
          Reject
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setRejecting(false)}>
          Cancel
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="xs"
          disabled={pending || !canAccept}
          onClick={() => run(() => acceptEntry({ importId, entryId }), "Accepted into the record")}
        >
          <CheckIcon /> {acceptLabel}
        </Button>
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
          <XIcon /> Reject…
        </Button>
      </div>
      {acceptHint ? <p className="max-w-64 text-right text-meta text-muted-foreground">{acceptHint}</p> : null}
    </div>
  );
}

/** Links the import to this patient (a reviewer's decision; nothing is linked automatically). */
export function MatchButton({ importId, patientId, version, label = "Match" }: { importId: string; patientId: string; version: number; label?: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() => run(() => matchPatient({ importId, patientId, version }), "Patient matched")}
    >
      <LinkIcon /> {label}
    </Button>
  );
}

interface DuplicateCandidate {
  level: string;
  patient: { id: string; patientNumber: string; displayName: string; birthDate: string };
}

function candidatesOf(details: unknown): DuplicateCandidate[] {
  const list = (details as { candidates?: unknown } | undefined)?.candidates;
  return Array.isArray(list) ? (list as DuplicateCandidate[]) : [];
}

/**
 * Registers a new patient from the imported demographics through the normal registration: possible duplicates are
 * shown and must be reviewed with a reason, exactly as on the registration form.
 */
export function RegisterFromImport({ importId, version }: { importId: string; version: number }) {
  const { pending, run } = useAction();
  const [duplicates, setDuplicates] = React.useState<DuplicateCandidate[] | null>(null);
  const [reason, setReason] = React.useState("");
  const submit = (override?: { reviewedCandidateIds: string[]; reason: string }) =>
    run(
      () => registerPatientFromImport({ importId, version, ...(override ? { duplicateOverride: override } : {}) }),
      "Patient registered and matched",
      (failure) => {
        if (failure.code === "possible_duplicates") {
          setDuplicates(candidatesOf(failure.details));
          return true;
        }
        return false;
      },
    );
  if (!duplicates) {
    return (
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => submit()}>
        <UserPlusIcon /> Register as a new patient
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ reviewedCandidateIds: duplicates.map((d) => d.patient.id), reason });
      }}
    >
      <p className="text-table font-medium">Possible duplicates — check these first. If one is the same person, match them instead.</p>
      <ul className="flex flex-col gap-1 text-body">
        {duplicates.map((d) => (
          <li key={d.patient.id} className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">{d.level}</Badge>
            {d.patient.displayName} <span className="text-muted-foreground">· {d.patient.patientNumber}</span>
            <MatchButton importId={importId} patientId={d.patient.id} version={version} label="Match this patient" />
          </li>
        ))}
      </ul>
      <Label htmlFor="duplicate-reason">Why is the imported patient a different person?</Label>
      <Textarea id="duplicate-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} rows={2} />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={pending || reason.trim().length < 5}>
          Register anyway
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDuplicates(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Rejects every entry still to review, with one reason, and closes the import. */
export function RejectImport({ importId, version }: { importId: string; version: number }) {
  const { pending, run } = useAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <XIcon /> Reject the rest…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => rejectImport({ importId, version, reason }), "Import closed");
      }}
    >
      <Input
        aria-label="Reason for rejecting the remaining entries"
        placeholder="Reason (e.g. not our patient)"
        className="h-8 w-72"
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" size="sm" variant="destructive" disabled={pending || reason.trim().length < 3}>
        Reject remaining entries
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
