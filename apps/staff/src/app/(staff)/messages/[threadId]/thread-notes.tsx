"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { PatientThreadNote } from "@/lib/api/types";
import { addThreadNote } from "../actions";

/** Staff-only notes on a conversation (migration 0097): never shown to the patient, never edited or deleted. */
export function ThreadNotes({ threadId, notes, canManage }: { threadId: string; notes: PatientThreadNote[]; canManage: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-meta text-muted-foreground">Only the clinic&apos;s staff see these. The patient never does.</p>
        {notes.length ? (
          <ol className="flex flex-col gap-2" aria-label="Internal notes">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border border-dashed bg-muted/40 p-2">
                <p className="flex items-baseline justify-between gap-3 text-meta text-muted-foreground">
                  <span className="font-medium">{n.authorName ?? "Staff"}</span>
                  <time dateTime={n.createdAt}>{clinicalDateTime(n.createdAt)}</time>
                </p>
                <p className="text-table whitespace-pre-line">{n.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-table text-muted-foreground">No notes yet.</p>
        )}
        {canManage ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                setError(null);
                const result = await addThreadNote(threadId, body);
                if (!result.ok) return setError(result.message);
                setBody("");
                toast.success("Note added");
                router.refresh();
              });
            }}
          >
            <Label htmlFor="note">Add a note</Label>
            <Textarea id="note" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
            {error ? (
              <p role="alert" className="text-table text-destructive">
                {error}
              </p>
            ) : null}
            <div>
              <Button type="submit" size="sm" variant="outline" disabled={pending || body.trim().length === 0}>
                {pending ? "Saving…" : "Add note"}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
