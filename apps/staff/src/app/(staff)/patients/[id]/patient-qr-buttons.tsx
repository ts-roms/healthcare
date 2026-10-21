"use client";

import * as React from "react";
import { PrinterIcon, QrCodeIcon, RefreshCwIcon } from "lucide-react";
import { Button, Input, Label } from "@healthcare/ui/primitives";
import { useServerAction } from "@/lib/use-server-action";
import { issuePatientQr, regeneratePatientQr, revokePatientQr } from "./patient-qr-actions";

/** Issue, print and revoke. The API enforces the permission, the organization's setting and the state. */
export function PatientQrButtons({ patientId, hasActive, canIssue }: { patientId: string; hasActive: boolean; canIssue: boolean }) {
  const { pending, run } = useServerAction();
  const [revoking, setRevoking] = React.useState<"revoke" | "regenerate" | null>(null);
  const [reason, setReason] = React.useState("");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {hasActive ? (
          <>
            <Button asChild size="sm" variant="outline">
              <a href={`/patients/${patientId}/qr/card.pdf`} target="_blank" rel="noreferrer">
                <PrinterIcon /> Print card
              </a>
            </Button>
            {canIssue ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setRevoking((v) => (v === "regenerate" ? null : "regenerate"))}>
                <RefreshCwIcon /> Regenerate…
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setRevoking((v) => (v === "revoke" ? null : "revoke"))}>
              Revoke (lost card)…
            </Button>
          </>
        ) : canIssue ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => issuePatientQr(patientId), "QR code issued")}>
            <QrCodeIcon /> Issue QR code
          </Button>
        ) : null}
      </div>
      {revoking ? (
        <form
          className="grid max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const regenerate = revoking === "regenerate";
            run(
              () => (regenerate ? regeneratePatientQr(patientId, reason) : revokePatientQr(patientId, reason)),
              regenerate ? "New QR code issued" : "QR code revoked",
              () => {
                setRevoking(null);
                setReason("");
              },
            );
          }}
        >
          <Label htmlFor="qr-revoke-reason">Reason</Label>
          <Input
            id="qr-revoke-reason"
            value={reason}
            maxLength={500}
            placeholder={revoking === "regenerate" ? "e.g. card damaged, or switch to the MyHealth link" : "e.g. card lost"}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-meta text-muted-foreground">
            {revoking === "regenerate"
              ? "The current code stops working at once and a new one is made with what your clinic's setting holds now. Print the new card afterwards."
              : "A revoked code is refused at the next scan. You can then issue a new one."}
          </p>
          <Button
            type="submit"
            size="sm"
            variant={revoking === "regenerate" ? "default" : "destructive"}
            className="self-start"
            disabled={pending || reason.trim().length < 5}
          >
            {revoking === "regenerate" ? "Regenerate code" : "Revoke code"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
