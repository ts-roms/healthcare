"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/records-mapping";
import { cancelIntegrityRun, resolveIntegrityFinding, startIntegrityRun } from "./actions";

type Result = { ok: true } | { ok: false; message: string };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = (call: () => Promise<Result>, success: string, done?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        done?.();
        router.refresh();
      } else toast.error(result.message);
    });
  return { pending, run };
}

/** Start a review of every available document, or of one category. */
export function StartRunForm({ disabled }: { disabled: boolean }) {
  const { pending, run } = useRun();
  const [category, setCategory] = React.useState("");
  return (
    <form
      className="grid gap-2 sm:grid-cols-[16rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => startIntegrityRun({ category }),
          "Integrity review started",
          () => setCategory(""),
        );
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="int-category">Documents to check</Label>
        <NativeSelect id="int-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(DOCUMENT_CATEGORY_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending || disabled}>
        Start review
      </Button>
    </form>
  );
}

export function CancelRunButton({ runId }: { runId: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => cancelIntegrityRun({ runId }), "Review stopped")}>
      Stop
    </Button>
  );
}

/** Record what the records office decided about a finding; the document is served again afterwards. */
export function ResolveFindingForm({ findingId }: { findingId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  if (!open) {
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Resolve…
      </Button>
    );
  }
  return (
    <form
      className="grid w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => resolveIntegrityFinding({ findingId, note }),
          "Finding resolved",
          () => {
            setOpen(false);
            setNote("");
          },
        );
      }}
    >
      <Label htmlFor={`note-${findingId}`} className="sr-only">
        What was decided
      </Label>
      <Textarea
        id={`note-${findingId}`}
        rows={2}
        maxLength={500}
        placeholder="What was found and decided, e.g. restored from the backup of 3 Oct and checked; or archived as unusable"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={pending || note.trim().length < 5}>
          Record decision
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
