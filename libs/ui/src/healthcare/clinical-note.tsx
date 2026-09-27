"use client";

import * as React from "react";
import type { ClinicalNoteSections } from "@healthcare/domain";
import { Textarea } from "../primitives/textarea";
import { cn } from "../lib/utils";

const SECTIONS: { key: keyof ClinicalNoteSections; label: string; placeholder: string }[] = [
  { key: "chiefComplaint", label: "Chief complaint", placeholder: "Reason for visit in the patient's words" },
  { key: "hpi", label: "History of present illness", placeholder: "Onset, location, duration, character, aggravating/relieving factors…" },
  { key: "examination", label: "Examination", placeholder: "General survey, systems examined…" },
  { key: "diagnosis", label: "Assessment / Diagnosis", placeholder: "Clinical impression" },
  { key: "plan", label: "Plan", placeholder: "Investigations, treatment, counselling, follow-up" },
];

export interface ClinicalNoteProps {
  value: Partial<ClinicalNoteSections>;
  onChange?: (value: Partial<ClinicalNoteSections>) => void;
  readOnly?: boolean;
  /** Content injected under a section, e.g. a DiagnosisSelector under "diagnosis". */
  slots?: Partial<Record<keyof ClinicalNoteSections, React.ReactNode>>;
  className?: string;
}

/**
 * Structured encounter note. One scrolling document with anchored sections
 * rather than a wizard — clinicians jump between sections constantly.
 */
export function ClinicalNote({ value, onChange, readOnly, slots, className }: ClinicalNoteProps) {
  const id = React.useId();
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {SECTIONS.map((s) => (
        <section key={s.key} className="flex flex-col gap-1.5" aria-labelledby={`${id}-${s.key}`}>
          <label id={`${id}-${s.key}`} htmlFor={`${id}-${s.key}-input`} className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
            {s.label}
          </label>
          {readOnly ? (
            <p className="text-body whitespace-pre-wrap">{value[s.key] || <span className="text-muted-foreground">—</span>}</p>
          ) : (
            <Textarea
              id={`${id}-${s.key}-input`}
              value={value[s.key] ?? ""}
              placeholder={s.placeholder}
              onChange={(e) => onChange?.({ ...value, [s.key]: e.target.value })}
              className={s.key === "hpi" || s.key === "examination" ? "min-h-24" : undefined}
            />
          )}
          {slots?.[s.key]}
        </section>
      ))}
    </div>
  );
}
