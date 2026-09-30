"use client";

import * as React from "react";
import { surfaceName, toothLabel, type ToothNotation, type ToothSurface, toothSurfaces } from "@healthcare/domain";
import { Input, Label, NativeSelect, ToggleGroup, ToggleGroupItem } from "@healthcare/ui/primitives";
import type { DentalProcedureType } from "@/lib/api/types";
import { PROCEDURE_SITES } from "@/lib/dental-mapping";

const FDI = /^([1-4][1-8]|[5-8][1-5])$/;

export interface ProcedureSelection {
  procedureTypeId: string;
  tooth: string;
  surfaces: ToothSurface[];
}

export const emptySelection: ProcedureSelection = { procedureTypeId: "", tooth: "", surfaces: [] };

/** What the selection sends: tooth and surfaces only where the procedure's site takes them. */
export function selectionPayload(selection: ProcedureSelection, type: DentalProcedureType | undefined) {
  return {
    procedureTypeId: selection.procedureTypeId,
    tooth: type && type.site !== "mouth" && selection.tooth ? selection.tooth : undefined,
    surfaces: type?.site === "surface" ? selection.surfaces : [],
  };
}

/** Procedure, tooth (FDI code) and surfaces, as the procedure's site requires. The API validates the combination. */
export function ProcedureFields({
  id,
  types,
  value,
  notation,
  onChange,
}: {
  id: string;
  types: DentalProcedureType[];
  value: ProcedureSelection;
  notation: ToothNotation;
  onChange: (value: ProcedureSelection) => void;
}) {
  const type = types.find((t) => t.id === value.procedureTypeId);
  const validTooth = FDI.test(value.tooth);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${id}-procedure`}>Procedure</Label>
        <NativeSelect
          placeholder="Choose…"
          id={`${id}-procedure`}
          value={value.procedureTypeId}
          onChange={(e) => onChange({ ...value, procedureTypeId: e.target.value, surfaces: [] })}
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({PROCEDURE_SITES[t.site].toLowerCase()})
            </option>
          ))}
        </NativeSelect>
      </div>
      {type && type.site !== "mouth" ? (
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor={`${id}-tooth`}>Tooth (FDI)</Label>
          <Input
            id={`${id}-tooth`}
            inputMode="numeric"
            maxLength={2}
            value={value.tooth}
            onChange={(e) => onChange({ ...value, tooth: e.target.value.replace(/\D/g, ""), surfaces: [] })}
            aria-invalid={value.tooth !== "" && !validTooth}
            aria-describedby={`${id}-tooth-help`}
          />
          <span id={`${id}-tooth-help`} className="text-meta text-muted-foreground">
            {validTooth ? (notation === "fdi" ? " " : `= ${toothLabel(value.tooth, notation)}`) : value.tooth ? "Not a tooth" : "e.g. 16"}
          </span>
        </div>
      ) : null}
      {type?.site === "surface" && validTooth ? (
        <div className="flex flex-col gap-1.5">
          <Label asChild>
            <span>Surfaces</span>
          </Label>
          <ToggleGroup
            type="multiple"
            value={value.surfaces}
            onValueChange={(v) => onChange({ ...value, surfaces: v as ToothSurface[] })}
            aria-label="Surfaces"
          >
            {toothSurfaces(value.tooth).map((s) => (
              <ToggleGroupItem key={s} value={s} title={surfaceName(value.tooth, s)}>
                <span className="font-mono">{s}</span>
                <span className="sr-only"> {surfaceName(value.tooth, s)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="text-meta text-muted-foreground">&nbsp;</span>
        </div>
      ) : null}
    </div>
  );
}

/** Whether the selection is complete for the procedure's site (the API checks the details). */
export function selectionComplete(selection: ProcedureSelection, type: DentalProcedureType | undefined): boolean {
  if (!type) return false;
  if (type.site === "mouth") return true;
  if (!FDI.test(selection.tooth)) return false;
  return type.site === "tooth" || selection.surfaces.length > 0;
}

/** "Composite restoration — 16 MO" in the facility's notation. */
export function itemLabel(name: string, tooth: string | null, surfaces: readonly string[], notation: ToothNotation): string {
  if (!tooth) return name;
  return `${name} — ${toothLabel(tooth, notation)}${surfaces.length ? ` ${surfaces.join("")}` : ""}`;
}

export function useProcedureTypes(types: DentalProcedureType[]) {
  return React.useMemo(() => types.filter((t) => t.status === "active"), [types]);
}
