import type { DohCaseSource } from "./doh.rules";

/**
 * What DOH reporting needs from other domains (diagnosis, encounter, patient, facility), implemented by the app's
 * composition root (apps/api/src/app/adapters/doh-adapters.ts). This library never reads clinical tables.
 */
export interface DohCaseSources {
  forDiagnosis(organizationId: string, diagnosisId: string): Promise<DohCaseSource | undefined>;
  /**
   * The organization's coded diagnoses recorded in [start, end), not entered in error, oldest first and after the
   * cursor — for checking earlier diagnoses against the rules. `recordedAt` is the full-precision timestamp as text
   * (the cursor for the next page).
   */
  codedDiagnosesRecorded(
    organizationId: string,
    range: { start: Date; end: Date },
    after: { recordedAt: string; diagnosisId: string } | null,
    limit: number,
  ): Promise<DohDiagnosisBrief[]>;
  /** Patient number and name for lists. */
  patientBriefs(organizationId: string, patientIds: string[]): Promise<Map<string, { patientNumber: string; displayName: string }>>;
}
export interface DohDiagnosisBrief {
  id: string;
  codeSystemKey: string | null;
  code: string;
  recordedAt: string;
}

export const DOH_CASE_SOURCES = Symbol("DOH_CASE_SOURCES");
