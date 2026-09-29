"use client";

import * as React from "react";
import { CheckCircle2Icon, CircleSlashIcon, HistoryIcon } from "lucide-react";
import { Button } from "@healthcare/ui/primitives";
import type { PortalConsent } from "@/lib/api/types";
import { CONSENT_STATE_TEXT, CONSENT_TEXT, consentMessage, consentState, WITHDRAW_EFFECT } from "@/lib/consents";
import { resultDate } from "@/lib/records";
import { withdrawConsent } from "./actions";

const DECISION = { granted: "Given", refused: "Not given", withdrawn: "Withdrawn" } as const;

/** One consent: what it covers, where it stands, its history, and — for those MyHealth offers — withdrawal after confirming. */
export function ConsentCard({ consent, timeZone }: { consent: PortalConsent; timeZone: string }) {
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const text = CONSENT_TEXT[consent.consentType];
  const state = consentState(consent);
  const given = state === "given";
  const withdraw = () =>
    startTransition(async () => {
      setError(null);
      const result = await withdrawConsent(consent.consentType);
      if (result.ok) setConfirming(false);
      else setError(consentMessage(result.code, result.message));
    });
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{text.title}</span>
        <span className={`flex items-center gap-1.5 text-body font-medium ${given ? "text-success-foreground" : "text-muted-foreground"}`}>
          {given ? <CheckCircle2Icon className="size-4" aria-hidden /> : <CircleSlashIcon className="size-4" aria-hidden />}
          {CONSENT_STATE_TEXT[state]}
        </span>
      </div>
      <p className="text-body text-muted-foreground">{text.about}</p>
      <details className="text-body">
        <summary className="flex cursor-pointer items-center gap-1.5 text-primary">
          <HistoryIcon className="size-4" aria-hidden />
          History
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {consent.history.map((h) => (
            <li key={h.id} className="text-meta text-muted-foreground">
              {DECISION[h.decision]} {resultDate(h.effectiveAt, timeZone)}
              {h.expiresAt ? ` · until ${resultDate(h.expiresAt, timeZone)}` : ""} · {h.recordedVia === "myhealth" ? "by you in MyHealth" : "at the clinic"}
            </li>
          ))}
        </ul>
      </details>
      {consent.canWithdraw ? (
        confirming ? (
          <div role="group" aria-label="Confirm withdrawal" className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-subtle p-3">
            <p className="text-body text-warning-foreground">{WITHDRAW_EFFECT[consent.consentType]}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" onClick={withdraw} disabled={pending}>
                {pending ? "Withdrawing…" : "Yes, withdraw my consent"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setConfirming(true)}>
            Withdraw consent
          </Button>
        )
      ) : given ? (
        <p className="text-meta text-muted-foreground">To withdraw this consent, talk to the clinic.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
