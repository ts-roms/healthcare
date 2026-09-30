"use client";

import * as React from "react";
import Link from "next/link";
import { SendIcon } from "lucide-react";
import { Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import { TOPIC_OPTIONS } from "@/lib/messaging-mapping";
import { startConversation } from "../../messages/actions";

/**
 * Starts a conversation with the patient in MyHealth (e.g. "Please bring your previous results"). The patient reads and
 * answers it there after signing in; a text or email tells them a message is waiting, never what it says. Audited by the API.
 */
export function SendPortalMessage({ patientId }: { patientId: string }) {
  const [open, setOpen] = React.useState(false);
  const [topic, setTopic] = React.useState<(typeof TOPIC_OPTIONS)[number]["value"]>("general");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [started, setStarted] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startConversation({ patientId, topic, subject, body });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Message sent to MyHealth");
      setSubject("");
      setBody("");
      setStarted(result.data.id);
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <SendIcon /> Message in MyHealth
        </Button>
        {started ? (
          <Link href={`/messages/${started}`} className="text-table text-primary hover:underline">
            Open the conversation
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="message-topic">About</Label>
        <select
          id="message-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value as typeof topic)}
          className="h-9 rounded-md border border-input bg-card px-2 text-body"
        >
          {TOPIC_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="message-title">Subject</Label>
        <Input id="message-title" value={subject} maxLength={100} onChange={(e) => setSubject(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="message-body">Message</Label>
        <Textarea id="message-body" value={body} maxLength={2000} rows={4} onChange={(e) => setBody(e.target.value)} required />
        <p className="text-meta text-muted-foreground">
          The patient reads this after signing in to MyHealth and can answer there. Do not use it for urgent or sensitive results — call the patient.
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
