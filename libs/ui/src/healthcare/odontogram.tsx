"use client";

import * as React from "react";
import type { DentalChart, ToothCondition, ToothNumber, ToothRecord, ToothSurface } from "@healthcare/domain";
import { Label } from "../primitives/label";
import { Textarea } from "../primitives/textarea";
import { ToggleGroup, ToggleGroupItem } from "../primitives/toggle-group";
import { cn } from "../lib/utils";

// ---- Model ------------------------------------------------------------------

/** Viewer's perspective (facing the patient): patient's right is on the left. */
export const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
export const UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];
export const LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];

export const TOOTH_CONDITIONS: { value: ToothCondition; label: string; code: string }[] = [
  { value: "healthy", label: "Healthy", code: "" },
  { value: "caries", label: "Caries", code: "C" },
  { value: "filled", label: "Filled", code: "F" },
  { value: "missing", label: "Missing", code: "M" },
  { value: "extraction", label: "Extraction", code: "X" },
  { value: "root-canal", label: "Root canal", code: "RC" },
  { value: "crown", label: "Crown", code: "Cr" },
];

export const TOOTH_SURFACES: { value: ToothSurface; label: string; code: string }[] = [
  { value: "mesial", label: "Mesial", code: "M" },
  { value: "distal", label: "Distal", code: "D" },
  { value: "buccal", label: "Buccal", code: "B" },
  { value: "lingual", label: "Lingual", code: "L" },
  { value: "occlusal", label: "Occlusal", code: "O" },
];

const conditionMeta = Object.fromEntries(TOOTH_CONDITIONS.map((c) => [c.value, c])) as Record<ToothCondition, (typeof TOOTH_CONDITIONS)[number]>;

export function toothName(n: ToothNumber) {
  const q = Math.floor(n / 10);
  const pos = n % 10;
  const arch = q === 1 || q === 2 ? "upper" : "lower";
  const side = q === 1 || q === 4 ? "right" : "left";
  const type = pos <= 2 ? "incisor" : pos === 3 ? "canine" : pos <= 5 ? "premolar" : "molar";
  return `${arch} ${side} ${type}`;
}

/** Which drawn side of the tooth glyph each anatomical surface occupies. */
function surfaceLayout(n: ToothNumber): Record<ToothSurface, "top" | "bottom" | "left" | "right" | "center"> {
  const q = Math.floor(n / 10);
  const upper = q === 1 || q === 2;
  const viewerLeft = q === 1 || q === 4;
  return {
    buccal: upper ? "top" : "bottom",
    lingual: upper ? "bottom" : "top",
    mesial: viewerLeft ? "right" : "left",
    distal: viewerLeft ? "left" : "right",
    occlusal: "center",
  };
}

const POLY = {
  top: "0,0 40,0 28,12 12,12",
  bottom: "0,40 12,28 28,28 40,40",
  left: "0,0 12,12 12,28 0,40",
  right: "40,0 40,40 28,28 28,12",
} as const;

function surfaceFill(condition: ToothCondition) {
  if (condition === "caries") return "var(--danger)";
  if (condition === "filled") return "var(--info)";
  return "transparent";
}

// ---- Tooth glyph --------------------------------------------------------------

function ToothGlyph({ number, record }: { number: ToothNumber; record?: ToothRecord }) {
  const condition = record?.condition ?? "healthy";
  const layout = surfaceLayout(number);
  const marked = new Set(record?.surfaces.map((s) => layout[s]));
  // Surface-level conditions with no surfaces specified shade the whole tooth.
  const wholeTooth = (condition === "caries" || condition === "filled") && marked.size === 0;
  const fill = surfaceFill(condition);
  const absent = condition === "missing";
  const base = "var(--card)";
  const stroke = "var(--muted-foreground)";

  return (
    <svg viewBox="-3 -3 46 46" className="size-full" aria-hidden>
      <g opacity={absent ? 0.35 : 1} stroke={stroke} strokeWidth={1} strokeLinejoin="round">
        {(Object.keys(POLY) as (keyof typeof POLY)[]).map((side) => (
          <polygon key={side} points={POLY[side]} fill={wholeTooth || marked.has(side) ? fill : base} />
        ))}
        <rect x={12} y={12} width={16} height={16} fill={wholeTooth || marked.has("center") ? fill : base} />
      </g>
      {condition === "crown" ? <rect x={-2} y={-2} width={44} height={44} rx={4} fill="none" stroke="var(--warning)" strokeWidth={3} /> : null}
      {condition === "root-canal" ? <line x1={20} y1={2} x2={20} y2={38} stroke="var(--teal)" strokeWidth={4} strokeLinecap="round" /> : null}
      {condition === "missing" || condition === "extraction" ? (
        <g stroke={condition === "extraction" ? "var(--danger)" : stroke} strokeWidth={3} strokeLinecap="round">
          <line x1={2} y1={2} x2={38} y2={38} />
          <line x1={38} y1={2} x2={2} y2={38} />
        </g>
      ) : null}
    </svg>
  );
}

// ---- Chart --------------------------------------------------------------------

export interface OdontogramProps {
  chart: DentalChart;
  selectedTooth?: ToothNumber;
  onSelectTooth?: (tooth: ToothNumber) => void;
  className?: string;
}

