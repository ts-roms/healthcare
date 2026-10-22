"use client";

import * as React from "react";
import { SendIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { clinicalTime } from "../lib/format";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";

export interface ConsultChatMessage {
  id: string;
  sender: "patient" | "staff";
  /** As shown to the other side. */
  name: string;
  body: string;
  /** ISO time the message was sent. */
  sentAt: string;
}

export interface ConsultChatProps {
  messages: ConsultChatMessage[];
  /** Which side this screen is: its messages are drawn on the right. */
  mine: "patient" | "staff";
  /** Whether messages can be sent now (from the waiting room until the call ends). */
  open: boolean;
  /** Sends one message; resolves to an error message to show, or null when it was sent. */
  onSend: (text: string) => Promise<string | null>;
  className?: string;
}

const MAX_LENGTH = 1000;

/**
 * The text chat of an online consultation: a plain conversation between the patient and the clinician, the fallback when
 * video fails. It keeps nothing itself — the screen around it loads and sends the messages (so the API stays the only place
 * that decides who may write and when). Who sent what is shown by name and side, never by colour alone.
 */
export function ConsultChat({ messages, mine, open, onSend, className }: ConsultChatProps) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const logRef = React.useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  React.useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || pending) return;
    startTransition(async () => {
      const failure = await onSend(body);
      if (failure) setError(failure);
      else {
        setError(null);
        setText("");
      }
    });
  };

  return (
    <section aria-label="Chat" className={cn("flex min-h-0 flex-col gap-2 rounded-lg border bg-card p-3", className)}>
      <h3 className="text-table font-semibold">Chat</h3>
      <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" tabIndex={0} className="flex max-h-64 min-h-24 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            {open ? "No messages yet. Use the chat if the video does not work, or to share a number or a spelling." : "The chat opens when the patient is in the waiting room."}
          </p>
        ) : (
          messages.map((m) => {
            const own = m.sender === mine;
            return (
              <div key={m.id} className={cn("flex max-w-[85%] flex-col gap-0.5 rounded-lg px-3 py-1.5", own ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted")}>
                <span className={cn("text-meta", own ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {own ? "You" : m.name} · {clinicalTime(m.sentAt)}
                </span>
                <span className="text-body break-words whitespace-pre-wrap">{m.body}</span>
              </div>
            );
          })
        )}
      </div>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="Message"
          value={text}
          maxLength={MAX_LENGTH}
          disabled={!open || pending}
          placeholder={open ? "Write a message…" : "The chat is closed"}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="icon" aria-label="Send message" disabled={!open || pending || !text.trim()}>
          <SendIcon aria-hidden />
        </Button>
      </form>
      {open ? null : <p className="text-meta text-muted-foreground">The chat is open from the waiting room until the call ends. Earlier messages stay readable.</p>}
    </section>
  );
}
