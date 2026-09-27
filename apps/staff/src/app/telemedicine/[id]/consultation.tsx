"use client";

import * as React from "react";
import { CalendarPlusIcon, FlaskConicalIcon, MicIcon, MonitorUpIcon, PhoneOffIcon, PillIcon, StethoscopeIcon, VideoIcon } from "lucide-react";
import { TelemedicineLayout } from "@healthcare/ui/layouts";
import { ClinicalSummary, LabResult, PatientHeader, SummarySection } from "@healthcare/ui/healthcare";
import { Button, Label, Textarea, toast } from "@healthcare/ui/primitives";
import type { getPatientChart } from "@/lib/data";

type Chart = NonNullable<Awaited<ReturnType<typeof getPatientChart>>>;

export function Consultation({ chart }: { chart: Chart }) {
  const [notes, setNotes] = React.useState("");
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const labs = chart.labs.flatMap((o) => o.observations.filter((x) => x.value !== ""));

  return (
    <div className="flex h-full flex-col">
      <PatientHeader patient={chart.patient} variant="compact" />
      <TelemedicineLayout
        className="min-h-0 flex-1"
        video={
          <div className="relative flex h-full min-h-64 items-center justify-center text-white/70">
            <div className="flex flex-col items-center gap-2">
              <VideoIcon className="size-10" aria-hidden />
              <p className="text-body">
                Video stream — {chart.patient.givenName} {chart.patient.familyName}
              </p>
            </div>
            <div className="absolute right-3 bottom-3 flex h-24 w-36 items-center justify-center rounded-md border border-white/20 bg-white/10 text-meta">
              You
            </div>
            <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-meta text-white">
              <span className="size-2 rounded-full bg-danger" aria-hidden /> Live <span className="tabular">{mmss}</span>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
              <Button size="icon" variant="secondary" aria-label="Mute microphone">
                <MicIcon />
              </Button>
              <Button size="icon" variant="secondary" aria-label="Turn off camera">
                <VideoIcon />
              </Button>
              <Button size="icon" variant="secondary" aria-label="Share screen">
                <MonitorUpIcon />
              </Button>
              <Button size="icon" variant="destructive" aria-label="End call">
                <PhoneOffIcon />
              </Button>
            </div>
          </div>
        }
        patient={
          <ClinicalSummary patient={chart.patient}>
            <SummarySection title="Previous labs" icon={FlaskConicalIcon}>
              {labs.length ? (
                labs.map((o) => <LabResult key={o.id} observation={o} className="text-table" />)
              ) : (
                <p className="text-table text-muted-foreground">None</p>
              )}
            </SummarySection>
          </ClinicalSummary>
        }
        notes={
          <div className="flex h-full flex-col gap-1.5">
            <Label htmlFor="tele-notes">Consultation notes</Label>
            <Textarea
              id="tele-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Subjective, objective (as observed on video), assessment, plan…"
              className="min-h-28 flex-1"
            />
          </div>
        }
        actions={
          <>
            <Button size="sm" variant="outline">
              <StethoscopeIcon /> Diagnosis
            </Button>
            <Button size="sm" variant="outline">
              <PillIcon /> Prescription
            </Button>
            <Button size="sm" variant="outline">
              <FlaskConicalIcon /> Lab order
            </Button>
            <Button size="sm" variant="outline">
              <CalendarPlusIcon /> Follow-up
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => toast.success("Consultation note saved")}>
              Save & sign
            </Button>
          </>
        }
      />
    </div>
  );
}
