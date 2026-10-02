"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, toast } from "@healthcare/ui/primitives";
import type { NotificationStatus } from "@/lib/api/types";
import { cancelMessage, resendMessage } from "@/app/(staff)/communications/actions";

const RESENDABLE: NotificationStatus[] = ["failed", "cancelled", "suppressed"];

/**
 * Cancel (queued) or Resend (failed, cancelled, suppressed) a message to a patient from the log, with a reason. The
 * API decides what is allowed (`notification.manage`, the 30-day window, never security messages) and audits it.
 */
export function MessageActions({
  notificationId,
  status,
  patientId,
  resentAs,
}: {
  notificationId: string;
  status: NotificationStatus;
  patientId: string | null;
  resentAs?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<"cancel" | "resend" | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const kind = status === "queued" ? "cancel" : RESENDABLE.includes(status) && !resentAs ? "resend" : null;
  if (!kind) return null;

  const run = () =>
    startTransition(async () => {
      const result = kind === "cancel" ? await cancelMessage(notificationId, reason, patientId) : await resendMessage(notificationId, reason, patientId);
      if (!result.ok) return void toast.error(result.message);
      toast.success(kind === "cancel" ? "Message cancelled" : result.data.status === "queued" ? "Message queued again" : `Not sent: ${result.data.status}`);
      setOpen(null);
      setReason("");
      router.refresh();
    });

  if (open) {
    return (
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Input
          aria-label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          minLength={3}
          maxLength={500}
          required
          className="h-8"
        />
        <div className="flex gap-1">
          <Button type="submit" size="xs" disabled={pending || reason.trim().length < 3}>
            {pending ? "Working…" : kind === "cancel" ? "Cancel message" : "Send again"}
          </Button>
          <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setOpen(null)}>
            Keep
          </Button>
        </div>
      </form>
    );
  }
  return (
    <Button type="button" size="xs" variant="outline" onClick={() => setOpen(kind)}>
      {kind === "cancel" ? "Cancel…" : "Send again…"}
    </Button>
  );
}
