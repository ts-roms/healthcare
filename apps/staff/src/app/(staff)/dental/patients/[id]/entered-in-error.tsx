"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, toast } from "@healthcare/ui/primitives";

/**
 * Marks a dental record entered in error, with the reason. The record stays (struck through) and leaves the current
 * chart; nothing is deleted.
 */
export function EnteredInError({ what, onConfirm }: { what: string; onConfirm: (reason: string) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Entered in error…
      </Button>
    );
  }
  const confirm = () =>
    startTransition(async () => {
      const result = await onConfirm(reason);
      if (result.ok) {
        toast.success(`${what} marked entered in error`);
        setOpen(false);
        router.refresh();
      } else toast.error(result.message);
    });
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Input
        aria-label={`Why is this ${what.toLowerCase()} in error?`}
        placeholder="Reason (e.g. wrong tooth recorded)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="h-7 w-56"
        autoFocus
      />
      <Button size="xs" variant="destructive" onClick={confirm} disabled={pending || reason.trim().length < 5}>
        Confirm
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </span>
  );
}
