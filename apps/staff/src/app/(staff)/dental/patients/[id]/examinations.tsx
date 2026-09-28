"use client";

import { findingsText, toothLabel, type ToothNotation } from "@healthcare/domain";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@healthcare/ui/primitives";
import type { DentalExamination } from "@/lib/api/types";
import { HYGIENE } from "@/lib/dental-mapping";
import { markExaminationEnteredInError } from "../../actions";
import { EnteredInError } from "./entered-in-error";

/** Recorded examinations, newest first, with the teeth each one charted. Corrected ones stay, struck through. */
export function Examinations({
  patientId,
  examinations,
  notation,
  canCorrect,
}: {
  patientId: string;
  examinations: DentalExamination[];
  notation: ToothNotation;
  canCorrect: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Examinations</CardTitle>
      </CardHeader>
      <CardContent>
        {examinations.length === 0 ? <p className="text-body text-muted-foreground">No dental examinations recorded.</p> : null}
        <ol className="flex flex-col divide-y" aria-label="Examinations">
          {examinations.map((e) => {
            const error = e.status === "entered_in_error";
            return (
              <li key={e.id} className="flex flex-col gap-1 py-2 text-table">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{clinicalDateTime(e.recordedAt)}</span>
                  <span className="text-muted-foreground">{e.practitionerName}</span>
                  {e.oralHygiene ? <Badge variant="neutral">Oral hygiene: {HYGIENE[e.oralHygiene]}</Badge> : null}
                  {error ? (
                    <Badge variant="neutral" title={e.enteredInErrorReason ?? undefined} className="ml-auto">
                      Entered in error
                    </Badge>
                  ) : canCorrect ? (
                    <span className="ml-auto">
                      <EnteredInError what="Examination" onConfirm={(reason) => markExaminationEnteredInError(patientId, e.id, reason)} />
                    </span>
                  ) : null}
                </div>
                <div className={error ? "text-muted-foreground line-through" : undefined}>
                  {e.notes ? <p className="whitespace-pre-line">{e.notes}</p> : null}
                  {e.teeth.length ? (
                    <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-meta">
                      {e.teeth.map((t) => (
                        <li key={t.tooth}>
                          <span className="font-mono font-semibold">{toothLabel(t.tooth, notation)}</span> {findingsText(t.tooth, t.findings)}
                          {t.note ? <span className="text-muted-foreground"> — {t.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-meta text-muted-foreground">No teeth charted.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
