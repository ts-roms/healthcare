"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSignatureIcon, PlusIcon, PrinterIcon } from "lucide-react";
import { clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, DateInput, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { MedicalCertificate } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import { issueCertificate, voidCertificate } from "../certificate-actions";

/**
 * Medical certificates of this consultation: issued once it is signed, by its responsible practitioner, in their own
 * words (purpose, findings, recommendations, optional rest period). Issued certificates never change; a mistaken one is
 * voided with a reason and another issued. The patient downloads issued ones in MyHealth.
 */
export function CertificatesPanel({
  encounterId,
  signed,
  certificates,
  canIssue,
  canVoid,
  suggestedFindings,
  today,
}: {
  encounterId: string;
  /** The consultation is signed (certificates are issued only then). */
  signed: boolean;
  /** null: the user may not read them. */
  certificates: MedicalCertificate[] | null;
  canIssue: boolean;
  canVoid: boolean;
  /** Prefill for the findings: the consultation's active diagnoses. */
  suggestedFindings: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const blank = { purpose: "", findings: suggestedFindings, recommendations: "", restFrom: "", restTo: "" };
  const [form, setForm] = React.useState<typeof blank | null>(null);
  const [voiding, setVoiding] = React.useState<{ id: string; reason: string } | null>(null);
  if (certificates === null) return null;

  const run = (call: () => Promise<{ ok: boolean; message?: string }>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(done);
        after?.();
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });

  return (
    <section className="flex flex-col gap-2" aria-label="Medical certificates">
      <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        <FileSignatureIcon className="size-4" aria-hidden /> Medical certificates
      </h3>
      {certificates.length === 0 ? (
        <p className="text-meta text-muted-foreground">{signed ? "No certificate issued." : "Certificates are issued once the consultation is signed."}</p>
      ) : null}
      <ul className="flex flex-col gap-1.5 text-table">
        {certificates.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <span className={c.status === "void" ? "text-muted-foreground line-through" : "font-medium"}>{c.certificateNumber}</span>
            <span className="text-meta text-muted-foreground">
              {c.purpose}
              {c.restDays ? ` · rest ${c.restDays} day${c.restDays === 1 ? "" : "s"} from ${clinicalDate(c.restFrom!)}` : ""} · {clinicalDateTime(c.issuedAt)}
            </span>
            {c.status === "void" ? (
              <Badge variant="neutral">Void — {c.voidReason}</Badge>
            ) : (
              <Button asChild size="xs" variant="outline">
                <a href={fileHref.medicalCertificate(c.id)} target="_blank" rel="noreferrer">
                  <PrinterIcon /> Print
                </a>
              </Button>
            )}
            {canVoid && c.status === "issued" ? (
              voiding?.id === c.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      () => voidCertificate({ certificateId: c.id, reason: voiding.reason }),
                      `${c.certificateNumber} voided`,
                      () => setVoiding(null),
                    );
                  }}
                >
                  <Input
                    aria-label="Why it is void"
                    placeholder="Why (e.g. wrong dates)"
                    className="h-7 w-56"
                    maxLength={500}
                    value={voiding.reason}
                    onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })}
                  />
                  <Button type="submit" size="xs" variant="destructive" disabled={pending || voiding.reason.trim().length < 5}>
                    Void
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setVoiding(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => setVoiding({ id: c.id, reason: "" })}>
                  Void…
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {canIssue && signed && !form ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setForm({ ...blank, restFrom: "", restTo: "" })}>
            <PlusIcon /> Issue a certificate
          </Button>
        </div>
      ) : null}
      {form ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                issueCertificate({
                  encounterId,
                  purpose: form.purpose,
                  findings: form.findings,
                  recommendations: form.recommendations || undefined,
                  rest: form.restFrom && form.restTo ? { from: form.restFrom, to: form.restTo } : undefined,
                }),
              "Certificate issued — print it or the patient downloads it in MyHealth",
              () => setForm(null),
            );
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="cert-purpose">Purpose</Label>
            <Input
              id="cert-purpose"
              placeholder="e.g. Absence from work, school, travel"
              maxLength={200}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cert-findings">Findings / diagnosis (as it will be printed)</Label>
            <Textarea id="cert-findings" rows={3} maxLength={2000} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="cert-recommendations">Recommendations (optional)</Label>
            <Textarea
              id="cert-recommendations"
              rows={2}
              maxLength={2000}
              value={form.recommendations}
              onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="cert-rest-from">Rest from (optional)</Label>
              <DateInput
                id="cert-rest-from"
                className="w-40"
                value={form.restFrom}
                onChange={(e) => setForm({ ...form, restFrom: e.target.value, restTo: form.restTo || e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cert-rest-to">to</Label>
              <DateInput
                id="cert-rest-to"
                className="w-40"
                min={form.restFrom || today}
                value={form.restTo}
                onChange={(e) => setForm({ ...form, restTo: e.target.value })}
              />
            </div>
          </div>
          <p className="text-meta text-muted-foreground">
            The certificate is printed in your words, with your name and license number, and cannot be edited once issued (void it and issue another).
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || form.purpose.trim().length < 3 || form.findings.trim().length < 3}>
              Issue certificate
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
