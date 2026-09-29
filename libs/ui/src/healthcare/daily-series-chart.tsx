"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clinicalDate } from "../lib/format";
import { cn } from "../lib/utils";

/**
 * Categorical slots in fixed order (validated for colour-vision deficiency and contrast in light and dark; the dark
 * steps live in theme.css). Series keep their slot by position in the chart's own fixed list — never by rank.
 */
const SERIES_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)"] as const;

export interface DailySeriesDefinition {
  key: string;
  label: string;
}

export interface DailySeriesChartProps {
  title: string;
  /** One row per local day (YYYY-MM-DD), oldest first, with a number per series key. */
  data: ReadonlyArray<{ date: string } & Record<string, number | string>>;
  /** At most three series, in a fixed order (their colour follows their position here). */
  series: readonly DailySeriesDefinition[];
  /** How values read in the tooltip, table and axis (e.g. pesos from centavos). */
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
}

/** A local day (YYYY-MM-DD) read at noon UTC, so no time zone moves it to a neighbouring day. */
const dayOf = (date: string) => clinicalDate(`${date}T12:00:00Z`);

const shortDay = (date: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/**
 * Change over time for a few daily figures that share one unit (one y-axis — never mix units in one chart). A legend
 * names every series (identity is never colour alone), the tooltip reads all series for the hovered day, and the
 * same numbers are available as a table.
 */
export function DailySeriesChart({ title, data, series, formatValue = (v) => v.toLocaleString("en-PH"), height = 200, className }: DailySeriesChartProps) {
  const shown = series.slice(0, SERIES_COLORS.length);
  const totals = shown.map((s) => data.reduce((n, d) => n + (typeof d[s.key] === "number" ? (d[s.key] as number) : 0), 0));
  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-table font-semibold">{title}</span>
        {shown.length > 1 ? (
          <ul className="flex flex-wrap gap-3 text-meta text-muted-foreground" aria-label="Legend">
            {shown.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: SERIES_COLORS[i] }} />
                {s.label} <span className="tabular text-foreground">{formatValue(totals[i] ?? 0)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </figcaption>
      <div style={{ height }} role="img" aria-label={`${title}: ${shown.map((s, i) => `${s.label} ${formatValue(totals[i] ?? 0)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...data]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDay}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatValue(v)}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={64}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              // Text stays in text colour; the series colour belongs to the line.
              itemStyle={{ color: "var(--popover-foreground)" }}
              labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
              labelFormatter={(d) => dayOf(String(d))}
              // Same order as the legend.
              itemSorter={(item) => shown.findIndex((x) => x.key === item.dataKey)}
              formatter={(v, name) => [formatValue(Number(v)), shown.find((s) => s.key === name)?.label ?? String(name)]}
            />
            {shown.map((s, i) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={SERIES_COLORS[i]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-meta">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-1 max-h-64 overflow-auto">
          <table className="w-full text-table">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Day</th>
                {shown.map((s) => (
                  <th key={s.key} className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="py-1 pr-3">{dayOf(d.date)}</td>
                  {shown.map((s) => (
                    <td key={s.key} className="tabular py-1 pr-3 text-right">
                      {formatValue(typeof d[s.key] === "number" ? (d[s.key] as number) : 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
