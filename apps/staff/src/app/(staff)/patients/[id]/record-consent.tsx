"use client";

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, FilePenLineIcon, InfoIcon } from "lucide-react";
import { Button, DateInput, Input, Label, NativeSelect, RadioGroup, RadioGroupItem, Textarea, toast } from "@healthcare/ui/primitives";
import {
  checkConsentFile,
  CONSENT_CAPTURE,
  CONSENT_DECISIONS,
  CONSENT_FILE_TYPES,
  CONSENT_TYPES,
  type ConsentForm,
  type ConsentType,
  EMPTY_CONSENT_FORM,
} from "@/lib/consent-form";
import { recordConsent } from "./consent-actions";

type FieldErrors = Partial<Record<keyof ConsentForm | "file", string>>;

/**
 * "Record consent" button and inline form on the patient record, with an
 * optional signed form (PDF or photo). The API checks permission, validates
 * and audits; the file is uploaded by the staff app's server.
 */
export function RecordConsent({ patientId, canUpload }: { patientId: string; canUpload: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<ConsentForm>(EMPTY_CONSENT_FORM);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [file, setFile] = React.useState<File | null>(null);
  // Set when the form was stored but the consent was not: a retry links it instead of uploading again.
  const [uploadedId, setUploadedId] = React.useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  const fileInput = React.useRef<HTMLInputElement>(null);

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
    chooseFile(null);
  };

  const chooseFile = (next: File | null) => {
    setFile(next);
    setUploadedId(null);
    setIdempotencyKey(crypto.randomUUID());
    setErrors((e) => ({ ...e, file: next ? (checkConsentFile(next) ?? undefined) : undefined }));
    if (!next && fileInput.current) fileInput.current.value = "";
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      const data = new FormData();
      for (const [key, value] of Object.entries(form)) data.set(key, value);
      if (uploadedId) data.set("documentId", uploadedId);
      else if (file) {
        data.set("file", file);
        data.set("idempotencyKey", idempotencyKey);
      }
      const result = await recordConsent(patientId, data);
      if (result.ok) {
        toast.success(
          `${CONSENT_TYPES[form.consentType as ConsentType]?.label ?? "Consent"}: ${CONSENT_DECISIONS[form.decision as keyof typeof CONSENT_DECISIONS].toLowerCase()}`,
        );
        close();
        return;
      }
      setMessage(result.message);
      if (result.fieldErrors) setErrors(result.fieldErrors);
      if (result.documentId) setUploadedId(result.documentId);
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
        <RadioGroup name="decision" value={form.decision} onValueChange={(value) => set("decision", value)} className="flex flex-wrap gap-4">
          {Object.entries(CONSENT_DECISIONS).map(([value, text]) => (
            <label key={value} className="flex items-center gap-1.5">
              <RadioGroupItem value={value} />
              {text}
            </label>
          ))}
        </RadioGroup>
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
          <DateInput id="consent-expires" value={form.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} disabled={ending} />
        </Field>
      </div>

      {canUpload ? (
        <Field
          id="consent-file"
          label="Signed form (optional)"
          error={errors.file}
          hint={uploadedId ? undefined : `${Object.values(CONSENT_FILE_TYPES).join(", ")}; up to 10 MB. Stored securely with the patient's documents.`}
        >
          <Input
            ref={fileInput}
            id="consent-file"
            type="file"
            accept={Object.keys(CONSENT_FILE_TYPES).join(",")}
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            className="h-auto py-1.5"
          />
          {uploadedId ? (
            <p className="flex items-center gap-1 text-meta text-success-foreground">
              <CheckCircle2Icon className="size-3.5" aria-hidden /> {file?.name ?? "Signed form"} is uploaded. Saving again links it to the consent.
            </p>
          ) : null}
        </Field>
      ) : null}

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
          {pending ? (file && !uploadedId ? "Uploading…" : "Saving…") : "Save consent"}
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
