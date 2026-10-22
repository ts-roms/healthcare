"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSignatureIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { cancelConsentSignatureRequest, requestConsentSignature } from "@/app/(staff)/clinic/procedure-actions";
import type { ConsentSignatureRequest, ProcedureDefinition } from "@/lib/api/types";

const STATUS = { pending: "Waiting for the signature", signed: "Signed", cancelled: "Cancelled" } as const;

/**
 * Consent forms the clinic asked the patient (or their guardian) to sign in MyHealth. The wording version is fixed when the
 * request is made; the signed form is stored on the patient record and linked when the procedure's consent is recorded.
 * For a minor the form is signed by a parent or guardian acting for them.
 */
export function SignatureRequests({
  patientId,
  requests,
  definitions,
  canRequest,
  portalEnabled,
}: {
  patientId: string;
  requests: ConsentSignatureRequest[];
  definitions: ProcedureDefinition[];
  canRequest: boolean;
  portalEnabled: boolean;
}) {
  const router = useRouter();
  const [definitionId, setDefinitionId] = React.useState("");
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const offered = definitions.filter((d) => d.status === "active" && d.consentWording);
  if (!portalEnabled && requests.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3" aria-label="Consent forms to sign in MyHealth">
      <h2 className="flex items-center gap-1.5 text-body font-semibold">
        <FileSignatureIcon className="size-4 text-muted-foreground" aria-hidden /> Consent forms to sign in MyHealth
      </h2>
      {requests.length === 0 ? <p className="text-table text-muted-foreground">No form has been sent for signature.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-table">
            <span className="font-medium">{r.procedureName}</span>
            <Badge variant="outline">{r.status === "pending" && r.expired ? "Expired" : STATUS[r.status]}</Badge>
            {r.representativeRequired ? <span className="text-meta text-muted-foreground">parent or guardian signs</span> : null}
            <span className="text-meta text-muted-foreground">
              {r.status === "signed" && r.signedAt ? `signed ${clinicalDateTime(r.signedAt)}` : `sent ${clinicalDateTime(r.requestedAt)}`}
              {r.status === "pending" && !r.expired ? `, open until ${clinicalDateTime(r.expiresAt)}` : ""}
            </span>
            {r.status === "pending" && canRequest ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => setCancelling(cancelling === r.id ? null : r.id)}>
                Cancel…
              </Button>
            ) : null}
            {cancelling === r.id ? (
              <span className="flex items-center gap-2">
                <Label htmlFor={`cancel-${r.id}`} className="sr-only">
                  Reason
                </Label>
                <Input id={`cancel-${r.id}`} className="h-7 w-56" placeholder="Why cancel?" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button
                  type="button"
                  size="xs"
                  variant="destructive"
                  disabled={pending || reason.trim().length < 3}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await cancelConsentSignatureRequest(r.id, patientId, reason);
                      if (result.ok) {
                        toast.success("Request cancelled");
                        setCancelling(null);
                        setReason("");
                        router.refresh();
                      } else setError(result.message);
                    })
                  }
                >
                  Cancel request
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {canRequest && portalEnabled ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await requestConsentSignature(patientId, definitionId);
              if (result.ok) {
                toast.success("The form was sent to MyHealth");
                setDefinitionId("");
                router.refresh();
              } else setError(result.message);
            });
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="signature-request-definition">Ask the patient to sign</Label>
            <NativeSelect
              id="signature-request-definition"
              placeholder="Choose…"
              emptyText="No procedure has a consent wording yet"
              value={definitionId}
              onChange={(e) => setDefinitionId(e.target.value)}
            >
              {offered.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" size="sm" disabled={pending || !definitionId}>
            Send for signature
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-table text-danger-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}
