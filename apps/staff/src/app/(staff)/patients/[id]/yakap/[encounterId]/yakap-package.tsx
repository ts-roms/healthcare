"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CircleAlertIcon, PlugZapIcon, SendIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, toast } from "@healthcare/ui/primitives";
import { YakapRegistrationBadge } from "@/components/yakap-registration-badge";
import type { ClaimExchange, YakapPackagePreview } from "@/lib/api/types";
import { requestYakapSubmission } from "../../yakap-actions";

const EXCHANGE: Record<ClaimExchange["status"], { label: string; variant: "success" | "danger" | "neutral" | "info" }> = {
  queued: { label: "Queued", variant: "info" },
  accepted: { label: "Acknowledged by PhilHealth", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  failed: { label: "Failed", variant: "danger" },
  not_configured: { label: "Not sent (not connected)", variant: "neutral" },
};

/**
 * One consultation's YAKAP encounter package: readiness of the platform's own records (icon + text), the prepared
 * package (PIN masked) and earlier submissions. The submit button appears only when an adapter is connected; YAKAP's
 * own rules (registration, first-patient-encounter, benefit package) are applied by PhilHealth, not here.
 */
export function YakapPackage({ preview }: { preview: YakapPackagePreview }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const connected = preview.integration.status !== "dependency";
  const inFlight = preview.submissions.some((s) => s.status === "queued" || s.status === "accepted");
  const pkg = preview.package;
  const c = preview.consultation;

  const submit = () =>
    startTransition(async () => {
      const result = await requestYakapSubmission({ patientId: preview.patientId, encounterId: preview.encounterId, idempotencyKey: key });
      if (result.ok) {
        toast.success("Package queued for PhilHealth");
        setKey(crypto.randomUUID());
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>
            Consultation of {clinicalDate(c.date)} · {c.visitTypeName ?? "Consultation"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-body">
          <p className="text-meta text-muted-foreground">
            {c.facilityName} · {c.modality === "telemedicine" ? "online" : "in person"}
            {c.clinicianName ? ` · ${c.clinicianName}` : ""}
          </p>
          {pkg ? (
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-meta">
              <dt className="text-muted-foreground">Patient</dt>
              <dd>
                {pkg.patient.familyName}, {pkg.patient.givenName} · {pkg.patient.patientNumber}
              </dd>
              <dt className="text-muted-foreground">Member PIN</dt>
              <dd>{pkg.patient.philhealthPin}</dd>
              <dt className="text-muted-foreground">YAKAP reference</dt>
              <dd>{pkg.facility.participationReference}</dd>
              <dt className="text-muted-foreground">Clinician</dt>
              <dd>
                {pkg.encounter.clinician
                  ? `${pkg.encounter.clinician.name}${pkg.encounter.clinician.licenseNumber ? ` · licence ${pkg.encounter.clinician.licenseNumber}` : ""}`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Diagnoses</dt>
              <dd>
                <ul>
                  {pkg.diagnoses.map((d) => (
                    <li key={d.code}>
                      <span className="font-mono">{d.code}</span> {d.display}
                      {d.primary ? " (primary)" : ""}
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="text-muted-foreground">Prescriptions</dt>
              <dd>
                {pkg.prescriptions.length ? (
                  <ul>
                    {pkg.prescriptions.flatMap((p) =>
                      p.items.map((i, n) => (
                        <li key={`${p.prescriptionNumber}-${n}`}>
                          {i.genericName}
                          {i.strength ? ` ${i.strength}` : ""} · {i.quantity} {i.quantityUnit}
                          <span className="text-muted-foreground"> ({p.prescriptionNumber})</span>
                        </li>
                      )),
                    )}
                  </ul>
                ) : (
                  "None"
                )}
              </dd>
              <dt className="text-muted-foreground">Laboratory orders</dt>
              <dd>
                {pkg.labOrders.length ? (
                  <ul>
                    {pkg.labOrders.map((o) => (
                      <li key={o.orderNumber}>
                        {o.tests.map((t) => t.name).join(", ")}
                        <span className="text-muted-foreground"> ({o.orderNumber})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  "None"
                )}
              </dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">The package is prepared once everything in the checklist is recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PhilHealth YAKAP</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-body">
          {connected ? null : (
            <p className="flex gap-2 rounded-md border border-warning bg-warning-subtle p-2 text-meta text-warning-foreground">
              <PlugZapIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <strong>YAKAP not connected.</strong> The official PhilHealth specification has not been obtained, so nothing is sent from here. Use
                PhilHealth&apos;s own channel for this consultation.
              </span>
            </p>
          )}
          <ul className="flex flex-col gap-1" aria-label="What the package needs">
            {preview.checks.map((check) => (
              <li key={check.code} className="flex items-start gap-2 text-meta">
                {check.ok ? (
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                )}
                <span>
                  <span className="sr-only">{check.ok ? "Done: " : "Missing: "}</span>
                  {check.message}
                  {check.ok ? null : <span className="text-muted-foreground"> — missing</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-meta text-muted-foreground">
            These check this clinic&apos;s own records only. Registration, first-patient-encounter and benefit rules are applied by PhilHealth.
          </p>
          {preview.registration ? (
            <p className="flex flex-wrap items-center gap-2 text-meta">
              Registration answer: <YakapRegistrationBadge status={preview.registration.status} />
              {preview.registration.externalReference ? <span className="text-muted-foreground">Ref. {preview.registration.externalReference}</span> : null}
            </p>
          ) : (
            <p className="text-meta text-muted-foreground">No YAKAP registration answer recorded for this facility (see the patient record).</p>
          )}
          {preview.submissions.length ? (
            <ul className="flex flex-col gap-1 text-meta" aria-label="Submissions">
              {preview.submissions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={EXCHANGE[s.status].variant}>{EXCHANGE[s.status].label}</Badge>
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
          {connected ? (
            <Button type="button" size="sm" className="self-start" disabled={pending || !preview.ready || inFlight} onClick={submit}>
              <SendIcon /> Send to PhilHealth
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
