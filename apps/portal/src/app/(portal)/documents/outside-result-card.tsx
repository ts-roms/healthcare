"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CircleSlashIcon, ClockIcon, XCircleIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalOutsideResult } from "@/lib/api/types";
import { type OutsideResultTone, outsideResultState } from "@/lib/documents";
import { formatCalendarDate } from "@/lib/greeting";
import { withdrawOutsideResult } from "./actions";
import { OpenFile } from "./open-file";

const TONE: Record<OutsideResultTone, { className: string; Icon: typeof ClockIcon }> = {
  waiting: { className: "bg-warning-subtle text-warning-foreground", Icon: ClockIcon },
  done: { className: "bg-success-subtle text-success-foreground", Icon: CheckCircle2Icon },
  declined: { className: "bg-danger-subtle text-danger-foreground", Icon: XCircleIcon },
  closed: { className: "bg-muted text-muted-foreground", Icon: CircleSlashIcon },
};

/** One result the patient sent: what they wrote, where it stands, the reason when declined, and withdrawing while it waits. */
export function OutsideResultCard({ result }: { result: PortalOutsideResult }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const state = outsideResultState(result.status);
  const { className, Icon } = TONE[state.tone];
  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{result.tests}</h3>
        <span className="text-meta text-muted-foreground">sent {formatCalendarDate(result.submittedAt.slice(0, 10))}</span>
      </div>
      <p className="text-meta text-muted-foreground">
        From {result.sourceName}
        {result.performedOn ? ` · done ${formatCalendarDate(result.performedOn)}` : ""}
      </p>
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-meta font-medium ${className}`}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {state.text}
      </span>
      {result.declineReason ? (
        <p className="rounded-lg bg-muted/60 p-2 text-body">
          <span className="font-medium">Reason: </span>
          {result.declineReason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <OpenFile kind="sent" id={result.id} label="My file" />
        {result.status === "submitted" ? (
          <div>
            <Button
              type="button"
              disabled={pending}
              variant="link"
              size="xs"
              className="h-auto px-0"
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const outcome = await withdrawOutsideResult(result.id);
                  if (outcome.ok) router.refresh();
                  else setError(outcome.message);
                })
              }
            >
              Take it back
            </Button>
            {error ? (
              <p role="alert" className="text-meta text-danger-foreground">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
