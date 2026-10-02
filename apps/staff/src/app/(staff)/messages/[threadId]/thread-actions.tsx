"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { PatientThreadDetail } from "@/lib/api/types";
import { attachmentProblem, MESSAGE_ATTACHMENT_TYPES, MESSAGE_ATTACHMENTS_MAX } from "@/lib/messaging-mapping";
import { assignThread, replyToPatient, setThreadOpen } from "../actions";

/** Reply, take or release the conversation, close or reopen it. The API checks the permission and the conversation's state. */
export function ThreadActions({ thread, canManage }: { thread: PatientThreadDetail; canManage: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  if (!canManage) return <p className="text-meta text-muted-foreground">You can read this conversation but not reply.</p>;

  const run = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await call();
      if (!result.ok) return setError(result.message);
      after?.();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {thread.status === "open" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const problem = attachmentProblem(files);
            if (problem) return setError(problem);
            const form = new FormData();
            form.set("patientId", thread.patientId);
            for (const file of files) form.append("files", file);
            run(
              () => replyToPatient(thread.id, body, form),
              () => {
                setBody("");
                setFiles([]);
                if (fileInput.current) fileInput.current.value = "";
                toast.success("Reply sent");
              },
            );
          }}
          className="flex flex-col gap-2"
        >
          <Label htmlFor="reply">Reply</Label>
          <Textarea id="reply" rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required />
          <p className="text-meta text-muted-foreground">
            Plain words the patient will understand. Do not put results or urgent instructions here — call the patient.
          </p>
          <Label htmlFor="reply-files">Attach files (optional)</Label>
          <Input
            id="reply-files"
            ref={fileInput}
            type="file"
            multiple
            accept={MESSAGE_ATTACHMENT_TYPES.join(",")}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            aria-describedby="reply-files-help"
          />
          <p id="reply-files-help" className="text-meta text-muted-foreground">
            Up to {MESSAGE_ATTACHMENTS_MAX} images or PDF files of 10 MB or less. They are filed in the patient&apos;s record as attachments.
          </p>
          <div>
            <Button type="submit" size="sm" disabled={pending || body.trim().length === 0}>
              {pending ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => assignThread(thread.id, !thread.assignedTo))}>
          {thread.assignedTo ? "Release" : "Assign to me"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setThreadOpen(thread.id, thread.status === "closed"))}>
          {thread.status === "closed" ? "Reopen" : "Close conversation"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-table text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
