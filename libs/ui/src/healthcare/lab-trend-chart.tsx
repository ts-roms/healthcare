"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LabTrendPoint } from "@healthcare/domain";
import { clinicalDate, clinicalMonth } from "../lib/format";
import { cn } from "../lib/utils";

export interface LabTrendChartProps {
  data: LabTrendPoint[];
  name: string;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  height?: number;
  className?: string;
}

/**
 * Single-analyte trend. The shaded band is the reference range, so
 * "in range / out of range" reads without relying on point colour.
 */
export function LabTrendChart({ data, name, unit, referenceLow, referenceHigh, height = 180, className }: LabTrendChartProps) {
  const values = data.map((d) => d.value);
  const lo = Math.min(...values, referenceLow ?? Infinity);
  const hi = Math.max(...values, referenceHigh ?? -Infinity);
  const pad = (hi - lo) * 0.2 || 1;
  const domain: [number, number] = [Math.max(0, +(lo - pad).toFixed(1)), +(hi + pad).toFixed(1)];
  const last = data.at(-1);

  return (
    <figure className={cn("flex flex-col gap-1", className)}>
      <figcaption className="flex items-baseline gap-2 text-table">
        <span className="font-semibold">{name}</span>
        {last ? (
          <span className="tabular text-muted-foreground">
            latest <span className="font-semibold text-foreground">{last.value}</span> {unit} · {clinicalDate(last.date)}
          </span>
        ) : null}
      </figcaption>
      <div style={{ height }} role="img" aria-label={`${name} trend: ${data.map((d) => `${d.value}${unit ?? ""} on ${d.date}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            {referenceLow !== undefined || referenceHigh !== undefined ? (
              <ReferenceArea y1={referenceLow ?? domain[0]} y2={referenceHigh ?? domain[1]} fill="var(--success)" fillOpacity={0.08} ifOverflow="hidden" />
            ) : null}
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => clinicalMonth(d)}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis domain={domain} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              labelFormatter={(d) => clinicalDate(String(d))}
              formatter={(v) => [`${v} ${unit ?? ""}`, name]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-1)" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {referenceLow !== undefined || referenceHigh !== undefined ? (
        <p className="text-meta text-muted-foreground">
          Shaded band: reference range {referenceLow ?? "—"}–{referenceHigh ?? "—"} {unit}
        </p>
      ) : null}
    </figure>
  );
}
