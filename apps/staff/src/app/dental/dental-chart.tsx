"use client";

import * as React from "react";
import type { DentalChart, Patient, ToothNumber } from "@healthcare/domain";
import { Odontogram, PatientHeader, TOOTH_CONDITIONS, ToothEditor } from "@healthcare/ui/healthcare";
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@healthcare/ui/primitives";

export function DentalChartView({ patient, initialChart }: { patient: Patient; initialChart: DentalChart }) {
  const [chart, setChart] = React.useState(initialChart);
  const [tooth, setTooth] = React.useState<ToothNumber>(36);
  const findings = Object.values(chart).filter((r) => r.condition !== "healthy");

  return (
    <div className="flex min-h-full flex-col">
      <PatientHeader
        patient={patient}
        variant="compact"
        aside={
          <Button size="sm" onClick={() => toast.success("Dental chart saved")}>
            Save chart
          </Button>
        }
      />
      <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Odontogram</CardTitle>
              <span className="text-meta text-muted-foreground">FDI · permanent dentition</span>
            </CardHeader>
            <CardContent>
              <Odontogram chart={chart} selectedTooth={tooth} onSelectTooth={setTooth} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Findings</CardTitle>
            </CardHeader>
            <ul className="divide-y text-table">
              {findings.map((r) => (
                <li key={r.tooth}>
                  <button type="button" onClick={() => setTooth(r.tooth)} className="flex w-full items-baseline gap-3 px-3 py-1.5 text-left hover:bg-accent/60">
                    <span className="w-8 font-mono font-semibold">#{r.tooth}</span>
                    <span className="w-24">{TOOTH_CONDITIONS.find((c) => c.value === r.condition)?.label}</span>
                    <span className="w-32 shrink-0 text-muted-foreground">{r.surfaces.join(", ")}</span>
                    <span className="truncate text-muted-foreground">{r.notes}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card className="self-start">
          <CardContent>
            <ToothEditor tooth={tooth} record={chart[tooth]} onChange={(r) => setChart((c) => ({ ...c, [tooth]: r }))} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
