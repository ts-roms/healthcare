"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon, PrinterIcon, SendIcon } from "lucide-react";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import type { Practitioner, Referral } from "@/lib/api/types";
import { REFERRAL_STATUS, REFERRAL_URGENCY_LABEL, referralRecipient } from "@/lib/clinic-mapping";
import { fileHref } from "@/lib/files";
import { createReferral } from "../../referrals/actions";

const blank = {
  kind: "internal" as "internal" | "external",
  toPractitionerId: "",
  specialty: "",
  externalProvider: "",
  externalFacility: "",
  externalContact: "",
  urgency: "routine" as "routine" | "urgent" | "emergency",
  reason: "",
  clinicalSummary: "",
};

/**
 * Referrals from this consultation: to a practitioner here (they accept or decline and complete it) or to an outside
 * provider (the letter is printed and the reply recorded later). What the referrer writes never changes.
 */
export function ReferralsPanel({
  encounterId,
  referrals,
  canRefer,
  practitioners,
  currentPractitionerId,
  diagnoses,
}: {
  encounterId: string;
  /** null: the user may not read them. */
  referrals: Referral[] | null;
  canRefer: boolean;
  /** Active practitioners to refer to (others than the current one). */
  practitioners: Practitioner[];
  currentPractitionerId: string | null;
  /** The consultation's active diagnoses, to list on the letter. */
  diagnoses: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<typeof blank | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set(diagnoses.map((d) => d.id)));
  if (referrals === null) return null;
  const targets = practitioners.filter((p) => p.status === "active" && p.id !== currentPractitionerId);
  const set = (key: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const submit = () =>
    startTransition(async () => {
      if (!form) return;
      const result = await createReferral({
        encounterId,
        kind: form.kind,
        toPractitionerId: form.kind === "internal" ? form.toPractitionerId || undefined : undefined,
        specialty: form.specialty,
        externalProvider: form.kind === "external" ? form.externalProvider : undefined,
        externalFacility: form.kind === "external" ? form.externalFacility : undefined,
        externalContact: form.kind === "external" ? form.externalContact : undefined,
        urgency: form.urgency,
        reason: form.reason,
        clinicalSummary: form.clinicalSummary,
        diagnosisIds: [...chosen],
      });
      if (result.ok) {
        toast.success(`Referral ${result.data.referralNumber} sent`);
        setForm(null);
        router.refresh();
      } else toast.error(result.message);
    });

  return (
    <section className="flex flex-col gap-2" aria-label="Referrals">
      <h3 className="flex items-center gap-1.5 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
        <SendIcon className="size-4" aria-hidden /> Referrals
      </h3>
      {referrals.length === 0 ? <p className="text-meta text-muted-foreground">No referral from this consultation.</p> : null}
      <ul className="flex flex-col gap-1.5 text-table">
        {referrals.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clinic/referrals/${r.id}`}
              className={r.status === "cancelled" ? "text-muted-foreground line-through" : "font-medium text-primary hover:underline"}
            >
              {r.referralNumber}
            </Link>
            <span className="text-meta text-muted-foreground">
              {referralRecipient(r)}
              {r.specialty ? ` · ${r.specialty}` : ""} · {REFERRAL_URGENCY_LABEL[r.urgency]} · {clinicalDateTime(r.issuedAt)}
            </span>
            <Badge variant={REFERRAL_STATUS[r.status].variant}>{REFERRAL_STATUS[r.status].label}</Badge>
            {r.status !== "cancelled" ? (
              <Button asChild size="xs" variant="outline">
                <a href={fileHref.referralLetter(r.id)} target="_blank" rel="noreferrer">
                  <PrinterIcon /> Letter
                </a>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canRefer && !form ? (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setForm(blank)}>
          <PlusIcon /> Refer
        </Button>
      ) : null}
      {form ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-wrap gap-3 text-table">
            <legend className="sr-only">Refer to</legend>
            {(["internal", "external"] as const).map((kind) => (
              <label key={kind} className="flex items-center gap-1.5">
                <input type="radio" name="referral-kind" checked={form.kind === kind} onChange={() => setForm({ ...form, kind })} />
                {kind === "internal" ? "A practitioner here" : "An outside provider"}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            {form.kind === "internal" ? (
              <div className="grid gap-1">
                <Label htmlFor="referral-to">Practitioner</Label>
                <NativeSelect id="referral-to" value={form.toPractitionerId} onChange={set("toPractitionerId")}>
                  <option value="">Choose…</option>
                  {targets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                      {p.specialty ? ` · ${p.specialty}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="referral-provider">Provider</Label>
                  <Input id="referral-provider" maxLength={200} value={form.externalProvider} onChange={set("externalProvider")} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="referral-facility">Facility (optional)</Label>
                  <Input id="referral-facility" maxLength={200} value={form.externalFacility} onChange={set("externalFacility")} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="referral-contact">Contact (optional)</Label>
                  <Input id="referral-contact" maxLength={200} value={form.externalContact} onChange={set("externalContact")} />
                </div>
              </>
            )}
            <div className="grid gap-1">
              <Label htmlFor="referral-specialty">Specialty or service (optional)</Label>
              <Input id="referral-specialty" maxLength={120} value={form.specialty} onChange={set("specialty")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="referral-urgency">Urgency</Label>
              <NativeSelect id="referral-urgency" value={form.urgency} onChange={set("urgency")}>
                {(["routine", "urgent", "emergency"] as const).map((u) => (
                  <option key={u} value={u}>
                    {REFERRAL_URGENCY_LABEL[u]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="referral-reason">Reason for referral</Label>
            <Textarea id="referral-reason" rows={2} maxLength={1000} value={form.reason} onChange={set("reason")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="referral-summary">Clinical summary (optional)</Label>
            <Textarea id="referral-summary" rows={3} maxLength={4000} value={form.clinicalSummary} onChange={set("clinicalSummary")} />
          </div>
          {diagnoses.length ? (
            <fieldset className="flex flex-col gap-1 text-table">
              <legend className="text-label mb-1 font-medium">Diagnoses on the letter</legend>
              {diagnoses.map((d) => (
                <label key={d.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={chosen.has(d.id)}
                    onChange={() => setChosen((prev) => (prev.has(d.id) ? new Set([...prev].filter((x) => x !== d.id)) : new Set([...prev, d.id])))}
                  />
                  {d.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <p className="text-meta text-muted-foreground">The letter lists the patient&apos;s active allergies. What you write here cannot be edited later.</p>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                pending || form.reason.trim().length < 3 || (form.kind === "internal" ? !form.toPractitionerId : form.externalProvider.trim().length < 2)
              }
            >
              Send referral
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
