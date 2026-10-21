import QRCode from "qrcode";
import { QrCodeIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import { ApiError } from "@healthcare/web-session";
import { api } from "@/lib/api/client";
import type { PatientQrState } from "@/lib/api/types";
import { PatientQrButtons } from "./patient-qr-buttons";

/**
 * The patient's QR code for the card or wristband (docs/domains/patient.md, "Patient QR codes"): drawn here, on the
 * server, from the key the API returns; the key is never logged. Nothing is shown while the organization has QR codes off.
 */
export async function PatientQrCard({ patientId }: { patientId: string }) {
  let state: PatientQrState;
  try {
    state = await api<PatientQrState>(`/patient-qr/patients/${patientId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
  if (!state.enabled && !state.active) return null;
  const image = state.active ? await QRCode.toDataURL(state.active.payload, { margin: 2, width: 192, errorCorrectionLevel: "M" }) : null;
  const lastRevoked = state.history[0];
  return (
    <Card>
      <CardHeader>
        <QrCodeIcon className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Patient QR code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.active && image ? (
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Patient QR code" width={192} height={192} className="rounded border bg-white" />
            <p className="max-w-prose text-table text-muted-foreground">
              Issued {clinicalDateTime(state.active.issuedAt)}. It holds {state.active.content === "token" ? "a random key" : "the patient number"} only: no
              name, health or contact details. Staff scan it to find this record; it opens nothing by itself.
            </p>
          </div>
        ) : (
          <p className="text-table text-muted-foreground">
            This patient has no active QR code.
            {lastRevoked ? ` The last one was revoked ${clinicalDateTime(lastRevoked.revokedAt ?? lastRevoked.issuedAt)}.` : ""}
          </p>
        )}
        <PatientQrButtons patientId={patientId} hasActive={!!state.active} canIssue={state.enabled} />
        {state.history.length > 0 ? (
          <details className="text-meta text-muted-foreground">
            <summary className="cursor-pointer">Earlier codes ({state.history.length})</summary>
            <ul className="mt-1 list-disc pl-5">
              {state.history.map((h) => (
                <li key={h.id}>
                  Issued {clinicalDateTime(h.issuedAt)}, revoked {h.revokedAt ? clinicalDateTime(h.revokedAt) : ""}: {h.revokeReason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
