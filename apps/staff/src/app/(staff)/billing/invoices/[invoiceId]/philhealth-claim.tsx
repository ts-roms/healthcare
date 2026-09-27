"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CircleAlertIcon, PlugZapIcon, SendIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@healthcare/ui/primitives";
import type { ClaimExchange, PhilHealthClaimPreview } from "@/lib/api/types";
import { peso } from "@/lib/billing-mapping";
import { requestPhilHealthSubmission } from "../../actions";

const EXCHANGE_VARIANT: Record<ClaimExchange["status"], "success" | "warning" | "danger" | "neutral" | "info"> = {
  queued: "info",
  accepted: "success",
  rejected: "danger",
  failed: "danger",
  not_configured: "neutral",
};

const EXCHANGE_LABEL: Record<ClaimExchange["status"], string> = {
  queued: "Queued",
  accepted: "Acknowledged by PhilHealth",
  rejected: "Rejected",
  failed: "Failed",
  not_configured: "Not sent (not connected)",
};

/**
 * The PhilHealth claim of an issued invoice: what the platform can prepare from
 * its own records and what is still missing. eClaims is an integration
 * dependency (no official specification), so while it is not connected the claim
 * is filed through PhilHealth's own channel and the reference recorded on the
 * coverage line.
 */
export function PhilHealthClaim({ preview, canSubmit }: { preview: PhilHealthClaimPreview; canSubmit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const connected = preview.integration.status !== "dependency";
  const inFlight = preview.submissions.some((s) => s.status === "queued" || s.status === "accepted");
  const claim = preview.claim;

  const submit = () =>
    startTransition(async () => {
      const result = await requestPhilHealthSubmission({ invoiceId: preview.invoiceId, idempotencyKey: key });
      if (result.ok) {
        toast.success("Claim queued for submission");
        setKey(crypto.randomUUID());
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>PhilHealth claim</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-body">
        {connected ? null : (
          <p className="flex gap-2 rounded-md border border-warning bg-warning-subtle p-2 text-meta text-warning-foreground">
            <PlugZapIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong>eClaims not connected.</strong> The official PhilHealth specification has not been obtained, so nothing is sent from here. File the claim
              through PhilHealth&apos;s own channel, then record its reference with &ldquo;Submitted&rdquo; on the coverage line.
            </span>
          </p>
        )}
        <ul className="flex flex-col gap-1" aria-label="What the claim needs">
          {preview.checks.map((c) => (
            <li key={c.code} className="flex items-start gap-2 text-meta">
              {c.ok ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
              )}
              <span>
                <span className="sr-only">{c.ok ? "Done: " : "Missing: "}</span>
                {c.message}
                {c.ok ? null : <span className="text-muted-foreground"> — missing</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-meta text-muted-foreground">
          These check the clinic&apos;s own records only. PhilHealth&apos;s eligibility and benefit rules are applied by PhilHealth.
        </p>
        {claim ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
            <dt className="text-muted-foreground">Member PIN</dt>
            <dd>{claim.patient.philhealthPin}</dd>
            <dt className="text-muted-foreground">Accreditation</dt>
            <dd>{claim.facility.accreditationNumber}</dd>
            <dt className="text-muted-foreground">Services</dt>
            <dd>
              {clinicalDate(claim.servicePeriod.from)}
              {claim.servicePeriod.to !== claim.servicePeriod.from ? ` – ${clinicalDate(claim.servicePeriod.to)}` : null}
            </dd>
            <dt className="text-muted-foreground">Diagnoses</dt>
            <dd>{claim.diagnoses.map((d) => `${d.code}${d.primary ? " (primary)" : ""}`).join(", ")}</dd>
            <dt className="text-muted-foreground">Claimed</dt>
            <dd className="tabular-nums">{peso(claim.coverage.amountClaimed)}</dd>
          </dl>
        ) : null}
        {preview.submissions.length ? (
          <ul className="flex flex-col gap-1 text-meta" aria-label="Submissions">
            {preview.submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <Badge variant={EXCHANGE_VARIANT[s.status]}>{EXCHANGE_LABEL[s.status]}</Badge>
                <span className="text-muted-foreground">{clinicalDateTime(s.requestedAt)}</span>
                {s.externalReference ? <span>Ref. {s.externalReference}</span> : null}
                {s.outcomeDetail.reasons?.map((r) => (
                  <span key={r.code}>
                    {r.code}: {r.message}
                  </span>
                ))}
                {s.status === "failed" && s.lastError ? <span className="text-muted-foreground">{s.lastError}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {connected && canSubmit ? (
          <Button type="button" size="sm" className="self-start" disabled={pending || !preview.ready || inFlight} onClick={submit}>
            <SendIcon /> Submit to PhilHealth
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
