/**
 * Demo fixtures for screens not yet wired to the API (the Patient 360
 * preview, including its dental tab). Pages using this module
 * are badged "Demo" and show a demo-data banner. Real patient data comes from
 * the API via `@/lib/api`; never mix the two on one screen.
 */
import * as fx from "@healthcare/domain/fixtures";

export async function getPatients() {
  return fx.patients;
}
export async function getPatient(id: string) {
  return fx.patients.find((p) => p.id === id || p.mrn === id);
}
export async function getPatientChart(id: string) {
  const patient = await getPatient(id);
  if (!patient) return undefined;
  const own = <T extends { patientId: string }>(xs: T[]) => xs.filter((x) => x.patientId === patient.id);
  return {
    patient,
    vitals: fx.latestVitals,
    encounters: own(fx.encounters),
    labs: own(fx.labWorklist),
    hba1cTrend: fx.hba1cTrend,
    carePlan: patient.id === fx.mariaSantos.id ? fx.carePlan : undefined,
    timeline: patient.id === fx.mariaSantos.id ? fx.timeline : [],
    dental: patient.id === fx.mariaSantos.id ? fx.dentalChart : {},
    audit: fx.auditHistory,
  };
}
export async function getLabWorklist() {
  return fx.labWorklist;
}
export async function getAppointments() {
  return fx.appointments;
}
