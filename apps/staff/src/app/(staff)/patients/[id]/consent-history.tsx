"use client";

import * as React from "react";
import { HistoryIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button } from "@healthcare/ui/primitives";
import type { PatientConsent } from "@/lib/api/types";
import { CONSENT_CAPTURE, CONSENT_DECISIONS, consentTypeLabel } from "@/lib/consent-form";
import { loadConsentHistory } from "./consent-actions";

/** Every consent decision ever recorded (append-only), fetched when asked for. */
export function ConsentHistory({ patientId }: { patientId: string }) {
  const [history, setHistory] = React.useState<PatientConsent[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const load = () =>
    startTransition(async () => {
      setError(null);
      const result = await loadConsentHistory(patientId);
      if (result.ok) setHistory([...result.data].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)));
      else setError(result.message);
    });

  if (!history) {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" className="self-start" onClick={load} disabled={pending}>
          <HistoryIcon aria-hidden /> {pending ? "Loading…" : "Show consent history"}
        </Button>
        {error ? (
          <p role="alert" className="text-table text-danger-foreground">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-label="Consent history" className="text-table">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">History ({history.length})</h3>
        <Button variant="ghost" size="sm" onClick={() => setHistory(null)}>
          Hide
        </Button>
      </div>
      <ol className="mt-1 flex flex-col gap-1 border-l pl-3">
        {history.map((c) => (
          <li key={c.id}>
            <span className="tabular text-muted-foreground">{clinicalDateTime(c.recordedAt)}</span> · {consentTypeLabel(c.consentType)}:{" "}
            <span className="font-medium">{CONSENT_DECISIONS[c.decision as keyof typeof CONSENT_DECISIONS] ?? c.decision}</span>
            <span className="text-muted-foreground">
              {" "}
              · {CONSENT_CAPTURE[c.capturedVia as keyof typeof CONSENT_CAPTURE] ?? c.capturedVia}
              {c.expiresAt ? ` · until ${clinicalDate(c.expiresAt)}` : ""}
            </span>
            {c.notes ? <p className="text-muted-foreground">{c.notes}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
