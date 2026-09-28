import * as React from "react";
import { CalendarIcon, CheckCircle2Icon, CircleDotIcon, FlaskConicalIcon, PillIcon, ReceiptIcon, StethoscopeIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Diagnosis } from "@healthcare/domain";
import {
  auditHistory,
  carePlan,
  currentEncounter,
  diagnosisCatalog,
  encounters,
  latestVitals,
  mariaSantos,
  prescriptionDraft,
  timeline,
} from "@healthcare/domain/fixtures";
import { AuditHistory } from "./audit-history";
import { CarePlan } from "./care-plan";
import { ClinicalNote } from "./clinical-note";
import { ClinicalSummary } from "./clinical-summary";
import { DiagnosisSelector } from "./diagnosis-selector";
import { EncounterTimeline } from "./encounter-timeline";
import { MedicalDocument } from "./medical-document";
import { PatientTimeline } from "./patient-timeline";
import { RecordTimeline } from "./record-timeline";
import { PrescriptionEditor } from "./prescription-editor";
import { VitalSigns, VitalSignsCard } from "./vital-signs";

const meta: Meta = { title: "Healthcare/Clinical" };
export default meta;

export const Vitals: StoryObj = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-4">
      <VitalSigns vitals={latestVitals} />
      <VitalSignsCard vitals={latestVitals} />
    </div>
  ),
};

export const Summary: StoryObj = { render: () => <ClinicalSummary patient={mariaSantos} className="max-w-xs" /> };

export const Note: StoryObj = {
  render: function Render() {
    const [note, setNote] = React.useState(currentEncounter.note ?? {});
    const [dx, setDx] = React.useState<Diagnosis[]>(currentEncounter.diagnoses ?? []);
    return (
      <ClinicalNote
        className="max-w-2xl"
        value={note}
        onChange={setNote}
        slots={{ diagnosis: <DiagnosisSelector catalog={diagnosisCatalog} value={dx} onChange={setDx} /> }}
      />
    );
  },
};

export const Prescription: StoryObj = {
  render: () => (
    <div className="flex max-w-4xl flex-col gap-2">
      <p className="text-meta text-muted-foreground">Try typing “Amoxicillin” as a drug — the patient has a penicillin allergy.</p>
      <PrescriptionEditor defaultItems={prescriptionDraft} allergies={mariaSantos.allergies} onSubmit={(v) => alert(JSON.stringify(v, null, 2))} />
    </div>
  ),
};

/** A conflicting line: change the drug, or override with a documented reason (returned in `allergyOverrides` for audit). */
export const PrescriptionAllergyOverride: StoryObj = {
  name: "Prescription — allergy override",
  render: () => (
    <div className="flex max-w-4xl flex-col gap-2">
      <PrescriptionEditor
        defaultItems={[
          ...prescriptionDraft,
          { id: "rx3", drug: "Amoxicillin", strength: "500 mg", form: "capsule", sig: "1 cap PO TID for 7 days", quantity: 21, refills: 0 },
        ]}
        allergies={mariaSantos.allergies}
        onSubmit={(v) => alert(JSON.stringify(v, null, 2))}
      />
    </div>
  ),
};

export const Timelines: StoryObj = {
  render: () => (
    <div className="grid max-w-4xl gap-6 md:grid-cols-2">
      <PatientTimeline events={timeline} />
      <EncounterTimeline encounters={encounters} selectedId={currentEncounter.id} />
    </div>
  ),
};

/** The patient record's timeline (sample entries): grouped by day, linked, status as icon + text, invalid records marked. */
export const RecordTimelineStory: StoryObj = {
  name: "Record timeline",
  render: () => (
    <RecordTimeline
      className="max-w-2xl"
      days={[
        {
          key: "2026-09-27",
          label: "27 Sep 2026",
          items: [
            {
              id: "1",
              icon: ReceiptIcon,
              kindLabel: "Payment",
              title: "Payment ₱500.00",
              detail: "Cash · Receipt OR-000123",
              dateTime: "2026-09-27T03:10:00Z",
              time: "11:10",
              facility: "Main Clinic",
              href: "#",
            },
            {
              id: "2",
              icon: FlaskConicalIcon,
              kindLabel: "Laboratory results",
              title: "Results released: FBS, HbA1c (2 tests)",
              detail: "Order LAB00000012",
              dateTime: "2026-09-27T02:40:00Z",
              time: "10:40",
              facility: "Main Clinic",
              flag: "abnormal",
              status: { label: "Released", icon: CheckCircle2Icon, variant: "success" },
              href: "#",
            },
            {
              id: "3",
              icon: PillIcon,
              kindLabel: "Prescription",
              title: "Prescription RX00000031",
              detail: "Metformin, Losartan",
              dateTime: "2026-09-27T01:20:00Z",
              time: "09:20",
              status: { label: "Active", icon: CircleDotIcon, variant: "info" },
              href: "#",
            },
            {
              id: "4",
              icon: StethoscopeIcon,
              kindLabel: "Encounter",
              title: "Consultation: General consult",
              detail: "Dr. Elena Reyes · Diagnoses: E11.9",
              dateTime: "2026-09-27T01:00:00Z",
              time: "09:00",
              status: { label: "Signed", icon: CheckCircle2Icon, variant: "success" },
              href: "#",
            },
          ],
        },
        {
          key: "2026-09-20",
          label: "20 Sep 2026",
          items: [
            {
              id: "5",
              icon: CalendarIcon,
              kindLabel: "Appointment",
              title: "Appointment: General consult",
              detail: "Dr. Elena Reyes",
              dateTime: "2026-09-20T01:00:00Z",
              time: "09:00",
              marker: "Cancelled",
            },
          ],
        },
      ]}
    />
  ),
};

export const CarePlanStory: StoryObj = { name: "Care plan", render: () => <CarePlan plan={carePlan} className="max-w-sm" /> };

export const Documents: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-2">
      <MedicalDocument title="Medical certificate" kind="certificate" date="2026-09-27" author="Dr. Elena Reyes" signed />
      <MedicalDocument title="Referral to Ophthalmology" kind="referral" date="2026-09-27" author="Dr. Elena Reyes" signed={false} />
      <MedicalDocument title="Chest X-ray PA" kind="imaging" date="2026-06-02" author="Central Imaging" />
    </div>
  ),
};

export const Audit: StoryObj = { render: () => <AuditHistory entries={auditHistory} className="max-w-xl" /> };
