"use client";

import * as React from "react";
import {
  type DentalChart,
  findingsCode,
  findingsText,
  PERMANENT_ROWS,
  PRIMARY_ROWS,
  surfaceName,
  TOOTH_CONDITION_META,
  TOOTH_CONDITIONS,
  type ToothCode,
  type ToothCondition,
  type ToothFinding,
  toothLabel,
  toothName,
  type ToothNotation,
  type ToothState,
  type ToothSurface,
  toothSurfaces,
} from "@healthcare/domain";
import { Label } from "../primitives/label";
import { Textarea } from "../primitives/textarea";
import { ToggleGroup, ToggleGroupItem } from "../primitives/toggle-group";
import { cn } from "../lib/utils";

export type Dentition = "permanent" | "primary" | "mixed";

// ---- Tooth glyph --------------------------------------------------------------

type Side = "top" | "bottom" | "left" | "right" | "center";

/** Which drawn side of the glyph each surface occupies (viewer's perspective). */
function sideOf(tooth: ToothCode, surface: ToothSurface): Side {
  const q = Number(tooth[0]) > 4 ? Number(tooth[0]) - 4 : Number(tooth[0]);
  const upper = q === 1 || q === 2;
  const viewerLeft = q === 1 || q === 4;
  switch (surface) {
    case "B":
      return upper ? "top" : "bottom";
    case "L":
      return upper ? "bottom" : "top";
    case "M":
      return viewerLeft ? "right" : "left";
    case "D":
      return viewerLeft ? "left" : "right";
    default:
      return "center";
  }
}

const POLY = {
  top: "0,0 40,0 28,12 12,12",
  bottom: "0,40 12,28 28,28 40,40",
  left: "0,0 12,12 12,28 0,40",
  right: "40,0 40,40 28,28 28,12",
} as const;

/** Surface fills, most significant first (caries shows over an adjacent restoration). */
const SURFACE_FILL: Array<[ToothCondition, string]> = [
  ["caries", "var(--danger)"],
  ["restoration", "var(--info)"],
  ["sealant", "var(--success)"],
  ["fracture", "var(--warning)"],
];

function ToothGlyph({ tooth, findings }: { tooth: ToothCode; findings: readonly ToothFinding[] }) {
  const has = (c: ToothCondition) => findings.some((f) => f.condition === c);
  const fills = new Map<Side, string>();
  for (const [condition, colour] of [...SURFACE_FILL].reverse()) {
    const finding = findings.find((f) => f.condition === condition);
    for (const surface of finding?.surfaces ?? []) fills.set(sideOf(tooth, surface), colour);
  }
  const absent = has("missing") || has("pontic") || has("unerupted");
  const base = "var(--card)";
  const stroke = "var(--muted-foreground)";
  return (
    <svg viewBox="-3 -3 46 46" className="size-full" aria-hidden>
      <g
        opacity={absent || has("implant") ? 0.35 : 1}
        stroke={stroke}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeDasharray={has("impacted") || has("unerupted") ? "3 2" : undefined}
      >
        {(Object.keys(POLY) as (keyof typeof POLY)[]).map((side) => (
          <polygon key={side} points={POLY[side]} fill={fills.get(side) ?? base} />
        ))}
        <rect x={12} y={12} width={16} height={16} fill={fills.get("center") ?? base} />
      </g>
      {has("fracture") && !findings.find((f) => f.condition === "fracture")?.surfaces.length ? (
        <polyline points="8,4 18,16 12,22 26,36" fill="none" stroke="var(--warning)" strokeWidth={3} strokeLinecap="round" />
      ) : null}
      {has("crown") ? <rect x={-2} y={-2} width={44} height={44} rx={4} fill="none" stroke="var(--warning)" strokeWidth={3} /> : null}
      {has("root_canal") ? <line x1={20} y1={2} x2={20} y2={38} stroke="var(--teal)" strokeWidth={4} strokeLinecap="round" /> : null}
      {has("implant") ? (
        <g stroke="var(--primary)" strokeWidth={3} strokeLinecap="round">
          <line x1={20} y1={4} x2={20} y2={36} />
          <line x1={13} y1={12} x2={27} y2={12} />
          <line x1={13} y1={20} x2={27} y2={20} />
          <line x1={13} y1={28} x2={27} y2={28} />
        </g>
      ) : null}
      {has("pontic") ? <rect x={-2} y={16} width={44} height={8} rx={2} fill="var(--muted-foreground)" /> : null}
      {has("missing") ? (
        <g stroke={stroke} strokeWidth={3} strokeLinecap="round">
          <line x1={2} y1={2} x2={38} y2={38} />
          <line x1={38} y1={2} x2={2} y2={38} />
        </g>
      ) : null}
      {has("watch") ? <circle cx={36} cy={4} r={4} fill="var(--warning)" stroke="var(--card)" strokeWidth={1} /> : null}
    </svg>
  );
}

