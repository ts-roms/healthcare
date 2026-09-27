import type { DohCaseSource } from "./doh.rules";

/**
 * What DOH reporting needs from other domains (diagnosis, encounter, patient, facility), implemented by the app's
 * composition root (apps/api/src/app/adapters/doh-adapters.ts). This library never reads clinical tables.
 */
export interface DohCaseSources {
  forDiagnosis(organizationId: string, diagnosisId: string): Promise<DohCaseSource | undefined>;
  /** Patient number and name for lists. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, { patientNumber: string; displayName: string }>>;
}
export const DOH_CASE_SOURCES = Symbol("DOH_CASE_SOURCES");
