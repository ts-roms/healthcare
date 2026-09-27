"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { AllergyBadge, clinicalDate, clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Input, Label, NativeSelect, toast } from "@healthcare/ui/primitives";
import { addAllergy, changeAllergyStatus, reviewAllergies } from "@/app/(staff)/patients/allergy-actions";
import type { AllergyRecord, AllergySummary } from "@/lib/api/types";
import { type AllergyForm, type AllergyStatusChange, BLANK_ALLERGY, CATEGORY_LABEL, reviewState, STATUS_CHANGE_LABEL } from "@/lib/allergy-form";
import { bannerSeverity, label, sortByDanger } from "@/lib/patient-mapping";

/**
 * The patient's allergies with recording and review (allergy.manage). Used on
 * the patient record, at triage and in the encounter workspace, so allergies
 * can be recorded wherever they are asked about. The API audits every change.
 */
export function AllergiesPanel({ patientId, summary, canManage }: { patientId: string; summary: AllergySummary; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState<AllergyForm>(BLANK_ALLERGY);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [changing, setChanging] = React.useState<{ allergy: AllergyRecord; status: AllergyStatusChange } | null>(null);
  const [reason, setReason] = React.useState("");
  const review = reviewState(summary);
  const sorted = sortByDanger(summary.allergies.map((a) => ({ severity: bannerSeverity(a), allergy: a }))).map((x) => x.allergy);

  const run = (call: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong.");
    });

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await addAllergy(patientId, form);
      if (result.ok) {
        toast.success(`Allergy recorded: ${result.data.substance}`);
        setForm(BLANK_ALLERGY);
        setAdding(false);
        router.refresh();
      } else setFormError(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {sorted.length ? (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <AllergyBadge allergy={{ id: a.id, substance: a.substance, severity: bannerSeverity(a) }} />
                <span className="text-meta text-muted-foreground">
                  {CATEGORY_LABEL[a.category]} · {a.severity ? label(a.severity) : "severity not recorded"}
                  {a.criticality === "high" ? " · high criticality" : ""}
                </span>
                {a.verification === "unconfirmed" ? <Badge variant="warning">Unconfirmed</Badge> : null}
                {canManage && a.version ? (
                  <span className="ml-auto flex gap-0.5">
                    {(Object.keys(STATUS_CHANGE_LABEL) as AllergyStatusChange[]).map((status) => (
                      <Button key={status} size="xs" variant="ghost" disabled={pending} onClick={() => setChanging({ allergy: a, status })}>
                        {STATUS_CHANGE_LABEL[status]}…
                      </Button>
                    ))}
                  </span>
                ) : null}
              </span>
              {a.reaction ? <span className="text-table text-muted-foreground">{a.reaction}</span> : null}
              <span className="text-meta text-muted-foreground">Recorded {clinicalDate(a.recordedAt)}</span>
              {changing?.allergy.id === a.id ? (
                <form
                  className="mt-1 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      () => changeAllergyStatus({ patientId, allergyId: a.id, status: changing.status, reason, version: a.version ?? 1 }),
                      `${a.substance}: ${STATUS_CHANGE_LABEL[changing.status].toLowerCase()}`,
                      () => {
                        setChanging(null);
                        setReason("");
                      },
                    );
                  }}
                >
                  <div className="grid min-w-56 flex-1 gap-1">
                    <Label htmlFor={`allergy-reason-${a.id}`}>Reason for “{STATUS_CHANGE_LABEL[changing.status]}” *</Label>
                    <Input id={`allergy-reason-${a.id}`} autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    variant={changing.status === "entered_in_error" ? "destructive" : "default"}
                    disabled={pending || reason.trim().length < 3}
                  >
                    Confirm
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChanging(null)}>
                    Keep
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Badge variant={review.tone === "success" ? "success" : "warning"}>
          {review.tone === "success" ? <ShieldCheckIcon aria-hidden /> : <AlertTriangleIcon aria-hidden />} {review.text}
        </Badge>
      )}
      {summary.lastReviewedAt ? <p className="text-meta text-muted-foreground">Last reviewed {clinicalDateTime(summary.lastReviewedAt)}</p> : null}

      {canManage && !adding ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon /> Record allergy
          </Button>
          {review.canConfirmNone ? (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => reviewAllergies({ patientId, noKnownAllergies: true }), "Recorded: no known allergies")}
            >
              <ShieldCheckIcon /> Patient reports no known allergies
            </Button>
          ) : summary.status === "has_allergies" ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => reviewAllergies({ patientId, noKnownAllergies: false }), "Allergy review recorded")}
            >
              <CheckIcon /> Reviewed with patient
            </Button>
          ) : null}
        </div>
      ) : null}

      {adding ? (
        <form onSubmit={submitAdd} noValidate className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6">
          <div className="grid gap-1 sm:col-span-4">
            <Label htmlFor="allergy-substance">Substance *</Label>
            <Input
              id="allergy-substance"
              autoFocus
              maxLength={200}
              value={form.substance}
              onChange={(e) => setForm({ ...form, substance: e.target.value })}
              placeholder="e.g. Penicillin, shrimp, latex"
            />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="allergy-category">Category</Label>
            <NativeSelect
              id="allergy-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as AllergyForm["category"] })}
            >
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor="allergy-reaction">Reaction</Label>
            <Input
              id="allergy-reaction"
              maxLength={500}
              value={form.reaction}
              onChange={(e) => setForm({ ...form, reaction: e.target.value })}
              placeholder="e.g. Hives, throat swelling"
            />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="allergy-severity">Severity</Label>
            <NativeSelect
              id="allergy-severity"
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as AllergyForm["severity"] })}
            >
              <option value="">Not known</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="allergy-criticality">Criticality</Label>
            <NativeSelect
              id="allergy-criticality"
              value={form.criticality}
              onChange={(e) => setForm({ ...form, criticality: e.target.value as AllergyForm["criticality"] })}
            >
              <option value="unable_to_assess">Unable to assess</option>
              <option value="low">Low</option>
              <option value="high">High (risk of a life-threatening reaction)</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="allergy-verification">Verification</Label>
            <NativeSelect
              id="allergy-verification"
              value={form.verification}
              onChange={(e) => setForm({ ...form, verification: e.target.value as AllergyForm["verification"] })}
            >
              <option value="unconfirmed">Reported, unconfirmed</option>
              <option value="confirmed">Confirmed</option>
            </NativeSelect>
          </div>
          {formError ? (
            <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {formError}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending || !form.substance.trim()}>
              Record allergy
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
