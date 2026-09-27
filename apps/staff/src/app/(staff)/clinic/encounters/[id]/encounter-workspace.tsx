"use client";

import * as React from "react";
import { CalendarPlusIcon, FileSignatureIcon, FlaskConicalIcon, PillIcon, SendIcon } from "lucide-react";
import type { Diagnosis, Encounter, PrescriptionItem } from "@healthcare/domain";
import { DoctorLayout } from "@healthcare/ui/layouts";
import {
  CarePlan,
  ClinicalNote,
  ClinicalSummary,
  clinicalDate,
  DiagnosisSelector,
  EncounterTimeline,
  LabResult,
  PatientHeader,
  PrescriptionEditor,
  SummarySection,
  VitalSigns,
} from "@healthcare/ui/healthcare";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Kbd, toast } from "@healthcare/ui/primitives";
import type { getPatientChart } from "@/lib/demo-data";

type Chart = NonNullable<Awaited<ReturnType<typeof getPatientChart>>>;

export function EncounterWorkspace({
  encounter,
  chart,
  diagnosisCatalog,
  prescriptionDraft,
}: {
  encounter: Encounter;
  chart: Chart;
  diagnosisCatalog: { code: string; display: string }[];
  prescriptionDraft: PrescriptionItem[];
}) {
  const [note, setNote] = React.useState(encounter.note ?? {});
  const [diagnoses, setDiagnoses] = React.useState<Diagnosis[]>(encounter.diagnoses ?? []);
  const [rxOpen, setRxOpen] = React.useState(false);
  const [historyId, setHistoryId] = React.useState(encounter.id);
  const viewing = chart.encounters.find((e) => e.id === historyId);
  const latestLabs = chart.labs.flatMap((o) => o.observations.filter((x) => x.value !== "").slice(0, 3));

  // Alt+P prescription, Alt+L lab — clinicians shouldn't need the mouse.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setRxOpen(true);
      } else if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        toast.info("Lab order panel", { description: "Order entry opens here." });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <DoctorLayout
        header={
          <PatientHeader
            patient={chart.patient}
            variant="compact"
            aside={
              <span className="flex items-center gap-2 text-table">
                <Badge variant="teal" className="capitalize">
                  {encounter.type}
                </Badge>
                <span className="tabular text-muted-foreground">{clinicalDate(encounter.date)}</span>
              </span>
            }
          />
        }
        left={{
          title: "Patient history",
          content: (
            <div className="-mx-3 -mt-3 flex flex-col">
              <EncounterTimeline encounters={chart.encounters} selectedId={historyId} onSelect={(e) => setHistoryId(e.id)} />
              {viewing && viewing.id !== encounter.id ? (
                <div className="mx-3 mt-3 rounded-md border bg-muted/50 p-2 text-table">
                  <p className="font-semibold">{viewing.reason}</p>
                  <p className="text-muted-foreground">{viewing.diagnoses?.map((d) => `${d.code} ${d.display}`).join("; ") || "No coded diagnoses"}</p>
                </div>
              ) : null}
            </div>
          ),
        }}
        center={{
          title: "Current encounter",
          action: <VitalSigns vitals={chart.vitals} className="hidden 2xl:flex" />,
          content: (
            <ClinicalNote
              value={note}
              onChange={setNote}
              slots={{ diagnosis: <DiagnosisSelector catalog={diagnosisCatalog} value={diagnoses} onChange={setDiagnoses} /> }}
            />
          ),
        }}
        right={{
          title: "Clinical context",
          content: (
            <ClinicalSummary patient={chart.patient}>
              <SummarySection title="Vitals">
                <VitalSigns vitals={chart.vitals} className="gap-x-3" />
              </SummarySection>
              <SummarySection title="Recent labs" icon={FlaskConicalIcon}>
                {latestLabs.length ? (
                  latestLabs.map((o) => <LabResult key={o.id} observation={o} className="text-table" />)
                ) : (
                  <p className="text-table text-muted-foreground">None</p>
                )}
              </SummarySection>
              {chart.carePlan ? (
                <SummarySection title="Care plan">
                  <CarePlan plan={chart.carePlan} />
                </SummarySection>
              ) : null}
            </ClinicalSummary>
          ),
        }}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => toast.info("Lab order panel", { description: "Order entry opens here." })}>
              <FlaskConicalIcon /> Order lab <Kbd className="ml-1 hidden md:inline-flex">Alt L</Kbd>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRxOpen(true)}>
              <PillIcon /> Prescription <Kbd className="ml-1 hidden md:inline-flex">Alt P</Kbd>
            </Button>
            <Button size="sm" variant="outline">
              <SendIcon /> Referral
            </Button>
            <Button size="sm" variant="outline">
              <FileSignatureIcon /> Certificate
            </Button>
            <Button size="sm" variant="outline">
              <CalendarPlusIcon /> Follow-up
            </Button>
            <span className="ml-auto hidden text-meta text-muted-foreground sm:inline">Draft saved 09:52</span>
            <Button
              size="sm"
              onClick={() => {
                if (!diagnoses.length) return toast.error("Add at least one diagnosis before signing.");
                toast.success("Encounter signed", { description: `${chart.patient.givenName} ${chart.patient.familyName} · ${diagnoses[0]!.code}` });
              }}
            >
              Sign encounter
            </Button>
          </>
        }
      />
      <Dialog open={rxOpen} onOpenChange={setRxOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Prescription</DialogTitle>
            <DialogDescription>
              Decision support checks each line against recorded allergies: {chart.patient.allergies.map((a) => a.substance).join(", ") || "none"}.
            </DialogDescription>
          </DialogHeader>
          <PrescriptionEditor
            defaultItems={prescriptionDraft}
            allergies={chart.patient.allergies}
            onSubmit={({ items, allergyOverrides }) => {
              setRxOpen(false);
              toast.success("Prescription signed", { description: `${items.length} item(s)` });
              // Demo: production records an AuditEvent (who, patient, drug, allergy, reason) via the audit API.
              for (const o of allergyOverrides) {
                toast.warning("Allergy override recorded in audit trail", {
                  description: `${o.drug} despite ${o.substance} allergy — “${o.reason}”`,
                });
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
