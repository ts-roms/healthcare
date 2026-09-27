"use client";

import * as React from "react";
import { AlertTriangleIcon, FilePenLineIcon, InfoIcon } from "lucide-react";
import { Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { CONSENT_CAPTURE, CONSENT_DECISIONS, CONSENT_TYPES, type ConsentForm, type ConsentType, EMPTY_CONSENT_FORM } from "@/lib/consent-form";
import { recordConsent } from "./consent-actions";

type FieldErrors = Partial<Record<keyof ConsentForm, string>>;

/** "Record consent" button and inline form on the patient record. The API checks permission, validates and audits. */
export function RecordConsent({ patientId }: { patientId: string }) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<ConsentForm>(EMPTY_CONSENT_FORM);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const set = <K extends keyof ConsentForm>(key: K, value: ConsentForm[K]) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === "decision" && value !== "granted" ? { expiresOn: "" } : {}) }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setMessage(null);
  };

  const close = () => {
    setOpen(false);
    setForm(EMPTY_CONSENT_FORM);
    setErrors({});
    setMessage(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      const result = await recordConsent(patientId, form);
      if (result.ok) {
        toast.success(
          `${CONSENT_TYPES[form.consentType as ConsentType]?.label ?? "Consent"}: ${CONSENT_DECISIONS[form.decision as keyof typeof CONSENT_DECISIONS].toLowerCase()}`,
        );
        close();
        return;
      }
      setMessage(result.message);
      if ("fieldErrors" in result) setErrors(result.fieldErrors);
    });
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FilePenLineIcon aria-hidden /> Record consent
      </Button>
    );
  }

  const type = CONSENT_TYPES[form.consentType as ConsentType];
  const ending = form.decision === "withdrawn" || form.decision === "refused";

  return (
    <form onSubmit={submit} noValidate aria-labelledby="record-consent-title" className="flex flex-col gap-3 rounded-md border p-3 text-body">
      <h3 id="record-consent-title" className="font-semibold">
        Record consent
      </h3>

      <Field id="consent-type" label="Consent" error={errors.consentType} hint={type?.hint}>
        <NativeSelect id="consent-type" value={form.consentType} onChange={(e) => set("consentType", e.target.value)} required autoFocus>
          <option value="" disabled>
            Choose…
          </option>
          {Object.entries(CONSENT_TYPES).map(([value, t]) => (
            <option key={value} value={value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <fieldset className="grid gap-1">
        <legend className="mb-1 text-table font-medium">Patient&apos;s decision</legend>
        <div className="flex flex-wrap gap-4">
          {Object.entries(CONSENT_DECISIONS).map(([value, text]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" name="decision" value={value} checked={form.decision === value} onChange={() => set("decision", value)} className="size-4" />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="consent-captured" label="How it was given" error={errors.capturedVia}>
          <NativeSelect id="consent-captured" value={form.capturedVia} onChange={(e) => set("capturedVia", e.target.value)} required>
            {Object.entries(CONSENT_CAPTURE).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="consent-expires"
          label="Ends on (optional)"
          error={errors.expiresOn}
          hint={ending ? "Only for granted consent." : "Leave blank if it does not expire."}
        >
          <Input id="consent-expires" type="date" value={form.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} disabled={ending} />
        </Field>
      </div>

      <Field id="consent-notes" label="Notes (optional)" error={errors.notes} hint="e.g. who signed for the patient, form reference.">
        <Textarea id="consent-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} rows={2} />
      </Field>

      {form.consentType === "portal_access" && ending ? (
        <p className="flex items-start gap-1.5 text-table text-warning-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          The patient loses access to MyHealth: they are signed out at their next action and cannot be invited again until they grant consent.
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 text-meta text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Record only what the patient (or their authorized representative) decided. It takes effect now; earlier decisions stay in the history.
      </p>

      {message ? (
        <p role="alert" className="flex items-start gap-1.5 text-table text-danger-foreground">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save consent"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-meta font-medium text-danger-foreground">
          <AlertTriangleIcon className="size-3.5" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-meta text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
