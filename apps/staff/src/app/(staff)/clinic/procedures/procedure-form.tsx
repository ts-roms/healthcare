"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Label, Textarea, toast, useAddSheet } from "@healthcare/ui/primitives";
import { createProcedureDefinition, updateProcedureDefinition } from "@/app/(staff)/clinic/procedure-actions";
import type { ProcedureDefinition } from "@/lib/api/types";
import { BLANK_DEFINITION_FORM, type DefinitionForm } from "@/lib/procedure-form";

const toForm = (d: ProcedureDefinition): DefinitionForm => ({
  code: d.code,
  name: d.name,
  codeSystem: d.codeSystem ?? "",
  externalCode: d.externalCode ?? "",
  requiresBodySite: d.requiresBodySite,
  consentRequired: d.consentRequired,
  allowedOutsideConsultation: d.allowedOutsideConsultation,
  noteTemplate: d.noteTemplate ?? "",
});

/** Add a catalogue entry, or edit one (`editing`): the body of the add/edit sheet. Closes the sheet when the entry is saved. */
export function ProcedureForm({ editing = null }: { editing?: ProcedureDefinition | null }) {
  const router = useRouter();
  const { close } = useAddSheet();
  const [form, setForm] = React.useState<DefinitionForm>(editing ? toForm(editing) : BLANK_DEFINITION_FORM);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = (key: "code" | "name" | "codeSystem" | "externalCode") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateProcedureDefinition({
            id: editing.id,
            version: editing.version,
            name: form.name,
            codeSystem: form.externalCode?.trim() ? form.codeSystem : null,
            externalCode: form.externalCode?.trim() ? form.externalCode : null,
            requiresBodySite: form.requiresBodySite,
            consentRequired: form.consentRequired,
            allowedOutsideConsultation: form.allowedOutsideConsultation,
            noteTemplate: form.noteTemplate?.trim() ? form.noteTemplate : null,
          })
        : await createProcedureDefinition(form);
      if (result.ok) {
        toast.success(editing ? `${result.data.name} updated` : `${result.data.name} added`);
        router.refresh();
        close();
      } else {
        setError(result.message);
        toast.error(result.message);
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label={editing ? "Edit procedure" : "Add a procedure"}>
      <div className="grid gap-1.5">
        <Label htmlFor="procedure-code">Code *</Label>
        <Input
          id="procedure-code"
          maxLength={30}
          value={form.code}
          onChange={set("code")}
          disabled={Boolean(editing)}
          placeholder="e.g. SUT-S"
          autoFocus={!editing}
        />
        {editing ? <span className="text-meta text-muted-foreground">A code never changes; stop offering this entry and add another instead.</span> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="procedure-name">Name *</Label>
        <Input
          id="procedure-name"
          maxLength={200}
          value={form.name}
          onChange={set("name")}
          placeholder="e.g. Suture repair, simple"
          autoFocus={Boolean(editing)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="procedure-code-system">Other code system</Label>
          <Input id="procedure-code-system" maxLength={40} value={form.codeSystem} onChange={set("codeSystem")} placeholder="your key, e.g. rvs" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="procedure-external-code">Other code</Label>
          <Input id="procedure-external-code" maxLength={40} value={form.externalCode} onChange={set("externalCode")} />
        </div>
      </div>
      <p className="-mt-2 text-meta text-muted-foreground">
        Codes are your organization&apos;s own. If you also use another code set (for example a relative value scale edition you are licensed to use), name it
        with your own key and configure its URI for exchange; none is assumed.
      </p>
      <fieldset className="grid gap-3">
        <legend className="sr-only">When this procedure is recorded</legend>
        <div className="flex items-center gap-2">
          <Checkbox
            id="procedure-body-site"
            checked={form.requiresBodySite}
            onCheckedChange={(v) => setForm((f) => ({ ...f, requiresBodySite: v === true }))}
          />
          <Label htmlFor="procedure-body-site" className="text-body font-normal">
            Ask for the body site
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="procedure-consent-required"
            checked={form.consentRequired}
            onCheckedChange={(v) => setForm((f) => ({ ...f, consentRequired: v === true }))}
          />
          <Label htmlFor="procedure-consent-required" className="text-body font-normal">
            Consent must be recorded with the procedure
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="procedure-outside"
            checked={form.allowedOutsideConsultation}
            onCheckedChange={(v) => setForm((f) => ({ ...f, allowedOutsideConsultation: v === true }))}
          />
          <Label htmlFor="procedure-outside" className="text-body font-normal">
            May be recorded under a visit without a consultation
          </Label>
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="procedure-note-template">Note template</Label>
        <Textarea
          id="procedure-note-template"
          rows={4}
          maxLength={2000}
          value={form.noteTemplate}
          onChange={(e) => setForm((f) => ({ ...f, noteTemplate: e.target.value }))}
          placeholder={"e.g. Anaesthetic:\nSutures:\nTolerated:"}
        />
        <span className="text-meta text-muted-foreground">
          Prefills the notes when this procedure is chosen; the clinician writes what applies. Not a clinical rule.
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-table text-danger-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || form.name.trim().length < 2 || !form.code.trim()}>
          {editing ? "Save changes" : "Add procedure"}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
