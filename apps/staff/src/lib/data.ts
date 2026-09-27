/**
 * Data-access seam. Everything the UI reads goes through here, so replacing
 * the demo fixtures with FHIR/REST calls is a change to this file only.
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
export async function getEncounter(id: string) {
  return fx.encounters.find((e) => e.id === id);
}
export async function getLabWorklist() {
  return fx.labWorklist;
}
export async function getAppointments() {
  return fx.appointments;
}
export async function getQueue() {
  return fx.queue;
}
export const catalogs = { diagnoses: fx.diagnosisCatalog, providers: fx.providers, facilities: fx.facilities, prescriptionDraft: fx.prescriptionDraft };

/** Fixed "now" so the demo data reads consistently. */
export const DEMO_NOW = new Date("2026-09-27T10:05:00+08:00");
