"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HistoryIcon, PencilIcon, XIcon } from "lucide-react";
import { type DentalChart, findingsText, isPrimaryTooth, toothLabel, toothName, type ToothNotation } from "@healthcare/domain";
import { clinicalDateTime, type Dentition, Odontogram, ToothEditor } from "@healthcare/ui/healthcare";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  NativeSelect,
  Textarea,
  toast,
  ToggleGroup,
  ToggleGroupItem,
} from "@healthcare/ui/primitives";
import type { DentalChartTooth, DentalToothHistoryEntry } from "@/lib/api/types";
import { changedTeeth, draftProblems, examinationTeeth, HYGIENE, toChart } from "@/lib/dental-mapping";
import { loadToothHistory, recordExamination } from "../../actions";

/**
 * The odontogram. Viewing shows each tooth's current state and where it came from; charting an examination edits a
 * draft copy and sends only the teeth that changed — the API appends new states and never edits earlier ones.
 */
export function DentalChartPanel({
  patientId,
  patientAge,
  teeth,
  notation,
  encounterId,
  canChart,
}: {
  patientId: string;
  patientAge: number;
  teeth: DentalChartTooth[];
  notation: ToothNotation;
  /** The dental visit in progress to record into (none: charting is unavailable). */
  encounterId: string | null;
  canChart: boolean;
}) {
  const router = useRouter();
  const current = React.useMemo(() => toChart(teeth), [teeth]);
  const byTooth = React.useMemo(() => new Map(teeth.map((t) => [t.tooth, t])), [teeth]);
  const [dentition, setDentition] = React.useState<Dentition>(() => (patientAge < 13 || teeth.some((t) => isPrimaryTooth(t.tooth)) ? "mixed" : "permanent"));
  const [selected, setSelected] = React.useState<string | undefined>();
  const [charting, setCharting] = React.useState(false);
  const [draft, setDraft] = React.useState<DentalChart>(current);
  const [hygiene, setHygiene] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [pending, startTransition] = React.useTransition();
  const [history, setHistory] = React.useState<{ tooth: string; entries: DentalToothHistoryEntry[] } | null>(null);

  const changed = React.useMemo(() => (charting ? changedTeeth(current, draft) : new Set<string>()), [charting, current, draft]);
  const problems = draftProblems(draft, changed);

  const startCharting = () => {
    setDraft(current);
    setHygiene("");
    setNotes("");
    setHistory(null);
    setCharting(true);
    setSelected((s) => s ?? "16");
  };

  const submit = () =>
    startTransition(async () => {
      if (!encounterId) return;
      const result = await recordExamination(
        patientId,
        {
          encounterId,
          oralHygiene: (hygiene || undefined) as "good" | "fair" | "poor" | undefined,
          notes: notes.trim() || undefined,
          teeth: examinationTeeth(draft, changed),
        },
        key,
      );
      if (result.ok) {
        toast.success(changed.size ? `Examination recorded: ${changed.size} ${changed.size === 1 ? "tooth" : "teeth"} charted` : "Examination recorded");
        setCharting(false);
        setKey(crypto.randomUUID());
        router.refresh();
      } else {
        const details = result.details && typeof result.details === "object" ? Object.entries(result.details as Record<string, string[]>) : [];
        toast.error(details.length ? `${result.message}: ${details.map(([t, issues]) => `${t} — ${issues.join(", ")}`).join("; ")}` : result.message);
      }
    });

  const showHistory = (tooth: string) =>
    startTransition(async () => {
      const result = await loadToothHistory(patientId, tooth);
      if (result.ok) setHistory({ tooth, entries: result.data });
      else toast.error(result.message);
    });

  const selectedState = selected ? (charting ? draft[selected] : current[selected]) : undefined;
  const source = selected ? byTooth.get(selected) : undefined;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader className="flex-wrap">
          <CardTitle>{charting ? "Chart examination" : "Dental chart"}</CardTitle>
          <span className="text-meta text-muted-foreground">{notation.toUpperCase()} notation · current state of each charted tooth</span>
          <div className="ml-auto flex items-center gap-2">
            <ToggleGroup type="single" value={dentition} onValueChange={(v) => v && setDentition(v as Dentition)} aria-label="Dentition">
              <ToggleGroupItem value="permanent">Permanent</ToggleGroupItem>
              <ToggleGroupItem value="mixed">Mixed</ToggleGroupItem>
              <ToggleGroupItem value="primary">Primary</ToggleGroupItem>
            </ToggleGroup>
            {canChart && !charting ? (
              <Button
                size="sm"
                onClick={startCharting}
                disabled={!encounterId}
                title={encounterId ? undefined : "Start or open the patient's dental visit first"}
              >
                <PencilIcon /> Chart examination
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Odontogram
            chart={charting ? draft : current}
            notation={notation}
            dentition={dentition}
            selectedTooth={selected}
            onSelectTooth={setSelected}
            changedTeeth={changed}
          />
          {charting ? (
            <div className="flex flex-col gap-3 border-t pt-3">
              <p className="text-meta text-muted-foreground">
                Select a tooth and chart what you find; teeth you do not change keep their current state. A tooth charted with no findings is recorded as sound.{" "}
                {changed.size ? `${changed.size} ${changed.size === 1 ? "tooth" : "teeth"} changed.` : "No teeth changed yet."}
              </p>
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="exam-hygiene">Oral hygiene</Label>
                  <NativeSelect id="exam-hygiene" value={hygiene} onChange={(e) => setHygiene(e.target.value)}>
                    <option value="">Not assessed</option>
                    {Object.entries(HYGIENE).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="exam-notes">Examination notes</Label>
                  <Textarea
                    id="exam-notes"
                    value={notes}
                    maxLength={4000}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="History, soft tissues, occlusion, periodontal findings"
                  />
                </div>
              </div>
              {problems.length ? (
                <ul className="text-meta text-danger-foreground" aria-live="polite">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <div className="flex gap-2">
                <Button onClick={submit} disabled={pending || problems.length > 0 || (!changed.size && !notes.trim() && !hygiene)}>
                  Record examination
                </Button>
                <Button variant="outline" onClick={() => setCharting(false)} disabled={pending}>
                  <XIcon /> Discard
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardContent className="flex flex-col gap-3">
          {!selected ? (
            <p className="text-body text-muted-foreground">Select a tooth to see its state{canChart ? " or chart it" : ""}.</p>
          ) : charting ? (
            <ToothEditor tooth={selected} state={draft[selected]} notation={notation} onChange={(s) => setDraft((d) => ({ ...d, [selected]: s }))} />
          ) : (
            <>
              <div>
                <h3 className="text-section font-semibold">Tooth {toothLabel(selected, notation)}</h3>
                <p className="text-meta text-muted-foreground capitalize">
                  {toothName(selected)}
                  {notation !== "fdi" ? ` · FDI ${selected}` : ""}
                </p>
              </div>
              <p className="text-body">{selectedState ? findingsText(selected, selectedState.findings) : "Not charted"}</p>
              {selectedState?.note ? <p className="text-meta text-muted-foreground">{selectedState.note}</p> : null}
              {source ? (
                <p className="text-meta text-muted-foreground">
                  From {source.source.type === "examination" ? "an examination" : "a procedure"} · {clinicalDateTime(source.recordedAt)}
                  {source.recordedByName ? ` · ${source.recordedByName}` : ""}
                </p>
              ) : null}
              <Button size="sm" variant="outline" className="self-start" onClick={() => showHistory(selected)} disabled={pending}>
                <HistoryIcon /> History
              </Button>
              {history?.tooth === selected ? (
                history.entries.length ? (
                  <ol className="flex flex-col gap-2 border-t pt-2 text-meta" aria-label={`History of tooth ${toothLabel(selected, notation)}`}>
                    {history.entries.map((h, i) => (
                      <li key={i} className={h.source.status === "entered_in_error" ? "text-muted-foreground line-through" : undefined}>
                        <span className="font-medium">{clinicalDateTime(h.recordedAt)}</span> · {h.source.type === "examination" ? "Examination" : "Procedure"}
                        {h.source.status === "entered_in_error" ? (
                          <Badge variant="neutral" className="ml-1 no-underline">
                            Entered in error
                          </Badge>
                        ) : null}
                        <br />
                        {findingsText(h.tooth, h.findings)}
                        {h.recordedByName ? ` · ${h.recordedByName}` : ""}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-meta text-muted-foreground">Never charted.</p>
                )
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
