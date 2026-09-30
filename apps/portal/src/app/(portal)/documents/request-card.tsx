"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CircleSlashIcon, ClockIcon, FileTextIcon, XCircleIcon } from "lucide-react";
import type { PortalRecordsRequest } from "@/lib/api/types";
import { requestOpen, requestState, type RequestTone, SCOPE_TEXT } from "@/lib/documents";
import { formatCalendarDate } from "@/lib/greeting";
import { withdrawRecordsRequest } from "./actions";
import { OpenFile } from "./open-file";

const TONE: Record<RequestTone, { className: string; Icon: typeof ClockIcon }> = {
  waiting: { className: "bg-warning-subtle text-warning-foreground", Icon: ClockIcon },
  done: { className: "bg-success-subtle text-success-foreground", Icon: CheckCircle2Icon },
  declined: { className: "bg-danger-subtle text-danger-foreground", Icon: XCircleIcon },
  closed: { className: "bg-muted text-muted-foreground", Icon: CircleSlashIcon },
};

export function RequestCard({ request }: { request: PortalRecordsRequest }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const state = requestState(request.status);
  const { className, Icon } = TONE[state.tone];
  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{request.scope.map((s) => SCOPE_TEXT[s]).join(", ")}</h3>
        <span className="text-meta text-muted-foreground">
          {request.requestNumber} · sent {formatCalendarDate(request.submittedAt.slice(0, 10))}
        </span>
      </div>
      {request.periodFrom || request.periodTo ? (
        <p className="text-meta text-muted-foreground">
          Period: {request.periodFrom ? formatCalendarDate(request.periodFrom) : "the beginning"} to{" "}
          {request.periodTo ? formatCalendarDate(request.periodTo) : "now"}
        </p>
      ) : null}
      {request.details ? <p className="text-meta text-muted-foreground">{request.details}</p> : null}
      {request.respondBy && (request.status === "submitted" || request.status === "in_review") ? (
        <p className="text-meta text-muted-foreground">The clinic aims to answer by {formatCalendarDate(request.respondBy)}.</p>
      ) : null}
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-meta font-medium ${className}`}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {state.text}
      </span>
      {request.responseNote ? (
        <p className="rounded-lg bg-muted/60 p-2 text-body">
          <span className="font-medium">{request.status === "declined" ? "Reason: " : "From the records office: "}</span>
          {request.responseNote}
        </p>
      ) : null}
      {request.documents.length ? (
        <ul className="flex flex-col gap-2">
          {request.documents.map((d) => (
            <li key={d.documentId} className="flex items-center gap-3">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">{d.title}</span>
              <OpenFile kind="shared" id={d.documentId} label="Download" />
            </li>
          ))}
        </ul>
      ) : null}
      {requestOpen(request.status) ? (
        <div>
          <button
            type="button"
            disabled={pending}
            className="text-meta text-primary underline-offset-2 hover:underline disabled:opacity-60"
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await withdrawRecordsRequest(request.id);
                if (result.ok) router.refresh();
                else setError(result.message);
              })
            }
          >
            Withdraw this request
          </button>
          {error ? (
            <p role="alert" className="text-meta text-danger-foreground">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
