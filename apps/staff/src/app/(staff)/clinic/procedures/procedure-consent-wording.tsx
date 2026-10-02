"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon } from "lucide-react";
import { Button, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { publishConsentWording } from "@/app/(staff)/clinic/procedure-actions";
import type { ProcedureDefinition } from "@/lib/api/types";
import { type ConsentWordingForm } from "@/lib/procedure-form";

/**
 * The organization's own consent wording per procedure (docs/domains/clinic.md, "Procedures"): what the patient reads
 * and signs before the procedure. Versioned and append-only: publishing replaces nothing, each recorded consent keeps
 * the version shown. The platform ships no wording; its content is the organization's compliance decision.
 */
export function ProcedureConsentWording({ definitions, canConfigure }: { definitions: ProcedureDefinition[]; canConfigure: boolean }) {
  const router = useRouter();
  const [definitionId, setDefinitionId] = React.useState("");
  const [form, setForm] = React.useState<ConsentWordingForm>({ title: "", body: "" });
  const [pending, startTransition] = React.useTransition();
  const chosen = definitions.find((d) => d.id === definitionId);
  const withWording = definitions.filter((d) => d.consentWording);
  return (
    <section className="flex flex-col gap-3 border-t p-4" aria-labelledby="consent-wording-heading">
      <div>
        <h2 id="consent-wording-heading" className="flex items-center gap-1.5 text-body font-semibold">
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden /> Consent wording
        </h2>
        <p className="text-table text-muted-foreground">
          The text a patient reads and signs before a procedure, in your organization&apos;s own words. Each version is kept; a recorded consent names the
          version the patient was shown. Printable per patient from the consultation or the visit. What a valid consent must say is your organization&apos;s
          decision with its advisers; nothing is provided here.
        </p>
      </div>
      {withWording.length ? (
        <ul className="flex flex-col gap-1 text-table">
          {withWording.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{d.name}</span>
              <span className="text-meta text-muted-foreground">
                {d.consentWording!.title} · version {d.consentWording!.version}
                {d.consentRequired ? " · consent required" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-table text-muted-foreground">No consent wording published yet.</p>
      )}
      {canConfigure ? (
        <form
          aria-label="Publish consent wording"
          className="grid gap-2 rounded-md border p-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await publishConsentWording(definitionId, form);
              if (result.ok) {
                toast.success(`Version ${result.data.version} published for ${chosen?.name ?? "the procedure"}`);
                setForm({ title: "", body: "" });
                router.refresh();
              } else toast.error(result.message);
            });
          }}
        >
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor="wording-definition">Procedure *</Label>
            <NativeSelect
              id="wording-definition"
              placeholder="Choose…"
              emptyText="No procedures in the catalogue"
              value={definitionId}
              onChange={(e) => {
                const next = definitions.find((d) => d.id === e.target.value);
                setDefinitionId(e.target.value);
                // Start from the current version's text so a small change does not mean retyping it.
                setForm(next?.consentWording ? { title: next.consentWording.title, body: next.consentWording.body } : { title: "", body: "" });
              }}
            >
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                  {d.consentWording ? ` (version ${d.consentWording.version})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1 sm:col-span-3">
            <Label htmlFor="wording-title">Title *</Label>
            <Input id="wording-title" maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="grid gap-1 sm:col-span-6">
            <Label htmlFor="wording-body">Wording *</Label>
            <Textarea id="wording-body" rows={8} maxLength={8000} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
            <span className="text-meta text-muted-foreground">Plain text; a blank line starts a new paragraph on the printed form.</span>
          </div>
          <div className="flex gap-2 sm:col-span-6">
            <Button type="submit" size="sm" disabled={pending || !chosen || form.title.trim().length < 2 || form.body.trim().length < 20}>
              {chosen?.consentWording ? `Publish version ${chosen.consentWording.version + 1}` : "Publish"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
