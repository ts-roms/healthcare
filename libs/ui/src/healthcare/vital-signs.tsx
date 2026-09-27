import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, HeartPulseIcon } from "lucide-react";
import type { VitalSigns as VitalSignsData } from "@healthcare/domain";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../primitives/card";
import { clinicalDateTime } from "../lib/format";
import { cn } from "../lib/utils";

type Interp = "normal" | "low" | "high";

interface VitalItem {
  key: string;
  label: string;
  value: string;
  unit: string;
  interp: Interp;
}

/** Adult reference bands. Real deployments should source these from configuration. */
function interpret(v: VitalSignsData): VitalItem[] {
  const band = (n: number | undefined, lo: number, hi: number): Interp => (n === undefined ? "normal" : n < lo ? "low" : n > hi ? "high" : "normal");
  const items: VitalItem[] = [];
  if (v.systolic !== undefined && v.diastolic !== undefined) {
    const s = band(v.systolic, 90, 139);
    const d = band(v.diastolic, 60, 89);
    items.push({ key: "bp", label: "BP", value: `${v.systolic}/${v.diastolic}`, unit: "mmHg", interp: s !== "normal" ? s : d });
  }
  if (v.heartRate !== undefined) items.push({ key: "hr", label: "HR", value: String(v.heartRate), unit: "bpm", interp: band(v.heartRate, 60, 100) });
  if (v.respiratoryRate !== undefined)
    items.push({ key: "rr", label: "RR", value: String(v.respiratoryRate), unit: "/min", interp: band(v.respiratoryRate, 12, 20) });
  if (v.temperatureC !== undefined)
    items.push({ key: "temp", label: "Temp", value: v.temperatureC.toFixed(1), unit: "°C", interp: band(v.temperatureC, 36, 37.5) });
  if (v.spo2 !== undefined) items.push({ key: "spo2", label: "SpO₂", value: String(v.spo2), unit: "%", interp: band(v.spo2, 95, 100) });
  if (v.weightKg !== undefined) items.push({ key: "wt", label: "Wt", value: v.weightKg.toFixed(1), unit: "kg", interp: "normal" });
  if (v.weightKg !== undefined && v.heightCm) {
    const bmi = v.weightKg / (v.heightCm / 100) ** 2;
    items.push({ key: "bmi", label: "BMI", value: bmi.toFixed(1), unit: "kg/m²", interp: band(bmi, 18.5, 24.9) });
  }
  return items;
}

function InterpIcon({ interp }: { interp: Interp }) {
  if (interp === "high") return <ArrowUpIcon className="size-3" aria-label="High" />;
  if (interp === "low") return <ArrowDownIcon className="size-3" aria-label="Low" />;
  return null;
}

/** Inline vitals strip — fits in a banner or column header. */
export function VitalSigns({ vitals, className }: { vitals: VitalSignsData; className?: string }) {
  return (
    <dl className={cn("tabular flex flex-wrap items-baseline gap-x-4 gap-y-1 text-table", className)}>
      {interpret(vitals).map((i) => (
        <div key={i.key} className="flex items-baseline gap-1">
          <dt className="text-meta text-muted-foreground">{i.label}</dt>
          <dd className={cn("inline-flex items-center gap-0.5 font-semibold", i.interp !== "normal" && "text-warning-foreground")}>
            {i.value}
            <InterpIcon interp={i.interp} />
            <span className="text-meta font-normal text-muted-foreground">{i.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Vitals grid panel with timestamp. */
export function VitalSignsCard({ vitals, className, action }: { vitals: VitalSignsData; className?: string; action?: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <HeartPulseIcon className="size-4 text-danger" aria-hidden />
        <CardTitle>Vital signs</CardTitle>
        <span className="text-meta text-muted-foreground">{clinicalDateTime(vitals.recordedAt)}</span>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <dl className="tabular grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-4">
          {interpret(vitals).map((i) => (
            <div key={i.key} className={cn("rounded-md border px-2 py-1.5", i.interp !== "normal" && "border-warning/50 bg-warning-subtle")}>
              <dt className="text-meta text-muted-foreground">{i.label}</dt>
              <dd className={cn("flex items-center gap-0.5 text-section font-semibold", i.interp !== "normal" && "text-warning-foreground")}>
                {i.value}
                <InterpIcon interp={i.interp} />
              </dd>
              <dd className="text-meta text-muted-foreground">{i.unit}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
