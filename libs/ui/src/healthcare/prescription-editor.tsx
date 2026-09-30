"use client";

import * as React from "react";
import { useFieldArray, useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertOctagonIcon, CheckCircle2Icon, PlusIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react";
import {
  ALLERGY_OVERRIDE_REASONS,
  findAllergyConflict,
  isValidOverrideReason,
  type Allergy,
  type AllergyConflict,
  type PrescriptionItem,
  type PrescriptionSubmission,
} from "@healthcare/domain";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { cn } from "../lib/utils";
import { createPrescriptionSchema, toPrescriptionSubmission, type PrescriptionFormValues } from "./prescription-schema";
import { severitySpec } from "./status";

const blank = (): PrescriptionFormValues["items"][number] => ({
  id: crypto.randomUUID(),
  drug: "",
  strength: "",
  form: "tablet",
  sig: "",
  quantity: 30,
  refills: 0,
});

export interface PrescriptionEditorProps {
  defaultItems?: PrescriptionItem[];
  allergies?: Allergy[];
  /** Receives the items and every documented allergy override (record the overrides in the audit trail). */
  onSubmit: (submission: PrescriptionSubmission) => void;
  className?: string;
}

export function PrescriptionEditor({ defaultItems, allergies = [], onSubmit, className }: PrescriptionEditorProps) {
  const schema = React.useMemo(() => createPrescriptionSchema(allergies), [allergies]);
  const form = useForm<PrescriptionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { items: defaultItems?.length ? defaultItems : [blank()] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const items = useWatch({ control: form.control, name: "items" });
  const errors = form.formState.errors.items;
  const conflicts = items.map((i) => findAllergyConflict(i.drug, allergies));
  const unresolved = conflicts.filter((c, i) => c && !isValidOverrideReason(items[i]?.overrideReason)).length;

  return (
    <form onSubmit={form.handleSubmit((v) => onSubmit(toPrescriptionSubmission(v, allergies)))} className={cn("flex flex-col gap-2", className)} noValidate>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-table">
          <thead className="bg-muted text-meta font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-2 py-1.5 text-left">Drug</th>
              <th className="px-2 py-1.5 text-left">Strength</th>
              <th className="px-2 py-1.5 text-left">Form</th>
              <th className="px-2 py-1.5 text-left">Sig</th>
              <th className="w-20 px-2 py-1.5 text-left">Qty</th>
              <th className="w-16 px-2 py-1.5 text-left">Refills</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const e = errors?.[index];
              const conflict = conflicts[index];
              return (
                <React.Fragment key={field.id}>
                  <tr className={cn("border-t align-top", conflict && "bg-critical-subtle")}>
                    <td className="p-1">
                      <Input aria-label="Drug" aria-invalid={!!e?.drug || !!conflict} {...form.register(`items.${index}.drug`)} className="h-7 min-w-32" />
                    </td>
                    <td className="p-1">
                      <Input aria-label="Strength" aria-invalid={!!e?.strength} {...form.register(`items.${index}.strength`)} className="h-7 w-24" />
                    </td>
                    <td className="p-1">
                      <Input aria-label="Form" aria-invalid={!!e?.form} {...form.register(`items.${index}.form`)} className="h-7 w-24" />
                    </td>
                    <td className="p-1">
                      <Input aria-label="Directions (sig)" aria-invalid={!!e?.sig} {...form.register(`items.${index}.sig`)} className="h-7 min-w-48" />
                      {e?.sig ? <p className="mt-0.5 text-meta text-danger-foreground">{e.sig.message}</p> : null}
                    </td>
                    <td className="p-1">
                      <Input
                        aria-label="Quantity"
                        type="number"
                        inputMode="numeric"
                        aria-invalid={!!e?.quantity}
                        {...form.register(`items.${index}.quantity`)}
                        className="tabular h-7"
                      />
                    </td>
                    <td className="p-1">
                      <Input
                        aria-label="Refills"
                        type="number"
                        inputMode="numeric"
                        aria-invalid={!!e?.refills}
                        {...form.register(`items.${index}.refills`)}
                        className="tabular h-7"
                      />
                    </td>
                    <td className="p-1">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)} aria-label="Remove medication">
                        <Trash2Icon />
                      </Button>
                    </td>
                  </tr>
                  {conflict ? (
                    <tr className="bg-critical-subtle">
                      <td colSpan={7} className="px-2 pb-2">
                        <AllergyConflictPanel
                          form={form}
                          index={index}
                          conflict={conflict}
                          drug={items[index]?.drug ?? ""}
                          error={e?.overrideReason?.message}
                        />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {errors?.root?.message || errors?.message ? <p className="text-meta text-danger-foreground">{errors?.root?.message ?? errors?.message}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => append(blank())}>
          <PlusIcon /> Add medication
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {unresolved ? (
            <span className="text-meta font-medium text-critical dark:text-danger-foreground">
              {unresolved} allergy conflict{unresolved > 1 ? "s" : ""} need{unresolved > 1 ? "" : "s"} a different drug or an override reason
            </span>
          ) : null}
          <Button type="submit" size="sm">
            Sign prescription
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Decision-support panel for one conflicting line: shows the evidence and
 * lets the prescriber change the drug or document an override.
 */
function AllergyConflictPanel({
  form,
  index,
  conflict,
  drug,
  error,
}: {
  form: UseFormReturn<PrescriptionFormValues>;
  index: number;
  conflict: AllergyConflict;
  drug: string;
  error?: string;
}) {
  const reasonField = `items.${index}.overrideReason` as const;
  const reason = form.watch(reasonField);
  const [overriding, setOverriding] = React.useState(reason !== undefined && reason !== "");
  const documented = isValidOverrideReason(reason);
  const reasonId = React.useId();
  const { allergy } = conflict;
  const severity = severitySpec[allergy.severity];

  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-md border border-critical/40 bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1 uppercase">
          <ShieldAlertIcon aria-hidden /> Decision support
        </Badge>
        <span className="flex items-center gap-1.5 font-semibold text-critical dark:text-danger-foreground">
          <AlertOctagonIcon className="size-4" aria-hidden />
          Possible allergy conflict
        </span>
        {documented ? (
          <Badge variant="warning">
            <CheckCircle2Icon aria-hidden /> Override documented
          </Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-table">
        <dt className="text-muted-foreground">Recorded allergy</dt>
        <dd>
          <span className="font-semibold">{allergy.substance}</span> — {severity.label}
          {allergy.reaction ? `, ${allergy.reaction}` : ""}
        </dd>
        <dt className="text-muted-foreground">Why flagged</dt>
        <dd>
          “{drug.trim()}” matches <span className="font-medium">{conflict.matchedTerm}</span>
          {conflict.drugClass ? ` (${conflict.drugClass})` : ""}
        </dd>
        <dt className="text-muted-foreground">Rule source</dt>
        <dd className="text-muted-foreground">{conflict.source}</dd>
      </dl>
      {overriding ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-meta font-semibold">
            Reason for prescribing despite this allergy (required, recorded in the audit trail)
          </label>
          <Input id={reasonId} aria-invalid={!!error} placeholder="e.g. Tolerated amoxicillin in 2024 without reaction" {...form.register(reasonField)} />
          <div className="flex flex-wrap gap-1">
            {ALLERGY_OVERRIDE_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => form.setValue(reasonField, r, { shouldValidate: form.formState.isSubmitted })}
              >
                {r}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ml-auto"
              onClick={() => {
                form.setValue(reasonField, undefined, { shouldValidate: form.formState.isSubmitted });
                setOverriding(false);
              }}
            >
              Cancel override
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="xs" onClick={() => form.setFocus(`items.${index}.drug`)}>
            Change drug
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={() => setOverriding(true)}>
            Override with reason…
          </Button>
        </div>
      )}
      {error && !documented ? <p className="text-meta font-medium text-critical dark:text-danger-foreground">{error}</p> : null}
    </div>
  );
}
