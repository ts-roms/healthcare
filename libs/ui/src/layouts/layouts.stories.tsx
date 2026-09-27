import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarIcon, FlaskConicalIcon, HomeIcon, MessageSquareIcon, UserIcon } from "lucide-react";
import { STAFF_ROLES, type StaffRole } from "@healthcare/domain";
import { currentEncounter, encounters, labWorklist, mariaSantos } from "@healthcare/domain/fixtures";
import { Button } from "../primitives/button";
import { NativeSelect } from "../primitives/select";
import { ClinicalNote } from "../healthcare/clinical-note";
import { ClinicalSummary } from "../healthcare/clinical-summary";
import { EncounterTimeline } from "../healthcare/encounter-timeline";
import { LabWorklist } from "../healthcare/lab-worklist";
import { PatientHeader } from "../healthcare/patient-header";
import { DoctorLayout } from "./doctor-layout";
import { LaboratoryLayout } from "./laboratory-layout";
import { PatientLayout } from "./patient-layout";
import { StaffLayout } from "./staff-layout";

const meta: Meta = { title: "Layouts", parameters: { layout: "fullscreen" } };
export default meta;

export const Staff: StoryObj = {
  render: function Render() {
    const [role, setRole] = React.useState<StaffRole>("doctor");
    return (
      <StaffLayout
        role={role}
        pathname="/laboratory/results"
        topbarEnd={
          <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {STAFF_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        }
      >
        <p className="p-4 text-muted-foreground">Switch role in the top bar — the sidebar is role-aware.</p>
      </StaffLayout>
    );
  },
};

export const Doctor: StoryObj = {
  render: function Render() {
    const [note, setNote] = React.useState(currentEncounter.note ?? {});
    return (
      <div className="h-dvh">
        <DoctorLayout
          header={<PatientHeader patient={mariaSantos} variant="compact" />}
          left={{ title: "Patient history", content: <EncounterTimeline encounters={encounters} selectedId={currentEncounter.id} className="-mx-3" /> }}
          center={{ title: "Current encounter", content: <ClinicalNote value={note} onChange={setNote} /> }}
          right={{ title: "Clinical context", content: <ClinicalSummary patient={mariaSantos} /> }}
          actions={
            <>
              <Button size="sm" variant="outline">
                Order lab
              </Button>
              <Button size="sm" variant="outline">
                Prescription
              </Button>
              <Button size="sm" className="ml-auto">
                Sign encounter
              </Button>
            </>
          }
        />
      </div>
    );
  },
};

export const Laboratory: StoryObj = {
  render: () => (
    <div className="h-dvh">
      <LaboratoryLayout
        toolbar={<Button size="sm">Scan</Button>}
        list={<LabWorklist orders={labWorklist} selectedId="lo-1" />}
        detail={<p className="p-3">Selected order detail</p>}
      />
    </div>
  ),
};

export const Patient: StoryObj = {
  render: () => (
    <PatientLayout
      pathname="/"
      brand={<span className="font-semibold text-primary">MyHealth</span>}
      nav={[
        { label: "Home", href: "/", icon: HomeIcon },
        { label: "Visits", href: "/appointments", icon: CalendarIcon },
        { label: "Results", href: "/results", icon: FlaskConicalIcon },
        { label: "Messages", href: "/messages", icon: MessageSquareIcon },
        { label: "Profile", href: "/profile", icon: UserIcon },
      ]}
    >
      <h1 className="text-page-lg font-semibold">
        Good morning, Maria{" "}
        <span role="img" aria-label="waving hand">
          👋
        </span>
      </h1>
    </PatientLayout>
  ),
};
