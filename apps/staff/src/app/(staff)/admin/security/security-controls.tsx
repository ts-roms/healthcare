"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, toast } from "@healthcare/ui/primitives";
import { exemptFromMfa, removeMfaExemption, resetMemberMfa, setMfaRequired } from "./actions";

/** Require two-step verification for staff, or stop requiring it; an optional reason goes to the audit trail. */
export function MfaPolicyToggle({ required, version, ownMfaEnabled }: { required: boolean; version: number; ownMfaEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!required && !ownMfaEnabled) {
    return <p className="text-meta text-muted-foreground">Turn on two-step verification for your own account (My account) before requiring it for staff.</p>;
  }
  if (!open) {
    return (
      <Button size="sm" variant={required ? "outline" : "default"} className="self-start" onClick={() => setOpen(true)}>
        {required ? "Stop requiring it…" : "Require it for all staff…"}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await setMfaRequired(!required, version, reason);
          if (result.ok) {
            toast.success(required ? "Two-step verification is no longer required" : "Two-step verification is now required");
            setOpen(false);
            setReason("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <p>
        {required
          ? "Staff will be able to turn their two-step verification off again."
          : "Staff without it can sign in only to set it up, starting with their next page. Exempt integration accounts first (for example the instrument gateway's)."}
      </p>
      <Label htmlFor="policy-reason">Reason (optional)</Label>
      <Input id="policy-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={required ? "destructive" : "default"} disabled={pending}>
          {pending ? "Saving…" : required ? "Stop requiring" : "Require"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Exempt a member from the requirement (an integration account that cannot use an authenticator), or remove it. */
export function MfaExemptionControl({ userId, exempt }: { userId: string; exempt: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (exempt) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await removeMfaExemption(userId);
            if (result.ok) {
              toast.success("Exemption removed");
              router.refresh();
            } else toast.error(result.message);
          })
        }
      >
        {pending ? "Removing…" : "Remove exemption"}
      </Button>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Exempt from two-step verification…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await exemptFromMfa(userId, reason);
          if (result.ok) {
            toast.success("Exempted");
            setOpen(false);
            setReason("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <Label htmlFor={`exempt-${userId}`}>Why? (for example “Instrument gateway integration account”)</Label>
      <Input id={`exempt-${userId}`} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Exempt"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Turn off a member's two-step verification after a lost or replaced phone; their sessions end and they set it up again. */
export function ResetMfaButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Reset two-step verification…
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await resetMemberMfa(userId, reason);
          if (result.ok) {
            toast.success("Reset; they are signed out and set it up again at their next sign-in");
            setOpen(false);
            setReason("");
            router.refresh();
          } else toast.error(result.message);
        });
      }}
    >
      <p className="text-meta text-muted-foreground">Check who is asking first (in person or by a call you place). They are signed out everywhere at once.</p>
      <Label htmlFor={`reset-${userId}`}>Reason</Label>
      <Input id={`reset-${userId}`} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {pending ? "Resetting…" : "Reset"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
