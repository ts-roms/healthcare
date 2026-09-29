import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { BusinessRuleError } from "../errors";
import { asPgError, type DbExecutor } from "./database";

/**
 * Patient merge "link, don't move" (ADR-0009): a merged (retired) record keeps everything filed under it and points to
 * the surviving record. These helpers are the Patient Master's read contract for other domains — they call the SQL
 * functions of migration 0068 and never read the patient table themselves.
 */

/**
 * `column` holds one of the record ids filed as `patientId`: the record itself and every record merged into it. Use it
 * for patient-scoped reads that feed a patient view; writes stay on the single id.
 */
export function filedAsPatient(column: AnyColumn | SQL, patientId: string): SQL {
  return sql`${column} = ANY(patient_record_ids(${patientId}::uuid))`;
}

/** Whether a record's `rowPatientId` is filed as `patientId` (the same record, or one merged into it). */
export async function isFiledAs(executor: DbExecutor, rowPatientId: string | null | undefined, patientId: string): Promise<boolean> {
  if (!rowPatientId) return false;
  if (rowPatientId === patientId) return true;
  const { rows } = await executor.execute<{ filed: boolean }>(sql`SELECT ${rowPatientId}::uuid = ANY(patient_record_ids(${patientId}::uuid)) AS filed`);
  return rows[0]?.filed === true;
}

/** The surviving record a patient id is filed as (itself unless merged), e.g. to count a merged pair once. */
export function canonicalPatientId(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`patient_canonical_id(${column})`;
}

/** SQLSTATE raised when new care would be filed under a merged record (the survivor's id is the error's DETAIL). */
export const PATIENT_MERGED_SQLSTATE = "PM001";

/** New care addressed to a merged record: file it under the surviving record instead. */
export class PatientMergedError extends BusinessRuleError {
  constructor(readonly survivorPatientId: string | null) {
    super(
      "This record was merged into another patient; use the surviving record instead",
      "patient_merged",
      survivorPatientId ? { survivorPatientId } : undefined,
    );
  }
}

/** The domain error for a database refusal to file care under a merged record, if that is what `error` is. */
export function patientMergedError(error: unknown): PatientMergedError | undefined {
  const pg = asPgError(error);
  return pg?.code === PATIENT_MERGED_SQLSTATE ? new PatientMergedError(pg.detail ?? null) : undefined;
}
