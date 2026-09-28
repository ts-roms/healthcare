"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PERIO_SITES, type PerioSite, perioHasFurcation, perioSiteName, perioTeeth, type ToothNotation, toothLabel, toothName } from "@healthcare/domain";
import { clinicalDateTime } from "@healthcare/ui/healthcare";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { DentalChartTooth, DentalPerioChartDetail, DentalPerioChartSummaryItem, DentalPerioSummary, DentalPerioTooth } from "@/lib/api/types";
import { deepPocket, emptyPerioRow, type PerioRow, perioPayload } from "@/lib/perio-form";
import { loadPerioChart, markPerioChartEnteredInError, recordPerioChart } from "../../actions";
import { EnteredInError } from "./entered-in-error";

const BUCCAL: PerioSite[] = ["MB", "B", "DB"];
const LINGUAL: PerioSite[] = ["ML", "L", "DL"];

function summaryText(s: DentalPerioSummary): string {
  return [
    `${s.teeth} teeth`,
    s.bleedingPercent !== null ? `bleeding ${s.bleedingPercent}%` : null,
    s.plaquePercent !== null ? `plaque ${s.plaquePercent}%` : null,
    `${s.sitesDepth4Plus} sites ≥ 4 mm`,
    `${s.sitesDepth6Plus} ≥ 6 mm`,
    s.maxProbingDepth !== null ? `deepest ${s.maxProbingDepth} mm` : null,
    s.meanAttachmentLevel !== null ? `mean attachment level ${s.meanAttachmentLevel} mm` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Periodontal charts: probing depths, gingival margin, bleeding, plaque and suppuration at six sites per tooth, with
 * mobility and furcation. Measurements and derived figures only — the dentist makes the periodontal diagnosis.
 */
export function Periodontal({
  patientId,
  charts,
  chart,
  notation,
  encounterId,
  canChart,
  canCorrect,
}: {
  patientId: string;
  charts: DentalPerioChartSummaryItem[];
  chart: DentalChartTooth[];
  notation: ToothNotation;
  encounterId: string | null;
  canChart: boolean;
  canCorrect: boolean;
}) {
  const [open, setOpen] = React.useState<DentalPerioChartDetail | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [loading, startLoading] = React.useTransition();

  const view = (chartId: string) =>
    startLoading(async () => {
      if (open?.id === chartId) return setOpen(null);
      const result = await loadPerioChart(chartId);
      if (result.ok) setOpen(result.data);
      else toast.error(result.message);
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Periodontal charts</CardTitle>
        {canChart && encounterId && !recording ? (
          <Button size="sm" variant="outline" onClick={() => setRecording(true)}>
            Record periodontal chart
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {recording && encounterId ? (
          <PerioForm patientId={patientId} encounterId={encounterId} chart={chart} notation={notation} onClose={() => setRecording(false)} />
        ) : null}
        {charts.length === 0 && !recording ? <p className="text-body text-muted-foreground">No periodontal charts recorded.</p> : null}
        <ol className="flex flex-col divide-y" aria-label="Periodontal charts">
          {charts.map((c) => {
            const error = c.status === "entered_in_error";
            return (
              <li key={c.id} className="flex flex-col gap-1 py-2 text-table">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{clinicalDateTime(c.recordedAt)}</span>
                  <span className="text-muted-foreground">{c.practitionerName}</span>
                  <Button size="xs" variant="ghost" disabled={loading} onClick={() => view(c.id)}>
                    {open?.id === c.id ? "Hide" : "View"}
                  </Button>
                  {error ? (
                    <Badge variant="neutral" title={c.enteredInErrorReason ?? undefined} className="ml-auto">
                      Entered in error
                    </Badge>
                  ) : canCorrect ? (
                    <span className="ml-auto">
                      <EnteredInError what="Periodontal chart" onConfirm={(reason) => markPerioChartEnteredInError(patientId, c.id, reason)} />
                    </span>
                  ) : null}
                </div>
                <p className={`text-meta ${error ? "text-muted-foreground line-through" : "text-muted-foreground"}`}>{summaryText(c.summary)}</p>
                {c.notes ? <p className={`text-meta whitespace-pre-line ${error ? "line-through" : ""}`}>{c.notes}</p> : null}
                {open?.id === c.id ? <PerioDetail detail={open} notation={notation} /> : null}
              </li>
            );
          })}
        </ol>
        <p className="text-meta text-muted-foreground">
          Depths and gingival margin in mm (margin: + recession, − above the CEJ); <span className="font-semibold">bold</span> = 4 mm or deeper; “b” = bleeding
          on probing, “p” = plaque, “s” = suppuration. Summaries compare charts; they are not a periodontal classification.
        </p>
      </CardContent>
    </Card>
  );
}

function siteCell(t: DentalPerioTooth, site: PerioSite) {
  const s = t.sites.find((x) => x.site === site);
  if (!s) return <span className="text-muted-foreground">·</span>;
  const marks = `${s.bleeding ? "b" : ""}${s.plaque ? "p" : ""}${s.suppuration ? "s" : ""}`;
  return (
    <span className={deepPocket(s.probingDepth) ? "font-semibold" : undefined} title={`${perioSiteName(t.tooth, site)}: ${s.probingDepth ?? "—"} mm`}>
      {s.probingDepth ?? "—"}
      {marks ? <sup>{marks}</sup> : null}
    </span>
  );
}

function PerioDetail({ detail, notation }: { detail: DentalPerioChartDetail; notation: ToothNotation }) {
  const margins = (t: DentalPerioTooth, sites: PerioSite[]) => sites.map((site) => t.sites.find((s) => s.site === site)?.gingivalMargin ?? "·").join(" ");
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-2">
      <div className="overflow-x-auto">
        <table className="tabular w-full text-table">
          <thead>
            <tr className="text-left text-meta text-muted-foreground">
              <th className="pr-2">Tooth</th>
              <th className="px-1">Buccal MB · B · DB</th>
              <th className="px-1">Lingual ML · L · DL</th>
              <th className="px-1">Margin buccal / lingual</th>
              <th className="px-1">Mobility</th>
              <th className="px-1">Furcation</th>
            </tr>
          </thead>
          <tbody>
            {detail.teeth.map((t) => (
              <tr key={t.tooth} className="border-t">
                <td className="pr-2 font-mono font-semibold" title={toothName(t.tooth)}>
                  {toothLabel(t.tooth, notation)}
                </td>
                {[BUCCAL, LINGUAL].map((sites, i) => (
                  <td key={i} className="px-1">
                    <span className="flex gap-2">
                      {sites.map((site) => (
                        <span key={site} className="w-8">
                          {siteCell(t, site)}
                        </span>
                      ))}
                    </span>
                  </td>
                ))}
                <td className="px-1 text-muted-foreground">
                  {margins(t, BUCCAL)} / {margins(t, LINGUAL)}
                </td>
                <td className="px-1">{t.mobility ?? "—"}</td>
                <td className="px-1">{t.furcation ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.previous ? (
        <div className="text-meta">
          <p className="font-medium">Since the previous chart ({clinicalDateTime(detail.previous.recordedAt)})</p>
          <p className="text-muted-foreground">Then: {summaryText(detail.previous.summary)}</p>
          {detail.previous.changes.deeper.length || detail.previous.changes.shallower.length ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {detail.previous.changes.deeper.length ? (
                <li>
                  <span className="font-semibold">Deeper by 2 mm or more:</span>{" "}
                  {detail.previous.changes.deeper.map((c) => `${toothLabel(c.tooth, notation)} ${c.site} ${c.before}→${c.after}`).join(", ")}
                </li>
              ) : null}
              {detail.previous.changes.shallower.length ? (
                <li>
                  <span className="font-semibold">Shallower by 2 mm or more:</span>{" "}
                  {detail.previous.changes.shallower.map((c) => `${toothLabel(c.tooth, notation)} ${c.site} ${c.before}→${c.after}`).join(", ")}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-muted-foreground">No site changed by 2 mm or more.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Row-per-tooth entry: probing depths first (the usual pass), then margins, bleeding/plaque/suppuration, mobility, furcation. */
function PerioForm({
  patientId,
  encounterId,
  chart,
  notation,
  onClose,
}: {
  patientId: string;
  encounterId: string;
  chart: DentalChartTooth[];
  notation: ToothNotation;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<PerioRow[]>(() => perioTeeth(chart).map(emptyPerioRow));
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [key] = React.useState(() => crypto.randomUUID());
  const [pending, start] = React.useTransition();

  const update = (tooth: string, change: (row: PerioRow) => PerioRow) => setRows((all) => all.map((r) => (r.tooth === tooth ? change(r) : r)));
  const save = () => {
    const { teeth, errors: problems } = perioPayload(rows);
    setErrors(problems);
    if (Object.keys(problems).length) return void toast.error("Check the highlighted teeth.");
    if (!teeth.length) return void toast.error("Enter the measurements of at least one tooth.");
    start(async () => {
      const result = await recordPerioChart(patientId, { encounterId, notes: notes || undefined, teeth }, key);
      if (result.ok) {
        toast.success("Periodontal chart recorded");
        onClose();
        router.refresh();
      } else toast.error(result.message);
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <p className="text-meta text-muted-foreground">
        Teeth left empty are not recorded as examined. Missing or unerupted teeth on the odontogram are not listed.
      </p>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-table">
          <thead className="sticky top-0 bg-card">
            <tr className="text-left text-meta text-muted-foreground">
              <th className="pr-2">Tooth</th>
              <th>Depth (mm) {PERIO_SITES.join(" · ")}</th>
              <th>Margin (mm)</th>
              <th>Bleeding · plaque · suppuration</th>
              <th>Mob.</th>
              <th>Furc.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tooth} className={`border-t align-top ${errors[row.tooth] ? "bg-danger-subtle" : ""}`}>
                <td className="py-1 pr-2 font-mono font-semibold" title={toothName(row.tooth)}>
                  {toothLabel(row.tooth, notation)}
                  {errors[row.tooth] ? <span className="block font-sans text-meta font-normal text-danger-foreground">{errors[row.tooth]}</span> : null}
                </td>
                {(["depth", "margin"] as const).map((field) => (
                  <td key={field} className="py-1">
                    <span className="flex gap-0.5">
                      {PERIO_SITES.map((site) => (
                        <Input
                          key={site}
                          aria-label={`${toothLabel(row.tooth, notation)} ${perioSiteName(row.tooth, site)} ${field === "depth" ? "probing depth" : "gingival margin"}`}
                          inputMode="numeric"
                          className="h-7 w-9 px-1 text-center"
                          value={row[field][site]}
                          onChange={(e) => update(row.tooth, (r) => ({ ...r, [field]: { ...r[field], [site]: e.target.value } }))}
                        />
                      ))}
                    </span>
                  </td>
                ))}
                <td className="py-1">
                  <span className="flex flex-col gap-0.5">
                    {(["bleeding", "plaque", "suppuration"] as const).map((flag) => (
                      <span key={flag} className="flex items-center gap-1">
                        {PERIO_SITES.map((site) => (
                          <Checkbox
                            key={site}
                            aria-label={`${toothLabel(row.tooth, notation)} ${perioSiteName(row.tooth, site)} ${flag}`}
                            checked={row[flag][site]}
                            onCheckedChange={(checked) => update(row.tooth, (r) => ({ ...r, [flag]: { ...r[flag], [site]: checked === true } }))}
                          />
                        ))}
                        <span className="text-meta text-muted-foreground">{flag[0]}</span>
                      </span>
                    ))}
                  </span>
                </td>
                <td className="py-1">
                  <Input
                    aria-label={`${toothLabel(row.tooth, notation)} mobility (0–3)`}
                    inputMode="numeric"
                    className="h-7 w-9 px-1 text-center"
                    value={row.mobility}
                    onChange={(e) => update(row.tooth, (r) => ({ ...r, mobility: e.target.value }))}
                  />
                </td>
                <td className="py-1">
                  {perioHasFurcation(row.tooth) ? (
                    <Input
                      aria-label={`${toothLabel(row.tooth, notation)} furcation (0–3)`}
                      inputMode="numeric"
                      className="h-7 w-9 px-1 text-center"
                      value={row.furcation}
                      onChange={(e) => update(row.tooth, (r) => ({ ...r, furcation: e.target.value }))}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Label htmlFor="perio-notes">Notes</Label>
      <Textarea id="perio-notes" rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          Record chart
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
