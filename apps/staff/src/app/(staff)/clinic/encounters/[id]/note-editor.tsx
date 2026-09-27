"use client";

import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Label, Textarea } from "@healthcare/ui/primitives";
import { NOTE_FIELDS, type NoteForm } from "@/lib/encounter-mapping";

/** SOAP note: one scrolling document, editable or read-only. */
export function NoteEditor({ value, onChange, readOnly }: { value: NoteForm; onChange: (value: NoteForm) => void; readOnly: boolean }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-4">
      {NOTE_FIELDS.map((f) => (
        <section key={f.key} className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-${f.key}`} className="text-meta font-semibold tracking-wide text-muted-foreground uppercase">
            {f.label}
          </Label>
          {readOnly ? (
            <p id={`${id}-${f.key}`} className="text-body whitespace-pre-wrap">
              {value[f.key] || <span className="text-muted-foreground">—</span>}
            </p>
          ) : (
            <Textarea
              id={`${id}-${f.key}`}
              value={value[f.key]}
              maxLength={20_000}
              placeholder={f.placeholder}
              className={f.key === "subjective" || f.key === "objective" ? "min-h-28" : "min-h-20"}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Shown when a save was refused because someone saved a newer revision. The
 * clinician's text is kept; they compare and choose. Nothing is overwritten silently.
 */
export function NoteConflict({ latest, onUseLatest, onKeepMine }: { latest: NoteForm; onUseLatest: () => void; onKeepMine: () => void }) {
  return (
    <section role="alert" className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning-subtle p-3 text-warning-foreground">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangleIcon className="size-4" aria-hidden /> The note was changed elsewhere
      </p>
      <p className="text-table">Your unsaved text is still in the editor. The latest saved version is:</p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 rounded border bg-card p-2 text-table text-foreground">
        {NOTE_FIELDS.map((f) => (
          <React.Fragment key={f.key}>
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="whitespace-pre-wrap">{latest[f.key] || "—"}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onUseLatest}>
          Discard my changes, use the latest
        </Button>
        <Button size="sm" onClick={onKeepMine}>
          Keep my text (saves as a newer revision)
        </Button>
      </div>
    </section>
  );
}
