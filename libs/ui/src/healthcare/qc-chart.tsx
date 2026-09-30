"use client";

import * as React from "react";
import { CheckCircle2Icon, CircleDashedIcon, TriangleAlertIcon, XCircleIcon } from "lucide-react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { clinicalDate, clinicalDateTime } from "../lib/format";
import { cn } from "../lib/utils";
import { type StatusSpec, StatusBadge } from "./status";

export type QcRunStatus = "accepted" | "warning" | "rejected";

export const qcStatusSpec: Record<QcRunStatus | "none", StatusSpec> = {
  accepted: { label: "QC accepted", icon: CheckCircle2Icon, variant: "success" },
  warning: { label: "QC warning", icon: TriangleAlertIcon, variant: "warning" },
  rejected: { label: "QC rejected", icon: XCircleIcon, variant: "danger" },
  none: { label: "No QC", icon: CircleDashedIcon, variant: "neutral" },
};

/** QC state as colour + icon + text. */
export function QcStatusBadge({ status, className }: { status: QcRunStatus | "none"; className?: string }) {
  return <StatusBadge spec={qcStatusSpec[status]} className={className} />;
}

export interface QcChartPoint {
  id: string;
  /** ISO date-time of the run. */
  runAt: string;
  /** Standard deviations from the target mean. */
  z: number;
  value: number;
  status: QcRunStatus;
  violations: string[];
  /** The control level (series), e.g. "Level 1 · lot A100". */
  series: string;
}

export interface QcLeveyJenningsChartProps {
  points: QcChartPoint[];
  name: string;
  unit?: string;
  height?: number;
  className?: string;
}

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

/**
 * Levey-Jennings chart of control results as z-scores (SD from each lot's
 * target), so several control levels share one chart. Lines at the mean and
 * ±1/2/3 SD. Point shape carries the evaluation — circle accepted, triangle
 * warning, cross rejected — so it never depends on colour alone.
 */
export function QcLeveyJenningsChart({ points, name, unit, height = 220, className }: QcLeveyJenningsChartProps) {
  const series = [...new Set(points.map((p) => p.series))];
  const extent = Math.max(4, ...points.map((p) => Math.ceil(Math.abs(p.z))));
  const data = points.map((p) => ({ ...p, t: new Date(p.runAt).getTime() }));
  const label = `${name} QC: ${points.map((p) => `${p.series} ${p.value}${unit ?? ""} (${p.z > 0 ? "+" : ""}${p.z} SD, ${p.status}) on ${p.runAt}`).join("; ")}`;

  return (
    <figure className={cn("flex flex-col gap-1", className)}>
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-table">
        <span className="font-semibold">{name}</span>
        {series.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1 text-meta text-muted-foreground">
            <span className="inline-block size-2.5 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden />
            {s}
          </span>
        ))}
      </figcaption>
      <div style={{ height }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => clinicalDate(new Date(t).toISOString())}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="z"
              type="number"
              domain={[-extent, extent]}
              ticks={[-3, -2, -1, 0, 1, 2, 3]}
              interval={0}
              tickFormatter={(v: number) => (v === 0 ? "x̄" : `${v > 0 ? "+" : ""}${v}s`)}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.5} />
            {[1, -1].map((y) => (
              <ReferenceLine key={y} y={y} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
            ))}
            {[2, -2].map((y) => (
              <ReferenceLine key={y} y={y} stroke="var(--warning)" strokeDasharray="4 3" />
            ))}
            {[3, -3].map((y) => (
              <ReferenceLine key={y} y={y} stroke="var(--danger)" />
            ))}
            <Tooltip
              cursor={false}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as (QcChartPoint & { t: number }) | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border bg-popover px-2 py-1 text-meta shadow-sm">
                    <p className="font-medium">{p.series}</p>
                    <p className="tabular">
                      {p.value} {unit} · {p.z > 0 ? "+" : ""}
                      {p.z} SD
                    </p>
                    <p>{qcStatusSpec[p.status].label + (p.violations.length ? ` (${p.violations.join(", ")})` : "")}</p>
                    <p className="text-muted-foreground">{clinicalDateTime(p.runAt)}</p>
                  </div>
                );
              }}
            />
            {series.map((s, i) => (
              <Scatter
                key={s}
                name={s}
                data={data.filter((p) => p.series === s)}
                line={{ stroke: SERIES_COLORS[i % SERIES_COLORS.length], strokeWidth: 1.5 }}
                isAnimationActive={false}
                shape={(props: { cx?: number; cy?: number; payload?: QcChartPoint }) => (
                  <QcDot
                    cx={props.cx ?? 0}
                    cy={props.cy ?? 0}
                    status={props.payload?.status ?? "accepted"}
                    color={SERIES_COLORS[i % SERIES_COLORS.length] ?? "var(--chart-1)"}
                  />
                )}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-meta text-muted-foreground">
        Mean (x̄) and ±1, ±2 (dashed) and ±3 SD lines of each lot&apos;s target. ● accepted · ▲ warning · ✕ rejected.
      </p>
    </figure>
  );
}

function QcDot({ cx, cy, status, color }: { cx: number; cy: number; status: QcRunStatus; color: string }) {
  if (status === "rejected") {
    return (
      <g stroke="var(--danger)" strokeWidth={2.5}>
        <line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
        <line x1={cx - 5} y1={cy + 5} x2={cx + 5} y2={cy - 5} />
      </g>
    );
  }
  if (status === "warning")
    return <path d={`M${cx},${cy - 6} L${cx + 6},${cy + 5} L${cx - 6},${cy + 5} Z`} fill="var(--warning)" stroke={color} strokeWidth={1} />;
  return <circle cx={cx} cy={cy} r={4} fill={color} />;
}
