"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SendIcon } from "lucide-react";
import { Button, Checkbox, Input, Textarea } from "@healthcare/ui/primitives";
import type { PortalRecordsScope } from "@/lib/api/types";
import { SCOPE_TEXT } from "@/lib/documents";
import { submitRecordsRequest } from "./actions";

const SCOPES = Object.keys(SCOPE_TEXT) as PortalRecordsScope[];

/** Asking the records office for copies: what, for which period, and why (optional). */
export function RecordsRequestForm({ canSubmit, notice, responseDays }: { canSubmit: boolean; notice: string | null; responseDays: number | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [scope, setScope] = React.useState<Set<PortalRecordsScope>>(new Set());
  const [f, setF] = React.useState({ periodFrom: "", periodTo: "", details: "", purpose: "" });
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string | null>(null);

  if (!canSubmit) {
    return <p className="text-meta text-muted-foreground">You have 3 requests waiting. You can send another once the records office answers one.</p>;
  }
  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {sent ? (
          <p role="status" className="rounded-lg bg-success-subtle p-2 text-body text-success-foreground">
            Request {sent} sent. You will get a message when the records office answers.
          </p>
        ) : null}
        <Button type="button" onClick={() => setOpen(true)} className="h-10 w-fit gap-2 px-4">
          Ask for copies of my records
        </Button>
      </div>
    );
  }
  const procedure =
    notice || responseDays ? (
      <div className="rounded-lg bg-muted p-3 text-meta">
        {notice ? <p className="whitespace-pre-line">{notice}</p> : null}
        {responseDays ? (
          <p className={notice ? "mt-1 text-muted-foreground" : "text-muted-foreground"}>
            The clinic aims to answer within {responseDays} day{responseDays === 1 ? "" : "s"}.
          </p>
        ) : null}
      </div>
    ) : null;
  const toggle = (s: PortalRecordsScope) => setScope((prev) => (prev.has(s) ? new Set([...prev].filter((x) => x !== s)) : new Set([...prev, s])));
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await submitRecordsRequest({
            scope: [...scope],
            periodFrom: f.periodFrom || undefined,
            periodTo: f.periodTo || undefined,
            details: f.details.trim() || undefined,
            purpose: f.purpose.trim() || undefined,
          });
          if (result.ok) {
            setSent(result.data.requestNumber);
            setOpen(false);
            setScope(new Set());
            setF({ periodFrom: "", periodTo: "", details: "", purpose: "" });
            router.refresh();
          } else setError(result.message);
        });
      }}
    >
      {procedure}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">What do you need copies of?</legend>
        {SCOPES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-body">
            <Checkbox checked={scope.has(s)} onCheckedChange={() => toggle(s)} />
            {SCOPE_TEXT[s]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-meta">
          From (optional)
          <Input type="date" className="h-10" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-meta">
          To (optional)
          <Input type="date" className="h-10" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-meta">
        Details {scope.has("other") ? "(say what else you need)" : "(optional)"}
        <Textarea rows={2} maxLength={1000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-meta">
        What you need them for (optional)
        <Input maxLength={300} className="h-10" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
      </label>
      {error ? (
        <p role="alert" className="text-meta text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || scope.size === 0} className="h-10 gap-2 px-4">
          <SendIcon className="size-4" aria-hidden /> Send request
        </Button>
        <Button type="button" variant="ghost" className="h-10 px-4" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
