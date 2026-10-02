"use client";

import * as React from "react";
import { PrinterIcon } from "lucide-react";
import { Button, Checkbox, DateTimeInput, Input, Label, NativeSelect, Textarea } from "@healthcare/ui/primitives";
import type { ConsentFormDocument } from "@/lib/api/procedures";
import type { ProcedureConsentWording } from "@/lib/api/types";
import { fileHref } from "@/lib/files";
import type { ProcedureForm } from "@/lib/procedure-form";

export const CAPTURED_VIA_LABEL = { paper: "Signed on paper", electronic: "Electronically (wording shown)", verbal: "In words (verbal)" } as const;

/**
 * The consent obtained for a procedure, as recorded against it (docs/domains/clinic.md, "Procedures"): how it was
 * captured, by the patient or a representative named as written, when, the published wording shown, a scan of the
 * signed form. Who may consent for whom is the organization's own rule; nothing here decides it.
 */
export function ConsentFields({
  id,
  form,
  set,
  wording,
  printHref,
  documents,
  required,
  showToggle = true,
}: {
  id: string;
  form: ProcedureForm;
  set: <K extends keyof ProcedureForm>(key: K, value: ProcedureForm[K]) => void;
  /** The current wording published for the chosen procedure, if any. */
  wording: ProcedureConsentWording | null;
  /** The printable form for this patient (when a wording is published). */
  printHref: string | null;
  /** Signed consent forms uploaded for the patient (document.read); null when they cannot be listed. */
  documents: ConsentFormDocument[] | null;
  required: boolean;
  showToggle?: boolean;
}) {
  const given = form.consentGiven || required;
  return (
    <fieldset className="grid gap-2 rounded-md border border-dashed p-2.5 sm:col-span-6 sm:grid-cols-6">
      <legend className="px-1 text-meta font-semibold tracking-wide text-muted-foreground uppercase">Consent</legend>
      {showToggle ? (
        <div className="flex items-center gap-2 sm:col-span-4">
          <Checkbox id={`${id}-consent`} checked={given} disabled={required} onCheckedChange={(v) => set("consentGiven", v === true)} />
          <Label htmlFor={`${id}-consent`}>{required ? "Consent is required for this procedure and recorded with it" : "Record the consent obtained"}</Label>
        </div>
      ) : null}
      {printHref ? (
        <div className="sm:col-span-2 sm:justify-self-end">
          <Button asChild type="button" size="xs" variant="outline">
            <a href={printHref} target="_blank" rel="noreferrer">
              <PrinterIcon aria-hidden /> Print consent form
            </a>
          </Button>
        </div>
      ) : null}
      {given ? (
        <>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor={`${id}-consent-via`}>Obtained *</Label>
            <NativeSelect
              id={`${id}-consent-via`}
              value={form.consentCapturedVia}
              onChange={(e) => set("consentCapturedVia", e.target.value as ProcedureForm["consentCapturedVia"])}
            >
              {(Object.keys(CAPTURED_VIA_LABEL) as Array<keyof typeof CAPTURED_VIA_LABEL>).map((k) => (
                <option key={k} value={k}>
                  {CAPTURED_VIA_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
            {form.consentCapturedVia === "electronic" && !wording ? (
              <span className="text-meta text-warning-foreground">
                No wording is published for this procedure; an administrator adds it under Clinic → Procedures.
              </span>
            ) : wording && (form.consentCapturedVia === "electronic" || form.consentWordingId) ? (
              <span className="text-meta text-muted-foreground">
                Wording: {wording.title}, version {wording.version}.
              </span>
            ) : null}
          </div>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor={`${id}-consent-by`}>Given by *</Label>
            <NativeSelect
              id={`${id}-consent-by`}
              value={form.consentGivenBy}
              onChange={(e) => set("consentGivenBy", e.target.value as ProcedureForm["consentGivenBy"])}
            >
              <option value="patient">The patient</option>
              <option value="representative">A representative (parent, guardian, relative)</option>
            </NativeSelect>
          </div>
          {form.consentGivenBy === "representative" ? (
            <>
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor={`${id}-consent-rep`}>Representative&apos;s name *</Label>
                <Input
                  id={`${id}-consent-rep`}
                  maxLength={200}
                  value={form.consentRepresentativeName}
                  onChange={(e) => set("consentRepresentativeName", e.target.value)}
                />
              </div>
              <div className="grid gap-1 sm:col-span-3">
                <Label htmlFor={`${id}-consent-rel`}>Relationship</Label>
                <Input
                  id={`${id}-consent-rel`}
                  maxLength={100}
                  placeholder="e.g. mother"
                  value={form.consentRepresentativeRelationship}
                  onChange={(e) => set("consentRepresentativeRelationship", e.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor={`${id}-consent-when`}>When obtained</Label>
            <DateTimeInput id={`${id}-consent-when`} value={form.consentObtainedAt} onValueChange={(v) => set("consentObtainedAt", v)} />
            <span className="text-meta text-muted-foreground">Leave empty for the time of the procedure. Never after it.</span>
          </div>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor={`${id}-consent-doc`}>Signed form (scan)</Label>
            <NativeSelect
              id={`${id}-consent-doc`}
              placeholder="None linked"
              emptyText={documents ? "No consent form uploaded for this patient" : "Documents not available to you"}
              value={form.consentDocumentId}
              onChange={(e) => set("consentDocumentId", e.target.value)}
            >
              {(documents ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </NativeSelect>
            <span className="text-meta text-muted-foreground">Upload the signed form as a consent form document on the patient record, then link it here.</span>
          </div>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor={`${id}-consent-notes`}>Consent notes</Label>
            <Textarea id={`${id}-consent-notes`} rows={1} maxLength={1000} value={form.consentNotes} onChange={(e) => set("consentNotes", e.target.value)} />
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

/** The print link for a catalogue entry's consent form, for one patient, when a wording is published. */
export function consentPrintHref(definition: { id: string; consentWording: ProcedureConsentWording | null } | undefined, patientId: string): string | null {
  return definition?.consentWording ? fileHref.procedureConsentForm(definition.id, patientId) : null;
}
