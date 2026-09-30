"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Textarea } from "@healthcare/ui/primitives";
import { BODY_MAX, charactersLeft, conversationMessage } from "@/lib/conversations";
import { replyInConversation } from "../conversation-actions";

/** Writes in an open conversation; the page refreshes to show it. */
export function ReplyForm({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const left = charactersLeft(body);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const result = await replyInConversation(threadId, body);
      if (result.ok) {
        setBody("");
        router.refresh();
      } else setError(conversationMessage(result.code, result.message));
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor="reply">Write a reply</Label>
      <Textarea id="reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required aria-describedby="reply-left" />
      <p id="reply-left" className={`text-meta ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}>
        {left < 0 ? `${-left} characters too many` : `${left.toLocaleString("en")} of ${BODY_MAX.toLocaleString("en")} characters left`}
      </p>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="self-start" disabled={pending || left < 0 || body.trim().length === 0}>
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
