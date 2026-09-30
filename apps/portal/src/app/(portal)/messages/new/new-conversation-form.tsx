"use client";

import * as React from "react";
import { PhoneIcon } from "lucide-react";
import { Button, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import { BODY_MAX, charactersLeft, conversationMessage, NOT_FOR_EMERGENCIES, SUBJECT_MAX, TOPICS } from "@/lib/conversations";
import { startConversation } from "../conversation-actions";

/** Writes to the clinic. Says first that this is not for emergencies; the API limits open conversations and writing speed. */
export function NewConversationForm() {
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const left = charactersLeft(body);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await startConversation({ topic: String(form.get("topic") ?? ""), subject: String(form.get("subject") ?? ""), body });
      // A successful start redirects to the conversation; only a refusal comes back here.
      if (result && !result.ok) setError(conversationMessage(result.code, result.message));
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p role="note" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-subtle p-3 text-body text-warning-foreground">
        <PhoneIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {NOT_FOR_EMERGENCIES}
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="topic">What is it about?</Label>
        <NativeSelect id="topic" name="topic" required defaultValue="general" className="w-full [&>select]:h-11 [&>select]:pl-3">
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" required maxLength={SUBJECT_MAX} className="h-11" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="body">Your message</Label>
        <Textarea id="body" name="body" required rows={6} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="body-left" />
        <p id="body-left" className={`text-meta ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {left < 0 ? `${-left} characters too many` : `${left.toLocaleString("en")} of ${BODY_MAX.toLocaleString("en")} characters left`}. Please do not send
          photos or documents here.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || left < 0 || body.trim().length === 0}>
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
