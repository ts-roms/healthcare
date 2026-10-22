import { ModulePage } from "@/components/module-page";
import { redirect } from "next/navigation";
import { FacilityRequired } from "@/components/facility-required";
import { PatientPicker } from "@/components/patient-picker";
import { getPatientForAction, getPractitioners, getVisitTypes } from "@/lib/api/clinic";
import { can, getSelectedFacility, getSession } from "@/lib/api/session";
import { WalkInForm } from "./walk-in-form";

export const metadata = { title: "Check in walk-in" };

export default async function WalkInPage({ searchParams }: { searchParams: Promise<{ patientId?: string; q?: string }> }) {
  const [{ patientId, q = "" }, session, facility] = await Promise.all([searchParams, getSession(), getSelectedFacility()]);
  if (!can(session, "clinic.queue.manage")) redirect("/queue");
  if (!facility) {
    return (
      <ModulePage title="Check in walk-in">
        <FacilityRequired action="Patients are checked in to a facility's queue." />
      </ModulePage>
    );
  }
  // Opened without a patient (a bookmark, a typed address): find the patient first instead of "not found".
  if (!patientId) {
    return (
      <ModulePage title="Check in walk-in" description={`Adds the patient to today's queue at ${facility.name}.`}>
        <PatientPicker action="/queue/walk-in" q={q} verb="Check in" canRegister={can(session, "patient.register")} />
      </ModulePage>
    );
  }
  const [patient, visitTypes, practitioners] = await Promise.all([getPatientForAction(patientId), getVisitTypes(), getPractitioners()]);
  return (
    <ModulePage title="Check in walk-in" description={`Adds the patient to today's queue at ${facility.name}.`}>
      <WalkInForm
        patient={{
          id: patient.id,
          displayName: patient.displayName,
          patientNumber: patient.patientNumber,
          age: patient.age,
          sex: patient.sex,
          status: patient.status,
        }}
        visitTypes={visitTypes.filter((v) => v.modality === "in_person").map((v) => ({ id: v.id, name: v.name }))}
        practitioners={practitioners.map((p) => ({ id: p.id, name: p.displayName }))}
      />
    </ModulePage>
  );
}
