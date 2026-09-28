"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheck2Icon, PlugZapIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { YakapRegistrationBadge } from "@/components/yakap-registration-badge";
import type { YakapConsultationList, YakapRegistrationOverview, YakapRegistrationStatus } from "@/lib/api/types";
import { recordYakapRegistration } from "./yakap-actions";

const SUBMISSION_LABEL: Record<string, string> = {
  queued: "Queued",
  accepted: "Acknowledged by PhilHealth",
  rejected: "Rejected",
  failed: "Failed",
  not_configured: "Not sent (not connected)",
};

/**
 * PhilHealth YAKAP on the patient record: PhilHealth's answers about the patient's registration (history; answers
 * never change) with a form to record what PhilHealth's own channel answered, and the patient's consultations for which
 * an encounter package can be prepared. The platform records PhilHealth's answer; it does not decide registration.
 */
export function PhilHealthYakap({
  patientId,
  overview,
  consultations,
  facilityId,
}: {
  patientId: string;
  /** Null without philhealth.eligibility.manage. */
  overview: YakapRegistrationOverview | null;
  /** Null without philhealth.claim.submit. */
  consultations: YakapConsultationList | null;
  facilityId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [f, setF] = React.useState({ status: "registered" as YakapRegistrationStatus, effectiveDate: "", reference: "", note: "" });
  const integration = overview?.integration ?? consultations?.integration;
  const connected = integration ? integration.status !== "dependency" : false;
  const latestHere = overview?.registrations.find((r) => r.facilityId === facilityId) ?? null;
  const referenceNeeded = f.status !== "unknown";

  const record = () =>
    startTransition(async () => {
      const result = await recordYakapRegistration({
        patientId,
        status: f.status,
        effectiveDate: f.effectiveDate || undefined,
        reference: f.reference.trim() || undefined,
        note: f.note.trim() || undefined,
      });
      if (result.ok) {
        toast.success("YAKAP registration answer recorded");
        setF({ ...f, effectiveDate: "", reference: "", note: "" });
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="flex flex-col gap-3 text-body">
      {connected ? null : (
        <p className="flex gap-2 rounded-md border border-warning bg-warning-subtle p-2 text-meta text-warning-foreground">
          <PlugZapIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Not connected to PhilHealth YAKAP (no official specification yet). Ask through PhilHealth&apos;s own channel, then record its answer and reference
            here.
          </span>
        </p>
      )}

      {overview ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-meta text-muted-foreground">Latest answer for this facility</span>
            {!facilityId ? (
              <span className="text-meta text-muted-foreground">Select a facility to see and record its answer.</span>
            ) : latestHere ? (
              <span className="flex flex-wrap items-center gap-2">
                <YakapRegistrationBadge status={latestHere.status} />
                {latestHere.effectiveDate ? <span>effective {clinicalDate(latestHere.effectiveDate)}</span> : null}
                {latestHere.externalReference ? <span className="text-muted-foreground">Ref. {latestHere.externalReference}</span> : null}
                <span className="text-meta text-muted-foreground">recorded {clinicalDateTime(latestHere.recordedAt)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">No answer recorded.</span>
            )}
            {facilityId ? (
              <span className="text-meta text-muted-foreground">
                Facility&apos;s YAKAP reference: {overview.participation ? overview.participation.participationReference : "not recorded (billing settings)"}
              </span>
            ) : null}
          </div>

          {overview.registrations.length ? (
            <details>
              <summary className="cursor-pointer text-meta text-muted-foreground">History ({overview.registrations.length})</summary>
              <ul className="mt-1.5 flex flex-col gap-1.5" aria-label="YAKAP registration answers">
                {overview.registrations.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-meta">
                    <YakapRegistrationBadge status={r.status} />
                    {r.effectiveDate ? <span>effective {clinicalDate(r.effectiveDate)}</span> : null}
                    {r.externalReference ? <span className="text-muted-foreground">Ref. {r.externalReference}</span> : null}
                    <span className="text-muted-foreground">{clinicalDateTime(r.recordedAt)}</span>
                    {r.facilityId !== facilityId ? <span className="text-muted-foreground">· another facility</span> : null}
                    {r.note ? <span className="text-muted-foreground">· {r.note}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {facilityId ? (
            <form
              className="grid gap-2 sm:grid-cols-2"
              aria-label="Record PhilHealth's YAKAP registration answer"
              onSubmit={(e) => {
                e.preventDefault();
                record();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="yakap-status">PhilHealth&apos;s answer</Label>
                <NativeSelect id="yakap-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as YakapRegistrationStatus })}>
                  <option value="registered">Registered</option>
                  <option value="not_registered">Not registered</option>
                  <option value="pending">Pending</option>
                  <option value="unknown">Unknown (no clear answer)</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="yakap-effective">Effective date (if given)</Label>
                <Input id="yakap-effective" type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="yakap-reference">Reference{referenceNeeded ? "" : " (optional)"}</Label>
                <Input id="yakap-reference" value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="yakap-note">Note (optional)</Label>
                <Input id="yakap-note" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={pending || (referenceNeeded && !f.reference.trim())}>
                  Record answer
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}

      {consultations ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-meta text-muted-foreground">Encounter packages (prepared from this record; not a PhilHealth form)</span>
          {consultations.consultations.length ? (
            <ul className="flex flex-col gap-1.5" aria-label="Consultations">
              {consultations.consultations.slice(0, 5).map((c) => (
                <li key={c.encounterId} className="flex flex-wrap items-center gap-2 text-meta">
                  <span>{clinicalDate(c.date)}</span>
                  <span className="text-muted-foreground">
                    {c.visitTypeName ?? "Consultation"} · {c.modality === "telemedicine" ? "online" : "in person"}
                    {c.clinicianName ? ` · ${c.clinicianName}` : ""}
                    {c.status === "in_progress" ? " · not signed" : ""}
                  </span>
                  {c.latestSubmission ? <span>{SUBMISSION_LABEL[c.latestSubmission.status] ?? c.latestSubmission.status}</span> : null}
                  <Button asChild size="sm" variant="outline" className="ml-auto">
                    <Link href={`/patients/${patientId}/yakap/${c.encounterId}`}>
                      <FileCheck2Icon aria-hidden /> Package
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No consultations recorded.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
