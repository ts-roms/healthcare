"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { Button, DateTimeInput, Input, Label, NativeSelect, Textarea, toast } from "@healthcare/ui/primitives";
import { recordProcedure, recordVisitProcedure } from "@/app/(staff)/clinic/procedure-actions";
import type { ConsentFormDocument } from "@/lib/api/procedures";
import type { Practitioner, ProcedureDefinition } from "@/lib/api/types";
import { applyDefinition, BLANK_PROCEDURE_FORM, definitionLabel, type ProcedureForm } from "@/lib/procedure-form";
import { ConsentFields, consentPrintHref } from "./consent-fields";

/** What the procedure is filed under: a consultation, or a queue visit without one. */
export type ProcedureTarget = { kind: "encounter"; id: string; signed: boolean } | { kind: "visit"; id: string };

/**
 * Records a procedure from the organization's catalogue (docs/domains/clinic.md, "Procedures"): who performed it, when,
 * the body site, how many, notes prefilled from the entry's template, and the consent obtained (required when the
 * entry says so). In a consultation (encounter.write; after signing, encounter.amend and a reason) or under a queue
 * visit (procedure.record; entries the organization allows outside a consultation). The API validates and decides.
 */
export function RecordProcedureForm({
  target,
  patientId,
  definitions,
  practitioners,
  documents,
  onDone,
}: {
  target: ProcedureTarget;
  patientId: string;
  definitions: ProcedureDefinition[];
  practitioners: Practitioner[];
  /** Signed consent forms uploaded for the patient; null when they cannot be listed. */
  documents: ConsentFormDocument[] | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const signed = target.kind === "encounter" && target.signed;
  const offered = target.kind === "visit" ? definitions.filter((d) => d.allowedOutsideConsultation) : definitions;
  const [form, setForm] = React.useState<ProcedureForm>({ ...BLANK_PROCEDURE_FORM, signed });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof ProcedureForm>(key: K, value: ProcedureForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const chosen = offered.find((d) => d.id === form.definitionId);
  const id = `procedure-${target.id}`;
  return (
    <form
      noValidate
      aria-label="Record a procedure"
      className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const input = { ...form, requiresBodySite: chosen?.requiresBodySite ?? false, consentRequired: chosen?.consentRequired ?? false, signed };
          const result =
            target.kind === "encounter" ? await recordProcedure(target.id, patientId, input) : await recordVisitProcedure(target.id, patientId, input);
          if (result.ok) {
            toast.success(`${result.data.name} recorded`);
            router.refresh();
            onDone();
          } else setError(result.message);
        });
      }}
    >
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor={`${id}-definition`}>Procedure *</Label>
        <NativeSelect
          id={`${id}-definition`}
          placeholder="Choose…"
          emptyText={target.kind === "visit" ? "No procedure may be recorded outside a consultation" : "No procedures in the catalogue"}
          value={form.definitionId}
          onChange={(e) =>
            setForm((f) =>
              applyDefinition(
                f,
                offered.find((d) => d.id === e.target.value),
                offered.find((d) => d.id === f.definitionId),
              ),
            )
          }
        >
          {offered.map((d) => (
            <option key={d.id} value={d.id}>
              {definitionLabel(d)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label htmlFor={`${id}-performer`}>Performed by</Label>
        <NativeSelect
          id={`${id}-performer`}
          value={form.performerPractitionerId}
          emptyText="No other practitioners set up"
          onChange={(e) => set("performerPractitionerId", e.target.value)}
        >
          <option value="">Me</option>
          {practitioners
            .filter((p) => p.status === "active")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${id}-when`}>When</Label>
        <DateTimeInput id={`${id}-when`} value={form.performedAt} onValueChange={(v) => set("performedAt", v)} />
        <span className="text-meta text-muted-foreground">Leave empty for now.</span>
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${id}-site`}>{chosen?.requiresBodySite ? "Body site *" : "Body site"}</Label>
        <Input id={`${id}-site`} maxLength={120} placeholder="e.g. left forearm" value={form.bodySite} onChange={(e) => set("bodySite", e.target.value)} />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label htmlFor={`${id}-quantity`}>How many</Label>
        <Input id={`${id}-quantity`} inputMode="numeric" maxLength={2} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
        <span className="text-meta text-muted-foreground">Billed as this quantity.</span>
      </div>
      <div className="grid gap-1 sm:col-span-6">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} rows={chosen?.noteTemplate ? 4 : 2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        {chosen?.noteTemplate ? <span className="text-meta text-muted-foreground">Prefilled from your clinic&apos;s template; write what applies.</span> : null}
      </div>
      <ConsentFields
        id={id}
        form={form}
        set={set}
        wording={chosen?.consentWording ?? null}
        printHref={consentPrintHref(chosen, patientId)}
        documents={documents}
        required={chosen?.consentRequired ?? false}
      />
      {signed ? (
        <div className="grid gap-1 sm:col-span-6">
          <Label htmlFor={`${id}-late`}>Why is it recorded after signing? *</Label>
          <Input
            id={`${id}-late`}
            maxLength={500}
            placeholder="e.g. not recorded before signing"
            value={form.lateEntryReason}
            onChange={(e) => set("lateEntryReason", e.target.value)}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-table text-danger-foreground sm:col-span-6">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending || !chosen}>
          Record procedure
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