// ---- Chart --------------------------------------------------------------------

export interface OdontogramProps {
  chart: DentalChart;
  notation?: ToothNotation;
  dentition?: Dentition;
  selectedTooth?: ToothCode;
  onSelectTooth?: (tooth: ToothCode) => void;
  /** Teeth changed in the chart being recorded (marked with a dot and in the label). */
  changedTeeth?: ReadonlySet<ToothCode>;
  className?: string;
}

/**
 * Dental chart in the viewer's perspective. Each tooth shows its number in the facility's notation, a glyph and the
 * chart code of its findings (never colour alone); teeth never charted are plain.
 */
export function Odontogram({ chart, notation = "fdi", dentition = "permanent", selectedTooth, onSelectTooth, changedTeeth, className }: OdontogramProps) {
  const renderTooth = (tooth: ToothCode, lower: boolean) => {
    const state = chart[tooth];
    const findings = state?.findings ?? [];
    const code = findingsCode(findings);
    const selected = selectedTooth === tooth;
    const changed = changedTeeth?.has(tooth) ?? false;
    const label = `Tooth ${toothLabel(tooth, notation)}, ${toothName(tooth)}: ${state ? findingsText(tooth, findings) : "not charted"}${changed ? " (changed)" : ""}`;
    return (
      <button
        key={tooth}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={onSelectTooth ? selected : undefined}
        disabled={!onSelectTooth}
        onClick={() => onSelectTooth?.(tooth)}
        className={cn(
          "relative flex w-10 flex-col items-center gap-0.5 rounded-md p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-accent disabled:cursor-default",
          lower && "flex-col-reverse",
          selected && "bg-primary-subtle ring-2 ring-primary",
        )}
      >
        <span className={cn("tabular font-mono text-meta", selected ? "font-bold text-primary" : "text-muted-foreground")}>{toothLabel(tooth, notation)}</span>
        <span className="size-9">
          <ToothGlyph tooth={tooth} findings={findings} />
        </span>
        <span className="h-3.5 max-w-10 truncate font-mono text-[10px] leading-none font-semibold text-foreground">{code}</span>
        {changed ? <span className="absolute top-0 right-0 size-2 rounded-full bg-primary" aria-hidden /> : null}
      </button>
    );
  };

  const row = ([right, left]: readonly (readonly string[])[], lower: boolean, key: string) => (
    <div key={key} className="flex items-stretch justify-center">
      <div className="flex gap-0.5 border-r-2 border-foreground/30 pr-1.5">{right!.map((t) => renderTooth(t, lower))}</div>
      <div className="flex gap-0.5 pl-1.5">{left!.map((t) => renderTooth(t, lower))}</div>
    </div>
  );

  const showPermanent = dentition !== "primary";
  const showPrimary = dentition !== "permanent";
  return (
    <div className={cn("flex flex-col gap-2 overflow-x-auto", className)}>
      <div role="group" aria-label={`Dental chart, ${notation.toUpperCase()} notation, viewer's perspective`} className="mx-auto flex min-w-max flex-col">
        <div className="mb-1 flex justify-between px-1 text-meta font-semibold tracking-wide text-muted-foreground uppercase">
          <span>Patient right</span>
          <span>Upper</span>
          <span>Patient left</span>
        </div>
        {showPermanent ? row(PERMANENT_ROWS.upper, false, "pu") : null}
        {showPrimary ? row(PRIMARY_ROWS.upper, false, "du") : null}
        <div className="my-1 border-t-2 border-foreground/30" />
        {showPrimary ? row(PRIMARY_ROWS.lower, true, "dl") : null}
        {showPermanent ? row(PERMANENT_ROWS.lower, true, "pl") : null}
        <div className="mt-1 text-center text-meta font-semibold tracking-wide text-muted-foreground uppercase">Lower</div>
      </div>
      <OdontogramLegend />
    </div>
  );
}

