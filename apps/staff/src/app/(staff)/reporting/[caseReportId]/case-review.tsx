"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, CircleAlertIcon, PlugZapIcon, SendIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@healthcare/ui/primitives";
import type { CaseReportDetail } from "@/lib/api/types";
import { dismissCase, recordReported, submitCase } from "../actions";
import { CaseStatus, FoundByCheck } from "../case-status";

const OPEN = ["pending_review", "rejected", "failed"];

/**
 * Review of one case report: what the platform prepared, what is missing, and
 * the decision — reported through DOH's own channel (with its reference),
 * dismissed with a reason, or (once an adapter exists) submitted.
 */
export function CaseReview({ detail }: { detail: CaseReportDetail }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [reference, setReference] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const open = OPEN.includes(detail.status);
  const connected = detail.integration.status !== "dependency";
  const r = detail.report;

  const act = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Prepared report <CaseStatus status={detail.status} />
              {detail.rescanId ? <FoundByCheck /> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-body">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Condition</dt>
              <dd>{r.category}</dd>
              <dt className="text-muted-foreground">Diagnosis</dt>
              <dd>
                <span className="font-mono">{r.diagnosis.code}</span> {r.diagnosis.display} ({r.diagnosis.certainty})
              </dd>
              <dt className="text-muted-foreground">Consultation</dt>
              <dd>
                {clinicalDateTime(r.consultation.date)}
                {r.consultation.clinician ? ` · ${r.consultation.clinician}` : null}
                {r.consultation.modality === "telemedicine" ? " · online" : null}
              </dd>
              <dt className="text-muted-foreground">Patient</dt>
              <dd>
                {r.patient.familyName.toUpperCase()}, {r.patient.givenName} {r.patient.middleName ?? ""} · {r.patient.sex} · born{" "}
                {clinicalDate(r.patient.birthDate)}
              </dd>
              <dt className="text-muted-foreground">Address</dt>
              <dd>
                {r.patient.address
                  ? [
                      r.patient.address.line1,
                      r.patient.address.barangay && `Brgy. ${r.patient.address.barangay}`,
                      r.patient.address.cityMunicipality,
                      r.patient.address.province,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Contact</dt>
              <dd>{r.patient.contactNumber ?? "—"}</dd>
              <dt className="text-muted-foreground">Facility</dt>
              <dd>
                {r.facility.name}
                {r.facility.facilityCode ? ` · ${r.facility.facilityCode}` : null}
              </dd>
            </dl>
            <ul className="flex flex-col gap-1" aria-label="What the report needs">
              {detail.checks.map((c) => (
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
              This is the clinic&apos;s own summary, not an official DOH form. Which conditions are reportable, and the case definitions, come from the
              issuances your facility follows.
            </p>
          </CardContent>
        </Card>
        {detail.submissions.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Submissions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-meta">
                {detail.submissions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.status === "accepted" ? "success" : s.status === "queued" ? "info" : "danger"}>{s.status.replace("_", " ")}</Badge>
                    <span className="text-muted-foreground">{clinicalDateTime(s.requestedAt)}</span>
                    {s.externalReference ? <span>Ref. {s.externalReference}</span> : null}
                    {s.outcomeDetail.reasons?.map((x) => (
                      <span key={x.code}>
                        {x.code}: {x.message}
                      </span>
                    ))}
                    {s.lastError ? <span className="text-muted-foreground">{s.lastError}</span> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-body">
            {!open ? (
              <p>
                {detail.status === "reported"
                  ? `Reported${detail.reportedVia === "external_channel" ? " through DOH's channel" : ""}, reference ${detail.externalReference}.`
                  : detail.status === "dismissed"
                    ? `Dismissed: ${detail.statusReason}`
                    : "Being sent."}
              </p>
            ) : (
              <>
                {connected ? null : (
                  <p className="flex gap-2 rounded-md border border-warning bg-warning-subtle p-2 text-meta text-warning-foreground">
                    <PlugZapIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <strong>DOH reporting is not connected.</strong> Report the case through DOH&apos;s own channel, then record the reference it gives here.
                    </span>
                  </p>
                )}
                {detail.statusReason ? <p className="text-meta text-muted-foreground">{detail.statusReason}</p> : null}
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(() => recordReported({ caseReportId: detail.id, reference, version: detail.version }), "Recorded as reported");
                  }}
                >
                  <Label htmlFor="doh-reference">Reference from DOH&apos;s channel</Label>
                  <Input id="doh-reference" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
                  <Button type="submit" size="sm" className="self-start" disabled={pending || !reference.trim()}>
                    <CheckCircle2Icon /> Record as reported
                  </Button>
                </form>
                {connected ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-start"
                    disabled={pending || !detail.ready}
                    onClick={() =>
                      act(
                        () => submitCase({ caseReportId: detail.id, idempotencyKey: key, version: detail.version }),
                        "Report queued",
                        () => setKey(crypto.randomUUID()),
                      )
                    }
                  >
                    <SendIcon /> Submit to DOH
                  </Button>
                ) : null}
                <form
                  className="flex flex-col gap-2 border-t pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(() => dismissCase({ caseReportId: detail.id, reason, version: detail.version }), "Dismissed");
                  }}
                >
                  <Label htmlFor="doh-dismiss">Not reportable after review — reason</Label>
                  <Input id="doh-dismiss" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                  <Button type="submit" size="sm" variant="outline" className="self-start" disabled={pending || reason.trim().length < 3}>
                    Dismiss
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
