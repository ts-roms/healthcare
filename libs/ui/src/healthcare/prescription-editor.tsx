"use client";

import * as React from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertOctagonIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Allergy, PrescriptionItem } from "@healthcare/domain";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { cn } from "../lib/utils";

export const prescriptionSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        drug: z.string().min(1, "Required"),
        strength: z.string().min(1, "Required"),
        form: z.string().min(1, "Required"),
        sig: z.string().min(3, "Enter directions"),
        quantity: z.coerce.number<number>().int().positive("Must be > 0"),
        refills: z.coerce.number<number>().int().min(0).max(11),
      }),
    )
    .min(1, "Add at least one medication"),
});

export type PrescriptionFormValues = z.infer<typeof prescriptionSchema>;

/**
 * Minimal cross-reactivity map for the demo. Production should call a
 * drug-interaction / allergy service rather than string matching.
 */
const ALLERGY_CLASSES: Record<string, string[]> = {
  penicillin: ["penicillin", "amoxicillin", "ampicillin", "co-amoxiclav", "piperacillin", "cloxacillin"],
  sulfonamides: ["sulfamethoxazole", "cotrimoxazole", "co-trimoxazole", "sulfasalazine"],
};

export function allergyConflict(drug: string, allergies: Allergy[]): Allergy | undefined {
  const d = drug.trim().toLowerCase();
  if (!d) return undefined;
  return allergies.find((a) => {
    const key = a.substance.toLowerCase();
    const members = ALLERGY_CLASSES[key] ?? [key];
    return members.some((m) => d.includes(m));
  });
}

const blank = (): PrescriptionItem => ({ id: crypto.randomUUID(), drug: "", strength: "", form: "tablet", sig: "", quantity: 30, refills: 0 });

export interface PrescriptionEditorProps {
  defaultItems?: PrescriptionItem[];
  allergies?: Allergy[];
  onSubmit: (values: PrescriptionFormValues) => void;
  className?: string;
}

export function PrescriptionEditor({ defaultItems, allergies = [], onSubmit, className }: PrescriptionEditorProps) {
  const form = useForm<PrescriptionFormValues>({
    resolver: zodResolver(prescriptionSchema),
    defaultValues: { items: defaultItems?.length ? defaultItems : [blank()] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const items = form.watch("items");
  const errors = form.formState.errors.items;
  const conflicts = items.map((i) => allergyConflict(i.drug, allergies));
  const hasConflict = conflicts.some(Boolean);

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={cn("flex flex-col gap-2", className)} noValidate>
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
                      <td colSpan={7} className="px-2 pb-1.5">
                        <p role="alert" className="flex items-center gap-1.5 text-table font-semibold text-critical dark:text-danger-foreground">
                          <AlertOctagonIcon className="size-4" aria-hidden />
                          Allergy conflict: patient is allergic to {conflict.substance}
                          {conflict.reaction ? ` (${conflict.reaction})` : ""}.
                        </p>
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
          {hasConflict ? <span className="text-meta text-muted-foreground">Resolve allergy conflicts to sign</span> : null}
          <Button type="submit" size="sm" disabled={hasConflict}>
            Sign prescription
          </Button>
        </div>
      </div>
    </form>
  );
}