/** FDI adult dentition chart. Condition is shown as glyph + text code (never colour alone). */
export function Odontogram({ chart, selectedTooth, onSelectTooth, className }: OdontogramProps) {
  const renderTooth = (n: ToothNumber, lower: boolean) => {
    const record = chart[n];
    const meta = conditionMeta[record?.condition ?? "healthy"];
    const surfaces = record?.surfaces.map((s) => TOOTH_SURFACES.find((x) => x.value === s)!.code).join("") ?? "";
    const code = meta.code ? `${meta.code}${surfaces ? `·${surfaces}` : ""}` : "";
    const selected = selectedTooth === n;
    const label = `Tooth ${n}, ${toothName(n)}, ${meta.label}${record?.surfaces.length ? `, ${record.surfaces.join(" ")}` : ""}`;
    return (
      <button
        key={n}
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onClick={() => onSelectTooth?.(n)}
        className={cn(
          "flex w-10 flex-col items-center gap-0.5 rounded-md p-0.5 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          lower && "flex-col-reverse",
          selected && "bg-primary-subtle ring-2 ring-primary",
        )}
      >
        <span className={cn("tabular font-mono text-meta", selected ? "font-bold text-primary" : "text-muted-foreground")}>{n}</span>
        <span className="size-9">
          <ToothGlyph number={n} record={record} />
        </span>
        <span className="h-3.5 font-mono text-[10px] leading-none font-semibold text-foreground">{code}</span>
      </button>
    );
  };

  const row = (right: number[], left: number[], lower: boolean) => (
    <div className="flex items-stretch justify-center">
      <div className="flex gap-0.5 border-r-2 border-foreground/30 pr-1.5">{right.map((n) => renderTooth(n, lower))}</div>
      <div className="flex gap-0.5 pl-1.5">{left.map((n) => renderTooth(n, lower))}</div>
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-2 overflow-x-auto", className)}>
      <div role="group" aria-label="Dental chart, FDI notation, viewer's perspective" className="mx-auto flex min-w-max flex-col">
        <div className="mb-1 flex justify-between px-1 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          <span>Patient right</span>
          <span>Upper</span>
          <span>Patient left</span>
        </div>
        {row(UPPER_RIGHT, UPPER_LEFT, false)}
        <div className="my-1 border-t-2 border-foreground/30" />
        {row(LOWER_RIGHT, LOWER_LEFT, true)}
        <div className="mt-1 text-center text-meta font-semibold tracking-wide text-muted-foreground uppercase">Lower</div>
      </div>
      <OdontogramLegend />
    </div>
  );
}

export function OdontogramLegend({ className }: { className?: string }) {
  const sample = (condition: ToothCondition, surfaces: ToothSurface[] = []) => (
    <span className="inline-block size-5">
      <ToothGlyph number={16} record={{ tooth: 16, condition, surfaces }} />
    </span>
  );
  return (
    <ul className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1 text-meta text-muted-foreground", className)} aria-label="Legend">
      {TOOTH_CONDITIONS.filter((c) => c.value !== "healthy").map((c) => (
        <li key={c.value} className="flex items-center gap-1">
          {sample(c.value, c.value === "caries" || c.value === "filled" ? ["occlusal"] : [])}
          <span className="font-mono font-semibold text-foreground">{c.code}</span> {c.label}
        </li>
      ))}
      <li>Surfaces: M D B L O</li>
    </ul>
  );
}

// ---- Tooth editor ---------------------------------------------------------------

export interface ToothEditorProps {
  tooth: ToothNumber;
  record?: ToothRecord;
  onChange: (record: ToothRecord) => void;
  className?: string;
}

export function ToothEditor({ tooth, record, onChange, className }: ToothEditorProps) {
  const current: ToothRecord = record ?? { tooth, condition: "healthy", surfaces: [] };
  const surfaceApplies = current.condition === "caries" || current.condition === "filled";
  const notesId = React.useId();
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <h3 className="text-section font-semibold">Tooth #{tooth}</h3>
        <p className="text-meta text-muted-foreground capitalize">{toothName(tooth)}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label asChild>
          <span>Condition</span>
        </Label>
        <ToggleGroup
          type="single"
          value={current.condition}
          onValueChange={(v) =>
            v && onChange({ ...current, condition: v as ToothCondition, surfaces: v === "caries" || v === "filled" ? current.surfaces : [] })
          }
          aria-label="Tooth condition"
        >
          {TOOTH_CONDITIONS.map((c) => (
            <ToggleGroupItem key={c.value} value={c.value}>
              {c.code ? <span className="font-mono text-meta">{c.code}</span> : null}
              {c.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label asChild>
          <span>Surfaces {surfaceApplies ? null : <span className="font-normal text-muted-foreground">(caries / filled only)</span>}</span>
        </Label>
        <ToggleGroup
          type="multiple"
          value={current.surfaces}
          disabled={!surfaceApplies}
          onValueChange={(v) => onChange({ ...current, surfaces: v as ToothSurface[] })}
          aria-label="Affected surfaces"
        >
          {TOOTH_SURFACES.map((s) => (
            <ToggleGroupItem key={s.value} value={s.value} className="disabled:opacity-50">
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={notesId}>Notes</Label>
        <Textarea
          id={notesId}
          value={current.notes ?? ""}
          onChange={(e) => onChange({ ...current, notes: e.target.value })}
          placeholder="Findings, treatment plan…"
        />
      </div>
    </div>
  );
}
