"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SendIcon } from "lucide-react";
import { Button, DateInput, Input, Textarea } from "@healthcare/ui/primitives";
import { outsideResultFileProblem } from "@/lib/documents";
import { sendOutsideResult } from "./actions";

/** Sending the clinic a result from another laboratory or hospital: the report, where it is from and what it was. */
export function OutsideResultForm({ canSend }: { canSend: boolean }) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  if (!canSend) {
    return <p className="text-meta text-muted-foreground">You have 3 results waiting. You can send another once the records office answers one.</p>;
  }
  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {sent ? (
          <p role="status" className="rounded-lg bg-success-subtle p-2 text-body text-success-foreground">
            Sent. You will get a message when the records office answers.
          </p>
        ) : null}
        <Button type="button" onClick={() => setOpen(true)} className="h-10 w-fit gap-2 px-4">
          Send a result
        </Button>
      </div>
    );
  }
  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const file = data.get("file");
        if (!(file instanceof File) || file.size === 0) return setError("Choose the report to send.");
        const problem = outsideResultFileProblem(file);
        if (problem) return setError(problem);
        startTransition(async () => {
          setError(null);
          const result = await sendOutsideResult(data);
          if (result.ok) {
            setSent(true);
            setOpen(false);
            router.refresh();
          } else setError(result.message);
        });
      }}
    >
      <p className="text-meta text-muted-foreground">
        Send a PDF or a clear photo of a result from another laboratory or hospital. The records office reads it and adds it to your record, or tells you why it
        cannot. It is not part of your record until then, and the clinic does not take it as an emergency message.
      </p>
      <label className="flex flex-col gap-1 text-meta">
        The report (PDF or photo, up to 10 MB)
        <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/heic" className="h-10" required />
      </label>
      <label className="flex flex-col gap-1 text-meta">
        Which laboratory or hospital is it from?
        <Input name="sourceName" maxLength={200} className="h-10" required />
      </label>
      <label className="flex flex-col gap-1 text-meta">
        What was the test?
        <Input name="tests" maxLength={500} placeholder="e.g. Blood sugar, chest X-ray" className="h-10" required />
      </label>
      <label className="flex flex-col gap-1 text-meta">
        The day it was done (optional)
        <DateInput name="performedOn" className="h-10" />
      </label>
      <label className="flex flex-col gap-1 text-meta">
        Anything the clinic should know (optional)
        <Textarea name="notes" rows={2} maxLength={1000} />
      </label>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="h-10 gap-2 px-4">
          <SendIcon className="size-4" aria-hidden /> {pending ? "Sending…" : "Send"}
        </Button>
        <Button type="button" variant="ghost" className="h-10 px-4" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
