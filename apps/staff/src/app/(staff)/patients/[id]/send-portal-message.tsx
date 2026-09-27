"use client";

import * as React from "react";
import { SendIcon } from "lucide-react";
import { Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import { sendPortalMessage } from "./portal-actions";

/**
 * A short message to the patient's MyHealth inbox (e.g. "Please bring your
 * previous results"). It stays inside MyHealth, behind sign-in; the patient
 * cannot reply there yet. Audited by the API.
 */
export function SendPortalMessage({ patientId }: { patientId: string }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [attemptId, setAttemptId] = React.useState(() => crypto.randomUUID());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await sendPortalMessage(patientId, { title, body, attemptId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Message sent to MyHealth");
      setTitle("");
      setBody("");
      setAttemptId(crypto.randomUUID());
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SendIcon /> Message in MyHealth
      </Button>
    );
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="message-title">Subject</Label>
        <Input id="message-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="message-body">Message</Label>
        <Textarea id="message-body" value={body} maxLength={2000} rows={4} onChange={(e) => setBody(e.target.value)} required />
        <p className="text-meta text-muted-foreground">
          The patient reads this after signing in to MyHealth and cannot reply there. Do not use it for urgent or sensitive results — call the patient.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-table text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