export function OdontogramLegend({ className }: { className?: string }) {
  const sample = (condition: ToothCondition) => (
    <span className="inline-block size-5">
      <ToothGlyph tooth="16" findings={[{ condition, surfaces: TOOTH_CONDITION_META[condition].site === "surfaces" ? ["O"] : [] }]} />
    </span>
  );
  return (
    <ul className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1 text-meta text-muted-foreground", className)} aria-label="Legend">
      {TOOTH_CONDITIONS.map((c) => (
        <li key={c.value} className="flex items-center gap-1">
          {sample(c.value)}
          <span className="font-mono font-semibold text-foreground">{c.code}</span> {c.label}
        </li>
      ))}
      <li>Surfaces: M D O/I B L</li>
    </ul>
  );
}

// ---- Tooth editor ---------------------------------------------------------------

export interface ToothEditorProps {
  tooth: ToothCode;
  state?: ToothState;
  notation?: ToothNotation;
  onChange: (state: ToothState) => void;
  className?: string;
}

/**
 * Charts one tooth: its conditions (several may apply; missing, pontic, impacted and unerupted stand alone) and the
 * surfaces each surface condition affects. No conditions means sound. The API validates the result.
 */
export function ToothEditor({ tooth, state, notation = "fdi", onChange, className }: ToothEditorProps) {
  const current: ToothState = state ?? { tooth, findings: [] };
  const selected = current.findings.map((f) => f.condition);
  const notesId = React.useId();
  const setConditions = (next: ToothCondition[]) => {
    const added = next.find((c) => !selected.includes(c));
    let conditions = next;
    if (added && TOOTH_CONDITION_META[added].exclusive) conditions = [added];
    else if (added) conditions = next.filter((c) => !TOOTH_CONDITION_META[c].exclusive);
    onChange({
      ...current,
      findings: conditions.map((c) => current.findings.find((f) => f.condition === c) ?? { condition: c, surfaces: [] }),
    });
  };
  const setSurfaces = (condition: ToothCondition, surfaces: ToothSurface[]) =>
    onChange({ ...current, findings: current.findings.map((f) => (f.condition === condition ? { ...f, surfaces } : f)) });
  const surfaces = toothSurfaces(tooth);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div>
        <h3 className="text-section font-semibold">Tooth {toothLabel(tooth, notation)}</h3>
        <p className="text-meta text-muted-foreground capitalize">
          {toothName(tooth)}
          {notation !== "fdi" ? ` · FDI ${tooth}` : ""}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label asChild>
          <span>Findings {selected.length ? null : <span className="font-normal text-muted-foreground">— none: sound</span>}</span>
        </Label>
        <ToggleGroup type="multiple" value={selected} onValueChange={(v) => setConditions(v as ToothCondition[])} aria-label="Findings" className="flex-wrap">
          {TOOTH_CONDITIONS.map((c) => (
            <ToggleGroupItem key={c.value} value={c.value}>
              <span className="font-mono text-meta">{c.code}</span>
              {c.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {current.findings
        .filter((f) => TOOTH_CONDITION_META[f.condition].site !== "tooth")
        .map((f) => (
          <div key={f.condition} className="flex flex-col gap-1.5">
            <Label asChild>
              <span>
                {TOOTH_CONDITION_META[f.condition].label} — surfaces
                {TOOTH_CONDITION_META[f.condition].site === "optional" ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
              </span>
            </Label>
            <ToggleGroup
              type="multiple"
              value={f.surfaces}
              onValueChange={(v) => setSurfaces(f.condition, v as ToothSurface[])}
              aria-label={`${TOOTH_CONDITION_META[f.condition].label} surfaces`}
            >
              {surfaces.map((s) => (
                <ToggleGroupItem key={s} value={s} title={surfaceName(tooth, s)}>
                  <span className="font-mono">{s}</span>
                  <span className="sr-only"> {surfaceName(tooth, s)}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ))}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={notesId}>Note</Label>
        <Textarea
          id={notesId}
          value={current.note ?? ""}
          maxLength={500}
          onChange={(e) => onChange({ ...current, note: e.target.value })}
          placeholder="Observation for this tooth"
        />
      </div>
    </div>
  );
}
